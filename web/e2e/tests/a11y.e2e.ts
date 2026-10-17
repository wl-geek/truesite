import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { BUG, KNOWN_AXE } from '../support/bugs'
import { enterVirtualSite, expect, runVirtualCheck, stubGeminiFindsPlanted, test } from '../support/fixtures'

/**
 * axe-core with the WCAG 2.2 A/AA rules. Serious and critical violations fail the test; the full list is attached.
 * Findings of a known bug (support/bugs.ts) are left out and noted on the test, unless `known` is set.
 */
async function scan(page: Page, label: string, known = false): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  await test.info().attach(`axe-${label}.json`, { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' })
  const out: string[] = []
  for (const v of results.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
    const nodes = v.nodes.filter((n) => {
      const hit = KNOWN_AXE.find((k) => k.rule === v.id && k.node.test(n.target.join(' ')))
      if (hit && !known) test.info().annotations.push({ type: 'known bug', description: `${hit.bug} (${label})` })
      return known || !hit
    })
    if (nodes.length) out.push(`${v.impact} ${v.id}: ${v.help} -> ${nodes.slice(0, 5).map((n) => n.target.join(' ')).join(' | ')}`)
  }
  return out
}

async function openStubbedResults(page: Page): Promise<void> {
  await stubGeminiFindsPlanted(page)
  await enterVirtualSite(page, 'P1')
  await runVirtualCheck(page, 'P1')
}

async function startLiveCamera(page: Page): Promise<void> {
  await page.goto('/a/site/P1')
  await page.getByRole('button', { name: 'Continue on this computer' }).click()
  await page.getByRole('button', { name: 'Start camera' }).click()
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page.locator('.hud-scale')).toBeVisible()
}

test.describe('accessibility (axe-core, serious and critical)', () => {
  test('start page @handheld', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    expect(await scan(page, 'start')).toEqual([])
    if (await page.getByRole('button', { name: 'Menu' }).isVisible()) {
      await page.getByRole('button', { name: 'Menu' }).click()
      expect(await scan(page, 'start-menu')).toEqual([])
    }
  })

  test('live AR: both steps of the laptop popup, the start panel and the running camera view', async ({ page }) => {
    test.slow() // five full scans
    await page.goto('/a/site/P1')
    await expect(page.getByRole('dialog', { name: 'Open live AR on your tablet or phone' })).toBeVisible()
    expect(await scan(page, 'live-popup')).toEqual([])
    await page.getByRole('button', { name: 'Next: get the sheet' }).click()
    await expect(page.getByRole('dialog', { name: 'Print the sheet and scan its code' })).toBeVisible()
    expect(await scan(page, 'live-popup-sheet')).toEqual([])
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await scan(page, 'live-start')).toEqual([])
    await page.getByRole('button', { name: 'Start camera' }).click()
    await expect(page.getByRole('heading', { name: 'Calibrate this camera (10 s)' })).toBeVisible()
    expect(await scan(page, 'live-calibrate')).toEqual([])
    await page.getByRole('button', { name: 'Skip' }).click()
    await page.getByRole('button', { name: 'Skip' }).click()
    await expect(page.locator('.hud-scale')).toBeVisible()
    expect(await scan(page, 'live-running')).toEqual([]) // with the icon-only Exit control, which needs its name
  })

  test('3D model with an element and an answer @handheld', async ({ page }) => {
    await page.goto('/model')
    await expect(page.locator('.model-card')).toBeVisible()
    expect(await scan(page, 'model')).toEqual([])
    const box = (await page.locator('canvas.viewer-canvas').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const panel = page.locator('aside.element-panel')
    await expect(panel).toBeVisible()
    await panel.locator('.ask-chips .chip').first().click()
    await expect(panel.locator('.ask-answer')).toBeVisible()
    expect(await scan(page, 'model-panel')).toEqual([])
  })

  test('virtual demo: the view, the results, the issue and the report dialogs @handheld', async ({ page }) => {
    test.slow() // four full scans
    await stubGeminiFindsPlanted(page)
    await enterVirtualSite(page, 'P1')
    expect(await scan(page, 'virtual')).toEqual([])
    await runVirtualCheck(page, 'P1')
    for (const s of await page.locator('.vs-results details summary').all()) await s.click()
    expect(await scan(page, 'virtual-results')).toEqual([])
    await page.getByRole('button', { name: 'Draft issue' }).first().click()
    await expect(page.getByRole('dialog', { name: 'New issue' }).getByRole('textbox', { name: 'Title' })).toBeVisible()
    expect(await scan(page, 'issue-dialog')).toEqual([])
    await page.getByRole('dialog', { name: 'New issue' }).getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: "Write today's site report" }).click()
    await expect(page.locator('.report')).toBeVisible()
    expect(await scan(page, 'report-dialog')).toEqual([])
  })

  test('ready-made views with a result', async ({ page }) => {
    await page.goto('/samples?photos')
    await page.locator('.sample-card').first().click()
    await expect(page.locator('.sample-results .findings-panel')).toBeVisible({ timeout: 60_000 })
    expect(await scan(page, 'photos')).toEqual([])
  })
})

test.describe('accessibility bugs', () => {
  test(BUG.orangeContrast, async ({ page }) => {
    await openStubbedResults(page)
    expect((await scan(page, 'results-contrast', true)).filter((v) => v.includes('color-contrast'))).toEqual([])
    await startLiveCamera(page)
    expect((await scan(page, 'live-contrast', true)).filter((v) => v.includes('color-contrast'))).toEqual([])
  })

  test(BUG.summaryTargets, async ({ page }) => {
    await openStubbedResults(page)
    for (const s of await page.locator('.findings details summary').all()) {
      const box = (await s.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(24)
    }
    expect((await scan(page, 'results-targets', true)).filter((v) => v.includes('target-size'))).toEqual([])
  })

  test(BUG.dialogFocus, async ({ page }) => {
    await openStubbedResults(page)
    await page.getByRole('button', { name: 'Draft issue' }).first().click()
    const issue = page.getByRole('dialog', { name: 'New issue' })
    await expect(issue.getByRole('textbox', { name: 'Title' })).toBeVisible()
    expect(await issue.evaluate((d) => d.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(issue).toBeHidden()
    await page.getByRole('button', { name: "Write today's site report" }).click()
    const report = page.getByRole('dialog').filter({ has: page.locator('.report') })
    await expect(report).toBeVisible()
    expect(await report.evaluate((d) => d.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(report).toBeHidden()
  })

  test(BUG.tipFocus, async ({ page }) => {
    await page.goto('/a/site/P1')
    const tip = page.getByRole('dialog')
    await expect(tip.getByRole('button', { name: 'Next: get the sheet' })).toBeFocused() // its first control since #107
    await page.keyboard.press('Shift+Tab')
    expect(await tip.evaluate((d) => d.contains(document.activeElement))).toBe(true)
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab')
    expect(await tip.evaluate((d) => d.contains(document.activeElement))).toBe(true)
  })
})
