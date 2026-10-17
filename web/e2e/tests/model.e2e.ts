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
    await expect(page.locator('.model-card-name')).toHaveText('Building under construction')
    await expect(page.locator('.model-card-meta')).toHaveText('191 elements · coloured by type')
    await expect(page.getByRole('list', { name: 'Colour key' }).getByRole('listitem')).toHaveText(
      ['Column', 'Beam', 'Truss', 'Purlin', 'Brace', 'Concrete', 'Rebar', 'Other'])
    await expect(page.getByText('Drag to orbit · pinch or scroll to zoom · tap an element for its data')).toBeVisible()
    await expect(page.locator('canvas.viewer-canvas')).toHaveAttribute('aria-label', '3D model: Building under construction (1:1)')
    await page.getByRole('link', { name: 'See it live in AR' }).click()
    await expect(page).toHaveURL(/\/#live$/)
    await page.waitForLoadState('networkidle')
    expectClean(log)
  })

  test('tap an element: its data, then Ask answers from the model data only @handheld', async ({ page, log }) => {
    await page.goto('/model')
    const name = await tapAnElement(page)
    const panel = page.getByRole('complementary', { name: `Properties of ${name}` })
    await expect(panel).toBeVisible()
    await expect(panel.locator('dl.facts dt')).toHaveText(['Storey', 'Load bearing', 'GUID'])
    await expect(panel.locator('dd.mono')).toHaveText(/^[0-9A-Za-z_$]{22}$/) // an IFC GlobalId
    expect(await panel.locator('table.props').first().locator('tr').count()).toBeGreaterThan(0)
    await expect(page.getByText('Drag to orbit')).toBeHidden()

    const ask = panel.getByRole('region', { name: 'Ask about this element' })
    const question = ask.getByRole('textbox', { name: 'Your question' })
    await expect(ask.getByRole('button', { name: 'Ask' })).toBeDisabled()
    await question.fill('What material is it?')
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/ask') && r.method() === 'POST')
    await ask.getByRole('button', { name: 'Ask' }).click()
    expect(JSON.parse((await sent).postData()!)).toMatchObject({ project_id: 'site', question: 'What material is it?' })
    const answer = ask.locator('.ask-answer')
    await expect(answer).toBeVisible()
    await expect(answer).toContainText("Answers come only from this element's model data. Check before you build.")
    await expect(answer.locator('table caption')).toHaveText('From the model')
    // A suggestion chip asks straight away.
    await ask.getByRole('button', { name: 'Any install notes?' }).click()
    await expect(question).toHaveValue('Any install notes?')
    await expect(answer).toBeVisible()

    await panel.getByRole('button', { name: 'Close properties' }).click()
    await expect(panel).toBeHidden()
    await expect(page.getByText('Drag to orbit')).toBeVisible()
    expectClean(log)
  })

  test('?project=rooftop opens the rooftop frame', async ({ page }) => {
    await page.goto('/model?project=rooftop')
    await expect(page.locator('.model-card-name')).toHaveText('Rooftop frame (2 storeys, 1:1)')
    await expect(page.getByRole('link', { name: 'See it live in AR' })).toHaveCount(0) // site only
  })

  test('an unknown project shows an error with Try again', async ({ page }) => {
    await page.goto('/model?project=nope')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText("Couldn't load the model.")
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible()
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
  })

  test.fixme(BUG.viewerOverlap, async ({ page }) => {
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
