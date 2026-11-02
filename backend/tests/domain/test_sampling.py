import itertools
from datetime import UTC, datetime, timedelta

import pytest

from domain.geometry import cumulative_distances_mi
from domain.models import LatLon
from domain.route import Route
from domain.sampling import build_checkpoints, checkpoint_distances

from .helpers import straight_route

DEPARTURE = datetime(2026, 11, 3, 14, 0, tzinfo=UTC)


class TestCheckpointDistances:
    def test_regular_interval_includes_origin_and_destination(self):
        assert checkpoint_distances(100, 25) == [0, 25, 50, 75, 100]

    def test_partial_last_interval(self):
        assert checkpoint_distances(110, 25) == [0, 25, 50, 75, 100, 110]

    def test_tail_shorter_than_a_mile_is_absorbed_by_the_destination(self):
        assert checkpoint_distances(100.5, 25) == [0, 25, 50, 75, 100.5]

    def test_route_shorter_than_interval_has_two_checkpoints(self):
        assert checkpoint_distances(7, 10) == [0, 7]

    @pytest.mark.parametrize("interval", [10, 25, 50])
    def test_supported_intervals_are_evenly_spaced(self, interval):
        distances = checkpoint_distances(500, interval)
        gaps = [b - a for a, b in itertools.pairwise(distances)]
        assert all(g == interval for g in gaps)

    @pytest.mark.parametrize(("total", "interval"), [(0, 10), (-5, 10), (100, 0)])
    def test_rejects_invalid_input(self, total, interval):
        with pytest.raises(ValueError):
            checkpoint_distances(total, interval)


class TestBuildCheckpoints:
    def test_positions_lie_on_the_route_geometry_at_the_right_mileage(self):
        route = straight_route(distance_mi=100, vertices=11)
        checkpoints = build_checkpoints(route, 25, DEPARTURE)
        # Route runs from lat 0 to lat 1.0 at constant speed: mile 25 is a quarter of the way.
        assert [round(c.position.lat, 6) for c in checkpoints] == [0.0, 0.25, 0.5, 0.75, 1.0]
        assert all(c.position.lon == -90.0 for c in checkpoints)

    def test_checkpoints_follow_a_bent_road_not_the_straight_line(self):
        shape = [LatLon(0, 0), LatLon(0, 1), LatLon(1, 1)]  # east, then north
        cum_time = [0, 3600, 7200]
        route = Route.build(
            id="bent", label="bent", via="", source="t", profile="truck",
            shape=shape, distance_mi=cumulative_distances_mi(shape)[-1], cum_time_s=cum_time,
        )  # fmt: skip
        midpoint = build_checkpoints(route, 1_000, DEPARTURE)  # forces just origin+destination
        assert len(midpoint) == 2
        half = route.distance_mi / 2
        position, _ = route.locate(half)
        # Halfway along the road is the corner, which is off the origin-destination chord.
        assert position.lat == pytest.approx(0, abs=1e-6)
        assert position.lon == pytest.approx(1, abs=1e-6)

    def test_eta_uses_the_time_profile_not_a_constant_speed(self):
        shape = [LatLon(0, 0), LatLon(0.5, 0), LatLon(1, 0)]
        # First half of the road is slow (3h), second half fast (1h).
        route = Route.build(
            id="r", label="r", via="", source="t", profile="truck",
            shape=shape, distance_mi=100, cum_time_s=[0, 3 * 3600, 4 * 3600],
        )  # fmt: skip
        checkpoints = build_checkpoints(route, 25, DEPARTURE)
        assert [c.elapsed_s for c in checkpoints] == pytest.approx(
            [0, 1.5 * 3600, 3 * 3600, 3.5 * 3600, 4 * 3600]
        )
        assert checkpoints[1].eta == DEPARTURE + timedelta(hours=1.5)

    def test_kinds_and_indices(self):
        checkpoints = build_checkpoints(straight_route(), 25, DEPARTURE)
        assert [c.kind for c in checkpoints] == [
            "origin", "waypoint", "waypoint", "waypoint", "destination",
        ]  # fmt: skip
        assert [c.index for c in checkpoints] == list(range(5))

    def test_eta_is_timezone_aware_utc(self):
        checkpoints = build_checkpoints(straight_route(), 50, DEPARTURE)
        assert checkpoints[-1].eta == DEPARTURE + timedelta(seconds=6000)
        assert checkpoints[-1].eta.utcoffset() == timedelta(0)

    def test_distance_is_scaled_to_the_provider_total(self):
        route = straight_route(distance_mi=123.4)
        assert route.distance_mi == pytest.approx(123.4)
        assert build_checkpoints(route, 25, DEPARTURE)[-1].distance_mi == pytest.approx(123.4)

    def test_naive_departure_is_rejected(self):
        with pytest.raises(ValueError):
            build_checkpoints(straight_route(), 25, datetime(2026, 11, 3, 14, 0))
