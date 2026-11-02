from datetime import UTC, datetime, timedelta

import pytest

from domain.models import LatLon
from services import weather
from services.http import UpstreamError
from services.weather import (
    ForecastSeries,
    fetch_forecasts,
    forecast_horizon_end,
    grid_key,
    lookup_timezone,
    parse_forecasts,
)
from tests.fakes import FakeHttp, calm

NOW = datetime(2026, 11, 3, 12, 30, tzinfo=UTC)
T0 = datetime(2026, 11, 3, 14, 0, tzinfo=UTC)


def series(**overrides):
    values = dict(
        start_epoch=int(T0.timestamp()),
        wind=(10.0, 20.0, 30.0),
        gust=(12.0, 25.0, 40.0),
        rain=(0.0, 0.1, 0.3),
        snow=(0.0, 0.0, 1.0),
    )
    values.update(overrides)
    return ForecastSeries(**values)


class TestSampling:
    def test_exact_hour(self):
        sample = series().sample_at(T0 + timedelta(hours=1))
        assert (sample.wind_mph, sample.rain_in_hr, sample.gust_mph) == (20.0, 0.1, 25.0)

    def test_nearest_hour_rounds_half_up(self):
        s = series()
        assert s.sample_at(T0 + timedelta(minutes=29)).wind_mph == 10.0
        assert s.sample_at(T0 + timedelta(minutes=30)).wind_mph == 20.0
        assert s.sample_at(T0 + timedelta(minutes=89)).wind_mph == 20.0
        assert s.sample_at(T0 + timedelta(minutes=90)).wind_mph == 30.0

    def test_outside_the_window_is_unknown_not_clamped(self):
        s = series()
        assert s.sample_at(T0 - timedelta(hours=1)) is None
        assert s.sample_at(T0 + timedelta(hours=3)) is None

    def test_hour_with_no_measurements_is_unknown(self):
        empty = series(wind=(None,), gust=(None,), rain=(None,), snow=(None,))
        assert empty.sample_at(T0) is None

    def test_covers(self):
        s = series()
        assert s.covers(T0, T0 + timedelta(hours=2))
        assert not s.covers(T0, T0 + timedelta(hours=3))


class TestHourlyWindow:
    @pytest.mark.parametrize("offset_minutes", [-300, -90, -30, 0, 29, 30, 61, 100, 119, 120, 600])
    def test_matches_sample_at_for_every_hour(self, offset_minutes):
        s = series(
            wind=(10.0, None, 30.0, 40.0),
            gust=(1.0,) * 4,
            rain=(0.0, 0.1, None, 0.3),
            snow=(None, 0.0, 1.0, 2.0),
        )
        start = T0 + timedelta(minutes=offset_minutes)
        wind, rain, snow = s.hourly_window(start, 6)
        assert len(wind) == len(rain) == len(snow) == 7
        for hour in range(7):
            sample = s.sample_at(start + timedelta(hours=hour))
            expected = (
                (None, None, None)
                if sample is None
                else (sample.wind_mph, sample.rain_in_hr, sample.snow_in_hr)
            )
            assert (wind[hour], rain[hour], snow[hour]) == expected

    def test_window_entirely_outside_is_all_unknown(self):
        wind, rain, snow = series().hourly_window(T0 + timedelta(days=3), 4)
        assert wind == rain == snow == [None] * 5


class TestParsing:
    def payload(self, **hourly):
        base = {"time": [0, 3600], "wind_speed_10m": [1.0, 2.0], "wind_gusts_10m": [3.0, 4.0],
                "rain": [0.1, None], "showers": [0.05, None], "snowfall": [0.0, 0.2]}  # fmt: skip
        return {"hourly": {**base, **hourly}}

    def test_rain_and_showers_are_summed(self):
        (parsed,) = parse_forecasts(self.payload())
        assert parsed.rain == (pytest.approx(0.15), None)

    def test_single_object_and_list_are_both_accepted(self):
        assert len(parse_forecasts(self.payload())) == 1
        assert len(parse_forecasts([self.payload(), self.payload()])) == 2

    def test_nan_becomes_missing(self):
        (parsed,) = parse_forecasts(self.payload(wind_speed_10m=[float("nan"), 2.0]))
        assert parsed.wind == (None, 2.0)

    def test_empty_or_gappy_hours_are_rejected(self):
        with pytest.raises(UpstreamError):
            parse_forecasts({"hourly": {}})
        with pytest.raises(UpstreamError):
            parse_forecasts(self.payload(time=[0, 7200]))


