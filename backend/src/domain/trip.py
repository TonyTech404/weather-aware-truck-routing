"""The validated input to a trip analysis."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .models import LatLon


@dataclass(frozen=True)
class PlaceInput:
    label: str
    point: LatLon


@dataclass(frozen=True)
class TripRequest:
    origin: PlaceInput
    destination: PlaceInput
    departure: datetime  # naive means local time at the origin
    load_lb: float
    interval_mi: int
