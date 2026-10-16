/**
 * Phone layout guards for styles.css (audit A-17, A-18, A-61, A-62, A-63). These read the declarations,
 * not the rendered layout: the PR's manual check measures the real thing at 360-412 px.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read from disk: vitest turns CSS imports (even ?raw) into empty strings.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

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

/** The value a selector's own rules end up with for one property (last declaration wins), or null. */
function value(selector: string, prop: string): string | null {
  let v: string | null = null
  for (const r of RULES) {
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

  it('wraps the live action bar and gives Check as-built its own row (A-18)', () => {
    expect(value('.live-actions', 'flex-wrap')).toBe('wrap')
    expect(value('.live-actions .btn', 'min-width')).toBe('0')
    expect(value('.live-actions .btn-accent', 'flex-basis')).toBe('100%')
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
