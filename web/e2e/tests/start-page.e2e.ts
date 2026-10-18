import { expectClean, expect, test, VIEWPOINTS } from '../support/fixtures'
import type { Page } from '@playwright/test'

const SECTIONS = [
  { id: 'how', label: 'How it works', heading: 'How it works' },
  { id: 'live', label: 'Live AR', heading: 'See the BIM model live, through your camera' },
  { id: 'virtual', label: 'Virtual demo', heading: 'Try the idea in a virtual demo' },
  { id: 'about', label: 'About', heading: 'AR × BIM × AI, where the work happens' },
] as const

/** Top of a section relative to the bottom of the sticky top bar, once smooth scrolling has settled. */
async function sectionOffset(page: Page, id: string): Promise<number> {
  let last = Number.NaN
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate((id) => {
      const bar = document.querySelector('.topbar')!.getBoundingClientRect().bottom
      return Math.round(document.getElementById(id)!.getBoundingClientRect().top - bar)
    }, id)
    if (now === last) return now
    last = now
    await page.waitForTimeout(100)
  }
  return last
}

async function atBottom(page: Page): Promise<boolean> {
  return page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4)
}

/** The visible set of section links: the bar on wide screens, the menu (opened here) on narrow ones. */
async function sectionLinks(page: Page) {
  const bar = page.locator('.tb-nav')
  if (await bar.isVisible()) return bar
  await page.getByRole('button', { name: 'Menu' }).click()
  const menu = page.locator('#tb-menu')
  await expect(menu).toBeVisible()
  return menu
}

