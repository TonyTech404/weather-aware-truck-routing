import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckpointInspector } from '@/components/map/CheckpointInspector'
import { ForecastTimeline } from '@/components/map/ForecastTimeline'
import { ResultsPanel } from '@/components/ResultsPanel'
import { RouteComparison } from '@/components/RouteComparison'
import { RouteDetail } from '@/components/RouteDetail'
import { RouteList } from '@/components/RouteList'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { ApiError } from '@/lib/api'
import { initialWorkspace } from '@/state/workspace'
import { analysis, checkpoint, route } from '@/test/fixtures'

describe('RiskBadge', () => {
  it('always pairs colour with a text label', () => {
    const { rerender } = render(<RiskBadge level="severe" />)
    expect(screen.getByText('Severe')).toBeInTheDocument()
    rerender(<RiskBadge level="no_travel" />)
    expect(screen.getByText('No Travel')).toBeInTheDocument()
    rerender(<RiskBadge level={null} />)
    expect(screen.getByText('No forecast')).toBeInTheDocument()
  })
})

describe('RouteList', () => {
  const data = analysis()
  const setup = (selectedId = 'r1', onSelect = vi.fn()) => {
    render(
      <RouteList routes={data.routes} recommendation={data.recommendation} selectedId={selectedId} timezone="America/Chicago" onSelect={onSelect} />,
    )
    return onSelect
  }

  it('marks the recommended and fastest routes and shows trip numbers', () => {
    setup()
    const first = screen.getByTestId('route-r1')
    expect(within(first).getByText('Recommended')).toBeInTheDocument()
    expect(within(first).getByText('3 h 00 min')).toBeInTheDocument()
    expect(within(first).getByText('75 mi')).toBeInTheDocument()
    // r2 is faster (10,000 s) than r1 (10,800 s)
    expect(within(screen.getByTestId('route-r2')).getByText('Fastest')).toBeInTheDocument()
  })

  it('reflects the selection and lets the user switch routes', async () => {
    const onSelect = setup('r1')
    expect(screen.getByTestId('route-r1')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('route-r2')).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByTestId('route-r2'))
    expect(onSelect).toHaveBeenCalledWith('r2')
  })

  it('summarises severe miles in text', () => {
    setup()
    expect(within(screen.getByTestId('route-r2')).getByText('25 mi severe or worse')).toBeInTheDocument()
    expect(within(screen.getByTestId('route-r1')).getByText('No severe or high-risk miles')).toBeInTheDocument()
  })

  it('labels a prohibited route', () => {
    const blocked = route('r3', 'Route 3', ['no_travel'], { ranking: { rank: 3, prohibited: true, values: { ...data.routes[0]!.ranking.values, no_travel_mi: 25 } } })
    render(<RouteList routes={[blocked]} recommendation={data.recommendation} selectedId="r3" timezone="UTC" onSelect={() => {}} />)
    expect(screen.getByText('No Travel', { selector: 'span.rounded-sm' })).toBeInTheDocument()
  })
})

describe('RouteComparison', () => {
  it('shows every criterion and highlights the deciding one', () => {
    const data = analysis()
    render(<RouteComparison routes={data.routes} recommendation={data.recommendation} />)
    const rows = screen.getAllByRole('row')
    const severe = rows.find((r) => /Severe miles/.test(r.textContent ?? ''))!
    expect(severe).toHaveTextContent('decides')
    expect(severe).toHaveTextContent('0.0 mi')
    expect(severe).toHaveTextContent('25 mi')
    // No Travel row is hidden when no route has No Travel miles.
    expect(rows.some((r) => /No Travel miles/.test(r.textContent ?? ''))).toBe(false)
  })
})

describe('RouteDetail', () => {
  it('breaks the distance down by risk level with text', () => {
    render(<RouteDetail route={analysis().routes[1]!} />)
    expect(screen.getByText('Severe').closest('div')).toHaveTextContent('25 mi')
    expect(screen.getByText(/average risk 1\.67/i)).toBeInTheDocument()
  })

  it('calls out No Travel stretches and unscored miles', () => {
    const r = route('r9', 'Route 9', ['low', 'no_travel', null], {
      stats: { miles: { low: 25, moderate: 0, high: 0, severe: 0, no_travel: 25, unknown: 25 }, avg_risk: 2, peak_level: 'no_travel', no_travel_segments: [[12.5, 37.5]] },
    })
    render(<RouteDetail route={r} />)
    expect(screen.getByText(/no travel conditions at mile 13–38/i)).toBeInTheDocument()
    expect(screen.getByText(/beyond the forecast horizon/i)).toBeInTheDocument()
  })
})

