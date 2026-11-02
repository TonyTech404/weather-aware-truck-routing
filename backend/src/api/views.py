import json
import logging
from datetime import UTC, datetime

from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from domain.errors import ValidationFailed
from services.geocoding import search_places
from services.http import UpstreamError, default_client
from services.planner import analyze_trip
from services.routing import NoRouteError

from .schemas import parse_trip_request
from .serializers import serialize_analysis

logger = logging.getLogger(__name__)

MAX_QUERY_LENGTH = 120


def http_client():
    """Indirection so tests can substitute a fake client."""
    return default_client()


def error_response(code: str, message: str, status: int, fields: dict | None = None):
    body = {"error": {"code": code, "message": message}}
    if fields:
        body["error"]["fields"] = fields
    return JsonResponse(body, status=status)


def upstream_response(exc: UpstreamError):
    if exc.status == 429:
        return error_response(
            f"{exc.service}_rate_limited",
            f"The {exc.service} provider is rate limiting requests. Try again in a minute.",
            503,
        )
    return error_response(
        f"{exc.service}_unavailable",
        f"The {exc.service} provider is unavailable right now. Try again shortly.",
        502,
    )


@require_GET
async def health(request):
    return JsonResponse({"status": "ok", "service": "routeguard-api"})


@require_GET
async def geocode(request):
    query = request.GET.get("q", "").strip()
    if len(query) < 2 or len(query) > MAX_QUERY_LENGTH:
        return error_response(
            "validation_error",
            "Search text must be 2-120 characters.",
            422,
            {"q": "Enter at least 2 characters."},
        )
    try:
        places = await search_places(http_client(), query)
    except UpstreamError as exc:
        logger.warning("geocoding failed: %s", exc)
        return upstream_response(exc)
    response = JsonResponse(
        {
            "results": [
                {"label": p.label, "lat": round(p.lat, 6), "lon": round(p.lon, 6), "kind": p.kind}
                for p in places
            ]
        }
    )
    response["Cache-Control"] = "public, max-age=3600"
    return response


@require_POST
async def analyze(request):
    try:
        payload = json.loads(request.body or b"null")
    except ValueError:
        return error_response("validation_error", "Request body must be valid JSON.", 400)

    try:
        trip = parse_trip_request(payload)
        analysis = await analyze_trip(trip, http_client(), datetime.now(UTC))
    except ValidationFailed as exc:
        return error_response("validation_error", "Check the highlighted fields.", 422, exc.fields)
    except NoRouteError as exc:
        return error_response("no_route", str(exc), 404)
    except UpstreamError as exc:
        logger.warning("upstream failure during analysis: %s", exc)
        return upstream_response(exc)
    return JsonResponse(serialize_analysis(analysis), json_dumps_params={"separators": (",", ":")})


def server_error(request):
    """JSON 500 so the frontend never has to parse an HTML error page."""
    return error_response("internal_error", "Something went wrong on our side.", 500)
