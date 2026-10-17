import type { Page } from '@playwright/test'
import { BUG } from '../support/bugs'
import { enterVirtualSite, expectClean, expect, runVirtualCheck, stubGeminiFindsPlanted, test } from '../support/fixtures'

/** Tap the model until an element's panel opens (the ID buffer picks whatever is under the finger). */
async function tapAnElement(page: Page): Promise<string> {
  const canvas = page.locator('canvas.viewer-canvas')
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.5, 0.62], [0.4, 0.5], [0.6, 0.5], [0.5, 0.38]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
    const panel = page.locator('aside.element-panel')
    if (await panel.isVisible({ timeout: 1500 }).catch(() => false)) return (await panel.locator('h2').textContent()) ?? ''
  }
  throw new Error('no element under any of the tapped points')
}

test.describe('3D model viewer', () => {
  test('opens the building site by default with its colour key, and links to live AR @handheld', async ({ page, log }) => {
    await page.goto('/model')
    await expect(page).toHaveTitle('3D model · TrueSite')
    await expect(page.getByRole('heading', { level: 1, name: 'Building under construction' })).toBeVisible()
    await expect(page.getByRole('combobox')).toHaveCount(0) // one model: a title, no model switcher
    const unfold = page.getByRole('button', { name: 'Show the model card' }) // phones start with the card folded
    if (await unfold.isVisible()) await unfold.click()
    await expect(page.locator('.model-card-meta').first()).toHaveText('19.8 × 13.8 m overall, 10.65 m high · 191 elements')
    await expect(page.getByRole('list', { name: 'Colour key' }).getByRole('button')).toHaveText(
      [/^Column \d+$/, /^Beam \d+$/, /^Truss \d+$/, /^Purlin \d+$/, /^Brace \d+$/, /^Concrete \d+$/, /^Rebar \d+$/, /^Other \d+$/])
    await expect(page.getByText('Drag to orbit · scroll or pinch to zoom · tap an element for its details')).toBeVisible()
    await expect(page.locator('canvas.viewer-canvas')).toHaveAttribute('aria-label', '3D model: Building under construction (1:1)')
    await page.getByRole('link', { name: 'See it live in AR' }).click()
    await expect(page).toHaveURL(/\/#live$/)
    await page.waitForLoadState('networkidle')
    expectClean(log)
  })

  test('the top bar opens the 3D model from any page and marks it as the current page @handheld', async ({ page, log }) => {
    await page.goto('/')
    const bar = page.locator('.tb-nav')
    const nav = (await bar.isVisible()) ? bar : (await page.getByRole('button', { name: 'Menu' }).click(), page.locator('#tb-menu'))
    await nav.getByRole('link', { name: '3D model' }).click()
    await expect(page).toHaveURL(/\/model$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Building under construction' })).toBeVisible()
    await expect(page.locator('#tb-menu')).toBeHidden() // the phone menu closes after a pick
    const marked = (await bar.isVisible()) ? bar : (await page.getByRole('button', { name: 'Menu' }).click(), page.locator('#tb-menu'))
    await expect(marked.getByRole('link', { name: '3D model' })).toHaveAttribute('aria-current', 'page')
    await expect(marked.locator('[aria-current]')).toHaveCount(1)
    expectClean(log)
  })

  test('tap an element: its data, then Ask answers from the model data only @handheld', async ({ page, log }) => {
    test.slow() // each tap picks by a GPU read-back: slow with software rendering at the iPad's 2x pixels, in parallel
    await page.goto('/model')
    const name = await tapAnElement(page)
    const panel = page.locator('aside.element-panel')
    await expect(panel).toHaveAccessibleName(new RegExp(`: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)) // "Roof purlin: Purlin P1 A-B"
    await expect(panel.locator('.ep-type')).not.toBeEmpty()
    expect(await panel.locator('.ep-facts .ep-fact').count()).toBeGreaterThan(0)
    await expect(panel).not.toContainText(/Pset_|Qto_|TrueSite_Notes|PredefinedType/) // plain words, no IFC keys
    await panel.getByText('BIM data (IFC)').click() // the IFC data is there, folded away
    await expect(panel.locator('.ep-tech dd.mono')).toHaveText(/^[0-9A-Za-z_$]{22}$/) // an IFC GlobalId
    await expect(page.getByText('Drag to orbit')).toBeHidden()

    const ask = panel.getByRole('region', { name: 'Ask Gemini about this element' })
    const question = ask.getByRole('textbox', { name: 'Your question' })
    await expect(ask.getByRole('button', { name: 'Ask Gemini' })).toBeDisabled()
    await question.fill('What material is it?')
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/ask') && r.method() === 'POST')
    await ask.getByRole('button', { name: 'Ask Gemini' }).click()
    expect(JSON.parse((await sent).postData()!)).toMatchObject({ project_id: 'site', question: 'What material is it?' })
    const answer = ask.locator('.ask-answer')
    await expect(answer).toBeVisible()
    await expect(answer).toContainText("Gemini's answer, from this element's model data only. Check before you build.")
    await expect(answer.locator('table caption')).toHaveText('From the model')
    // A suggestion chip (picked for this element) asks straight away.
    const chip = ask.locator('.chip').first()
    const chipText = (await chip.textContent())!
    await chip.click()
    await expect(question).toHaveValue(chipText)
    await expect(answer).toBeVisible()

    await panel.getByRole('button', { name: 'Close element details' }).click()
    await expect(panel).toBeHidden()
    await expect(page.getByText('Drag to orbit')).toBeVisible()
    expectClean(log)
  })

  test("an unknown project says it doesn't exist and links to the site model (C-34)", async ({ page }) => {
    await page.goto('/model?project=nope')
    const alert = page.getByRole('alert')
    await expect(alert).toHaveText(/^This link points to a project TrueSite doesn't have\./)
    await expect(alert.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    await alert.getByRole('link', { name: 'Open the site model' }).click()
    await expect(page).toHaveURL(/\/model$/)
    await expect(page.locator('.model-card')).toBeVisible()
  })

  test('after a check, the viewer shows Last check results with the same findings', async ({ page }) => {
    await enterVirtualSite(page, 'P2')
    await runVirtualCheck(page, 'P2')
    const summary = await page.locator('.vs-results .findings-panel h2').textContent()
    await page.goto('/model')
    await page.getByRole('button', { name: 'Last check results' }).click()
    const results = page.getByRole('region', { name: 'As-built check results' })
    await expect(results.locator('h2')).toHaveText(summary!)
    await results.getByRole('button', { name: 'Close results' }).click()
    await expect(results).toBeHidden()
    await expect(page.getByRole('button', { name: 'Last check results' })).toBeVisible()
  })

  test('draft and save an issue from Last check results @handheld', async ({ page }) => {
    await stubGeminiFindsPlanted(page)
    await enterVirtualSite(page, 'P1')
    await runVirtualCheck(page, 'P1')
    await page.goto('/model')
    await page.getByRole('button', { name: 'Last check results' }).click()
    const results = page.getByRole('region', { name: 'As-built check results' })
    await results.getByRole('button', { name: 'Draft issue' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New issue' })
    await expect(dialog.getByRole('textbox', { name: 'Title' })).not.toHaveValue('')
    await expect(dialog.getByLabel(/Crew's language/)).toBeVisible() // the run is stored: Gemini drafts it
    await dialog.getByRole('button', { name: 'Save issue' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.viewer-notice')).toHaveText('Issue saved.')
    await expect(page.locator('.viewer-notice')).toBeInViewport() // C-06: not under the findings list, off screen
  })

  test(BUG.viewerOverlap, async ({ page }) => {
    await stubGeminiFindsPlanted(page)
    await enterVirtualSite(page, 'P1')
    await runVirtualCheck(page, 'P1')
    await page.goto('/model')
    await page.getByRole('button', { name: 'Last check results' }).click()
    const results = page.getByRole('region', { name: 'As-built check results' })
    await results.getByRole('listitem').first().locator('.finding-main').click() // shows the element too
    await expect(page.locator('aside.element-panel')).toBeVisible()
    await results.getByRole('button', { name: 'Draft issue' }).first().click({ timeout: 5_000 })
    await expect(page.getByRole('dialog', { name: 'New issue' })).toBeVisible()
  })
})