describe('ForecastTimeline', () => {
  const base = {
    route: analysis().routes[1]!,
    hours: 48,
    hour: 0,
    departureUtc: '2026-11-03T14:00:00Z',
    timezone: 'America/Chicago',
    playing: false,
    metric: 'risk' as const,
    onHour: vi.fn(),
    onTogglePlay: vi.fn(),
    onMetric: vi.fn(),
  }

  it('shows the local time of the selected forecast hour', () => {
    render(<ForecastTimeline {...base} hour={6} />)
    expect(screen.getByTestId('timeline-label')).toHaveTextContent('Tue 2:00 PM CST')
    expect(screen.getByTestId('timeline-label')).toHaveTextContent('6 h after departure')
  })

  // Native arrow-key stepping is a browser feature, so it is exercised in the Playwright suite.
  it('exposes an accessible 0-48 h slider that reports changes', () => {
    const onHour = vi.fn()
    render(<ForecastTimeline {...base} onHour={onHour} />)
    const slider = screen.getByRole('slider', { name: /forecast hour/i })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '48')
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('0 hours after departure'))
    fireEvent.change(slider, { target: { value: '7' } })
    expect(onHour).toHaveBeenCalledWith(7)
  })

  it('toggles playback and switches the heatmap metric', async () => {
    const onTogglePlay = vi.fn()
    const onMetric = vi.fn()
    const { rerender } = render(<ForecastTimeline {...base} onTogglePlay={onTogglePlay} onMetric={onMetric} />)
    await userEvent.click(screen.getByRole('button', { name: /play forecast animation/i }))
    expect(onTogglePlay).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('radio', { name: 'Wind' }))
    expect(onMetric).toHaveBeenCalledWith('wind')
    rerender(<ForecastTimeline {...base} playing metric="wind" />)
    expect(screen.getByRole('button', { name: /pause forecast animation/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Wind' })).toBeChecked()
  })

  it('reports the corridor peak risk for the hour', () => {
    render(<ForecastTimeline {...base} />)
    expect(screen.getByTestId('timeline-label')).toHaveTextContent('corridor peak Severe')
  })

  it('uses a select for the metric on small screens', async () => {
    const onMetric = vi.fn()
    render(<ForecastTimeline {...base} compact onMetric={onMetric} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /heatmap shows/i }), 'rain')
    expect(onMetric).toHaveBeenCalledWith('rain')
  })
})

