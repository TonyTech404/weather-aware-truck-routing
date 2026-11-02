"""A scriptable stand-in for the HTTP layer, so tests never touch the network."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from domain.geometry import encode_polyline
from domain.models import LatLon
from services.geocoding import PHOTON_URL
from services.http import UpstreamError
from services.routing import OSRM_URL, VALHALLA_URL
from services.weather import FORECAST_URL

# (lat, lon, epoch_seconds) -> (wind_mph, gust_mph, rain, showers, snow); None = missing
WeatherFn = Callable[[float, float, int], tuple]


def calm(lat, lon, epoch):
    return (5.0, 8.0, 0.0, 0.0, 0.0)


def straight_shape(lat0=32.0, lat1=33.0, lon=-97.0, steps=100) -> list[LatLon]:
    return [LatLon(lat0 + (lat1 - lat0) * i / steps, lon) for i in range(steps + 1)]


def valhalla_trip(shape: list[LatLon], hours: float, miles: float, road="I-35 North") -> dict:
    return {
        "summary": {"length": miles, "time": hours * 3600},
        "legs": [
            {
                "shape": encode_polyline(shape, precision=6),
                "maneuvers": [
                    {
                        "begin_shape_index": 0,
                        "end_shape_index": len(shape) - 1,
                        "time": hours * 3600,
                        "length": miles,
                        "street_names": [road],
                    }
                ],
            }
        ],
    }


def osrm_route(shape: list[LatLon], hours: float, miles: float) -> dict:
    seconds = hours * 3600
    segments = len(shape) - 1
    return {
        "distance": miles * 1609.344,
        "duration": seconds,
        "geometry": encode_polyline(shape, precision=6),
        "legs": [{"annotation": {"duration": [seconds / segments] * segments}}],
    }


def open_meteo_payload(params: dict, weather: WeatherFn):
    lats = [float(v) for v in str(params["latitude"]).split(",")]
    lons = [float(v) for v in str(params["longitude"]).split(",")]

    def parse(s: str) -> int:
        return int(datetime.strptime(s, "%Y-%m-%dT%H:%M").replace(tzinfo=UTC).timestamp())

    start, end = parse(params["start_hour"]), parse(params["end_hour"])
    times = list(range(start, end + 1, 3600))
    entries = []
    for lat, lon in zip(lats, lons, strict=True):
        rows = [weather(lat, lon, t) for t in times]
        entries.append(
            {
                "latitude": lat,
                "longitude": lon,
                "hourly": {
                    "time": times,
                    "wind_speed_10m": [r[0] for r in rows],
                    "wind_gusts_10m": [r[1] for r in rows],
                    "rain": [r[2] for r in rows],
                    "showers": [r[3] for r in rows],
                    "snowfall": [r[4] for r in rows],
                },
            }
        )
    return entries if len(entries) > 1 else entries[0]


class FakeHttp:
    def __init__(
        self,
        *,
        valhalla: list | Exception | None = None,
        osrm: list | Exception | None = None,
        weather: WeatherFn = calm,
        timezone: str = "America/Chicago",
        places: dict | None = None,
        weather_error: Exception | None = None,
    ):
        self.valhalla, self.osrm, self.weather = valhalla, osrm, weather
        self.timezone, self.places, self.weather_error = timezone, places, weather_error
        self.calls: list[tuple[str, str, dict | None, object]] = []

    def calls_to(self, url: str):
        return [c for c in self.calls if c[1] == url]

    async def request_json(
        self, method, url, *, service, params=None, json_body=None, timeout=20.0
    ):
        self.calls.append((service, url, params, json_body))
        if url == VALHALLA_URL:
            if isinstance(self.valhalla, Exception):
                raise self.valhalla
            trips = self.valhalla or []
            if not trips:
                raise UpstreamError(service, "HTTP 400: No path could be found", 400)
            return {"trip": trips[0], "alternates": [{"trip": t} for t in trips[1:]]}
        if url.startswith(OSRM_URL.split("{")[0]):
            if isinstance(self.osrm, Exception):
                raise self.osrm
            return {"code": "Ok", "routes": self.osrm or []}
        if url == PHOTON_URL:
            return self.places or {"features": []}
        if url == FORECAST_URL:
            if params.get("timezone") == "auto":
                return {"timezone": self.timezone}
            if self.weather_error:
                raise self.weather_error
            return open_meteo_payload(params, self.weather)
        raise AssertionError(f"unexpected URL {url}")
