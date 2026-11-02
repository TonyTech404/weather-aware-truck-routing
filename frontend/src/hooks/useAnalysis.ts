import { useCallback, useRef, useState } from 'react'
import { analyzeTrip, ApiError } from '@/lib/api'
import type { AnalysisResponse, AnalyzeRequest } from '@/types/api'

export type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading'; request: AnalyzeRequest }
  | { status: 'success'; request: AnalyzeRequest; data: AnalysisResponse }
  | { status: 'error'; request: AnalyzeRequest; error: ApiError }

const keyOf = (request: AnalyzeRequest) => JSON.stringify(request)

/**
 * Runs trip analyses. Re-submitting an identical request is a no-op while it is in flight
 * or after it succeeded, and starting a new analysis cancels the previous one.
 */
export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const current = useRef<{ key: string; settled: boolean } | null>(null)

  const run = useCallback((request: AnalyzeRequest) => {
    const key = keyOf(request)
    const last = current.current
    if (last && last.key === key) return // identical: in flight, or already shown
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    current.current = { key, settled: false }
    setState({ status: 'loading', request })
    analyzeTrip(request, next.signal)
      .then((data) => setState({ status: 'success', request, data }))
      .catch((err: unknown) => {
        if (next.signal.aborted) return
        current.current = null // allow retrying the same request
        setState({
          status: 'error',
          request,
          error: err instanceof ApiError ? err : new ApiError('unknown', 'Something went wrong.'),
        })
      })
  }, [])

  const reset = useCallback(() => {
    controller.current?.abort()
    current.current = null
    setState({ status: 'idle' })
  }, [])

  return { state, run, reset }
}
