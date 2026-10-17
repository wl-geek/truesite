/**
 * Live AR on a stand: with the camera perfectly still (the ray-traced P1 videos repeat one pose), the model must hold
 * still on screen. The overlay's test hook (window.__arFrames, scene/overlay.ts) records where the model's bounding-box
 * corners land on screen every rendered frame; jitter is their frame-to-frame movement (RMS, CSS px) and their spread.
 * Run with the motion sensors off (QR only), with exact sensor readings, and with sensor noise like a phone's.
 */
import path from 'node:path'
import { chromium, devices, expect, test, type Browser, type Page } from '@playwright/test'
import { LIVE_AR_URL, LIVE_AR_VIDEOS as VIDEOS } from '../support/env'
import * as H from '../support/live-ar'

test.skip(LIVE_AR_URL === null, 'no live AR videos: make them with scripts/live-ar-videos.py (see live-ar.e2e.ts)')
const BASE = LIVE_AR_URL ?? ''
const manifest = (LIVE_AR_URL === null ? null : H.loadManifest(VIDEOS))!

let browser: Browser | null = null
test.afterEach(async () => {
  await browser?.close()
  browser = null
})

type Frame = { t: number; by: string; pts: [number, number][] }
export type Jitter = { frames: number; fused: number; stepRms: number; spread: number }

async function open(video: string): Promise<Page> {
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', `--use-file-for-fake-video-capture=${path.join(VIDEOS, manifest.videos[video].file)}`] })
  const { defaultBrowserType: _ignored, ...dev } = devices['iPad Pro 11 landscape']
  const ctx = await browser.newContext(dev)
  await ctx.grantPermissions(['camera', 'accelerometer', 'gyroscope', 'magnetometer'], { origin: BASE })
  await ctx.addInitScript((x) => {
    ;(window as unknown as { __arFrames: unknown[] }).__arFrames = []
    localStorage.setItem(`truesite.intrinsics.${x.w}x${x.h}`, JSON.stringify({ f: x.K.f, videoW: x.w, videoH: x.h, source: 'calibrated', at: '2026-10-17T00:00:00.000Z' }))
  }, { K: manifest.K, w: manifest.width, h: manifest.height })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/a/site/P1`)
  await expect(page.locator('.live-start h1')).toBeVisible({ timeout: 20_000 })
  await H.installMotionDriver(page, manifest.stamp)
  return page
}

/** Device orientation events at 60 Hz around the true orientation, with Gaussian noise of `sigmaDeg` on each angle. */
async function noisyMotion(page: Page, o: { alpha: number; beta: number; gamma: number }, sigmaDeg: number): Promise<void> {
  await page.evaluate(([o, sigma]) => {
    const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
    const send = () => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {
      alpha: o.alpha + sigma * gauss(), beta: o.beta + sigma * gauss(), gamma: o.gamma + sigma * gauss(), absolute: false }))
    send()
    setInterval(send, 16)
  }, [o, sigmaDeg] as const)
}

/** Record `ms` of frames and measure how much the model moves on a still camera. */
async function measure(page: Page, ms = 4000): Promise<Jitter> {
  await page.evaluate(() => { (window as unknown as { __arFrames: unknown[] }).__arFrames.length = 0 })
  await page.waitForTimeout(ms)
  const frames = await page.evaluate(() => (window as unknown as { __arFrames: Frame[] }).__arFrames)
  const w = 1194, h = 772
  const onScreen = (p: [number, number]) => p[0] > -0.5 * w && p[0] < 1.5 * w && p[1] > -0.5 * h && p[1] < 1.5 * h
  let stepSq = 0, steps = 0, spread = 0
  for (let k = 0; k < 8; k++) {
    const pts = frames.map((f) => f.pts[k]).filter(onScreen)
    if (pts.length < 10) continue
    for (let i = 1; i < pts.length; i++) { stepSq += (pts[i][0] - pts[i - 1][0]) ** 2 + (pts[i][1] - pts[i - 1][1]) ** 2; steps++ }
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length
    spread = Math.max(spread, Math.sqrt(pts.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / pts.length))
  }
  return { frames: frames.length, fused: frames.filter((f) => f.by === 'fused').length, stepRms: Math.sqrt(stepSq / Math.max(1, steps)), spread }
}

async function start(page: Page, video: string, motion: 'off' | 'exact' | number): Promise<void> {
  const angle = await page.evaluate(() => screen.orientation?.angle ?? 0)
  const o = H.orientationFor(manifest.videos[video].cams[0].R, angle)
  if (motion === 'exact') await H.motion.constant(page, o)
  else if (typeof motion === 'number') await noisyMotion(page, o, motion)
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect.poll(async () => (await H.liveState(page)).badge, { timeout: 15_000 }).toMatch(/^Alignment: /)
  await page.waitForTimeout(2500) // settle
}

/**
 * Limits (CSS px per frame, RMS) with room over what the fixes measured (stabilised corners, a steady crop, the whole-
 * frame look kept out of the pose, the sensors smoothed). Before them: 0.98 / 2.27 / 44 / 1.45 / 3.21 px. Sensor noise
 * of 0.05 degrees per angle is already more than a phone's attitude shows at rest.
 */
const CASES = [
  { video: 'p1-steady', motion: 'off', maxStep: 1, note: '0.7 m from the code, no motion sensors' },
  { video: 'p1-steady', motion: 0.05, maxStep: 1.5, note: '0.7 m, noisy sensors' },
  { video: 'p1-x', motion: 'exact', maxStep: 0.8, note: 'the X, 1.5 m, sensors' },
  { video: 'p1-x', motion: 0.05, maxStep: 2, note: 'the X, noisy sensors' },
  { video: 'p1-x', motion: 'off', maxStep: 10, note: 'the X without sensors: head-on from afar the tilt is loose (Fair), still no shake' },
] as const

for (const c of CASES) {
  test(`on a stand, ${c.note}: the model holds still (under ${c.maxStep} px a frame)`, async () => {
    const page = await open(c.video)
    await start(page, c.video, c.motion)
    const j = await measure(page)
    console.log(`JITTER ${c.video} motion=${c.motion}`, JSON.stringify({ ...j, stepRms: +j.stepRms.toFixed(2), spread: +j.spread.toFixed(2), badge: (await H.liveState(page)).badge }))
    expect(j.frames, 'frames rendered with the model in view').toBeGreaterThan(20)
    if (c.motion !== 'off') expect(j.fused, 'posed by the sensor fusion').toBe(j.frames)
    expect(j.stepRms, 'frame-to-frame movement of the model on screen').toBeLessThan(c.maxStep)
  })
}
