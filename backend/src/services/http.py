"""Outbound JSON-over-HTTP with one implementation per runtime.

Cloudflare Python Workers run on Pyodide, where sockets are unavailable and the
runtime's `fetch` must be used. Locally and in CI the same interface is backed by httpx.
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any, Protocol
from urllib.parse import urlencode

USER_AGENT = "RouteGuard/1.0 (+https://github.com/TonyTech404/weather-aware-truck-routing)"
RETRY_DELAY_S = 0.4


class UpstreamError(Exception):
    """A third-party API call failed. `status` is the HTTP status when there was one."""

    def __init__(self, service: str, message: str, status: int | None = None):
        super().__init__(f"{service}: {message}")
        self.service = service
        self.status = status


class HttpClient(Protocol):
    async def request_json(
        self,
        method: str,
        url: str,
        *,
        service: str,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
        timeout: float = 20.0,
    ) -> Any: ...


class BaseHttpClient:
    async def _send(
        self, method: str, url: str, headers: dict[str, str], body: str | None, timeout: float
    ) -> tuple[int, str]:
        raise NotImplementedError

    async def request_json(
        self,
        method: str,
        url: str,
        *,
        service: str,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
        timeout: float = 20.0,
    ) -> Any:
        """Send a request and parse JSON. Retries once on network errors and 5xx."""
        if params:
            url = f"{url}?{urlencode(params)}"
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        body = None
        if json_body is not None:
            body = json.dumps(json_body)
            headers["Content-Type"] = "application/json"

        failure: UpstreamError | None = None
        for attempt in range(2):
            if attempt:
                await asyncio.sleep(RETRY_DELAY_S)
            try:
                status, text = await self._send(method, url, headers, body, timeout)
            except Exception as exc:  # network error or timeout
                failure = UpstreamError(service, f"request failed ({type(exc).__name__})")
                continue
            if status >= 500:
                failure = UpstreamError(service, f"HTTP {status}", status)
                continue
            if status >= 400:
                raise UpstreamError(service, f"HTTP {status}: {text[:300]}", status)
            try:
                return json.loads(text)
            except ValueError as exc:
                raise UpstreamError(service, "response was not valid JSON", status) from exc
        assert failure is not None
        raise failure


class WorkersFetchClient(BaseHttpClient):
    async def _send(self, method, url, headers, body, timeout):
        from workers import fetch  # only importable inside the Workers runtime

        kwargs = {"method": method, "headers": headers}
        if body is not None:
            kwargs["body"] = body
        response = await asyncio.wait_for(fetch(url, **kwargs), timeout)
        return response.status, await response.text()


class HttpxClient(BaseHttpClient):
    async def _send(self, method, url, headers, body, timeout):
        import httpx

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(method, url, headers=headers, content=body)
        return response.status_code, response.text


def default_client() -> HttpClient:
    return WorkersFetchClient() if sys.platform == "emscripten" else HttpxClient()
