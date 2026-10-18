import { useEffect, useRef, useState } from 'react'
import { navigate, type Route } from '../router'
import './topbar.css'

/** The start page is one page: these nav links are its sections. The 3D model viewer has its own page and nav link (MODEL_LINK). */
export const SECTIONS = [
  { id: 'how', label: 'How it works', icon: 'M4 6h16M4 12h10M4 18h6' },
  { id: 'live', label: 'Live AR', icon: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 9h6v6H9z' },
  { id: 'virtual', label: 'Virtual demo', icon: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6' },
  { id: 'about', label: 'About', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.01' },
] as const
/** `demo`: the demo video on the start page, linked from the hero but not listed in the nav. */
type SectionId = (typeof SECTIONS)[number]['id'] | 'top' | 'demo'
/** The 3D model viewer, part of the product: a page of its own, listed in the nav after Live AR. */
export const MODEL_LINK = { path: '/model', label: '3D model', icon: 'M12 3 20 7.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5' }

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

/**
 * Which start-page section the reader is in (for the nav's current marker): the last one whose top has passed a
 * line a quarter of the way down the screen, or the last section once the page is scrolled to the bottom.
 */
function useCurrentSection(enabled: boolean): SectionId | null {
  const [current, setCurrent] = useState<SectionId | null>(null)
  useEffect(() => {
    if (!enabled) return setCurrent(null)
    let raf = 0
    const measure = () => {
      raf = 0
      const line = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + window.innerHeight * 0.25
      let cur: SectionId | null = null
      for (const sec of SECTIONS) {
        const el = document.getElementById(sec.id)
        if (el && el.getBoundingClientRect().top <= line) cur = sec.id
      }
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4
      setCurrent(atBottom && window.scrollY > 0 ? SECTIONS[SECTIONS.length - 1].id : cur)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [enabled])
  return current
}

/** How far down the page the reader is (0..1), written to the bar as --tb-progress without re-rendering. */
function useScrollProgress(bar: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      bar.current?.style.setProperty('--tb-progress', p.toFixed(4))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [bar])
}

/** The app's top bar: brand, the start page's sections and the 3D model, and one call to action. On phones the links fold into a menu. */
export function TopBar({ route }: { route: Route }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLElement>(null)
  useScrollProgress(barRef)
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
  const openModel = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // let new-tab clicks through
    e.preventDefault()
    setOpen(false)
    if (route.name !== 'viewer') { navigate(MODEL_LINK.path); window.scrollTo(0, 0) }
  }
  const icon = (d: string) => (
    <svg className="tb-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  )
  const links = SECTIONS.flatMap((s) => {
    const link = (
      <a key={s.id} href={`/#${s.id}`} className="tb-link" aria-current={current === s.id ? 'location' : undefined} onClick={go(s.id)}>
        {icon(s.icon)}<span>{s.label}</span>
      </a>
    )
    return s.id !== 'live' ? [link] : [link, (
      <a key="model" href={MODEL_LINK.path} className="tb-link" aria-current={route.name === 'viewer' ? 'page' : undefined} onClick={openModel}>
        {icon(MODEL_LINK.icon)}<span>{MODEL_LINK.label}</span>
      </a>
    )]
  })

  return (
    <header className="topbar" ref={barRef}>
      <a href="/" className="brand" onClick={go('top')}>
        <img src="/favicon.svg" alt="" width="30" height="30" />
        <span className="brand-text">
          <span className="brand-name">TrueSite</span>
          <span className="brand-tag">Live BIM on site</span>
        </span>
      </a>
      <nav className="tb-nav" aria-label="Main">{links}</nav>
      <div className="tb-right" ref={menuRef}>
        <a href="/#live" className="tb-cta" onClick={go('live')}>Start live AR</a>
        <button type="button" className="tb-menu-btn" aria-expanded={open} aria-controls="tb-menu" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        {open && <nav id="tb-menu" className="tb-menu" aria-label="Main">{links}</nav>}
      </div>
    </header>
  )
}
