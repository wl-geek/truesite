import { Link } from './Link'

/** The building site viewpoints (bim/truesite_bim/site.py VIEWPOINTS). */
const VIEWPOINTS = [
  ['P1', 'South approach'],
  ['P2', 'Under the slab'],
  ['P3', 'Under the open bay'],
  ['P4', 'East gable'],
] as const

/** Start page: what TrueSite does and the ways to try it, with or without a printer. */
export function HomePage() {
  return (
    <main className="page home-page">
      <section className="hero">
        <p className="eyebrow">BIM on site · as-built AI</p>
        <h1>See the design where you build. Check the build against it.</h1>
        <p>
          Point a phone at a TrueSite QR code and the BIM model appears over the real place at true scale. Tap{' '}
          <strong>Check as-built</strong>: Gemini compares the photo with the design, pins the deviations on the model and
          drafts the issue.
        </p>
      </section>

      <h2>Try it</h2>
      <ol className="way-list">
        <li className="way-card">
          <h3>No printer: sample photos</h3>
          <p>Run the real as-built check on photos taken at our demo site, where a few column positions are staged wrong on purpose.</p>
          <Link to="/samples" className="btn btn-primary">Open sample photos</Link>
        </li>
        <li className="way-card">
          <h3>Stand inside a building site · life size 1:1</h3>
          <p>
            A two-storey building under construction, 18 × 12 m and about 10.5 m to the ridge: concrete columns with
            their rebar showing, a cast slab with an open bay, a steel upper storey and roof trusses, colour-coded by
            element type. Set the four upright A3 sheets out on a car park with the layout plan, stand on each X and
            turn on the spot to see it from four sides.
          </p>
          <p className="way-label">At the sheet: open its live view, then scan the code in the app</p>
          <div className="way-actions">
            {VIEWPOINTS.map(([id, name]) => (
              <Link key={id} to={`/a/site/${id}`} className="btn btn-primary">{id} · {name}</Link>
            ))}
          </div>
          <p className="way-label">Print and set out</p>
          <div className="way-actions">
            <a className="btn" href="/sheets/site-layout.pdf" download>Layout plan</a>
            {VIEWPOINTS.map(([id]) => <a key={id} className="btn" href={`/sheets/site-${id}.pdf`} download>Sheet {id}</a>)}
          </div>
        </li>
        <li className="way-card">
          <h3>On your desk · scale model 1:100</h3>
          <p>
            Print the A4 desk sheet at 100%, lay it on a table and scan the code. The same building appears on the
            left half of the page as a 1:100 model, like an architect's model.
          </p>
          <div className="way-actions">
            <Link to="/a/site/D1" className="btn btn-primary">Live view (D1)</Link>
            <a className="btn" href="/sheets/site-D1.pdf" download>A4 desk sheet (D1)</a>
          </div>
        </li>
        <li className="way-card">
          <h3>Explore the model</h3>
          <p>Orbit the 3D model, tap an element to see its data, and ask questions about it.</p>
          <Link to="/model" className="btn">Open the 3D model</Link>
        </li>
      </ol>

      <h2>On a real site</h2>
      <p>
        Each code is fixed at a surveyed spot, for example on a wall, and stores exactly where it sits in the model. So the
        model lines up with the real building at 1:1.
      </p>
      <ol className="steps">
        <li>Scan the code and tap <strong>Start camera</strong>.</li>
        <li>Start within about 1 m of the code, then step back. The badge shows how well the model is aligned.</li>
        <li>Aim at the work and tap <strong>Check as-built</strong>.</li>
        <li>Review the findings, then draft and save an issue.</li>
      </ol>
      <p className="note">Visual check, not a survey: offsets are rough, in tens of centimetres.</p>
    </main>
  )
}
