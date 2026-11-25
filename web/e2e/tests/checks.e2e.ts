import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { enterVirtualSite, expect, expectClean, horizontalOverflow, runVirtualCheck, smallTapTargets, test } from '../support/fixtures'

/**
 * The Checks page (/checks): every check from this browser, and one check in full with an audit trail. Each test runs
 * in a fresh browser context, so a fresh session: the page starts empty. The offline stand-in flags nothing on the
 * site project, so the review flow rewrites the run as the page reads it (flagging one mark); the decision itself
 * goes to the real server, which accepts a decision on any of the run's marks.
 */
async function axeSerious(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

async function fits(page: Page): Promise<void> {
  const o = await horizontalOverflow(page)
  expect.soft(o.offenders, 'elements past the right edge').toEqual([])
  expect.soft(await smallTapTargets(page), 'tap targets under 24 px').toEqual([])
}

/** Run Check as-built at P1 and open it from the results' Open in Checks. Returns the run id. */
async function checkAndOpen(page: Page): Promise<string> {
  await enterVirtualSite(page, 'P1')
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/check'))
  await runVirtualCheck(page, 'P1')
  const runId = (await (await answer).json()).run_id as string
  await page.getByRole('complementary', { name: 'Check results' }).getByRole('link', { name: 'Open in Checks' }).click()
  await expect(page).toHaveURL(`/checks?run=${runId}`)
  return runId
}

test.describe('Checks page', () => {
  test('a new browser has no checks yet, and is sent to the virtual demo @handheld', async ({ page, log }) => {
    await page.goto('/checks')
    await expect(page).toHaveTitle('Checks · TrueSite')
    await expect(page.getByRole('heading', { name: 'No checks yet.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Run a check in the virtual demo' })).toHaveAttribute('href', '/samples?at=P1')
    expect(await axeSerious(page)).toEqual([])
    await fits(page)
    // The top bar marks the page (in the menu on a phone).
    if (await page.getByRole('button', { name: 'Menu' }).isVisible()) await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('link', { name: 'Checks' }).first()).toHaveAttribute('aria-current', 'page')
    expectClean(log)
  })

  test('a check from the virtual demo: Open in Checks, its images, the audit trail, then the list @handheld', async ({ page, log }) => {
    const runId = await checkAndOpen(page)
    await expect(page.getByRole('heading', { level: 1, name: 'P1 · South approach' })).toBeVisible()
    // Honest offline mode, and the copy rule.
    await expect(page.getByRole('note').filter({ hasText: 'Offline test mode.' })).toBeVisible()
    await expect(page.getByText('Visual check, not a survey.').first()).toBeVisible()
    await expect(page.getByText('The stand-in flagged no deviation in this view.')).toBeVisible() // never called Gemini offline
    await expect(page.getByRole('img', { name: 'Photo used for the as-built check' })).toBeVisible()
    await expect(page.getByRole('img', { name: /The BIM design render with numbered marks/ })).toBeVisible()
    await page.getByRole('button', { name: 'Outlines on photo' }).click()
    await expect(page.getByRole('img', { name: "The site photo with each marked element's design outline" })).toBeVisible()
    for (const img of await page.locator('.checks-images img').all()) {
      expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
    }
    const audit = page.getByRole('region', { name: 'Audit trail' })
    await expect(audit).toContainText('Offline stand-in (not Gemini)')
    await expect(audit).toContainText('Virtual demo')
    await expect(audit.locator('code.checks-hash').first()).toHaveText(/^[0-9a-f]{12}…[0-9a-f]{4}$/)
    await expect(audit).toContainText(runId)
    expect(await axeSerious(page)).toEqual([])
    await fits(page)

    await page.getByRole('link', { name: 'Back to all checks' }).click()
    await expect(page).toHaveURL(/\/checks$/)
    await expect(page.locator('.tile').first()).toContainText('Checks run1')
    const row = page.getByRole('link', { name: /P1 · South approach/ })
    await expect(row).toHaveAttribute('href', `/checks?run=${runId}`)
    await expect(page.getByText('Nothing flagged')).toBeVisible()
    await page.getByRole('button', { name: /Needs review/ }).click()
    await expect(page.getByText('No checks need review: every flagged finding has a decision.')).toBeVisible()
    expect(await axeSerious(page)).toEqual([])
    await fits(page)
    expectClean(log)
  })

  test('confirm a finding, take it back, dismiss it: stored with the server time, and never another session\'s', async ({ page, request, log }) => {
    // Flag mark 1 as the page reads the run (the stand-in flags nothing on the site project).
    await page.route(/\/api\/runs\/[A-Za-z0-9_-]+$/, async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      const f = body.result.findings.find((x: { mark: number }) => x.mark === 1)
      Object.assign(f, { status: 'missing', severity: 'high', confidence: 0.55, explanation: '<b>Nothing</b> where the design shows it.' })
      await route.fulfill({ response, json: body })
    })
    const runId = await checkAndOpen(page)
    const card = page.locator('#finding-1')
    await expect(card).toContainText('Confidence Low · 0.55— take a closer look')
    await expect(card).toContainText('Stand-in: <b>Nothing</b> where the design shows it.') // text, never HTML
    const session = await page.evaluate(() => localStorage.getItem('truesite.session')!)
    const stored = async () => (await (await request.get(`/api/runs/${runId}`, { headers: { 'X-Session-Id': session } })).json()).review

    await card.getByRole('button', { name: 'Confirm finding' }).click()
    await expect(card.getByRole('status')).toHaveText(/^✓Confirmed by you · \d\d:\d\d$/)
    expect((await stored())['1'].decision).toBe('confirmed')
    await expect(page.locator('.checks-detail-state .review-pill')).toHaveText('✓Reviewed')
    await expect(page.getByRole('region', { name: 'Audit trail' })).toContainText(/Mark 1, .*: Confirmed by you · \d\d:\d\d/)

    await card.getByRole('button', { name: 'Undo decision' }).click()
    await expect(card.getByRole('button', { name: 'Dismiss as false alarm' })).toBeVisible()
    expect(await stored()).toEqual({})
    await card.getByRole('button', { name: 'Dismiss as false alarm' }).click()
    await expect(card.getByRole('status')).toHaveText(/^Dismissed as a false alarm · \d\d:\d\d$/)
    await expect(card.getByRole('button', { name: 'Draft issue' })).toHaveCount(0) // no issue from a false alarm
    expect((await stored())['1'].decision).toBe('dismissed')

    // Another browser can neither read the run nor change it.
    const stranger = { 'X-Session-Id': '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d' }
    expect((await request.get(`/api/runs/${runId}`, { headers: stranger })).status()).toBe(404)
    expect((await request.put(`/api/runs/${runId}/review/1`, { headers: stranger, data: { decision: 'confirmed' } })).status()).toBe(404)
    expect((await stored())['1'].decision).toBe('dismissed')
    expectClean(log, { http: /404 GET .*\/api\/runs\/|404 PUT / })
  })

  test('a link to a check this browser did not run says so', async ({ page, log }) => {
    await page.goto('/checks?run=NotThisBrowsersRun01')
    await expect(page.getByRole('heading', { name: 'Check not found' })).toBeVisible()
    await page.getByRole('link', { name: 'See all checks' }).click()
    await expect(page).toHaveURL(/\/checks$/)
    await expect(page.getByRole('heading', { name: 'No checks yet.' })).toBeVisible()
    expectClean(log, { http: /404 GET .*\/api\/runs\/NotThisBrowsersRun01$/, errors: /404/ })
  })
})
