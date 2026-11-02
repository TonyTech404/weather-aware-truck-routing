import { lazy, Suspense, useEffect, useMemo, useState, type Dispatch, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { CheckpointInspector } from '@/components/map/CheckpointInspector'
import { ForecastTimeline } from '@/components/map/ForecastTimeline'
import { LayerControls } from '@/components/map/LayerControls'
import { MapLegend } from '@/components/map/MapLegend'
import type { MapData } from '@/components/map/MapView'
import { checkpointPoints, heatPoints, prepareRoutes, riskSegments, routeLines, truckPosition } from '@/lib/derive'
import type { Coord } from '@/lib/geo'
import type { WorkspaceAction, WorkspaceState } from '@/state/workspace'
import type { AnalysisResponse, PlaceRef } from '@/types/api'

const MapView = lazy(() => import('@/components/map/MapView'))

interface Props {
  data: AnalysisResponse | null
  ws: WorkspaceState
  dispatch: Dispatch<WorkspaceAction>
  endpoints: { origin: PlaceRef | null; destination: PlaceRef | null }
  intervalMi: number
  busy: boolean
  compact: boolean
  /** Render the inspector over the map (desktop) instead of in the sidebar (mobile). */
  inspectorOnMap: boolean
}

export function MapWorkspace({ data, ws, dispatch, endpoints, intervalMi, busy, compact, inspectorOnMap }: Props) {
  const prepared = useMemo(() => (data ? prepareRoutes(data.routes) : []), [data])
  const selected = prepared.find((p) => p.route.id === ws.routeId)
  const selectedCp = selected && ws.checkpoint != null ? selected.route.checkpoints[ws.checkpoint] : undefined
  const hours = data?.meta.timeline_hours ?? 48
  const [fitNonce, setFitNonce] = useState(0)

  const mapData = useMemo<MapData>(
    () => ({
      routes: routeLines(prepared) as MapData['routes'],
      risk: riskSegments(selected) as MapData['risk'],
      checkpoints: checkpointPoints(prepared, ws.routeId, ws.checkpoint) as MapData['checkpoints'],
      heat: heatPoints(prepared, ws.hour, ws.metric) as MapData['heat'],
      truck: selected ? truckPosition(selected, ws.hour) : null,
    }),
    [prepared, selected, ws.routeId, ws.checkpoint, ws.hour, ws.metric],
  )
  const fitCoords = useMemo<Coord[]>(() => prepared.flatMap((p) => p.path.coords), [prepared])
  const fitKey = useMemo(() => ({ data, fitNonce }), [data, fitNonce])
  const focus = useMemo<Coord | null>(() => (selectedCp ? [selectedCp.lon, selectedCp.lat] : null), [selectedCp])

  // Forecast playback: advance one hour every 450 ms, looping.
  useEffect(() => {
    if (!ws.playing) return
    const id = setInterval(() => dispatch({ type: 'tick', max: hours }), 450)
    return () => clearInterval(id)
  }, [ws.playing, hours, dispatch])

  const step = (delta: -1 | 1) => {
    if (!selected || ws.checkpoint == null) return
    const next = ws.checkpoint + delta
    if (next >= 0 && next < selected.route.checkpoints.length) dispatch({ type: 'selectCheckpoint', index: next })
  }

  const inspector: ReactNode =
    selected && selectedCp && data ? (
      <CheckpointInspector
        route={selected.route}
        checkpoint={selectedCp}
        hour={ws.hour}
        timezone={data.request.timezone}
        departureUtc={data.request.departure_utc}
        onClose={() => dispatch({ type: 'selectCheckpoint', index: null })}
        onStep={step}
      />
    ) : null

  const timeline =
    data && selected ? (
      <ForecastTimeline
        route={selected.route}
        hours={hours}
        hour={ws.hour}
        departureUtc={data.request.departure_utc}
        timezone={data.request.timezone}
        playing={ws.playing}
        metric={ws.metric}
        onHour={(hour) => {
          dispatch({ type: 'stopPlaying' })
          dispatch({ type: 'setHour', hour })
        }}
        onTogglePlay={() => dispatch({ type: 'togglePlay' })}
        onMetric={(metric) => dispatch({ type: 'setMetric', metric })}
        compact={compact}
      />
    ) : null

  return (
    <div className="flex h-full w-full flex-col bg-[#e9edf0]">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-500">
              <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading map…
            </div>
          }
        >
          <MapView
            data={mapData}
            fitKey={fitKey}
            fitCoords={fitCoords}
            intervalMi={intervalMi}
            layers={ws.layers}
            endpoints={endpoints}
            focus={focus}
            compact={compact}
            onSelectRoute={(routeId) => dispatch({ type: 'selectRoute', routeId })}
            onSelectCheckpoint={(routeId, index) => {
              if (routeId !== ws.routeId) dispatch({ type: 'selectRoute', routeId })
              dispatch({ type: 'selectCheckpoint', index })
            }}
          />
        </Suspense>

        <div className="absolute top-2 left-2 sm:top-3 sm:left-3">
          <LayerControls
            layers={ws.layers}
            hasRoutes={prepared.length > 0}
            compact={compact}
            onToggle={(layer) => dispatch({ type: 'toggleLayer', layer })}
            onFit={() => setFitNonce((n) => n + 1)}
          />
        </div>

        {busy && (
          <div
            role="status"
            className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm shadow-md"
          >
            <LoaderCircle className="size-4 animate-spin text-brand-700" aria-hidden /> Analyzing routes…
          </div>
        )}

        {inspectorOnMap && inspector && (
          <div className="absolute top-3 right-3 z-10 max-h-[calc(100%-1.5rem)] overflow-auto">{inspector}</div>
        )}

        {!compact && timeline && (
          <div className="pointer-events-none absolute right-14 bottom-3 left-3 flex flex-col items-start gap-2">
            <div className="pointer-events-auto">
              <MapLegend metric={ws.metric} />
            </div>
            <div className="pointer-events-auto w-full max-w-[880px]">{timeline}</div>
          </div>
        )}

        {/* Screen-reader summary of what is drawn; also what the E2E suite asserts on. */}
        <p className="sr-only" role="status" data-testid="map-summary">
          {data ? `${data.routes.length} route${data.routes.length === 1 ? '' : 's'} drawn on the map.` : 'No routes drawn.'}
        </p>
      </div>

      {/* On phones the timeline is its own bar under the map so it never hides the route. */}
      {compact && timeline && <div className="shrink-0 border-t border-line-strong bg-surface px-2.5 py-2">{timeline}</div>}
    </div>
  )
}
