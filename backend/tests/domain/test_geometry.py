import itertools
import math

import pytest

from domain.geometry import (
    cumulative_distances_mi,
    decode_polyline,
    encode_polyline,
    fast_cumulative_mi,
    haversine_mi,
    thin_indices,
)
from domain.models import LatLon

MI_PER_DEGREE = 2 * math.pi * 3958.7613 / 360


def test_haversine_one_degree_of_latitude():
    assert haversine_mi(LatLon(0, 0), LatLon(1, 0)) == pytest.approx(MI_PER_DEGREE, rel=1e-9)


def test_haversine_known_city_pair():
    dallas, atlanta = LatLon(32.7767, -96.797), LatLon(33.749, -84.388)
    assert haversine_mi(dallas, atlanta) == pytest.approx(721, abs=5)


def test_cumulative_distances_follow_the_path_not_the_chord():
    shape = [LatLon(0, 0), LatLon(1, 0), LatLon(1, 1)]
    cumulative = cumulative_distances_mi(shape)
    assert cumulative[0] == 0
    assert cumulative[-1] > haversine_mi(shape[0], shape[-1])
    assert cumulative[-1] == pytest.approx(
        haversine_mi(shape[0], shape[1]) + haversine_mi(shape[1], shape[2])
    )


def test_polyline_roundtrip_and_reference_value():
    points = [LatLon(38.5, -120.2), LatLon(40.7, -120.95), LatLon(43.252, -126.453)]
    assert encode_polyline(points, precision=5) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    decoded = decode_polyline(encode_polyline(points, precision=6), precision=6)
    assert decoded == pytest.approx(points) or all(
        d.lat == pytest.approx(p.lat, abs=1e-6) and d.lon == pytest.approx(p.lon, abs=1e-6)
        for d, p in zip(decoded, points, strict=True)
    )


def test_fast_cumulative_matches_haversine_on_dense_shapes():
    shape = [LatLon(32.0 + i * 0.0005, -96.0 + i * 0.0007) for i in range(4000)]
    fast, exact = fast_cumulative_mi(shape)[-1], cumulative_distances_mi(shape)[-1]
    assert fast == pytest.approx(exact, rel=2e-3)


def test_thin_indices_keeps_endpoints_and_enforces_spacing():
    cumulative = [i * 0.07 for i in range(1001)]  # vertices ~0.07 mi apart
    kept = thin_indices(cumulative, 1.0)
    assert kept[0] == 0 and kept[-1] == 1000
    assert len(kept) < 100
    gaps = [cumulative[b] - cumulative[a] for a, b in itertools.pairwise(kept[:-1])]
    assert min(gaps) >= 1.0


def test_thin_indices_handles_tiny_inputs():
    assert thin_indices([0.0], 1.0) == [0]
    assert thin_indices([0.0, 0.1], 1.0) == [0, 1]
