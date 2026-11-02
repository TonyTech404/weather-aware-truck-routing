import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAnalysis } from '@/hooks/useAnalysis'
import { analyzeTrip, ApiError, searchPlaces } from '@/lib/api'
import { analysis } from '@/test/fixtures'
import type { AnalyzeRequest } from '@/types/api'

const request: AnalyzeRequest = {
  origin: { label: 'A', lat: 1, lon: 1 },
  destination: { label: 'B', lat: 2, lon: 2 },
  departure: '2026-11-03T08:00',
  load_lb: 42000,
  interval_mi: 25,
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)))
  vi.stubGlobal('fetch', spy)
  return spy
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('posts the trip and returns the parsed analysis', async () => {
    const spy = mockFetch(() => json(analysis()))
    const result = await analyzeTrip(request)
    expect(result.routes).toHaveLength(2)
    const [url, init] = spy.mock.calls[0]!
    expect(url).toBe('/api/analyze')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(init!.body))).toEqual(request)
  })

  it('maps API error bodies, including field errors', async () => {
    mockFetch(() => json({ error: { code: 'validation_error', message: 'Check the highlighted fields.', fields: { load_lb: 'too heavy' } } }, 422))
    const error = await analyzeTrip(request).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'validation_error', status: 422, fields: { load_lb: 'too heavy' }, retryable: false })
  })

  it('treats upstream failures as retryable', async () => {
    mockFetch(() => json({ error: { code: 'weather_unavailable', message: 'down' } }, 502))
    expect(await analyzeTrip(request).catch((e) => e)).toMatchObject({ retryable: true })
  })

  it('reports an unreachable API and unreadable bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await analyzeTrip(request).catch((e) => e)).toMatchObject({ code: 'network', retryable: true })
    mockFetch(() => new Response('<html>oops</html>', { status: 500 }))
    expect(await analyzeTrip(request).catch((e) => e)).toMatchObject({ code: 'http_error', status: 500 })
  })

  it('encodes search queries', async () => {
    const spy = mockFetch(() => json({ results: [] }))
    await searchPlaces('St. Louis & co')
    expect(spy.mock.calls[0]![0]).toBe('/api/geocode?q=St.%20Louis%20%26%20co')
  })
})

describe('useAnalysis', () => {
  it('goes idle -> loading -> success', async () => {
    mockFetch(() => json(analysis()))
    const { result } = renderHook(() => useAnalysis())
    expect(result.current.state.status).toBe('idle')
    act(() => result.current.run(request))
    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state.status).toBe('success'))
  })

  it('ignores an identical request while loading or after success', async () => {
    const spy = mockFetch(() => json(analysis()))
    const { result } = renderHook(() => useAnalysis())
    act(() => {
      result.current.run(request)
      result.current.run({ ...request })
    })
    await waitFor(() => expect(result.current.state.status).toBe('success'))
    act(() => result.current.run(request))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('runs again when the load changes, cancelling the stale request', async () => {
    const signals: AbortSignal[] = []
    const spy = mockFetch((_url, init) => {
      signals.push(init!.signal as AbortSignal)
      return json(analysis())
    })
    const { result } = renderHook(() => useAnalysis())
    act(() => {
      result.current.run(request)
      result.current.run({ ...request, load_lb: 20000 })
    })
    await waitFor(() => expect(result.current.state.status).toBe('success'))
    expect(spy).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(spy.mock.calls[1]![1]!.body)).load_lb).toBe(20000)
    // The first request was abandoned and its result is not shown.
    expect(result.current.state.status === 'success' && result.current.state.request.load_lb).toBe(20000)
  })

  it('surfaces errors and allows retrying the same request', async () => {
    let fail = true
    const spy = mockFetch(() => (fail ? json({ error: { code: 'routing_unavailable', message: 'down' } }, 502) : json(analysis())))
    const { result } = renderHook(() => useAnalysis())
    act(() => result.current.run(request))
    await waitFor(() => expect(result.current.state.status).toBe('error'))
    fail = false
    act(() => result.current.run(request))
    await waitFor(() => expect(result.current.state.status).toBe('success'))
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
