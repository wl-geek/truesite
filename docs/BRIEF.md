# TrueSite — Brief for anyone joining the build

Read this first, then `DEVELOPMENT.md` (how to work), the [design spec](specs/2026-10-11-truesite-design.md) (the detailed PRD) and the [interface contract](plans/2026-10-11-truesite-contract.md) (binding names, schemas, versions).

## 1. The competition

**Event:** Google Cloud AI Builder Cup 2026 (JAPAC, run by Hack2skill).
- **Theme:** *Future of Work & Enterprise Productivity*. It asks for solutions that "transform how individuals and organizations access knowledge, collaborate, make decisions, and complete everyday work".
- **Team:** Wai and Michael (Aung Nyein Chan, an architect).
- **Deadline:** the portal closes **19 Oct 2026, 01:29 IST**.

**Scoring.** The Terms prevail over the website:

| Criterion | Weight | What it covers |
|---|---|---|
| Technical Merit & GenAI | 40% | Robustness, Google Cloud architectural depth, technical execution |
| Problem Alignment & Impact | 25% | Clarity of problem-solution fit and measurable real-world viability |
| Innovation & Creativity | 25% | Originality and inventiveness of the approach |
| UX | 10% | Quality, intuitiveness, clean design |

**Deliverables:**
- a working URL **deployed on Google Cloud** (Cloud Run)
- a demo video of **3 to 4 minutes** (ours is 3:15: https://youtu.be/M8zh02kMtk4)
- a **public GitHub repo**
- a **deck PDF covering the solution architecture and the business case**

**Rules that bite:**
- Only **fresh code and assets made during the event** count: no code, prompts or data from any earlier project.
- The organiser gets a 6-month right of first refusal on *exclusive* licences of what we submit.

## 2. The product

**One line:** point a phone at a QR code on site and the BIM model appears over the real place at true scale. Tap *Check as-built*: Gemini compares what's built with the design, the deviations are pinned on the model, and the issue is drafted.

**Who it's for:** field engineers, foremen and site architects (buyers: contractors).

**The problem:** people build without the model in front of them, and mistakes surface as rework weeks later.

**What we sell beyond the incumbents** (Dalux, Trimble Connect AR, GAMMA AR, XYZ Reality). They all do marker placement plus visualisation. Our edge:
1. **The Gemini as-built check:** three images (the photo, the design render with numbered marks, and the photo with each mark's design outline) → structured findings → severity set by code → pins plus evidence boxes.
2. **Grounded Ask:** answers come only from the element's own IFC properties, with the fields cited.
3. **Issues drafted by Gemini**, in the crew's language, and saved by a person. Gemini also drafts the day's site report.
4. **A browser link**, no install. Measured, honest accuracy ("Visual check, not a survey").

## 3. Reference video (what "good" looks like for the base experience)

Wai found a 13-second screen recording of a commercial construction-AR app on a stadium site. It's third-party footage, so it lives in the private repo `wl-geek/truesite-private`, never here. To get it, from this repo's root run `gh repo clone wl-geek/truesite-private capture` (`capture/` is git-ignored). What it shows:

1. **Marker placement.** A printed QR code is taped (orange tape) to a concrete core or column.
   - On-screen card: *"Scan Marker to Place Model. Approach the Marker until you see the progress circle. Complete the progress circle by shifting from left to right, to view the Marker from a range of angles."*
   - The app averages the marker pose over many viewpoints before placing the model.
2. **World-tracked model.** After placement, the BIM model (a **steel roof**: trusses, purlins, bracing, hanger rods) is locked in the world at 1:1, overhead.
   - The user **looks up, turns and walks underneath it, and it stays put**. The marker doesn't have to stay in view.
   - Elements are **colour-coded by type**: trusses green, primary beams blue, purlins yellow, hangers and bolts purple.
3. **Controls**, at the bottom of the screen:
   - menu
   - a **Cross-section** slider
   - a 2D/3D toggle
   - a **Transparency** slider
   - a 3D-view button
   - top left: tap-to-select; top right: **Layers**

**How we matched it:**
- **Every phone and tablet: Start camera** (the camera overlay, the demo mode). The model locks on the QR code. With the motion sensors on, the QR pose is fused with the device rotation (`scene/fusion.ts`, #107), so the model holds still and turns with the device, and `scene/level.ts` levels it by gravity. **Look-around:** when the code leaves the view, the sensors hold the model for up to 90 s while you turn on the spot. You can't walk under it: that needs world tracking.
- **Controls:** Transparency, **Cut above** (section height), **View distance** and **Layers** (structure, rebar, doors/windows/services, other). Elements are colour-coded by type, like the video.
- **Built, but only with `?xr=1` and not tested on a device:**
  - **Android "Start AR (place by code)":** WebXR `camera-access` frames go to our zxing worker and pose maths. A progress ring fills as you move left and right. Estimates are fused across angles, then the model is **world-locked** on the ground.
  - **Walk inside:** a WebXR hit-test on Android. On iPhone and iPad, AR Quick Look with `public/models/<project>.usdz`, built at build time by `web/scripts/make-usdz.mjs` (the npm prebuild, also run in the Docker build). Exporting in the browser is only a fallback.

## 4. Demo plan

The start page shows one project, `site`: a two-storey building under construction (18 × 12 m, 6 m bays, 3.9 m clear in the ground storey, ridge about 10.5 m), colour-coded by type like the video. It is the only project: the old demo room and rooftop frame were removed on 17 Oct.

1. **Hero shot: live AR on the iPad (Michael, an open car park).**
   - Four upright US Letter sheets P1–P4 (16 cm codes, centred 1.40 m above the ground), set out with `site-layout.pdf`.
   - At each one: lock about 0.7 m from the code, step back to the X 1.5 m away, then turn on the spot and look up. Don't walk. Checklist: `docs/demo/ipad-ar-filming.md`.
   - Camera overlay only. *Check as-built* is off on the site sheets, because nothing is built there; the live view points to the virtual demo instead.
2. **The AI moment: the virtual demo** (the start page's `#virtual`, `/samples?at=P1` to `P4`).
   - You stand at a QR spot inside a simulated as-built: the design with ten defects planted on purpose (`web/src/sim/asBuilt.ts`). Look around, tap *Check as-built*, and live Gemini judges your view from three images.
   - A scorecard compares the findings with the planted list (Gemini never sees it). Each deviation gets "Why it matters" from fixed rules (`check/risk.ts`), never from the model.
   - Then *Draft issue* in the crew's language, *Write today's site report*, and the findings pinned on the 3D model.
   - Say that the defects are planted and the views are simulated.
3. **Judges without a site:**
   - the virtual demo, which runs on any device
   - **ready-made views** (`/samples?photos`): four simulated photos with saved results, the fallback when Gemini is busy (a bare `/samples` goes to `/#virtual`)
   - the US Letter **desk sheet D1**: the building at 1:100 on a desk, with the check off
   - on a laptop or PC, a live AR page opens a popup every time: a QR code of the page for a tablet or phone, then that page's sheet to download, with how to print and place it
4. **Also in the video:** Ask on an element, a drafted issue and the site report, the measured numbers (labelled simulated), and the Google Cloud architecture.

## 5. Prototype scope (what "done" meant for submission)

| Must work | Nice | Out |
|---|---|---|
| Deployed Cloud Run URL. The as-built check in the virtual demo with live Gemini (off on the site sheets), with the ready-made views as the fallback. Live AR camera overlay on iPad, iPhone and Android: P1–P4 at 1:1, D1 at 1:100. Ask. Issues drafted from a finding, in the crew's language, and saved (there has been no Issues page since #75). The site report. The iPad P1–P4 shoot. README, deck and video. | Android Start AR and Walk inside (Quick Look) verified on a device; both stay behind `?xr=1`. Overlay accuracy measured on a device. Labelled real photos (#9). Voice question. BCF export. | Native apps, VR, user IFC upload, logins, offline mode, survey-grade accuracy claims |

## 6. Current state (18 Oct)

Submitted: the deployed service (https://truesite-1067044308557.asia-southeast1.run.app), the 3:15 demo video (https://youtu.be/M8zh02kMtk4), the deck (`docs/TrueSite-deck.pdf`) and this repository. The README has the current device status, accuracy and test results.

## 7. How we work

- **Branches, PRs and `make test`:** branch per issue, PR with `Closes #n`, merge when green. Never push to `main` directly.
- **One active builder at a time** on the same files, to avoid conflicts. Wai's Mac also runs the LAN phone-test servers and holds the gcloud setup.
- **Phone testing on the LAN:**
  - `make dev-server` (fake Gemini) and `cd web && npm run dev:https`
  - open `https://<lan-ip>:5173` on the phone and accept the certificate warning
  - `make sheets BASE_URL=https://<lan-ip>:5173` makes printable sheets for that address
- **Ground rules:** never commit secrets, never use pre-existing code, and never claim accuracy we haven't measured.
