import { ChevronsUp, ListChecks, Map as MapIcon, Route as RouteIcon, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { MobileView } from '@/state/workspace'

const SECTIONS = [
  { id: 'sec-trip', label: 'Trip', Icon: SlidersHorizontal },
  { id: 'sec-routes', label: 'Routes', Icon: RouteIcon },
  { id: 'sec-detail', label: 'Risk', Icon: ShieldAlert },
  { id: 'sec-checkpoints', label: 'Checkpoints', short: 'Points', Icon: ListChecks },
] as const

interface Props {
  view: MobileView
  onView: (view: MobileView) => void
}

/**
 * Phone-only bar pinned to the top of the planner: jump between sections, or switch how much of
 * the screen the map gets. Five equal columns, so nothing ever scrolls sideways.
 */
export function SectionNav({ view, onView }: Props) {
  const expanded = view === 'panel'
  return (
    <nav
      aria-label="Jump to section"
      className="sticky top-0 z-20 grid grid-cols-5 gap-1 border-b border-line bg-canvas/95 px-2 py-1.5 backdrop-blur"
    >
      <button
        type="button"
        onClick={() => onView(expanded ? 'split' : 'panel')}
        aria-label={expanded ? 'Show the map again' : 'Expand details to full screen'}
        className="flex h-[46px] flex-col items-center justify-center gap-0.5 rounded-lg bg-brand-700 text-[11px] font-medium text-white active:bg-brand-800"
      >
        {expanded ? <MapIcon className="size-[18px]" aria-hidden /> : <ChevronsUp className="size-[18px]" aria-hidden />}
        {expanded ? 'Map' : 'Expand'}
      </button>
      {SECTIONS.map(({ id, label, Icon, ...rest }) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          }}
          className={cn(
            'flex h-[46px] flex-col items-center justify-center gap-0.5 rounded-lg border border-line-strong bg-surface text-[11px] font-medium text-ink-700 active:bg-brand-50',
          )}
        >
          <Icon className="size-[18px] text-brand-700" aria-hidden />
          {'short' in rest ? (
            <>
              <span className="hidden min-[360px]:inline">{label}</span>
              <span className="min-[360px]:hidden">{rest.short}</span>
            </>
          ) : (
            label
          )}
        </button>
      ))}
    </nav>
  )
}
