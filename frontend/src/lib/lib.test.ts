import { describe, expect, it } from 'vitest'
import { boundsOf, buildPath, haversineMi, mileAtElapsed, pointAtMiles, sliceByMiles } from '@/lib/geo'
import { decodePolyline } from '@/lib/polyline'
import { formatClock, formatDuration, formatMiles, formatPounds, zoneAbbreviation } from '@/lib/format'
import { levelFromScore, metricWeight } from '@/lib/risk'
import { parseLoad, toRequest, validateTrip, type TripFormValues } from '@/lib/validation'
import type { Checkpoint, Place } from '@/types/api'

describe('polyline', () => {
  it('decodes the reference example from the encoding spec', () => {
    const coords = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)
    expect(coords).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
  })
  it('returns nothing for an empty string', () => {
    expect(decodePolyline('')).toEqual([])
  })
})

describe('geo', () => {
  const line: [number, number][] = [
    [-97, 32],
    [-97, 32.5],
    [-97, 33],
  ]
  it('haversine: one degree of latitude is about 69 miles', () => {
    expect(haversineMi([0, 0], [0, 1])).toBeCloseTo(69.09, 1)
  })
  it('scales cumulative distance to the route total', () => {
    const path = buildPath(line, 100)
    expect(path.cumulative[0]).toBe(0)
    expect(path.cumulative.at(-1)).toBeCloseTo(100)
    expect(path.cumulative[1]).toBeCloseTo(50, 0)
  })
  it('interpolates a position by road distance and clamps the ends', () => {
    const path = buildPath(line, 100)
    expect(pointAtMiles(path, 25)[1]).toBeCloseTo(32.25, 2)
    expect(pointAtMiles(path, -5)).toEqual(line[0])
    expect(pointAtMiles(path, 500)).toEqual(line[2])
  })
  it('slices the path between mileposts, keeping interior vertices', () => {
    const path = buildPath(line, 100)
    const slice = sliceByMiles(path, 25, 75)
    expect(slice).toHaveLength(3)
    expect(slice[0]![1]).toBeCloseTo(32.25, 2)
    expect(slice[1]).toEqual(line[1])
    expect(slice[2]![1]).toBeCloseTo(32.75, 2)
    expect(sliceByMiles(path, 60, 60)).toEqual([])
  })
  it('maps elapsed time to a milepost and returns null after arrival', () => {
    const cps = [
      { mile: 0, elapsed_s: 0 },
      { mile: 50, elapsed_s: 3600 },
      { mile: 100, elapsed_s: 10800 },
    ] as Checkpoint[]
    expect(mileAtElapsed(cps, 1800)).toBe(25)
    expect(mileAtElapsed(cps, 7200)).toBe(75)
    expect(mileAtElapsed(cps, 10801)).toBeNull()
  })
  it('computes bounds', () => {
    expect(boundsOf(line)).toEqual([
      [-97, 32],
      [-97, 33],
    ])
    expect(boundsOf([])).toBeNull()
  })
})

describe('format', () => {
  it('formats durations and distances', () => {
    expect(formatDuration(43_860)).toBe('12 h 11 min')
    expect(formatDuration(1_500)).toBe('25 min')
    expect(formatMiles(786.6)).toBe('787 mi')
    expect(formatMiles(12.4)).toBe('12 mi')
    expect(formatMiles(3.25)).toBe('3.3 mi')
    expect(formatPounds(42000)).toBe('42,000 lb')
  })
  it('renders instants in the requested IANA timezone, including DST', () => {
    expect(formatClock('2026-11-03T14:00:00Z', 'America/Chicago')).toBe('Tue 8:00 AM')
    expect(zoneAbbreviation('2026-11-03T14:00:00Z', 'America/Chicago')).toBe('CST')
    expect(zoneAbbreviation('2026-07-03T14:00:00Z', 'America/Chicago')).toBe('CDT')
  })
})

describe('risk helpers', () => {
  it('maps scores to levels', () => {
    expect(levelFromScore(0)).toBe('low')
    expect(levelFromScore(4)).toBe('no_travel')
    expect(levelFromScore(null)).toBeNull()
    expect(levelFromScore(9)).toBeNull()
  })
  it('weights heat by metric', () => {
    expect(metricWeight('risk', 2, null)).toBe(0.5)
    expect(metricWeight('risk', null, null)).toBe(0)
    expect(metricWeight('wind', null, 55)).toBe(1)
    expect(metricWeight('wind', null, 27.5)).toBe(0.5)
    expect(metricWeight('rain', null, 5)).toBe(1) // capped
    expect(metricWeight('snow', null, null)).toBe(0)
  })
})

describe('trip validation', () => {
  const dallas: Place = { label: 'Dallas', lat: 32.78, lon: -96.8, kind: 'city' }
  const atlanta: Place = { label: 'Atlanta', lat: 33.75, lon: -84.39, kind: 'city' }
  const now = new Date('2026-11-02T12:00:00')
  const valid: TripFormValues = {
    origin: dallas,
    destination: atlanta,
    departure: '2026-11-03T08:00',
    loadLb: '42,000',
    interval: 25,
  }

  it('accepts a valid trip', () => {
    expect(validateTrip(valid, now)).toEqual({})
  })
  it('requires places chosen from search', () => {
    const errors = validateTrip({ ...valid, origin: null, destination: null }, now)
    expect(errors.origin).toMatch(/origin/i)
    expect(errors.destination).toMatch(/destination/i)
  })
  it('rejects identical endpoints', () => {
    expect(validateTrip({ ...valid, destination: dallas }, now).destination).toMatch(/differ/)
  })
  it('rejects missing, past and too-distant departures', () => {
    expect(validateTrip({ ...valid, departure: '' }, now).departure).toBeDefined()
    expect(validateTrip({ ...valid, departure: '2026-10-01T08:00' }, now).departure).toMatch(/past/)
    expect(validateTrip({ ...valid, departure: '2026-12-25T08:00' }, now).departure).toMatch(/14 days/)
  })
  it.each(['', 'abc', '-5', '80001', '12.3.4'])('rejects load %j', (loadLb) => {
    expect(validateTrip({ ...valid, loadLb }, now).load).toBeDefined()
  })
  it.each(['0', '1', '30,000', '80000'])('accepts load %j', (loadLb) => {
    expect(validateTrip({ ...valid, loadLb }, now).load).toBeUndefined()
  })
  it('parses loads with thousands separators', () => {
    expect(parseLoad('42,000')).toBe(42000)
    expect(parseLoad(' 7 ')).toBe(7)
    expect(parseLoad('x')).toBeNull()
  })
  it('builds the API request', () => {
    expect(toRequest(valid)).toEqual({
      origin: { label: 'Dallas', lat: 32.78, lon: -96.8 },
      destination: { label: 'Atlanta', lat: 33.75, lon: -84.39 },
      departure: '2026-11-03T08:00',
      load_lb: 42000,
      interval_mi: 25,
    })
  })
})
