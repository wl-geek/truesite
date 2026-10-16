import { Link } from './Link'

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
          <h3>Stand inside a steel frame · life size 1:1</h3>
          <p>
            In an open space of about 20 × 14 m (an empty car park works), lay sheet S1 (A3) or S2 (A4) flat at the
            centre, or set the upright sheet S3 on a stand with the code 1.3 m high. Scan it: an 18 × 12 m steel frame,
            colour-coded by element type, stands around you. Android: <strong>Start AR</strong> (walk around freely).
            iPad/iPhone: <strong>Walk inside</strong>, or <strong>Camera overlay</strong> and turn on the spot.
          </p>
          <a className="btn btn-primary" href="/sheets/site-S2.pdf" download>A4 floor sheet (S2)</a>
          <a className="btn" href="/sheets/site-S1.pdf" download>A3 floor sheet (S1)</a>
          <a className="btn" href="/sheets/site-S3.pdf" download>A3 upright sheet (S3)</a>
        </li>
        <li className="way-card">
          <h3>On your desk · scale model 1:100</h3>
          <p>
            Print the A4 desk sheet at 100%, lay it on a table and scan the code. The same steel frame appears on the
            left half of the page as a 1:100 model, like an architect's model.
          </p>
          <a className="btn" href="/sheets/site-D1.pdf" download>A4 desk sheet (D1)</a>
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
        <li>Scan the code and tap <strong>Start camera</strong> (<strong>Camera overlay</strong> on Android).</li>
        <li>Start within about 1 m of the code, then step back. The badge shows how well the model is aligned.</li>
        <li>Aim at the work and tap <strong>Check as-built</strong>.</li>
        <li>Review the findings, then draft and save an issue.</li>
      </ol>
      <p className="note">Visual check, not a survey: offsets are rough, in tens of centimetres.</p>
    </main>
  )
}
