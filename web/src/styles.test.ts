/**
 * Phone layout guards for styles.css and ui/*.css (audit A-17, A-18, A-61, A-62, A-63, B-19, C-07, C-10, C-30,
 * C-33). These read the declarations, not the rendered layout: the PR's manual check measures the real thing at
 * 360-412 px, and the e2e suite (web/e2e) measures it in a browser.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read from disk: vitest turns CSS imports (even ?raw) into empty strings.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = read('./styles.css')
/** The component stylesheets next to their components. */
const UI_CSS = readdirSync(new URL('./ui/', import.meta.url)).filter((f) => f.endsWith('.css')).sort()

type Rule = { selectors: string[]; decls: [string, string][] }

/** Flat list of style rules (rules inside @media blocks included), comments stripped. */
function parseRules(source: string): Rule[] {
  const rules: Rule[] = []
  for (const m of source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':')
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()] as [string, string]
    })
    rules.push({ selectors, decls })
  }
  return rules
}

const RULES = parseRules(css)
/** styles.css, then every ui/*.css: all the app's style rules. */
const ALL = [css, ...UI_CSS.map((f) => read(`./ui/${f}`))].flatMap(parseRules)

/** The value a selector's own rules end up with for one property (last declaration wins), or null. */
function value(selector: string, prop: string, rules: Rule[] = RULES): string | null {
  let v: string | null = null
  for (const r of rules) {
    if (!r.selectors.includes(selector)) continue
    for (const [p, val] of r.decls) if (p === prop) v = val
  }
  return v
}

function px(v: string | null): number {
  const m = v ? /^(\d+(?:\.\d+)?)px$/.exec(v) : null
  return m ? Number(m[1]) : NaN
}

describe('styles.css on phones', () => {
  it('keeps messages in the page flow, and overlays them only on the 3D viewer (A-17)', () => {
    const overlays = RULES.flatMap((r) => r.selectors.filter((s) => /\.status(?![\w-])/.test(s))
      .filter(() => r.decls.some(([p, v]) => p === 'position' && v === 'absolute')))
    expect(overlays).toEqual(['.viewer-stage > .status'])
    expect(value('.status', 'position')).toBeNull()
  })

  it('keeps the live actions in one compact row that wraps on a narrow phone, Check as-built growing (A-18)', () => {
    expect(value('.live-actions', 'flex-wrap')).toBe('wrap')
    expect(value('.live-actions .btn', 'min-width')).toBe('0')
    expect(value('.live-actions .btn', 'min-height')).toBe('44px')
    expect(value('.live-actions .btn-accent', 'flex')).toBe('1 1 160px')
    // The view controls sit above two rows of 44 px buttons (bar at 24 px from the bottom, 8 px gap).
    expect(px(value('.live-controls', 'bottom'))).toBeGreaterThanOrEqual(24 + 44 + 8 + 44)
  })

  it('uses 16 px text in form fields so iOS Safari does not zoom on focus (A-61)', () => {
    for (const s of ['.ask-form input', '.issue-form input', '.issue-form textarea', '.bar-input input']) {
      const rule = RULES.find((r) => r.selectors.includes(s))!
      const props = rule.decls.map(([p]) => p)
      expect(px(value(s, 'font-size')), s).toBeGreaterThanOrEqual(16)
      expect(props.lastIndexOf('font-size'), s).toBeGreaterThan(props.lastIndexOf('font'))
    }
  })

  it('pads panels (A-62)', () => {
    expect(value('.panel', 'padding')).toBe('14px 16px')
  })

  it('makes nav links, icon buttons and chips at least 44 px tall (A-63)', () => {
    const bar = parseRules(readFileSync(new URL('./ui/topbar.css', import.meta.url), 'utf8'))
    const barValue = (sel: string, prop: string) => bar.filter((r) => r.selectors.includes(sel)).flatMap((r) => r.decls).filter(([p]) => p === prop).at(-1)?.[1] ?? null
    expect(px(barValue('.tb-link', 'min-height'))).toBeGreaterThanOrEqual(44)
    expect(px(barValue('.tb-menu-btn', 'height'))).toBeGreaterThanOrEqual(44)
    expect(px(value('.icon-btn', 'width'))).toBeGreaterThanOrEqual(44)
    expect(px(value('.icon-btn', 'height'))).toBeGreaterThanOrEqual(44)
    expect(px(value('.chip', 'min-height'))).toBeGreaterThanOrEqual(44)
  })
})

