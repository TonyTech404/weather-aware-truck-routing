import { useState } from 'react'
import { ArrowDownUp, Route as RouteIcon } from 'lucide-react'
import { IntervalControl } from '@/components/IntervalControl'
import { LoadField } from '@/components/LoadField'
import { PlaceField } from '@/components/PlaceField'
import { Spinner } from '@/components/ui/Spinner'
import { toLocalInputValue } from '@/lib/format'
import { MAX_DEPARTURE_DAYS, toRequest, validateTrip, type FieldErrors, type TripFormValues } from '@/lib/validation'
import type { AnalyzeRequest } from '@/types/api'

interface Props {
  values: TripFormValues
  onChange: (values: TripFormValues) => void
  /** Bumped when the form is filled programmatically so uncontrolled inputs reset. */
  fieldsKey: number
  serverErrors: Record<string, string>
  loading: boolean
  onSubmit: (request: AnalyzeRequest) => void
  onSwap: () => void
}

const SERVER_FIELD: Record<string, keyof FieldErrors> = {
  origin: 'origin',
  destination: 'destination',
  departure: 'departure',
  load_lb: 'load',
}

export function TripForm({ values, onChange, fieldsKey, serverErrors, loading, onSubmit, onSwap }: Props) {
  const [clientErrors, setClientErrors] = useState<FieldErrors>({})
  const errors: FieldErrors = { ...serverErrorsToFields(serverErrors), ...clientErrors }
  const set = (patch: Partial<TripFormValues>) => {
    onChange({ ...values, ...patch })
    // Re-validate only the fields the user already saw an error for.
    if (Object.keys(clientErrors).length) setClientErrors(validateTrip({ ...values, ...patch }))
  }

  const now = new Date()
  const max = new Date(now.getTime() + MAX_DEPARTURE_DAYS * 24 * 3_600_000)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const found = validateTrip(values)
    setClientErrors(found)
    if (Object.keys(found).length === 0) onSubmit(toRequest(values))
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Trip details" className="space-y-3.5 p-4">
      <div className="relative space-y-3">
        <PlaceField key={`o-${fieldsKey}`} label="Origin" marker="A" value={values.origin} error={errors.origin} onChange={(origin) => set({ origin })} />
        <PlaceField
          key={`d-${fieldsKey}`}
          label="Destination"
          marker="B"
          value={values.destination}
          error={errors.destination}
          onChange={(destination) => set({ destination })}
        />
        <button
          type="button"
          onClick={onSwap}
          aria-label="Swap origin and destination"
          className="absolute top-[34px] right-9 z-10 hidden size-[40px] items-center justify-center rounded-full lg:size-8 border border-line-strong bg-surface text-ink-500 shadow-sm hover:text-ink-900 sm:flex"
        >
          <ArrowDownUp className="size-3.5" />
        </button>
      </div>

      <div>
        <label htmlFor="departure" className="mb-1 block text-xs font-medium text-ink-500">
          Departure <span className="font-normal text-ink-400">(local time at origin)</span>
        </label>
        <input
          id="departure"
          type="datetime-local"
          value={values.departure}
          min={toLocalInputValue(new Date(now.getTime() - 2 * 3_600_000))}
          max={toLocalInputValue(max)}
          aria-invalid={errors.departure ? true : undefined}
          onChange={(e) => set({ departure: e.target.value })}
          className={`h-[44px] w-full min-w-0 max-w-full rounded-md border bg-surface px-2.5 text-[16px] lg:h-9 lg:text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none ${errors.departure ? 'border-[#d5403f]' : 'border-line-strong'}`}
        />
        {errors.departure && (
          <p role="alert" className="mt-1 text-xs text-[#a02323]">
            {errors.departure}
          </p>
        )}
      </div>

      <LoadField value={values.loadLb} error={errors.load} onChange={(loadLb) => set({ loadLb })} />
      <IntervalControl value={values.interval} onChange={(interval) => set({ interval })} />

      <button
        type="submit"
        disabled={loading}
        className="flex h-[46px] w-full items-center justify-center gap-2 rounded-md bg-brand-700 lg:h-9 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-wait disabled:opacity-80"
      >
        {loading ? (
          <>
            <Spinner /> Analyzing routes…
          </>
        ) : (
          <>
            <RouteIcon className="size-4" aria-hidden /> Analyze routes
          </>
        )}
      </button>
    </form>
  )
}

function serverErrorsToFields(serverErrors: Record<string, string>): FieldErrors {
  const out: FieldErrors = {}
  for (const [field, message] of Object.entries(serverErrors)) {
    const key = SERVER_FIELD[field]
    if (key) out[key] = message
  }
  return out
}
