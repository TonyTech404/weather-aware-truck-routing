"""Plain data types shared by the domain logic. No framework or I/O dependencies."""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class RiskLevel(IntEnum):
    """Ordered so that `max()` yields the most severe level."""

    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return {
            RiskLevel.LOW: "Low",
            RiskLevel.MODERATE: "Moderate",
            RiskLevel.HIGH: "High",
            RiskLevel.SEVERE: "Severe",
            RiskLevel.NO_TRAVEL: "No Travel",
        }[self]

    @property
    def slug(self) -> str:
        return self.name.lower()


@dataclass(frozen=True)
class LatLon:
    lat: float
    lon: float


@dataclass(frozen=True)
class WeatherSample:
    """Forecast conditions at one place and hour. `None` means the provider had no value."""

    wind_mph: float | None = None
    rain_in_hr: float | None = None
    snow_in_hr: float | None = None
    gust_mph: float | None = None  # informational only; not used for classification
