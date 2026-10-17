import { devices, type Page } from '@playwright/test'
import { BUG } from '../support/bugs'
import { expectClean, expect, test, VIEWPOINTS } from '../support/fixtures'

const TIP = 'Live AR is made for tablets and smartphones'

test.describe('live AR on a laptop', () => {
  test.skip(({ isMobile, hasTouch }) => isMobile || hasTouch, 'laptop only')

  test('a popup recommends a tablet or phone, with a QR code of this page, once per visit', async ({ page, log }) => {
    await page.goto('/a/site/P1')
    const tip = page.getByRole('dialog', { name: TIP })
    await expect(tip).toBeVisible()
    await expect(tip).toHaveAttribute('aria-modal', 'true')
    await expect(tip.getByRole('img', { name: 'QR code for this page' })).toHaveAttribute('src', /^data:image\/svg\+xml;utf8,/)
    await expect(tip.getByRole('link', { name: 'Try the virtual demo' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(tip).toBeHidden()
    await expect(page.locator('.live-device-note')).toHaveText('Made for tablets and smartphones: open this page on one for the best experience.')
    // Once per visit: not again on this tab, not on another sheet either.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible()
    await page.goto('/a/site/P2')
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible()
    await expect(tip).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    expectClean(log)
  })

  test('the QR code in the popup encodes this page address', async ({ page }) => {
    await page.goto('/a/site/P3')
    const src = await page.getByRole('img', { name: 'QR code for this page' }).getAttribute('src')
    const svg = decodeURIComponent(src!.replace(/^data:image\/svg\+xml;utf8,/, ''))
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/)
    // uqr draws one path per dark module run; a code for this ~35-character URL has a version 3 grid or larger.
    const size = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1])
    expect(size).toBeGreaterThanOrEqual(29 + 4)
  })

  test('Continue on this computer closes the popup; clicking the backdrop does too', async ({ page }) => {
    await page.goto('/a/site/P1')
    await page.getByRole('button', { name: 'Continue on this computer' }).click()
    await expect(page.getByRole('dialog', { name: TIP })).toBeHidden()
    await expect(page.getByRole('heading', { level: 1, name: 'Live view · Life size · 1:1' })).toBeVisible()
    // A fresh visit (new tab session) shows it again; the backdrop closes it.
    const other = await page.context().browser()!.newPage()
    await other.goto(page.url())
    await expect(other.getByRole('dialog', { name: TIP })).toBeVisible()
    await other.mouse.click(5, 300)
    await expect(other.getByRole('dialog', { name: TIP })).toBeHidden()
    await other.close()
  })

  for (const v of VIEWPOINTS) {
    test(`Try the virtual demo in the popup opens ${v.id} in the virtual demo`, async ({ page }) => {
      await page.goto(`/a/site/${v.id}`)
      await page.getByRole('dialog', { name: TIP }).getByRole('link', { name: 'Try the virtual demo' }).click()
      await expect(page).toHaveURL(new RegExp(`/samples\\?at=${v.id}$`))
      await expect(page.getByRole('application', { name: new RegExp(`Virtual demo at ${v.id}, ${v.name}`) })).toBeVisible()
    })
  }

  test('on the desk sheet the popup sends you to the virtual demo section', async ({ page }) => {
    await page.goto('/a/site/D1')
    const link = page.getByRole('dialog', { name: TIP }).getByRole('link', { name: 'Try the virtual demo' })
    await expect(link).toHaveAttribute('href', '/#virtual')
    await link.click()
    await expect(page).toHaveURL(/\/#virtual$/)
  })

  test('with the camera on, Check as-built stays off on the live sheets and points to the virtual demo', async ({ page, log }) => {
    await page.addInitScript(() => { // remember the camera tracks the page opens
      const w = window as unknown as { __tracks: MediaStreamTrack[] }
      w.__tracks = []
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); w.__tracks.push(...s.getTracks()); return s }
    })
    await page.goto('/a/site/P1')
    await page.getByRole('button', { name: 'Continue on this computer' }).click()
    const wasm = page.waitForResponse((r) => /zxing_reader-.*\.wasm$/.test(r.url()))
    await page.getByRole('button', { name: 'Start camera' }).click()
    expect((await wasm).status()).toBe(200) // the QR reader runs in its module worker
    // First use of this camera: the calibration offer, then the print-scale check, come first.
    await expect(page.getByRole('heading', { name: 'Calibrate this camera (10 s)' })).toBeVisible()
    await page.getByRole('button', { name: 'Skip' }).click()
    await expect(page.getByRole('heading', { name: 'Check the print scale' })).toBeVisible()
    await page.getByRole('button', { name: 'Skip' }).click()
    await expect(page.locator('.mode-chip')).toHaveText('Life size · 1:1')
    await expect(page.getByText('No code in view')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check as-built' })).toBeDisabled()
    const note = page.locator('.live-top .coach', { hasText: 'nothing to check' })
    await expect(note).toHaveText('This sheet shows the design where nothing is built yet, so there is nothing to check. Try the virtual demo. Open the virtual demo')
    await expect(page.locator('canvas.live-canvas')).toBeVisible()
    await note.getByRole('link', { name: 'Open the virtual demo' }).click()
    await expect(page).toHaveURL(/\/#virtual$/)
    // Leaving the page stops the camera: every track the page opened has ended.
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => t.readyState)))
      .toEqual(['ended'])
    expectClean(log)
  })
})

