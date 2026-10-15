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
          <p>Run the real check on photos taken in our demo room. The deviations there are staged on purpose.</p>
          <Link to="/samples" className="btn btn-primary">Open sample photos</Link>
        </li>
        <li className="way-card">
          <h3>On your desk · scale model 1:20</h3>
          <p>
            Print the A4 desk sheet at 100%, lay it on a table and scan the code with your phone camera. The 4 × 3 m demo
            room appears beside the code as a small model, like an architect's model.
          </p>
          <a className="btn" href="/sheets/room1-D1.pdf" download>Download A4 desk sheet</a>
        </li>
        <li className="way-card">
          <h3>Life size · 1:1</h3>
          <p>
            Print the A4 floor sheet, lay it flat on the floor of an open space and scan it. The demo room's walls, door
            and column appear around the sheet at real size. On Android, <strong>Start AR</strong> places the model by the
            code and it stays put as you walk around; on other phones, keep the code in view.
          </p>
          <a className="btn" href="/sheets/room1-L1.pdf" download>Download A4 floor sheet</a>
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
