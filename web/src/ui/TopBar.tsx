import { useEffect, useRef, useState } from 'react'
import { navigate, type Route } from '../router'
import './topbar.css'

/** The start page is one page: every nav link is a section of it. The tools (virtual site, 3D model, live AR) open from buttons in those sections. */
export const SECTIONS = [
  { id: 'how', label: 'How it works', icon: 'M4 6h16M4 12h10M4 18h6' },
  { id: 'try', label: 'Virtual site', icon: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6' },
  { id: 'on-site', label: 'Live AR', icon: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 9h6v6H9z' },
  { id: 'about', label: 'About', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.01' },
] as const
type SectionId = (typeof SECTIONS)[number]['id'] | 'top'

/**
 * Scroll to a section of the start page, from any page (the tools navigate back to it first). The address shows
 * the section (/#about) so it can be shared, without adding a history entry for each tap.
 */
export function goToSection(id: SectionId): void {
  if (window.location.pathname !== '/') navigate('/')
  window.history.replaceState(null, '', id === 'top' ? '/' : `/#${id}`)
  // Smooth unless the reader asked for less motion (or the page isn't on screen, where it wouldn't move at all).
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible'
    ? 'auto' : 'smooth'
  let tries = 0
  const go = () => {
    if (id === 'top') return window.scrollTo({ top: 0, behavior })
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior, block: 'start' })
    else if (tries++ < 20) setTimeout(go, 30)
  }
  go()
}

/** Which start-page section is under the middle of the screen (for the nav's current marker). */
function useCurrentSection(enabled: boolean): SectionId | null {
  const [current, setCurrent] = useState<SectionId | null>(null)
  useEffect(() => {
    if (!enabled) return setCurrent(null)
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => e !== null)
    if (!els.length) return
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).map((e) => e.target.id as SectionId)
      if (hit.length) setCurrent(hit[hit.length - 1])
      else if (window.scrollY < 200) setCurrent(null)
    }, { rootMargin: '-45% 0px -50% 0px' })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [enabled])
  return current
}

/** The app's top bar: brand, the start page's sections, and one call to action. On phones the sections fold into a menu. */
export function TopBar({ route }: { route: Route }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = useCurrentSection(route.name === 'home')
  useEffect(() => setOpen(false), [route])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  const go = (id: SectionId) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // let new-tab clicks through
    e.preventDefault()
    setOpen(false)
    goToSection(id)
  }
  const links = SECTIONS.map((s) => (
    <a key={s.id} href={`/#${s.id}`} className="tb-link" aria-current={current === s.id ? 'location' : undefined} onClick={go(s.id)}>
      <svg className="tb-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={s.icon} /></svg>
      <span>{s.label}</span>
    </a>
  ))

  return (
    <header className="topbar">
      <a href="/" className="brand" onClick={go('top')}>
        <img src="/favicon.svg" alt="" width="30" height="30" />
        <span className="brand-text">
          <span className="brand-name">TrueSite</span>
          <span className="brand-tag">BIM on site · Gemini as-built check</span>
        </span>
      </a>
      <nav className="tb-nav" aria-label="Sections">{links}</nav>
      <div className="tb-right" ref={menuRef}>
        <a href="/#try" className="tb-cta" onClick={go('try')}>Try it</a>
        <button type="button" className="tb-menu-btn" aria-expanded={open} aria-controls="tb-menu" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        {open && <nav id="tb-menu" className="tb-menu" aria-label="Sections">{links}</nav>}
      </div>
    </header>
  )
}
