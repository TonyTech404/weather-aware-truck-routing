"""Request parsing and validation for the analyze endpoint."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from domain.errors import ValidationFailed
from domain.models import LatLon
from domain.sampling import ALLOWED_INTERVALS_MI
from domain.trip import PlaceInput, TripRequest

MAX_LOAD_LB = 80_000  # US legal gross vehicle weight; a conservative upper bound for cargo
DEFAULT_INTERVAL_MI = 25


def _place(data: Any, name: str, errors: dict[str, str]) -> PlaceInput | None:
    if not isinstance(data, dict):
        errors[name] = "Choose a location."
        return None
    try:
        lat, lon = float(data["lat"]), float(data["lon"])
    except (KeyError, TypeError, ValueError):
        errors[name] = "Choose a location from the search results."
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        errors[name] = "Coordinates are out of range."
        return None
    label = str(data.get("label") or f"{lat:.4f}, {lon:.4f}")[:200]
    return PlaceInput(label, LatLon(lat, lon))


def parse_trip_request(data: Any) -> TripRequest:
    if not isinstance(data, dict):
        raise ValidationFailed({"body": "Expected a JSON object."})
    errors: dict[str, str] = {}

    origin = _place(data.get("origin"), "origin", errors)
    destination = _place(data.get("destination"), "destination", errors)

    departure = None
    raw_departure = data.get("departure")
    if not isinstance(raw_departure, str):
        errors["departure"] = "Choose a departure date and time."
    else:
        try:
            departure = datetime.fromisoformat(raw_departure)
        except ValueError:
            errors["departure"] = "Use an ISO 8601 date and time, e.g. 2026-11-03T08:00."

    load = None
    try:
        load = float(data["load_lb"])
        if isinstance(data["load_lb"], bool) or not 0 <= load <= MAX_LOAD_LB:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        errors["load_lb"] = f"Enter a load between 0 and {MAX_LOAD_LB:,} lb."

    interval = data.get("interval_mi", DEFAULT_INTERVAL_MI)
    if isinstance(interval, bool) or interval not in ALLOWED_INTERVALS_MI:
        errors["interval_mi"] = "Sampling interval must be 10, 25, or 50 miles."

    if (
        origin
        and destination
        and (origin.point.lat, origin.point.lon) == (destination.point.lat, destination.point.lon)
    ):
        errors["destination"] = "Destination must differ from the origin."

    if errors:
        raise ValidationFailed(errors)
    assert origin and destination and departure is not None and load is not None
    return TripRequest(origin, destination, departure, load, int(interval))
