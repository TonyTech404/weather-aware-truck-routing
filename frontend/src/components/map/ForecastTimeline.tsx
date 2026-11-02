import { useMemo } from 'react'
import { Pause, Play } from 'lucide-react'
import { peakLevelsByHour } from '@/lib/derive'
import { formatClockWithZone, formatDay } from '@/lib/format'
import { BANDS, levelFromScore, NO_FORECAST, RISK, type Metric } from '@/lib/risk'
import { cn } from '@/lib/cn'
import type { Route } from '@/types/api'

interface Props {
  route: Route
  hours: number
  hour: number
  departureUtc: string
  timezone: string
  playing: boolean
  metric: Metric
  onHour: (hour: number) => void
  onTogglePlay: () => void
  onMetric: (metric: Metric) => void
  compact?: boolean
}

const METRICS: { key: Metric; label: string }[] = [
  { key: 'risk', label: 'Risk' },
  ...(Object.keys(BANDS) as (keyof typeof BANDS)[]).map((k) => ({ key: k, label: BANDS[k].label })),
]

/** Hard-stop gradient: one block per forecast hour, coloured by the worst risk on the route. */
function trackGradient(peaks: (number | null)[]): string {
  const n = peaks.length - 1
  const stops = peaks.map((peak, i) => {
    const color = peak == null ? NO_FORECAST.color : RISK[levelFromScore(peak)!].color
    const from = Math.max(0, ((i - 0.5) / n) * 100)
    const to = Math.min(100, ((i + 0.5) / n) * 100)
    return `${color} ${from}% ${to}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

export function ForecastTimeline({
  route,
  hours,
  hour,
  departureUtc,
  timezone,
  playing,
  metric,
  onHour,
  onTogglePlay,
  onMetric,
  compact = false,
}: Props) {
  const peaks = useMemo(() => peakLevelsByHour(route, hours), [route, hours])
  const gradient = useMemo(() => trackGradient(peaks), [peaks])
  const at = (h: number) => new Date(new Date(departureUtc).getTime() + h * 3_600_000)
  const arrivalHour = route.duration_s / 3600
  const peak = levelFromScore(peaks[hour] ?? null)
  const label = formatClockWithZone(at(hour), timezone)

  return (
    <section
      aria-label="Forecast timeline"
      data-testid="timeline"
      className="rounded-md border border-line-strong bg-surface/95 p-2.5 shadow-md sm:p-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause forecast animation' : 'Play forecast animation'}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white hover:bg-brand-800"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
        <div className="min-w-0 flex-1" aria-live="polite" data-testid="timeline-label">
          <div className="truncate text-sm font-semibold">{label}</div>
          <div className="truncate text-xs text-ink-500">
            {hour === 0 ? 'At departure' : `${hour} h after departure`} · corridor peak{' '}
            <span className="font-medium" style={{ color: peak ? RISK[peak].ink : NO_FORECAST.ink }}>
              {peak ? RISK[peak].label : 'no forecast'}
            </span>
          </div>
        </div>
        {compact ? (
          <select
            aria-label="Heatmap shows"
            value={metric}
            onChange={(e) => onMetric(e.target.value as Metric)}
            className="h-8 rounded-md border border-line-strong bg-surface px-1.5 text-xs"
          >
            {METRICS.map(({ key, label: text }) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        ) : (
          <div role="radiogroup" aria-label="Heatmap shows" className="flex rounded-md border border-line-strong bg-canvas p-0.5">
            {METRICS.map(({ key, label: text }) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={metric === key}
                onClick={() => onMetric(key)}
                className={cn(
                  'h-6 rounded-[5px] px-2 text-xs',
                  metric === key ? 'bg-surface font-medium text-ink-900 shadow-sm ring-1 ring-line-strong' : 'text-ink-500 hover:text-ink-900',
                )}
              >
                {text}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative mt-2.5 px-1">
        <input
          type="range"
          className="timeline"
          min={0}
          max={hours}
          step={1}
          value={hour}
          style={{ ['--track' as string]: gradient }}
          aria-label="Forecast hour after departure"
          aria-valuetext={`${label}, ${hour} hours after departure${peak ? `, worst risk ${RISK[peak].label}` : ''}`}
          onChange={(e) => onHour(Number(e.target.value))}
        />
        {arrivalHour <= hours && (
          <span
            aria-hidden
            title={`Arrival at +${arrivalHour.toFixed(1)} h`}
            className="pointer-events-none absolute top-[-3px] h-[16px] w-0.5 -translate-x-1/2 bg-ink-900"
            style={{ left: `calc(${(arrivalHour / hours) * 100}% * (1 - 0.04) + 0.5rem)` }}
          />
        )}
      </div>
      <div className={cn('relative mt-1 flex justify-between text-[11px] text-ink-500', compact && 'hidden')} aria-hidden>
        {[0, 12, 24, 36, 48].filter((h) => h <= hours).map((h) => (
          <span key={h} className="text-center">
            <span className="block font-medium text-ink-700">{h === 0 ? 'Depart' : `+${h} h`}</span>
            {!compact && <span className="hidden sm:block">{formatDay(at(h), timezone)}</span>}
          </span>
        ))}
      </div>
      {!compact && arrivalHour <= hours && (
        <p className="mt-1 text-[11px] text-ink-500">
          Black tick: {route.label} arrives at +{arrivalHour.toFixed(1)} h. The track shows the worst risk anywhere on the route each hour.
        </p>
      )}
    </section>
  )
}
