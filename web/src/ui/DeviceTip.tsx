import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { renderSVG } from 'uqr'
import type { Anchor } from '../api/types'
import { Link } from './Link'
import { sheetInfo } from './sheet'
import './deviceTip.css'

type Props = {
  /** This page's address, shown as a QR code so a tablet or phone can pick it up. */
  url: string
  /** The sheet this live view is for (null while the project loads). */
  anchor: Anchor | null
  /** Where the virtual demo for this sheet is (it runs fine on a computer). */
  virtualHref: string
  onClose: () => void
}

/**
 * Shown when live AR is opened on a laptop or PC: live AR is made for tablets and smartphones.
 * Step 1 hands this page over to a tablet or phone by QR; step 2 gives the matching sheet to print and scan.
 */
export function DeviceTip({ url, anchor, virtualHref, onClose }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const primary = useRef<HTMLButtonElement | HTMLAnchorElement>(null)
  const qr = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(url, { border: 2 }))}`, [url])
  const sheet = anchor ? sheetInfo(anchor) : null
  const layoutPlan = anchor?.project_id === 'site' && !sheet?.flat
  useEffect(() => {
    primary.current?.focus()
  }, [step])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dt-backdrop" onClick={onClose}>
      <div className="dt" role="dialog" aria-modal="true" aria-labelledby="dt-title" onClick={(e) => e.stopPropagation()}>
        <p className="dt-step" aria-live="polite">Step {step} of 2</p>
        {step === 1 ? (
          <>
            <h2 id="dt-title">Open live AR on your tablet or phone</h2>
            <p>Live AR runs on the device's camera. A tablet gives the best view; a phone works well too.</p>
            <div className="dt-handoff">
              <img src={qr} width="132" height="132" alt="QR code for this live view" />
              <p><strong>Scan this code with your tablet or phone.</strong> This live view opens there.</p>
            </div>
            <div className="dt-actions">
              <button type="button" className="btn btn-accent" ref={primary as RefObject<HTMLButtonElement>} onClick={() => setStep(2)}>
                Next: get the sheet
              </button>
              <button type="button" className="btn" onClick={onClose}>Continue on this computer</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="dt-title">Print the sheet and scan its code</h2>
            <div className="dt-sheet">
              <span className="dt-sheet-name">
                <strong>Sheet {anchor?.anchor_id ?? ''}</strong>
                {sheet && <span>{[sheet.paper, sheet.flat ? 'lies flat' : 'upright'].filter(Boolean).join(' · ')} · PDF</span>}
              </span>
              {sheet ? (
                <a className="btn btn-accent" href={sheet.href} download ref={primary as RefObject<HTMLAnchorElement>}>
                  Download sheet {anchor?.anchor_id}
                </a>
              ) : <span className="dt-note">Loading the sheet…</span>}
            </div>
            {sheet && (
              <ol className="dt-list">
                <li>{sheet.print}</li>
                <li>{sheet.place}</li>
                <li>On the tablet or phone, tap <strong>Start camera</strong> and point it at the code.</li>
              </ol>
            )}
            {layoutPlan && (
              <p className="dt-note">Setting out all four site sheets: <a href="/sheets/site-layout.pdf" download>download the layout plan</a>.</p>
            )}
            <div className="dt-actions">
              <button type="button" className="btn" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="btn" onClick={onClose}>Done</button>
            </div>
          </>
        )}
        <p className="dt-note dt-virtual">
          Without a tablet or a printer, the virtual demo runs on this computer. <Link to={virtualHref}>Try the virtual demo</Link>
        </p>
      </div>
    </div>
  )
}
