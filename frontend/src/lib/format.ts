const FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts)
  let f = FORMATTERS.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts })
    FORMATTERS.set(key, f)
  }
  return f
}

/** "Tue 2:30 PM" in the given IANA timezone. */
export function formatClock(iso: string | Date, tz: string): string {
  return formatter(tz, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(
    typeof iso === 'string' ? new Date(iso) : iso,
  )
}

/** "CST" / "EDT" for the timezone at that instant. */
export function zoneAbbreviation(iso: string | Date, tz: string): string {
  const parts = formatter(tz, { timeZoneName: 'short' }).formatToParts(
    typeof iso === 'string' ? new Date(iso) : iso,
  )
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz
}

export function formatClockWithZone(iso: string | Date, tz: string): string {
  return `${formatClock(iso, tz)} ${zoneAbbreviation(iso, tz)}`
}

/** "Mon, Nov 2" */
export function formatDay(iso: string | Date, tz: string): string {
  return formatter(tz, { weekday: 'short', month: 'short', day: 'numeric' }).format(
    typeof iso === 'string' ? new Date(iso) : iso,
  )
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

export function formatMiles(miles: number): string {
  if (miles >= 100) return `${Math.round(miles).toLocaleString('en-US')} mi`
  return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`
}

export function formatPounds(lb: number): string {
  return `${Math.round(lb).toLocaleString('en-US')} lb`
}

export function formatHourOffset(hours: number): string {
  return hours === 0 ? 'Departure' : `+${hours} h`
}

/** Value for <input type="datetime-local"> from a Date in the browser's local zone. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
