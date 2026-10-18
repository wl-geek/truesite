import { useEffect, type MouseEvent, type ReactNode } from 'react'
import { AboutSection } from './AboutSection'
import { Link } from './Link'
import { goToSection, SECTIONS } from './TopBar'
import { CODE_HEIGHT_M, compass, SITE_VIEWPOINTS, STAND_OFF_M } from './siteViewpoints'
import { ViewpointPlan } from './ViewpointPlan'
import './home.css'

type SectionId = (typeof SECTIONS)[number]['id'] | 'demo'

/** In-page link: scroll to the section instead of leaving the page (new-tab clicks still work). */
function jumpTo(id: SectionId) {
  return (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    goToSection(id)
  }
}

/**
 * Start page, one page: hero, How it works, Live AR on the real site (the product), the virtual site (for anyone
 * without a printer or a site), About. The nav links scroll between these; the tools open from buttons inside them.
 */
export function HomePage() {
  useEffect(() => { // /#about and friends: land on that section
    const id = window.location.hash.slice(1)
    if (SECTIONS.some((s) => s.id === id) || id === 'demo') goToSection(id as SectionId)
  }, [])
  return (
    <main className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-wrap home-hero-grid">
          <div className="home-hero-copy">
            <p className="home-eyebrow">AR × BIM × AI for construction</p>
            <h1 id="home-title">See the design where you build. Check the build against it.</h1>
            <p className="home-lede">
              Scan a QR code and the BIM model appears on site at true scale, through your phone's camera. Tap{' '}
              <strong>Check as-built</strong> and Gemini compares what is built with the design, pins the differences and
              drafts the issue.
            </p>
            <div className="home-ctas">
              <a href="/#live" className="btn btn-accent btn-lg" onClick={jumpTo('live')}>Start live AR</a>
              <div className="home-cta-stack">
                <a href="/#virtual" className="btn btn-ghost btn-lg" onClick={jumpTo('virtual')}>Try the virtual demo</a>
                <span className="home-cta-note">For judges to understand the concept&nbsp;· <span className="nowrap">no printing, no site visit</span></span>
              </div>
            </div>
            <a href="/#demo" className="home-watch" onClick={jumpTo('demo')}><Icon name="play" />Watch the demo video (3:15)</a>
            <ul className="home-proof" aria-label="Highlights">
              <li><Icon name="check" />No app to install</li>
              <li><Icon name="check" />Made for smartphones</li>
              <li><Icon name="check" />Gemini on Google Cloud</li>
            </ul>
          </div>
          <HeroVisual />
        </div>
      </section>

      <div className="home-theme">
        <p className="home-wrap"><span className="home-theme-tag">Future of Work</span>
          The future of construction work: the design in every hand, an AI check on every pour.</p>
      </div>

      <section id="demo" className="home-section home-wrap" aria-labelledby="demo-title">
        <div className="home-section-head">
          <div>
            <p className="home-kicker">Demo video · 3:15</p>
            <h2 id="demo-title">TrueSite, end to end</h2>
            <p className="home-sub">
              Real footage from our iPhone field test on 17 October, then a live Gemini check in the virtual demo.
            </p>
          </div>
        </div>
        <video className="home-video" controls playsInline preload="none" poster="/media/truesite-demo-poster.jpg" width={1920} height={1080}>
          <source src="/media/truesite-demo.mp4" type="video/mp4" />
          <track kind="captions" src="/media/truesite-demo.vtt" srcLang="en" label="English" />
        </video>
        <p className="home-deck">
          <a className="btn" href="/media/TrueSite-deck.pdf" download><Icon name="download" />Download the pitch deck</a>
          <span>PDF · 19 slides: the problem, the product, the architecture and the business case</span>
        </p>
      </section>

      <section id="how" className="home-section home-wrap" aria-labelledby="how-title">
        <p className="home-kicker">Three steps on site</p>
        <h2 id="how-title">How it works</h2>
        <ol className="home-steps">
          <Step n={1} tag="AR" icon="qr" title="Scan the code">
            Each code is fixed at a known spot and knows exactly where it sits in the model, so the camera view lines up
            with the design.
          </Step>
          <Step n={2} tag="BIM" icon="cube" title="See the design at true scale">
            The BIM model stands where it will be built, every element coloured by type and carrying its own data. Turn on
            the spot to look around and up.
          </Step>
          <Step n={3} tag="AI" icon="scan" title="Check as-built with Gemini">
            Gemini compares your photo with the design, pins what is off and drafts the issue, in the crew's language
            if needed. At the end of the day it writes the site report. A person approves both.
          </Step>
        </ol>
        <p className="home-fineprint">Visual check, not a survey: offsets are rough, in tens of centimetres.</p>
      </section>

      <section id="live" className="home-section home-band" aria-labelledby="live-title">
        <div className="home-wrap">
          <div className="home-section-head">
            <div>
              <p className="home-kicker">Live AR</p>
              <h2 id="live-title">See the BIM model live, through your camera</h2>
              <p className="home-sub">
                Scan a TrueSite code and the model appears where it belongs: on a desk sheet as a scale model, or around you
                at 1:1 on site. The desk sheet is the quickest way to try it.
              </p>
            </div>
          </div>
          <p className="home-device"><Icon name="phone" />
            <span><strong>Made for smartphones.</strong> Use your phone for the best experience; a tablet works too.</span>
          </p>

          <ul className="home-cards live-easy">
            <li className="home-card home-card-feature">
              <span className="home-card-tag">Quickest · one Letter print</span>
              <Icon name="desk" />
              <h3>On your desk · 1:100</h3>
              <p>Print the desk sheet on US Letter at 100%, lay it on a table and scan it. The building stands on the page as a 1:100 scale model you can walk around and inspect.</p>
              <div className="home-card-actions">
                <Link to="/a/site/D1" className="btn btn-accent">Open live AR</Link>
                <a className="btn" href="/sheets/site-D1.pdf" download><Icon name="download" />Download the desk sheet</a>
              </div>
            </li>
            <li className="home-card">
              <span className="home-card-tag home-card-tag-quiet">No print needed · any device</span>
              <Icon name="cube" />
              <h3>The 3D model</h3>
              <p>Orbit the BIM model, tap any element to see its data, and ask Gemini about it in plain language.</p>
              <div className="home-card-actions">
                <Link to="/model" className="btn btn-primary">Open the 3D model</Link>
              </div>
            </li>
          </ul>

          <div className="home-section-head live-onsite-head">
            <div>
              <h3 className="live-onsite-title">Life size 1:1 on site</h3>
              <p className="home-sub">
                A two-storey building under construction: concrete columns with their rebar showing, a cast slab with an
                open bay, a steel upper storey and roof trusses. Set the four Letter sheets out on a car park, stand at one and
                open its live view.
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
                    <span className="vp-meta">Stand at ({fmt(v.stand)}) · facing {compass(v.look)}</span>
                  </span>
                  <span className="vp-go"><span className="vp-go-label">Open live AR</span><Icon name="arrow" /></span>
                </Link>
              </li>
            ))}
          </ul>

          <ol className="home-protocol" aria-label="At the sheet">
            <li>Tap <strong>Start camera</strong> and allow camera and motion access.</li>
            <li><strong>Lock</strong> about 0.7 m from the code, a little to one side, until it says Alignment: Good.</li>
            <li><strong>Step back</strong> to the X, then turn slowly on the spot. Don't walk.</li>
          </ol>

          <details className="home-details">
            <summary>Print and set out the sheets</summary>
            <div className="home-details-body">
              <div className="home-downloads">
                <a className="btn btn-primary" href="/sheets/site-layout.pdf" download><Icon name="download" />Layout plan (Letter)</a>
                {SITE_VIEWPOINTS.map((v) => (
                  <a key={v.id} className="btn" href={`/sheets/site-${v.id}.pdf`} download><Icon name="download" />Sheet {v.id}</a>
                ))}
              </div>
              <ul className="home-checklist">
                <li>Print on US Letter at <strong>100%</strong> (not "Fit") and measure the check bar: it must read 10.0 cm.</li>
                <li>Mount each sheet flat on a board, code centre <strong>{CODE_HEIGHT_M.toFixed(2)} m</strong> above the ground, board vertical.</li>
                <li>Set out from point O with the layout plan. Square each board to its grid line: 1° off swings the far end about 20 cm.</li>
                <li>Mark the X <strong>{STAND_OFF_M} m</strong> in front of each code. Calibrate your phone once in <strong>Setup</strong>.</li>
              </ul>
            </div>
          </details>

        </div>
      </section>

      <section id="virtual" className="home-section" aria-labelledby="virtual-title">
        <div className="home-wrap">
          <div className="home-section-head">
            <div>
              <p className="home-kicker">For judges · no printing, no site visit</p>
              <h2 id="virtual-title">Try the idea in a virtual demo</h2>
              <p className="home-sub">
                TrueSite is built for live AR on a real site. To try the idea without printing sheets or visiting a site,
                step into this virtual demo on your own device: stand where a QR sheet would be, look around the building,
                and let Gemini check it against the BIM design. It runs on any device, laptops included.
              </p>
            </div>
          </div>
          <div className="sim-why">
            <h3>Why a simulated building?</h3>
            <p>
              Our demo building doesn't exist yet, so there is nothing real to photograph. Instead you step into a{' '}
              <strong>simulated as-built site</strong>: a realistic 3D model of the building as it was put up, with ten
              defects planted on purpose, from a shifted column to missing edge protection.
            </p>
            <p>
              When you tap <strong>Check as-built</strong>, TrueSite takes your view as the site photo, renders the BIM
              design from exactly the same spot, and Gemini compares the two: model against model. In the product the
              photo comes from the phone's camera on the real site; everything else is the same.
            </p>
          </div>
          <ol className="sim-steps">
            <li><strong>Pick a QR spot.</strong> You stand on its X, where the sheet's code places you in the model.</li>
            <li><strong>Look around.</strong> Drag, or turn your phone. You stay on the spot, as you would on site.</li>
            <li><strong>Check as-built.</strong> Gemini pins what's off on your view and drafts the issue.</li>
          </ol>
          <ul className="vp-grid">
            {SITE_VIEWPOINTS.map((v) => (
              <li key={v.id}>
                <Link to={`/samples?at=${v.id}`} className="vp-card vp-card-sim">
                  <ViewpointPlan active={v} />
                  <span className="vp-text">
                    <span className="vp-title"><span className="vp-id">{v.id}</span>{v.name}</span>
                    <span className="vp-shows">{v.shows}</span>
                  </span>
                  <span className="vp-go"><span className="vp-go-label">Step in at {v.id}</span><Icon name="arrow" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <AboutSection />

      <footer className="home-footer">
        <div className="home-wrap home-footer-row">
          <span className="home-footer-brand"><img src="/favicon.svg" alt="" width="20" height="20" />TrueSite</span>
          <span>Built by Wai Lin and Aung Nyein Chan for the Google Cloud AI Builder Cup 2026</span>
          <a href="https://github.com/wl-geek/truesite" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
        </div>
      </footer>
    </main>
  )
}

function fmt([x, y]: [number, number]): string {
  return `${x}, ${y < 0 ? '−' + -y : y}`
}

function Step({ n, tag, icon, title, children }: { n: number; tag: string; icon: IconName; title: string; children: ReactNode }) {
  return (
    <li className="home-step">
      <span className="home-step-icon"><Icon name={icon} /></span>
      <span className="home-step-n" aria-hidden="true">{n}</span>
      <span className="home-step-tag">{tag}</span>
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
      <figcaption>The demo building, coloured by element type. The finding is illustrative.</figcaption>
    </figure>
  )
}

type IconName = 'check' | 'down' | 'arrow' | 'qr' | 'cube' | 'scan' | 'download' | 'photo' | 'desk' | 'phone' | 'play'

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
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  play: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5v7l6-3.5z',
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  )
}
