import { ListChecks, Map as MapIcon, Route as RouteIcon, SlidersHorizontal } from 'lucide-react'

const SECTIONS = [
  { id: 'sec-trip', label: 'Trip', Icon: SlidersHorizontal },
  { id: 'sec-routes', label: 'Routes', Icon: RouteIcon },
  { id: 'sec-detail', label: 'Weather', Icon: MapIcon },
  { id: 'sec-checkpoints', label: 'Checkpoints', Icon: ListChecks },
] as const

/** Phone-only shortcut bar: jump between the form, routes, risk summary and checkpoint list. */
export function SectionNav() {
  return (
    <nav
      aria-label="Jump to section"
      className="sticky top-0 z-20 flex gap-1.5 overflow-x-auto border-b border-line bg-canvas/95 px-3 py-2 backdrop-blur"
    >
      {SECTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
          className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-sm font-medium text-ink-700 active:bg-brand-50"
        >
          <Icon className="size-4 text-brand-700" aria-hidden />
          {label}
        </button>
      ))}
    </nav>
  )
}
