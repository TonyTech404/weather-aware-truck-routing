import { useEffect, useState } from 'react'
import { searchPlaces } from '@/lib/api'
import { useDebounced } from '@/hooks/useDebounced'
import type { Place } from '@/types/api'

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error'

interface Settled {
  query: string
  ok: boolean
  results: Place[]
}

const cache = new Map<string, Place[]>()
const MIN_CHARS = 2

/** Debounced, cancellable place search with a small in-memory cache. */
export function usePlaceSearch(query: string, enabled: boolean): { results: Place[]; status: SearchStatus } {
  const trimmed = query.trim()
  const debounced = useDebounced(trimmed, 250)
  const [settled, setSettled] = useState<Settled | null>(null)
  const active = enabled && trimmed.length >= MIN_CHARS
  const cached = enabled ? cache.get(debounced.toLowerCase()) : undefined

  useEffect(() => {
    if (!enabled || debounced.length < MIN_CHARS || cache.has(debounced.toLowerCase())) return
    const controller = new AbortController()
    searchPlaces(debounced, controller.signal)
      .then((results) => {
        cache.set(debounced.toLowerCase(), results)
        setSettled({ query: debounced, ok: true, results })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.warn('place search failed', err)
        setSettled({ query: debounced, ok: false, results: [] })
      })
    return () => controller.abort()
  }, [debounced, enabled])

  if (!active) return { results: [], status: 'idle' }
  if (trimmed !== debounced) return { results: cached ?? [], status: cached ? 'done' : 'loading' }
  if (cached) return { results: cached, status: 'done' }
  if (settled?.query === debounced) return { results: settled.results, status: settled.ok ? 'done' : 'error' }
  return { results: [], status: 'loading' }
}
