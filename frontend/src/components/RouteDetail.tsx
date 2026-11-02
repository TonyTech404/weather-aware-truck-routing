import { TriangleAlert } from 'lucide-react'
import { formatMiles } from '@/lib/format'
import { RISK, RISK_LEVELS } from '@/lib/risk'
import type { Route } from '@/types/api'

/** Distance on the selected route at each risk level. */
export function RouteDetail({ route }: { route: Route }) {
  const { miles, no_travel_segments } = route.stats
  return (
    <section aria-label={`${route.label} risk summary`} className="rounded-md border border-line bg-surface p-3">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">{route.label} · weather by distance</h3>
      <dl className="space-y-1.5">
        {RISK_LEVELS.map((level) => {
          const share = (miles[level] / route.distance_mi) * 100
          return (
            <div key={level} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-sm">
              <dt className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: RISK[level].color }} />
                {RISK[level].label}
              </dt>
              <dd className="h-1.5 overflow-hidden rounded-full bg-canvas">
                <span className="block h-full" style={{ width: `${share}%`, background: RISK[level].color }} />
              </dd>
              <dd className="w-16 text-right text-ink-700">{formatMiles(miles[level])}</dd>
            </div>
          )
        })}
        {miles.unknown > 0 && (
          <div className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-sm text-ink-500">
            <dt>No forecast</dt>
            <dd />
            <dd className="w-16 text-right">{formatMiles(miles.unknown)}</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-xs text-ink-500">
        Average risk {route.stats.avg_risk == null ? 'n/a' : route.stats.avg_risk.toFixed(2)} on a 0–4 scale (distance-weighted).
      </p>
      {no_travel_segments.length > 0 && (
        <p className="mt-2 flex gap-1.5 rounded-sm bg-[#eddfe9] p-2 text-xs text-[#3a1030]">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          No Travel conditions at mile{' '}
          {no_travel_segments.map(([a, b]) => `${Math.round(a)}–${Math.round(b)}`).join(', ')}.
        </p>
      )}
      {miles.unknown > 0 && (
        <p className="mt-2 text-xs text-ink-500">
          Part of this trip arrives beyond the forecast horizon, so those miles are not scored.
        </p>
      )}
    </section>
  )
}
