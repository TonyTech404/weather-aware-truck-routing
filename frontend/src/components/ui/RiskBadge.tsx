import { NO_FORECAST, RISK } from '@/lib/risk'
import type { RiskLevel } from '@/types/api'
import { cn } from '@/lib/cn'

interface Props {
  level: RiskLevel | null
  className?: string
}

/** Risk is always shown as colour AND text. */
export function RiskBadge({ level, className }: Props) {
  const meta = level ? RISK[level] : NO_FORECAST
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', className)}
      style={{ background: meta.tint, color: meta.ink }}
    >
      <span aria-hidden className="size-2 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}
