"""Weather risk classification.

Thresholds come from the assessment table. The table's ranges share boundary values
(for example rain "0.10-0.25" and "0.25-0.50"), so every level starts at its lower
bound, inclusive: a value exactly on a boundary takes the MORE severe class. Rain and
snow "No Travel" are explicitly "greater than" 1.00 in/hr and 3.0 in/hr, so those two
values themselves remain Severe. Wind values between listed integers (e.g. 34.6 mph)
fall in the lower class until the next lower bound is reached.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache

from .models import RiskLevel, WeatherSample

L, M, H, S, NT = (
    RiskLevel.LOW,
    RiskLevel.MODERATE,
    RiskLevel.HIGH,
    RiskLevel.SEVERE,
    RiskLevel.NO_TRAVEL,
)

# (inclusive lower bound, level), ascending.
WIND_BOUNDS_MPH = ((25.0, M), (35.0, H), (45.0, S), (55.0, NT))
RAIN_BOUNDS_IN_HR = ((0.10, M), (0.25, H), (0.50, S))
RAIN_NO_TRAVEL_ABOVE = 1.00  # strictly greater
SNOW_BOUNDS_IN_HR = ((0.5, M), (1.0, H), (2.0, S))
SNOW_NO_TRAVEL_ABOVE = 3.0  # strictly greater

# Load rules (pounds, strictly greater than).
HEAVY_LOAD_NO_TRAVEL_LB = 30_000  # with Severe-band wind (45-54 mph)
HEAVY_LOAD_SEVERE_LB = 40_000  # with High-band wind (35-44 mph)


def _by_lower_bounds(value: float, bounds: tuple[tuple[float, RiskLevel], ...]) -> RiskLevel:
    level = L
    for lower, bound_level in bounds:
        if value >= lower:
            level = bound_level
    return level


def _valid(value: float | None) -> float | None:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    if value < 0:
        raise ValueError(f"weather measurement cannot be negative: {value}")
    return value


def classify_wind(mph: float | None) -> RiskLevel | None:
    value = _valid(mph)
    return None if value is None else _by_lower_bounds(value, WIND_BOUNDS_MPH)


def classify_rain(in_per_hr: float | None) -> RiskLevel | None:
    value = _valid(in_per_hr)
    if value is None:
        return None
    return NT if value > RAIN_NO_TRAVEL_ABOVE else _by_lower_bounds(value, RAIN_BOUNDS_IN_HR)


def classify_snow(in_per_hr: float | None) -> RiskLevel | None:
    value = _valid(in_per_hr)
    if value is None:
        return None
    return NT if value > SNOW_NO_TRAVEL_ABOVE else _by_lower_bounds(value, SNOW_BOUNDS_IN_HR)


def apply_load_rules(
    wind_level: RiskLevel | None, load_lb: float
) -> tuple[RiskLevel | None, str | None]:
    """Escalate the wind level for heavy loads. Returns (level, rule text if one fired)."""
    if wind_level == S and load_lb > HEAVY_LOAD_NO_TRAVEL_LB:
        return NT, "Wind 45-54 mph with a load over 30,000 lb is No Travel"
    if wind_level == H and load_lb > HEAVY_LOAD_SEVERE_LB:
        return S, "Wind 35-44 mph with a load over 40,000 lb is Severe"
    return wind_level, None


@dataclass(frozen=True)
class RiskAssessment:
    """Result of classifying one checkpoint. `level` is None when no data was available."""

    level: RiskLevel | None
    wind: RiskLevel | None  # after load rules
    rain: RiskLevel | None
    snow: RiskLevel | None
    drivers: tuple[str, ...]  # hazards at the overall level, e.g. ("wind",) or ("wind", "rain")
    load_rule: str | None  # set when a load rule raised the wind level

    @property
    def is_known(self) -> bool:
        return self.level is not None


def assess(weather: WeatherSample | None, load_lb: float) -> RiskAssessment:
    """Classify a checkpoint by its highest applicable hazard, with load overrides.

    Missing measurements are skipped rather than assumed safe. If nothing is available
    the assessment is unknown (`level is None`).
    """
    if weather is None:
        return RiskAssessment(None, None, None, None, (), None)

    wind, load_rule = apply_load_rules(classify_wind(weather.wind_mph), load_lb)
    rain = classify_rain(weather.rain_in_hr)
    snow = classify_snow(weather.snow_in_hr)

    hazards = {"wind": wind, "rain": rain, "snow": snow}
    known = {name: level for name, level in hazards.items() if level is not None}
    if not known:
        return RiskAssessment(None, None, None, None, (), None)

    overall = max(known.values())
    # At Low nothing is driving risk, so there is nothing to attribute.
    drivers = tuple(name for name, level in known.items() if level == overall and overall > L)
    return RiskAssessment(
        level=overall,
        wind=wind,
        rain=rain,
        snow=snow,
        drivers=drivers,
        load_rule=load_rule if wind == overall else None,
    )


@lru_cache(maxsize=65_536)
def level_for(
    wind_mph: float | None, rain_in_hr: float | None, snow_in_hr: float | None, load_lb: float
) -> RiskLevel | None:
    """Overall level only, memoised. Forecast values repeat heavily (calm hours), so this
    keeps classifying a 49-hour timeline for hundreds of checkpoints cheap."""
    return assess(WeatherSample(wind_mph, rain_in_hr, snow_in_hr), load_lb).level
