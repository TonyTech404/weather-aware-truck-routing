"""Threshold, boundary, and load-rule behaviour of the risk classifier."""

import pytest

from domain.models import RiskLevel, WeatherSample
from domain.risk import (
    apply_load_rules,
    assess,
    classify_rain,
    classify_snow,
    classify_wind,
)

L, M, H, S, NT = (
    RiskLevel.LOW,
    RiskLevel.MODERATE,
    RiskLevel.HIGH,
    RiskLevel.SEVERE,
    RiskLevel.NO_TRAVEL,
)


@pytest.mark.parametrize(
    ("mph", "expected"),
    [
        (0, L), (24.9, L), (24.99, L),
        (25, M), (34, M), (34.9, M),
        (35, H), (44, H), (44.9, H),
        (45, S), (54, S), (54.9, S),
        (55, NT), (80, NT),
    ],
)  # fmt: skip
def test_wind_thresholds(mph, expected):
    assert classify_wind(mph) == expected


@pytest.mark.parametrize(
    ("rate", "expected"),
    [
        (0, L), (0.09, L), (0.0999, L),
        (0.10, M), (0.2499, M),
        (0.25, H), (0.4999, H),
        (0.50, S), (1.00, S),  # 1.00 is still Severe: No Travel is "> 1.00"
        (1.0001, NT), (3.0, NT),
    ],
)  # fmt: skip
def test_rain_thresholds(rate, expected):
    assert classify_rain(rate) == expected


@pytest.mark.parametrize(
    ("rate", "expected"),
    [
        (0, L), (0.49, L),
        (0.5, M), (0.99, M),
        (1.0, H), (1.99, H),
        (2.0, S), (3.0, S),  # 3.0 is still Severe: No Travel is "> 3.0"
        (3.01, NT), (10, NT),
    ],
)  # fmt: skip
def test_snow_thresholds(rate, expected):
    assert classify_snow(rate) == expected


@pytest.mark.parametrize("fn", [classify_wind, classify_rain, classify_snow])
def test_missing_measurement_is_unknown_not_safe(fn):
    assert fn(None) is None
    assert fn(float("nan")) is None


@pytest.mark.parametrize("fn", [classify_wind, classify_rain, classify_snow])
def test_negative_measurement_is_rejected(fn):
    with pytest.raises(ValueError):
        fn(-0.1)


class TestLoadRules:
    def test_severe_wind_with_load_over_30k_is_no_travel(self):
        level, rule = apply_load_rules(S, 30_001)
        assert level == NT and rule

    def test_severe_wind_at_exactly_30k_stays_severe(self):
        assert apply_load_rules(S, 30_000) == (S, None)

    def test_high_wind_with_load_over_40k_is_severe(self):
        level, rule = apply_load_rules(H, 40_001)
        assert level == S and rule

    def test_high_wind_at_exactly_40k_stays_high(self):
        assert apply_load_rules(H, 40_000) == (H, None)

    def test_high_wind_between_30k_and_40k_is_unchanged(self):
        assert apply_load_rules(H, 35_000) == (H, None)

    def test_moderate_wind_is_never_escalated(self):
        assert apply_load_rules(M, 80_000) == (M, None)

    def test_no_travel_wind_applies_to_any_load(self):
        assert assess(WeatherSample(wind_mph=55), 0).level == NT
        assert assess(WeatherSample(wind_mph=55), 1).level == NT


class TestAssess:
    def test_takes_the_highest_hazard(self):
        result = assess(WeatherSample(wind_mph=30, rain_in_hr=0.3, snow_in_hr=0.0), 10_000)
        assert result.level == H
        assert result.drivers == ("rain",)
        assert (result.wind, result.rain, result.snow) == (M, H, L)

    def test_ties_list_every_driver(self):
        result = assess(WeatherSample(wind_mph=36, rain_in_hr=0.3), 10_000)
        assert result.level == H and result.drivers == ("wind", "rain")

    def test_heavy_load_escalates_wind_driven_level(self):
        light = assess(WeatherSample(wind_mph=47), 20_000)
        heavy = assess(WeatherSample(wind_mph=47), 35_000)
        assert light.level == S and light.load_rule is None
        assert heavy.level == NT and heavy.load_rule

    def test_load_rule_not_reported_when_another_hazard_dominates(self):
        result = assess(WeatherSample(wind_mph=36, snow_in_hr=2.5), 45_000)  # wind->S, snow S
        assert result.level == S and set(result.drivers) == {"wind", "snow"}
        result = assess(WeatherSample(wind_mph=36, snow_in_hr=4.0), 45_000)  # snow NT dominates
        assert result.level == NT and result.drivers == ("snow",) and result.load_rule is None

    def test_partial_data_uses_available_measurements(self):
        result = assess(WeatherSample(wind_mph=None, rain_in_hr=0.6, snow_in_hr=None), 10_000)
        assert result.level == S and result.wind is None

    def test_no_data_is_unknown(self):
        assert assess(None, 10_000).level is None
        assert assess(WeatherSample(), 10_000).is_known is False

    def test_gusts_do_not_affect_classification(self):
        assert assess(WeatherSample(wind_mph=10, gust_mph=70), 10_000).level == L
