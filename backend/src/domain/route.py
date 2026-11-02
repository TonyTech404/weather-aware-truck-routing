"""A routable path with distance and time profiles along its real road geometry."""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass

from .geometry import cumulative_distances_mi
from .models import LatLon


@dataclass(frozen=True)
class Route:
    id: str
    label: str
    via: str  # human summary of the main roads, e.g. "I-20 E, I-85 N"
    source: str  # routing provider
    profile: str  # "truck" or "car"
    shape: tuple[LatLon, ...]
    cum_dist_mi: tuple[float, ...]  # distance along the road at each vertex
    cum_time_s: tuple[float, ...]  # elapsed driving time at each vertex

    @classmethod
    def build(
        cls,
        *,
        id: str,
        label: str,
        via: str,
        source: str,
        profile: str,
        shape: Sequence[LatLon],
        distance_mi: float,
        cum_time_s: Sequence[float],
    ) -> Route:
        """Create a route whose cumulative distances are scaled to the provider's total.

        The decoded shape is a rounded approximation of the road, so its summed
        great-circle length differs slightly from the provider's reported distance.
        Scaling keeps checkpoint mileage consistent with the number shown to the user.
        """
        if len(shape) < 2 or len(shape) != len(cum_time_s):
            raise ValueError("shape needs at least two vertices and one time per vertex")
        geometric = cumulative_distances_mi(shape)
        scale = distance_mi / geometric[-1] if geometric[-1] > 0 else 0.0
        return cls(
            id=id,
            label=label,
            via=via,
            source=source,
            profile=profile,
            shape=tuple(shape),
            cum_dist_mi=tuple(d * scale for d in geometric),
            cum_time_s=tuple(cum_time_s),
        )

    @property
    def distance_mi(self) -> float:
        return self.cum_dist_mi[-1]

    @property
    def duration_s(self) -> float:
        return self.cum_time_s[-1]

    def locate(self, distance_mi: float) -> tuple[LatLon, float]:
        """Position and elapsed seconds after driving `distance_mi` along the road."""
        if distance_mi <= 0:
            return self.shape[0], self.cum_time_s[0]
        if distance_mi >= self.distance_mi:
            return self.shape[-1], self.cum_time_s[-1]
        i = bisect_right(self.cum_dist_mi, distance_mi) - 1
        span = self.cum_dist_mi[i + 1] - self.cum_dist_mi[i]
        f = (distance_mi - self.cum_dist_mi[i]) / span if span > 0 else 0.0
        a, b = self.shape[i], self.shape[i + 1]
        position = LatLon(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f)
        elapsed = self.cum_time_s[i] + (self.cum_time_s[i + 1] - self.cum_time_s[i]) * f
        return position, elapsed
