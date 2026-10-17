import { expectClean, expect, test } from '../support/fixtures'

const SAMPLES = [
  'P1 · South side from the car park',
  'P2 · Under the level 1 slab',
  'P3 · Looking up through the open bay',
  'P4 · East gable',
]

test.describe('ready-made views (?photos)', () => {
  test('four simulated photos; running one shows findings, the planted defects and the pins on the 3D model @handheld', async ({ page, log }) => {
    await page.goto('/samples?photos')
    await expect(page.getByRole('heading', { level: 1, name: 'Ready-made views' })).toBeVisible()
    const cards = page.locator('.sample-card')
    await expect(cards).toHaveCount(4)
    for (const [i, label] of SAMPLES.entries()) {
      await expect(cards.nth(i).locator('.sample-card-title')).toHaveText(label)
      await expect(cards.nth(i).locator('.sample-badge')).toHaveText('Simulated photo')
    }
    await page.waitForLoadState('networkidle')
    for (const img of await page.locator('.sample-thumb img').all()) {
      await img.scrollIntoViewIfNeeded()
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
    }

    await cards.nth(1).click()
    const results = page.locator('.sample-results')
    await expect(results.getByRole('heading', { name: SAMPLES[1] })).toBeVisible({ timeout: 60_000 })
    await expect(results.getByRole('region', { name: 'As-built check results' }).locator('h2')).toHaveText(/possible deviations? · \d+ match/)
    await expect(results.getByRole('status')).toHaveCount(0) // a live answer: no fallback note
    await results.locator('details.sample-truth summary').click()
    await expect(results.locator('details.sample-truth li')).toHaveCount(10)
    await expect(results.locator('details.sample-truth')).toContainText('Some may be out of view in this photo.')

    await results.getByRole('button', { name: 'See the pins on the 3D model' }).click()
    await expect(page).toHaveURL(/\/model\?project=site$/)
    await page.getByRole('button', { name: 'Last check results' }).click()
    await expect(page.getByRole('region', { name: 'As-built check results' })).toBeVisible()
    expectClean(log)
  })

  test("when Gemini can't run, the photo's saved result is shown with the reason", async ({ page }) => {
    await page.goto('/samples?photos')
    // A first live check stores this photo's result on the server (the in-memory store starts empty).
    await page.locator('.sample-card').nth(2).click()
    await expect(page.locator('.sample-results h2.sample-results-title')).toHaveText(SAMPLES[2], { timeout: 60_000 })
    await page.route('**/api/check', (route) => route.fulfill({ status: 503, json: { detail: { code: 'model_unavailable' } }, headers: { 'Retry-After': '5' } }))
    await page.locator('.sample-card').nth(2).click()
    const note = page.locator('.sample-results').getByRole('status')
    await expect(note).toHaveText("Gemini couldn't run the check right now. Showing the last real result for this photo.")
    await expect(page.locator('.sample-results .findings-panel .eyebrow')).toHaveText(/^Saved result from /)
  })

  test('with no saved result and no Gemini, the error is plain', async ({ page }) => {
    await page.route('**/api/check', (route) => route.fulfill({ status: 503, json: { detail: { code: 'model_unavailable' } } }))
    await page.route('**/api/saved-results/**', (route) => route.fulfill({ status: 404, json: { detail: { code: 'unknown_sample' } } }))
    await page.goto('/samples?photos')
    await page.locator('.sample-card').first().click()
    await expect(page.getByRole('alert')).toHaveText('Gemini is busy right now. Try again in a minute.')
  })

  test('Back to the virtual demo goes to the start page section', async ({ page }) => {
    await page.goto('/samples?photos')
    await page.getByRole('link', { name: 'Back to the virtual demo' }).click()
    await expect(page).toHaveURL(/\/#virtual$/)
    await expect(page.getByRole('heading', { name: 'Try the idea in a virtual demo' })).toBeInViewport()
  })
})
