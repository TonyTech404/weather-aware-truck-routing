import { expect, planTrip, test, waitForMapData } from './helpers'

test('phone layout: plan a trip, see the map and timeline, no horizontal scrolling', async ({ page }) => {
  await page.goto('/')
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(await noOverflow()).toBe(true)
  await expect(page.getByRole('combobox', { name: 'Origin' })).toBeVisible()

  await planTrip(page)
  await waitForMapData(page)
  expect(await noOverflow()).toBe(true)

  const viewport = page.viewportSize()!
  // The map has real room, and the timeline is its own bar directly under it (it never covers the route).
  const map = (await page.getByTestId('map').boundingBox())!
  expect(map.height).toBeGreaterThan(220)
  const timeline = (await page.getByTestId('timeline').boundingBox())!
  expect(timeline.x).toBeGreaterThanOrEqual(0)
  expect(timeline.x + timeline.width).toBeLessThanOrEqual(viewport.width)
  expect(timeline.y).toBeGreaterThanOrEqual(map.y + map.height - 2)
  expect(timeline.y + timeline.height).toBeLessThanOrEqual(viewport.height)

  // Touch targets are comfortably tappable.
  for (const control of [
    page.getByRole('button', { name: /play forecast animation/i }),
    page.getByRole('combobox', { name: /heatmap shows/i }),
    page.getByRole('button', { name: 'Weather heatmap' }),
  ]) {
    const box = (await control.boundingBox())!
    expect(box.height, 'touch target height').toBeGreaterThanOrEqual(38)
    expect(box.width, 'touch target width').toBeGreaterThanOrEqual(38)
  }
  // Pinch zooms on touch screens, so the +/- buttons are hidden.
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeHidden()

  // Results were scrolled into view after the analysis.
  await expect(page.getByTestId('recommendation')).toBeInViewport()

  // The slider still works, and the metric picker is a native select.
  await page.getByRole('slider', { name: /forecast hour/i }).fill('10')
  await expect(page.getByTestId('timeline-label')).toContainText('10 h after departure')
  await page.getByRole('combobox', { name: /heatmap shows/i }).selectOption('wind')

  // Checkpoint details open as a bottom sheet that is fully on screen.
  await page.getByTestId('checkpoint-list').getByRole('button').nth(2).scrollIntoViewIfNeeded()
  await page.getByTestId('checkpoint-list').getByRole('button').nth(2).click()
  const sheet = page.getByTestId('inspector')
  await expect(sheet).toBeVisible()
  await expect(sheet).toBeInViewport({ ratio: 0.95 })
  await sheet.getByRole('button', { name: /close checkpoint details/i }).click()
  await expect(sheet).toHaveCount(0)
  expect(await noOverflow()).toBe(true)
})

test('phone layout: the methodology table fits without sideways scrolling', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /methodology/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  for (const level of ['Low', 'Moderate', 'High', 'Severe', 'No Travel']) {
    await expect(dialog.getByRole('rowheader', { name: level })).toBeInViewport({ ratio: 1 })
  }
  const fits = await dialog.evaluate((el) => {
    const table = el.querySelector('table')!
    return table.scrollWidth <= (table.parentElement as HTMLElement).clientWidth + 1
  })
  expect(fits).toBe(true)
})
