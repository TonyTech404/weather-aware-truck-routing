import { useId, useRef, useState } from 'react'
import { LoaderCircle, MapPin, X } from 'lucide-react'
import { usePlaceSearch } from '@/hooks/usePlaceSearch'
import { cn } from '@/lib/cn'
import type { Place } from '@/types/api'

interface Props {
  label: string
  marker: 'A' | 'B'
  value: Place | null
  error?: string
  onChange: (place: Place | null) => void
}

/** Address/place search as an ARIA combobox: type, arrow through results, Enter to choose. */
export function PlaceField({ label, marker, value, error, onChange }: Props) {
  const id = useId()
  const listId = `${id}-list`
  const [text, setText] = useState(value?.label ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { results, status } = usePlaceSearch(text, open && value === null)

  function choose(place: Place) {
    setText(place.label)
    setOpen(false)
    onChange(place)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (results.length === 0) return
      e.preventDefault()
      setOpen(true)
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % results.length : (i - 1 + results.length) % results.length))
    } else if (e.key === 'Enter' && open && results[active]) {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    }
  }

  const showList = open && value === null && text.trim().length >= 2
  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-500">
        {label}
      </label>
      <div
        className={cn(
          'flex h-9 items-center gap-2 rounded-md border bg-surface pr-1.5 pl-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20',
          error ? 'border-[#d5403f]' : 'border-line-strong',
        )}
      >
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-700 text-[10px] font-semibold text-white"
        >
          {marker}
        </span>
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search city or address"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setActive(0)
            if (value) onChange(null) // editing invalidates the previous choice
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
        />
        {status === 'loading' && <LoaderCircle className="size-4 animate-spin text-ink-400" aria-label="Searching" />}
        {text && (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              setText('')
              onChange(null)
              inputRef.current?.focus()
            }}
            className="rounded p-1 text-ink-400 hover:bg-canvas hover:text-ink-700"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line-strong bg-surface py-1 shadow-md"
        >
          {results.map((place, i) => (
            <li
              key={`${place.label}-${place.lat}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(place)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-sm',
                i === active ? 'bg-brand-50' : 'hover:bg-canvas',
              )}
            >
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate">{place.label}</span>
                <span className="block text-xs text-ink-400 capitalize">{place.kind}</span>
              </span>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-ink-500" role="presentation">
              {status === 'loading' ? 'Searching…' : status === 'error' ? 'Search is unavailable. Try again.' : 'No matches found.'}
            </li>
          )}
        </ul>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-[#a02323]">
          {error}
        </p>
      )}
    </div>
  )
}
