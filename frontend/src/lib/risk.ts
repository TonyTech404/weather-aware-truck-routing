import type { RiskLevel } from '@/types/api'

export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'moderate', 'high', 'severe', 'no_travel']

interface RiskMeta {
  label: string
  /** Strong colour for map marks and bars. */
  color: string
  /** Tinted background and readable text colour for badges. */
  tint: string
  ink: string
}

export const RISK: Record<RiskLevel, RiskMeta> = {
  low: { label: 'Low', color: '#2f9e6e', tint: '#e5f4ec', ink: '#14664a' },
  moderate: { label: 'Moderate', color: '#e0b01f', tint: '#fbf3d6', ink: '#76560a' },
  high: { label: 'High', color: '#ec7d22', tint: '#fcebdb', ink: '#97480b' },
  severe: { label: 'Severe', color: '#d5403f', tint: '#fbe4e3', ink: '#a02323' },
  no_travel: { label: 'No Travel', color: '#3a1030', tint: '#eddfe9', ink: '#3a1030' },
}

export const NO_FORECAST = { label: 'No forecast', color: '#9aa4ae', tint: '#eef0f2', ink: '#56616b' }

export function levelFromScore(score: number | null | undefined): RiskLevel | null {
  if (score == null) return null
  return RISK_LEVELS[score] ?? null
}

export function riskColor(level: RiskLevel | null): string {
  return level ? RISK[level].color : NO_FORECAST.color
}

/**
 * Display-only copy of the assessment's bands, used for legends and gauges.
 * Classification itself happens in the Django backend.
 */
export const BANDS = {
  wind: { unit: 'mph', label: 'Wind', stops: [25, 35, 45, 55], max: 70 },
  rain: { unit: 'in/hr', label: 'Rain', stops: [0.1, 0.25, 0.5, 1.0], max: 1.25 },
  snow: { unit: 'in/hr', label: 'Snow', stops: [0.5, 1.0, 2.0, 3.0], max: 3.75 },
} as const

export type Metric = 'risk' | keyof typeof BANDS

/** Normalised 0..1 heat weight for a metric value. */
export function metricWeight(metric: Metric, level: number | null, value: number | null): number {
  if (metric === 'risk') return level == null ? 0 : level / 4
  if (value == null) return 0
  return Math.min(1, value / BANDS[metric].stops[3])
}

export const LOAD_THRESHOLDS = { heavyWind: 30_000, severeWind: 40_000 } as const
