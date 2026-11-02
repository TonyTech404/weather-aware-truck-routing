import type { AnalysisResponse, Checkpoint, CheckpointTimeline, RiskLevel, Route } from '@/types/api'

const SCORE: Record<RiskLevel, number> = { low: 0, moderate: 1, high: 2, severe: 3, no_travel: 4 }
const LABEL: Record<RiskLevel, string> = { low: 'Low', moderate: 'Moderate', high: 'High', severe: 'Severe', no_travel: 'No Travel' }

// A short, real encoded polyline (precision 5): 3 vertices.
export const POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'

function timeline(level: RiskLevel | null, hours = 48): CheckpointTimeline {
  const levels = Array.from({ length: hours + 1 }, () => (level ? SCORE[level] : null))
  return {
    levels,
    wind_mph: levels.map((l) => (l == null ? null : 10 + l * 10)),
    rain_in_hr: levels.map((l) => (l == null ? null : 0)),
    snow_in_hr: levels.map((l) => (l == null ? null : 0)),
  }
}

export function checkpoint(index: number, mile: number, level: RiskLevel | null, over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    index,
    kind: index === 0 ? 'origin' : 'waypoint',
    mile,
    lat: 38 + index,
    lon: -120 - index,
    eta: new Date(Date.UTC(2026, 10, 3, 14 + index)).toISOString(),
    elapsed_s: index * 3600,
    segment_mi: [Math.max(0, mile - 12.5), mile + 12.5],
    weather: level ? { wind_mph: 10 + SCORE[level] * 10, gust_mph: 20, rain_in_hr: 0, snow_in_hr: 0 } : null,
    risk: {
      level,
      label: level ? LABEL[level] : 'No forecast',
      score: level ? SCORE[level] : null,
      drivers: level && level !== 'low' ? ['wind'] : [],
      hazards: { wind: level, rain: level ? 'low' : null, snow: level ? 'low' : null },
      load_rule: null,
    },
    timeline: timeline(level),
    ...over,
  }
}

export function route(id: string, label: string, levels: (RiskLevel | null)[], over: Partial<Route> = {}): Route {
  const miles: Route['stats']['miles'] = { low: 0, moderate: 0, high: 0, severe: 0, no_travel: 0, unknown: 0 }
  levels.forEach((l) => (miles[l ?? 'unknown'] += 25))
  return {
    id,
    label,
    via: 'I-80, I-5',
    source: 'Valhalla',
    profile: 'truck',
    distance_mi: levels.length * 25,
    duration_s: levels.length * 3600,
    arrival: '2026-11-03T20:00:00Z',
    geometry: POLYLINE,
    stats: { miles, avg_risk: 0.5, peak_level: 'low', no_travel_segments: [] },
    ranking: { rank: 1, prohibited: false, values: { no_travel_mi: 0, severe_mi: 0, high_mi: 0, avg_risk: 0.5, duration_s: 10_800 } },
    checkpoints: levels.map((l, i) => checkpoint(i, i * 25, l)),
    ...over,
  }
}

export function analysis(over: Partial<AnalysisResponse> = {}): AnalysisResponse {
  const best = route('r1', 'Route 1', ['low', 'low', 'moderate'])
  const other = route('r2', 'Route 2', ['low', 'severe', 'high'], {
    ranking: { rank: 2, prohibited: false, values: { no_travel_mi: 0, severe_mi: 25, high_mi: 25, avg_risk: 1.9, duration_s: 10_000 } },
    duration_s: 10_000,
    stats: { miles: { low: 25, moderate: 0, high: 25, severe: 25, no_travel: 0, unknown: 0 }, avg_risk: 1.67, peak_level: 'severe', no_travel_segments: [] },
  })
  return {
    request: {
      origin: { label: 'Dallas, Texas', lat: 32.78, lon: -96.8 },
      destination: { label: 'Atlanta, Georgia', lat: 33.75, lon: -84.39 },
      load_lb: 42_000,
      interval_mi: 25,
      departure_utc: '2026-11-03T14:00:00Z',
      departure_local: '2026-11-03T08:00:00-06:00',
      timezone: 'America/Chicago',
    },
    routes: [best, other],
    recommendation: {
      status: 'recommended',
      route_id: 'r1',
      decided_by: 'severe_mi',
      reasons: ['Route 1 is recommended: it has the fewest Severe miles (0.0 mi vs 25 mi on Route 2).'],
      criteria: [
        { key: 'no_travel_mi', label: 'No Travel miles', unit: 'mi' },
        { key: 'severe_mi', label: 'Severe miles', unit: 'mi' },
        { key: 'high_mi', label: 'High-risk miles', unit: 'mi' },
        { key: 'avg_risk', label: 'Average risk', unit: 'score' },
        { key: 'duration_s', label: 'Travel time', unit: 's' },
      ],
    },
    meta: {
      timeline_hours: 48,
      horizon_end_utc: '2026-11-17T06:00:00Z',
      routing: { provider: 'Valhalla', profile: 'truck', notes: [] },
      weather: { provider: 'Open-Meteo', sampling: 'nearest forecast hour to each ETA' },
      vehicle_assumptions: { tare_lb: 33_000, height_m: 4.11, width_m: 2.6, length_m: 21.7 },
    },
    ...over,
  }
}
