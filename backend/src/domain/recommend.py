"""Route ranking: strict lexicographic order over the assessment's priorities.

Priorities (assessment): fewest Severe miles, fewest High miles, lowest average risk,
shortest travel time. There is no weighted score, so a route can never "buy back"
Severe miles with speed.

Interpretation for No Travel: the assessment does not rank it, but a route through a
No Travel segment is prohibited, so it is compared first (fewest No Travel miles). A
route with any No Travel miles is never recommended as safe; if every route has some,
the status is "all_prohibited" and the least-bad route is reported as such.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .stats import RouteStats

# (key, label, unit) in comparison order.
CRITERIA = (
    ("no_travel_mi", "No Travel miles", "mi"),
    ("severe_mi", "Severe miles", "mi"),
    ("high_mi", "High-risk miles", "mi"),
    ("avg_risk", "Average risk", "score"),
    ("duration_s", "Travel time", "s"),
)

# Unknown average risk (no forecast anywhere on the route) sorts after any known value.
_UNKNOWN_AVG = 99.0


def criterion_values(stats: RouteStats) -> tuple[float, ...]:
    """Raw comparison values, rounded only to remove floating-point noise."""
    return (
        round(stats.no_travel_mi, 2),
        round(stats.severe_mi, 2),
        round(stats.high_mi, 2),
        round(stats.avg_risk if stats.avg_risk is not None else _UNKNOWN_AVG, 3),
        round(stats.duration_s),
    )


@dataclass(frozen=True)
class Ranking:
    route_id: str
    rank: int  # 1 = best
    values: tuple[float, ...]
    prohibited: bool


@dataclass(frozen=True)
class Recommendation:
    status: str  # "recommended" | "all_prohibited" | "single_route" | "no_routes"
    route_id: str | None
    decided_by: str | None  # criterion key that separated the winner from the runner-up
    rankings: tuple[Ranking, ...]


def recommend(stats_by_route: Sequence[tuple[str, RouteStats]]) -> Recommendation:
    if not stats_by_route:
        return Recommendation("no_routes", None, None, ())

    scored = sorted(
        ((criterion_values(stats), route_id) for route_id, stats in stats_by_route),
        key=lambda item: item[0],  # tuple comparison is lexicographic; ties keep input order
    )
    rankings = tuple(
        Ranking(route_id, rank, values, prohibited=values[0] > 0)
        for rank, (values, route_id) in enumerate(scored, start=1)
    )

    best = rankings[0]
    decided_by = None
    if len(rankings) > 1:
        runner_up = rankings[1]
        for (key, _, _), a, b in zip(CRITERIA, best.values, runner_up.values, strict=True):
            if a != b:
                decided_by = key
                break

    if best.prohibited:
        status = "all_prohibited"
    elif len(rankings) == 1:
        status = "single_route"
    else:
        status = "recommended"
    return Recommendation(status, best.route_id, decided_by, rankings)
