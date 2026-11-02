import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadField } from '@/components/LoadField'
import { PlaceField } from '@/components/PlaceField'
import { TripForm } from '@/components/TripForm'
import * as api from '@/lib/api'
import type { TripFormValues } from '@/lib/validation'
import type { Place } from '@/types/api'

const dallas: Place = { label: 'Dallas, Texas', lat: 32.78, lon: -96.8, kind: 'city' }
const atlanta: Place = { label: 'Atlanta, Georgia', lat: 33.75, lon: -84.39, kind: 'city' }

function soon() {
  const d = new Date(Date.now() + 3 * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`
}

function Harness(props: Partial<React.ComponentProps<typeof TripForm>> & { initial?: Partial<TripFormValues> }) {
  const [values, setValues] = useState<TripFormValues>({
    origin: dallas,
    destination: atlanta,
    departure: soon(),
    loadLb: '42000',
    interval: 25,
    ...props.initial,
  })
  return (
    <TripForm
      values={values}
      onChange={setValues}
      fieldsKey={0}
      serverErrors={{}}
      loading={false}
      onSubmit={() => {}}
      onSwap={() => {}}
      {...props}
    />
  )
}

describe('TripForm', () => {
  it('submits a valid trip as an API request', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: /analyze routes/i }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      origin: { label: 'Dallas, Texas' },
      destination: { label: 'Atlanta, Georgia' },
      load_lb: 42000,
      interval_mi: 25,
    })
  })

  it('blocks submission and explains each problem', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} initial={{ origin: null, destination: null, loadLb: '-5' }} />)
    await userEvent.click(screen.getByRole('button', { name: /analyze routes/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/origin/i),
        expect.stringMatching(/destination/i),
        expect.stringMatching(/between 0 and 80,000/),
      ]),
    )
  })

  it('shows field errors returned by the server', () => {
    render(<Harness serverErrors={{ departure: 'Departure is in the past.' }} />)
    expect(screen.getByText('Departure is in the past.')).toBeInTheDocument()
  })

  it('shows progress and disables the button while loading', () => {
    render(<Harness loading />)
    const button = screen.getByRole('button', { name: /analyzing routes/i })
    expect(button).toBeDisabled()
  })

  it('changes the checkpoint interval', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('radio', { name: '50 mi' }))
    expect(screen.getByRole('radio', { name: '50 mi' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '25 mi' })).not.toBeChecked()
  })

  it('swaps origin and destination via the callback', async () => {
    const onSwap = vi.fn()
    render(<Harness onSwap={onSwap} />)
    await userEvent.click(screen.getByRole('button', { name: /swap origin and destination/i }))
    expect(onSwap).toHaveBeenCalled()
  })
})

describe('LoadField', () => {
  it('explains which load rules apply at the current weight', () => {
    const { rerender } = render(<LoadField value="20000" onChange={() => {}} />)
    expect(screen.getByText(/no load-based wind escalation/i)).toBeInTheDocument()
    rerender(<LoadField value="35000" onChange={() => {}} />)
    expect(screen.getByText(/over 30,000 lb: 45–54 mph wind counts as no travel/i)).toBeInTheDocument()
    rerender(<LoadField value="45000" onChange={() => {}} />)
    expect(screen.getByText(/35–44 mph wind counts as severe/i)).toBeInTheDocument()
  })

  it('keeps the slider and the number box in sync', async () => {
    const onChange = vi.fn()
    render(<LoadField value="30000" onChange={onChange} />)
    expect(screen.getByRole('slider', { name: /load weight/i })).toHaveValue('30000')
    await userEvent.type(screen.getByRole('textbox', { name: /load weight/i }), '1')
    expect(onChange).toHaveBeenLastCalledWith('300001')
  })
})

describe('PlaceField', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('searches as you type and selects with the keyboard', async () => {
    vi.spyOn(api, 'searchPlaces').mockResolvedValue([dallas, { ...dallas, label: 'Dallas, Iowa', lat: 41.7 }])
    const onChange = vi.fn()
    render(<PlaceField label="Origin" marker="A" value={null} onChange={onChange} />)
    const input = screen.getByRole('combobox', { name: 'Origin' })
    await userEvent.type(input, 'Dall')
    const list = await screen.findByRole('listbox', { name: /origin suggestions/i })
    expect(await within(list).findAllByRole('option')).toHaveLength(2)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ label: 'Dallas, Iowa' }))
    expect(api.searchPlaces).toHaveBeenCalledWith('Dall', expect.any(AbortSignal))
  })

  it('reports no matches and search failures', async () => {
    const spy = vi.spyOn(api, 'searchPlaces').mockResolvedValueOnce([])
    render(<PlaceField label="Destination" marker="B" value={null} onChange={() => {}} />)
    await userEvent.type(screen.getByRole('combobox'), 'zzzz')
    expect(await screen.findByText(/no matches found/i)).toBeInTheDocument()

    spy.mockRejectedValueOnce(new Error('down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await userEvent.clear(screen.getByRole('combobox'))
    await userEvent.type(screen.getByRole('combobox'), 'qqqq')
    await waitFor(() => expect(screen.getByText(/search is unavailable/i)).toBeInTheDocument())
  })

  it('clears a previous choice when the text is edited', async () => {
    const onChange = vi.fn()
    render(<PlaceField label="Origin" marker="A" value={dallas} onChange={onChange} />)
    await userEvent.type(screen.getByRole('combobox'), 'x')
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('does not search for a single character', async () => {
    const spy = vi.spyOn(api, 'searchPlaces').mockResolvedValue([])
    render(<PlaceField label="Origin" marker="A" value={null} onChange={() => {}} />)
    await userEvent.type(screen.getByRole('combobox'), 'a')
    await new Promise((r) => setTimeout(r, 350))
    expect(spy).not.toHaveBeenCalled()
  })
})
