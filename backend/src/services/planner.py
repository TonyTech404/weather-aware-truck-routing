"""Trip analysis use case: routes -> checkpoints -> forecasts -> risk -> recommendation."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from domain.errors import ValidationFailed
from domain.explain import explain
from domain.models import LatLon, RiskLevel, WeatherSample
from domain.recommend import Recommendation, recommend
from domain.risk import RiskAssessment, assess, level_for
from domain.route import Route
from domain.sampling import Checkpoint, build_checkpoints
from domain.stats import RouteStats, compute_route_stats, segment_bounds
from domain.trip import TripRequest

from .http import HttpClient
from .routing import RoutingResult, fetch_routes
from .weather import (
    ForecastSeries,
    fetch_forecasts,
    forecast_horizon_end,
    grid_key,
    lookup_timezone,
)

TIMELINE_HOURS = 48  # the forecast slider covers 0..48 hours after departure
MAX_CHECKPOINTS_PER_ROUTE = 300
MAX_DEPARTURE_AHEAD = timedelta(days=14)
MAX_DEPARTURE_PAST = timedelta(hours=2)
MIN_TRIP_MI = 1.0


@dataclass(frozen=True)
class Timeline:
    """Forecast at one place for departure + 0..48 h, as parallel lists (index = hour)."""

    levels: list[RiskLevel | None]
    wind_mph: list[float | None]
    rain_in_hr: list[float | None]
    snow_in_hr: list[float | None]


@dataclass(frozen=True)
class CheckpointResult:
    checkpoint: Checkpoint
    segment_mi: tuple[float, float]
    weather: WeatherSample | None  # forecast at the truck's ETA
    assessment: RiskAssessment
    timeline: Timeline


@dataclass(frozen=True)
class RouteAnalysis:
    route: Route
    checkpoints: list[CheckpointResult]
    stats: RouteStats


@dataclass(frozen=True)
class TripAnalysis:
    request: TripRequest
    timezone: str
    departure_utc: datetime
    horizon_end_utc: datetime
    routing: RoutingResult
    routes: list[RouteAnalysis]
    recommendation: Recommendation
    reasons: list[str]


def resolve_departure(departure: datetime, timezone: str) -> datetime:
    """Naive departures are wall-clock time at the origin; aware ones are taken as given."""
    if departure.tzinfo is None:
        departure = departure.replace(tzinfo=ZoneInfo(timezone))
    return departure.astimezone(UTC)


def validate_departure(departure_utc: datetime, now: datetime) -> None:
    if departure_utc < now - MAX_DEPARTURE_PAST:
        raise ValidationFailed({"departure": "Departure is in the past."})
    if departure_utc > now + MAX_DEPARTURE_AHEAD:
        raise ValidationFailed(
            {"departure": "Departure must be within 14 days; forecasts do not reach further."}
        )


def _timeline(series: ForecastSeries | None, departure: datetime, load_lb: float) -> Timeline:
    if series is None:
        empty: list = [None] * (TIMELINE_HOURS + 1)
        return Timeline(list(empty), list(empty), list(empty), list(empty))
    wind, rain, snow = series.hourly_window(departure, TIMELINE_HOURS)
    levels = [level_for(w, r, s, load_lb) for w, r, s in zip(wind, rain, snow, strict=True)]
    return Timeline(levels, wind, rain, snow)


def analyze_route(
    route: Route,
    checkpoints: list[Checkpoint],
    request: TripRequest,
    departure: datetime,
    forecasts: dict[tuple[float, float], ForecastSeries],
) -> RouteAnalysis:
    distances = [c.distance_mi for c in checkpoints]
    bounds = segment_bounds(distances)

    results = []
    for checkpoint, segment in zip(checkpoints, bounds, strict=True):
        series = forecasts.get(grid_key(checkpoint.position))
        weather = series.sample_at(checkpoint.eta) if series else None
        results.append(
            CheckpointResult(
                checkpoint=checkpoint,
                segment_mi=segment,
                weather=weather,
                assessment=assess(weather, request.load_lb),
                timeline=_timeline(series, departure, request.load_lb),
            )
        )
    stats = compute_route_stats(
        route.distance_mi, route.duration_s, distances, [r.assessment.level for r in results]
    )
    return RouteAnalysis(route, results, stats)


async def analyze_trip(request: TripRequest, http: HttpClient, now: datetime) -> TripAnalysis:
    routing, timezone = await asyncio.gather(
        fetch_routes(http, request.origin.point, request.destination.point, request.load_lb),
        lookup_timezone(http, request.origin.point),
    )
    departure = resolve_departure(request.departure, timezone)
    validate_departure(departure, now)

    routes = routing.routes
    if min(r.distance_mi for r in routes) < MIN_TRIP_MI:
        raise ValidationFailed({"destination": "Origin and destination are too close together."})

    planned = [
        (route, build_checkpoints(route, request.interval_mi, departure)) for route in routes
    ]
    if any(len(cps) > MAX_CHECKPOINTS_PER_ROUTE for _, cps in planned):
        raise ValidationFailed(
            {"interval_mi": "Too many checkpoints for this trip; choose a larger interval."}
        )

    points: list[LatLon] = [c.position for _, cps in planned for c in cps]
    longest = max(r.duration_s for r in routes)
    window_end = (
        departure + timedelta(seconds=max(TIMELINE_HOURS * 3600, longest)) + timedelta(hours=1)
    )
    forecasts = await fetch_forecasts(http, points, departure, window_end, now)

    analyses = [analyze_route(route, cps, request, departure, forecasts) for route, cps in planned]
    stats = {a.route.id: a.stats for a in analyses}
    recommendation = recommend([(a.route.id, a.stats) for a in analyses])
    reasons = explain(recommendation, {a.route.id: a.route.label for a in analyses}, stats)

    return TripAnalysis(
        request=request,
        timezone=timezone,
        departure_utc=departure,
        horizon_end_utc=forecast_horizon_end(now),
        routing=routing,
        routes=analyses,
        recommendation=recommendation,
        reasons=reasons,
    )
