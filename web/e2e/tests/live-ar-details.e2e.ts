/**
 * Live AR: tap the model for an element's details (the same panel as the 3D model and the virtual demo).
 * Uses the ray-traced camera videos of live-ar.e2e.ts (see its header for making them): the overlay is aligned by the
 * real QR detection, so a tap lands on what is truly drawn. The tap point is the screen centre of a box-shaped element
 * projected with the ground-truth pose; whatever opens must be drawn there (its projected box holds the tap).
 *   iPad landscape: a panel beside the view; nothing of the HUD under it; the element painted orange.
 *   Phone portrait: a sheet that peeks (two facts, More details) and opens fully; the actions come back on close.
 */
import path from 'node:path'
import { chromium, devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { LIVE_AR_URL, LIVE_AR_VIDEOS as VIDEOS } from '../support/env'
import * as H from '../support/live-ar'

test.skip(LIVE_AR_URL === null, 'no live AR videos: make them with scripts/live-ar-videos.py (see live-ar.e2e.ts)')
const BASE = LIVE_AR_URL ?? ''
const manifest = (LIVE_AR_URL === null ? null : H.loadManifest(VIDEOS))!
const VIDEO = 'p1-steady'
const TAP_TIP = 'Tap any part of the model to see what it is.'

type Project = { elements: H.Element[]; anchors: H.Anchor[] }
let project: Project
test.beforeAll(async () => {
  project = (await (await fetch(`${BASE}/api/projects/site`)).json()) as Project
})

let browser: Browser | null = null
test.afterEach(async () => {
  await browser?.close()
  browser = null
})

async function launch(): Promise<Browser> {
  return chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', `--use-file-for-fake-video-capture=${path.join(VIDEOS, manifest.videos[VIDEO].file)}`] })
}

/** A tablet or phone context with the true intrinsics stored (no setup panel), camera and sensors granted. */
async function context(b: Browser, device: 'iPad Pro 11 landscape' | 'iPhone 15'): Promise<BrowserContext> {
  const { defaultBrowserType: _ignored, ...dev } = devices[device]
  const ctx = await b.newContext(dev)
  await ctx.grantPermissions(['camera', 'accelerometer', 'gyroscope', 'magnetometer'], { origin: BASE })
  await ctx.addInitScript((x) => {
    const v = { f: x.K.f, videoW: x.w, videoH: x.h, source: 'calibrated', at: '2026-10-17T00:00:00.000Z' }
    try { localStorage.setItem(`truesite.intrinsics.${x.w}x${x.h}`, JSON.stringify(v)) } catch { /* no storage */ }
  }, { K: manifest.K, w: manifest.width, h: manifest.height })
  return ctx
}

/** Open P1, start the camera, wait for Alignment: Good and close the opening note. */
async function aligned(page: Page): Promise<void> {
  await page.goto(`${BASE}/a/site/P1`)
  await expect(page.locator('.live-start h1')).toBeVisible({ timeout: 20_000 })
  await H.installMotionDriver(page, manifest.stamp)
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect.poll(async () => (await H.liveState(page)).badge, { timeout: 15_000 }).toMatch(/^Alignment: Good · /)
  const note = page.locator('.live-top .hud-msg', { hasText: 'nothing to check' })
  if (await note.count()) await note.getByRole('button', { name: 'Close this message' }).click()
  await page.waitForTimeout(600) // the smoothing settles
}

type Target = { x: number; y: number; hull: H.P2[] }

/**
 * Screen points (CSS px in the canvas) at the centres of box-shaped elements (columns, beams, slabs, footings) that are
 * well inside the view and clear of the HUD's top and bottom rows, largest first.
 */
async function targets(page: Page): Promise<Target[]> {
  const rect = (await page.locator('canvas.live-canvas').boundingBox())!
  const view: H.View = { K: manifest.K, videoW: manifest.width, videoH: manifest.height, viewW: rect.width, viewH: rect.height }
  const cam = manifest.videos[VIDEO].cams[0]
  const toWorld = H.modelToWorld(project.anchors.find((a) => a.anchor_id === 'P1')!, null)
  const out: (Target & { area: number })[] = []
  for (const e of project.elements) {
    if (!/^Ifc(Column|Beam|Slab|Footing)$/.test(e.ifc_class)) continue
    const hull = H.elementHull(view, cam, toWorld, e.bbox_m)
    if (!hull) continue
    const x = hull.reduce((s, p) => s + p[0], 0) / hull.length
    const y = hull.reduce((s, p) => s + p[1], 0) / hull.length
    if (x < 40 || x > rect.width - 40 || y < 90 || y > rect.height - 130) continue
    out.push({ x, y, hull, area: polygonArea(hull) })
  }
  return out.sort((a, b) => b.area - a.area)
}

function polygonArea(p: H.P2[]): number {
  return Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1] }, 0)) / 2
}

