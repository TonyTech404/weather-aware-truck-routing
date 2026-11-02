import type { AnalyzeRequest, Place } from '@/types/api'

export const MAX_LOAD_LB = 80_000
export const MAX_DEPARTURE_DAYS = 14
export const INTERVALS = [10, 25, 50] as const
export type Interval = (typeof INTERVALS)[number]

export interface TripFormValues {
  origin: Place | null
  destination: Place | null
  departure: string // datetime-local value, wall-clock time at the origin
  loadLb: string
  interval: Interval
}

export type FieldErrors = Partial<Record<'origin' | 'destination' | 'departure' | 'load', string>>

export function parseLoad(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/**
 * Client-side checks that mirror the API's rules so mistakes are caught instantly.
 * The browser's clock stands in for the origin's, so the departure window is approximate;
 * the API remains authoritative.
 */
export function validateTrip(values: TripFormValues, now = new Date()): FieldErrors {
  const errors: FieldErrors = {}
  if (!values.origin) errors.origin = 'Choose an origin from the search results.'
  if (!values.destination) errors.destination = 'Choose a destination from the search results.'
  if (
    values.origin &&
    values.destination &&
    values.origin.lat === values.destination.lat &&
    values.origin.lon === values.destination.lon
  ) {
    errors.destination = 'Destination must differ from the origin.'
  }

  const departure = new Date(values.departure)
  if (!values.departure || Number.isNaN(departure.getTime())) {
    errors.departure = 'Choose a departure date and time.'
  } else {
    const hours = (departure.getTime() - now.getTime()) / 3_600_000
    // Loose bounds (±14 h) absorb the difference between browser and origin timezones.
    if (hours < -2 - 14) errors.departure = 'Departure is in the past.'
    else if (hours > MAX_DEPARTURE_DAYS * 24 + 14) {
      errors.departure = `Departure must be within ${MAX_DEPARTURE_DAYS} days; forecasts do not reach further.`
    }
  }

  const load = parseLoad(values.loadLb)
  if (load == null || load < 0 || load > MAX_LOAD_LB) {
    errors.load = `Enter a load between 0 and ${MAX_LOAD_LB.toLocaleString('en-US')} lb.`
  }
  return errors
}

export function toRequest(values: TripFormValues): AnalyzeRequest {
  const { origin, destination } = values
  const load = parseLoad(values.loadLb)
  if (!origin || !destination || load == null) throw new Error('toRequest called with invalid form values')
  return {
    origin: { label: origin.label, lat: origin.lat, lon: origin.lon },
    destination: { label: destination.label, lat: destination.lat, lon: destination.lon },
    departure: values.departure.length === 16 ? values.departure : values.departure.slice(0, 16),
    load_lb: load,
    interval_mi: values.interval,
  }
}
