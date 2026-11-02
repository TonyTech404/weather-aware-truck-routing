import { expect, planTrip, test, waitForMapData } from './helpers'

test('phone layout: plan a trip, see the map and timeline, no horizontal scrolling', async ({ page }) => {
  await page.goto('/')
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(await noOverflow()).toBe(true)
  await expect(page.getByRole('combobox', { name: 'Origin' })).toBeVisible()

  await planTrip(page)
  await waitForMapData(page)
  expect(await noOverflow()).toBe(true)

  // The map and the forecast timeline are both on screen at once.
  const viewport = page.viewportSize()!
  const map = (await page.getByTestId('map').boundingBox())!
  expect(map.height).toBeGreaterThan(200)
  const timeline = (await page.getByTestId('timeline').boundingBox())!
  expect(timeline.x).toBeGreaterThanOrEqual(0)
  expect(timeline.x + timeline.width).toBeLessThanOrEqual(viewport.width)
  expect(timeline.y + timeline.height).toBeLessThanOrEqual(map.y + map.height + 1)

  // The slider still works with touch-sized controls, and the metric picker is a native select.
  await page.getByRole('slider', { name: /forecast hour/i }).fill('10')
  await expect(page.getByTestId('timeline-label')).toContainText('10 h after departure')
  await page.getByRole('combobox', { name: /heatmap shows/i }).selectOption('wind')

  // The inspector appears inside the scrolling panel on small screens.
  await page.getByTestId('checkpoint-list').getByRole('button').nth(2).click()
  await expect(page.getByTestId('inspector')).toBeVisible()
  expect(await noOverflow()).toBe(true)
})
