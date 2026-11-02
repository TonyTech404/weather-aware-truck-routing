import asyncio

import pytest

from domain.geometry import haversine_mi
from domain.models import LatLon
from services.http import UpstreamError
from services.routing import (
    NoRouteError,
    corridor_waypoints,
    fetch_routes,
    gather_with_grace,
    has_backtrack,
    overlap,
    parse_osrm_route,
    parse_valhalla_trip,
    select_routes,
    truck_weight_tonnes,
)
from tests.fakes import FakeHttp, osrm_route, straight_shape, valhalla_trip

ORIGIN, DEST = LatLon(32.0, -97.0), LatLon(33.0, -97.0)


class TestParsing:
    def test_valhalla_trip_becomes_a_truck_route_with_scaled_distance(self):
        route = parse_valhalla_trip(valhalla_trip(straight_shape(), hours=1.5, miles=70.0))
        assert route.profile == "truck" and route.source == "Valhalla"
        assert route.distance_mi == pytest.approx(70.0)
        assert route.duration_s == pytest.approx(5400)
        assert route.via == "I-35"  # direction suffix is stripped

    def test_valhalla_time_profile_follows_slow_and_fast_maneuvers(self):
        shape = straight_shape()
        half = len(shape) // 2
        trip = valhalla_trip(shape, hours=2, miles=70)
        trip["legs"][0]["maneuvers"] = [
            {"begin_shape_index": 0, "end_shape_index": half, "time": 6000, "length": 35},
            {
                "begin_shape_index": half,
                "end_shape_index": len(shape) - 1,
                "time": 1200,
                "length": 35,
            },
        ]
        trip["summary"]["time"] = 7200
        route = parse_valhalla_trip(trip)
        _, elapsed_at_midpoint = route.locate(35.0)
        assert elapsed_at_midpoint == pytest.approx(6000, rel=0.02)

    def test_valhalla_without_maneuvers_assumes_constant_speed(self):
        trip = valhalla_trip(straight_shape(), hours=1, miles=70)
        trip["legs"][0]["maneuvers"] = []
        _, elapsed = parse_valhalla_trip(trip).locate(35.0)
        assert elapsed == pytest.approx(1800, rel=0.02)

    def test_osrm_route_uses_per_segment_durations_and_is_labelled_car(self):
        route = parse_osrm_route(osrm_route(straight_shape(), hours=1.0, miles=70.0))
        assert route.profile == "car" and route.source == "OSRM"
        assert route.distance_mi == pytest.approx(70.0)
        assert route.duration_s == pytest.approx(3600)

    def test_dense_geometry_is_thinned_without_losing_endpoints(self):
        dense = straight_shape(steps=4000)  # ~0.017 mi between vertices
        route = parse_valhalla_trip(valhalla_trip(dense, hours=1, miles=69))
        assert len(route.shape) < 600
        assert route.shape[0] == dense[0] and route.shape[-1] == dense[-1]


class TestSelection:
    def make(self, lon, hours, lat1=33.0):
        shape = straight_shape(lat1=lat1, lon=lon)
        return parse_valhalla_trip(valhalla_trip(shape, hours=hours, miles=70))

    def test_identical_geometry_is_deduplicated(self):
        routes = select_routes([self.make(-97.0, 1.0), self.make(-97.0, 1.1)])
        assert len(routes) == 1

    def test_distinct_corridors_are_kept_fastest_first_and_labelled(self):
        routes = select_routes(
            [self.make(-96.0, 1.2), self.make(-97.0, 1.0), self.make(-98.0, 1.1)]
        )
        assert [r.id for r in routes] == ["r1", "r2", "r3"]
        assert [r.label for r in routes] == ["Route 1", "Route 2", "Route 3"]
        assert [round(r.duration_s) for r in routes] == [3600, 3960, 4320]

    def test_implausible_detours_are_dropped(self):
        routes = select_routes([self.make(-97.0, 1.0), self.make(-96.0, 2.0)])
        assert len(routes) == 1

    def test_at_most_three_routes(self):
        candidates = [self.make(-97.0 + i, 1.0 + i * 0.01) for i in range(6)]
        assert len(select_routes(candidates)) == 3

    def test_no_candidates_yields_no_routes(self):
        assert select_routes([]) == []

    def test_overlap_is_relative_to_the_smaller_route(self):
        assert overlap({(1, 1), (2, 2)}, {(1, 1), (2, 2), (3, 3), (4, 4)}) == 1.0
        assert overlap(set(), {(1, 1)}) == 0.0


