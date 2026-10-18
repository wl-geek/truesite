import type { Page } from '@playwright/test'
import { KNOWN_SMALL_TARGETS } from '../support/bugs'
import { enterVirtualSite, expect, horizontalOverflow, runVirtualCheck, smallTapTargets, stubGeminiFindsPlanted, test } from '../support/fixtures'

/**
 * No sideways scrolling and no tap target under 24 CSS px (WCAG 2.2 SC 2.5.8), at the whole page height. Targets of
 * a known bug (support/bugs.ts) are noted on the test instead; a11y.e2e.ts has the test.fixme for them.
 */
async function expectFits(page: Page, what: string): Promise<void> {
  const o = await horizontalOverflow(page)
  expect.soft(o.offenders, `${what}: elements past the right edge`).toEqual([])
  expect.soft(o.scrollWidth, `${what}: document scroll width`).toBeLessThanOrEqual(o.innerWidth)
  const small = (await smallTapTargets(page)).filter((t) => {
    const known = KNOWN_SMALL_TARGETS.find((k) => k.target.test(t))
    if (known) test.info().annotations.push({ type: 'known bug', description: `${known.bug} (${what}: ${t})` })
    return !known
  })
  expect.soft(small, `${what}: tap targets under 24 px`).toEqual([])
}

test.describe('layout on phones and tablets', () => {
  test('start page, and its menu on a phone @handheld', async ({ page }) => {
    await page.goto('/')
    await page.locator('details.home-details summary').click()
    await expectFits(page, 'start page')
    if (await page.getByRole('button', { name: 'Menu' }).isVisible()) {
      await page.getByRole('button', { name: 'Menu' }).click()
      await expectFits(page, 'start page, menu open')
    }
  })

  test('live AR start panel, or the popup on a laptop @handheld', async ({ page, isMobile }) => {
    await page.goto('/a/site/P1')
    if (!isMobile) {
      await expect(page.getByRole('dialog', { name: 'Open live AR on your smartphone' })).toBeVisible()
      return expectFits(page, 'live popup')
    }
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible()
    await expectFits(page, 'live')
  })

  test('3D model with an element panel @handheld', async ({ page }) => {
    await page.goto('/model')
    await expect(page.locator('.model-card')).toBeVisible()
    await expectFits(page, 'model')
    const box = (await page.locator('canvas.viewer-canvas').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('aside.element-panel')).toBeVisible()
    await expectFits(page, 'model with panel')
  })

  test('virtual demo: view, results, issue dialog @handheld', async ({ page }) => {
    await stubGeminiFindsPlanted(page)
    await enterVirtualSite(page, 'P2')
    await expectFits(page, 'virtual demo')
    await runVirtualCheck(page, 'P2')
    await expectFits(page, 'virtual demo results')
    await page.getByRole('button', { name: 'Draft issue' }).first().click()
    await expect(page.getByRole('dialog', { name: 'New issue' }).getByRole('textbox', { name: 'Title' })).toBeVisible()
    await expectFits(page, 'issue dialog')
  })

  test('ready-made views @handheld', async ({ page }) => {
    await page.goto('/samples?photos')
    await expect(page.locator('.sample-card')).toHaveCount(4)
    await expectFits(page, 'ready-made views')
  })
})
