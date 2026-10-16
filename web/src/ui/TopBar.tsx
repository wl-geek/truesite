import { useEffect, useRef, useState } from 'react'
import { navigate, type Route } from '../router'
import { Link } from './Link'
import './topbar.css'

type Item = { label: string; to: string; icon: string; active: (r: Route) => boolean }

const ITEMS: Item[] = [
  { label: 'Virtual site', to: '/samples', icon: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6', active: (r) => r.name === 'samples' },
  { label: '3D model', to: '/model', icon: 'M12 2 21 7v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5', active: (r) => r.name === 'viewer' },
  { label: 'How it works', to: '/#how', icon: 'M4 6h16M4 12h10M4 18h6', active: () => false },
  { label: 'About', to: '/#about', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.01', active: () => false },
]

/** Go to a section of the start page, from any page. */
export function goToSection(id: string): void {
  if (window.location.pathname !== '/') navigate('/')
  let tries = 0
  const go = () => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else if (tries++ < 20) setTimeout(go, 30)
  }
  go()
}

/** The app's top bar: brand, the main places, and one call to action. On phones the places fold into a menu. */
export function TopBar({ route }: { route: Route }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
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

  const links = ITEMS.map((it) => {
    const current = it.active(route)
    const icon = (
      <svg className="tb-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={it.icon} /></svg>
    )
    if (it.to.startsWith('/#')) {
      const id = it.to.slice(2)
      return (
        <a key={it.label} href={it.to} className="tb-link" onClick={(e) => { e.preventDefault(); setOpen(false); goToSection(id) }}>
          {icon}<span>{it.label}</span>
        </a>
      )
    }
    return <Link key={it.label} to={it.to} className="tb-link" current={current}>{icon}<span>{it.label}</span></Link>
  })

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <img src="/favicon.svg" alt="" width="30" height="30" />
        <span className="brand-text">
          <span className="brand-name">TrueSite</span>
          <span className="brand-tag">BIM on site · Gemini as-built check</span>
        </span>
      </Link>
      <nav className="tb-nav" aria-label="Main">{links}</nav>
      <div className="tb-right" ref={menuRef}>
        {route.name !== 'samples' && <Link to="/samples" className="tb-cta">Try it</Link>}
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
