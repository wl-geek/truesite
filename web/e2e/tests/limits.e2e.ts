import type { Page } from '@playwright/test'
import { BUG } from '../support/bugs'
import { LIMITS_URL } from '../support/env'
import { enterVirtualSite, expect, runVirtualCheck, test } from '../support/fixtures'

/**
 * The 429 copy against a real server with tight limits (playwright.config.ts starts it fresh: CHECKS_PER_IP_PER_HOUR=1,
 * DAILY_CHECK_CAP=3). The per-hour limit is per client address, which the server reads from the right-most
 * X-Forwarded-For entry, so each test sends its own address. The daily cap is one counter for everyone: the first
 * three tests use it up with one good check each, so the tests run in order.
 */
test.skip(!LIMITS_URL, 'needs the local limits server (off with E2E_LIMITS_PORT=off or E2E_BASE_URL)')
test.use({ baseURL: LIMITS_URL ?? undefined })
test.describe.configure({ mode: 'serial' })

let address = 0
const run = Math.floor(Math.random() * 200) + 20
const newAddress = (page: Page) => page.setExtraHTTPHeaders({ 'X-Forwarded-For': `198.18.${run}.${++address}` })

test.beforeEach(({ page }) => newAddress(page))

test('per-address limit, virtual demo: the second check in an hour says when to try again and keeps the first results', async ({ page }) => {
  await enterVirtualSite(page, 'P1')
  await runVirtualCheck(page, 'P1')
  await page.getByRole('button', { name: 'Back to the view' }).click()
  const answer = page.waitForResponse('**/api/check')
  await page.getByRole('button', { name: 'Check as-built' }).click()
  const res = await answer
  expect(res.status()).toBe(429)
  expect(await res.json()).toMatchObject({ detail: { code: 'rate_limited' } })
  expect(Number(res.headers()['retry-after'])).toBeGreaterThan(3500)
  await expect(page.locator('.vs-notice')).toHaveText('Too many checks from this network. Try again in about 60 min.')
  await expect(page.getByRole('link', { name: 'Use a ready-made view instead' })).toHaveAttribute('href', '/samples?photos')
  await page.getByRole('button', { name: 'Show results' }).click()
  await expect(page.getByRole('heading', { name: 'As-built check · P1' })).toBeVisible()
})

test("per-address limit, ready-made view: the photo's saved result, with the reason and when to try again", async ({ page }) => {
  await page.goto('/samples?photos')
  const card = page.locator('.sample-card').first()
  await card.click()
  await expect(page.locator('.sample-results h2.sample-results-title')).toHaveText('P1 · South side from the car park', { timeout: 60_000 })
  await expect(page.locator('.sample-results').getByRole('status')).toHaveCount(0)
  await card.click()
  await expect(page.locator('.sample-results').getByRole('status')).toHaveText(
    "Too many checks from this network, so Gemini didn't run. Showing the last real result for this photo. Try again in about 60 min.")
  await expect(page.locator('.sample-results .findings-panel .eyebrow')).toHaveText(/^Saved result from /)
})

test('questions have their own budget: Ask still works after the check limit', async ({ page }) => {
  await enterVirtualSite(page, 'P2')
  await runVirtualCheck(page, 'P2') // the day's third good check
  const status = await page.evaluate(async () => {
    const project = await (await fetch('/api/projects/site')).json()
    const r = await fetch('/api/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Id': localStorage.getItem('truesite.session')! },
      body: JSON.stringify({ project_id: 'site', guid: project.elements[0].guid, question: 'What material is it?' }),
    })
    return r.status
  })
  expect(status).toBe(200)
})

/** Run checks from fresh addresses until the server answers daily_cap (normally the first one). */
async function untilDailyCap(page: Page, tap: () => Promise<void>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const answer = page.waitForResponse('**/api/check')
    await tap()
    const res = await answer
    if (res.status() === 429 && (await res.json()).detail?.code === 'daily_cap') return
    await newAddress(page)
  }
  throw new Error('the daily cap never answered')
}

test("daily cap, ready-made view: the photo's saved result, with the reason", async ({ page }) => {
  await page.goto('/samples?photos')
  await untilDailyCap(page, () => page.locator('.sample-card').first().click())
  await expect(page.locator('.sample-results').getByRole('status')).toHaveText(
    "Today's check limit has been reached, so Gemini didn't run. Showing the last real result for this photo.")
})

test('daily cap, virtual demo: the copy says so', async ({ page }) => {
  await enterVirtualSite(page, 'P3')
  await untilDailyCap(page, () => page.getByRole('button', { name: 'Check as-built' }).click())
  await expect(page.locator('.vs-notice')).toContainText("Today's check limit has been reached.")
  await expect(page.locator('.vs-notice')).toContainText('come back tomorrow.')
  await expect(page.getByRole('link', { name: 'Use a ready-made view instead' })).toBeVisible()
})

test('daily cap, ready-made view with no saved result: the copy says so', async ({ page }) => {
  await page.goto('/samples?photos')
  await untilDailyCap(page, () => page.locator('.sample-card').nth(3).click()) // P4 was never checked on this server
  await expect(page.getByRole('alert')).toContainText("Today's check limit has been reached.")
})

test.fixme(BUG.capCopy, async ({ page }) => {
  await enterVirtualSite(page, 'P4')
  await untilDailyCap(page, () => page.getByRole('button', { name: 'Check as-built' }).click())
  await expect(page.locator('.vs-notice')).not.toContainText('sample photos')
  await page.goto('/samples?photos')
  await untilDailyCap(page, () => page.locator('.sample-card').nth(3).click()) // a photo with no saved result here
  await expect(page.getByRole('alert')).not.toContainText('sample photos')
})
