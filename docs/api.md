# API contract

Base URL: `https://routeguard-api.buildwithanthony.workers.dev` (local: `http://127.0.0.1:8000`).
All responses are JSON. Errors share one shape:

```json
{ "error": { "code": "validation_error", "message": "Check the highlighted fields.", "fields": { "load_lb": "..." } } }
```

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `validation_error` | Body was not valid JSON |
| 404 | `no_route` | Providers answered but no drivable route exists |
| 422 | `validation_error` | Field errors in `fields` |
| 502 | `routing_unavailable`, `weather_unavailable`, `geocoding_unavailable` | A provider failed |
| 503 | `weather_rate_limited`, ... | A provider is rate limiting |
| 500 | `internal_error` | Unexpected; details are logged, never returned |

## `GET /api/health`

`{"status": "ok", "service": "routeguard-api"}`

## `GET /api/geocode?q=<text>`

2 to 120 characters. Cached for an hour (`Cache-Control`). Returns
`{"results": [{"label": "Dallas, Texas", "lat": 32.77, "lon": -96.79, "kind": "city"}]}`.

## `POST /api/analyze`

```json
{
  "origin":      { "label": "Dallas, Texas",   "lat": 32.7767, "lon": -96.797 },
  "destination": { "label": "Atlanta, Georgia", "lat": 33.749,  "lon": -84.388 },
  "departure": "2026-11-03T08:00",
  "load_lb": 42000,
  "interval_mi": 25
}
```

| Field | Rules |
| --- | --- |
| `departure` | ISO 8601. **Without an offset it is wall-clock time at the origin** (resolved through the origin's IANA timezone, DST-aware). With an offset/`Z` it is taken as given. Must be between 2 hours ago and 14 days ahead. |
| `load_lb` | 0 to 80,000 |
| `interval_mi` | 10, 25 or 50 (default 25) |

Response (abridged):

```jsonc
{
  "request": { "departure_utc": "...", "departure_local": "2026-11-03T08:00:00-06:00", "timezone": "America/Chicago", "load_lb": 42000, "interval_mi": 25, "origin": {}, "destination": {} },
  "routes": [{
    "id": "r1", "label": "Route 1", "via": "I 20, I 459", "source": "Valhalla", "profile": "truck",
    "distance_mi": 792.2, "duration_s": 43860, "arrival": "2026-11-04T02:11:00Z",
    "geometry": "<encoded polyline, precision 5>",
    "stats": {
      "miles": { "low": 700.1, "moderate": 50, "high": 25, "severe": 0, "no_travel": 0, "unknown": 0 },
      "avg_risk": 0.099, "peak_level": "high", "no_travel_segments": [[312.5, 337.5]]
    },
    "ranking": { "rank": 1, "prohibited": false,
      "values": { "no_travel_mi": 0, "severe_mi": 0, "high_mi": 25, "avg_risk": 0.099, "duration_s": 43860 } },
    "checkpoints": [{
      "index": 3, "kind": "waypoint", "mile": 75.0, "lat": 32.5, "lon": -95.6,
      "eta": "2026-11-02T19:10:12Z", "elapsed_s": 4212, "segment_mi": [62.5, 87.5],
      "weather": { "wind_mph": 16.6, "gust_mph": 21.7, "rain_in_hr": 0.0, "snow_in_hr": 0.0 },
      "risk": { "level": "low", "label": "Low", "score": 0, "drivers": [], "hazards": { "wind": "low", "rain": "low", "snow": "low" }, "load_rule": null },
      "timeline": { "levels": [0, 0, "... 49 entries, index h = departure + h hours"], "wind_mph": [], "rain_in_hr": [], "snow_in_hr": [] }
    }]
  }],
  "recommendation": {
    "status": "recommended",            // | all_prohibited | single_route | no_routes
    "route_id": "r1", "decided_by": "severe_mi",
    "reasons": ["Route 1 is recommended: it has the fewest Severe miles (0.0 mi vs 25 mi on Route 2)."],
    "criteria": [{ "key": "no_travel_mi", "label": "No Travel miles", "unit": "mi" }]
  },
  "meta": {
    "timeline_hours": 48, "horizon_end_utc": "...",
    "routing": { "provider": "Valhalla", "profile": "truck", "notes": [] },
    "weather": { "provider": "Open-Meteo", "sampling": "nearest forecast hour to each ETA" },
    "vehicle_assumptions": { "tare_lb": 33000, "height_m": 4.11, "width_m": 2.6, "length_m": 21.7 }
  }
}
```

`risk.level` is `null` (and `label` is "No forecast") when the forecast does not cover that
checkpoint's ETA; `timeline` entries are `null` for the same reason. Unknown is never reported as safe.
