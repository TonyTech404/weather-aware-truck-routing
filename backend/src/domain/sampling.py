"""Distance-based checkpoint placement along a route, with arrival times."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .models import LatLon
from .route import Route

ALLOWED_INTERVALS_MI = (10, 25, 50)
# An interior checkpoint closer than this to the destination adds nothing; the
# destination checkpoint covers it.
MIN_TAIL_MI = 1.0


@dataclass(frozen=True)
class Checkpoint:
    index: int
    kind: str  # "origin" | "waypoint" | "destination"
    distance_mi: float
    position: LatLon
    elapsed_s: float
    eta: datetime  # timezone-aware UTC


def checkpoint_distances(total_mi: float, interval_mi: float) -> list[float]:
    """Mileposts at 0, interval, 2*interval, ... plus the destination at `total_mi`."""
    if interval_mi <= 0:
        raise ValueError("interval must be positive")
    if total_mi <= 0:
        raise ValueError("route length must be positive")
    distances = [0.0]
    d = float(interval_mi)
    while d < total_mi - MIN_TAIL_MI:
        distances.append(d)
        d += interval_mi
    distances.append(total_mi)
    return distances


def build_checkpoints(route: Route, interval_mi: float, departure: datetime) -> list[Checkpoint]:
    """Place checkpoints by distance along the road geometry and compute each ETA.

    `departure` must be timezone-aware. Elapsed time comes from the provider's
    per-vertex driving-time profile, so ETAs reflect road speeds rather than a
    constant average.
    """
    if departure.tzinfo is None:
        raise ValueError("departure must be timezone-aware")
    distances = checkpoint_distances(route.distance_mi, interval_mi)
    checkpoints = []
    for i, d in enumerate(distances):
        position, elapsed = route.locate(d)
        kind = "origin" if i == 0 else "destination" if i == len(distances) - 1 else "waypoint"
        checkpoints.append(
            Checkpoint(i, kind, d, position, elapsed, departure + timedelta(seconds=elapsed))
        )
    return checkpoints
