import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'
import { BASE_URL, EXTERNAL, LIMITS_ENV, LIMITS_PORT, LIVE_AR_PORT, LIVE_AR_URL, PORT } from './support/env'

/**
 * TrueSite end-to-end suite (see README.md). Runs against the built app served by the real FastAPI server with the
 * offline Gemini stand-in (GEMINI_MODE=fake) and the in-memory store, so it needs no cloud access and costs nothing.
 *
 * Projects:
 *   desktop-chrome          every spec except the limit specs
 *   ipad-pro-11-landscape   specs tagged @handheld (Chromium with the iPad's viewport, touch and user agent)
 *   iphone-15               specs tagged @handheld
 *   limits                  limits.e2e.ts against a second server with tight check limits
 *   live-ar                 live-ar.e2e.ts: Start camera on synthetic camera videos with exact ground truth, one
 *                           browser at a time; only when the videos exist (scripts/live-ar-videos.py)
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const STATIC_DIR = process.env.E2E_STATIC_DIR ?? path.join(repo, 'web', 'dist')
const MODELS_DIR = process.env.E2E_MODELS_DIR ?? path.join(repo, 'bim', 'models')
const UV = process.env.E2E_UV ?? 'uv'

type Server = NonNullable<Extract<PlaywrightTestConfig['webServer'], unknown[]>>[number]

function server(port: number, env: Record<string, string>, reuse: boolean): Server {
  return {
    command: `${UV} run uvicorn --factory app.main:create_app --host 127.0.0.1 --port ${port}`,
    cwd: path.join(repo, 'server'),
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: reuse && !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { STATIC_DIR, MODELS_DIR, GEMINI_MODE: 'fake', STORE_BACKEND: 'memory', ...env },
  }
}

/** Specs that run in a project of their own. */
const OWN_PROJECT = /(limits|live-ar[\w-]*)\.e2e\.ts/

// Fake camera for the live page: Chromium's test pattern, granted without a prompt.
const chromiumArgs = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  outputDir: './test-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: chromiumArgs },
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
      testIgnore: OWN_PROJECT,
    },
    {
      name: 'ipad-pro-11-landscape',
      use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium' },
      grep: /@handheld/,
      testIgnore: OWN_PROJECT,
    },
    {
      name: 'iphone-15',
      use: { ...devices['iPhone 15'], browserName: 'chromium' },
      grep: /@handheld/,
      testIgnore: OWN_PROJECT,
    },
    ...(LIVE_AR_URL === null ? [] : [{
      name: 'live-ar',
      testMatch: /live-ar[\w-]*\.e2e\.ts/,
      // Each test launches its own Chromium with a camera video; one at a time keeps the timing realistic.
      workers: 1,
      timeout: 120_000,
      expect: { timeout: 10_000 },
    }]),
    {
      name: 'limits',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
      testMatch: /limits\.e2e\.ts/,
    },
  ],
  webServer: EXTERNAL ? undefined : [
    // Generous limits: the suite runs dozens of checks from one address. Reused when already running.
    server(PORT, { CHECKS_PER_IP_PER_HOUR: '1000', ASKS_PER_IP_PER_HOUR: '1000', ISSUES_PER_IP_PER_HOUR: '1000' }, true),
    // Never reused: a server that happens to sit on the port would have other limits and used-up counters.
    ...(LIMITS_PORT === null ? [] : [server(LIMITS_PORT, LIMITS_ENV, false)]),
    // Live AR: the app at the base URL the camera videos' QR codes point at (reused when already running).
    ...(LIVE_AR_PORT === null || LIVE_AR_PORT === PORT ? [] : [server(LIVE_AR_PORT, {}, true)]),
  ],
})
