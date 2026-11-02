"""Address and place search via Photon (OpenStreetMap data)."""

from __future__ import annotations

from dataclasses import dataclass

from .http import HttpClient

PHOTON_URL = "https://photon.komoot.io/api/"


@dataclass(frozen=True)
class Place:
    label: str
    lat: float
    lon: float
    kind: str  # e.g. "city", "street", "house"


def _label(props: dict) -> str:
    primary = props.get("name") or " ".join(
        part for part in (props.get("housenumber"), props.get("street")) if part
    )
    parts = [primary, props.get("city") or props.get("county"), props.get("state")]
    country = props.get("countrycode", "")
    if country and country.upper() != "US":
        parts.append(props.get("country"))
    seen: list[str] = []
    for part in parts:
        if part and part not in seen:
            seen.append(part)
    return ", ".join(seen)


def parse_places(payload: dict) -> list[Place]:
    places: list[Place] = []
    labels: set[str] = set()
    for feature in payload.get("features", []):
        try:
            lon, lat = feature["geometry"]["coordinates"][:2]
        except (KeyError, TypeError, ValueError):
            continue
        props = feature.get("properties", {})
        label = _label(props)
        if not label or label in labels:
            continue
        labels.add(label)
        places.append(Place(label, float(lat), float(lon), props.get("type") or "place"))
    return places


async def search_places(http: HttpClient, query: str, limit: int = 6) -> list[Place]:
    payload = await http.request_json(
        "GET",
        PHOTON_URL,
        service="geocoding",
        params={"q": query, "limit": limit, "lang": "en"},
        timeout=10.0,
    )
    return parse_places(payload)
