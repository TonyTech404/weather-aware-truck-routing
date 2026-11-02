import pytest

from services import routing, weather


@pytest.fixture(autouse=True)
def clear_weather_caches():
    for cache in (weather._forecast_cache, weather._timezone_cache, routing._route_cache):
        cache.clear()
    yield
    for cache in (weather._forecast_cache, weather._timezone_cache, routing._route_cache):
        cache.clear()
