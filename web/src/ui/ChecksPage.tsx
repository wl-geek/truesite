import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, fetchRunImage, getProject, getRun, listRuns, reviewFinding } from '../api/client'
import type { Box, Element, Finding, PoseQuality, ReviewDecision, RunDetail, RunSummary, UnexpectedItem } from '../api/types'
import { isFlagged, reviewFirst } from '../check/reviewOrder'
import { whyItMatters } from '../check/risk'
import { checksPathFor, navigate } from '../router'
import {
  costAndTime, cropFor, decisionLine, exactTime, modelLabel, needsReview, OFFLINE_MODEL, reviewErrorMessage, reviewState, seconds,
  shortHash, sourceLabel, tokensText, totals, usd, viewpointLabel, type Totals,
} from './checksFormat'
import { ConfidenceBadge } from './ConfidenceBadge'
import { typeLabel } from './elementFacts'
import { EvidenceView } from './EvidenceView'
import { imageQualityMessage, NOT_A_SURVEY, statusText } from './findingFormat'
import { IssueDialog } from './IssueDialog'
import { savedWhen, useSavedIssues } from './issueList'
import { Link } from './Link'
import { useMedia } from './useMedia'
import './checks.css'

/** From this width the list is a table; below, cards. */
const TABLE = '(min-width: 860px)'
const EMPTY_PATH = '/samples?at=P1'

type Filter = 'all' | 'review'
/** The list's filter, kept while the reader opens a check and comes back. */
let rememberedFilter: Filter = 'all'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The Checks page: every as-built check from this browser, newest first, to review in one place (/checks), and one
 * check in full (/checks?run=<id>): what Gemini found and where, how sure it was, how severe, what to do next, and an
 * audit trail. Model text is shown as plain text only.
 */
export function ChecksPage({ runId }: { runId?: string }) {
  useEffect(() => window.scrollTo(0, 0), [runId])
  return (
    <main className="page checks-page">
      {runId ? <CheckDetail key={runId} runId={runId} /> : <CheckList />}
    </main>
  )
}

// ---- the list ------------------------------------------------------------------------------------------------------

function useRuns(): { runs: RunSummary[] | null; error: boolean; reload: () => void } {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState(false)
  const alive = useRef(true)
  const reload = useCallback(() => {
    listRuns()
      .then((list) => { if (alive.current) { setRuns(list.runs); setError(false) } })
      .catch(() => { if (alive.current) setError(true) })
  }, [])
  useEffect(() => {
    alive.current = true
    reload()
    // Back from the virtual demo in another tab: show the checks run there since.
    const onShow = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onShow)
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [reload])
  return { runs, error, reload }
}

function CheckList() {
  const { runs, error, reload } = useRuns()
  const [filter, setFilterState] = useState<Filter>(rememberedFilter)
  const table = useMedia(TABLE)
  const setFilter = (f: Filter) => { rememberedFilter = f; setFilterState(f) }
  const sum = useMemo(() => totals(runs ?? []), [runs])
  const shown = (runs ?? []).filter((r) => filter === 'all' || needsReview(r))
  const offline = (runs ?? []).some((r) => r.model_version === OFFLINE_MODEL)

  return (
    <>
      <header className="checks-head">
        <p className="eyebrow">As-built checks</p>
        <h1>Checks</h1>
        <p className="checks-lede">Every check from this browser, newest first. Confirm what Gemini flagged, or dismiss it as a false alarm.</p>
      </header>
      {runs === null && !error && <p className="checks-status" role="status">Loading your checks…</p>}
      {error && (
        <div className="checks-problem" role="alert">
          <p>Couldn't load your checks. Check the connection and try again.</p>
          <button type="button" className="btn" onClick={reload}>Load the checks again</button>
        </div>
      )}
      {runs !== null && runs.length === 0 && (
        <div className="checks-empty">
          <h2>No checks yet.</h2>
          <p>Each Check as-built you run in the virtual demo or in live AR lands here, ready to review.</p>
          <Link to={EMPTY_PATH} className="btn btn-accent">Run a check in the virtual demo</Link>
        </div>
      )}
      {runs !== null && runs.length > 0 && (
        <>
          <Tiles sum={sum} />
          {offline && <OfflineNote list />}
          <div className="checks-toolbar">
            <div className="seg" role="group" aria-label="Show">
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                All checks <span className="seg-count">{runs.length}</span>
              </button>
              <button type="button" aria-pressed={filter === 'review'} onClick={() => setFilter('review')}>
                Needs review <span className="seg-count">{sum.checksToReview}</span>
              </button>
            </div>
            <p className="checks-muted checks-label">{NOT_A_SURVEY}</p>
          </div>
          {shown.length === 0
            ? <p className="checks-none">No checks need review: every flagged finding has a decision.</p>
            : table ? <RunTable runs={shown} /> : <RunCards runs={shown} />}
          <p className="note checks-foot">Checks are kept for 30 days and show only in the browser that ran them.</p>
        </>
      )}
    </>
  )
}

