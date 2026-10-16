import { useEffect, useMemo, useRef } from 'react'
import { renderSVG } from 'uqr'
import { Link } from './Link'
import './deviceTip.css'

type Props = {
  /** This page's address, shown as a QR code so a tablet or phone can pick it up. */
  url: string
  /** Where the virtual demo for this sheet is (it runs fine on a computer). */
  virtualHref: string
  onClose: () => void
}

/** Shown when live AR is opened on a laptop or PC: live AR is made for tablets and smartphones. */
export function DeviceTip({ url, virtualHref, onClose }: Props) {
  const primary = useRef<HTMLAnchorElement>(null)
  const qr = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(url, { border: 2 }))}`, [url])
  useEffect(() => {
    primary.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dt-backdrop" onClick={onClose}>
      <div className="dt" role="dialog" aria-modal="true" aria-labelledby="dt-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="dt-title">Live AR is made for tablets and smartphones</h2>
        <p>For the best experience, use a tablet. A smartphone works well too.</p>
        <div className="dt-handoff">
          <img src={qr} width="132" height="132" alt="QR code for this page" />
          <p><strong>Scan with your tablet or phone</strong> to open this page there, then point it at the printed sheet.</p>
        </div>
        <p className="dt-note">On this computer, the virtual demo works fine.</p>
        <div className="dt-actions">
          <Link to={virtualHref} className="btn btn-accent" ref={primary}>Try the virtual demo</Link>
          <button type="button" className="btn" onClick={onClose}>Continue on this computer</button>
        </div>
      </div>
    </div>
  )
}
