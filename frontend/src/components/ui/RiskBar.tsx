import { formatMiles } from '@/lib/format'
import { RISK, RISK_LEVELS } from '@/lib/risk'
import type { RouteStats } from '@/types/api'

/** Stacked bar of road distance by risk level, with a text alternative. */
export function RiskBar({ stats, total }: { stats: RouteStats; total: number }) {
  const parts = RISK_LEVELS.filter((l) => stats.miles[l] > 0)
  const summary = RISK_LEVELS.map((l) => `${RISK[l].label} ${formatMiles(stats.miles[l])}`).join(', ')
  return (
    <div
      role="img"
      aria-label={`Miles by risk level: ${summary}${stats.miles.unknown > 0 ? `, no forecast ${formatMiles(stats.miles.unknown)}` : ''}`}
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-line"
    >
      {parts.map((l) => (
        <span key={l} style={{ width: `${(stats.miles[l] / total) * 100}%`, background: RISK[l].color }} />
      ))}
    </div>
  )
}
