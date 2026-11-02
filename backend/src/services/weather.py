"""Hourly forecasts from Open-Meteo, plus timezone lookup.

Values requested: sustained 10 m wind and gusts (mph), rain + showers (inches per hour)
and snowfall (inches per hour). Hourly precipitation is accumulation over the preceding
hour, which is numerically the average rate in in/hr.
"""

from __future__ import annotations

import asyncio
import itertools
import math
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from domain.models import LatLon, WeatherSample

from .http import HttpClient, UpstreamError

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
HOURLY_FIELDS = "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"
HORIZON_DAYS = 15  # Open-Meteo accepts hours up to floor_hour(now) + 15 days
CHUNK_SIZE = 100  # locations per request, keeps the URL short
CACHE_TTL_S = 15 * 60
CACHE_MAX_ENTRIES = 4000

_forecast_cache: dict[tuple[float, float], tuple[float, ForecastSeries]] = {}
_timezone_cache: dict[tuple[float, float], str] = {}


def grid_key(point: LatLon) -> tuple[float, float]:
    """Snap to 0.01 degrees (~1 km), well inside the forecast model's own resolution."""
    return round(point.lat, 2), round(point.lon, 2)


def floor_hour(when: datetime) -> datetime:
    return when.replace(minute=0, second=0, microsecond=0)


def forecast_horizon_end(now: datetime) -> datetime:
    return floor_hour(now.astimezone(UTC)) + timedelta(days=HORIZON_DAYS)


def _clean(value) -> float | None:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    return float(value)


def _sum_present(a: float | None, b: float | None) -> float | None:
    if a is None and b is None:
        return None
    return (a or 0.0) + (b or 0.0)


@dataclass(frozen=True)
class ForecastSeries:
    """Contiguous hourly forecast for one grid point, starting at `start_epoch` (UTC)."""

    start_epoch: int
    wind: tuple[float | None, ...]
    gust: tuple[float | None, ...]
    rain: tuple[float | None, ...]
    snow: tuple[float | None, ...]

    @property
    def end_epoch(self) -> int:
        return self.start_epoch + 3600 * (len(self.wind) - 1)

    def covers(self, start: datetime, end: datetime) -> bool:
        return self.start_epoch <= start.timestamp() and self.end_epoch >= end.timestamp()

    def sample_at(self, when: datetime) -> WeatherSample | None:
        """Forecast for the nearest hour to `when`; None outside the fetched window."""
        index = math.floor((when.timestamp() - self.start_epoch) / 3600 + 0.5)
        if index < 0 or index >= len(self.wind):
            return None
        sample = WeatherSample(
            wind_mph=self.wind[index],
            rain_in_hr=self.rain[index],
            snow_in_hr=self.snow[index],
            gust_mph=self.gust[index],
        )
        if sample.wind_mph is None and sample.rain_in_hr is None and sample.snow_in_hr is None:
            return None
        return sample


def parse_forecasts(payload) -> list[ForecastSeries]:
    """Open-Meteo returns a list for multi-location requests and an object for one."""
    entries = payload if isinstance(payload, list) else [payload]
    series: list[ForecastSeries] = []
    for entry in entries:
        hourly = entry.get("hourly") or {}
        times = hourly.get("time") or []
        if not times:
            raise UpstreamError("weather", "forecast response had no hourly data")
        if any(b - a != 3600 for a, b in itertools.pairwise(times)):
            raise UpstreamError("weather", "forecast hours were not contiguous")
        count = len(times)
        rain, showers = (
            hourly.get("rain") or [None] * count,
            hourly.get("showers") or [None] * count,
        )
        series.append(
            ForecastSeries(
                start_epoch=int(times[0]),
                wind=tuple(_clean(v) for v in hourly.get("wind_speed_10m") or [None] * count),
                gust=tuple(_clean(v) for v in hourly.get("wind_gusts_10m") or [None] * count),
                rain=tuple(
                    _sum_present(_clean(r), _clean(s)) for r, s in zip(rain, showers, strict=True)
                ),
                snow=tuple(_clean(v) for v in hourly.get("snowfall") or [None] * count),
            )
        )
    return series


def _fmt(when: datetime) -> str:
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M")


async def _fetch_chunk(http: HttpClient, keys: Sequence[tuple[float, float]], start, end):
    payload = await http.request_json(
        "GET",
        FORECAST_URL,
        service="weather",
        params={
            "latitude": ",".join(f"{lat:.2f}" for lat, _ in keys),
            "longitude": ",".join(f"{lon:.2f}" for _, lon in keys),
            "hourly": HOURLY_FIELDS,
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "UTC",
            "timeformat": "unixtime",
            "start_hour": _fmt(start),
            "end_hour": _fmt(end),
        },
        timeout=30.0,
    )
    parsed = parse_forecasts(payload)
    if len(parsed) != len(keys):
        raise UpstreamError("weather", "forecast response did not match the requested locations")
    return dict(zip(keys, parsed, strict=True))


async def fetch_forecasts(
    http: HttpClient,
    points: Sequence[LatLon],
    start: datetime,
    end: datetime,
    now: datetime,
) -> dict[tuple[float, float], ForecastSeries]:
    """Hourly forecasts covering [start, end] for every distinct grid point.

    The window is clamped to the provider's horizon; hours beyond it are simply absent
    and later read as "no forecast". Fresh cache entries are reused, which keeps repeated
    analyses of the same trip (for example when only the load changes) off the network.
    """
    start, end = floor_hour(start.astimezone(UTC)), floor_hour(end.astimezone(UTC))
    end = min(end, forecast_horizon_end(now))
    if end < start:
        return {}

    wall = time.time()
    result: dict[tuple[float, float], ForecastSeries] = {}
    missing: list[tuple[float, float]] = []
    for key in dict.fromkeys(grid_key(p) for p in points):
        cached = _forecast_cache.get(key)
        if cached and wall - cached[0] < CACHE_TTL_S and cached[1].covers(start, end):
            result[key] = cached[1]
        else:
            missing.append(key)

    chunks = [missing[i : i + CHUNK_SIZE] for i in range(0, len(missing), CHUNK_SIZE)]
    for fetched in await asyncio.gather(*(_fetch_chunk(http, c, start, end) for c in chunks)):
        result.update(fetched)
        if len(_forecast_cache) + len(fetched) > CACHE_MAX_ENTRIES:
            _forecast_cache.clear()
        _forecast_cache.update({key: (wall, series) for key, series in fetched.items()})
    return result


async def lookup_timezone(http: HttpClient, point: LatLon) -> str:
    """IANA timezone name for a coordinate (used to read the departure in local time)."""
    key = (round(point.lat, 1), round(point.lon, 1))
    if key in _timezone_cache:
        return _timezone_cache[key]
    payload = await http.request_json(
        "GET",
        FORECAST_URL,
        service="weather",
        params={
            "latitude": f"{point.lat:.4f}",
            "longitude": f"{point.lon:.4f}",
            "timezone": "auto",
            "forecast_days": 1,
            "current": "temperature_2m",
        },
        timeout=15.0,
    )
    name = payload.get("timezone")
    if not isinstance(name, str) or not name:
        raise UpstreamError("weather", "timezone lookup returned no timezone")
    _timezone_cache[key] = name
    return name
