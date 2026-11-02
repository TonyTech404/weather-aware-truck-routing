import pytest

from api.schemas import parse_trip_request
from domain.errors import ValidationFailed

VALID = {
    "origin": {"label": "Dallas, TX", "lat": 32.78, "lon": -96.8},
    "destination": {"label": "Atlanta, GA", "lat": 33.75, "lon": -84.39},
    "departure": "2026-11-03T08:00",
    "load_lb": 42000,
    "interval_mi": 25,
}


def fields_for(**overrides):
    with pytest.raises(ValidationFailed) as exc:
        parse_trip_request({**VALID, **overrides})
    return exc.value.fields


def test_valid_request_is_parsed():
    trip = parse_trip_request(VALID)
    assert trip.load_lb == 42000 and trip.interval_mi == 25
    assert trip.departure.tzinfo is None  # local to origin
    assert trip.origin.label == "Dallas, TX"


def test_interval_defaults_to_25():
    data = {k: v for k, v in VALID.items() if k != "interval_mi"}
    assert parse_trip_request(data).interval_mi == 25


def test_aware_departure_is_preserved():
    assert parse_trip_request({**VALID, "departure": "2026-11-03T08:00:00Z"}).departure.tzinfo


@pytest.mark.parametrize("bad", [None, "later", "2026-13-40T99:00", 12])
def test_bad_departure(bad):
    assert "departure" in fields_for(departure=bad)


@pytest.mark.parametrize("bad", [-1, 80_001, "heavy", None, True])
def test_bad_load(bad):
    assert "load_lb" in fields_for(load_lb=bad)


@pytest.mark.parametrize("ok", [0, 1, 30_000.5, 80_000])
def test_load_bounds_are_inclusive(ok):
    assert parse_trip_request({**VALID, "load_lb": ok}).load_lb == ok


@pytest.mark.parametrize("bad", [5, 15, "25", None, True, 100])
def test_interval_must_be_10_25_or_50(bad):
    assert "interval_mi" in fields_for(interval_mi=bad)


@pytest.mark.parametrize("bad", [None, {}, {"lat": 95, "lon": 0}, {"lat": "x", "lon": 0}, "Dallas"])
def test_bad_origin(bad):
    assert "origin" in fields_for(origin=bad)


def test_same_origin_and_destination_rejected():
    assert "destination" in fields_for(destination=VALID["origin"])


def test_all_errors_are_reported_together():
    assert set(fields_for(load_lb=-5, departure=None, interval_mi=7)) == {
        "load_lb", "departure", "interval_mi",
    }  # fmt: skip


def test_non_object_body():
    with pytest.raises(ValidationFailed):
        parse_trip_request([1, 2])
