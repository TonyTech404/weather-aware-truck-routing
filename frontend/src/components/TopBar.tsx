import { BookOpenText } from 'lucide-react'

interface Props {
  onOpenMethodology: () => void
}

export function TopBar({ onOpenMethodology }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <img src="/favicon.svg" alt="" className="size-6 rounded-md" />
        <span className="text-[15px] font-semibold tracking-tight">RouteGuard</span>
        <span className="hidden h-4 w-px bg-line-strong sm:block" aria-hidden />
        <span className="hidden truncate text-sm text-ink-500 sm:block">Safer routes. Smarter deliveries.</span>
      </div>
      <button
        type="button"
        onClick={onOpenMethodology}
        className="flex h-[42px] items-center gap-1.5 rounded-md border border-line px-3 text-sm lg:h-9 text-ink-700 hover:bg-canvas"
      >
        <BookOpenText className="size-4" aria-hidden />
        <span>Methodology</span>
      </button>
    </header>
  )
}
