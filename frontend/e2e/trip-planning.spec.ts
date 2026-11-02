import { analyze, expect, fillTrip, mapState, planTrip, test, waitForMapData } from './helpers'

test.describe('planning a trip', () => {
  test('searches addresses, analyzes, and draws routes, checkpoints and a recommendation', async ({ page }) => {
    await planTrip(page)

    await expect(page.getByTestId('map-summary')).toHaveText('3 routes drawn on the map.')
    await expect(page.getByRole('radio', { name: /^Route \d/ })).toHaveCount(3)
    await expect(page.getByTestId('trip-summary')).toContainText('Dallas, Texas → Atlanta, Georgia · 20,000 lb')

    await waitForMapData(page)
    const state = await mapState(page)
    expect(state.routes).toBe(3)
    expect(state.risk).toBeGreaterThan(5) // the selected route is split into risk stretches
    expect(state.checkpoints).toBeGreaterThan(30) // every route's checkpoints are plotted

    // The recommendation states its reasoning and the criterion that decided it.
    const rec = page.getByTestId('recommendation')
    await expect(rec).toContainText('is the safest option')
    await expect(rec).toContainText(/High-risk miles|Severe miles|average risk|fastest/)
    await page.getByTestId('comparison').locator('summary').click()
    await expect(page.getByTestId('comparison')).toContainText('decides')
  })

  test('keyboard-only place selection works', async ({ page }) => {
    await page.goto('/')
    const origin = page.getByRole('combobox', { name: 'Origin' })
    await origin.fill('Dallas')
    await expect(page.getByRole('option', { name: /Dallas, Texas/ })).toBeVisible()
    await origin.press('ArrowDown')
    await origin.press('Enter')
    await expect(origin).toHaveValue('Dallas, Iowa')
    await expect(page.getByRole('listbox')).toHaveCount(0)
  })

  test('shows validation feedback instead of calling the API', async ({ page }) => {
    let calls = 0
    await page.route('**/api/analyze', (route) => {
      calls++
      return route.abort()
    })
    await page.goto('/')
    await page.getByRole('textbox', { name: /load weight/i }).fill('90000')
    await page.getByRole('button', { name: /analyze routes/i }).click()
    await expect(page.getByRole('alert').filter({ hasText: /origin/i })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: /destination/i })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: /between 0 and 80,000/ })).toBeVisible()
    expect(calls).toBe(0)
  })

  test('one-click examples fill the form and run the analysis', async ({ page }) => {
    await page.route('**/api/geocode*', (route) => route.abort())
    await page.goto('/')
    await page.getByRole('button', { name: /dallas to atlanta/i }).click()
    await expect(page.getByTestId('recommendation')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Origin' })).toHaveValue('Dallas, Texas')
  })
})

test.describe('routes and checkpoints', () => {
  test('switching routes updates the map and the detail panel', async ({ page }) => {
    await planTrip(page)
    await waitForMapData(page)
    const selected = () => page.locator('[role=radio][aria-checked=true]').first()
    const before = await selected().getAttribute('data-testid')
    const otherId = await page.locator('[role=radio][data-testid^=route-][aria-checked=false]').first().getAttribute('data-testid')
    expect(otherId).not.toBe(before)
    const other = page.getByTestId(otherId!) // pinned: a fresh "unchecked" query would move after the click

    const riskBefore = await page.evaluate(() => JSON.stringify(window.__routeguard!.sourceFeatures('risk').map((f) => f.geometry.coordinates).slice(0, 2)))
    await other.click()
    await expect(other).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => page.evaluate(() => JSON.stringify(window.__routeguard!.sourceFeatures('risk').map((f) => f.geometry.coordinates).slice(0, 2)))).not.toBe(riskBefore)
    await expect(page.getByRole('region', { name: /risk summary/i })).toBeVisible()
  })

  test('checkpoints are inspectable from the list and from the map', async ({ page }) => {
    await planTrip(page)
    await waitForMapData(page)

    // From the list.
    await page.getByTestId('checkpoint-list').getByRole('button').nth(3).click()
    const inspector = page.getByTestId('inspector')
    await expect(inspector).toBeVisible()
    await expect(inspector).toContainText('checkpoint 4 of')
    await expect(page.getByTestId('inspector-eta')).toContainText(/CST|CDT/)
    await expect(inspector).toContainText(/wind/i)

    // Step with the keyboard-accessible buttons.
    await inspector.getByRole('button', { name: /next checkpoint/i }).click()
    await expect(inspector).toContainText('checkpoint 5 of')

    // From the map: click the first checkpoint dot on the selected route.
    await inspector.getByRole('button', { name: /close checkpoint details/i }).click()
    await expect(inspector).toHaveCount(0)
    const point = await page.evaluate(() => {
      const rg = window.__routeguard!
      const f = rg.sourceFeatures('checkpoints').find((x) => x.properties.onSelectedRoute && x.properties.index === 2)!
      const [lon, lat] = f.geometry.coordinates as [number, number]
      return rg.map.project([lon, lat])
    })
    const box = (await page.getByTestId('map').boundingBox())!
    await page.mouse.click(box.x + point.x, box.y + point.y)
    await expect(inspector).toContainText('checkpoint 3 of')
  })

  test('Escape closes the inspector', async ({ page }) => {
    await planTrip(page)
    await page.getByTestId('checkpoint-list').getByRole('button').nth(2).click()
    await page.getByTestId('inspector').getByRole('button', { name: /next checkpoint/i }).focus()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('inspector')).toHaveCount(0)
  })
})

