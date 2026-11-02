import { expect, test } from '@playwright/test'

const API = process.env.SMOKE_API_URL

/**
 * Runs after every production deploy: real browser, deployed web + API, live providers
 * (Valhalla/OSRM routing, Open-Meteo forecasts, Photon geocoding).
 */
test.describe('production smoke', () => {
  test('API is healthy and enforces CORS for the web origin', async ({ request, baseURL }) => {
    test.skip(!API, 'SMOKE_API_URL not set')
    const health = await request.get(`${API}/api/health`)
    expect(health.ok()).toBe(true)
    const preflight = await request.fetch(`${API}/api/analyze`, {
      method: 'OPTIONS',
      headers: { Origin: baseURL!, 'Access-Control-Request-Method': 'POST' },
    })
    expect(preflight.headers()['access-control-allow-origin']).toBe(baseURL)
  })

  test('geocoding returns real places', async ({ request }) => {
    test.skip(!API, 'SMOKE_API_URL not set')
    const res = await request.get(`${API}/api/geocode`, { params: { q: 'Denver' } })
    expect(res.ok()).toBe(true)
    const { results } = await res.json()
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toMatchObject({ label: expect.stringContaining('Denver') })
  })

  test('a real trip is analyzed with live routing and forecast data', async ({ page }) => {
    const problems: string[] = []
    page.on('pageerror', (e) => problems.push(e.message))

    await page.goto('/')
    await expect(page.getByRole('heading', { name: /compare routes by weather/i })).toBeVisible()
    await page.getByRole('button', { name: /minneapolis|chicago to denver/i }).first().click()

    await expect(page.getByTestId('recommendation')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('map-summary')).toHaveText(/[1-3] routes? drawn/)
    await expect(page.getByTestId('timeline')).toBeVisible()

    // Data really came from the providers: numeric wind at a checkpoint, real ETAs.
    await page.getByTestId('checkpoint-list').getByRole('button').nth(1).click()
    await expect(page.getByTestId('inspector')).toContainText(/\d+ mph/)
    await expect(page.getByTestId('inspector-eta')).toContainText(/(AM|PM) [A-Z]{2,4}/)

    // The forecast slider works against live data.
    await page.getByRole('slider', { name: /forecast hour/i }).fill('12')
    await expect(page.getByTestId('timeline-label')).toContainText('12 h after departure')
    expect(problems).toEqual([])
  })
})