/** Distance (px) from a point to a convex polygon: 0 inside. */
function distanceToHull(p: H.P2, hull: H.P2[]): number {
  let inside = true
  let best = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (cross < 0) inside = false
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1)))
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1]))))
  }
  return inside ? 0 : best
}
const anyOrientation = (hull: H.P2[], p: H.P2) => Math.min(distanceToHull(p, hull), distanceToHull(p, [...hull].reverse()))

/** Tap the first target that opens an element's details; returns the target and the element's name. */
async function tapAnElement(page: Page, touch: boolean): Promise<{ t: Target; name: string }> {
  const rect = (await page.locator('canvas.live-canvas').boundingBox())!
  const panel = page.locator('aside.element-panel.ar-details')
  for (const t of (await targets(page)).slice(0, 8)) {
    if (touch) await page.touchscreen.tap(rect.x + t.x, rect.y + t.y)
    else await page.mouse.click(rect.x + t.x, rect.y + t.y)
    if (await panel.isVisible({ timeout: 1500 }).catch(() => false)) return { t, name: (await panel.locator('h2').textContent()) ?? '' }
  }
  throw new Error('no element opened under any target')
}

/** Pixels of the selection orange in the overlay alone (video black, every panel and the HUD hidden). */
async function orangePixels(page: Page): Promise<number> {
  await page.evaluate(() => {
    const st = document.createElement('style')
    st.id = 'e2e-orange'
    st.textContent = '.live-video{filter:brightness(0)!important}.live-top,.live-actions,.ar-details{visibility:hidden!important}'
    document.head.append(st)
  })
  try {
    await page.waitForTimeout(300)
    const png = await page.screenshot({ clip: (await page.locator('canvas.live-canvas').boundingBox())!, scale: 'css' })
    return page.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] > 70 && d[i + 1] < 130 && d[i + 2] < 60 && d[i] - d[i + 1] > 90) n++
      return n
    }, png.toString('base64'))
  } finally {
    await page.evaluate(() => document.getElementById('e2e-orange')?.remove())
  }
}

