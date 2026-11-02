"""Turn analysis results into the JSON contract documented in docs/api.md."""

from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

from domain.geometry import encode_polyline
from domain.models import RiskLevel, WeatherSample
from domain.recommend import CRITERIA
from domain.risk import RiskAssessment
from services.planner import TIMELINE_HOURS, CheckpointResult, RouteAnalysis, TripAnalysis
from services.routing import TRUCK_DIMENSIONS, TRUCK_TARE_LB


def _slug(level: RiskLevel | None) -> str | None:
    return level.slug if level is not None else None


def _iso(when) -> str:
    return when.strftime("%Y-%m-%dT%H:%M:%SZ")


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def serialize_weather(sample: WeatherSample | None) -> dict | None:
    if sample is None:
        return None
    return {
        "wind_mph": _round(sample.wind_mph, 1),
        "gust_mph": _round(sample.gust_mph, 1),
        "rain_in_hr": _round(sample.rain_in_hr, 2),
        "snow_in_hr": _round(sample.snow_in_hr, 2),
    }


def serialize_risk(assessment: RiskAssessment) -> dict:
    level = assessment.level
    return {
        "level": _slug(level),
        "label": level.label if level is not None else "No forecast",
        "score": int(level) if level is not None else None,
        "drivers": list(assessment.drivers),
        "hazards": {
            "wind": _slug(assessment.wind),
            "rain": _slug(assessment.rain),
            "snow": _slug(assessment.snow),
        },
        "load_rule": assessment.load_rule,
    }


def serialize_checkpoint(result: CheckpointResult) -> dict:
    cp = result.checkpoint
    timeline = result.timeline
    return {
        "index": cp.index,
        "kind": cp.kind,
        "mile": round(cp.distance_mi, 2),
        "lat": round(cp.position.lat, 5),
        "lon": round(cp.position.lon, 5),
        "eta": _iso(cp.eta),
        "elapsed_s": round(cp.elapsed_s),
        "segment_mi": [round(result.segment_mi[0], 2), round(result.segment_mi[1], 2)],
        "weather": serialize_weather(result.weather),
        "risk": serialize_risk(result.assessment),
        # Index h is the forecast at departure + h hours, for the 0-48 h slider.
        "timeline": {
            "levels": [None if level is None else int(level) for level in timeline.levels],
            "wind_mph": [None if v is None else round(v, 1) for v in timeline.wind_mph],
            "rain_in_hr": [None if v is None else round(v, 2) for v in timeline.rain_in_hr],
            "snow_in_hr": [None if v is None else round(v, 2) for v in timeline.snow_in_hr],
        },
    }


def serialize_route(analysis: RouteAnalysis, ranking, departure) -> dict:
    route, stats = analysis.route, analysis.stats
    miles = {level.slug: round(m, 2) for level, m in stats.miles_by_level.items()}
    miles["unknown"] = round(stats.unknown_mi, 2)
    return {
        "id": route.id,
        "label": route.label,
        "via": route.via,
        "source": route.source,
        "profile": route.profile,
        "distance_mi": round(route.distance_mi, 1),
        "duration_s": round(route.duration_s),
        "arrival": _iso(departure + timedelta(seconds=route.duration_s)),
        "geometry": encode_polyline(route.shape, precision=5),
        "stats": {
            "miles": miles,
            "avg_risk": _round(stats.avg_risk, 3),
            "peak_level": _slug(stats.peak_level),
            "no_travel_segments": [[round(a, 2), round(b, 2)] for a, b in stats.no_travel_segments],
        },
        "ranking": {
            "rank": ranking.rank,
            "prohibited": ranking.prohibited,
            "values": {
                key: value for (key, _, _), value in zip(CRITERIA, ranking.values, strict=True)
            },
        },
        "checkpoints": [serialize_checkpoint(c) for c in analysis.checkpoints],
    }


def serialize_analysis(analysis: TripAnalysis) -> dict:
    request = analysis.request
    rankings = {r.route_id: r for r in analysis.recommendation.rankings}
    origin_zone = ZoneInfo(analysis.timezone)
    local_departure = analysis.departure_utc.astimezone(origin_zone)
    return {
        "request": {
            "origin": {
                "label": request.origin.label,
                "lat": request.origin.point.lat,
                "lon": request.origin.point.lon,
            },
            "destination": {
                "label": request.destination.label,
                "lat": request.destination.point.lat,
                "lon": request.destination.point.lon,
            },
            "load_lb": request.load_lb,
            "interval_mi": request.interval_mi,
            "departure_utc": _iso(analysis.departure_utc),
            "departure_local": local_departure.isoformat(),
            "timezone": analysis.timezone,
        },
        "routes": [
            serialize_route(a, rankings[a.route.id], analysis.departure_utc)
            for a in analysis.routes
        ],
        "recommendation": {
            "status": analysis.recommendation.status,
            "route_id": analysis.recommendation.route_id,
            "decided_by": analysis.recommendation.decided_by,
            "reasons": analysis.reasons,
            "criteria": [{"key": k, "label": label, "unit": unit} for k, label, unit in CRITERIA],
        },
        "meta": {
            "timeline_hours": TIMELINE_HOURS,
            "horizon_end_utc": _iso(analysis.horizon_end_utc),
            "routing": {
                "provider": analysis.routing.provider,
                "profile": analysis.routing.profile,
                "notes": analysis.routing.notes,
            },
            "weather": {"provider": "Open-Meteo", "sampling": "nearest forecast hour to each ETA"},
            "vehicle_assumptions": {
                "tare_lb": TRUCK_TARE_LB,
                "height_m": TRUCK_DIMENSIONS["height"],
                "width_m": TRUCK_DIMENSIONS["width"],
                "length_m": TRUCK_DIMENSIONS["length"],
            },
        },
    }
