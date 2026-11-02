import type { Checkpoint } from '@/types/api'

export type Coord = [number, number] // [lon, lat]

const EARTH_RADIUS_MI = 3958.7613
const toRad = (d: number) => (d * Math.PI) / 180

export function haversineMi(a: Coord, b: Coord): number {
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A polyline with distance along the road at each vertex, scaled to a known total. */
export interface Path {
  coords: Coord[]
  cumulative: number[]
}

export function buildPath(coords: Coord[], totalMiles: number): Path {
  const raw = [0]
  for (let i = 1; i < coords.length; i++) {
    raw.push(raw[i - 1]! + haversineMi(coords[i - 1]!, coords[i]!))
  }
  const last = raw[raw.length - 1] ?? 0
  const scale = last > 0 ? totalMiles / last : 0
  return { coords, cumulative: raw.map((d) => d * scale) }
}

/** Largest index i with cumulative[i] <= miles (clamped). */
function indexAt(cumulative: number[], miles: number): number {
  let lo = 0
  let hi = cumulative.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cumulative[mid]! <= miles) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function pointAtMiles(path: Path, miles: number): Coord {
  const { coords, cumulative } = path
  const total = cumulative[cumulative.length - 1] ?? 0
  if (miles <= 0) return coords[0]!
  if (miles >= total) return coords[coords.length - 1]!
  const i = indexAt(cumulative, miles)
  const span = cumulative[i + 1]! - cumulative[i]!
  const f = span > 0 ? (miles - cumulative[i]!) / span : 0
  const a = coords[i]!
  const b = coords[i + 1]!
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/** The part of the path between two mileposts. */
export function sliceByMiles(path: Path, start: number, end: number): Coord[] {
  if (end <= start) return []
  const { coords, cumulative } = path
  const out: Coord[] = [pointAtMiles(path, start)]
  const first = indexAt(cumulative, start) + 1
  for (let i = first; i < coords.length && cumulative[i]! < end; i++) out.push(coords[i]!)
  out.push(pointAtMiles(path, end))
  return out
}

/**
 * Milepost reached `seconds` after departure, interpolated between checkpoints.
 * Returns null once the trip is over.
 */
export function mileAtElapsed(checkpoints: Checkpoint[], seconds: number): number | null {
  const last = checkpoints[checkpoints.length - 1]
  if (!last || seconds > last.elapsed_s) return null
  for (let i = 1; i < checkpoints.length; i++) {
    const a = checkpoints[i - 1]!
    const b = checkpoints[i]!
    if (seconds <= b.elapsed_s) {
      const span = b.elapsed_s - a.elapsed_s
      const f = span > 0 ? (seconds - a.elapsed_s) / span : 0
      return a.mile + (b.mile - a.mile) * f
    }
  }
  return last.mile
}

export function boundsOf(coords: Coord[]): [Coord, Coord] | null {
  if (coords.length === 0) return null
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ]
}
