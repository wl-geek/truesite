import './about.css'

/**
 * The product story for readers who scroll past the prototype: what TrueSite is, how and where it's used, why it
 * matters, how it's built, and the rules it keeps. Kept at the bottom of the start page on purpose: the prototype
 * comes first.
 */
export function AboutSection() {
  return (
    <section id="about" className="about" aria-labelledby="about-title">
      <div className="home-wrap">
        <p className="about-kicker">About TrueSite</p>
        <h2 id="about-title">AR × BIM × AI, where the work happens</h2>
        <p className="about-lede">
          Field crews build from drawings and memory while the BIM model sits in the site office. Mistakes surface weeks
          later, as rework. TrueSite brings the model on site in AR at true scale, then lets Gemini check the build
          against it. All it needs is a printed QR code and the smartphone the crew already carries.
        </p>

        <div className="about-grid">
          <article className="about-card">
            <h3>What it is</h3>
            <p>
              A web app for smartphones (tablets work too): no install, no headset. Scan a code fixed at a surveyed spot and the model appears over the real
              place at 1:1, colour-coded by element type. Tap <strong>Check as-built</strong>: Gemini compares the photo
              with the design, pins what is off and drafts the issue.
            </p>
          </article>
          <article className="about-card">
            <h3>How it's used</h3>
            <ol>
              <li><strong>Set up once:</strong> load the IFC model, print its QR codes and fix each at a known spot.</li>
              <li><strong>On site:</strong> scan, see the design where it will stand, and look around.</li>
              <li><strong>Check:</strong> aim at the work and tap. Approve the drafted issue, in the crew's language, and send the day's site report.</li>
            </ol>
          </article>
          <article className="about-card">
            <h3>Where it's used</h3>
            <ul>
              <li>Structure: columns, beams and rebar before a pour</li>
              <li>Steel erection, bracing and edge protection</li>
              <li>Fit-out and services: sleeves, openings, setting out</li>
              <li>Inspections, handovers and client walk-throughs</li>
            </ul>
          </article>
        </div>

        <div className="about-why">
          <div className="about-stat">
            <strong>48%</strong>
            <span>of rework on US job sites is caused by miscommunication and poor project data</span>
          </div>
          <div className="about-stat">
            <strong>US$31B+</strong>
            <span>of rework a year in the US alone, from the same causes</span>
          </div>
          <p className="about-why-text">
            <strong>From rework found weeks later to issues caught on the spot.</strong> Every field engineer gets a second
            pair of eyes that knows the model.
            A first visual check takes seconds instead of waiting for the next inspection, and the issue is written
            while the crew is still there.
            <span className="about-source">
              Figures: FMI and PlanGrid, <a href="https://www.autodesk.com/blogs/construction/construction-disconnected-fmi-report/"
                target="_blank" rel="noopener noreferrer">Construction Disconnected</a> (2018).
            </span>
          </p>
        </div>

        <div className="about-arch">
          <h3>Built on Google Cloud</h3>
          <ol className="arch-flow" aria-label="How a check flows">
            <li><span className="arch-node">Smartphone</span><span className="arch-note">QR pose on device, 3D model at 1:1</span></li>
            <li><span className="arch-node">Cloud Run</span><span className="arch-note">the web app and its API</span></li>
            <li><span className="arch-node arch-gemini">Gemini 3.8 Flash</span><span className="arch-note">compares photo and design, drafts issues and the site report, answers questions</span></li>
            <li><span className="arch-node">Firestore + Cloud Storage</span><span className="arch-note">runs, issues, photos and renders</span></li>
          </ol>
          <p className="about-note">
            The model comes from IFC, the open BIM standard. It is converted to glTF and every element keeps its IFC ID,
            so a finding, a pin and an issue all point at the same column.
          </p>
        </div>

        <div className="about-rules">
          <h3>Honest by design</h3>
          <ul>
            <li><strong>Visual check, not a survey.</strong> Offsets are rough, in tens of centimetres.</li>
            <li><strong>A person decides.</strong> Gemini drafts; severity comes from fixed rules, never from the model.</li>
            <li><strong>No guessing.</strong> When a photo can't show it, the finding says "can't judge".</li>
          </ul>
        </div>
      </div>
    </section>
  )
}
