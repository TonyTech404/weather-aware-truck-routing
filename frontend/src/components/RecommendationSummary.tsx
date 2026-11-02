import { AlertOctagon, CheckCircle2, Info } from 'lucide-react'
import type { Recommendation, Route } from '@/types/api'

interface Props {
  recommendation: Recommendation
  routes: Route[]
}

export function RecommendationSummary({ recommendation, routes }: Props) {
  const best = routes.find((r) => r.id === recommendation.route_id)
  const blocked = recommendation.status === 'all_prohibited'
  const Icon = blocked ? AlertOctagon : recommendation.status === 'single_route' ? Info : CheckCircle2
  const tone = blocked
    ? { bar: '#3a1030', bg: '#f6edf3', icon: '#3a1030' }
    : { bar: '#0b4f5c', bg: '#eaf5f6', icon: '#0b4f5c' }

  return (
    <section
      aria-labelledby="rec-title"
      data-testid="recommendation"
      className="rounded-md border border-line p-3"
      style={{ background: tone.bg, borderLeft: `3px solid ${tone.bar}` }}
    >
      <h2 id="rec-title" className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 shrink-0" style={{ color: tone.icon }} aria-hidden />
        {blocked
          ? 'No safe route at this time'
          : best
            ? `${best.label} is the safest option`
            : 'No route available'}
      </h2>
      <ul className="mt-1.5 space-y-1 text-sm text-ink-700">
        {recommendation.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </section>
  )
}