class TestCorridorWaypoints:
    def test_waypoints_sit_either_side_of_the_midpoint(self):
        left, right = corridor_waypoints(LatLon(32.0, -97.0), LatLon(33.0, -97.0))
        assert left.lat == pytest.approx(32.5) and right.lat == pytest.approx(32.5)
        assert left.lon != right.lon
        assert (left.lon + right.lon) / 2 == pytest.approx(-97.0)
        # Offset is ~12% of the 69 mile trip.
        assert haversine_mi(left, LatLon(32.5, -97.0)) == pytest.approx(69 * 0.12, rel=0.05)

    def test_identical_points_have_no_corridor(self):
        assert corridor_waypoints(ORIGIN, ORIGIN) == []


def test_truck_weight_adds_tare_and_is_capped():
    assert truck_weight_tonnes(0) == pytest.approx(33_000 / 2204.62)
    assert truck_weight_tonnes(42_000) == pytest.approx(75_000 / 2204.62)
    assert truck_weight_tonnes(80_000) == 40.0


class TestFetchRoutes:
    async def test_short_trip_uses_truck_profile_and_passes_the_load(self):
        http = FakeHttp(valhalla=[valhalla_trip(straight_shape(), 1.0, 70)])
        result = await fetch_routes(http, ORIGIN, DEST, load_lb=42_000)
        assert (result.provider, result.profile) == ("Valhalla", "truck")
        body = http.calls[0][3]
        assert body["costing"] == "truck"
        assert body["costing_options"]["truck"]["weight"] == pytest.approx(34.02, abs=0.01)
        assert http.calls_to("https://router.project-osrm.org/route/v1/driving/") == []

    async def test_long_trip_skips_valhalla_and_discloses_car_profile(self):
        far = LatLon(40.7, -74.0)  # >1,500 km from Dallas
        http = FakeHttp(osrm=[osrm_route(straight_shape(), 1.0, 70)])
        result = await fetch_routes(http, LatLon(32.8, -96.8), far, load_lb=10_000)
        assert (result.provider, result.profile) == ("OSRM", "car")
        assert any("truck-routing service supports" in n for n in result.notes)
        assert not [c for c in http.calls if "valhalla" in c[1]]

    async def test_valhalla_outage_falls_back_to_osrm_with_a_note(self):
        http = FakeHttp(
            valhalla=UpstreamError("routing", "HTTP 503", 503),
            osrm=[osrm_route(straight_shape(), 1.0, 70)],
        )
        result = await fetch_routes(http, ORIGIN, DEST, load_lb=10_000)
        assert result.profile == "car"
        assert any("unavailable" in n for n in result.notes)

    async def test_no_truck_path_is_reported_not_silently_replaced_by_a_car_route(self):
        http = FakeHttp(valhalla=[], osrm=[osrm_route(straight_shape(), 1.0, 70)])
        with pytest.raises(NoRouteError):
            await fetch_routes(http, ORIGIN, DEST, load_lb=10_000)

    async def test_everything_down_raises_upstream_error(self):
        err = UpstreamError("routing", "HTTP 503", 503)
        http = FakeHttp(valhalla=err, osrm=err)
        with pytest.raises(UpstreamError):
            await fetch_routes(http, ORIGIN, DEST, load_lb=10_000)


class TestBacktracking:
    def test_straight_route_is_fine(self):
        route = parse_valhalla_trip(valhalla_trip(straight_shape(lat0=32, lat1=34), 2, 138))
        assert not has_backtrack(route)

    def test_spur_that_returns_along_the_same_road_is_rejected(self):
        out = straight_shape(lat0=32.0, lat1=33.0, steps=200)
        spur = [LatLon(33.0 + i * 0.003, -97.0) for i in range(1, 100)]  # ~20 mi out
        shape = (
            out + spur + list(reversed(spur)) + [LatLon(33.0, -97.0)] + straight_shape(33.0, 34.0)
        )
        route = parse_valhalla_trip(valhalla_trip(shape, 4, 220))
        assert has_backtrack(route)

    def test_short_wiggles_are_tolerated(self):
        shape = straight_shape(steps=200)
        wiggle = shape[:100] + [LatLon(p.lat, p.lon + 0.01) for p in shape[95:100]] + shape[100:]
        assert not has_backtrack(parse_valhalla_trip(valhalla_trip(wiggle, 1, 69)))

    def test_select_routes_drops_backtracking_candidates(self):
        out = straight_shape(lat0=32.0, lat1=33.0, steps=200)
        spur = [LatLon(33.0 + i * 0.003, -97.0) for i in range(1, 100)]
        bad = parse_valhalla_trip(valhalla_trip(out + spur + list(reversed(spur)), 1.0, 130))
        good = parse_valhalla_trip(valhalla_trip(straight_shape(lon=-96.0), 1.1, 70))
        routes = select_routes([bad, good])
        assert len(routes) == 1 and routes[0].duration_s == good.duration_s


