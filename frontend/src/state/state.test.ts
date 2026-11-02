import { describe, expect, it } from 'vitest'
import { checkpointPoints, heatPoints, peakLevelsByHour, prepareRoutes, riskSegments, routeLines, truckPosition } from '@/lib/derive'
import { initialWorkspace, workspaceReducer } from '@/state/workspace'
import { analysis, route } from '@/test/fixtures'

describe('workspaceReducer', () => {
  const s0 = { ...initialWorkspace, routeId: 'r1', checkpoint: 3, hour: 5 }

  it('switching routes clears the checkpoint; reselecting the same route does not', () => {
    expect(workspaceReducer(s0, { type: 'selectRoute', routeId: 'r2' })).toMatchObject({ routeId: 'r2', checkpoint: null })
    expect(workspaceReducer(s0, { type: 'selectRoute', routeId: 'r1' })).toBe(s0)
  })

  it('a new analysis resets selection and time but keeps the user’s layer choices', () => {
    const tweaked = workspaceReducer(workspaceReducer(s0, { type: 'toggleLayer', layer: 'heatmap' }), { type: 'setMetric', metric: 'wind' })
    const next = workspaceReducer(tweaked, { type: 'reset', routeId: 'r9' })
    expect(next).toMatchObject({ routeId: 'r9', checkpoint: null, hour: 0, playing: false, metric: 'wind' })
    expect(next.layers.heatmap).toBe(false)
  })

  it('plays through the hours and loops', () => {
    expect(workspaceReducer({ ...s0, hour: 47 }, { type: 'tick', max: 48 }).hour).toBe(48)
    expect(workspaceReducer({ ...s0, hour: 48 }, { type: 'tick', max: 48 }).hour).toBe(0)
  })

  it('scrubbing can stop playback', () => {
    const playing = workspaceReducer(s0, { type: 'togglePlay' })
    expect(playing.playing).toBe(true)
    expect(workspaceReducer(playing, { type: 'stopPlaying' }).playing).toBe(false)
  })
})

describe('map data derivation', () => {
  const data = analysis()
  const prepared = prepareRoutes(data.routes)

  it('draws every route and colours the selected one by checkpoint risk', () => {
    expect(routeLines(prepared).features).toHaveLength(2)
    const segments = riskSegments(prepared[1])
    expect(segments.features.map((f) => f.properties.level)).toEqual(['low', 'severe', 'high'])
    expect(segments.features.every((f) => (f.geometry.coordinates.length ?? 0) >= 2)).toBe(true)
    expect(riskSegments(undefined).features).toEqual([])
  })

  it('flags the active checkpoint and the selected route', () => {
    const points = checkpointPoints(prepared, 'r2', 1).features
    expect(points).toHaveLength(6)
    expect(points.filter((p) => p.properties.active)).toHaveLength(1)
    expect(points.filter((p) => p.properties.onSelectedRoute)).toHaveLength(3)
  })

  it('heat weights follow the chosen hour and metric; missing forecasts draw nothing', () => {
    const risk = heatPoints(prepared, 0, 'risk').features.map((f) => f.properties.w as number)
    expect(Math.min(...risk)).toBeCloseTo(0.06) // calm but known => faint wash
    expect(Math.max(...risk)).toBeCloseTo(0.06 + 0.94 * 0.75) // Severe = 3/4
    const unknown = analysis({ routes: [route('r1', 'R', [null, 'low'])] })
    const w = heatPoints(prepareRoutes(unknown.routes), 0, 'wind').features.map((f) => f.properties.w as number)
    expect(w[0]).toBe(0)
    expect(w[1]).toBeGreaterThan(0)
  })

  it('finds the worst risk per forecast hour', () => {
    const peaks = peakLevelsByHour(data.routes[1]!, 48)
    expect(peaks).toHaveLength(49)
    expect(peaks.every((p) => p === 3)).toBe(true)
    expect(peakLevelsByHour(route('x', 'X', [null]), 2)).toEqual([null, null, null])
  })

  it('places the truck along the route by elapsed time and hides it after arrival', () => {
    const r = prepared[0]!
    expect(truckPosition(r, 0)).toEqual(r.path.coords[0])
    expect(truckPosition(r, 1)).not.toBeNull()
    expect(truckPosition(r, 10)).toBeNull()
  })
})
