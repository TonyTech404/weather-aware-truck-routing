/** Mirrors the JSON contract of POST /api/analyze (see docs/api.md). */

export type RiskLevel = 'low' | 'moderate' | 'high' | 'severe' | 'no_travel'
export type Hazard = 'wind' | 'rain' | 'snow'
export type CriterionKey = 'no_travel_mi' | 'severe_mi' | 'high_mi' | 'avg_risk' | 'duration_s'

export interface PlaceRef {
  label: string
  lat: number
  lon: number
}

export interface Place extends PlaceRef {
  kind: string
}

export interface WeatherReading {
  wind_mph: number | null
  gust_mph: number | null
  rain_in_hr: number | null
  snow_in_hr: number | null
}

export interface CheckpointRisk {
  /** null when no forecast was available for this checkpoint. */
  level: RiskLevel | null
  label: string
  score: number | null
  drivers: Hazard[]
  hazards: Record<Hazard, RiskLevel | null>
  load_rule: string | null
}

/** Index h is the forecast at departure + h hours, for the 0-48 h slider. */
export interface CheckpointTimeline {
  levels: (number | null)[]
  wind_mph: (number | null)[]
  rain_in_hr: (number | null)[]
  snow_in_hr: (number | null)[]
}

export interface Checkpoint {
  index: number
  kind: 'origin' | 'waypoint' | 'destination'
  mile: number
  lat: number
  lon: number
  eta: string
  elapsed_s: number
  segment_mi: [number, number]
  weather: WeatherReading | null
  risk: CheckpointRisk
  timeline: CheckpointTimeline
}

export interface RouteStats {
  miles: Record<RiskLevel | 'unknown', number>
  avg_risk: number | null
  peak_level: RiskLevel | null
  no_travel_segments: [number, number][]
}

export interface RouteRanking {
  rank: number
  prohibited: boolean
  values: Record<CriterionKey, number>
}

export interface Route {
  id: string
  label: string
  via: string
  source: string
  profile: 'truck' | 'car'
  distance_mi: number
  duration_s: number
  arrival: string
  /** Encoded polyline, precision 5. */
  geometry: string
  stats: RouteStats
  ranking: RouteRanking
  checkpoints: Checkpoint[]
}

export type RecommendationStatus = 'recommended' | 'all_prohibited' | 'single_route' | 'no_routes'

export interface Recommendation {
  status: RecommendationStatus
  route_id: string | null
  decided_by: CriterionKey | null
  reasons: string[]
  criteria: { key: CriterionKey; label: string; unit: string }[]
}

export interface AnalysisMeta {
  timeline_hours: number
  horizon_end_utc: string
  routing: { provider: string; profile: 'truck' | 'car'; notes: string[] }
  weather: { provider: string; sampling: string }
  vehicle_assumptions: { tare_lb: number; height_m: number; width_m: number; length_m: number }
}

export interface AnalysisResponse {
  request: {
    origin: PlaceRef
    destination: PlaceRef
    load_lb: number
    interval_mi: number
    departure_utc: string
    departure_local: string
    timezone: string
  }
  routes: Route[]
  recommendation: Recommendation
  meta: AnalysisMeta
}

export interface AnalyzeRequest {
  origin: PlaceRef
  destination: PlaceRef
  /** Wall-clock time at the origin, `YYYY-MM-DDTHH:mm`. */
  departure: string
  load_lb: number
  interval_mi: 10 | 25 | 50
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> }
}
