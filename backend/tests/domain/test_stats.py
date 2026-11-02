import pytest

from domain.models import RiskLevel
from domain.stats import compute_route_stats, segment_bounds

L, M, H, S, NT = list(RiskLevel)


def test_segments_tile_the_route_exactly():
    distances = [0, 25, 50, 75, 100]
    bounds = segment_bounds(distances)
    assert bounds == [(0, 12.5), (12.5, 37.5), (37.5, 62.5), (62.5, 87.5), (87.5, 100)]
    assert sum(b - a for a, b in bounds) == pytest.approx(100)


def test_miles_are_distance_weighted_and_sum_to_total():
    stats = compute_route_stats(100, 3600, [0, 25, 50, 75, 100], [L, M, H, S, L])
    assert stats.miles_by_level[L] == pytest.approx(12.5 + 12.5)
    assert stats.miles_by_level[M] == pytest.approx(25)
    assert stats.high_mi == pytest.approx(25)
    assert stats.severe_mi == pytest.approx(25)
    assert sum(stats.miles_by_level.values()) + stats.unknown_mi == pytest.approx(100)


def test_average_risk_is_distance_weighted_not_a_checkpoint_mean():
    # Equal checkpoints (mean 1.0) but the Severe origin only covers 12.5 of 100 miles.
    stats = compute_route_stats(100, 1, [0, 25, 50, 75, 100], [S, L, L, L, L])
    assert stats.avg_risk == pytest.approx(3 * 12.5 / 100)


def test_peak_level_and_no_travel_segments_merge_adjacent_checkpoints():
    stats = compute_route_stats(100, 1, [0, 25, 50, 75, 100], [L, NT, NT, L, NT])
    assert stats.peak_level == NT
    assert stats.no_travel_mi == pytest.approx(50 + 12.5)
    assert stats.no_travel_segments == ((12.5, 62.5), (87.5, 100))


def test_unknown_checkpoints_are_excluded_from_risk_not_counted_as_safe():
    stats = compute_route_stats(100, 1, [0, 50, 100], [None, S, None])
    assert stats.unknown_mi == pytest.approx(50)
    assert stats.miles_by_level[L] == 0
    assert stats.avg_risk == pytest.approx(3.0)  # only the known Severe stretch


def test_all_unknown_has_no_average_and_no_peak():
    stats = compute_route_stats(100, 1, [0, 100], [None, None])
    assert stats.avg_risk is None and stats.peak_level is None
    assert stats.unknown_mi == pytest.approx(100)


def test_mismatched_inputs_are_rejected():
    with pytest.raises(ValueError):
        compute_route_stats(100, 1, [0, 100], [L])
