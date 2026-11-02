from domain.models import RiskLevel
from domain.recommend import recommend
from domain.stats import RouteStats

L, M, H, S, NT = list(RiskLevel)


def stats(*, severe=0.0, high=0.0, avg=0.5, minutes=600, no_travel=0.0, unknown=0.0):
    miles = {level: 0.0 for level in RiskLevel}
    miles[S], miles[H], miles[NT] = severe, high, no_travel
    return RouteStats(
        distance_mi=500, duration_s=minutes * 60, miles_by_level=miles, unknown_mi=unknown,
        avg_risk=avg, peak_level=None, no_travel_segments=(),
    )  # fmt: skip


def test_fewest_severe_miles_beats_everything_else():
    result = recommend([
        ("fast", stats(severe=10, high=0, avg=0.1, minutes=300)),
        ("safe", stats(severe=0, high=90, avg=2.0, minutes=900)),
    ])  # fmt: skip
    assert result.route_id == "safe" and result.decided_by == "severe_mi"
    assert result.status == "recommended"


def test_high_miles_break_a_severe_tie():
    result = recommend([
        ("a", stats(severe=5, high=40)),
        ("b", stats(severe=5, high=10, minutes=900)),
    ])  # fmt: skip
    assert result.route_id == "b" and result.decided_by == "high_mi"


def test_average_risk_breaks_a_severe_and_high_tie():
    result = recommend([
        ("a", stats(avg=1.2)),
        ("b", stats(avg=0.8, minutes=900)),
    ])  # fmt: skip
    assert result.route_id == "b" and result.decided_by == "avg_risk"


def test_travel_time_is_the_last_tiebreaker():
    result = recommend([
        ("slow", stats(minutes=700)),
        ("quick", stats(minutes=650)),
    ])  # fmt: skip
    assert result.route_id == "quick" and result.decided_by == "duration_s"


def test_ordering_is_lexicographic_not_weighted():
    # One extra severe mile loses to any amount of extra time or high-risk miles.
    result = recommend([
        ("a", stats(severe=1, high=0, avg=0.0, minutes=1)),
        ("b", stats(severe=0, high=500, avg=4.0, minutes=99999)),
    ])  # fmt: skip
    assert result.route_id == "b"


def test_float_noise_does_not_decide_the_winner():
    result = recommend([
        ("a", stats(severe=12.5000000001, minutes=700)),
        ("b", stats(severe=12.5, minutes=650)),
    ])  # fmt: skip
    assert result.route_id == "b" and result.decided_by == "duration_s"


def test_ties_keep_input_order():
    result = recommend([("first", stats()), ("second", stats())])
    assert result.route_id == "first" and result.decided_by is None


def test_no_travel_route_is_never_chosen_over_a_travelable_one():
    result = recommend([
        ("blocked", stats(no_travel=5, minutes=100)),
        ("open", stats(severe=200, high=200, minutes=2000)),
    ])  # fmt: skip
    assert result.route_id == "open" and result.status == "recommended"
    ranking = {r.route_id: r for r in result.rankings}
    assert ranking["blocked"].prohibited and not ranking["open"].prohibited


def test_all_routes_prohibited_is_reported_not_called_safe():
    result = recommend([
        ("a", stats(no_travel=30)),
        ("b", stats(no_travel=10)),
    ])  # fmt: skip
    assert result.status == "all_prohibited" and result.route_id == "b"
    assert result.decided_by == "no_travel_mi"


def test_single_route_and_no_routes():
    assert recommend([("only", stats())]).status == "single_route"
    assert recommend([]).status == "no_routes" and recommend([]).route_id is None


def test_route_with_no_forecast_average_sorts_after_known_averages():
    result = recommend([
        ("unknown", stats(avg=None)),  # type: ignore[arg-type]
        ("known", stats(avg=3.5, minutes=900)),
    ])  # fmt: skip
    assert result.route_id == "known"