export function Tiles({ sum }: { sum: Totals }) {
  return (
    <dl className="checks-tiles">
      <div className="tile">
        <dt>Checks run</dt>
        <dd className="tile-num">{sum.checks}</dd>
        <dd className="tile-note">from this browser</dd>
      </div>
      <div className={`tile${sum.toReview ? ' tile-todo' : ''}`}>
        <dt>Findings to review</dt>
        <dd className="tile-num">{sum.toReview}</dd>
        <dd className="tile-note">{sum.checksToReview ? `in ${sum.checksToReview} check${sum.checksToReview === 1 ? '' : 's'}` : 'nothing waiting'}</dd>
      </div>
      <div className={`tile${sum.highOpen ? ' tile-high' : ''}`}>
        <dt>High severity</dt>
        <dd className="tile-num">{sum.highOpen}</dd>
        <dd className="tile-note">structure and guardrails, false alarms left out</dd>
      </div>
      <div className="tile">
        <dt>Reviewed</dt>
        <dd className="tile-num">{sum.reviewed}</dd>
        <dd className="tile-note">{sum.confirmed} confirmed · {sum.dismissed} dismissed</dd>
      </div>
    </dl>
  )
}

function OfflineNote({ list = false }: { list?: boolean }) {
  return (
    <p className="checks-offline" role="note">
      <strong>Offline test mode.</strong>{' '}
      {list
        ? 'Checks marked "offline stand-in" were not judged by Gemini: this server runs the stand-in. The deployed app runs the real check with Gemini.'
        : 'This check was not judged by Gemini: this server runs the offline stand-in. The deployed app runs the real check with Gemini.'}
    </p>
  )
}

