"""Route alternatives from public routing APIs, normalised to `domain.route.Route`.

Strategy
--------
1. Trips within Valhalla's public-server limit use its real *truck* costing (vehicle
   weight, height and width restrictions). Several cost profiles are requested (default
   with Valhalla's own alternates, shortest, highway-preferred) and merged.
2. Longer trips, or a Valhalla outage, fall back to OSRM, which is a *car* profile. It
   returns its own alternatives plus routes forced through corridor waypoints.

Candidates are de-duplicated by geometric overlap, implausible detours are dropped, and
at most three are kept. Fewer than three is a legitimate result and is reported as is.
"""

from __future__ import annotations

import asyncio
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field, replace

from domain.geometry import (
    decode_polyline,
    fast_cumulative_mi,
    haversine_mi,
    thin_indices,
)
from domain.models import LatLon
from domain.route import Route

from .http import HttpClient, UpstreamError

VALHALLA_URL = "https://valhalla1.openstreetmap.de/route"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{coords}"

# The public Valhalla server rejects trips whose total straight-line length exceeds
# 1,500 km (~932 mi); stay under it with some margin.
VALHALLA_MAX_STRAIGHT_MI = 850  # leaves room for the detour legs through corridor waypoints
MAX_ROUTES = 3
MAX_DETOUR_RATIO = 1.35  # drop candidates slower than 1.35x the fastest
DUPLICATE_OVERLAP = 0.9
BACKTRACK_GAP_MI = 15.0  # revisiting a spot after this much road means a spur or loop
SHAPE_SPACING_MI = 0.25  # thin dense provider geometry before per-vertex work
CORRIDOR_OFFSET_FRACTION = 0.12

# Assumed vehicle: 5-axle tractor-trailer, US legal dimensions.
TRUCK_TARE_LB = 33_000
LB_PER_TONNE = 2204.62
MAX_TRUCK_WEIGHT_T = 40.0
TRUCK_DIMENSIONS = {"height": 4.11, "width": 2.6, "length": 21.7}  # metres

VALHALLA_PROFILES: tuple[tuple[dict, int], ...] = (
    ({}, 2),  # default cost, plus Valhalla's own alternates
    ({"shortest": True}, 0),
)


class NoRouteError(Exception):
    """The providers answered but no drivable route exists between the points."""


@dataclass(frozen=True)
class RoutingResult:
    routes: list[Route]
    provider: str
    profile: str  # "truck" or "car"
    notes: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- parsing


def _prefix_sums(values: list[float]) -> list[float]:
    total = 0.0
    sums = [0.0]
    for value in values:
        total += value
        sums.append(total)
    return sums


def _compact(shape, times, spacing_mi=SHAPE_SPACING_MI):
    keep = thin_indices(fast_cumulative_mi(shape), spacing_mi)
    return [shape[i] for i in keep], [times[i] for i in keep]


def _summarise_via(lengths_by_road: dict[str, float]) -> str:
    ranked = sorted(lengths_by_road.items(), key=lambda item: -item[1])
    return ", ".join(name for name, _ in ranked[:2])


_DIRECTION = re.compile(r"\s+(East|West|North|South)$", re.IGNORECASE)


def _valhalla_time_profile(fast_cum: list[float], maneuvers: list[dict], total_s: float):
    """Elapsed seconds at every shape vertex, from per-maneuver time and length."""
    count = len(fast_cum)
    times = [0.0] * count
    elapsed = 0.0
    for m in maneuvers:
        begin, end = m["begin_shape_index"], m["end_shape_index"]
        span = fast_cum[end] - fast_cum[begin]
        for j in range(begin, end + 1):
            fraction = (fast_cum[j] - fast_cum[begin]) / span if span > 0 else float(j == end)
            times[j] = elapsed + m["time"] * fraction
        elapsed += m["time"]
    if times[-1] <= 0:  # no usable maneuvers: assume constant speed
        return [total_s * d / fast_cum[-1] for d in fast_cum]
    scale = total_s / times[-1]
    return [t * scale for t in times]