test.describe('start page', () => {
  test('one page: hero, How it works, Live AR, Virtual demo, About, in that order; loads cleanly @handheld', async ({ page, log }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('TrueSite · AR × BIM × AI for construction')
    await expect(page.getByRole('heading', { level: 1, name: 'See the design where you build. Check the build against it.' })).toBeVisible()
    for (const s of SECTIONS) await expect(page.locator(`section#${s.id}`).getByRole('heading', { name: s.heading, exact: true }).first()).toBeAttached()
    const order = await page.evaluate(() => [...document.querySelectorAll('main section[id]')].map((s) => s.id))
    expect(order).toEqual(['demo', 'how', 'live', 'virtual', 'about'])
    await expect(page.getByText('Visual check, not a survey: offsets are rough, in tens of centimetres.')).toBeVisible()
    await expect(page.locator('footer')).toContainText('Google Cloud AI Builder Cup 2026')
    await page.waitForLoadState('networkidle')
    // The hero picture really decoded (webp or jpg).
    expect(await page.locator('.home-visual img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    expectClean(log)
  })

  test('each nav link scrolls its section under the bar, updates the address and marks the link @handheld', async ({ page, log }) => {
    await page.goto('/')
    for (const s of SECTIONS) {
      const links = await sectionLinks(page)
      await links.getByRole('link', { name: s.label }).click()
      await expect(page).toHaveURL(new RegExp(`/#${s.id}$`))
      await expect(page.locator('#tb-menu')).toBeHidden() // the phone menu closes after a pick
      const offset = await sectionOffset(page, s.id)
      // The section starts at the bar, unless the page ends first (About is the last section).
      if (!(await atBottom(page))) expect(Math.abs(offset), `${s.id} top vs the bar`).toBeLessThanOrEqual(4)
      else expect(offset).toBeLessThanOrEqual(4)
      if (await page.locator('.tb-nav').isVisible()) {
        await expect(page.locator('.tb-nav').getByRole('link', { name: s.label })).toHaveAttribute('aria-current', 'location')
        await expect(page.locator('.tb-nav [aria-current="location"]')).toHaveCount(1)
      }
    }
    // Picking sections replaces the address instead of stacking history entries.
    expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(2)
    expectClean(log)
  })

  test('the scroll marker follows the reader; the progress line fills from 0 to 1', async ({ page }) => {
    await page.goto('/')
    const progress = () => page.locator('.topbar').evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--tb-progress') || el.style.getPropertyValue('--tb-progress') || 0))
    await expect.poll(progress).toBe(0)
    await expect(page.locator('.tb-nav [aria-current]')).toHaveCount(0) // the hero is not a nav section
    await page.locator('#virtual').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.mouse.wheel(0, 1) // a real scroll event for the listeners
    await expect(page.locator('.tb-nav').getByRole('link', { name: 'Virtual demo' })).toHaveAttribute('aria-current', 'location')
    const mid = await progress()
    expect(mid).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(0.95)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.mouse.wheel(0, 1)
    await expect.poll(progress).toBeGreaterThan(0.99)
    await expect(page.locator('.tb-nav').getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'location')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.mouse.wheel(0, -1)
    await expect.poll(progress).toBe(0)
    await expect(page.locator('.tb-nav [aria-current]')).toHaveCount(0)
  })

  test('a shared /#about link lands on About; the brand goes back to the top', async ({ page }) => {
    await page.goto('/#about')
    await expect.poll(() => sectionOffset(page, 'about')).toBeLessThanOrEqual(4)
    await expect(page.locator('.tb-nav').getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'location')
    await page.getByRole('link', { name: /TrueSite Live BIM on site/ }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('both Start live AR buttons and Try the virtual demo jump to their sections', async ({ page }) => {
    await page.goto('/')
    await page.locator('.home-ctas').getByRole('link', { name: 'Start live AR' }).click()
    await expect(page).toHaveURL(/\/#live$/)
    await expect.poll(() => sectionOffset(page, 'live')).toBeLessThanOrEqual(4)
    await page.locator('.home-ctas').getByRole('link', { name: 'Try the virtual demo' }).click()
    await expect(page).toHaveURL(/\/#virtual$/)
    await expect.poll(() => sectionOffset(page, 'virtual')).toBeLessThanOrEqual(4)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.locator('.topbar').getByRole('link', { name: 'Start live AR' }).click()
    await expect(page).toHaveURL(/\/#live$/)
    await expect.poll(() => sectionOffset(page, 'live')).toBeLessThanOrEqual(4)
  })

  test('every /sheets, /models and /media file the page links to is a real file, and every app link opens a page', async ({ page, request }) => {
    await page.goto('/')
    await page.locator('details.home-details summary').click() // the download list folds away
    const hrefs = [...new Set(await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!)))]
    const files = hrefs.filter((h) => /^\/(sheets|models|media)\//.test(h))
    expect(files.sort()).toEqual(['/media/TrueSite-deck.pdf', '/sheets/site-D1.pdf', '/sheets/site-P1.pdf', '/sheets/site-P2.pdf', '/sheets/site-P3.pdf',
      '/sheets/site-P4.pdf', '/sheets/site-layout.pdf'])
    for (const href of files) {
      const res = await request.get(href)
      expect(res.status(), `${href} (sheets: generate them, see README.md)`).toBe(200)
      expect(res.headers()['content-type'], href).toBe('application/pdf')
      const body = await res.body()
      expect(body.subarray(0, 5).toString(), href).toBe('%PDF-')
      await expect(page.locator(`a[href="${href}"]`).first()).toHaveAttribute('download', '')
    }
    // The 3D model and the Quick Look file the live page can fetch.
    const project = await (await request.get('/api/projects/site')).json()
    const glb = await request.get(project.model_url)
    expect(glb.status()).toBe(200)
    expect(glb.headers()['content-type']).toBe('model/gltf-binary')
    const usdz = await request.get('/models/site.usdz')
    expect(usdz.status()).toBe(200)
    expect(usdz.headers()['content-type']).toBe('model/vnd.usdz+zip')
    // In-app links: the SPA answers each one with the app.
    const internal = hrefs.filter((h) => h.startsWith('/') && !files.includes(h))
    expect(internal).toEqual(expect.arrayContaining(['/model', '/a/site/D1', ...VIEWPOINTS.map((v) => `/a/site/${v.id}`),
      ...VIEWPOINTS.map((v) => `/samples?at=${v.id}`)]))
    for (const href of internal) {
      const res = await request.get(href)
      expect(res.status(), href).toBe(200)
      expect(res.headers()['content-type'], href).toContain('text/html')
    }
    // External links open in a new tab without handing over window.opener.
    for (const a of await page.locator('a[href^="http"]').all()) {
      await expect(a).toHaveAttribute('target', '_blank')
      await expect(a).toHaveAttribute('rel', /noopener/)
    }
  })

  test('the demo video is on YouTube too: linked under the player and in the team section', async ({ page }) => {
    await page.goto('/')
    for (const where of ['#demo', '#about']) {
      const link = page.locator(where).getByRole('link', { name: 'Watch the demo on YouTube' })
      await expect(link).toHaveAttribute('href', 'https://youtu.be/M8zh02kMtk4')
      await expect(link).toHaveAttribute('target', '_blank')
    }
  })

  test('a shared link gets a preview: title, description and a 1200 x 630 image that is served', async ({ request }) => {
    const html = await (await request.get('/')).text() // what a link preview reads: the page as served, no JavaScript
    const meta = (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]+)"`).exec(html)?.[1]
    expect(meta('og:title')).toBe('TrueSite · AR × BIM × AI for construction')
    expect(meta('og:description')).toMatch(/Gemini/)
    expect(meta('twitter:card')).toBe('summary_large_image')
    const image = new URL(meta('og:image') ?? '')
    expect(image.protocol).toBe('https:') // previews need an absolute URL
    const res = await request.get(image.pathname)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('image/jpeg')
    const jpeg = await res.body()
    expect(jpeg.length).toBeLessThan(300 * 1024) // WhatsApp leaves out bigger preview images
    let size: number[] = []
    for (let i = 2; i + 9 < jpeg.length && jpeg[i] === 0xff; i += 2 + jpeg.readUInt16BE(i + 2)) {
      const m = jpeg[i + 1]
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { size = [jpeg.readUInt16BE(i + 7), jpeg.readUInt16BE(i + 5)]; break } // start of frame
    }
    expect(size).toEqual([1200, 630])
    expect([meta('og:image:width'), meta('og:image:height')]).toEqual(['1200', '630'])
  })

  test('the nav works from the other pages too: 3D model -> About', async ({ page }) => {
    await page.goto('/model')
    await expect(page.locator('.model-card')).toBeVisible()
    await page.locator('.tb-nav').getByRole('link', { name: 'About' }).click()
    await expect(page).toHaveURL(/\/#about$/)
    await expect.poll(() => sectionOffset(page, 'about')).toBeLessThanOrEqual(4)
  })

  test('an unknown path opens the start page; an unknown API path is a JSON 404', async ({ page, request }) => {
    await page.goto('/no/such/page')
    await expect(page.getByRole('heading', { level: 1, name: /See the design where you build/ })).toBeVisible()
    const res = await request.get('/api/no-such-route')
    expect(res.status()).toBe(404)
    expect(res.headers()['content-type']).toContain('application/json')
  })

  test('the demo video: the hero link jumps to it; poster, captions and the video are served, the video in byte ranges', async ({ page, request }) => {
    await page.goto('/')
    await page.locator('.home-hero').getByRole('link', { name: /Watch the demo video/ }).click()
    await expect(page).toHaveURL(/#demo$/)
    const video = page.locator('section#demo video')
    await expect(video).toBeInViewport()
    await expect(video.locator('track[kind="captions"][srclang="en"]')).toHaveCount(1)
    for (const [file, type] of [['/media/truesite-demo-poster.jpg', 'image/jpeg'], ['/media/truesite-demo.vtt', 'text/vtt']]) {
      const r = await request.get(file)
      expect(r.status(), file).toBe(200)
      expect(r.headers()['content-type'], file).toContain(type)
    }
    expect((await request.get('/media/truesite-demo.vtt').then((r) => r.text())).startsWith('WEBVTT')).toBe(true)
    // iPhone Safari plays a video only from a server that answers range requests.
    const part = await request.get('/media/truesite-demo.mp4', { headers: { Range: 'bytes=0-1023' } })
    expect(part.status()).toBe(206)
    expect(part.headers()['content-type']).toContain('video/mp4')
    expect((await part.body()).length).toBe(1024)
    // Chrome asks for the whole file at once (bytes=0-), and Cloud Run refuses any response over 32 MiB.
    const size = Number(part.headers()['content-range']?.split('/')[1])
    expect(size).toBeLessThan(30 * 1024 * 1024)
  })

  test('a missing sheet is a real 404, not the app saved as a PDF', async ({ request }) => {
    const res = await request.get('/sheets/site-P9.pdf')
    expect(res.status()).toBe(404)
    expect(res.headers()['content-type'] ?? '').not.toContain('text/html')
  })

  test('the viewpoint cards open live AR and the virtual demo at the right spot', async ({ page }) => {
    await page.goto('/')
    for (const v of VIEWPOINTS) {
      await expect(page.locator('#live .vp-card', { hasText: v.name })).toHaveAttribute('href', `/a/site/${v.id}`)
      await expect(page.locator('#virtual .vp-card', { hasText: v.name })).toHaveAttribute('href', `/samples?at=${v.id}`)
    }
    await page.locator('#virtual .vp-card', { hasText: 'East gable' }).click()
    await expect(page).toHaveURL(/\/samples\?at=P4$/)
    await expect(page.getByRole('application', { name: /Virtual demo at P4, East gable/ })).toBeVisible()
  })
})