class TestCachingAndDedupe:
    async def test_identical_provider_routes_are_decoded_once(self):
        trip = valhalla_trip(straight_shape(), 1.0, 70)
        http = FakeHttp(valhalla=[trip, trip])  # default + an "alternate" identical to it
        result = await fetch_routes(http, ORIGIN, DEST, load_lb=10_000)
        assert len(result.routes) == 1

    async def test_second_request_for_the_same_trip_makes_no_provider_calls(self):
        http = FakeHttp(valhalla=[valhalla_trip(straight_shape(), 1.0, 70)])
        first = await fetch_routes(http, ORIGIN, DEST, load_lb=10_000)
        calls = len(http.calls)
        second = await fetch_routes(http, ORIGIN, DEST, load_lb=10_000)
        assert second is first and len(http.calls) == calls

    async def test_a_materially_different_load_is_routed_again(self):
        http = FakeHttp(valhalla=[valhalla_trip(straight_shape(), 1.0, 70)])
        await fetch_routes(http, ORIGIN, DEST, load_lb=10_000)
        calls = len(http.calls)
        await fetch_routes(http, ORIGIN, DEST, load_lb=60_000)
        assert len(http.calls) > calls

    async def test_failures_are_not_cached(self):
        err = UpstreamError("routing", "HTTP 503", 503)
        down = FakeHttp(valhalla=err, osrm=err)
        with pytest.raises(UpstreamError):
            await fetch_routes(down, ORIGIN, DEST, load_lb=10_000)
        up = FakeHttp(valhalla=[valhalla_trip(straight_shape(), 1.0, 70)])
        assert (await fetch_routes(up, ORIGIN, DEST, load_lb=10_000)).routes


class TestGatherWithGrace:
    async def test_returns_results_in_order_and_exceptions_in_place(self):
        async def ok(value):
            return value

        async def boom():
            raise ValueError("x")

        results = await gather_with_grace([ok(1), boom(), ok(3)], grace_s=1)
        assert results[0] == 1 and results[2] == 3 and isinstance(results[1], ValueError)

    async def test_stragglers_are_abandoned_after_the_grace_period(self):
        async def fast():
            return "fast"

        async def stuck():
            await asyncio.sleep(30)

        started = asyncio.get_running_loop().time()
        results = await gather_with_grace([fast(), stuck()], grace_s=0.05)
        assert asyncio.get_running_loop().time() - started < 2
        assert results[0] == "fast" and isinstance(results[1], TimeoutError)

    async def test_waits_for_every_call_when_none_has_succeeded_yet(self):
        async def slow_fail():
            await asyncio.sleep(0.05)
            raise ValueError("late")

        results = await gather_with_grace([slow_fail(), slow_fail()], grace_s=0.01)
        assert all(isinstance(r, ValueError) for r in results)


class TestCandidatePhases:
    @staticmethod
    def three_corridors():
        return [valhalla_trip(straight_shape(lon=-97.0 + i), 1.0 + i * 0.05, 70) for i in range(3)]

    async def test_corridor_waypoints_are_skipped_when_three_routes_already_exist(self):
        http = FakeHttp(valhalla=self.three_corridors())
        result = await fetch_routes(http, ORIGIN, DEST, load_lb=10_000)
        assert len(result.routes) == 3
        valhalla_calls = [c for c in http.calls if c[1].startswith("https://valhalla")]
        assert len(valhalla_calls) == 2  # default (+alternates) and shortest
        assert not any(
            loc.get("type") == "through" for c in valhalla_calls for loc in c[3]["locations"]
        )

    async def test_corridor_waypoints_are_requested_when_fewer_than_three_exist(self):
        http = FakeHttp(valhalla=[valhalla_trip(straight_shape(), 1.0, 70)])
        await fetch_routes(http, ORIGIN, DEST, load_lb=10_000)
        valhalla_calls = [c for c in http.calls if c[1].startswith("https://valhalla")]
        assert len(valhalla_calls) == 4
        assert (
            sum(
                any(loc.get("type") == "through" for loc in c[3]["locations"])
                for c in valhalla_calls
            )
            == 2
        )
