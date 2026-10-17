import { devices } from '@playwright/test'
import { BUG } from '../support/bugs'
import { expectClean, expect, presentAsTablet, test, VIEWPOINTS } from '../support/fixtures'

/**
 * The laptop popup (#107): step 1 hands this page to a tablet or phone by QR, step 2 gives the sheet to print. On a
 * laptop or PC it is the whole page: nothing opens the live view, and Back to home (or Escape) leaves for the start page.
 */
const TIP = 'Open live AR on your tablet or phone'
const SHEET_STEP = 'Print the sheet and scan its code'

test.describe('live AR on a laptop', () => {
  test.skip(({ isMobile, hasTouch }) => isMobile || hasTouch, 'laptop only')

  test('a popup asks for a tablet or phone, with a QR code of this page, every time the page opens', async ({ page, log }) => {
    await page.goto('/a/site/P1')
    const tip = page.getByRole('dialog', { name: TIP })
    await expect(tip).toBeVisible()
    await expect(tip).toHaveAttribute('aria-modal', 'true')
    await expect(tip.getByText('Step 1 of 2')).toBeVisible()
    await expect(tip).toContainText("so it doesn't run on a laptop or PC")
    await expect(tip.getByRole('img', { name: 'QR code for this live view' })).toHaveAttribute('src', /^data:image\/svg\+xml;utf8,/)
    await expect(tip.getByRole('button', { name: 'Next: get the sheet' })).toBeFocused()
    // Every time (#111): again on a reload of this sheet, and on another sheet.
    await page.reload()
    await expect(tip).toBeVisible()
    await page.goto('/a/site/P2')
    await expect(tip).toBeVisible()
    await page.waitForLoadState('networkidle')
    expectClean(log)
  })

  test('a computer never reaches the live view: no way past the popup, and Back to home or Escape go to the start page', async ({ page }) => {
    await page.goto('/a/site/P1')
    const tip = page.getByRole('dialog', { name: TIP })
    await expect(tip.getByRole('button')).toHaveText(['Next: get the sheet', 'Back to home'])
    await page.mouse.click(5, 300) // the backdrop does nothing
    await expect(tip).toBeVisible()
    await tip.getByRole('button', { name: 'Back to home' }).click()
    await expect(page).toHaveURL(/\/#live$/)
    await expect(page.locator('section#live')).toBeInViewport()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goto('/a/site/P2')
    await expect(tip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/#live$/)
    await expect(page.getByRole('button', { name: 'Start camera' })).toHaveCount(0)
  })

  test('step 2 gives the sheet to download, how to print and place it, and the layout plan; back to the QR code, then home', async ({ page }) => {
    await page.goto('/a/site/P1')
    await page.getByRole('button', { name: 'Next: get the sheet' }).click()
    const sheet = page.getByRole('dialog', { name: SHEET_STEP })
    await expect(sheet.getByText('Step 2 of 2')).toBeVisible()
    const download = sheet.getByRole('link', { name: 'Download sheet P1' })
    await expect(download).toBeFocused()
    await expect(download).toHaveAttribute('href', '/sheets/site-P1.pdf')
    await expect(sheet.locator('.dt-sheet-name > strong')).toHaveText('Sheet P1')
    await expect(sheet.locator('.dt-sheet-name > span')).toHaveText('US Letter · upright · PDF')
    await expect(sheet.locator('.dt-list li')).toHaveText([
      'Print it on US Letter at 100%, not "Fit to page". Its check bar must measure 10.0 cm.',
      'Fix it upright, with the centre of the code 1.4 m above the ground.',
      'On the tablet or phone, tap Start camera and point it at the code.',
    ])
    await expect(sheet.getByRole('link', { name: 'download the layout plan' })).toHaveAttribute('href', '/sheets/site-layout.pdf')
    await sheet.getByRole('button', { name: 'Back to the QR code' }).click()
    await expect(page.getByRole('dialog', { name: TIP }).getByRole('button', { name: 'Next: get the sheet' })).toBeFocused()
    await page.getByRole('button', { name: 'Next: get the sheet' }).click()
    await sheet.getByRole('button', { name: 'Back to home' }).click()
    await expect(page).toHaveURL(/\/#live$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start camera' })).toHaveCount(0)
  })

  test('the QR code in the popup encodes this page address', async ({ page }) => {
    await page.goto('/a/site/P3')
    const src = await page.getByRole('dialog', { name: TIP }).getByRole('img', { name: 'QR code for this live view' }).getAttribute('src')
    const svg = decodeURIComponent(src!.replace(/^data:image\/svg\+xml;utf8,/, ''))
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/)
    // uqr draws one path per dark module run; a code for this ~35-character URL has a version 3 grid or larger.
    const size = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1])
    expect(size).toBeGreaterThanOrEqual(29 + 4)
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
})

test.describe('live AR camera view (desktop Chrome as an iPad: its fake camera)', () => {
  test.skip(({ isMobile, hasTouch }) => isMobile || hasTouch, 'desktop project only')

  test('with the camera on, Check as-built stays off on the live sheets and points to the virtual demo', async ({ page, log }) => {
    await page.addInitScript(() => { // remember the camera tracks the page opens
      const w = window as unknown as { __tracks: MediaStreamTrack[] }
      w.__tracks = []
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); w.__tracks.push(...s.getTracks()); return s }
    })
    await presentAsTablet(page)
    await page.goto('/a/site/P1')
    const wasm = page.waitForResponse((r) => /zxing_reader-.*\.wasm$/.test(r.url()))
    await page.getByRole('button', { name: 'Start camera' }).click()
    expect((await wasm).status()).toBe(200) // the QR reader runs in its module worker
    // First use of this camera: the calibration offer, then the print-scale check, come first.
    await expect(page.getByRole('heading', { name: 'Calibrate this camera (10 s)' })).toBeVisible()
    await page.getByRole('button', { name: 'Skip' }).click()
    await expect(page.getByRole('heading', { name: 'Check the print scale' })).toBeVisible()
    await page.getByRole('button', { name: 'Skip' }).click()
    // The camera view since #107: closable messages over the camera, the scale in the status pill, an Exit control.
    const note = page.locator('.live-top .hud-msg', { hasText: 'nothing to check' }) // shows for 6 s from the camera start
    await expect(note).toHaveText('This sheet shows the design where nothing is built yet, so there is nothing to check here. Try the check in the virtual demo')
    await expect(note).toHaveRole('status')
    await expect(note.getByRole('button', { name: 'Close this message' })).toBeVisible()
    await expect(page.locator('.hud-scale')).toHaveText('Life size · 1:1')
    await expect(page.getByRole('link', { name: 'Exit live AR' })).toHaveAttribute('href', '/#live')
    await expect(page.getByText('No code in view')).toBeVisible()
    const check = page.getByRole('button', { name: 'Check as-built' })
    await expect(check).toBeDisabled()
    await expect(check).toHaveAttribute('aria-disabled', 'true') // off on this sheet, not only until the code is found
    await expect(page.locator('canvas.live-canvas')).toBeVisible()
    await note.getByRole('link', { name: 'Try the check in the virtual demo' }).click()
    await expect(page).toHaveURL(/\/samples\?at=P1$/)
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
  // The laptop popup waits for the sheet, so it never covers a broken link (BUG.tipOverBrokenLink, audit C-29).
  test('an unknown sheet says so and offers the viewer and the virtual demo @handheld', async ({ page }) => {
    await page.goto('/a/site/P9')
    await expect(page.getByRole('alert')).toHaveText("This QR code isn't set up for this project.")
    await expect(page.getByRole('link', { name: 'Open the model viewer' })).toHaveAttribute('href', '/model?project=site')
    await page.locator('.live-links').getByRole('link', { name: 'Try the virtual demo' }).click()
    await expect(page).toHaveURL(/\/#virtual$/)
  })

  test('an unknown project says the sheet may be out of date and opens the default viewer @handheld', async ({ page }) => {
    await page.goto('/a/nope/P1')
    await expect(page.getByRole('alert')).toHaveText("This QR code points to a project TrueSite doesn't have. The sheet may be out of date.")
    await page.getByRole('link', { name: 'Open the model viewer' }).click()
    await expect(page).toHaveURL(/\/model$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Building under construction' })).toBeVisible()
  })

  test(BUG.tipOverBrokenLink, async ({ page }) => {
    for (const url of ['/a/nope/P1', '/a/site/P9']) {
      await page.goto(url)
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0) // any title: the popup's changed since #107
    }
  })
})
