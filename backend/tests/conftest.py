import pytest

from services import weather


@pytest.fixture(autouse=True)
def clear_weather_caches():
    weather._forecast_cache.clear()
    weather._timezone_cache.clear()
    yield
    weather._forecast_cache.clear()
    weather._timezone_cache.clear()
