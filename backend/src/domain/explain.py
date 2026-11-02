"""Plain-language reasons for a route recommendation."""

from __future__ import annotations

from .recommend import Recommendation
from .stats import RouteStats

_DECISION = {
    "no_travel_mi": "it crosses the fewest No Travel miles",
    "severe_mi": "it has the fewest Severe miles",
    "high_mi": "Severe miles are tied and it has the fewest High-risk miles",
    "avg_risk": "Severe and High miles are tied and it has the lowest average risk",
    "duration_s": "weather risk is tied on every measure and it is the fastest",
}


def format_miles(miles: float) -> str:
    return f"{miles:.0f} mi" if miles >= 10 else f"{miles:.1f} mi"


def format_duration(seconds: float) -> str:
    hours, minutes = divmod(round(seconds / 60), 60)
    return f"{hours} h {minutes:02d} min" if hours else f"{minutes} min"


def _value(key: str, stats: RouteStats) -> str:
    match key:
        case "no_travel_mi":
            return format_miles(stats.no_travel_mi)
        case "severe_mi":
            return format_miles(stats.severe_mi)
        case "high_mi":
            return format_miles(stats.high_mi)
        case "avg_risk":
            return "n/a" if stats.avg_risk is None else f"{stats.avg_risk:.3f}"
        case _:
            return format_duration(stats.duration_s)


def explain(
    recommendation: Recommendation,
    labels: dict[str, str],
    stats: dict[str, RouteStats],
) -> list[str]:
    status, best_id = recommendation.status, recommendation.route_id
    if best_id is None:
        return ["No route could be generated for these locations."]

    best, best_label = stats[best_id], labels[best_id]
    if status == "all_prohibited":
        return [
            "Every route crosses No Travel conditions at this departure time and load. "
            f"{best_label} crosses the least ({format_miles(best.no_travel_mi)}) but is not safe "
            "to drive. Try a later departure, or scrub the forecast slider to find a window."
        ]
    if status == "single_route":
        return [f"Only one route was available, so {best_label} is the only option."]

    runner_up_id = recommendation.rankings[1].route_id
    runner_up, runner_label = stats[runner_up_id], labels[runner_up_id]
    key = recommendation.decided_by
    if key is None:
        reasons = [
            f"{best_label} is recommended. The routes are equivalent on weather risk and "
            "travel time, so the first was kept."
        ]
    else:
        reasons = [
            f"{best_label} is recommended: {_DECISION[key]} "
            f"({_value(key, best)} vs {_value(key, runner_up)} on {runner_label})."
        ]

    reasons += [
        f"{labels[r.route_id]} is excluded: it crosses "
        f"{format_miles(stats[r.route_id].no_travel_mi)} of No Travel conditions."
        for r in recommendation.rankings
        if r.prohibited
    ]
    return reasons