describe('CheckpointInspector', () => {
  const r = analysis().routes[1]!
  const props = { route: r, hour: 2, timezone: 'America/Chicago', departureUtc: '2026-11-03T14:00:00Z', onClose: vi.fn(), onStep: vi.fn() }

  it('shows ETA, risk, readings and the forecast at the slider hour', () => {
    render(<CheckpointInspector {...props} checkpoint={r.checkpoints[1]!} />)
    expect(screen.getByTestId('inspector-eta')).toHaveTextContent('Tue 9:00 AM CST')
    expect(screen.getAllByText('Severe').length).toBeGreaterThan(0)
    expect(screen.getByText(/driven by wind/i)).toBeInTheDocument()
    expect(screen.getByTestId('inspector-slot')).toHaveTextContent('Tue 10:00 AM CST')
  })

  it('explains load rules when they raised the level', () => {
    const cp = checkpoint(1, 25, 'no_travel', { risk: { ...r.checkpoints[1]!.risk, level: 'no_travel', load_rule: 'Wind 45-54 mph with a load over 30,000 lb is No Travel' } })
    render(<CheckpointInspector {...props} checkpoint={cp} />)
    expect(screen.getByTestId('load-rule')).toHaveTextContent('load over 30,000 lb')
  })

  it('is honest when no forecast exists', () => {
    render(<CheckpointInspector {...props} checkpoint={checkpoint(2, 50, null)} />)
    expect(screen.getByText(/no forecast is available for this arrival time/i)).toBeInTheDocument()
    expect(screen.getByText(/no forecast at this hour/i)).toBeInTheDocument()
  })

  it('steps between checkpoints and closes', async () => {
    const onStep = vi.fn()
    const onClose = vi.fn()
    render(<CheckpointInspector {...props} onStep={onStep} onClose={onClose} checkpoint={r.checkpoints[1]!} />)
    await userEvent.click(screen.getByRole('button', { name: /next checkpoint/i }))
    await userEvent.click(screen.getByRole('button', { name: /previous checkpoint/i }))
    expect(onStep.mock.calls).toEqual([[1], [-1]])
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /close checkpoint details/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('disables stepping past the ends', () => {
    render(<CheckpointInspector {...props} checkpoint={r.checkpoints[0]!} />)
    expect(screen.getByRole('button', { name: /previous checkpoint/i })).toBeDisabled()
  })
})

describe('ResultsPanel', () => {
  const noop = () => {}
  const base = { loading: false, error: null, ws: { ...initialWorkspace, routeId: 'r1' }, dispatch: noop, inspector: null, onRetry: noop, onPreset: noop }

  it('invites a first trip and offers one-click examples', async () => {
    const onPreset = vi.fn()
    render(<ResultsPanel {...base} data={null} onPreset={onPreset} />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /dallas to atlanta/i }))
    expect(onPreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'dal-atl' }))
  })

  it('shows a loading state while analyzing', () => {
    render(<ResultsPanel {...base} data={null} loading />)
    expect(screen.getByTestId('loading-state')).toHaveTextContent(/finding routes/i)
  })

  it('shows the recommendation, routes, and the honest route count', () => {
    render(<ResultsPanel {...base} data={analysis()} />)
    expect(screen.getByTestId('recommendation')).toHaveTextContent('Route 1 is the safest option')
    expect(screen.getByTestId('recommendation')).toHaveTextContent('fewest Severe miles')
    expect(screen.getByText(/only 2 distinct routes found/i)).toBeInTheDocument()
    expect(screen.getByTestId('trip-summary')).toHaveTextContent('Dallas, Texas → Atlanta, Georgia · 42,000 lb · departs Tue 8:00 AM CST')
  })

  it('does not call a fully prohibited trip safe', () => {
    const data = analysis()
    data.recommendation = { ...data.recommendation, status: 'all_prohibited', reasons: ['Every route crosses No Travel conditions.'] }
    render(<ResultsPanel {...base} data={data} />)
    expect(screen.getByTestId('recommendation')).toHaveTextContent('No safe route at this time')
    expect(screen.queryByText(/is the safest option/i)).not.toBeInTheDocument()
  })

  it('discloses a car-profile fallback', () => {
    const data = analysis()
    data.meta.routing = { provider: 'OSRM', profile: 'car', notes: ['Car-profile routes are shown.'] }
    render(<ResultsPanel {...base} data={data} />)
    expect(screen.getByRole('note')).toHaveTextContent('Car-profile routes are shown.')
    expect(screen.getByText(/OSRM \(car profile\)/)).toBeInTheDocument()
  })

  it('presents errors with a retry for transient failures only', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ResultsPanel {...base} data={null} error={new ApiError('weather_unavailable', 'The weather provider is unavailable right now.', 502)} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('weather provider is unavailable')
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalled()

    rerender(<ResultsPanel {...base} data={null} error={new ApiError('no_route', 'No drivable route found.', 404)} />)
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('keeps previous results visible, dimmed, behind an error', () => {
    render(<ResultsPanel {...base} data={analysis()} error={new ApiError('network', 'Could not reach the RouteGuard API.')} />)
    expect(screen.getByText(/showing your previous results/i)).toBeInTheDocument()
    expect(screen.getByTestId('recommendation')).toBeInTheDocument()
  })

  it('lets the user switch routes and inspect checkpoints', async () => {
    const dispatch = vi.fn()
    render(<ResultsPanel {...base} data={analysis()} dispatch={dispatch} />)
    await userEvent.click(screen.getByTestId('route-r2'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'selectRoute', routeId: 'r2' })
    await userEvent.click(within(screen.getByTestId('checkpoint-list')).getAllByRole('button')[1]!)
    expect(dispatch).toHaveBeenCalledWith({ type: 'selectCheckpoint', index: 1 })
  })
})
