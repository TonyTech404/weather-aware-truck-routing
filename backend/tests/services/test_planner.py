from datetime import UTC, datetime, timedelta

import pytest

from domain.errors import ValidationFailed
from domain.models import LatLon, RiskLevel
from domain.trip import PlaceInput, TripRequest
from services.planner import analyze_trip, resolve_departure, validate_departure
from tests.fakes import FakeHttp, calm, straight_shape, valhalla_trip

NOW = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
ORIGIN, DEST = PlaceInput("A", LatLon(32.0, -97.0)), PlaceInput("B", LatLon(33.0, -97.0))


def trip(load=20_000, interval=25, departure=None, **kw):
    departure = departure or (NOW + timedelta(hours=2)).replace(tzinfo=None)
    return TripRequest(ORIGIN, DEST, departure, load, interval, **kw)


def two_routes():
    # Same endpoints, different corridors (lon) so the planner keeps both.
    return [
        valhalla_trip(straight_shape(lon=-97.0), hours=1.0, miles=69),
        valhalla_trip(straight_shape(lon=-96.0), hours=1.1, miles=70),
    ]


class TestDeparture:
    def test_naive_time_is_local_to_the_origin_timezone(self):
        dep = resolve_departure(datetime(2026, 11, 3, 8, 0), "America/Chicago")
        assert dep == datetime(2026, 11, 3, 14, 0, tzinfo=UTC)  # CST, UTC-6

    def test_dst_offset_is_applied_for_the_departure_date(self):
        summer = resolve_departure(datetime(2026, 7, 1, 8, 0), "America/Chicago")
        assert summer == datetime(2026, 7, 1, 13, 0, tzinfo=UTC)  # CDT, UTC-5

    def test_aware_time_is_used_as_given(self):
        aware = datetime(2026, 11, 3, 8, 0, tzinfo=UTC)
        assert resolve_departure(aware, "Asia/Manila") == aware

    def test_window_validation(self):
        validate_departure(NOW, NOW)
        validate_departure(NOW - timedelta(hours=1), NOW)
        validate_departure(NOW + timedelta(days=14), NOW)
        with pytest.raises(ValidationFailed, match="past"):
            validate_departure(NOW - timedelta(hours=3), NOW)
        with pytest.raises(ValidationFailed, match="14 days"):
            validate_departure(NOW + timedelta(days=14, hours=1), NOW)