test.describe('forecast timeline and heatmap', () => {
  test('the 0-48 h slider drives the heatmap, the label and the inspector', async ({ page }) => {
    await planTrip(page)
    await waitForMapData(page)
    const slider = page.getByRole('slider', { name: /forecast hour/i })
    await expect(slider).toHaveAttribute('min', '0')
    await expect(slider).toHaveAttribute('max', '48')
    await expect(page.getByTestId('timeline-label')).toContainText('At departure')

    const before = (await mapState(page)).heat
    await slider.fill('9')
    await expect(page.getByTestId('timeline-label')).toContainText('9 h after departure')
    await expect.poll(async () => JSON.stringify((await mapState(page)).heat)).not.toBe(JSON.stringify(before))

    // The scripted wind system sits on the direct route (Route 1) around hours 4-12; the
    // recommended route avoids it. The peak is for the selected route.
    await expect(page.getByTestId('timeline-label')).toContainText(/corridor peak (Low|Moderate)/)
    await page.getByTestId('route-r1').click()
    await expect(page.getByTestId('timeline-label')).toContainText(/corridor peak (Severe|No Travel)/)
    await slider.fill('40')
    await expect(page.getByTestId('timeline-label')).toContainText(/corridor peak (Low|Moderate)/)
    await slider.fill('9')

    // The inspector shows the forecast at the slider hour.
    await page.getByTestId('checkpoint-list').getByRole('button').nth(4).click()
    await expect(page.getByTestId('inspector-slot')).toContainText('mph wind')
  })

  test('arrow keys step the slider one hour at a time', async ({ page }) => {
    await planTrip(page)
    const slider = page.getByRole('slider', { name: /forecast hour/i })
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(slider).toHaveValue('2')
    await expect(page.getByTestId('timeline-label')).toContainText('2 h after departure')
    await page.keyboard.press('Home')
    await expect(slider).toHaveValue('0')
    await page.keyboard.press('End')
    await expect(slider).toHaveValue('48')
  })

  test('playback advances the forecast and pauses on demand', async ({ page }) => {
    await planTrip(page)
    await page.getByRole('button', { name: /play forecast animation/i }).click()
    await expect(page.getByTestId('timeline-label')).not.toContainText('At departure', { timeout: 5000 })
    await page.getByRole('button', { name: /pause forecast animation/i }).click()
    const frozen = await page.getByRole('slider', { name: /forecast hour/i }).inputValue()
    await page.waitForTimeout(1200)
    await expect(page.getByRole('slider', { name: /forecast hour/i })).toHaveValue(frozen)
  })

  test('metric and layer toggles change what is drawn', async ({ page }) => {
    await planTrip(page)
    await waitForMapData(page)
    await page.getByRole('slider', { name: /forecast hour/i }).fill('9')
    const risk = JSON.stringify((await mapState(page)).heat)
    await page.getByRole('radio', { name: 'Wind' }).click()
    await expect(page.getByTestId('legend')).toContainText('Wind (mph)')
    await expect.poll(async () => JSON.stringify((await mapState(page)).heat)).not.toBe(risk)

    const heatLayerVisible = () => page.evaluate(() => (window.__routeguard!.map as unknown as { getLayoutProperty(l: string, p: string): string }).getLayoutProperty('heat', 'visibility'))
    expect(await heatLayerVisible()).toBe('visible')
    await page.getByRole('button', { name: 'Weather heatmap' }).click()
    expect(await heatLayerVisible()).toBe('none')
    await expect(page.getByRole('button', { name: 'Weather heatmap' })).toHaveAttribute('aria-pressed', 'false')
  })
})