class TestFetchForecasts:
    async def test_batches_locations_into_one_request_with_utc_hour_window(self):
        http = FakeHttp()
        points = [LatLon(32.0 + i * 0.1, -97.0) for i in range(5)]
        result = await fetch_forecasts(http, points, T0, T0 + timedelta(hours=5), NOW)
        assert len(result) == 5
        (call,) = http.calls_to(weather.FORECAST_URL)
        params = call[2]
        assert params["timezone"] == "UTC" and params["timeformat"] == "unixtime"
        assert params["wind_speed_unit"] == "mph" and params["precipitation_unit"] == "inch"
        assert (
            params["start_hour"] == "2026-11-03T14:00" and params["end_hour"] == "2026-11-03T19:00"
        )

    async def test_more_than_a_chunk_is_split_into_concurrent_requests(self):
        http = FakeHttp()
        points = [LatLon(30.0 + i * 0.01, -97.0) for i in range(250)]
        await fetch_forecasts(http, points, T0, T0 + timedelta(hours=2), NOW)
        assert len(http.calls_to(weather.FORECAST_URL)) == 3

    async def test_nearby_points_share_a_grid_cell(self):
        http = FakeHttp()
        points = [LatLon(32.0001, -97.0001), LatLon(32.0004, -97.0003)]
        assert grid_key(points[0]) == grid_key(points[1])
        result = await fetch_forecasts(http, points, T0, T0 + timedelta(hours=1), NOW)
        assert len(result) == 1

    async def test_repeat_requests_are_served_from_cache(self):
        http = FakeHttp()
        points = [LatLon(32.0, -97.0)]
        await fetch_forecasts(http, points, T0, T0 + timedelta(hours=5), NOW)
        await fetch_forecasts(http, points, T0, T0 + timedelta(hours=5), NOW)
        assert len(http.calls_to(weather.FORECAST_URL)) == 1

    async def test_window_is_clamped_to_the_provider_horizon(self):
        http = FakeHttp()
        late = NOW + timedelta(days=14, hours=20)
        result = await fetch_forecasts(
            http, [LatLon(32.0, -97.0)], late, late + timedelta(hours=60), NOW
        )
        end = http.calls_to(weather.FORECAST_URL)[0][2]["end_hour"]
        assert end == forecast_horizon_end(NOW).strftime("%Y-%m-%dT%H:%M")
        (s,) = result.values()
        assert s.sample_at(late + timedelta(hours=40)) is None  # past the horizon: unknown

    async def test_window_entirely_beyond_the_horizon_fetches_nothing(self):
        http = FakeHttp()
        start = NOW + timedelta(days=20)
        assert (
            await fetch_forecasts(
                http, [LatLon(32.0, -97.0)], start, start + timedelta(hours=5), NOW
            )
            == {}
        )
        assert http.calls == []

    async def test_provider_failure_propagates(self):
        http = FakeHttp(weather_error=UpstreamError("weather", "HTTP 429", 429))
        with pytest.raises(UpstreamError):
            await fetch_forecasts(http, [LatLon(32.0, -97.0)], T0, T0 + timedelta(hours=2), NOW)


async def test_timezone_lookup_is_cached():
    http = FakeHttp(timezone="America/Denver")
    assert await lookup_timezone(http, LatLon(39.7, -104.9)) == "America/Denver"
    assert await lookup_timezone(http, LatLon(39.71, -104.92)) == "America/Denver"
    assert len(http.calls) == 1


def test_calm_weather_fixture_is_low_risk():
    from domain.models import RiskLevel, WeatherSample
    from domain.risk import assess

    wind, gust, rain, showers, snow = calm(0, 0, 0)
    assert assess(WeatherSample(wind, rain + showers, snow, gust), 80_000).level == RiskLevel.LOW
