import { RiskBar } from '@/components/ui/RiskBar'
import { cn } from '@/lib/cn'
import { formatClock, formatDuration, formatMiles } from '@/lib/format'
import type { Recommendation, Route } from '@/types/api'

interface Props {
  routes: Route[]
  recommendation: Recommendation
  selectedId: string | null
  timezone: string
  onSelect: (id: string) => void
}

export function RouteList({ routes, recommendation, selectedId, timezone, onSelect }: Props) {
  const fastest = routes.reduce<Route | null>((a, r) => (!a || r.duration_s < a.duration_s ? r : a), null)
  const ordered = [...routes].sort((a, b) => a.ranking.rank - b.ranking.rank)

  return (
    <div role="radiogroup" aria-label="Route alternatives" className="overflow-hidden rounded-md border border-line bg-surface">
      {ordered.map((route, i) => {
        const selected = route.id === selectedId
        const recommended = route.id === recommendation.route_id && recommendation.status === 'recommended'
        const { miles } = route.stats
        return (
          <button
            key={route.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`route-${route.id}`}
            onClick={() => onSelect(route.id)}
            className={cn(
              'block w-full px-3 py-2.5 text-left',
              i > 0 && 'border-t border-line',
              selected ? 'bg-brand-50' : 'hover:bg-canvas',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold">{route.label}</span>
                  {recommended && <Tag tone="brand">Recommended</Tag>}
                  {route.ranking.prohibited && <Tag tone="plum">No Travel</Tag>}
                  {fastest?.id === route.id && <Tag tone="neutral">Fastest</Tag>}
                </div>
                <div className="truncate text-xs text-ink-500">{route.via ? `via ${route.via}` : 'Main roads'}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold">{formatDuration(route.duration_s)}</div>
                <div className="text-xs text-ink-500">{formatMiles(route.distance_mi)}</div>
              </div>
            </div>
            <div className="mt-2">
              <RiskBar stats={route.stats} total={route.distance_mi} />
            </div>
            <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-ink-500">
              <span>
                {miles.severe + miles.no_travel > 0
                  ? `${formatMiles(miles.severe + miles.no_travel)} severe or worse`
                  : miles.high > 0
                    ? `${formatMiles(miles.high)} high risk`
                    : 'No severe or high-risk miles'}
              </span>
              <span>Arrive {formatClock(route.arrival, timezone)}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function Tag({ tone, children }: { tone: 'brand' | 'plum' | 'neutral'; children: React.ReactNode }) {
  const style = {
    brand: 'bg-brand-700 text-white',
    plum: 'bg-[#3a1030] text-white',
    neutral: 'bg-canvas text-ink-700 ring-1 ring-line-strong',
  }[tone]
  return <span className={`rounded-sm px-1.5 py-px text-[11px] font-medium ${style}`}>{children}</span>
}
