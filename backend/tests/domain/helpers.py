"""Builders for deterministic test routes."""

from domain.models import LatLon
from domain.route import Route


def straight_route(distance_mi=100.0, duration_s=6000.0, vertices=11, id="r1") -> Route:
    """A north-south route with evenly spaced vertices and constant speed."""
    shape = [LatLon(i * 0.1, -90.0) for i in range(vertices)]
    cum_time = [duration_s * i / (vertices - 1) for i in range(vertices)]
    return Route.build(
        id=id, label=id, via="Test Rd", source="test", profile="truck",
        shape=shape, distance_mi=distance_mi, cum_time_s=cum_time,
    )  # fmt: skip
