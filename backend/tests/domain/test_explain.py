import pytest

from domain.explain import explain, format_duration, format_miles
from domain.models import RiskLevel
from domain.recommend import recommend
from domain.stats import RouteStats

LABELS = {"a": "Route 1", "b": "Route 2", "c": "Route 3"}


def stats(*, severe=0.0, high=0.0, avg=0.5, minutes=600, no_travel=0.0):
    miles = {level: 0.0 for level in RiskLevel}
    miles[RiskLevel.SEVERE], miles[RiskLevel.HIGH], miles[RiskLevel.NO_TRAVEL] = (
        severe,
        high,
        no_travel,
    )
    return RouteStats(500, minutes * 60, miles, 0.0, avg, None, ())


def reasons_for(**routes):
    by_id = {k: v for k, v in routes.items()}
    return explain(recommend(list(by_id.items())), LABELS, by_id)


def test_names_the_deciding_criterion_with_both_values():
    (text,) = reasons_for(a=stats(severe=30), b=stats(severe=0))
    assert (
        text
        == "Route 2 is recommended: it has the fewest Severe miles (0.0 mi vs 30 mi on Route 1)."
    )


@pytest.mark.parametrize(
    ("a", "b", "fragment"),
    [
        (stats(high=40), stats(high=10), "fewest High-risk miles"),
        (stats(avg=0.9), stats(avg=0.2), "lowest average risk"),
        (stats(minutes=700), stats(minutes=650), "it is the fastest"),
    ],
)
def test_each_tie_break_is_explained(a, b, fragment):
    (text,) = reasons_for(a=a, b=b)
    assert fragment in text and text.startswith("Route 2 is recommended")


def test_equivalent_routes_say_so():
    (text,) = reasons_for(a=stats(), b=stats())
    assert "equivalent" in text


def test_excluded_routes_are_grouped_into_one_line():
    texts = reasons_for(a=stats(no_travel=25), b=stats(), c=stats(no_travel=10))
    assert texts[0].startswith("Route 2 is recommended")
    assert (
        texts[-1] == "Excluded for crossing No Travel conditions: Route 3 (10 mi), Route 1 (25 mi)."
    )


def test_all_prohibited_is_not_called_safe():
    (text,) = reasons_for(a=stats(no_travel=30), b=stats(no_travel=10))
    assert "not safe to drive" in text and "Route 2" in text and "recommended" not in text


def test_single_and_no_routes():
    assert "only option" in reasons_for(a=stats())[0]
    assert explain(recommend([]), {}, {}) == ["No route could be generated for these locations."]


def test_formatters():
    assert format_miles(4.25) == "4.2 mi" or format_miles(4.25) == "4.3 mi"
    assert format_miles(25.4) == "25 mi"
    assert format_duration(45 * 60) == "45 min"
    assert format_duration(3 * 3600 + 5 * 60) == "3 h 05 min"
