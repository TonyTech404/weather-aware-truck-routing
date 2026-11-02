import { BANDS, RISK, RISK_LEVELS, type Metric } from '@/lib/risk'

const RAMP = 'linear-gradient(90deg, rgba(47,158,110,.6), rgba(224,176,31,.75), rgba(236,125,34,.8), rgba(213,64,63,.85), rgba(58,16,48,.9))'

export function MapLegend({ metric }: { metric: Metric }) {
  return (
    <div className="w-[196px] rounded-md border border-line-strong bg-surface/95 p-2.5 text-xs shadow-sm" data-testid="legend">
      <div className="mb-1.5 font-semibold text-ink-700">
        {metric === 'risk' ? 'Weather risk' : `${BANDS[metric].label} (${BANDS[metric].unit})`}
      </div>
      {metric === 'risk' ? (
        <ul className="space-y-1">
          {RISK_LEVELS.map((level) => (
            <li key={level} className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: RISK[level].color }} />
              {RISK[level].label}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="h-2 rounded-full" style={{ background: RAMP }} aria-hidden />
          <div className="mt-1 flex justify-between text-ink-500">
            <span>0</span>
            {BANDS[metric].stops.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
          <p className="mt-1 text-ink-500">Stops mark where Moderate, High, Severe and No Travel begin.</p>
        </>
      )}
    </div>
  )
}
