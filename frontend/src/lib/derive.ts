import { buildPath, mileAtElapsed, pointAtMiles, sliceByMiles, type Coord, type Path } from '@/lib/geo'
import { decodePolyline } from '@/lib/polyline'
import { levelFromScore, metricWeight, riskColor, type Metric } from '@/lib/risk'
import type { Route } from '@/types/api'

export interface PreparedRoute {
  route: Route
  path: Path
}

/** Decode each route's geometry once and index it by road distance. */
export function prepareRoutes(routes: Route[]): PreparedRoute[] {
  return routes.map((route) => ({
    route,
    path: buildPath(decodePolyline(route.geometry), route.distance_mi),
  }))
}

type Props = Record<string, string | number | boolean | null>

export interface Feature<G> {
  type: 'Feature'
  geometry: G
  properties: Props
}
export interface FeatureCollection<G> {
  type: 'FeatureCollection'
  features: Feature<G>[]
}
type Line = { type: 'LineString'; coordinates: Coord[] }
type Pt = { type: 'Point'; coordinates: Coord }

export function emptyCollection<G>(): FeatureCollection<G> {
  return { type: 'FeatureCollection', features: [] }
}

/** Each route as a single line. */
export function routeLines(prepared: PreparedRoute[]): FeatureCollection<Line> {
  return {
    type: 'FeatureCollection',
    features: prepared.map(({ route, path }) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: path.coords },
      properties: { id: route.id, label: route.label },
    })),
  }
}

/**
 * The selected route split into stretches coloured by the risk at each checkpoint,
 * using the same segment boundaries the backend used for its mileage totals.
 */
export function riskSegments(selected: PreparedRoute | undefined): FeatureCollection<Line> {
  if (!selected) return emptyCollection()
  const features: Feature<Line>[] = []
  for (const cp of selected.route.checkpoints) {
    const coordinates = sliceByMiles(selected.path, cp.segment_mi[0], cp.segment_mi[1])
    if (coordinates.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { level: cp.risk.level, color: riskColor(cp.risk.level), index: cp.index },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function checkpointPoints(
  prepared: PreparedRoute[],
  selectedRouteId: string | null,
  selectedIndex: number | null,
): FeatureCollection<Pt> {
  const features: Feature<Pt>[] = []
  for (const { route } of prepared) {
    const isSelected = route.id === selectedRouteId
    for (const cp of route.checkpoints) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [cp.lon, cp.lat] },
        properties: {
          routeId: route.id,
          index: cp.index,
          level: cp.risk.level,
          color: riskColor(cp.risk.level),
          onSelectedRoute: isSelected,
          active: isSelected && cp.index === selectedIndex,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Known-but-calm conditions keep a small weight so the whole corridor shows a faint
 * green wash; only missing forecasts draw nothing.
 */
function heatWeight(metric: Metric, level: number | null, value: number | null): number {
  const known = metric === 'risk' ? level != null : value != null
  return known ? 0.06 + 0.94 * metricWeight(metric, level, value) : 0
}

/** Corridor weather at departure + `hour`, one weighted point per checkpoint. */
export function heatPoints(prepared: PreparedRoute[], hour: number, metric: Metric): FeatureCollection<Pt> {
  const features: Feature<Pt>[] = []
  for (const { route } of prepared) {
    for (const cp of route.checkpoints) {
      const t = cp.timeline
      const level = t.levels[hour] ?? null
      const value =
        metric === 'risk' ? null : (t[`${metric === 'wind' ? 'wind_mph' : `${metric}_in_hr`}` as 'wind_mph'][hour] ?? null)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [cp.lon, cp.lat] },
        properties: { w: heatWeight(metric, level, value) },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Worst risk level anywhere on the route for each forecast hour (null = no forecast). */
export function peakLevelsByHour(route: Route, hours: number): (number | null)[] {
  return Array.from({ length: hours + 1 }, (_, h) => {
    let peak: number | null = null
    for (const cp of route.checkpoints) {
      const level = cp.timeline.levels[h]
      if (level != null && (peak == null || level > peak)) peak = level
    }
    return peak
  })
}

/** Where the truck is `hour` hours after departure, or null once it has arrived. */
export function truckPosition(prepared: PreparedRoute, hour: number): Coord | null {
  const mile = mileAtElapsed(prepared.route.checkpoints, hour * 3600)
  return mile == null ? null : pointAtMiles(prepared.path, mile)
}

export { levelFromScore }
