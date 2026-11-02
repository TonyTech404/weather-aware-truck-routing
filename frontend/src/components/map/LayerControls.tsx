import { Layers, MapPin, Route as RouteIcon, Maximize } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { WorkspaceState } from '@/state/workspace'

interface Props {
  layers: WorkspaceState['layers']
  onToggle: (layer: keyof WorkspaceState['layers']) => void
  onFit: () => void
  hasRoutes: boolean
}

export function LayerControls({ layers, onToggle, onFit, hasRoutes }: Props) {
  const items = [
    { key: 'heatmap', label: 'Weather heatmap', Icon: Layers },
    { key: 'checkpoints', label: 'Checkpoints', Icon: MapPin },
    { key: 'alternatives', label: 'Alternative routes', Icon: RouteIcon },
  ] as const
  return (
    <div role="group" aria-label="Map layers" className="flex flex-col gap-px overflow-hidden rounded-md border border-line-strong bg-line-strong shadow-sm">
      {items.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={layers[key]}
          title={label}
          aria-label={label}
          disabled={!hasRoutes}
          onClick={() => onToggle(key)}
          className={cn(
            'flex size-9 items-center justify-center bg-surface disabled:opacity-40',
            layers[key] ? 'text-brand-700' : 'text-ink-400 hover:text-ink-700',
          )}
        >
          <Icon className="size-[18px]" />
        </button>
      ))}
      <button
        type="button"
        title="Fit routes"
        aria-label="Fit routes to view"
        disabled={!hasRoutes}
        onClick={onFit}
        className="flex size-9 items-center justify-center bg-surface text-ink-500 hover:text-ink-900 disabled:opacity-40"
      >
        <Maximize className="size-[18px]" />
      </button>
    </div>
  )
}
