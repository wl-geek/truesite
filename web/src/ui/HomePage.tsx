import type { ReactNode } from 'react'
import { Link } from './Link'
import { CODE_HEIGHT_M, compass, SITE_VIEWPOINTS, STAND_OFF_M } from './siteViewpoints'
import { ViewpointPlan } from './ViewpointPlan'
import './home.css'

/**
 * Start page. Two audiences: someone seeing TrueSite for the first time (what it is, try it without a printer)
 * and the team on the car park (one tap to each viewpoint's live view). The hero links straight to the second.
 */
export function HomePage() {
  return (
    <main className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-wrap home-hero-grid">
          <div className="home-hero-copy">
            <p className="home-eyebrow">BIM on site · Gemini as-built check</p>
            <h1 id="home-title">See the design where you build. Check the build against it.</h1>
            <p className="home-lede">
              Scan a TrueSite QR code and the BIM model stands on site at true scale. Tap <strong>Check as-built</strong>:
              Gemini compares the photo with the design, pins what is off on the model and drafts the issue.
            </p>
            <div className="home-ctas">
              <Link to="/samples" className="btn btn-accent btn-lg">Try the as-built check</Link>
              <Link to="/model" className="btn btn-ghost btn-lg">Explore the 3D model</Link>
            </div>
            <ul className="home-proof" aria-label="Highlights">
              <li><Icon name="check" />No app to install</li>
              <li><Icon name="check" />Phone or iPad browser</li>
              <li><Icon name="check" />Gemini on Google Cloud</li>
            </ul>
            <a className="home-jump" href="#on-site">On site? Jump to the viewpoints <Icon name="down" /></a>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section className="home-section home-wrap" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className="home-steps">
          <Step n={1} icon="qr" title="Scan the code">
            Each code is fixed at a known spot and stores exactly where it sits in the model.
          </Step>
          <Step n={2} icon="cube" title="See it at true scale">
            The model lines up with the real place, coloured by element type. Turn on the spot to look around and up.
          </Step>
          <Step n={3} icon="scan" title="Check as-built">
            Gemini compares your photo with the design, pins the deviations and drafts an issue for you to approve.
          </Step>
        </ol>
        <p className="home-fineprint">Visual check, not a survey: offsets are rough, in tens of centimetres.</p>
      </section>

      <section id="on-site" className="home-section home-band" aria-labelledby="site-title">
        <div className="home-wrap">
          <div className="home-section-head">
            <div>
              <p className="home-kicker">Life size 1:1 · car park demo</p>
              <h2 id="site-title">Stand inside a building site</h2>
              <p className="home-sub">
                A two-storey building under construction: concrete columns with their rebar showing, a cast slab with an
                open bay, a steel upper storey and roof trusses. Pick the sheet you are standing at.
              </p>
            </div>
            <ul className="home-specs" aria-label="Model size">
              <li><strong>18 × 12 m</strong>footprint</li>
              <li><strong>3.9 m</strong>clear inside</li>
              <li><strong>10.5 m</strong>to the ridge</li>
            </ul>
          </div>

          <ul className="vp-grid">
            {SITE_VIEWPOINTS.map((v) => (
              <li key={v.id}>
                <Link to={`/a/site/${v.id}`} className="vp-card">
                  <ViewpointPlan active={v} />
                  <span className="vp-text">
                    <span className="vp-title"><span className="vp-id">{v.id}</span>{v.name}</span>
                    <span className="vp-shows">{v.shows}</span>
                    <span className="vp-meta">Stand {fmt(v.stand)} · look {compass(v.look)}</span>
                  </span>
                  <span className="vp-go"><span className="vp-go-label">Open live view</span><Icon name="arrow" /></span>
                </Link>
              </li>
            ))}
          </ul>

          <ol className="home-protocol" aria-label="At the sheet">
            <li><strong>Start camera</strong> and allow camera and motion access.</li>
            <li><strong>Lock</strong> about 0.7 m from the code, a little to one side, until it says Alignment: Good.</li>
            <li><strong>Step back</strong> to the X, then turn slowly on the spot. Don't walk.</li>
          </ol>

          <details className="home-details">
            <summary>Print and set out the sheets</summary>
            <div className="home-details-body">
              <div className="home-downloads">
                <a className="btn btn-primary" href="/sheets/site-layout.pdf" download><Icon name="download" />Layout plan (A3)</a>
                {SITE_VIEWPOINTS.map((v) => (
                  <a key={v.id} className="btn" href={`/sheets/site-${v.id}.pdf`} download><Icon name="download" />Sheet {v.id}</a>
                ))}
              </div>
              <ul className="home-checklist">
                <li>Print on A3 at <strong>100%</strong> (not "Fit") and measure the check bar: it must read 10.0 cm.</li>
                <li>Mount each sheet flat on a board, code centre <strong>{CODE_HEIGHT_M.toFixed(2)} m</strong> above the ground, board vertical.</li>
                <li>Set out from point O with the layout plan. Square each board to its grid line: 1° off swings the far end about 20 cm.</li>
                <li>Mark the X <strong>{STAND_OFF_M} m</strong> in front of each code. Calibrate the iPad once in <strong>Setup</strong>, in landscape.</li>
              </ul>
            </div>
          </details>
        </div>
      </section>

      <section className="home-section home-wrap" aria-labelledby="more-title">
        <h2 id="more-title">More ways to try it</h2>
        <ul className="home-cards">
          <li className="home-card">
            <Icon name="photo" />
            <h3>Virtual site</h3>
            <p>No printer needed. Stand on a QR spot inside a simulated as-built site with defects planted on purpose, look around, and run the real as-built check.</p>
            <Link to="/samples" className="btn btn-primary">Enter the virtual site</Link>
          </li>
          <li className="home-card">
            <Icon name="desk" />
            <h3>On your desk · 1:100</h3>
            <p>Print the A4 desk sheet at 100%, lay it on a table and scan it. The same building stands on the page as a scale model.</p>
            <div className="home-card-actions">
              <Link to="/a/site/D1" className="btn btn-primary">Live view</Link>
              <a className="btn" href="/sheets/site-D1.pdf" download>A4 sheet</a>
            </div>
          </li>
          <li className="home-card">
            <Icon name="cube" />
            <h3>The 3D model</h3>
            <p>Orbit the model, tap any element to see its data, and ask questions about it in plain language.</p>
            <Link to="/model" className="btn btn-primary">Open the 3D model</Link>
          </li>
        </ul>
      </section>

      <footer className="home-footer home-wrap">
        <img src="/favicon.svg" alt="" width="20" height="20" />
        <span>TrueSite · Google Cloud AI Builder Cup 2026</span>
      </footer>
    </main>
  )
}

