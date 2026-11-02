import { useReducer, useState } from 'react'
import { CheckpointInspector } from '@/components/map/CheckpointInspector'
import { MapWorkspace } from '@/components/map/MapWorkspace'
import { MethodologyDialog } from '@/components/MethodologyDialog'
import { ResultsPanel } from '@/components/ResultsPanel'
import { TopBar } from '@/components/TopBar'
import { TripForm } from '@/components/TripForm'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { toLocalInputValue } from '@/lib/format'
import type { TripPreset } from '@/lib/presets'
import { toRequest, type TripFormValues } from '@/lib/validation'
import { initialWorkspace, workspaceReducer } from '@/state/workspace'
import type { AnalysisResponse, AnalyzeRequest } from '@/types/api'

function nextHour(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return toLocalInputValue(d)
}

const initialValues = (): TripFormValues => ({
  origin: null,
  destination: null,
  departure: nextHour(),
  loadLb: '42000',
  interval: 25,
})

export default function App() {
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [values, setValues] = useState<TripFormValues>(initialValues)
  const [fieldsKey, setFieldsKey] = useState(0)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const { state, run } = useAnalysis()
  const [ws, dispatch] = useReducer(workspaceReducer, initialWorkspace)

  // Keep the last successful analysis on screen while a new one loads or fails.
  const [shown, setShown] = useState<AnalysisResponse | null>(null)
  if (state.status === 'success' && state.data !== shown) {
    setShown(state.data)
    dispatch({ type: 'reset', routeId: state.data.recommendation.route_id ?? state.data.routes[0]?.id ?? null })
  }

  const loading = state.status === 'loading'
  const error = state.status === 'error' ? state.error : null
  const serverFields = error?.code === 'validation_error' ? error.fields : {}
  const lastRequest = state.status === 'idle' ? null : state.request

  const selectedRoute = shown?.routes.find((r) => r.id === ws.routeId)
  const selectedCp = selectedRoute && ws.checkpoint != null ? selectedRoute.checkpoints[ws.checkpoint] : undefined
  const inspector =
    shown && selectedRoute && selectedCp && !desktop ? (
      <CheckpointInspector
        route={selectedRoute}
        checkpoint={selectedCp}
        hour={ws.hour}
        timezone={shown.request.timezone}
        departureUtc={shown.request.departure_utc}
        onClose={() => dispatch({ type: 'selectCheckpoint', index: null })}
        onStep={(delta) => {
          const next = selectedCp.index + delta
          if (next >= 0 && next < selectedRoute.checkpoints.length) dispatch({ type: 'selectCheckpoint', index: next })
        }}
      />
    ) : null

  function applyPreset(preset: TripPreset) {
    const next: TripFormValues = {
      ...values,
      origin: preset.origin,
      destination: preset.destination,
      loadLb: String(preset.loadLb),
      departure: nextHour(),
    }
    setValues(next)
    setFieldsKey((k) => k + 1)
    run(toRequest(next))
  }

  function swap() {
    setValues((v) => ({ ...v, origin: v.destination, destination: v.origin }))
    setFieldsKey((k) => k + 1)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar onOpenMethodology={() => setMethodologyOpen(true)} />
      <div className="grid min-h-0 flex-1 grid-rows-[38dvh_1fr] lg:grid-cols-[400px_1fr] lg:grid-rows-1">
        <main className="relative order-1 min-h-0 lg:order-2" aria-label="Map">
          <MapWorkspace
            data={shown}
            ws={ws}
            dispatch={dispatch}
            endpoints={{ origin: values.origin, destination: values.destination }}
            intervalMi={shown?.request.interval_mi ?? values.interval}
            busy={loading}
            compact={!desktop}
            inspectorOnMap={desktop}
          />
        </main>
        <aside className="order-2 min-h-0 overflow-y-auto border-t border-line bg-canvas lg:order-1 lg:border-t-0 lg:border-r" aria-label="Trip planner">
          <div className="border-b border-line bg-surface">
            <TripForm
              values={values}
              onChange={setValues}
              fieldsKey={fieldsKey}
              serverErrors={serverFields}
              loading={loading}
              onSubmit={run}
              onSwap={swap}
            />
          </div>
          <div className="pt-3">
            <ResultsPanel
              data={shown}
              loading={loading}
              error={error}
              ws={ws}
              dispatch={dispatch}
              inspector={inspector}
              onRetry={() => lastRequest && retry(lastRequest)}
              onPreset={applyPreset}
            />
          </div>
        </aside>
      </div>
      <MethodologyDialog open={methodologyOpen} onClose={() => setMethodologyOpen(false)} />
    </div>
  )

  function retry(request: AnalyzeRequest) {
    run(request)
  }
}
