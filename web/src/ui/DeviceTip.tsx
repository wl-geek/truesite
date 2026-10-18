import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { renderSVG } from 'uqr'
import type { Anchor } from '../api/types'
import { Link } from './Link'
import { useModal } from './modal'
import { sheetInfo } from './sheet'
import './deviceTip.css'

type Props = {
  /** This page's address, shown as a QR code so a phone can pick it up. */
  url: string
  /** The sheet this live view is for (null while the project loads, and when the link is broken). */
  anchor: Anchor | null
  /** Where the virtual demo for this sheet is (it runs fine on a computer). */
  virtualHref: string
  /** Leave live AR: back to the start page. The popup has no way into the live view on a computer. */
  onLeave: () => void
}

/**
 * Shown every time live AR is opened on a laptop or PC, and it stays: live AR needs a tablet's or phone's camera and
 * motion sensors, so a computer can't use it. Step 1 hands this page over to a phone by QR; step 2 gives the
 * matching sheet to print and scan. "Back to home" (or Escape) leaves for the start page; nothing opens the live view.
 * It waits for the sheet to load, so it never covers a broken link and hands that to a phone (audit C-29), and it
 * renders on <body>, above the top bar, as a modal that keeps focus (C-28).
 */
export function DeviceTip({ url, anchor, virtualHref, onLeave }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const primary = useRef<HTMLButtonElement | HTMLAnchorElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const qr = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(url, { border: 2 }))}`, [url])
  useModal(dialog, anchor !== null, onLeave)
  useEffect(() => {
    primary.current?.focus()
  }, [step])
  if (!anchor) return null
  const sheet = sheetInfo(anchor)
  const layoutPlan = anchor.project_id === 'site' && !sheet.flat
  return createPortal(
    <div className="dt-backdrop">
      <div className="dt" role="dialog" aria-modal="true" aria-labelledby="dt-title" ref={dialog}>
        <p className="dt-step" aria-live="polite">Step {step} of 2</p>
        {step === 1 ? (
          <>
            <h2 id="dt-title">Open live AR on your smartphone</h2>
            <p>Live AR needs a phone's camera and motion sensors, so it doesn't run on a laptop or PC. Use your smartphone for
              the best experience; a tablet works too.</p>
            <div className="dt-handoff">
              <img src={qr} width="132" height="132" alt="QR code for this live view" />
              <p><strong>Scan this code with your smartphone.</strong> This live view opens there.</p>
            </div>
            <div className="dt-actions">
              <button type="button" className="btn btn-accent" ref={primary as RefObject<HTMLButtonElement>} onClick={() => setStep(2)}>
                Next: get the sheet
              </button>
              <button type="button" className="btn" onClick={onLeave}>Back to home</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="dt-title">Print the sheet and scan its code</h2>
            <div className="dt-sheet">
              <span className="dt-sheet-name">
                <strong>Sheet {anchor.anchor_id}</strong>
                <span>{[sheet.paper, sheet.flat ? 'lies flat' : 'upright'].filter(Boolean).join(' · ')} · PDF</span>
              </span>
              <a className="btn btn-accent" href={sheet.href} download ref={primary as RefObject<HTMLAnchorElement>}>
                Download sheet {anchor.anchor_id}
              </a>
            </div>
            <ol className="dt-list">
              <li>{sheet.print}</li>
              <li>{sheet.place}</li>
              <li>On your phone, tap <strong>Start camera</strong> and point it at the code.</li>
            </ol>
            {layoutPlan && (
              <p className="dt-note">Setting out all four site sheets: <a href="/sheets/site-layout.pdf" download>download the layout plan</a>.</p>
            )}
            <div className="dt-actions">
              <button type="button" className="btn" onClick={() => setStep(1)}>Back to the QR code</button>
              <button type="button" className="btn" onClick={onLeave}>Back to home</button>
            </div>
          </>
        )}
        <p className="dt-note dt-virtual">
          Without a phone or a printer, the virtual demo runs on this computer. <Link to={virtualHref}>Try the virtual demo</Link>
        </p>
      </div>
    </div>,
    document.body,
  )
}
