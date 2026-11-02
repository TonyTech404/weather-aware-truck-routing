import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { BANDS, RISK, RISK_LEVELS } from '@/lib/risk'

interface Props {
  open: boolean
  onClose: () => void
}

const BANDS_TABLE: { level: (typeof RISK_LEVELS)[number]; wind: string; rain: string; snow: string }[] = [
  { level: 'low', wind: '< 25', rain: '< 0.10', snow: '< 0.5' },
  { level: 'moderate', wind: '25–34', rain: '0.10–0.25', snow: '0.5–1.0' },
  { level: 'high', wind: '35–44', rain: '0.25–0.50', snow: '1.0–2.0' },
  { level: 'severe', wind: '45–54', rain: '0.50–1.00', snow: '2.0–3.0' },
  { level: 'no_travel', wind: '≥ 55', rain: '> 1.00', snow: '> 3.0' },
]

export function MethodologyDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="method-title"
      className="m-auto max-h-[88dvh] w-[min(720px,94vw)] rounded-lg border border-line-strong bg-surface p-0 text-ink-900 shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="method-title" className="text-base font-semibold">
          How RouteGuard scores a trip
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="flex size-[40px] items-center justify-center rounded text-ink-500 hover:bg-canvas lg:size-auto lg:p-1">
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-ink-700">
        <section>
          <h3 className="mb-1 font-semibold text-ink-900">Risk thresholds</h3>
          {/* Levels run down the side so all five fit a phone without sideways scrolling. */}
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="text-ink-500">
                <th className="py-1 pr-2 font-medium">Level</th>
                <th className="px-1 py-1 font-medium">Wind (mph)</th>
                <th className="px-1 py-1 font-medium">Rain (in/hr)</th>
                <th className="px-1 py-1 font-medium">Snow (in/hr)</th>
              </tr>
            </thead>
            <tbody>
              {BANDS_TABLE.map((row) => (
                <tr key={row.level} className="border-t border-line">
                  <th scope="row" className="py-1.5 pr-2 font-medium whitespace-nowrap">
                    <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: RISK[row.level].color }} />
                    {RISK[row.level].label}
                  </th>
                  <td className="px-1 py-1.5">{row.wind}</td>
                  <td className="px-1 py-1.5">{row.rain}</td>
                  <td className="px-1 py-1.5">{row.snow}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2">
            A checkpoint takes its highest hazard. On a range boundary the more severe class applies. Load rules:
            wind of 45–54 mph with a load over 30,000 lb is No Travel; 35–44 mph with a load over 40,000 lb is Severe;
            55 mph or more is No Travel at any weight.
          </p>
        </section>
        <section>
          <h3 className="mb-1 font-semibold text-ink-900">Choosing a route</h3>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>Fewest Severe miles</li>
            <li>Fewest High-risk miles</li>
            <li>Lowest distance-weighted average risk</li>
            <li>Shortest travel time</li>
          </ol>
          <p className="mt-2">
            Each criterion only matters when every earlier one ties, so speed can never offset Severe weather. A route with
            any No Travel miles is compared first and is never recommended as safe. If every route has one, RouteGuard says so.
          </p>
        </section>
        <section>
          <h3 className="mb-1 font-semibold text-ink-900">Checkpoints and forecasts</h3>
          <p>
            Checkpoints are placed every 10, 25 or 50 road miles along the routed geometry. Each one's arrival time comes from
            the routing engine's driving-time profile, and the forecast is read for the nearest hour to that arrival. Each
            checkpoint speaks for the road halfway to its neighbours, so mileage and average risk are weighted by distance. The
            heatmap and slider show the same checkpoints at departure + 0 to 48 hours. Times are shown in the origin's timezone.
          </p>
        </section>
        <section>
          <h3 className="mb-1 font-semibold text-ink-900">Limits worth knowing</h3>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>
              Truck routing uses the public Valhalla server for trips up to about 930 miles, with an assumed 53-ft tractor-trailer (13.5 ft high,
              empty weight 33,000 lb plus the load). Longer trips fall back to car-profile OSRM, labelled as such.
            </li>
            <li>The network may offer fewer than three distinct routes; RouteGuard shows what exists.</li>
            <li>Forecasts are hourly at roughly 10 km resolution and reach 15 days. Hours beyond that are not scored.</li>
            <li>Wind uses sustained 10 m speed. Gusts are shown but not scored. Snow is snowfall depth per hour.</li>
            <li>This is decision support, not dispatch authority. Always follow carrier and DOT restrictions.</li>
          </ul>
        </section>
        <p className="text-xs text-ink-400">
          Data: Valhalla and OSRM on OpenStreetMap, Open-Meteo forecasts, Photon geocoding, CARTO basemap. Wind scale max {BANDS.wind.max} mph.
        </p>
      </div>
    </dialog>
  )
}
