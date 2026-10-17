import { test as base, expect, type ConsoleMessage, type Page, type Route } from '@playwright/test'

/** What a page did while a test ran: attached to every test as page-log.json. */
export type PageLog = {
  /** Console errors and uncaught exceptions (CSP reports are kept apart, in `csp`). */
  errors: string[]
  /** Content-Security-Policy-Report-Only violations: console reports and securitypolicyviolation events. */
  csp: string[]
  /** Requests that failed at the network level. */
  failed: string[]
  /** Responses with status 400 or more. */
  http: string[]
}

const CSP_TEXT = /Content Security Policy|\[Report Only\]|csp-violation/i

export const test = base.extend<{ log: PageLog }>({
  log: [
    async ({ page }, use, testInfo) => {
      const log: PageLog = { errors: [], csp: [], failed: [], http: [] }
      const onConsole = (where: string) => (m: ConsoleMessage) => {
        const text = m.text()
        if (CSP_TEXT.test(text)) log.csp.push(`${where}: ${text}`)
        else if (m.type() === 'error') log.errors.push(`${where}: ${text}`)
      }
      page.on('console', onConsole('page'))
      page.on('worker', (w) => w.on('console', onConsole(`worker ${w.url()}`)))
      page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`))
      page.on('requestfailed', (r) => log.failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`))
      page.on('response', (r) => {
        if (r.status() >= 400) log.http.push(`${r.status()} ${r.request().method()} ${r.url()}`)
      })
      // The console report can be dropped for some resource types; the DOM event never is.
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          console.warn(`csp-violation ${e.disposition} ${e.effectiveDirective} ${e.blockedURI || '(inline)'} at ${e.sourceFile}:${e.lineNumber}`)
        })
      })
      await use(log)
      await testInfo.attach('page-log.json', { body: JSON.stringify(log, null, 2), contentType: 'application/json' })
    },
    { auto: true },
  ],
})

export { expect }

/** No console errors, no failed requests, no 4xx/5xx and no CSP reports (allow lists for the error-path tests). */
export function expectClean(log: PageLog, allow: { http?: RegExp; errors?: RegExp; failed?: RegExp } = {}): void {
  expect.soft(log.errors.filter((e) => !allow.errors?.test(e)), 'console errors').toEqual([])
  expect.soft(log.failed.filter((e) => !allow.failed?.test(e)), 'failed requests').toEqual([])
  expect.soft(log.http.filter((e) => !allow.http?.test(e)), 'HTTP errors').toEqual([])
  expect.soft(log.csp, 'Content-Security-Policy-Report-Only violations').toEqual([])
}

/**
 * Live AR runs only on tablets and phones: a laptop or PC gets the popup and nothing else. Desktop Chrome has the fake
 * camera the live tests need, so their pages present as an iPad (the user agent ui/device.ts reads). Call before goto.
 */
export async function presentAsTablet(page: Page): Promise<void> {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'userAgent', {
    get: () => 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  }))
}

// ---- the virtual demo ------------------------------------------------------------------------------------------

export const VIEWPOINTS = [
  { id: 'P1', name: 'South approach' },
  { id: 'P2', name: 'Under the slab' },
  { id: 'P3', name: 'Under the open bay' },
  { id: 'P4', name: 'East gable' },
] as const

/**
 * The planted defects each QR spot's opening view features (web/src/sim/asBuilt.ts `featuredAt`). Since #103 every
 * one of them gets a numbered mark, so it is among the elements Gemini is asked about.
 */
export const FEATURED: Record<string, readonly string[]> = {
  P1: ['RC column C2', 'RC column B2'],
  P2: ['RC column C1', 'Beam C2-D2', 'Beam D1-D2'],
  P3: ['Truss T3 diagonal 6', 'Purlin P4 B-C', 'Edge beam B3-C3'],
  P4: ['Edge protection east', 'Purlin P6 C-D'],
}
export const PLANTED_TOTAL = 10

export type UploadPart = { name: string; filename: string | null; type: string; size: number; head: string }

/**
 * Record each /api/check upload in the page. Playwright can't read a multipart body that carries blobs
 * (postDataBuffer() is null), so this wraps fetch before the app loads; call it before the first goto. Returns a
 * reader for the latest upload's parts, with the first three bytes of each file as hex.
 */
export async function recordCheckUploads(page: Page): Promise<() => Promise<UploadPart[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __checkUploads: FormData[] }
    w.__checkUploads = []
    const original = window.fetch
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/api\/check$/.test(url) && init?.body instanceof FormData) w.__checkUploads.push(init.body)
      return original.call(window, input, init)
    }
  })
  return () => page.evaluate(async () => {
    const form = (window as unknown as { __checkUploads: FormData[] }).__checkUploads.at(-1)
    const parts: { name: string; filename: string | null; type: string; size: number; head: string }[] = []
    for (const [name, value] of form?.entries() ?? []) {
      if (typeof value === 'string') {
        parts.push({ name, filename: null, type: 'text', size: value.length, head: '' })
        continue
      }
      const head = [...new Uint8Array(await value.slice(0, 3).arrayBuffer())].map((b) => b.toString(16).padStart(2, '0')).join('')
      parts.push({ name, filename: value.name, type: value.type, size: value.size, head })
    }
    return parts
  })
}