function fmt([x, y]: [number, number]): string {
  return `${x}, ${y < 0 ? '−' + -y : y}`
}

function Step({ n, icon, title, children }: { n: number; icon: IconName; title: string; children: ReactNode }) {
  return (
    <li className="home-step">
      <span className="home-step-icon"><Icon name={icon} /></span>
      <span className="home-step-n" aria-hidden="true">{n}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </li>
  )
}

/** The model render with two app-style chips on it: the alignment badge and a finding pin. */
function HeroVisual() {
  return (
    <figure className="home-visual">
      <div className="home-visual-frame">
        <picture>
          <source srcSet="/hero-site.webp" type="image/webp" />
          <img src="/hero-site.jpg" width="1200" height="1000" fetchPriority="high"
            alt="The building site model: blue columns, cyan beams, green roof trusses, yellow purlins and orange rebar." />
        </picture>
        <span className="chip-align" aria-hidden="true"><span className="dot" />Alignment: Good · 1.5 m</span>
        <span className="chip-pin" aria-hidden="true">
          <span className="pin" />
          <span className="pin-label"><strong>Steel column</strong>about 30 cm off the design</span>
        </span>
      </div>
      <figcaption>The building site demo, colour-coded by element type. Illustrative finding.</figcaption>
    </figure>
  )
}

type IconName = 'check' | 'down' | 'arrow' | 'qr' | 'cube' | 'scan' | 'download' | 'photo' | 'desk'

const ICONS: Record<IconName, string> = {
  check: 'M20 6 9 17l-5-5',
  down: 'M12 5v14M6 13l6 6 6-6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3',
  cube: 'M12 2 21 7v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 12l3 3 5-6',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  photo: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  desk: 'M3 10h18M5 10v9M19 10v9M8 10l2-5h4l2 5',
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  )
}