def parse_valhalla_trip(trip: dict) -> Route:
    leg = trip["legs"][0]
    shape = decode_polyline(leg["shape"], precision=6)
    fast_cum = fast_cumulative_mi(shape)
    maneuvers = leg.get("maneuvers", [])
    times = _valhalla_time_profile(fast_cum, maneuvers, trip["summary"]["time"])

    roads: dict[str, float] = defaultdict(float)
    for m in maneuvers:
        names = m.get("street_names") or []
        if names:
            roads[_DIRECTION.sub("", names[0])] += m.get("length", 0.0)

    shape, times = _compact(shape, times)
    return Route.build(
        id="candidate",
        label="candidate",
        via=_summarise_via(roads),
        source="Valhalla",
        profile="truck",
        shape=shape,
        distance_mi=trip["summary"]["length"],
        cum_time_s=times,
    )


def parse_osrm_route(route: dict) -> Route:
    shape = decode_polyline(route["geometry"], precision=6)
    durations = [d for leg in route["legs"] for d in leg["annotation"]["duration"]]
    if len(durations) == len(shape) - 1:
        times = _prefix_sums(durations)
        scale = route["duration"] / times[-1] if times[-1] > 0 else 1.0
        times = [t * scale for t in times]
    else:  # annotations unavailable: constant speed
        fast_cum = fast_cumulative_mi(shape)
        times = [route["duration"] * d / fast_cum[-1] for d in fast_cum]

    shape, times = _compact(shape, times)
    return Route.build(
        id="candidate",
        label="candidate",
        via="",
        source="OSRM",
        profile="car",
        shape=shape,
        distance_mi=route["distance"] / 1609.344,
        cum_time_s=times,
    )


# ------------------------------------------------------------------------ selection


def _cells(route: Route) -> set[tuple[int, int]]:
    return {(round(p.lat * 100), round(p.lon * 100)) for p in route.shape}


def overlap(a: set, b: set) -> float:
    """Shared fraction of the smaller route's grid cells (~0.7 mi cells)."""
    smaller = min(len(a), len(b))
    return len(a & b) / smaller if smaller else 0.0


def has_backtrack(route: Route) -> bool:
    """True if the road returns to a place it already passed, 15+ miles later.

    Routes forced through a corridor waypoint can run out to a snapped point and come
    straight back; that is a detour to the waypoint, not a real alternative.
    """
    first_seen: dict[tuple[int, int], float] = {}
    for point, mile in zip(route.shape, route.cum_dist_mi, strict=True):
        cell = (round(point.lat * 50), round(point.lon * 50))  # ~1.4 mi cells
        earlier = first_seen.setdefault(cell, mile)
        if mile - earlier > BACKTRACK_GAP_MI:
            return True
    return False


def select_routes(candidates: list[Route]) -> list[Route]:
    """Keep up to three distinct, plausible routes, fastest first."""
    ordered = sorted((r for r in candidates if not has_backtrack(r)), key=lambda r: r.duration_s)
    if not ordered:
        return []
    fastest = ordered[0].duration_s
    kept: list[Route] = []
    kept_cells: list[set] = []
    for route in ordered:
        if route.duration_s > fastest * MAX_DETOUR_RATIO:
            continue
        cells = _cells(route)
        if any(overlap(cells, other) >= DUPLICATE_OVERLAP for other in kept_cells):
            continue
        kept.append(route)
        kept_cells.append(cells)
        if len(kept) == MAX_ROUTES:
            break
    return [replace(route, id=f"r{i}", label=f"Route {i}") for i, route in enumerate(kept, start=1)]


def corridor_waypoints(origin: LatLon, destination: LatLon) -> list[LatLon]:
    """Two points either side of the midpoint, to force routes through other corridors."""
    mid_lat = (origin.lat + destination.lat) / 2
    mid_lon = (origin.lon + destination.lon) / 2
    cos_lat = math.cos(math.radians(mid_lat))
    dx = (destination.lon - origin.lon) * cos_lat
    dy = destination.lat - origin.lat
    length = math.hypot(dx, dy)
    if length == 0:
        return []
    px, py = -dy / length, dx / length  # unit vector perpendicular to the trip direction
    offset_deg = length * CORRIDOR_OFFSET_FRACTION
    return [
        LatLon(mid_lat + side * py * offset_deg, mid_lon + side * px * offset_deg / cos_lat)
        for side in (1, -1)
    ]


# ---------------------------------------------------------------------------- fetching