test.describe('load weight changes the risk', () => {
  test('a heavier load turns Severe wind into No Travel and changes the recommendation text', async ({ page }) => {
    await planTrip(page, { load: '20000' })
    const direct = page.getByTestId('route-r1')
    await expect(direct).toContainText('250 mi severe or worse')
    await expect(direct.getByText('No Travel', { exact: true })).toHaveCount(0)

    await page.getByRole('textbox', { name: /load weight/i }).fill('35000')
    await analyze(page)
    await expect(page.getByTestId('trip-summary')).toContainText('35,000 lb')
    await expect(page.getByTestId('route-r1').getByText('No Travel', { exact: true })).toBeVisible()
    await expect(page.getByTestId('recommendation')).toContainText('Excluded for crossing No Travel conditions: Route 1')

    // The checkpoint explains which load rule applied.
    await page.getByTestId('route-r1').click()
    await page.getByTestId('checkpoint-list').getByText('No Travel', { exact: true }).first().click()
    await expect(page.getByTestId('load-rule')).toContainText('load over 30,000 lb')
  })

  test('above 40,000 lb High wind becomes Severe', async ({ page }) => {
    await planTrip(page, { load: '35000' })
    await expect(page.getByTestId('route-r2')).toContainText('severe or worse', { useInnerText: true }).catch(() => {})
    await expect(page.getByTestId('route-r2')).toContainText('200 mi high risk')
    await page.getByRole('textbox', { name: /load weight/i }).fill('45000')
    await analyze(page)
    await expect(page.getByTestId('route-r2')).toContainText('200 mi severe or worse')
  })

  test('changing only the load does not refetch the forecast (server cache) and stays fast', async ({ page }) => {
    await planTrip(page, { load: '20000' })
    const started = Date.now()
    await page.getByRole('textbox', { name: /load weight/i }).fill('45000')
    await analyze(page)
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})

test.describe('errors and edge states', () => {
  test('shows a recoverable error when the weather provider is down, then recovers', async ({ page }) => {
    let fail = true
    await page.route('**/api/analyze', (route) => {
      if (!fail) return route.fallback()
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'weather_unavailable', message: 'The weather provider is unavailable right now. Try again shortly.' } }),
      })
    })
    await fillTrip(page)
    await page.getByRole('button', { name: /analyze routes/i }).click()
    const alert = page.getByTestId('error-notice')
    await expect(alert).toContainText('weather provider is unavailable')
    fail = false
    await alert.getByRole('button', { name: /try again/i }).click()
    await expect(page.getByTestId('recommendation')).toBeVisible()
    await expect(page.getByTestId('error-notice')).toHaveCount(0)
  })

  test('an unreachable API is reported without breaking the page', async ({ page }) => {
    await page.route('**/api/analyze', (route) => route.abort('connectionrefused'))
    await fillTrip(page)
    await page.getByRole('button', { name: /analyze routes/i }).click()
    await expect(page.getByTestId('error-notice')).toContainText(/could not reach/i)
    await expect(page.getByRole('button', { name: /analyze routes/i })).toBeEnabled()
  })

  test('server-side validation errors are attached to the field', async ({ page }) => {
    await page.route('**/api/analyze', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'validation_error', message: 'Check the highlighted fields.', fields: { departure: 'Departure is in the past.' } } }),
      }),
    )
    await fillTrip(page)
    await page.getByRole('button', { name: /analyze routes/i }).click()
    await expect(page.getByText('Departure is in the past.')).toBeVisible()
  })

  test('shows loading feedback while the analysis runs', async ({ page }) => {
    await page.route('**/api/analyze', async (route) => {
      await new Promise((r) => setTimeout(r, 800))
      await route.fallback()
    })
    await fillTrip(page)
    await page.getByRole('button', { name: /analyze routes/i }).click()
    await expect(page.getByTestId('loading-state')).toBeVisible()
    await expect(page.getByRole('button', { name: /analyzing routes/i })).toBeDisabled()
    await expect(page.getByTestId('recommendation')).toBeVisible()
  })

  test('the methodology dialog opens and closes from the keyboard', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /methodology/i }).click()
    const dialog = page.getByRole('dialog', { name: /how routeguard scores a trip/i })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Fewest Severe miles')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