/** Open the virtual demo at a QR spot and wait until the site is built (the coach card shows). */
export async function enterVirtualSite(page: Page, id: string): Promise<void> {
  await page.goto(`/samples?at=${id}`)
  await expect(page.getByRole('application', { name: new RegExp(`Virtual demo at ${id}`) })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible({ timeout: 60_000 })
}

/** Tap Check as-built and wait for the results panel. */
export async function runVirtualCheck(page: Page, id: string): Promise<void> {
  await page.getByRole('button', { name: 'Check as-built' }).click()
  await expect(page.getByRole('heading', { name: `As-built check · ${id}` })).toBeVisible({ timeout: 60_000 })
}

/**
 * The planted defects (web/src/sim/asBuilt.ts) as a live Gemini answer would report them. The offline stand-in
 * reads every element of the site project as matching, so the deviation UI (scorecard hits, Why it matters, Draft
 * issue) is only reachable by rewriting the server's real response. The run itself is still stored by the server.
 */
const PLANTED: Record<string, { status: 'missing' | 'misplaced'; direction?: string; cm?: number; severity: 'high' | 'medium' | 'low' }> = {
  'RC column C2': { status: 'missing', severity: 'high' },
  'RC column B2': { status: 'misplaced', direction: 'left', cm: 60, severity: 'high' },
  'RC column C1': { status: 'misplaced', direction: 'back', cm: 60, severity: 'high' },
  'Beam C2-D2': { status: 'missing', severity: 'medium' },
  'Beam D1-D2': { status: 'missing', severity: 'medium' },
  'Truss T3 diagonal 6': { status: 'missing', severity: 'medium' },
  'Purlin P4 B-C': { status: 'missing', severity: 'low' },
  'Edge beam B3-C3': { status: 'missing', severity: 'medium' },
  'Edge protection east': { status: 'missing', severity: 'high' },
  'Purlin P6 C-D': { status: 'missing', severity: 'low' },
}

type WireFinding = {
  mark: number; name: string; status: string; severity: string | null; explanation: string
  offset: { direction: string; approx_cm: number } | null
}

/**
 * Rewrite /api/check answers so Gemini "finds" every planted defect in view but the last one (a miss) and reports
 * the live model's name. Returns the rewritten findings of the latest check.
 */
export async function stubGeminiFindsPlanted(page: Page): Promise<{ last: () => WireFinding[] }> {
  let last: WireFinding[] = []
  await page.route('**/api/check', async (route: Route) => {
    const response = await route.fetch()
    const body = await response.json()
    const findings = body.result.findings as WireFinding[]
    const planted = findings.filter((f) => PLANTED[f.name])
    const miss = planted.length > 1 ? planted[planted.length - 1].mark : null
    for (const f of findings) {
      const p = PLANTED[f.name]
      if (!p || f.mark === miss) continue
      f.status = p.status
      f.severity = p.severity
      f.offset = p.status === 'misplaced' ? { direction: p.direction!, approx_cm: p.cm! } : { direction: 'none', approx_cm: 0 }
      f.explanation = p.status === 'missing' ? 'Nothing visible where the design shows this element.' : 'It stands to the left of the design position.'
    }
    body.result.model_version = 'gemini-3.8-flash'
    body.result.summary = `${findings.filter((f) => f.severity).length} possible deviations in view.`
    last = findings
    await route.fulfill({ response, json: body })
  })
  return { last: () => last }
}

// ---- layout checks ----------------------------------------------------------------------------------------------

/** Elements that stick out past the right edge of the viewport, and the document's scroll width. */
export async function horizontalOverflow(page: Page): Promise<{ scrollWidth: number; innerWidth: number; offenders: string[] }> {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const clipped = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX
        if (ox !== 'visible') return true
      }
      return false
    }
    const offenders: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || r.right <= vw + 1) continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.position === 'fixed' && r.left >= vw) continue
      if (clipped(el)) continue
      offenders.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''} right=${Math.round(r.right)}`)
    }
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: vw, offenders: offenders.slice(0, 10) }
  })
}

/**
 * Tap targets under `min` CSS px that fail WCAG 2.2 SC 2.5.8 (Target Size, Minimum): links inside a sentence are
 * exempt, and so is an undersized target whose 24 px circle meets no other target.
 */
export async function smallTapTargets(page: Page, min = 24): Promise<string[]> {
  return page.evaluate((min) => {
    const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link]'
    const all = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => {
      const r = el.getBoundingClientRect()
      const st = getComputedStyle(el)
      // checkVisibility(): Chrome lays out a closed <details>'s rows (content-visibility: hidden) where they'd be, but
      // nobody can see or tap them.
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]') && r.bottom > 0 && r.top < window.innerHeight * 4
        && el.checkVisibility()
    })
    const rects = new Map(all.map((el) => [el, el.getBoundingClientRect()]))
    const inSentence = (el: HTMLElement) => {
      if (el.tagName !== 'A') return false
      const parent = el.parentElement
      if (!parent || getComputedStyle(el).display !== 'inline') return false
      return (parent.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 8
    }
    const small = all.filter((el) => { const r = rects.get(el)!; return (r.width < min || r.height < min) && !inSentence(el) })
    const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2]
    const out: string[] = []
    for (const el of small) {
      const [cx, cy] = centre(rects.get(el)!)
      const clash = all.some((other) => {
        if (other === el || other.contains(el) || el.contains(other)) return false
        const o = rects.get(other)!
        if (small.includes(other)) { const [ox, oy] = centre(o); return Math.hypot(cx - ox, cy - oy) < min }
        const dx = Math.max(o.left - cx, 0, cx - o.right)
        const dy = Math.max(o.top - cy, 0, cy - o.bottom)
        return Math.hypot(dx, dy) < min / 2
      })
      if (clash) {
        const r = rects.get(el)!
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
        out.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
    }
    return out
  }, min)
}
