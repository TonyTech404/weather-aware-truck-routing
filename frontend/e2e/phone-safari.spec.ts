import { expect, fillTrip, test } from './helpers'

/**
 * Runs in WebKit (the engine behind every browser on iPhone) as well as Chromium. It guards the
 * phone behaviours that were broken on a real iPhone: the planner sliding sideways, and no way to
 * see the whole map or the whole details.
 */
async function sidewaysScrollable(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const aside = document.querySelector('aside')!
    return {
      aside: aside.scrollWidth - aside.clientWidth,
      page: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
}

test('phone: nothing can slide sideways, in any mode', async ({ page }) => {
  await fillTrip(page)
  await page.getByRole('button', { name: /analyze routes/i }).tap()
  await expect(page.getByTestId('recommendation')).toBeVisible()

  // Even a forced sideways scroll goes nowhere.
  const forced = await page.evaluate(() => {
    const aside = document.querySelector('aside')!
    aside.scrollLeft = 150
    document.scrollingElement!.scrollLeft = 150
    return { aside: aside.scrollLeft, page: document.scrollingElement!.scrollLeft }
  })
  expect(forced).toEqual({ aside: 0, page: 0 })
  expect(await sidewaysScrollable(page)).toEqual({ aside: 0, page: 0 })

  // The section bar fits on one row without scrolling.
  const nav = page.getByRole('navigation', { name: /jump to section/i })
  expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('phone: the map can take the whole screen and the details can too', async ({ page }) => {
  await fillTrip(page)
  await page.getByRole('button', { name: /analyze routes/i }).tap()
  await expect(page.getByTestId('recommendation')).toBeVisible()
  const viewportHeight = page.viewportSize()!.height
  const mapHeight = async () => Math.round((await page.getByRole('main', { name: 'Map' }).boundingBox())!.height)

  const split = await mapHeight()
  expect(split).toBeGreaterThan(200)
  expect(split).toBeLessThan(viewportHeight * 0.7)

  // Full map: the map grows to nearly the whole screen and the way back is always visible.
  await page.getByRole('button', { name: 'Show the full map' }).tap()
  await expect.poll(mapHeight).toBeGreaterThan(viewportHeight * 0.7)
  await expect(page.getByTestId('timeline')).toBeVisible()
  await page.getByRole('button', { name: 'Show trip details' }).tap()
  await expect.poll(mapHeight).toBeLessThan(viewportHeight * 0.7)

  // Expand: the details take the whole screen, and there is a button to bring the map back.
  await page.getByRole('button', { name: 'Expand details to full screen' }).tap()
  await expect.poll(mapHeight).toBe(0)
  await expect(page.getByTestId('recommendation')).toBeVisible()
  expect(await sidewaysScrollable(page)).toEqual({ aside: 0, page: 0 })
  await page.getByRole('button', { name: 'Show the map again' }).tap()
  await expect.poll(mapHeight).toBeGreaterThan(200)
})

test('phone: form fields do not make iOS zoom the page', async ({ page }) => {
  await page.goto('/')
  // iOS Safari zooms into any focused field with a font under 16px.
  for (const field of [
    page.getByRole('combobox', { name: 'Origin' }),
    page.getByRole('combobox', { name: 'Destination' }),
    page.getByLabel(/^Departure/),
    page.getByRole('textbox', { name: /load weight/i }),
  ]) {
    const size = await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(16)
  }
})
