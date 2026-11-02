import { useEffect, useReducer, useRef, useState } from 'react'
import { CheckpointInspector } from '@/components/map/CheckpointInspector'
import { MapWorkspace } from '@/components/map/MapWorkspace'
import { MethodologyDialog } from '@/components/MethodologyDialog'
import { ResultsPanel } from '@/components/ResultsPanel'
import { SectionNav } from '@/components/SectionNav'
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
  // Phones held sideways are only ~390 px tall: put the planner beside the map there.
  const sideBySide = useMediaQuery('(min-width: 1024px), (orientation: landscape) and (max-height: 520px)')
  const [values, setValues] = useState<TripFormValues>(initialValues)
  const [fieldsKey, setFieldsKey] = useState(0)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const { state, run } = useAnalysis()
  const [ws, dispatch] = useReducer(workspaceReducer, initialWorkspace)
  const resultsRef = useRef<HTMLDivElement>(null)

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

  // On a phone the results start below the form; bring them into view when a new analysis lands.
  useEffect(() => {
    if (shown && !desktop) resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [shown, desktop])

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
      <div
        className={`grid min-h-0 flex-1 ${
          sideBySide ? 'grid-cols-[minmax(320px,400px)_1fr] grid-rows-1' : shown ? 'grid-rows-[54dvh_1fr]' : 'grid-rows-[28dvh_1fr]'
        }`}
      >
        <main className={`relative min-h-0 ${sideBySide ? 'order-2' : 'order-1'}`} aria-label="Map">
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
        <aside
          className={`min-h-0 overflow-y-auto overscroll-contain bg-canvas ${sideBySide ? 'order-1 border-r border-line' : 'order-2 border-t border-line'}`}
          style={{ paddingBottom: inspector ? '56dvh' : undefined }}
          aria-label="Trip planner"
        >
          {shown && !desktop && <SectionNav />}
          <div id="sec-trip" className="scroll-mt-14 border-b border-line bg-surface">
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
          <div className="pt-3" ref={resultsRef}>
            <ResultsPanel
              data={shown}
              loading={loading}
              error={error}
              ws={ws}
              dispatch={dispatch}
              inspector={null}
              onRetry={() => lastRequest && retry(lastRequest)}
              onPreset={applyPreset}
            />
          </div>
        </aside>
      </div>
      {/* Phones: checkpoint details slide up as a sheet so they are never off-screen. */}
      {inspector && (
        <div className="fixed inset-x-0 bottom-0 z-40 max-h-[54dvh] overflow-y-auto rounded-t-xl border-t border-line-strong bg-surface p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(0,0,0,0.18)]">
          {inspector}
        </div>
      )}
      <MethodologyDialog open={methodologyOpen} onClose={() => setMethodologyOpen(false)} />
    </div>
  )

  function retry(request: AnalyzeRequest) {
    run(request)
  }
}
