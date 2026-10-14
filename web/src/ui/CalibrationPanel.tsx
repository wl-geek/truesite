import { useEffect, useRef, useState } from 'react'
import { loadIntrinsics, loadQrSizeCorrection, saveIntrinsics, saveQrSizeCorrection } from '../camera/intrinsics'
import { scaleFactorFromBar, TARGET_VIEWS, ViewCollector } from '../calib/collect'
import type { Overlay } from '../scene/overlay'

export type CalibrationPanelProps = { overlay: Overlay; anchorId: string; qrSizeM: number; onClose: () => void }

type Step = 'intro' | 'collecting' | 'done' | 'failed' | 'bar'

/**
 * First-use camera calibration (spec 7.2) and the print-scale check (spec 4.2 step 2).
 * Calibration is optional: without it the app uses a default 63 degree field of view.
 */
export function CalibrationPanel({ overlay, anchorId, qrSizeM, onClose }: CalibrationPanelProps) {
  const [step, setStep] = useState<Step>('intro')
  const [count, setCount] = useState(0)
  const [result, setResult] = useState<string | null>(null)
  const [barMm, setBarMm] = useState(String(Math.round(loadQrSizeCorrection(anchorId) * 100)))
  const [barError, setBarError] = useState<string | null>(null)
  const collector = useRef<ViewCollector | null>(null)

  useEffect(() => {
    if (step !== 'collecting') return
    const off = overlay.onCorners((corners, w, h) => {
      if (!collector.current || collector.current.width !== w || collector.current.height !== h) {
        collector.current = new ViewCollector(qrSizeM, w, h)
      }
      const c = collector.current
      if (c.offer(corners) === 'accepted') setCount(c.views.length)
      if (c.done) {
        off()
        const res = c.solve()
        if (res) {
          saveIntrinsics(w, h, res.f)
          overlay.setIntrinsics(loadIntrinsics(w, h))
          setResult(`Calibrated: focal length ${Math.round(res.f)} px (fit ${res.rmsPx.toFixed(1)} px).`)
          setStep('done')
        } else {
          setStep('failed')
        }
      }
    })
    return off
  }, [step, overlay, qrSizeM])

  function saveBar() {
    try {
      const factor = scaleFactorFromBar(Number(barMm))
      saveQrSizeCorrection(anchorId, factor)
      overlay.setQrSizeCorrection(factor)
      onClose()
    } catch (e) {
      setBarError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="panel calib-panel" aria-label="Camera setup">
      {step === 'intro' && (
        <>
          <h2>Calibrate this camera (10 s)</h2>
          <p>Keep the code in view and slowly tilt the phone around it, left, right, up and down. This makes the overlay more accurate on your phone.</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setStep('bar')}>Skip</button>
            <button type="button" className="btn btn-primary" onClick={() => { collector.current = null; setCount(0); setStep('collecting') }}>Start</button>
          </div>
        </>
      )}
      {step === 'collecting' && (
        <>
          <h2>Tilt slowly around the code…</h2>
          <progress max={TARGET_VIEWS} value={count} />
          <p className="note">{count} / {TARGET_VIEWS} views. Head-on views don't count: tilt more.</p>
          <button type="button" className="btn" onClick={() => setStep('bar')}>Skip</button>
        </>
      )}
      {(step === 'done' || step === 'failed') && (
        <>
          <p>{step === 'done' ? result : "Calibration didn't converge. The default field of view is still in use; try again in better light."}</p>
          <button type="button" className="btn btn-primary" onClick={() => setStep('bar')}>Next: check the print</button>
        </>
      )}
      {step === 'bar' && (
        <>
          <h2>Check the print scale</h2>
          <p>Measure the 10 cm bar on the printed sheet. Printers often shrink pages.</p>
          <label className="bar-input">Measured length <input type="number" inputMode="decimal" min={80} max={120} step={0.5} value={barMm} onChange={(e) => setBarMm(e.target.value)} /> mm</label>
          {barError && <p className="status status-error" role="alert">{barError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Skip</button>
            <button type="button" className="btn btn-primary" onClick={saveBar}>Save</button>
          </div>
        </>
      )}
    </section>
  )
}
