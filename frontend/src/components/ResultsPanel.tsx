import type { ReactNode } from 'react'
import { AlertCircle, RefreshCw, Route as RouteIcon } from 'lucide-react'
import { CheckpointList } from '@/components/CheckpointList'
import { RecommendationSummary } from '@/components/RecommendationSummary'
import { RouteComparison } from '@/components/RouteComparison'
import { RouteDetail } from '@/components/RouteDetail'
import { RouteList } from '@/components/RouteList'
import { Spinner } from '@/components/ui/Spinner'
import { ApiError } from '@/lib/api'
import { formatClockWithZone, formatPounds } from '@/lib/format'
import { PRESETS, type TripPreset } from '@/lib/presets'
import type { WorkspaceAction, WorkspaceState } from '@/state/workspace'
import type { AnalysisResponse } from '@/types/api'

interface Props {
  data: AnalysisResponse | null
  loading: boolean
  error: ApiError | null
  ws: WorkspaceState
  dispatch: React.Dispatch<WorkspaceAction>
  inspector: ReactNode
  onRetry: () => void
  onPreset: (preset: TripPreset) => void
}

export function ResultsPanel({ data, loading, error, ws, dispatch, inspector, onRetry, onPreset }: Props) {
  if (!data && loading) return <LoadingState />
  if (!data && !error) return <EmptyState onPreset={onPreset} />

  return (
    <div className="space-y-3 p-4 pt-0" aria-busy={loading}>
      {error && <ErrorNotice error={error} onRetry={onRetry} hasPrevious={data != null} />}
      {data && <Results data={data} stale={loading || error != null} ws={ws} dispatch={dispatch} inspector={inspector} />}
    </div>
  )
}

function Results({
  data,
  stale,
  ws,
  dispatch,
  inspector,
}: {
  data: AnalysisResponse
  stale: boolean
  ws: WorkspaceState
  dispatch: React.Dispatch<WorkspaceAction>
  inspector: ReactNode
}) {
  const { request, meta, recommendation, routes } = data
  const selected = routes.find((r) => r.id === ws.routeId) ?? routes[0]
  const notices = meta.routing.notes
  if (!selected) return null

  return (
    <div className={stale ? 'space-y-3 opacity-60 transition-opacity' : 'space-y-3'}>
      <p className="text-xs text-ink-500" data-testid="trip-summary">
        {request.origin.label} → {request.destination.label} · {formatPounds(request.load_lb)} · departs{' '}
        {formatClockWithZone(request.departure_utc, request.timezone)}
      </p>
      <div id="sec-routes" className="scroll-mt-14 space-y-3">
      <RecommendationSummary recommendation={recommendation} routes={routes} />
      {notices.map((note) => (
        <p key={note} role="note" className="flex gap-1.5 rounded-md border border-line bg-surface p-2.5 text-xs text-ink-700">
          <AlertCircle className="mt-px size-3.5 shrink-0 text-[#97480b]" aria-hidden />
          {note}
        </p>
      ))}
      <RouteList
        routes={routes}
        recommendation={recommendation}
        selectedId={selected.id}
        timezone={request.timezone}
        onSelect={(routeId) => dispatch({ type: 'selectRoute', routeId })}
      />
      {routes.length < 3 && (
        <p className="text-xs text-ink-500">
          Only {routes.length} distinct route{routes.length === 1 ? '' : 's'} found for this trip; RouteGuard shows what the road network offers.
        </p>
      )}
      {routes.length > 1 && <RouteComparison routes={routes} recommendation={recommendation} />}
      </div>
      <div id="sec-detail" className="scroll-mt-14">
        <RouteDetail route={selected} />
      </div>
      {inspector}
      <div id="sec-checkpoints" className="scroll-mt-14">
      <CheckpointList
        route={selected}
        timezone={request.timezone}
        selectedIndex={ws.checkpoint}
        onSelect={(index) => dispatch({ type: 'selectCheckpoint', index })}
      />
      </div>
      <p className="pt-1 text-[11px] leading-snug text-ink-400">
        Routing: {meta.routing.provider} ({meta.routing.profile} profile). Forecast: {meta.weather.provider}, {meta.weather.sampling}.
        Vehicle: assumed tractor-trailer, {meta.vehicle_assumptions.tare_lb.toLocaleString('en-US')} lb empty.
      </p>
    </div>
  )
}

function EmptyState({ onPreset }: { onPreset: (preset: TripPreset) => void }) {
  return (
    <div className="px-4 pb-4" data-testid="empty-state">
      <div className="rounded-md border border-dashed border-line-strong bg-surface p-4">
        <RouteIcon className="mb-2 size-5 text-brand-700" aria-hidden />
        <h2 className="text-sm font-semibold">Compare routes by weather, not just miles</h2>
        <p className="mt-1 text-sm text-ink-500">
          Enter a trip to see up to three routes scored against the forecast at the time your truck reaches each checkpoint.
        </p>
        <p className="mt-3 mb-1.5 text-xs font-medium text-ink-500">Try an example</p>
        <ul className="space-y-1">
          {PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => onPreset(preset)}
                className="flex w-full items-center justify-between rounded-md border border-line px-2.5 py-1.5 text-left text-sm hover:bg-canvas"
              >
                {preset.title}
                <span className="text-xs text-ink-400">{formatPounds(preset.loadLb)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-3 px-4 pb-4" role="status" aria-live="polite" data-testid="loading-state">
      <p className="flex items-center gap-2 text-sm text-ink-700">
        <Spinner className="size-4 text-brand-700" /> Finding routes and reading the forecast at each checkpoint…
      </p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-md border border-line bg-surface p-3">
          <div className="h-3.5 w-1/3 rounded bg-line" />
          <div className="mt-2 h-2.5 w-2/3 rounded bg-canvas" />
          <div className="mt-3 h-1.5 w-full rounded-full bg-canvas" />
        </div>
      ))}
    </div>
  )
}

function ErrorNotice({ error, onRetry, hasPrevious }: { error: ApiError; onRetry: () => void; hasPrevious: boolean }) {
  return (
    <div role="alert" data-testid="error-notice" className="rounded-md border border-[#e9b9b8] bg-[#fdf0ef] p-3">
      <p className="flex items-start gap-2 text-sm font-medium text-[#a02323]">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {error.message}
      </p>
      {hasPrevious && <p className="mt-1 pl-6 text-xs text-ink-500">Showing your previous results below.</p>}
      {error.retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 ml-6 flex items-center gap-1.5 rounded-md border border-[#e0a9a8] bg-white px-2.5 py-1 text-xs font-medium text-[#a02323] hover:bg-[#fdf0ef]"
        >
          <RefreshCw className="size-3.5" aria-hidden /> Try again
        </button>
      )}
    </div>
  )
}
