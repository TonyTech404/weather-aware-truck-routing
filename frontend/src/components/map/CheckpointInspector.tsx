import { ChevronLeft, ChevronRight, Clock, X } from 'lucide-react'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { formatClockWithZone, formatMiles } from '@/lib/format'
import { BANDS, levelFromScore } from '@/lib/risk'
import type { Checkpoint, Route } from '@/types/api'

interface Props {
  route: Route
  checkpoint: Checkpoint
  hour: number
  timezone: string
  departureUtc: string
  onClose: () => void
  onStep: (delta: -1 | 1) => void
}

function Gauge({ kind, value }: { kind: keyof typeof BANDS; value: number | null }) {
  const band = BANDS[kind]
  const pct = (v: number) => `${Math.min(100, (v / band.max) * 100)}%`
  return (
    <div className="relative mt-1 h-1.5 rounded-full bg-canvas" aria-hidden>
      {band.stops.map((s) => (
        <span key={s} className="absolute top-0 h-full w-px bg-line-strong" style={{ left: pct(s) }} />
      ))}
      {value != null && (
        <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-700 shadow" style={{ left: pct(value) }} />
      )}
    </div>
  )
}

function Reading({ kind, value, extra }: { kind: keyof typeof BANDS; value: number | null; extra?: string }) {
  const band = BANDS[kind]
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-500">{band.label}</span>
        <span className="font-medium">
          {value == null ? 'n/a' : `${kind === 'wind' ? value.toFixed(0) : value.toFixed(2)} ${band.unit}`}
          {extra && <span className="ml-1 font-normal text-ink-500">{extra}</span>}
        </span>
      </div>
      <Gauge kind={kind} value={value} />
    </div>
  )
}

export function CheckpointInspector({ route, checkpoint: cp, hour, timezone, departureUtc, onClose, onStep }: Props) {
  const t = cp.timeline
  const atHour = {
    level: levelFromScore(t.levels[hour] ?? null),
    wind: t.wind_mph[hour] ?? null,
    rain: t.rain_in_hr[hour] ?? null,
    snow: t.snow_in_hr[hour] ?? null,
  }
  const slotTime = new Date(new Date(departureUtc).getTime() + hour * 3_600_000)
  const w = cp.weather
  const title = cp.kind === 'origin' ? 'Origin' : cp.kind === 'destination' ? 'Destination' : `Mile ${formatMiles(cp.mile).replace(' mi', '')}`

  return (
    <aside
      aria-label="Checkpoint details"
      data-testid="inspector"
      className="w-full rounded-md border border-line-strong bg-surface shadow-md sm:w-[300px]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <div>
          <div className="text-xs text-ink-500">
            {route.label} · checkpoint {cp.index + 1} of {route.checkpoints.length}
          </div>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="Previous checkpoint" disabled={cp.index === 0} onClick={() => onStep(-1)} className="flex size-[40px] items-center justify-center rounded text-ink-500 hover:bg-canvas disabled:opacity-30 lg:size-auto lg:p-1">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Next checkpoint" disabled={cp.index === route.checkpoints.length - 1} onClick={() => onStep(1)} className="flex size-[40px] items-center justify-center rounded text-ink-500 hover:bg-canvas disabled:opacity-30 lg:size-auto lg:p-1">
            <ChevronRight className="size-4" />
          </button>
          <button type="button" aria-label="Close checkpoint details" onClick={onClose} className="flex size-[40px] items-center justify-center rounded text-ink-500 hover:bg-canvas lg:size-auto lg:p-1">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3 px-3 py-3">
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-ink-500">
              <Clock className="size-3.5" aria-hidden /> Arrival forecast
            </span>
            <RiskBadge level={cp.risk.level} />
          </div>
          <div className="mt-0.5 text-sm font-medium" data-testid="inspector-eta">
            {formatClockWithZone(cp.eta, timezone)}
          </div>
          {cp.risk.level == null ? (
            <p className="mt-1 text-xs text-ink-500">No forecast is available for this arrival time.</p>
          ) : (
            cp.risk.drivers.length > 0 && (
              <p className="mt-1 text-xs text-ink-700">Driven by {cp.risk.drivers.join(' and ')}.</p>
            )
          )}
          {cp.risk.load_rule && (
            <p className="mt-1 rounded-sm bg-[#fcebdb] px-2 py-1 text-xs text-[#97480b]" data-testid="load-rule">
              Load rule: {cp.risk.load_rule}.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Reading kind="wind" value={w?.wind_mph ?? null} extra={w?.gust_mph != null ? `gusts ${w.gust_mph.toFixed(0)}` : undefined} />
          <Reading kind="rain" value={w?.rain_in_hr ?? null} />
          <Reading kind="snow" value={w?.snow_in_hr ?? null} />
        </div>

        <div className="rounded-sm bg-canvas px-2.5 py-2 text-xs" data-testid="inspector-slot">
          <div className="flex items-center justify-between">
            <span className="text-ink-500">At {formatClockWithZone(slotTime, timezone)}</span>
            <RiskBadge level={atHour.level} />
          </div>
          <div className="mt-1 text-ink-700">
            {atHour.wind == null && atHour.rain == null && atHour.snow == null
              ? 'No forecast at this hour.'
              : `${(atHour.wind ?? 0).toFixed(0)} mph wind · ${(atHour.rain ?? 0).toFixed(2)} in/hr rain · ${(atHour.snow ?? 0).toFixed(2)} in/hr snow`}
          </div>
        </div>
      </div>
    </aside>
  )
}