def truck_weight_tonnes(load_lb: float) -> float:
    return min((load_lb + TRUCK_TARE_LB) / LB_PER_TONNE, MAX_TRUCK_WEIGHT_T)


def _valhalla_body(
    origin: LatLon,
    destination: LatLon,
    load_lb: float,
    options: dict,
    alts: int,
    via: LatLon | None = None,
):
    truck = {"weight": round(truck_weight_tonnes(load_lb), 2), **TRUCK_DIMENSIONS, **options}
    locations = [{"lat": origin.lat, "lon": origin.lon}]
    if via:  # "through" keeps a single leg and forbids a U-turn at the waypoint
        locations.append({"lat": via.lat, "lon": via.lon, "type": "through"})
    locations.append({"lat": destination.lat, "lon": destination.lon})
    body = {
        "locations": locations,
        "costing": "truck",
        "costing_options": {"truck": truck},
        "units": "miles",
    }
    if alts:
        body["alternates"] = alts
    return body


async def _valhalla_candidates(http, origin, destination, load_lb) -> list[Route]:
    async def one(options, alts, via=None):
        body = _valhalla_body(origin, destination, load_lb, options, alts, via)
        payload = await http.request_json(
            "POST", VALHALLA_URL, service="routing", json_body=body, timeout=30.0
        )
        trips = [payload["trip"], *(alt["trip"] for alt in payload.get("alternates", []))]
        return [parse_valhalla_trip(trip) for trip in trips]

    requests = [one(options, alts) for options, alts in VALHALLA_PROFILES]
    requests += [one({}, 0, via) for via in corridor_waypoints(origin, destination)]
    results = await asyncio.gather(*requests, return_exceptions=True)
    routes = [r for result in results if isinstance(result, list) for r in result]
    if routes:
        return routes
    errors = [r for r in results if isinstance(r, Exception)]
    no_path = [
        e for e in errors if isinstance(e, UpstreamError) and "No path could be found" in str(e)
    ]
    if no_path:
        raise NoRouteError("No drivable truck route found between these locations.")
    raise errors[0] if errors else UpstreamError("routing", "no routes returned")


async def _osrm_candidates(http, origin, destination) -> list[Route]:
    async def one(waypoints: list[LatLon], alternatives: str):
        coords = ";".join(f"{p.lon:.6f},{p.lat:.6f}" for p in waypoints)
        payload = await http.request_json(
            "GET",
            OSRM_URL.format(coords=coords),
            service="routing",
            params={
                "alternatives": alternatives,
                "overview": "full",
                "geometries": "polyline6",
                "steps": "false",
                "annotations": "duration",
            },
            timeout=30.0,
        )
        if payload.get("code") == "NoRoute":
            return []
        return [parse_osrm_route(r) for r in payload.get("routes", [])]

    requests = [one([origin, destination], "3")]
    requests += [
        one([origin, via, destination], "false") for via in corridor_waypoints(origin, destination)
    ]
    results = await asyncio.gather(*requests, return_exceptions=True)
    routes = [r for result in results if isinstance(result, list) for r in result]
    if routes:
        return routes
    errors = [r for r in results if isinstance(r, Exception)]
    if errors:
        raise errors[0]
    raise NoRouteError("No drivable route found between these locations.")


async def fetch_routes(
    http: HttpClient, origin: LatLon, destination: LatLon, load_lb: float
) -> RoutingResult:
    notes: list[str] = []
    straight = haversine_mi(origin, destination)

    if straight <= VALHALLA_MAX_STRAIGHT_MI:
        try:
            routes = select_routes(await _valhalla_candidates(http, origin, destination, load_lb))
            if routes:
                return RoutingResult(routes, "Valhalla", "truck", notes)
        except UpstreamError as exc:
            notes.append(
                "The truck routing service was unavailable, so car-profile routes are shown "
                f"instead ({exc.service} {exc.status or 'error'})."
            )
    else:
        notes.append(
            "This trip is longer than the public truck-routing service supports "
            "(about 930 mi straight-line), so car-profile routes are shown. Durations and "
            "restrictions are not truck-specific."
        )

    routes = select_routes(await _osrm_candidates(http, origin, destination))
    if not routes:
        raise NoRouteError("No drivable route found between these locations.")
    return RoutingResult(routes, "OSRM", "car", notes)
