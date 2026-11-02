import { ChevronDown } from 'lucide-react'
import { formatDuration, formatMiles } from '@/lib/format'
import type { CriterionKey, Recommendation, Route } from '@/types/api'

function show(key: CriterionKey, value: number): string {
  if (key === 'duration_s') return formatDuration(value)
  if (key === 'avg_risk') return value >= 99 ? 'n/a' : value.toFixed(3)
  return formatMiles(value)
}

/** The lexicographic priorities side by side, with the deciding criterion highlighted. */
export function RouteComparison({ routes, recommendation }: { routes: Route[]; recommendation: Recommendation }) {
  const ordered = [...routes].sort((a, b) => a.ranking.rank - b.ranking.rank)
  const rows = recommendation.criteria.filter(
    (c) => c.key !== 'no_travel_mi' || routes.some((r) => r.ranking.values.no_travel_mi > 0),
  )
  return (
    <details className="group rounded-md border border-line bg-surface" data-testid="comparison">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium">
        How the routes were compared
        <ChevronDown className="size-4 text-ink-500 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line px-3 pt-2 pb-3">
        <p className="mb-2 text-xs text-ink-500">
          Routes are ranked by each criterion in order; a later criterion only matters when every earlier one ties.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink-500">
                <th scope="col" className="py-1 pr-2 font-medium">
                  Priority
                </th>
                {ordered.map((r) => (
                  <th key={r.id} scope="col" className="px-1 py-1 text-right font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const values = ordered.map((r) => r.ranking.values[c.key])
                const best = Math.min(...values)
                const decisive = recommendation.decided_by === c.key
                return (
                  <tr key={c.key} className={decisive ? 'bg-brand-50' : undefined}>
                    <th scope="row" className="py-1.5 pr-2 font-normal text-ink-700">
                      {i + 1}. {c.label}
                      {decisive && <span className="ml-1 font-medium text-brand-700">decides</span>}
                    </th>
                    {ordered.map((r, j) => (
                      <td key={r.id} className={`px-1 py-1.5 text-right ${values[j] === best ? 'font-semibold' : 'text-ink-500'}`}>
                        {show(c.key, values[j]!)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  )
}
