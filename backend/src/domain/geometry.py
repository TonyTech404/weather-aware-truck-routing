"""Spherical geometry helpers and Google-style polyline encoding."""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence

from .models import LatLon

EARTH_RADIUS_MI = 3958.7613


def haversine_mi(a: LatLon, b: LatLon) -> float:
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(h)))


def cumulative_distances_mi(shape: Sequence[LatLon]) -> list[float]:
    """Distance along the polyline from its first vertex to each vertex."""
    cumulative = [0.0]
    for prev, cur in itertools.pairwise(shape):
        cumulative.append(cumulative[-1] + haversine_mi(prev, cur))
    return cumulative


def fast_cumulative_mi(shape: Sequence[LatLon]) -> list[float]:
    """Cheap approximate distance along a DENSE polyline (vertices well under a mile apart).

    Uses a local flat-earth approximation per segment (one `cos` instead of the full
    haversine), which is accurate to a fraction of a percent at that spacing. Meant for
    pre-processing raw provider geometry; checkpoint placement uses `haversine_mi`.
    """
    miles_per_degree = EARTH_RADIUS_MI * math.pi / 180
    cumulative = [0.0]
    for prev, cur in itertools.pairwise(shape):
        dy = (cur.lat - prev.lat) * miles_per_degree
        dx = (
            (cur.lon - prev.lon)
            * miles_per_degree
            * math.cos(math.radians((cur.lat + prev.lat) / 2))
        )
        cumulative.append(cumulative[-1] + math.hypot(dx, dy))
    return cumulative


def thin_indices(cumulative_mi: Sequence[float], min_spacing_mi: float) -> list[int]:
    """Indices of vertices at least `min_spacing_mi` apart along the path (endpoints kept).

    Shrinks dense provider geometry before the expensive per-vertex work. Positions and
    times of kept vertices are unchanged, so the route stays on the real road.
    """
    last = len(cumulative_mi) - 1
    if last < 2:
        return list(range(last + 1))
    kept = [0]
    anchor = cumulative_mi[0]
    for i in range(1, last):
        if cumulative_mi[i] - anchor >= min_spacing_mi:
            kept.append(i)
            anchor = cumulative_mi[i]
    kept.append(last)
    return kept


def encode_polyline(points: Sequence[LatLon], precision: int = 6) -> str:
    factor = 10**precision
    out: list[str] = []
    prev_lat = prev_lon = 0
    for p in points:
        lat, lon = round(p.lat * factor), round(p.lon * factor)
        for delta in (lat - prev_lat, lon - prev_lon):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev_lat, prev_lon = lat, lon
    return "".join(out)


def decode_polyline(encoded: str, precision: int = 6) -> list[LatLon]:
    """Decode a polyline. This runs over ~15,000 vertices per long route, so the inner loop
    reads raw bytes and keeps everything in locals; it is a hot spot on Pyodide."""
    factor = 10**precision
    data = encoded.encode("ascii")
    points: list[LatLon] = []
    append = points.append
    lat = lon = result = shift = 0
    axis = 0
    for byte in data:
        byte -= 63
        result |= (byte & 0x1F) << shift
        if byte >= 0x20:
            shift += 5
            continue
        delta = ~(result >> 1) if result & 1 else result >> 1
        result = shift = 0
        if axis == 0:
            lat += delta
            axis = 1
        else:
            lon += delta
            axis = 0
            append(LatLon(lat / factor, lon / factor))
    return points
