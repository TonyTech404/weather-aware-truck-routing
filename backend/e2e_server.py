"""ASGI app for the Playwright suite: the real Django API with a deterministic fake world.

Routing, weather and geocoding upstreams are replaced by `tests.fakes.FakeHttp` so browser
tests are repeatable and offline, while everything else (validation, checkpointing, risk
rules, ranking, serialization) is the production code. Run:

    uv run uvicorn e2e_server:application --port 8100
"""

import math
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / "src"), str(ROOT)]
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "routeguard.settings")
os.environ.setdefault("DJANGO_DEBUG", "1")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "http://127.0.0.1:4173,http://localhost:4173")

from tests.fakes import FakeHttp, valhalla_trip  # noqa: E402

from api import views  # noqa: E402
from domain.models import LatLon  # noqa: E402
from routeguard.asgi import application as django_app  # noqa: E402
from services.geocoding import PHOTON_URL  # noqa: E402

DALLAS, ATLANTA = LatLon(32.7767, -96.797), LatLon(33.749, -84.388)
BASE = int(time.time() // 3600 * 3600)  # the current hour; storms are placed relative to it


def line_lat(lon: float) -> float:
    return DALLAS.lat + (ATLANTA.lat - DALLAS.lat) * (lon - DALLAS.lon) / (ATLANTA.lon - DALLAS.lon)


def corridor(bow_deg: float, steps: int = 400) -> list[LatLon]:
    """Origin to destination, bowed north (+) or south (-) in the middle."""
    return [
        LatLon(
            DALLAS.lat + (ATLANTA.lat - DALLAS.lat) * t + bow_deg * math.sin(math.pi * t),
            DALLAS.lon + (ATLANTA.lon - DALLAS.lon) * t,
        )
        for t in (i / steps for i in range(steps + 1))
    ]


def weather(lat: float, lon: float, epoch: int):
    """(wind, gust, rain, showers, snow). Calm except for two scripted systems."""
    hours = (epoch - BASE) / 3600
    wind = 8.0
    # Severe wind (47 mph) on the direct route: Severe at light loads, No Travel above 30,000 lb.
    if -92.0 <= lon <= -88.0 and 4 <= hours <= 12 and abs(lat - line_lat(lon)) < 0.6:
        wind = 47.0
    # High wind (38 mph) over the southern route: becomes Severe above 40,000 lb.
    if -95.0 <= lon <= -91.5 and 1 <= hours <= 14 and lat < line_lat(lon) - 0.6:
        wind = 38.0
    rain = 0.12 if (-86.0 <= lon <= -84.5 and 8 <= hours <= 16) else 0.0
    return (wind, wind + 9, rain, 0.0, 0.0)


def feature(name, state, point: LatLon, kind="city"):
    return {
        "geometry": {"coordinates": [point.lon, point.lat]},
        "properties": {"name": name, "state": state, "countrycode": "US", "type": kind},
    }


PLACES = {
    "features": [
        feature("Dallas", "Texas", DALLAS),
        feature("Atlanta", "Georgia", ATLANTA),
        feature("Dallas", "Iowa", LatLon(41.674, -94.039), "county"),
    ]
}


class FakeWorld(FakeHttp):
    """FakeHttp whose geocoder behaves like one: only places matching the query come back."""

    async def request_json(self, method, url, **kwargs):
        if url == PHOTON_URL:
            query = kwargs["params"]["q"].lower()
            matches = [
                f for f in PLACES["features"] if f["properties"]["name"].lower().startswith(query)
            ]
            return {"features": matches}
        return await super().request_json(method, url, **kwargs)


def build_http() -> FakeHttp:
    trips = [
        valhalla_trip(corridor(0.0), hours=12.0, miles=780, road="I-20 East"),
        valhalla_trip(corridor(1.3), hours=13.4, miles=830, road="I-40 East"),
        valhalla_trip(corridor(-1.3), hours=13.0, miles=815, road="I-30 East"),
    ]
    return FakeWorld(valhalla=trips, weather=weather, timezone="America/Chicago")


views.http_client = build_http  # per request, so each call sees fresh state
application = django_app