function SeverityChips({ run }: { run: RunSummary }) {
  const sev = (['high', 'medium', 'low'] as const).filter((k) => run.by_severity[k] > 0)
  const unsure = run.by_status.cannot_judge
  return (
    <span className="checks-chips">
      {sev.map((k) => <span key={k} className={`badge badge-${k}`}>{run.by_severity[k]} {k}</span>)}
      {unsure > 0 && <span className="badge badge-unsure">{unsure} can't judge</span>}
      {run.unexpected > 0 && <span className="badge badge-unexpected">{run.unexpected} not in design</span>}
      {sev.length === 0 && unsure === 0 && run.unexpected === 0 && <span className="checks-muted">All match the design</span>}
      {run.image_quality && run.image_quality !== 'good' && <span className="badge badge-retake">Retake the photo</span>}
    </span>
  )
}

function ReviewPill({ run }: { run: Pick<RunSummary, 'needs_review' | 'reviewed'> }) {
  const st = reviewState(run)
  return <span className={`review-pill review-${st.kind}`}>{st.kind === 'done' && <span aria-hidden="true">✓ </span>}{st.text}</span>
}

function sourceLine(run: RunSummary): string {
  return run.model_version === OFFLINE_MODEL ? `${sourceLabel(run.source)} · offline stand-in` : sourceLabel(run.source)
}

function openRun(runId: string): void {
  navigate(checksPathFor(runId))
}

export function RunTable({ runs }: { runs: readonly RunSummary[] }) {
  return (
    <div className="checks-table-wrap">
      <table className="checks-table">
        <caption className="checks-sr">Checks from this browser, newest first</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Viewpoint</th>
            <th scope="col">Findings by severity</th>
            <th scope="col">Lowest confidence</th>
            <th scope="col">Review</th>
            <th scope="col" className="num">Cost · time</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const where = viewpointLabel(run.project_id, run.anchor_id)
            const when = savedWhen(run.created_at)
            return (
              // The link in the row is the keyboard way in; a tap anywhere on the row opens it too.
              <tr key={run.run_id} className={`checks-row${needsReview(run) ? ' checks-row-todo' : ''}`}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) openRun(run.run_id) }}>
                <td className="checks-when"><time dateTime={run.created_at} title={exactTime(run.created_at)}>{when}</time></td>
                <td>
                  <Link to={checksPathFor(run.run_id)} className="checks-open" aria-label={`Open the check at ${where}, ${when}`}>{where}</Link>
                  <span className="checks-sub">{sourceLine(run)}</span>
                </td>
                <td><SeverityChips run={run} /></td>
                <td>{run.lowest_confidence === null ? <span className="checks-muted">—</span>
                  : <ConfidenceBadge value={run.lowest_confidence} label={false} hint={false} />}</td>
                <td><ReviewPill run={run} /></td>
                <td className="num checks-muted">{costAndTime(run)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function RunCards({ runs }: { runs: readonly RunSummary[] }) {
  return (
    <ul className="checks-cards" aria-label="Checks from this browser, newest first">
      {runs.map((run) => (
        <li key={run.run_id}>
          <Link to={checksPathFor(run.run_id)} className={`checks-card${needsReview(run) ? ' checks-card-todo' : ''}`}>
            <span className="checks-card-top">
              <strong>{viewpointLabel(run.project_id, run.anchor_id)}</strong>
              <ReviewPill run={run} />
            </span>
            <span className="checks-sub">
              {sourceLine(run)} · <time dateTime={run.created_at} title={exactTime(run.created_at)}>{savedWhen(run.created_at)}</time>
            </span>
            <SeverityChips run={run} />
            <span className="checks-card-foot">
              {run.lowest_confidence !== null && (
                <span className="checks-card-conf">Lowest <ConfidenceBadge value={run.lowest_confidence} label={false} hint={false} /></span>
              )}
              <span className="checks-muted">{costAndTime(run)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

// ---- one check -----------------------------------------------------------------------------------------------------

type Images = { photo?: string | null; render?: string | null; overlay?: string | null }
type ImageName = 'photo.jpg' | 'render.png' | 'overlay.jpg'
const IMAGE_KEY: Record<ImageName, keyof Images> = { 'photo.jpg': 'photo', 'render.png': 'render', 'overlay.jpg': 'overlay' }

const POSE: Record<PoseQuality, string> = { good: 'Good', fair: 'Fair', poor: 'Poor: treat these results with care' }

/** A run's three images as object URLs (null when one couldn't load), revoked when the page goes. */
function useRunImages(runId: string | null, hasOverlay: boolean): { images: Images; aspect: number | null } {
  const [images, setImages] = useState<Images>({})
  const [aspect, setAspect] = useState<number | null>(null)
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    const urls: string[] = []
    const names: ImageName[] = ['photo.jpg', 'render.png', ...(hasOverlay ? ['overlay.jpg' as const] : [])]
    for (const name of names) {
      fetchRunImage(runId, name).then((url) => {
        if (cancelled) return URL.revokeObjectURL(url)
        urls.push(url)
        setImages((i) => ({ ...i, [IMAGE_KEY[name]]: url }))
        if (name === 'photo.jpg') {
          const img = new Image()
          img.onload = () => { if (!cancelled && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight) }
          img.src = url
        }
      }).catch(() => { if (!cancelled) setImages((i) => ({ ...i, [IMAGE_KEY[name]]: null })) })
    }
    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [runId, hasOverlay])
  return { images, aspect }
}

function CheckDetail({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunDetail | null>(null)
  const [failed, setFailed] = useState<'not_found' | 'failed' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [elements, setElements] = useState<ReadonlyMap<string, Element>>(new Map())
  const [selected, setSelected] = useState<number | null>(null)
  const [compare, setCompare] = useState<'render' | 'overlay'>('render')
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<number, string>>>({})
  const [draftFor, setDraftFor] = useState<Finding | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFailed(null)
    getRun(runId)
      .then((r) => { if (!cancelled) setRun(r) })
      .catch((e) => { if (!cancelled) setFailed(e instanceof ApiError && e.status === 404 ? 'not_found' : 'failed') })
    return () => { cancelled = true }
  }, [runId, attempt])

  const projectId = run?.project_id ?? null
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    getProject(projectId)
      .then((p) => { if (!cancelled) setElements(new Map(p.elements.map((e) => [e.guid, e]))) })
      .catch(() => undefined) // names and classes still come from the finding; drafts fall back to the finding alone
    return () => { cancelled = true }
  }, [projectId])

  const { images, aspect } = useRunImages(run?.run_id ?? null, !!run?.images.overlay)
  const { issues, add: addIssue } = useSavedIssues(projectId)

  const findings = useMemo(() => reviewFirst(run?.result.findings ?? []), [run])
  const dismissed = useMemo(() => new Set(Object.entries(run?.review ?? {}).filter(([, r]) => r.decision === 'dismissed').map(([m]) => Number(m))), [run])

  if (failed === 'not_found') {
    return (
      <div className="checks-empty">
        <h1>Check not found</h1>
        <p>This check isn't in this browser's list. Checks show only in the browser that ran them, for 30 days.</p>
        <Link to="/checks" className="btn btn-primary">See all checks</Link>
      </div>
    )
  }
  if (failed === 'failed') {
    return (
      <div className="checks-problem" role="alert">
        <p>Couldn't load this check. Check the connection and try again.</p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Load the check again</button>
      </div>
    )
  }
  if (!run) return <p className="checks-status" role="status">Loading the check…</p>

  const result = run.result
  const offline = result.model_version === OFFLINE_MODEL
  const quality = imageQualityMessage(result.image_quality)
  const flagged = findings.filter(isFlagged)
  const unsure = findings.filter((f) => f.status === 'cannot_judge')
  const ok = findings.filter((f) => f.status === 'present_ok')
  const toReview = flagged.filter((f) => !run.review[String(f.mark)]).length
  const reviewed = flagged.length - toReview
  const where = viewpointLabel(run.project_id, run.anchor_id)
  const savedMarks = new Set(issues.filter((i) => i.run_id === run.run_id || i.finding_ref?.startsWith(`${run.run_id}:`))
    .map((i) => Number(i.finding_ref?.split(':')[1] ?? NaN)))

  const select = (mark: number, scroll: boolean) => {
    setSelected((m) => (m === mark && !scroll ? null : mark))
    if (scroll) document.getElementById(`finding-${mark}`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  async function decide(f: Finding, decision: ReviewDecision | null): Promise<void> {
    setPending((p) => new Set(p).add(f.mark))
    setErrors(({ [f.mark]: _, ...rest }) => rest)
    try {
      const out = await reviewFinding(runId, f.mark, decision)
      setRun((r) => {
        if (!r) return r
        const review = { ...r.review }
        if (out.decision && out.at) review[String(f.mark)] = { decision: out.decision, at: out.at }
        else delete review[String(f.mark)]
        return { ...r, review }
      })
    } catch (e) {
      setErrors((m) => ({ ...m, [f.mark]: reviewErrorMessage(e instanceof ApiError ? e : new ApiError(String(e), 0)) }))
    } finally {
      setPending((p) => { const next = new Set(p); next.delete(f.mark); return next })
    }
  }

  const cardProps = (f: Finding) => ({
    f, runId: run.run_id, element: elements.get(f.guid) ?? null, photoUrl: images.photo ?? null, aspect,
    selected: selected === f.mark, onSelect: () => select(f.mark, false),
    review: run.review[String(f.mark)] ?? null, busy: pending.has(f.mark), error: errors[f.mark] ?? null,
    onDecide: (d: ReviewDecision | null) => void decide(f, d),
    onDraft: quality === null ? () => setDraftFor(f) : undefined, issueSaved: savedMarks.has(f.mark),
  })

  return (
    <>
      <nav className="checks-back" aria-label="Checks">
        <Link to="/checks" className="checks-back-link"><span aria-hidden="true">←</span> Back to all checks</Link>
      </nav>
      <header className="checks-detail-head">
        <div>
          <p className="eyebrow">{sourceLabel(run.source)} · {savedWhen(run.created_at)}</p>
          <h1>{where}</h1>
          <p className="checks-sub"><time dateTime={run.created_at}>{exactTime(run.created_at)}</time> · {modelLabel(result.model_version)}</p>
        </div>
        <div className="checks-detail-state">
          <ReviewPill run={{ needs_review: toReview, reviewed }} />
          <span className="checks-muted">{flagged.length} flagged · {unsure.length} can't judge · {ok.length} match</span>
        </div>
      </header>
      {offline && <OfflineNote />}
      <p className="checks-label-row"><span className="checks-label-chip">{NOT_A_SURVEY}</span></p>
      {quality && <p className="warn" role="alert">{quality} Its findings are shown greyed, and issues can't be drafted from it.</p>}
      {result.pose_quality === 'poor' && <p className="warn">The alignment was poor when this photo was taken: treat these results with care.</p>}

      <section className="checks-images" aria-labelledby="images-h">
        <div className="checks-section-head">
          <h2 id="images-h">What Gemini compared</h2>
          <div className="seg" role="group" aria-label="Compare the photo with">
            <button type="button" aria-pressed={compare === 'render'} onClick={() => setCompare('render')}>Design render</button>
            <button type="button" aria-pressed={compare === 'overlay'} onClick={() => setCompare('overlay')} disabled={!run.images.overlay}
              title={run.images.overlay ? undefined : 'This check was sent without the outline image'}>Outlines on photo</button>
          </div>
        </div>
        <div className="checks-figs">
          <figure>
            <figcaption>Site photo · tap a box to see its finding</figcaption>
            {images.photo
              ? <EvidenceView imageUrl={images.photo} result={result} selectedMark={selected} dimmedMarks={dismissed} onSelect={(m) => select(m, true)} />
              : <ImageSlot state={images.photo} what="the photo" />}
          </figure>
          <figure>
            <figcaption>{compare === 'render'
              ? 'The BIM design from the same spot, with the numbered marks Gemini was asked about'
              : "The photo with each mark's design outline in magenta, as Gemini saw it"}</figcaption>
            {compare === 'render'
              ? (images.render ? <img className="checks-img" src={images.render} alt="The BIM design render with numbered marks, from the same camera pose" /> : <ImageSlot state={images.render} what="the design render" />)
              : (images.overlay ? <img className="checks-img" src={images.overlay} alt="The site photo with each marked element's design outline" /> : <ImageSlot state={images.overlay} what="the outline image" />)}
          </figure>
        </div>
      </section>

      {notice && <p className="checks-notice" role="status">{notice}</p>}

      <div className="checks-detail-grid">
        <section className={`checks-findings-sec${quality ? ' checks-greyed' : ''}`} aria-labelledby="findings-h">
          <div className="checks-section-head">
            <h2 id="findings-h">Findings to review <span className="checks-count">{flagged.length}</span></h2>
          </div>
          <p className="checks-tip">Highest severity first and, within it, the least sure first. Tap a finding to see it on the photo.</p>
          {flagged.length === 0
            ? <p className="checks-none">Gemini flagged no deviation in this view.</p>
            : <ol className="fcards">{flagged.map((f) => <FindingCard key={f.mark} {...cardProps(f)} />)}</ol>}
          {result.unexpected.length > 0 && (
            <>
              <h3 className="checks-h3">Not in the design <span className="checks-count">{result.unexpected.length}</span></h3>
              <ul className="fcards">{result.unexpected.map((u, i) => <UnexpectedCard key={i} u={u} />)}</ul>
            </>
          )}
          {unsure.length > 0 && (
            <>
              <h3 className="checks-h3">Can't judge from this photo <span className="checks-count">{unsure.length}</span></h3>
              <p className="checks-tip">Gemini couldn't tell from this photo. A person should look on site, or check again from closer.</p>
              <ol className="fcards">{unsure.map((f) => <FindingCard key={f.mark} {...cardProps(f)} />)}</ol>
            </>
          )}
          {ok.length > 0 && (
            <details className="checks-ok">
              <summary>Matches the design <span className="checks-count">{ok.length}</span></summary>
              <ol className="fcards">{ok.map((f) => <FindingCard key={f.mark} {...cardProps(f)} />)}</ol>
            </details>
          )}
        </section>

        <aside className="checks-aside" aria-label="About this check">
          {result.summary && (
            <section className="checks-box">
              <h2>Gemini's summary</h2>
              <p>{result.summary}</p>
            </section>
          )}
          <section className="checks-box">
            <h2>Photo and alignment</h2>
            <dl className="facts">
              <dt>Photo</dt><dd>{quality ?? 'Good enough to judge'}</dd>
              <dt>Alignment</dt><dd>{POSE[result.pose_quality]}</dd>
            </dl>
          </section>
          <AuditTrail run={run} findings={findings} />
        </aside>
      </div>

      {draftFor && (
        <IssueDialog open projectId={run.project_id} runId={run.run_id} mark={draftFor.mark} finding={draftFor}
          element={elements.get(draftFor.guid) ?? null} onClose={() => setDraftFor(null)}
          onSaved={(issue) => { setDraftFor(null); addIssue(issue); setNotice(`Issue saved for mark ${draftFor.mark}.`) }} />
      )}
    </>
  )
}

function ImageSlot({ state, what }: { state: string | null | undefined; what: string }) {
  return <p className="checks-img-slot" role={state === null ? 'alert' : 'status'}>{state === null ? `Couldn't load ${what}.` : `Loading ${what}…`}</p>
}

/** The photo around a finding's evidence box, with the box drawn on it. */
function EvidenceCrop({ url, box, aspect }: { url: string; box: Box; aspect: number }) {
  const c = cropFor(box, aspect)
  return (
    <span className="fcard-crop" aria-hidden="true">
      <img src={url} alt="" style={c.img} />
      <span className="fcard-crop-box" style={c.box} />
    </span>
  )
}

type FindingCardProps = {
  f: Finding; runId: string; element: Element | null; photoUrl: string | null; aspect: number | null; selected: boolean
  onSelect: () => void; review: { decision: ReviewDecision; at: string } | null; busy: boolean; error: string | null
  onDecide: (d: ReviewDecision | null) => void; onDraft?: () => void; issueSaved: boolean
}

export function FindingCard({ f, element, photoUrl, aspect, selected, onSelect, review, busy, error, onDecide, onDraft, issueSaved }: FindingCardProps) {
  const flagged = isFlagged(f)
  const why = whyItMatters(f)
  const kind = element ? typeLabel(element) : f.ifc_class.replace(/^Ifc/, '')
  const classes = ['fcard', `fcard-${f.severity ?? f.status}`, selected ? 'fcard-selected' : '', review ? `fcard-${review.decision}` : ''].filter(Boolean)
  return (
    <li className={classes.join(' ')} id={`finding-${f.mark}`}>
      <button type="button" className="fcard-main" onClick={onSelect} aria-pressed={selected}>
        {f.evidence_box && photoUrl && aspect
          ? <EvidenceCrop url={photoUrl} box={f.evidence_box} aspect={aspect} />
          : <span className="fcard-crop fcard-crop-none" aria-hidden="true">{f.evidence_box ? '' : 'No box'}</span>}
        <span className="fcard-body">
          <span className="fcard-title">
            <span className="mark-dot">{f.mark}</span>
            <strong>{f.name || kind}</strong>
            <span className="fcard-kind">{kind}</span>
          </span>
          <span className="fcard-status">{statusText(f)}</span>
          <span className="fcard-badges">
            {f.severity && <span className={`badge badge-${f.severity}`}>{f.severity} severity</span>}
            {f.status !== 'cannot_judge' && <ConfidenceBadge value={f.confidence} />}
          </span>
          {f.explanation && <span className="fcard-why"><span className="finding-src">Gemini:</span> {f.explanation}</span>}
          {why && <span className="finding-risk"><span className="finding-src">Why it matters:</span> {why}</span>}
        </span>
      </button>
      {flagged && (
        <div className="fcard-actions">
          {review ? (
            <>
              <p className={`fcard-decision fcard-decision-${review.decision}`} role="status">
                {review.decision === 'confirmed' && <span aria-hidden="true">✓ </span>}{decisionLine(review)}
              </p>
              <button type="button" className="btn btn-small" onClick={() => onDecide(null)} disabled={busy}>
                {busy ? 'Saving…' : 'Undo decision'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => onDecide('confirmed')} disabled={busy}>Confirm finding</button>
              <button type="button" className="btn" onClick={() => onDecide('dismissed')} disabled={busy}>Dismiss as false alarm</button>
            </>
          )}
          {onDraft && review?.decision !== 'dismissed' && (
            <button type="button" className="btn btn-quiet" onClick={onDraft}>Draft issue</button>
          )}
          {issueSaved && <span className="finding-saved">✓ Issue saved</span>}
          {error && <p className="fcard-error" role="alert">{error}</p>}
        </div>
      )}
    </li>
  )
}

function UnexpectedCard({ u }: { u: UnexpectedItem }) {
  return (
    <li className="fcard fcard-unexpected">
      <div className="fcard-main fcard-static">
        <span className="fcard-crop fcard-crop-none" aria-hidden="true">?</span>
        <span className="fcard-body">
          <span className="fcard-status">{u.description}</span>
          <span className="fcard-badges">
            <span className="badge badge-medium">medium severity</span>
            <ConfidenceBadge value={u.confidence} />
          </span>
          <span className="finding-risk"><span className="finding-src">Why it matters:</span> Not in the design: a person should look before work continues here.</span>
        </span>
      </div>
    </li>
  )
}

function AuditTrail({ run, findings }: { run: RunDetail; findings: readonly Finding[] }) {
  const p = run.provenance
  const usage = run.result.usage
  const decisions = findings.filter((f) => run.review[String(f.mark)]).map((f) => ({ f, r: run.review[String(f.mark)] }))
  const hash = (h: string | null) => h ? <code className="checks-hash" title={h}>{shortHash(h)}</code> : <span className="checks-muted">Not sent</span>
  return (
    <section className="checks-box checks-audit" aria-labelledby="audit-h">
      <h2 id="audit-h">Audit trail</h2>
      <p className="note">
        {p ? 'Recorded by the server as the check arrived. The SHA-256 fingerprints identify the exact images Gemini was sent.'
          : 'This check was stored before the audit trail was added: only the model, tokens and cost were recorded.'}
      </p>
      <dl className="facts">
        {p && <><dt>Received</dt><dd>{exactTime(p.received_at)}</dd></>}
        <dt>Model</dt><dd>{modelLabel(run.result.model_version)}</dd>
        {p && <><dt>App version</dt><dd><code>{p.app_version}</code></dd></>}
        <dt>Source</dt><dd>{sourceLabel(run.source)}</dd>
        {p && p.distance_m !== null && <><dt>Distance</dt><dd>{p.distance_m.toFixed(1)} m from the code {run.anchor_id}</dd></>}
        {p && <><dt>Photo</dt><dd>{hash(p.photo_sha256)}</dd></>}
        {p && <><dt>Design render</dt><dd>{hash(p.render_sha256)}</dd></>}
        {p && <><dt>Outline image</dt><dd>{hash(p.overlay_sha256)}</dd></>}
        {usage && <><dt>Tokens</dt><dd>{tokensText(usage)}</dd></>}
        {usage && <><dt>Estimated cost</dt><dd>{usd(usage.cost_usd_est)}</dd></>}
        {run.duration_ms !== null && <><dt>Gemini time</dt><dd>{seconds(run.duration_ms)}</dd></>}
        <dt>Check ID</dt><dd><code className="checks-hash">{run.run_id}</code></dd>
      </dl>
      {decisions.length > 0 && (
        <>
          <h3 className="checks-h3">Decisions</h3>
          <ul className="checks-log">{decisions.map(({ f, r }) => <li key={f.mark}>Mark {f.mark}, {f.name}: {decisionLine(r)}</li>)}</ul>
        </>
      )}
      {run.result.warnings.length > 0 && (
        <>
          <h3 className="checks-h3">Server notes</h3>
          <ul className="checks-log">{run.result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </>
      )}
    </section>
  )
}
