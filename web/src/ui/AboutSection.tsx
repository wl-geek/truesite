import './about.css'

/**
 * The product story for readers who scroll past the prototype, in the pitch deck's order: the idea (AR × BIM × AI),
 * why it matters, how it fits the BIM a team already has, what it runs on and the rules it keeps, then the team.
 * Kept at the bottom of the start page on purpose: the prototype comes first.
 */
export function AboutSection() {
  return (
    <section id="about" className="about" aria-labelledby="about-title">
      <div className="home-wrap">
        <header className="about-head">
          <p className="about-kicker">About TrueSite</p>
          <h2 id="about-title">AR × BIM × AI, where the work happens</h2>
          <p className="about-lede">
            The BIM model exists, but it stays in the office while crews build from drawings and memory. TrueSite puts
            it on site at true scale, and lets Gemini check the build against it.
          </p>
        </header>

        <ul className="about-pillars" aria-label="What TrueSite brings together">
          <li>
            <span className="about-tag about-tag-ar">AR</span>
            <h3>See it in place</h3>
            <p>The design at 1:1 over the real site, from a printed QR code and a phone’s browser. No app, no headset.</p>
          </li>
          <li>
            <span className="about-tag about-tag-bim">BIM</span>
            <h3>Know every element</h3>
            <p>Tap any part for its type, size, material and properties, straight from the model.</p>
          </li>
          <li>
            <span className="about-tag about-tag-ai">AI</span>
            <h3>Check and write</h3>
            <p>Gemini compares what is built with the design, pins what is off and drafts the issue.</p>
          </li>
        </ul>

        <div className="about-band">
          <h3 className="about-h3">Why it matters</h3>
          <div className="about-stats">
            <p><strong>14+ h</strong><span>a week per project team member lost to hunting for data, conflicts and rework</span></p>
            <p><strong>48%</strong><span>of rework on US jobsites comes from miscommunication and poor project data</span></p>
            <p><strong>5,000 m²</strong><span>Singapore already requires BIM submissions above this floor area: the model is there</span></p>
          </div>
          <p className="about-source">
            FMI and PlanGrid, <a href="https://www.autodesk.com/blogs/construction/construction-disconnected-fmi-report/"
              target="_blank" rel="noopener noreferrer">Construction Disconnected</a> (2018) · Building and Construction
            Authority, Singapore
          </p>
        </div>

        <div className="about-band">
          <h3 className="about-h3">Works with the BIM you already have</h3>
          <ol className="about-flow">
            <li><strong>IFC in</strong><span>The open BIM standard that Revit, Archicad, Tekla and most BIM tools export</span></li>
            <li><strong>Prepared once</strong><span>A 3D model where every element keeps its IFC ID, its data, and the QR sheets</span></li>
            <li><strong>Any phone or laptop</strong><span>Live AR, the 3D model and the virtual demo, in the browser</span></li>
            <li><strong>Back to the team</strong><span>Issues ready for any tracker, and the day’s site report</span></li>
          </ol>
        </div>

        <div className="about-pair">
          <div className="about-panel">
            <h3>Built on Google Cloud</h3>
            <ul>
              <li><strong>Cloud Run</strong> serves the web app and its API</li>
              <li><strong>Gemini 3.8 Flash</strong> checks the build, answers questions and drafts issues and reports</li>
              <li><strong>Firestore and Cloud Storage</strong> keep runs, issues, photos and renders</li>
            </ul>
          </div>
          <div className="about-panel">
            <h3>Honest by design</h3>
            <ul>
              <li><strong>Visual check, not a survey.</strong> Offsets are rough, in tens of centimetres.</li>
              <li><strong>A person decides.</strong> Gemini drafts; fixed rules set the severity, never the model.</li>
              <li><strong>No guessing.</strong> When a photo can’t show it, the finding says “Can’t judge”.</li>
            </ul>
          </div>
        </div>

        <div className="about-team">
          <h3 className="about-h3">The team</h3>
          <div className="about-people">
            <figure>
              <img src="/media/team-wai.jpg" alt="" width="72" height="72" loading="lazy" />
              <figcaption><strong>Wai Lin</strong><span>Product and code</span></figcaption>
            </figure>
            <figure>
              <img src="/media/team-michael.jpg" alt="" width="72" height="72" loading="lazy" />
              <figcaption><strong>Aung Nyein Chan (Michael)</strong><span>Architect: the BIM model and field validation</span></figcaption>
            </figure>
          </div>
          <p className="about-links">
            <a className="btn" href="/media/TrueSite-deck.pdf" download>Download the pitch deck</a>
            <a className="btn" href="https://github.com/wl-geek/truesite" target="_blank" rel="noopener noreferrer">Read the code on GitHub</a>
          </p>
        </div>
      </div>
    </section>
  )
}
