import type { AnalysisResponse, AnalyzeRequest, ApiErrorBody, Place } from '@/types/api'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const TIMEOUT_MS = 60_000

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly fields: Record<string, string>

  constructor(code: string, message: string, status = 0, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.fields = fields
  }

  /** Worth offering a retry: the provider or network failed, not the user's input. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500
  }
}

async function request<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (err) {
    if (signal?.aborted) throw err // caller cancelled; not an error to display
    if (timeout.aborted) throw new ApiError('timeout', 'The request took too long. Please try again.')
    throw new ApiError('network', 'Could not reach the RouteGuard API. Check your connection.')
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // fall through: non-JSON body
  }
  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error
    // A 5xx with no JSON error body comes from the platform (for example a Worker that ran
    // out of CPU), not from RouteGuard's own error handling.
    if (!error && response.status >= 500) {
      throw new ApiError('busy', 'RouteGuard is busy right now. Please try again in a moment.', response.status)
    }
    throw new ApiError(
      error?.code ?? 'http_error',
      error?.message ?? `Unexpected response (${response.status}).`,
      response.status,
      error?.fields,
    )
  }
  if (body == null) throw new ApiError('bad_response', 'The API returned an unreadable response.', response.status)
  return body as T
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const data = await request<{ results: Place[] }>(
    `/api/geocode?q=${encodeURIComponent(query)}`,
    { method: 'GET' },
    signal,
  )
  return data.results
}

export async function analyzeTrip(body: AnalyzeRequest, signal?: AbortSignal): Promise<AnalysisResponse> {
  const send = () =>
    request<AnalysisResponse>(
      '/api/analyze',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      signal,
    )
  try {
    return await send()
  } catch (err) {
    // One transparent retry for platform hiccups; the server caches routes and forecasts, so
    // the second attempt is usually much cheaper. Provider outages and rate limits are not retried.
    if (!(err instanceof ApiError) || err.code !== 'busy') throw err
    await new Promise((resolve) => setTimeout(resolve, 800))
    return send()
  }
}
