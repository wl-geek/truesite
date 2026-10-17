import { enterVirtualSite, expect, runVirtualCheck, test } from '../support/fixtures'

/**
 * The server sends Content-Security-Policy-Report-Only (server/app/security_headers.py): browsers report what the
 * policy would block without blocking it. Before it can be enforced, the main flows must report nothing.
 */
test.describe('Content-Security-Policy-Report-Only', () => {
  test('is sent with the page', async ({ request }) => {
    const res = await request.get('/')
    expect(res.headers()['content-security-policy-report-only']).toContain("default-src 'self'")
    expect(res.headers()['content-security-policy']).toBeUndefined()
  })

  test('start page, live AR with the camera and the QR worker, 3D model with Ask: no reports', async ({ page, log }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.goto('/a/site/P1') // the laptop popup draws its QR code as a data: image
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Continue on this computer' }).click()
    await page.getByRole('button', { name: 'Start camera' }).click()
    await expect(page.getByRole('heading', { name: 'Calibrate this camera (10 s)' })).toBeVisible()
    await page.waitForTimeout(1500) // let the worker compile the wasm and scan a few frames
    await page.goto('/model')
    const box = (await page.locator('canvas.viewer-canvas').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.locator('aside.element-panel .ask-chips .chip').first().click()
    await expect(page.locator('.ask-answer')).toBeVisible()
    expect(log.csp).toEqual([])
  })

  test('virtual demo check and ready-made views: no reports', async ({ page, log }) => {
    await enterVirtualSite(page, 'P1')
    await runVirtualCheck(page, 'P1') // blob: images for the photo and the design render
    await page.goto('/samples?photos')
    await page.locator('.sample-card').first().click()
    await expect(page.locator('.sample-results .findings-panel')).toBeVisible({ timeout: 60_000 })
    expect(log.csp).toEqual([])
  })
})