/** The last compound of a selector: `.issue-form input` -> `input`. */
const lastPart = (selector: string) => selector.split(/[\s>+~]+/).filter(Boolean).at(-1) ?? ''
/** A field iOS Safari zooms into when its text is under 16 px (not sliders, boxes or buttons). */
const isTextField = (selector: string) =>
  /^(input|select|textarea)(?![\w-])/.test(lastPart(selector)) && !/type=['"]?(range|checkbox|radio)/.test(lastPart(selector))
/** How tall a selector's rules make it at least: its min-height or height, whichever is larger. */
const tall = (selector: string) => Math.max(px(value(selector, 'min-height', ALL)) || 0, px(value(selector, 'height', ALL)) || 0)
const ORANGE = /var\(--orange\)|var\(--sev-medium\)|#ff6a13|rgba\(255, 106, 19/i

describe('every stylesheet on phones (styles.css and ui/*.css)', () => {
  it('reads the ui stylesheets too', () => {
    expect(UI_CSS).toEqual(expect.arrayContaining(['deviceTip.css', 'home.css', 'samples.css', 'topbar.css', 'viewerChrome.css', 'virtualSite.css']))
  })

  it('uses 16 px text in every form field that sets its font, so iOS Safari does not zoom (A-61, #54 recheck)', () => {
    const fields = ALL.flatMap((r) => r.selectors.filter(isTextField).map((s) => ({ s, props: r.decls.map(([p]) => p), r })))
      .filter(({ props }) => props.includes('font') || props.includes('font-size'))
    expect(fields.map(({ s }) => s)).toEqual(expect.arrayContaining(['.ask-form input', '.issue-language select', '.walk-distance select']))
    for (const { s, props, r } of fields) {
      expect(px(r.decls.filter(([p]) => p === 'font-size').at(-1)?.[1] ?? null), s).toBeGreaterThanOrEqual(16)
      expect(props.lastIndexOf('font-size'), s).toBeGreaterThan(props.lastIndexOf('font'))
    }
  })

  it('makes the main tap targets at least 44 px tall, the top bar CTA and the truth toggles included (A-63, B-19)', () => {
    const main = ['.tb-link', '.tb-menu-btn', '.tb-cta', '.icon-btn', '.chip', '.btn', '.live-actions .btn', '.hud-exit', '.issue-language select',
      '.vs-btn', '.sample-card-cta', '.home-jump', '.home-details summary', '.sample-truth summary', '.vs-truth summary']
    for (const s of main) expect(tall(s), s).toBeGreaterThanOrEqual(44)
    // Every button or call to action that sets its own height.
    const sized = ALL.flatMap((r) => r.selectors.filter((s) => /-(btn|cta)$/.test(lastPart(s)))
      .filter(() => r.decls.some(([p]) => p === 'height' || p === 'min-height')))
    expect(sized).toEqual(expect.arrayContaining(['.tb-cta', '.tb-menu-btn', '.icon-btn']))
    for (const s of sized) expect(tall(s), s).toBeGreaterThanOrEqual(44)
  })

  it('makes the findings toggles at least 24 px tall (WCAG 2.5.8, C-30)', () => {
    expect(tall('.findings summary')).toBeGreaterThanOrEqual(24)
  })

  it('puts dark text on the brand orange: white on it is 2.86:1 (C-10)', () => {
    const onOrange = ALL.filter((r) => r.decls.some(([p, v]) => (p === 'background' || p === 'background-color') && ORANGE.test(v)))
    expect(onOrange.flatMap((r) => r.selectors)).toEqual(expect.arrayContaining(['.mark-dot', '.mode-chip', '.btn-accent', '.tb-cta']))
    const white = onOrange.filter((r) => r.decls.some(([p, v]) => p === 'color' && /^(var\(--white\)|#fff|#ffffff|white)$/i.test(v)))
    expect(white.flatMap((r) => r.selectors)).toEqual([])
    // Colours set elsewhere: the evidence mark numbers take white from .evidence-box span.
    for (const s of ['.mark-dot', '.mode-chip', '.evidence-box.sev-medium span']) expect(value(s, 'color'), s).toBe('var(--ink)')
  })

  it('lets the live start and calibration panels scroll, and hangs the start panel from the top on a short screen (C-07)', () => {
    for (const s of ['.live-start', '.live-calib']) {
      expect(value(s, 'max-height'), s).toBe('calc(100% - 32px)')
      expect(value(s, 'overflow-y'), s).toBe('auto')
    }
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
    const short = /@media \(max-height: 500px\) \{ \.live-idle \.live-start \{([^}]*)\}/.exec(flat)
    expect(short?.[1]).toMatch(/top: max\(8px, env\(safe-area-inset-top\)\)/)
    expect(short?.[1]).toMatch(/bottom: auto/)
    expect(short?.[1]).toMatch(/transform: none/)
    // After the centring rule for wide screens, which has the same specificity (a phone held sideways is both).
    expect(flat.indexOf('@media (max-height: 500px)')).toBeGreaterThan(flat.indexOf('@media (min-width: 720px) { .live-idle .live-start'))
  })

  it('keeps content that runs to the sides clear of the notch on an iPhone held sideways (C-33)', () => {
    expect(read('../index.html')).toMatch(/viewport-fit=cover/)
    const sides: [string, string[]][] = [
      ...['.home-wrap', '.live-top', '.live-start', '.live-calib', '.live-actions', '.results-sheet', '.vs-top', '.vs-results']
        .map((s): [string, string[]] => [s, ['left', 'right']]),
      ['.model-card', ['left']], // top left, at most 320 px wide
      ['.viewer-check-btn', ['right']], // bottom right
    ]
    for (const [s, edges] of sides) {
      const values = ALL.filter((r) => r.selectors.includes(s)).flatMap((r) => r.decls.map(([, v]) => v)).join(' ')
      for (const edge of edges) expect(values, `${s} ${edge}`).toMatch(new RegExp(`safe-area-inset-${edge}`))
    }
  })
})