test.describe('live AR on tablets and phones', () => {
  test('no device popup; the steps, the virtual demo link, and no XR extras without ?xr=1 @handheld', async ({ page, log, isMobile }) => {
    test.skip(!isMobile, 'handheld projects only')
    await page.goto('/a/site/P2')
    await expect(page.getByRole('heading', { level: 1, name: 'Live view · Life size · 1:1' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.live-device-note')).toHaveCount(0)
    await expect(page.locator('.live-start .eyebrow')).toHaveText('Building under construction · P2 Under the slab', { ignoreCase: true })
    await expect(page.locator('.live-start ol.steps li')).toHaveCount(4)
    await expect(page.locator('.live-start')).toContainText("Don't walk; come back to the code to re-align.")
    await expect(page.getByRole('link', { name: 'Try P2 in the virtual demo' })).toHaveAttribute('href', '/samples?at=P2')
    await expect(page.getByRole('button', { name: /Walk inside|Start AR/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeEnabled()
    await page.waitForLoadState('networkidle')
    expectClean(log)
  })
})

test.describe('live AR on an iPad that reports a Mac', () => {
  // iPadOS Safari sends a desktop Mac user agent and navigator.platform "MacIntel"; only its touch points give it away.
  test.use({
    viewport: devices['iPad Pro 11 landscape'].viewport,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  })

  test('gets no laptop popup', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' })
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }) // Chromium's touch emulation says 1
    })
    await page.goto('/a/site/P1')
    expect(await page.evaluate(() => [navigator.platform, navigator.maxTouchPoints])).toEqual(['MacIntel', 5])
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.live-device-note')).toHaveCount(0)
  })
})

test.describe('live AR errors', () => {
  /** The laptop popup also opens over a broken link (BUG.tipOverBrokenLink): close it to read the page. */
  async function closeTipIfAny(page: Page): Promise<void> {
    const tip = page.getByRole('dialog', { name: TIP })
    if (await tip.isVisible()) await tip.getByRole('button', { name: 'Continue on this computer' }).click()
  }

  test('an unknown sheet says so and offers the viewer and the virtual demo @handheld', async ({ page }) => {
    await page.goto('/a/site/P9')
    await expect(page.getByRole('alert')).toHaveText("This QR code isn't set up for this project.")
    await closeTipIfAny(page)
    await expect(page.getByRole('link', { name: 'Open the model viewer' })).toHaveAttribute('href', '/model?project=site')
    await page.locator('.live-links').getByRole('link', { name: 'Try the virtual demo' }).click()
    await expect(page).toHaveURL(/\/#virtual$/)
  })

  test('an unknown project says the sheet may be out of date and opens the default viewer @handheld', async ({ page }) => {
    await page.goto('/a/nope/P1')
    await expect(page.getByRole('alert')).toHaveText("This QR code points to a project TrueSite doesn't have. The sheet may be out of date.")
    await closeTipIfAny(page)
    await page.getByRole('link', { name: 'Open the model viewer' }).click()
    await expect(page).toHaveURL(/\/model$/)
    await expect(page.locator('.model-card-name')).toHaveText('Building under construction')
  })

  test(BUG.tipOverBrokenLink, async ({ page }) => {
    for (const url of ['/a/nope/P1', '/a/site/P9']) {
      await page.goto(url)
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0) // any title: the popup's changed since #107
    }
  })
})
