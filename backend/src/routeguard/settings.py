"""Django settings for the RouteGuard API.

The API is stateless: no database, sessions, auth, or admin. Configuration comes
from environment variables locally and from Cloudflare vars/secrets in production.
"""

import os

from django.core.exceptions import ImproperlyConfigured


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value:
        return value
    try:  # Cloudflare Python Workers expose vars and secrets on `workers.env`.
        from workers import env as worker_env

        value = getattr(worker_env, name, None)
        if isinstance(value, str) and value:
            return value
    except ImportError:
        pass
    return default


def _env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in (_env(name, default) or "").split(",") if item.strip()]


DEBUG = _env("DJANGO_DEBUG") == "1"

SECRET_KEY = _env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DEBUG is off.")
    SECRET_KEY = "insecure-local-development-key"

ALLOWED_HOSTS = _env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver")
CORS_ALLOWED_ORIGINS = _env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
CORS_ALLOW_METHODS = ["GET", "POST", "OPTIONS"]
CORS_PREFLIGHT_MAX_AGE = 86400

INSTALLED_APPS = ["corsheaders"]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
]

ROOT_URLCONF = "routeguard.urls"
DATABASES: dict = {}
USE_TZ = True
TIME_ZONE = "UTC"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
