import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'

/** CARTO Positron: a light, low-contrast basemap that keeps overlays legible. No API key. */
export const BASEMAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

/** Used when the basemap cannot load (offline, blocked); overlays still render. */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9edf0' } }],
}

const METERS_PER_PIXEL_AT_Z0 = 156543.03 * Math.cos((38 * Math.PI) / 180)

/** Heatmap kernel radius in pixels so neighbouring checkpoints blend into one corridor. */
export function heatRadius(intervalMi: number): ExpressionSpecification {
  // Kernel radius ~1.6x the spacing: neighbours overlap into a continuous corridor.
  const radiusMeters = intervalMi * 1609.34 * 1.6
  const stops = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap((zoom) => [
    zoom,
    Math.min(220, Math.max(8, radiusMeters / (METERS_PER_PIXEL_AT_Z0 / 2 ** zoom))),
  ])
  return ['interpolate', ['linear'], ['zoom'], ...stops] as ExpressionSpecification
}

export const HEAT_COLOR: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['heatmap-density'],
  0,
  'rgba(47,158,110,0)',
  0.06,
  'rgba(47,158,110,0.32)',
  0.22,
  'rgba(224,176,31,0.55)',
  0.42,
  'rgba(236,125,34,0.66)',
  0.66,
  'rgba(213,64,63,0.74)',
  1,
  'rgba(58,16,48,0.82)',
]
