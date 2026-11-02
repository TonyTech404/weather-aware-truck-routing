import json
from datetime import UTC, datetime, timedelta

import pytest
from django.test import AsyncClient

from services.http import UpstreamError
from tests.fakes import FakeHttp, straight_shape, valhalla_trip

PLACES = {
    "features": [
        {
            "geometry": {"coordinates": [-96.79, 32.77]},
            "properties": {"name": "Dallas", "state": "Texas", "countrycode": "US", "type": "city"},
        },
        {
            "geometry": {"coordinates": [-96.79, 32.77]},
            "properties": {"name": "Dallas", "state": "Texas"},
        },
        {"geometry": {}, "properties": {"name": "Broken"}},
    ]
}


@pytest.fixture
def client():
    return AsyncClient()


def use(monkeypatch, fake):
    monkeypatch.setattr("api.views.http_client", lambda: fake)
    return fake


def body(**overrides):
    departure = (datetime.now(UTC) + timedelta(hours=3)).strftime("%Y-%m-%dT%H:00")
    data = {
        "origin": {"label": "A", "lat": 32.0, "lon": -97.0},
        "destination": {"label": "B", "lat": 33.0, "lon": -97.0},
        "departure": departure,
        "load_lb": 42_000,
        "interval_mi": 25,
        **overrides,
    }
    return json.dumps(data)


async def post(client, payload):
    return await client.post("/api/analyze", data=payload, content_type="application/json")


async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200 and response.json()["status"] == "ok"


async def test_wrong_method_is_rejected(client):
    assert (await client.get("/api/analyze")).status_code == 405
    assert (await client.post("/api/geocode")).status_code == 405


class TestGeocode:
    async def test_returns_deduplicated_places_and_is_cacheable(self, client, monkeypatch):
        use(monkeypatch, FakeHttp(places=PLACES))
        response = await client.get("/api/geocode", {"q": "Dallas"})
        assert response.status_code == 200
        results = response.json()["results"]
        assert results == [{"label": "Dallas, Texas", "lat": 32.77, "lon": -96.79, "kind": "city"}]
        assert "max-age" in response["Cache-Control"]

    @pytest.mark.parametrize("q", ["", "a", " ", "x" * 121])
    async def test_rejects_bad_queries(self, client, q):
        response = await client.get("/api/geocode", {"q": q})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_provider_failure_is_a_502(self, client, monkeypatch):
        fake = FakeHttp()

        async def boom(*a, **k):
            raise UpstreamError("geocoding", "HTTP 503", 503)

        fake.request_json = boom
        use(monkeypatch, fake)
        response = await client.get("/api/geocode", {"q": "Dallas"})
        assert response.status_code == 502
        assert response.json()["error"]["code"] == "geocoding_unavailable"


class TestAnalyze:
    async def test_success_payload_shape(self, client, monkeypatch):
        trips = [
            valhalla_trip(straight_shape(lon=-97.0), 1.0, 69),
            valhalla_trip(straight_shape(lon=-96.0), 1.1, 70),
        ]
        use(monkeypatch, FakeHttp(valhalla=trips))
        response = await post(client, body())
        assert response.status_code == 200
        data = response.json()
        assert [r["id"] for r in data["routes"]] == ["r1", "r2"]
        route = data["routes"][0]
        assert set(route) >= {
            "geometry",
            "stats",
            "ranking",
            "checkpoints",
            "distance_mi",
            "arrival",
        }
        checkpoint = route["checkpoints"][0]
        assert len(checkpoint["timeline"]["levels"]) == 49
        assert checkpoint["risk"]["level"] == "low" and checkpoint["risk"]["drivers"] == []
        assert data["recommendation"]["status"] == "recommended"
        assert data["meta"]["routing"]["profile"] == "truck"
        assert data["request"]["timezone"] == "America/Chicago"

    async def test_validation_errors_list_fields(self, client, monkeypatch):
        use(monkeypatch, FakeHttp())
        response = await post(client, body(load_lb=-1, interval_mi=7))
        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "validation_error" and set(error["fields"]) == {
            "load_lb",
            "interval_mi",
        }

    async def test_malformed_json_is_a_400(self, client):
        assert (await post(client, "{nope")).status_code == 400

    async def test_departure_in_the_past_is_a_field_error(self, client, monkeypatch):
        use(monkeypatch, FakeHttp(valhalla=[valhalla_trip(straight_shape(), 1.0, 69)]))
        response = await post(client, body(departure="2020-01-01T08:00"))
        assert response.status_code == 422 and "departure" in response.json()["error"]["fields"]

    async def test_no_route_is_a_404(self, client, monkeypatch):
        use(monkeypatch, FakeHttp(valhalla=[]))
        response = await post(client, body())
        assert response.status_code == 404 and response.json()["error"]["code"] == "no_route"

    async def test_weather_outage_is_a_502_and_rate_limit_a_503(self, client, monkeypatch):
        trips = [valhalla_trip(straight_shape(), 1.0, 69)]
        use(
            monkeypatch,
            FakeHttp(valhalla=trips, weather_error=UpstreamError("weather", "HTTP 500", 500)),
        )
        response = await post(client, body())
        assert (
            response.status_code == 502
            and response.json()["error"]["code"] == "weather_unavailable"
        )

        use(
            monkeypatch,
            FakeHttp(valhalla=trips, weather_error=UpstreamError("weather", "HTTP 429", 429)),
        )
        from services import weather

        weather._forecast_cache.clear()
        response = await post(client, body())
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "weather_rate_limited"


async def test_cors_allows_only_configured_origins(client):
    ok = await client.options(
        "/api/analyze",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert ok["Access-Control-Allow-Origin"] == "http://localhost:5173"
    bad = await client.options(
        "/api/analyze",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "Access-Control-Allow-Origin" not in bad


async def test_unexpected_errors_return_json_without_details(monkeypatch):
    def explode(*a, **k):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr("api.views.http_client", explode)
    quiet = AsyncClient(raise_request_exception=False)
    response = await quiet.get("/api/geocode", {"q": "Dallas"})
    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Something went wrong on our side."}
    }
    assert b"secret" not in response.content