class TestAnalyzeTrip:
    async def test_checkpoints_carry_eta_weather_and_a_49_hour_timeline(self):
        http = FakeHttp(valhalla=two_routes())
        result = await analyze_trip(trip(), http, NOW)
        route = result.routes[0]
        first, last = route.checkpoints[0], route.checkpoints[-1]
        assert first.checkpoint.kind == "origin" and last.checkpoint.kind == "destination"
        assert last.checkpoint.eta - first.checkpoint.eta == timedelta(
            seconds=route.route.duration_s
        )
        assert first.weather.wind_mph == 5.0
        assert len(first.timeline) == 49
        assert result.timezone == "America/Chicago"

    async def test_weather_is_read_at_each_checkpoint_eta_not_at_departure(self):
        # Storm at the destination only after hour 1 of the trip.
        departure = (NOW + timedelta(hours=2)).replace(tzinfo=None)

        def storm_late(lat, lon, epoch):
            hours_in = (epoch - (NOW + timedelta(hours=2)).timestamp()) / 3600
            return (60.0, 70.0, 0, 0, 0) if hours_in >= 1 else calm(lat, lon, epoch)

        http = FakeHttp(valhalla=two_routes(), weather=storm_late, timezone="UTC")
        result = await analyze_trip(trip(departure=departure), http, NOW)
        cps = result.routes[0].checkpoints
        assert cps[0].assessment.level == RiskLevel.LOW  # leaves before the storm
        assert cps[-1].assessment.level == RiskLevel.NO_TRAVEL  # arrives during it

    async def test_load_weight_changes_risk_for_the_same_forecast(self):
        def gusty(lat, lon, epoch):
            return (47.0, 60.0, 0, 0, 0)  # Severe-band wind

        http = FakeHttp(valhalla=two_routes(), weather=gusty)
        light = await analyze_trip(trip(load=20_000), http, NOW)
        heavy = await analyze_trip(trip(load=35_000), http, NOW)
        assert light.routes[0].checkpoints[0].assessment.level == RiskLevel.SEVERE
        assert heavy.routes[0].checkpoints[0].assessment.level == RiskLevel.NO_TRAVEL
        assert heavy.routes[0].checkpoints[0].assessment.load_rule

    async def test_second_analysis_with_a_new_load_reuses_cached_forecasts(self):
        http = FakeHttp(valhalla=two_routes())
        await analyze_trip(trip(load=10_000), http, NOW)
        before = len(http.calls_to("https://api.open-meteo.com/v1/forecast"))
        await analyze_trip(trip(load=45_000), http, NOW)
        after = len(http.calls_to("https://api.open-meteo.com/v1/forecast"))
        assert after == before  # forecasts (and the timezone) came from cache

    async def test_recommendation_avoids_the_route_with_severe_weather(self):
        def storm_on_east_corridor(lat, lon, epoch):
            return (50.0, 60.0, 0, 0, 0) if lon > -96.5 else calm(lat, lon, epoch)

        http = FakeHttp(valhalla=two_routes(), weather=storm_on_east_corridor)
        result = await analyze_trip(trip(load=10_000), http, NOW)
        assert result.recommendation.route_id == "r1"  # western, calm corridor
        assert result.recommendation.decided_by == "severe_mi"

    async def test_no_travel_route_is_not_recommended_over_a_viable_one(self):
        def blocked_east(lat, lon, epoch):
            return (60.0, 70.0, 0, 0, 0) if lon > -96.5 else calm(lat, lon, epoch)

        routes = list(reversed(two_routes()))  # east route is faster-listed but blocked
        routes[0] = valhalla_trip(straight_shape(lon=-96.0), hours=0.8, miles=69)
        http = FakeHttp(valhalla=routes, weather=blocked_east)
        result = await analyze_trip(trip(), http, NOW)
        assert result.recommendation.status == "recommended"
        winner = next(a for a in result.routes if a.route.id == result.recommendation.route_id)
        assert winner.stats.no_travel_mi == 0
        assert any(reason.startswith("Excluded") for reason in result.reasons)

    async def test_all_routes_blocked_is_reported_honestly(self):
        http = FakeHttp(valhalla=two_routes(), weather=lambda *a: (60.0, 70.0, 0, 0, 0))
        result = await analyze_trip(trip(), http, NOW)
        assert result.recommendation.status == "all_prohibited"
        assert "not safe" in result.reasons[0]

    async def test_forecast_gap_beyond_the_horizon_is_unknown_not_safe(self):
        # Departs inside the 14-day limit, but the 30 h drive arrives past the 15-day horizon.
        departure = (NOW + timedelta(days=13, hours=22)).replace(tzinfo=None)
        slow = [valhalla_trip(straight_shape(), hours=30.0, miles=69)]
        http = FakeHttp(valhalla=slow, timezone="UTC")
        result = await analyze_trip(trip(departure=departure), http, NOW)
        levels = [c.assessment.level for c in result.routes[0].checkpoints]
        assert levels[0] is not None and levels[-1] is None
        assert 0 < result.routes[0].stats.unknown_mi < result.routes[0].route.distance_mi
        assert result.routes[0].checkpoints[0].timeline[-1].level is None  # slider hour 48

    async def test_validation_errors_surface_before_any_weather_fetch(self):
        http = FakeHttp(valhalla=two_routes())
        past = (NOW - timedelta(days=2)).replace(tzinfo=None)
        with pytest.raises(ValidationFailed):
            await analyze_trip(trip(departure=past), http, NOW)
        assert http.calls_to("https://api.open-meteo.com/v1/forecast")[1:] == []

    async def test_excessive_checkpoint_count_asks_for_a_larger_interval(self):
        long_route = valhalla_trip(straight_shape(lat0=30.0, lat1=33.0), hours=3.0, miles=6_000)
        http = FakeHttp(valhalla=[long_route])
        with pytest.raises(ValidationFailed) as exc:
            await analyze_trip(trip(interval=10), http, NOW)
        assert "interval_mi" in exc.value.fields
