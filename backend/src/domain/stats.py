"""Route-level risk statistics, weighted by distance."""

from __future__ import annotations

import itertools
from collections.abc import Sequence
from dataclasses import dataclass

from .models import RiskLevel


def segment_bounds(distances: Sequence[float]) -> list[tuple[float, float]]:
    """The stretch of road each checkpoint is taken to represent.

    A checkpoint covers the road halfway to its neighbours on each side; the first and
    last checkpoints cover the road out to the origin and destination. The segments
    tile [0, total] exactly, so per-level miles always sum to the route length.
    """
    edges = [distances[0]]
    edges += [(a + b) / 2 for a, b in itertools.pairwise(distances)]
    edges.append(distances[-1])
    return list(itertools.pairwise(edges))


@dataclass(frozen=True)
class RouteStats:
    distance_mi: float
    duration_s: float
    miles_by_level: dict[RiskLevel, float]
    unknown_mi: float  # road with no forecast available
    avg_risk: float | None  # distance-weighted mean of level 0-4 over known road
    peak_level: RiskLevel | None
    no_travel_segments: tuple[tuple[float, float], ...]  # (start_mi, end_mi)

    @property
    def severe_mi(self) -> float:
        return self.miles_by_level[RiskLevel.SEVERE]

    @property
    def high_mi(self) -> float:
        return self.miles_by_level[RiskLevel.HIGH]

    @property
    def no_travel_mi(self) -> float:
        return self.miles_by_level[RiskLevel.NO_TRAVEL]


def compute_route_stats(
    distance_mi: float,
    duration_s: float,
    distances: Sequence[float],
    levels: Sequence[RiskLevel | None],
) -> RouteStats:
    if len(distances) != len(levels):
        raise ValueError("one level per checkpoint is required")
    miles = {level: 0.0 for level in RiskLevel}
    unknown = 0.0
    no_travel: list[list[float]] = []

    for (start, end), level in zip(segment_bounds(distances), levels, strict=True):
        length = end - start
        if level is None:
            unknown += length
            continue
        miles[level] += length
        if level == RiskLevel.NO_TRAVEL:
            if no_travel and abs(no_travel[-1][1] - start) < 1e-9:
                no_travel[-1][1] = end
            else:
                no_travel.append([start, end])

    known = sum(miles.values())
    avg = sum(int(level) * m for level, m in miles.items()) / known if known > 0 else None
    seen = [level for level in levels if level is not None]
    return RouteStats(
        distance_mi=distance_mi,
        duration_s=duration_s,
        miles_by_level=miles,
        unknown_mi=unknown,
        avg_risk=avg,
        peak_level=max(seen) if seen else None,
        no_travel_segments=tuple((a, b) for a, b in no_travel),
    )
