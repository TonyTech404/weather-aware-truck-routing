import { INTERVALS, type Interval } from '@/lib/validation'
import { cn } from '@/lib/cn'

interface Props {
  value: Interval
  onChange: (value: Interval) => void
}

export function IntervalControl({ value, onChange }: Props) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-ink-500">Weather checkpoint every</legend>
      <div role="radiogroup" className="grid grid-cols-3 gap-1 rounded-md border border-line-strong bg-canvas p-0.5">
        {INTERVALS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={cn(
              'h-7 rounded-[5px] text-sm',
              value === n ? 'bg-surface font-medium text-ink-900 shadow-sm ring-1 ring-line-strong' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            {n} mi
          </button>
        ))}
      </div>
    </fieldset>
  )
}
