import type { Place } from '@/types/api'

export interface TripPreset {
  id: string
  title: string
  origin: Place
  destination: Place
  loadLb: number
}

const city = (label: string, lat: number, lon: number): Place => ({ label, lat, lon, kind: 'city' })

/** One-click example trips for the empty state. */
export const PRESETS: TripPreset[] = [
  {
    id: 'dal-atl',
    title: 'Dallas to Atlanta',
    origin: city('Dallas, Texas', 32.7767, -96.797),
    destination: city('Atlanta, Georgia', 33.749, -84.388),
    loadLb: 42_000,
  },
  {
    id: 'chi-den',
    title: 'Chicago to Denver',
    origin: city('Chicago, Illinois', 41.8781, -87.6298),
    destination: city('Denver, Colorado', 39.7392, -104.9903),
    loadLb: 35_000,
  },
  {
    id: 'sea-slc',
    title: 'Seattle to Salt Lake City',
    origin: city('Seattle, Washington', 47.6062, -122.3321),
    destination: city('Salt Lake City, Utah', 40.7608, -111.891),
    loadLb: 28_000,
  },
]
