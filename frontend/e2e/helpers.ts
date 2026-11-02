import { expect, test as base, type Page } from '@playwright/test'

type MapState = {
  routes: number
  risk: number
  checkpoints: number
  heat: number[]
  riskRouteLabel: string
}

declare global {
  interface Window {
    __routeguard?: {
      map: { project(lngLat: [number, number]): { x: number; y: number }; getZoom(): number }
      sourceFeatures(id: string): { geometry: { coordinates: unknown }; properties: Record<string, unknown> }[]
    }
  }
}

/** Blocks the external basemap so tests are offline-safe and exercise the fallback style. */
export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.route(/cartocdn\.com/, (route) => route.abort())
    await provide(page)
  },
})
export { expect }

/** "YYYY-MM-DDTHH:00" in Chicago for `offsetHours` from now: the fake world's origin timezone. */
export function chicagoLocal(offsetHours = 1): string {
  const when = new Date(Date.now() + offsetHours * 3_600_000)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(when)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`
}

export async function pickPlace(page: Page, field: 'Origin' | 'Destination', query: string, option: RegExp) {
  const input = page.getByRole('combobox', { name: field })
  await input.fill(query)
  await page.getByRole('option', { name: option }).click()
  await expect(input).toHaveValue(/.+/)
}

export interface TripOptions {
  load?: string
  interval?: '10 mi' | '25 mi' | '50 mi'
}

export async function fillTrip(page: Page, { load = '20000', interval = '50 mi' }: TripOptions = {}) {
  await page.goto('/')
  await pickPlace(page, 'Origin', 'Dallas', /Dallas, Texas/)
  await pickPlace(page, 'Destination', 'Atlanta', /Atlanta, Georgia/)
  await page.getByLabel(/^Departure/).fill(chicagoLocal(1))
  await page.getByRole('textbox', { name: /load weight/i }).fill(load)
  await page.getByRole('radio', { name: interval }).click()
}

export async function analyze(page: Page) {
  await page.getByRole('button', { name: /analyze routes/i }).click()
  await expect(page.getByTestId('recommendation')).toBeVisible()
  await expect(page.getByTestId('map-summary')).toHaveText(/routes? drawn/)
}

export async function planTrip(page: Page, options: TripOptions = {}) {
  await fillTrip(page, options)
  await analyze(page)
}

/** What is actually drawn on the map, read from the live MapLibre sources. */
export async function mapState(page: Page): Promise<MapState> {
  return page.evaluate(() => {
    const rg = window.__routeguard!
    const heat = rg.sourceFeatures('heat').map((f) => Number(f.properties.w))
    return {
      routes: rg.sourceFeatures('routes').length,
      risk: rg.sourceFeatures('risk').length,
      checkpoints: rg.sourceFeatures('checkpoints').length,
      heat,
      riskRouteLabel: '',
    }
  })
}

export async function waitForMapData(page: Page) {
  await expect.poll(async () => (await mapState(page)).routes, { timeout: 20_000 }).toBeGreaterThan(0)
}
