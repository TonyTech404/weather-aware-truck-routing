import { useId } from 'react'
import { LOAD_THRESHOLDS } from '@/lib/risk'
import { MAX_LOAD_LB, parseLoad } from '@/lib/validation'
import { cn } from '@/lib/cn'

interface Props {
  value: string
  error?: string
  onChange: (value: string) => void
}

function ruleHint(load: number | null): string {
  if (load == null) return ''
  if (load > LOAD_THRESHOLDS.severeWind)
    return 'Heavy load: 35–44 mph wind counts as Severe, and 45–54 mph wind as No Travel.'
  if (load > LOAD_THRESHOLDS.heavyWind) return 'Over 30,000 lb: 45–54 mph wind counts as No Travel.'
  return 'No load-based wind escalation applies at this weight.'
}

export function LoadField({ value, error, onChange }: Props) {
  const id = useId()
  const load = parseLoad(value)
  const sliderValue = load == null ? 0 : Math.min(load, MAX_LOAD_LB)
  const pct = (n: number) => `${(n / MAX_LOAD_LB) * 100}%`

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-500">
        Load weight
      </label>
      <div
        className={cn(
          'flex h-9 items-center rounded-md border bg-surface px-2.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20',
          error ? 'border-[#d5403f]' : 'border-line-strong',
        )}
      >
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <span className="text-sm text-ink-400">lb</span>
      </div>

      <div className="relative mt-2.5 px-1">
        <input
          type="range"
          className="plain"
          min={0}
          max={MAX_LOAD_LB}
          step={1000}
          value={sliderValue}
          aria-label="Load weight slider"
          onChange={(e) => onChange(String(Number(e.target.value)))}
        />
        <div className="relative mt-1 h-7 text-[10px] text-ink-400" aria-hidden>
          {[LOAD_THRESHOLDS.heavyWind, LOAD_THRESHOLDS.severeWind].map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>
              <span className="mx-auto block h-1.5 w-px bg-ink-400" />
              {t / 1000}k
            </span>
          ))}
        </div>
      </div>

      <p id={`${id}-hint`} className="mt-0.5 text-xs text-ink-500">
        {ruleHint(load)}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-[#a02323]">
          {error}
        </p>
      )}
    </div>
  )
}
