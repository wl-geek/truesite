/**
 * Live AR end to end in Chromium with a synthetic camera (spec 4.1, 4.2; docs/demo/ipad-ar-filming.md).
 *
 * The camera is a ray-traced Y4M video with exact ground truth (live-ar-videos.py): the site P1 sheet (upright A3,
 * 23 cm code at 1.40 m) or the D1 desk sheet, seen by a 1920 x 1080 camera with the app's default intrinsics.
 * Each test launches Chromium with
 *   --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=<video>
 * on an iPad Pro 11 landscape context (screen angle 90), opens /a/site/<id> and checks what a user sees: the start
 * panel, Start camera, the QR detection, the alignment badge, the coach, and the overlay pixels against the
 * silhouette of the model projected with the ground-truth pose. Motion events are synthetic deviceorientation
 * events whose angles are computed from the camera pose of the frame on screen (the frame index is stamped
 * into each frame), so look-around and gravity levelling are checked against the truth too.
 *
 * Needs the videos in E2E_LIVE_AR_VIDEOS (default web/e2e/.videos), made once (about 6 minutes, 1.7 GB):
 *   cd bim && uv run python ../web/e2e/scripts/live-ar-videos.py --out ../web/e2e/.videos --base-url http://127.0.0.1:8814
 * Their QR codes point at that base URL, so the spec opens the app there; playwright.config.ts serves the build on
 * that port (GEMINI_MODE=fake, STORE_BACKEND=memory) as the live-ar project's server. Without the videos the project
 * is left out. Run it alone for realistic timing (one software-GL browser at a time): npx playwright test --project live-ar
 * Screenshots and mask comparisons go to test-results/live-ar.
 *
 * Overlay tolerance: on the 1194 x 772 CSS px canvas, at least 97% of the drawn pixels lie within 8 px of the
 * expected silhouette (any element's projected bounding box), at least 90% of the pixels 8 px inside a concrete
 * column, beam, slab or footing are drawn, and the best-fitting shift of the expected silhouette is within 10 px
 * (about 0.5 degree; the QR pose alone measured 1-6 px).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { BUG } from '../support/bugs'
import { LIVE_AR_URL, LIVE_AR_VIDEOS as VIDEOS } from '../support/env'
import * as H from '../support/live-ar'

test.skip(LIVE_AR_URL === null, 'no live AR videos: make them with scripts/live-ar-videos.py (see the header)')
const BASE = LIVE_AR_URL ?? ''
const OUT = path.resolve(import.meta.dirname, '../test-results/live-ar')
const manifest = (LIVE_AR_URL === null ? null : H.loadManifest(VIDEOS))!
mkdirSync(OUT, { recursive: true })

const TOL_PX = 8
const MAX_SHIFT_PX = 10 // about 0.5 degree: the QR pose from zxing's corners alone is this good (1-6 px measured)
const SITE_COPY = {
  heading: 'Live view · Life size · 1:1',
  coachTracking: 'Turn slowly on the spot and look up; point back at the code to re-align.',
  coachSearch: 'Point the camera at the QR code.',
  coachTips: "Can't find the code. Add more light, move within about 1 m and hold the phone steady.",
  coachLookAround: 'Look around and up. Turn on the spot; point back at the code to re-align.',
  noCheck: 'This sheet shows the design where nothing is built yet, so there is nothing to check here.',
  noCheckLink: 'Try the check in the virtual demo',
  lookAroundBadge: 'Held by motion sensors',
  denied: 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.',
}

type Project = { elements: H.Element[]; anchors: H.Anchor[] }
let project: Project

test.beforeAll(async () => {
  const res = await fetch(`${BASE}/api/projects/site`)
  expect(res.ok, `the app must be served at ${BASE}`).toBe(true)
  project = (await res.json()) as Project
  expect(manifest.baseUrl, 'videos made for another base URL: their codes point elsewhere').toBe(BASE)
})

const anchor = (id: string) => project.anchors.find((a) => a.anchor_id === id)!

// --- browser set-up -------------------------------------------------------------------------------------------
/** `deny`: the camera prompt is answered "Block" (getUserMedia: NotAllowedError, as on a phone). */
async function launch(video: string | null, o: { camera?: 'allow' | 'deny' } = {}): Promise<Browser> {
  const args = ['--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  args.push(o.camera === 'deny' ? '--use-fake-ui-for-media-stream=deny' : '--use-fake-ui-for-media-stream')
  if (video) args.push(`--use-file-for-fake-video-capture=${path.join(VIDEOS, manifest.videos[video].file)}`)
  return chromium.launch({ args })
}

type CtxOpts = {
  /** Store calibrated intrinsics for this camera (the true K), so the setup panel stays closed. */
  calibrated?: boolean
  /** iPadOS Safari: DeviceOrientationEvent.requestPermission resolves to this (recording the user activation). */
  iosMotion?: 'granted' | 'denied'
  /** Grant the camera and the motion sensors (Chrome's defaults on a phone). */
  grant?: boolean
  userAgent?: string
  /** Stub WebXR: immersive-ar "supported", requestSession rejects with this DOMException name. */
  xrStub?: string
}

async function ipad(browser: Browser, o: CtxOpts = {}): Promise<BrowserContext> {
  const { defaultBrowserType: _ignored, ...dev } = devices['iPad Pro 11 landscape']
  const ctx = await browser.newContext({ ...dev, ...(o.userAgent ? { userAgent: o.userAgent } : {}) })
  if (o.grant !== false) await ctx.grantPermissions(['camera', 'accelerometer', 'gyroscope', 'magnetometer'], { origin: BASE })
  await ctx.addInitScript((x) => {
    if (x.calibrated) {
      const v = { f: x.K.f, videoW: x.w, videoH: x.h, source: 'calibrated', at: '2026-10-17T00:00:00.000Z' }
      try { localStorage.setItem(`truesite.intrinsics.${x.w}x${x.h}`, JSON.stringify(v)) } catch { /* no storage */ }
    }
    const w = window as unknown as Record<string, unknown>
    if (x.iosMotion) {
      w.__motionAsks = [] as boolean[]
      ;(DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission = () => {
        ;(w.__motionAsks as boolean[]).push(navigator.userActivation?.isActive ?? false)
        return Promise.resolve(x.iosMotion!)
      }
    }
    if (x.xrStub) {
      const err = x.xrStub
      Object.defineProperty(navigator, 'xr', {
        configurable: true,
        value: {
          isSessionSupported: (mode: string) => Promise.resolve(mode === 'immersive-ar'),
          requestSession: () => Promise.reject(new DOMException('stub', err)),
          addEventListener() {}, removeEventListener() {},
        },
      })
    }
  }, { calibrated: !!o.calibrated, K: manifest.K, w: manifest.width, h: manifest.height, iosMotion: o.iosMotion ?? null, xrStub: o.xrStub ?? null })
  return ctx
}

/** Page errors and console errors, for the evidence and a final no-crash check. */
function watchConsole(page: Page): string[] {
  const out: string[] = []
  page.on('pageerror', (e) => out.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') out.push(`console.error: ${m.text()}`) })
  return out
}

async function openLive(page: Page, anchorId: string, query = ''): Promise<void> {
  await page.goto(`${BASE}/a/site/${anchorId}${query}`)
  await expect(page.locator('.live-start h1')).toBeVisible({ timeout: 20_000 })
  await H.installMotionDriver(page, manifest.stamp)
}

async function startCamera(page: Page, label = 'Start camera'): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect(page.locator('.live-top')).toBeVisible({ timeout: 15_000 })
  const v = await page.evaluate(() => { const e = document.querySelector('video.live-video') as HTMLVideoElement; return [e.videoWidth, e.videoHeight] })
  expect(v, 'the fake camera delivers the video at its own size').toEqual([manifest.width, manifest.height])
}

/** Close the "nothing to check on this sheet" note that opens with the camera, so the coach shows (one message at a time). */
async function closeNote(page: Page): Promise<void> {
  const note = page.locator('.live-top .hud-msg', { hasText: 'nothing to check' })
  if (await note.count()) await note.getByRole('button', { name: 'Close this message' }).click()
  await expect(note).toHaveCount(0)
}

async function waitBadge(page: Page, re: RegExp, timeout = 15_000): Promise<string> {
  await expect.poll(async () => (await H.liveState(page)).badge, { timeout, intervals: [100, 200, 250] }).toMatch(re)
  return (await H.liveState(page)).badge
}

/** Wait until the frame on screen is in [from, to] (the video loops). */
async function waitFrame(page: Page, from: number, to = Infinity, timeout = 30_000): Promise<number> {
  await expect.poll(async () => { const i = (await H.motion.stats(page)).lastIdx; return i >= from && i <= to }, { timeout, intervals: [50] }).toBe(true)
  return (await H.motion.stats(page)).lastIdx
}

async function screenAngle(page: Page): Promise<number> {
  return page.evaluate(() => screen.orientation?.angle ?? 0)
}

/** The frame on screen right after the latest overlay shot (the video loops; the comparisons after it take seconds). */
let shotFrame = -1

/** Overlay vs the expected silhouette for `video`'s frame; saves the overlay, the comparison and a full shot. */
async function overlayFit(page: Page, video: string, frame: number, toWorld: (p: H.V3) => H.V3, name: string): Promise<H.Fit> {
  const shot = await H.overlayShot(page)
  shotFrame = (await H.motion.stats(page)).lastIdx
  const drawn = H.drawnMask(shot.png)
  const view: H.View = { K: manifest.K, videoW: manifest.width, videoH: manifest.height, viewW: drawn.w, viewH: drawn.h }
  const exp = H.expectedMasks(view, manifest.videos[video].cams[frame], toWorld, project.elements)
  const fit = H.compare(drawn, exp, TOL_PX)
  writeFileSync(path.join(OUT, `${name}-overlay.png`), shot.png)
  writeFileSync(path.join(OUT, `${name}-compare.png`), H.comparisonPng(drawn, exp))
  await page.screenshot({ path: path.join(OUT, `${name}-page.png`) })
  writeFileSync(path.join(OUT, `${name}-fit.json`), JSON.stringify({ frame, ...fit }, null, 1))
  return fit
}

/** CSS px per radian on the canvas: the video focal length times the object-fit: cover scale. */
const pxPerRad = (viewW = 1194, viewH = 772) => manifest.K.f * Math.max(viewW / manifest.width, viewH / manifest.height)

function expectAligned(fit: H.Fit, what: string): void {
  const off = Math.hypot(...fit.shift)
  const deg = ((off / pxPerRad()) * 180) / Math.PI
  expect(fit.drawnFrac, `${what}: the overlay draws the model`).toBeGreaterThan(0.02)
  expect(off, `${what}: best-fit shift (${fit.shift.join(', ')}) px = ${deg.toFixed(2)} degrees`).toBeLessThanOrEqual(MAX_SHIFT_PX)
  expect(fit.precision, `${what}: drawn pixels within ${TOL_PX} px of the model's silhouette`).toBeGreaterThanOrEqual(0.97)
  expect(fit.recall, `${what}: concrete members drawn`).toBeGreaterThanOrEqual(0.9)
}

const truth = (_a: H.Anchor) => H.modelToWorld(_a, null)
let browser: Browser | null = null
test.afterEach(async () => {
  await browser?.close()
  browser = null
})

// --- tests ----------------------------------------------------------------------------------------------------
test('P1 steady: first use, Start camera, QR detected, Alignment Good at 0.7 m, overlay on the ground truth, Check as-built off', async () => {
  browser = await launch('p1-steady')
  const page = await (await ipad(browser)).newPage()
  const errors = watchConsole(page)
  await openLive(page, 'P1')

  // the start panel
  await expect(page.locator('.live-start h1')).toHaveText(SITE_COPY.heading)
  await expect(page.locator('.live-start .eyebrow')).toHaveText('Building under construction · P1 South approach')
  await expect(page.locator('.live-start ol.steps li')).toHaveCount(4)
  await expect(page.locator('.live-start ol.steps li').nth(1)).toContainText('Hold the iPad upright at chest height, about 0.7 m from the code')
  await expect(page.getByRole('link', { name: 'Try P1 in the virtual demo' })).toHaveAttribute('href', '/samples?at=P1')
  await expect(page.locator('.dt')).toHaveCount(0) // a tablet: no "made for tablets" popup
  await expect(page.getByRole('button', { name: /Walk inside|Start AR/ })).toHaveCount(0) // hidden without ?xr=1

  await startCamera(page)
  // first use on this camera: the setup panel opens; skip both steps
  const calib = page.getByRole('region', { name: 'Camera setup' })
  await expect(calib.getByRole('heading', { name: 'Calibrate this camera (10 s)' })).toBeVisible()
  await expect(page.locator('.live-actions')).toHaveCount(0) // the actions wait for the panel
  await calib.getByRole('button', { name: 'Skip' }).click()
  await expect(calib.getByRole('heading', { name: 'Check the print scale' })).toBeVisible()
  await calib.getByRole('button', { name: 'Skip' }).click()
  await expect(calib).toHaveCount(0)

  const badge = await waitBadge(page, /^Alignment: Good · /)
  const truthDist = Math.hypot(...H.sub(anchor('P1').position_m, manifest.videos['p1-steady'].cams[0].c))
  expect(Number(badge.match(/· ([\d.]+) m/)![1]), 'distance to the code (badge, 0.1 m steps)').toBeCloseTo(truthDist, 1)
  const st = await H.liveState(page)
  expect(st.chip).toBe('Life size · 1:1')
  expect(st.checkDisabled, 'Check as-built is off on the live sheets').toBe(true)
  // Tapping it says why, once, and links to the same spot in the virtual demo (audit C-05)
  await page.getByRole('button', { name: 'Check as-built' }).click({ force: true }) // aria-disabled, but tappable
  await expect.poll(async () => (await H.liveState(page)).coach).toEqual([`${SITE_COPY.noCheck} ${SITE_COPY.noCheckLink}`])
  await expect(page.locator('.live-top').getByRole('link', { name: SITE_COPY.noCheckLink })).toHaveAttribute('href', '/samples?at=P1')
  await closeNote(page)
  await expect.poll(async () => (await H.liveState(page)).coach).toEqual([SITE_COPY.coachTracking])

  await page.waitForTimeout(800) // let the smoothing settle
  const fit = await overlayFit(page, 'p1-steady', 0, truth(anchor('P1')), 'p1-steady')
  console.log('p1-steady fit', JSON.stringify(fit))
  expectAligned(fit, 'P1 steady')
  expect(errors, errors.join('\n')).toEqual([])
})

test('P1 gravity levelling: a board leaning back 4 degrees, without and with motion events', async () => {
  browser = await launch('p1-lean4')
  const page = await (await ipad(browser, { calibrated: true })).newPage()
  const errors = watchConsole(page)
  await openLive(page, 'P1')
  await startCamera(page)
  await waitBadge(page, /^Alignment: (Good|Fair) · /)
  const v = manifest.videos['p1-lean4']
  const a = anchor('P1')
  const upright = truth(a)
  const leaning = H.modelToWorld(a, v.sheet) // what the QR alone says: the model leans with the board
  await page.waitForTimeout(800)

  // 1. No motion events: the QR pose alone, so the model leans with the board.
  const qrOnlyLean = await overlayFit(page, 'p1-lean4', 0, leaning, 'p1-lean4-nomotion-vs-leaning')
  const qrOnlyUp = await overlayFit(page, 'p1-lean4', 0, upright, 'p1-lean4-nomotion-vs-upright')
  console.log('lean, no motion', JSON.stringify({ vsLeaning: qrOnlyLean, vsUpright: qrOnlyUp }))
  expectAligned(qrOnlyLean, 'no motion events: QR-only pose')
  expect(qrOnlyLean.iouAtZero).toBeGreaterThan(qrOnlyUp.iouAtZero)

  // 2. The motion sensors report the true (level) camera: the model stands upright about the code.
  const angle = await screenAngle(page)
  expect(angle).toBe(90)
  await H.motion.constant(page, H.orientationFor(v.cams[0].R, angle))
  await page.waitForTimeout(800)
  const levUp = await overlayFit(page, 'p1-lean4', 0, upright, 'p1-lean4-motion-vs-upright')
  const levLean = await overlayFit(page, 'p1-lean4', 0, leaning, 'p1-lean4-motion-vs-leaning')
  console.log('lean, level motion', JSON.stringify({ vsUpright: levUp, vsLeaning: levLean }))
  expectAligned(levUp, 'levelled by gravity')
  expect(levUp.iouAtZero).toBeGreaterThan(levLean.iouAtZero)

  // 3. A sensor that disagrees by more than 8 degrees (12 degree roll) is refused: back to the QR pose. Since #107 the
  //    fused pose first re-anchors on the jumped sensor (8 consistent detections; under 1 s here), then levelling
  //    refuses the correction, so allow 2 s.
  await H.motion.constant(page, H.orientationFor(H.rolled(v.cams[0].R, 12), angle))
  await page.waitForTimeout(2000)
  const refused = await overlayFit(page, 'p1-lean4', 0, leaning, 'p1-lean4-badmotion-vs-leaning')
  console.log('lean, 12 deg off motion', JSON.stringify(refused))
  expectAligned(refused, 'levelling refused beyond 8 degrees')
  await H.motion.stop(page)
  expect(errors, errors.join('\n')).toEqual([])
})

/**
 * Lock on the code, then turn on the spot with motion events that match each frame: after the turn the model must
 * be held where the building is (look-around). Returns the page for further checks.
 */
async function lookAround(video: string, name: string): Promise<{ page: Page; errors: string[]; lastSeenFrame: number; fit: H.Fit }> {
  browser = await launch(video)
  const page = await (await ipad(browser, { calibrated: true, iosMotion: 'granted' })).newPage()
  const errors = watchConsole(page)
  await openLive(page, 'P1')
  const v = manifest.videos[video]
  const angle = await screenAngle(page)
  await H.motion.sync(page, v.cams.map((c) => H.orientationFor(c.R, angle)))
  await startCamera(page)
  expect(await page.evaluate(() => (window as unknown as { __motionAsks: boolean[] }).__motionAsks), 'motion permission asked once, inside the tap').toEqual([true])
  await waitFrame(page, 0, v.turn!.startFrame - 20) // the video starts from frame 0 when the camera starts
  await waitBadge(page, /^Alignment: Good · /, 4_000)
  await closeNote(page)
  const lastSeenFrame = v.codeVisible.lastIndexOf(true, v.turn!.startFrame + v.turn!.frames)
  const settled = v.turn!.startFrame + v.turn!.frames
  // The camera holds still after the turn until the video loops; take the shot well before the loop, and again
  // on the next loop if it came round during the shot.
  const to = Math.min(settled + 40, v.frames - 20)
  for (let attempt = 0; attempt < 3; attempt++) {
    const f1 = await waitFrame(page, settled + 12, to)
    const st = await H.liveState(page)
    const fit = await overlayFit(page, video, f1, truth(anchor('P1')), name)
    const after = shotFrame
    if (after < f1) continue // looped back to the code during the shot: not a look-around shot
    expect(st.badge).toBe(SITE_COPY.lookAroundBadge)
    expect(st.coach[0]).toBe(SITE_COPY.coachLookAround)
    expect(st.checkDisabled).toBe(true)
    console.log(name, JSON.stringify({ frame: f1, after, lastSeenFrame, ...fit }))
    return { page, errors, lastSeenFrame, fit }
  }
  throw new Error(`${video}: the video looped during every shot`)
}

test('P1 look-around maths: the code is covered, then a quick turn; the model stays where it belongs', async () => {
  const { fit, errors } = await lookAround('p1-turn-covered', 'p1-turn-covered-held')
  expectAligned(fit, 'look-around with a lock taken while still')
  expect(errors, errors.join('\n')).toEqual([])
})

// Fixed defect (audit C-02): the look-around lock paired the One Euro-SMOOTHED pose of a frame with the LATEST motion
// sample, so a lock taken while turning was off by the rotation between them (1.3-2.8 degrees at 30 degrees/s, 25-54 px
// here). The fused pose (#107) pairs each raw detection with the sample at its capture time, and the fallback lock is
// only re-paired while the device is still (motion.ts nextLock). P1 turn away at 30 degrees/s (the filming pace).
test(BUG.lookAroundLock, async () => {
  const { fit } = await lookAround('p1-turn-slow', 'p1-turn-slow-held')
  expectAligned(fit, 'look-around after a 30 degree/s turn')
})

test('P1 quick turn away with motion events: look-around badge and coach, no search tips after 5 s, re-aligned when the code is back', async () => {
  const { page, errors, lastSeenFrame, fit } = await lookAround('p1-turn', 'p1-turn-motion-held')
  const v = manifest.videos['p1-turn']
  const deg = ((Math.hypot(...fit.shift) / pxPerRad()) * 180) / Math.PI
  test.info().annotations.push({ type: 'measured', description: `held model off by (${fit.shift.join(', ')}) px = ${deg.toFixed(1)} degrees after a quick turn` })
  // still held more than 5 s after the code left: no search tips while look-around holds (frames up to 8 before the loop)
  await waitFrame(page, lastSeenFrame + 5.5 * manifest.fps, v.frames - 8)
  const st = await H.liveState(page)
  expect(st.badge).toBe(SITE_COPY.lookAroundBadge)
  expect(st.coach[0]).toBe(SITE_COPY.coachLookAround)
  // the loop brings the code back: tracking by the code again
  await waitFrame(page, 0, v.turn!.startFrame - 5)
  await waitBadge(page, /^Alignment: (Good|Fair) · /, 4_000)
  expect(errors, errors.join('\n')).toEqual([])
})

test('P1 turn away without motion events: the model hides, then the 5 s tips', async () => {
  browser = await launch('p1-turn')
  const page = await (await ipad(browser, { calibrated: true })).newPage()
  const errors = watchConsole(page)
  await openLive(page, 'P1')
  const v = manifest.videos['p1-turn']
  await startCamera(page)
  await waitFrame(page, 0, v.turn!.startFrame - 10)
  await waitBadge(page, /^Alignment: Good · /, 4_000)
  await closeNote(page)
  const lastSeenFrame = v.codeVisible.lastIndexOf(true, v.turn!.startFrame + v.turn!.frames)
  const f1 = await waitFrame(page, lastSeenFrame + 15, lastSeenFrame + 40) // 1-2.7 s after the code left
  const st = await H.liveState(page)
  expect(st.badge).toBe('No code in view')
  expect(st.coach[0]).toBe(SITE_COPY.coachSearch)
  const hidden = await overlayFit(page, 'p1-turn', f1, truth(anchor('P1')), 'p1-turn-nomotion-hidden')
  expect(hidden.drawnFrac, 'nothing drawn once the code is gone').toBeLessThan(0.001)
  await waitFrame(page, lastSeenFrame + 5.6 * manifest.fps, v.frames - 8)
  expect((await H.liveState(page)).coach[0]).toBe(SITE_COPY.coachTips)
  expect(errors, errors.join('\n')).toEqual([])
})

test('P1 no code at all: No code in view, then the 5 s tips; Check as-built stays off', async () => {
  browser = await launch('p1-nocode')
  const page = await (await ipad(browser, { calibrated: true })).newPage()
  const errors = watchConsole(page)
  await openLive(page, 'P1')
  await startCamera(page)
  const t0 = Date.now()
  await closeNote(page)
  let st = await H.liveState(page)
  expect(st.badge).toBe('No code in view')
  expect(st.coach[0]).toBe(SITE_COPY.coachSearch)
  expect(st.checkDisabled).toBe(true)
  await expect.poll(async () => (await H.liveState(page)).coach[0], { timeout: 9_000, intervals: [100] }).toBe(SITE_COPY.coachTips)
  const after = (Date.now() - t0) / 1000
  console.log('no code: tips after', after.toFixed(1), 's')
  expect(after).toBeGreaterThan(4.3)
  st = await H.liveState(page)
  expect(st.badge).toBe('No code in view')
  await page.screenshot({ path: path.join(OUT, 'p1-nocode-tips.png') })
  expect(errors, errors.join('\n')).toEqual([])
})

test('D1 desk sheet: the building at 1:100 beside the code', async () => {
  browser = await launch('d1-desk')
  const page = await (await ipad(browser, { calibrated: true })).newPage()
  const errors = watchConsole(page)
  await openLive(page, 'D1')
  await expect(page.locator('.live-start h1')).toHaveText('Live view · Scale model · 1:100')
  await expect(page.locator('.live-start')).toContainText("The model appears as a 1:100 scale model beside the code, like an architect's model on the table.")
  await expect(page.locator('.live-start ol.steps li').first()).toContainText('Tap Start camera and allow the camera and motion access.')
  // The 7 cm code is held about 35 cm away, not 1 m, and nothing says step back (audit C-01)
  await expect(page.locator('.live-start ol.steps li').nth(1)).toHaveText('Hold the iPad about 35 cm from the code until it says Alignment: Good.')
  await expect(page.locator('.live-start')).not.toContainText(/step back|about 1 m/)
  await startCamera(page)
  const badge = await waitBadge(page, /^Alignment: Good · /)
  const v = manifest.videos['d1-desk']
  const truthDist = Math.hypot(...v.cams[0].c) // the code centre is the desk origin
  expect(Number(badge.match(/· ([\d.]+) m/)![1])).toBeCloseTo(truthDist, 1)
  await page.getByRole('button', { name: 'Check as-built' }).click({ force: true }) // aria-disabled, but says why when tapped
  await expect(page.locator('.live-top').getByRole('link', { name: SITE_COPY.noCheckLink })).toHaveAttribute('href', '/#virtual') // no D1 spot there (C-05)
  await closeNote(page)
  await expect.poll(async () => (await H.liveState(page)).coach[0]).toBe('Walk around the sheet to look at the model. Keep the code in view.')
  const st = await H.liveState(page)
  expect(st.chip).toBe('Scale model · 1:100')
  expect(st.checkDisabled).toBe(true)
  await page.waitForTimeout(800)
  const fit = await overlayFit(page, 'd1-desk', 0, H.modelToWorld(anchor('D1'), v.sheet), 'd1-desk')
  console.log('d1 fit', JSON.stringify(fit))
  expectAligned(fit, 'D1 at 1:100')
  expect(errors, errors.join('\n')).toEqual([])
})

for (const id of ['P2', 'P3', 'P4']) {
  test(`${id} steady: Good, and the overlay on the ground truth`, async () => {
    const video = `${id.toLowerCase()}-steady`
    browser = await launch(video)
    const page = await (await ipad(browser, { calibrated: true })).newPage()
    const errors = watchConsole(page)
    await openLive(page, id)
    await expect(page.locator('.live-start h1')).toHaveText(SITE_COPY.heading)
    await startCamera(page)
    const badge = await waitBadge(page, /^Alignment: Good · /)
    expect(badge).toBe('Alignment: Good · 0.7 m')
    await page.waitForTimeout(800)
    const fit = await overlayFit(page, video, 0, truth(anchor(id)), video)
    console.log(video, JSON.stringify(fit))
    expectAligned(fit, `${id} steady`)
    expect(errors, errors.join('\n')).toEqual([])
  })
}

test('A different sheet in view: says which code it is and links to it', async () => {
  browser = await launch('p1-other')
  const page = await (await ipad(browser, { calibrated: true })).newPage()
  await openLive(page, 'P1')
  await startCamera(page)
  await expect(page.locator('.live-top .hud-msg-warn > p')).toHaveText('This is a different code (P2). Switch to it', { timeout: 10_000 })
  await expect(page.locator('.live-top').getByRole('link', { name: 'Switch to it' })).toHaveAttribute('href', '/a/site/P2')
  const st = await H.liveState(page)
  expect(st.badge).toBe('No code in view') // its corners are ignored: its printed size may differ
  await page.screenshot({ path: path.join(OUT, 'p1-other-code.png') })
})

test('Camera blocked: the message and the ways on', async () => {
  browser = await launch('p1-steady', { camera: 'deny' })
  const page = await (await ipad(browser, { grant: false })).newPage()
  await openLive(page, 'P1')
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect(page.locator('.live-start [role=alert]')).toHaveText(SITE_COPY.denied, { timeout: 10_000 })
  await expect(page.getByRole('link', { name: 'Open the model viewer' })).toHaveAttribute('href', '/model?project=site')
  await expect(page.getByRole('link', { name: 'Try the virtual demo' })).toHaveAttribute('href', '/samples?at=P1') // the same spot (C-05)
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeEnabled()
  await page.screenshot({ path: path.join(OUT, 'camera-denied.png') })
})

test('?xr=1 shows the hidden AR modes and the camera overlay still works', async () => {
  browser = await launch('p1-steady')
  // Chromium on Android with an AR-capable WebXR: Start AR (place by code) first, Camera overlay second.
  const android = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
  const page = await (await ipad(browser, { calibrated: true, userAgent: android, xrStub: 'NotSupportedError' })).newPage()
  const errors = watchConsole(page)
  await openLive(page, 'P1', '?xr=1')
  await expect(page.getByRole('button', { name: 'Start AR (place by code)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Camera overlay', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Walk inside (AR)' })).toBeVisible()
  await page.screenshot({ path: path.join(OUT, 'xr1-start-panel.png') })
  await startCamera(page, 'Camera overlay')
  await waitBadge(page, /^Alignment: Good · /)
  expect(errors, errors.join('\n')).toEqual([])

  // and without ?xr=1 the same browser shows only Start camera
  const plain = await (await ipad(browser, { calibrated: true, userAgent: android, xrStub: 'NotSupportedError' })).newPage()
  await openLive(plain, 'P1')
  await expect(plain.getByRole('button', { name: 'Start camera', exact: true })).toBeVisible()
  await expect(plain.getByRole('button', { name: /Start AR|Walk inside|Camera overlay/ })).toHaveCount(0)
})

test('P1 head-on from the X (1.5 m) without locking close first: aligned, or flagged as provisional', async () => {
  browser = await launch('p1-x')
  const page = await (await ipad(browser, { calibrated: true })).newPage()
  await openLive(page, 'P1')
  await startCamera(page)
  const badge = await waitBadge(page, /^Alignment: /)
  await page.waitForTimeout(2_500)
  const st = await H.liveState(page)
  const fit = await overlayFit(page, 'p1-x', 0, truth(anchor('P1')), 'p1-x-headon')
  console.log('head-on at the X', JSON.stringify({ first: badge, later: st.badge, coach: st.coach[0], ...fit }))
  // A head-on view can be ambiguous (the pose flip): then the badge must say so (provisional, never Good).
  if (/Good/.test(st.badge)) expectAligned(fit, 'head-on at the X, badge Good')
  else expect(st.badge).toContain('Start within about 1 m of the code, then step back')
})

test('Camera interruptions: frames stall (hide, then resume) and the track ends (back to Start camera, restart works)', async () => {
  browser = await launch('p1-steady')
  const page = await (await ipad(browser, { calibrated: true })).newPage()
  const errors = watchConsole(page)
  await openLive(page, 'P1')
  await startCamera(page)
  await waitBadge(page, /^Alignment: Good · /)

  // no video frames for over a second (a call, an app switch): the model hides instead of freezing on "Good"
  await page.evaluate(() => (document.querySelector('video.live-video') as HTMLVideoElement).pause())
  await waitBadge(page, /^No code in view$/, 4_000)
  expect((await overlayFit(page, 'p1-steady', 0, truth(anchor('P1')), 'stall-hidden')).drawnFrac).toBeLessThan(0.001)
  await page.evaluate(() => (document.querySelector('video.live-video') as HTMLVideoElement).play())
  await waitBadge(page, /^Alignment: Good · /, 6_000)

  // the track ends for good (another app took the camera): back to the start panel, and a restart works
  await page.evaluate(() => {
    const v = document.querySelector('video.live-video') as HTMLVideoElement
    ;(v.srcObject as MediaStream).getVideoTracks()[0].dispatchEvent(new Event('ended'))
  })
  await expect(page.locator('.live-start [role=status]')).toHaveText('The camera stopped. Tap Start camera to continue.')
  // a double tap on Start camera starts one camera and one overlay
  const gum = await page.evaluate(() => {
    const md = navigator.mediaDevices as MediaDevices & { __n?: number }
    const orig = md.getUserMedia.bind(md)
    md.__n = 0
    md.getUserMedia = (c) => { md.__n!++; return orig(c) }
    return md.__n
  })
  expect(gum).toBe(0)
  await page.getByRole('button', { name: 'Start camera', exact: true }).dblclick()
  await expect(page.locator('.live-top')).toBeVisible({ timeout: 15_000 })
  expect(await page.evaluate(() => (navigator.mediaDevices as MediaDevices & { __n?: number }).__n), 'getUserMedia calls for a double tap').toBe(1)
  await waitBadge(page, /^Alignment: Good · /)
  await page.waitForTimeout(800)
  expectAligned(await overlayFit(page, 'p1-steady', 0, truth(anchor('P1')), 'restart'), 'after a camera restart')
  expect(await page.locator('canvas.live-canvas').count(), 'one overlay canvas').toBe(1)
  expect(errors, errors.join('\n')).toEqual([])
})

test('iPad with Motion & Orientation denied: no look-around, the model hides when the code leaves the view', async () => {
  browser = await launch('p1-turn')
  const page = await (await ipad(browser, { calibrated: true, iosMotion: 'denied' })).newPage()
  await openLive(page, 'P1')
  const v = manifest.videos['p1-turn']
  const angle = await screenAngle(page)
  await H.motion.sync(page, v.cams.map((c) => H.orientationFor(c.R, angle)))
  await startCamera(page)
  await waitFrame(page, 0, v.turn!.startFrame - 10)
  await waitBadge(page, /^Alignment: Good · /, 4_000)
  const settled = v.turn!.startFrame + v.turn!.frames
  await waitFrame(page, settled + 15, settled + 40)
  const st = await H.liveState(page)
  console.log('motion denied after the turn', JSON.stringify(st))
  expect(st.badge).toBe('No code in view') // no look-around without the sensors: hidden, as designed
  const f = (await H.motion.stats(page)).lastIdx
  const fit = await overlayFit(page, 'p1-turn', f, truth(anchor('P1')), 'p1-turn-motion-denied')
  expect(fit.drawnFrac).toBeLessThan(0.001)
})

// Fixed (audit C-15): the live page says that Motion & Orientation is off, since levelling and look-around depend on it
// (docs/demo/ipad-ar-filming.md: "Motion is what keeps the model level"), and how to allow it.
test(BUG.motionDenied, async () => {
  browser = await launch('p1-steady')
  const page = await (await ipad(browser, { calibrated: true, iosMotion: 'denied' })).newPage()
  await openLive(page, 'P1')
  await startCamera(page)
  await waitBadge(page, /^Alignment: Good · /)
  await expect(page.locator('.live-page')).toContainText(/motion/i)
  await expect.poll(async () => (await H.liveState(page)).warnings).toEqual([
    "Motion & Orientation is off, so the model won't stay level or stay in place when you turn. To allow it, close the browser, open this page again and tap Allow.",
  ])
})
