import { useEffect, useRef } from 'react'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { cn } from '@/lib/cn'
import { formatClock, formatMiles } from '@/lib/format'
import type { Route } from '@/types/api'

interface Props {
  route: Route
  timezone: string
  selectedIndex: number | null
  onSelect: (index: number) => void
}

function conditions(w: Route['checkpoints'][number]['weather']): string {
  if (!w) return 'No forecast'
  const parts = [`${Math.round(w.wind_mph ?? 0)} mph`]
  if ((w.rain_in_hr ?? 0) > 0) parts.push(`${w.rain_in_hr!.toFixed(2)} in/hr rain`)
  if ((w.snow_in_hr ?? 0) > 0) parts.push(`${w.snow_in_hr!.toFixed(1)} in/hr snow`)
  return parts.join(' · ')
}

export function CheckpointList({ route, timezone, selectedIndex, onSelect }: Props) {
  const listRef = useRef<HTMLUListElement>(null)

  // Keep the active checkpoint visible when it is picked on the map.
  useEffect(() => {
    if (selectedIndex == null) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <section aria-label={`${route.label} checkpoints`} className="rounded-md border border-line bg-surface">
      <h3 className="border-b border-line px-3 py-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">
        Checkpoints · {route.checkpoints.length}
      </h3>
      <ul ref={listRef} className="max-h-[360px] divide-y divide-line overflow-y-auto" data-testid="checkpoint-list">
        {route.checkpoints.map((cp) => (
          <li key={cp.index} data-index={cp.index} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 52px' }}>
            <button
              type="button"
              onClick={() => onSelect(cp.index)}
              aria-current={cp.index === selectedIndex ? 'true' : undefined}
              className={cn('grid w-full grid-cols-[1fr_auto] gap-x-2 px-3 py-2 text-left', cp.index === selectedIndex ? 'bg-brand-50' : 'hover:bg-canvas')}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {cp.kind === 'origin' ? 'Origin' : cp.kind === 'destination' ? 'Destination' : `Mile ${formatMiles(cp.mile).replace(' mi', '')}`}
                  <span className="ml-1.5 font-normal text-ink-500">{formatClock(cp.eta, timezone)}</span>
                </span>
                <span className="block truncate text-xs text-ink-500">{conditions(cp.weather)}</span>
              </span>
              <RiskBadge level={cp.risk.level} className="self-center" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
