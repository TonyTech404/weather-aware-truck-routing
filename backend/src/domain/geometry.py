"""Spherical geometry helpers and Google-style polyline encoding."""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence

from .models import LatLon

EARTH_RADIUS_MI = 3958.7613


def haversine_mi(a: LatLon, b: LatLon) -> float:
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(h)))


def cumulative_distances_mi(shape: Sequence[LatLon]) -> list[float]:
    """Distance along the polyline from its first vertex to each vertex."""
    cumulative = [0.0]
    for prev, cur in itertools.pairwise(shape):
        cumulative.append(cumulative[-1] + haversine_mi(prev, cur))
    return cumulative


def thin_shape(shape: Sequence[LatLon], min_spacing_mi: float) -> list[LatLon]:
    """Drop vertices closer than `min_spacing_mi` to the last kept one (keeps both endpoints).

    Used only to shrink the geometry sent to the browser; checkpoint placement always
    uses the full-resolution shape.
    """
    if len(shape) <= 2:
        return list(shape)
    kept = [shape[0]]
    for point in shape[1:-1]:
        if haversine_mi(kept[-1], point) >= min_spacing_mi:
            kept.append(point)
    kept.append(shape[-1])
    return kept


def encode_polyline(points: Sequence[LatLon], precision: int = 6) -> str:
    factor = 10**precision
    out: list[str] = []
    prev_lat = prev_lon = 0
    for p in points:
        lat, lon = round(p.lat * factor), round(p.lon * factor)
        for delta in (lat - prev_lat, lon - prev_lon):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev_lat, prev_lon = lat, lon
    return "".join(out)


def decode_polyline(encoded: str, precision: int = 6) -> list[LatLon]:
    factor = 10**precision
    points: list[LatLon] = []
    index = lat = lon = 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        points.append(LatLon(lat / factor, lon / factor))
    return points