/** The centre of a 64 px square of the view where the overlay draws nothing, clear of the HUD rows; null if none. */
async function emptyPoint(page: Page): Promise<H.P2 | null> {
  const drawn = H.drawnMask((await H.overlayShot(page)).png)
  const B = 64
  for (let y = 110; y + B < drawn.h - 150; y += 16) {
    for (let x = 40; x + B < drawn.w - 40; x += 16) {
      let clear = true
      for (let j = y; j < y + B && clear; j += 2) for (let i = x; i < x + B; i += 2) if (drawn.mask[j * drawn.w + i]) { clear = false; break }
      if (clear) return [x + B / 2, y + B / 2]
    }
  }
  return null
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test('iPad: tap the model for its details beside the view, painted orange, nothing of the HUD covered; close', async () => {
  browser = await launch()
  const page = await (await context(browser, 'iPad Pro 11 landscape')).newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await aligned(page)
  const before = await orangePixels(page)
  const { t, name } = await tapAnElement(page, false)
  const element = project.elements.find((e) => e.name === name)
  expect(element, `"${name}" is an element of the model`).toBeTruthy()
  // What opened is drawn where the finger was (within the tap tolerance).
  const rect = (await page.locator('canvas.live-canvas').boundingBox())!
  const view: H.View = { K: manifest.K, videoW: manifest.width, videoH: manifest.height, viewW: rect.width, viewH: rect.height }
  const hull = H.elementHull(view, manifest.videos[VIDEO].cams[0], H.modelToWorld(project.anchors.find((a) => a.anchor_id === 'P1')!, null), element!.bbox_m)
  expect(hull, `${name} is in view`).not.toBeNull()
  expect(anyOrientation(hull!, [t.x, t.y]), `${name} is drawn under the tap`).toBeLessThanOrEqual(24)

  const panel = page.locator('aside.element-panel.ar-details')
  await expect(panel.getByRole('region', { name: 'Ask Gemini about this element' })).toBeVisible() // full details on a tablet
  await expect(panel.getByRole('button', { name: 'More details' })).toHaveCount(0)
  // Beside the view, and nothing of the HUD under it.
  const box = (await panel.boundingBox())!
  expect(box.x + box.width, 'on the right edge').toBeGreaterThan(rect.width - 20)
  expect(box.width).toBeLessThanOrEqual(0.45 * rect.width)
  for (const sel of ['.hud-exit', '.hud-status', '.live-actions .btn', '.live-top .hud-msg']) {
    for (const el of await page.locator(sel).all()) {
      const b = await el.boundingBox()
      if (b) expect(overlaps(b, box), `${sel} clear of the details panel`).toBe(false)
    }
  }
  // The element stands out in the overlay.
  const after = await orangePixels(page)
  console.log('orange pixels', { before, after, name })
  expect(after, 'the tapped element is painted orange').toBeGreaterThan(before + 200)
  await page.screenshot({ path: path.resolve(import.meta.dirname, '../test-results/live-ar/details-ipad.png') })

  await panel.getByRole('button', { name: 'Close element details' }).click()
  await expect(panel).toHaveCount(0)
  expect(await orangePixels(page), 'the orange goes with the details').toBeLessThan(before + 2000) // rebar's orange-red varies a little
  // A tap where nothing of the model is drawn opens nothing.
  const empty = await emptyPoint(page)
  expect(empty, 'some of the view shows no model').not.toBeNull()
  await page.mouse.click(rect.x + empty![0], rect.y + empty![1])
  await page.waitForTimeout(500)
  await expect(panel).toHaveCount(0)
  expect(errors).toEqual([])
})

test('phone in portrait: a sheet that peeks, opens fully and closes, and the actions come back', async () => {
  browser = await launch()
  const page = await (await context(browser, 'iPhone 15')).newPage()
  await aligned(page)
  await expect(page.locator('.live-actions')).toBeVisible()
  await tapAnElement(page, true)
  const sheet = page.locator('aside.element-panel.ar-details')
  const vh = page.viewportSize()!.height
  // Peek: what it is, two facts, More details; the camera keeps most of the screen.
  await expect(sheet).toHaveClass(/ep-compact/)
  await expect(sheet.locator('.ep-fact')).toHaveCount(2)
  await expect(sheet.getByRole('region', { name: 'Ask Gemini about this element' })).toHaveCount(0)
  let box = (await sheet.boundingBox())!
  expect(box.y + box.height, 'at the bottom').toBeGreaterThan(vh - 30)
  expect(box.height, 'the peek leaves most of the view').toBeLessThan(0.45 * vh)
  await expect(page.locator('.live-actions')).toHaveCount(0) // the sheet takes the bottom
  await page.screenshot({ path: path.resolve(import.meta.dirname, '../test-results/live-ar/details-phone-peek.png') })

  await sheet.getByRole('button', { name: 'More details' }).click()
  await expect(sheet).not.toHaveClass(/ep-compact/)
  await expect(sheet.getByRole('region', { name: 'Ask Gemini about this element' })).toBeVisible()
  box = (await sheet.boundingBox())!
  expect(box.y, 'the full sheet still leaves the top of the view').toBeGreaterThan(0.2 * vh)
  await page.screenshot({ path: path.resolve(import.meta.dirname, '../test-results/live-ar/details-phone-full.png') })
  await sheet.getByRole('button', { name: 'Collapse details' }).click()
  await expect(sheet).toHaveClass(/ep-compact/)
  await sheet.getByRole('button', { name: 'Close element details' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.locator('.live-actions')).toBeVisible()
})

test('the tap tip shows once the guidance fades, and not again after a tap', async () => {
  browser = await launch()
  const page = await (await context(browser, 'iPad Pro 11 landscape')).newPage()
  await aligned(page)
  const tip = page.locator('.live-top .hud-msg', { hasText: TAP_TIP })
  await expect(tip).toBeVisible({ timeout: 12_000 }) // after the 6 s guidance
  await tapAnElement(page, false)
  await expect(tip).toHaveCount(0)
  await page.locator('aside.element-panel.ar-details').getByRole('button', { name: 'Close element details' }).click()
  await page.waitForTimeout(1500)
  await expect(tip).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('truesite.tapTip'))).toBe('1')
})
