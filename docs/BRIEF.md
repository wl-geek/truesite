# TrueSite — Brief for anyone joining the build

Read this first, then `DEVELOPMENT.md` (how to work), the [design spec](specs/2026-10-11-truesite-design.md) (the detailed PRD) and the [interface contract](plans/2026-10-11-truesite-contract.md) (binding names, schemas, versions).

## 1. The competition

**Event:** Google Cloud AI Builder Cup 2026 (JAPAC, run by Hack2skill).
- **Theme:** *Future of Work & Enterprise Productivity*. It asks for solutions that "transform how individuals and organizations access knowledge, collaborate, make decisions, and complete everyday work".
- **Team:** Wai and Michael (Aung Nyein Chan, an architect).
- **Deadline:** we submit **Sat 17 Oct 2026**; the official deadline is Sun 18 Oct.

**Scoring.** The Terms prevail over the website:

| Criterion | Weight | What it covers |
|---|---|---|
| Technical Merit & GenAI | 40% | Robustness, Google Cloud architectural depth, technical execution |
| Problem Alignment & Impact | 25% | Clarity of problem-solution fit and measurable real-world viability |
| Innovation & Creativity | 25% | Originality and inventiveness of the approach |
| UX | 10% | Quality, intuitiveness, clean design |

**Deliverables:**
- a working URL **deployed on Google Cloud** (Cloud Run)
- a video **strictly under 3:00**
- a **public GitHub repo**
- a **deck PDF covering the solution architecture and the business case**

**Rules that bite:**
- Only **fresh code and assets made during the event** count. No NexusBIM (Wai's earlier product) or any pre-existing code, prompts or data.
- The organiser gets a 6-month right of first refusal on *exclusive* licences of what we submit.

## 2. The product

**One line:** point a phone at a QR code on site and the BIM model appears over the real place at true scale. Tap *Check as-built*: Gemini compares what's built with the design, the deviations are pinned on the model, and the issue is drafted.

**Who it's for:** field engineers, foremen and site architects (buyers: contractors).

**The problem:** people build without the model in front of them, and mistakes surface as rework weeks later.

**What we sell beyond the incumbents** (Dalux, Trimble Connect AR, GAMMA AR, XYZ Reality). They all do marker placement plus visualisation. Our edge:
1. **The Gemini as-built check:** photo plus design render with numbered marks → structured findings → severity set by code → pins plus evidence boxes.
2. **Grounded Ask:** answers come only from the element's own IFC properties, with the fields cited.
3. **Issues drafted by Gemini** and saved by a person.
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
- **Android (Chrome, ARCore): "Start AR (place by code)".** WebXR `camera-access` frames go to our zxing worker and pose maths. A progress ring fills as you move left and right. Estimates are fused across angles, then the model is **world-locked**.
- **Controls:** Transparency, **Cut above** (section height) and **Layers** (structure, rebar, doors/windows/services, other).
- **iPhone (no WebXR in Safari):**
  - the QR camera overlay, with **look-around** (gyroscope holds the model when you turn on the spot)
  - **Walk inside** → AR Quick Look with a USDZ exported in the browser (unverified on device)

## 4. Demo plan

1. **Hero shot (the video's opening): the rooftop of Wai's condo, 40th floor, clear sky, about 100 m² clear.**
   - Project `rooftop`: a 9 × 9 m, two-storey concrete frame (32 columns, 48 beams, 80 rebar cages with starter bars) at 1:1.
   - The US Letter sheet **R1** (16 cm code) lies at the centre of the middle bay; **R2** is a spare.
   - Scan R1 → Start camera (the camera overlay, on Android and iPhone) → start within 1 m, step back → the frame stands around the sheet, and you turn on the spot and look up. Start AR (world-locked, walk under it) stays hidden behind `?xr=1` and is untested on a device.
   - **iPad building site (Michael, open car park):** project `site`, a two-storey building under construction (18 × 12 m, 6 m bays, 3.9 m clear in the ground storey, ridge about 10.5 m), colour-coded by type like the video. Four upright US Letter sheets P1–P4 set out with `site-layout.pdf`. At each one: lock 0.7 m from the code, step back to the X 1.5 m away, turn on the spot. Camera overlay only, levelled by the motion sensors. Walk inside and Start AR are hidden (`?xr=1` brings them back). Checklist: `docs/demo/ipad-ar-filming.md`.
2. **The AI moment.** Boxes or cones stand where 3–4 columns go, **one about 40 cm off and one missing**. *Check as-built* finds "Column … misplaced, about 40 cm" and "Column … missing". This is a setting-out check, a real site task.
3. **Judges without a site:**
   - `/samples` runs the real check on stored photos
   - the US Letter **desk sheet D1** shows the room at 1:20
   - the US Letter **floor sheet L1** shows the demo room at 1:1 around you
4. **Also in the video:** Ask on an element, a drafted issue, the measured accuracy, and the Google Cloud architecture.

## 5. Prototype scope (what "done" means by Sat 17 Oct)

| Must work | Nice | Out |
|---|---|---|
| Deployed Cloud Run URL. Samples check with real Gemini. Live AR on Android and iPhone (camera overlay). As-built check from the live view. Ask. Issues. Rooftop hero demo. Desk sheet. README, deck and video. | Android Start AR (place by code, world-locked, behind `?xr=1`) verified on a device, with a check inside it. iPhone Quick Look walk-in verified. Measured accuracy numbers. Voice question. BCF export. | Native apps, VR, user IFC upload, logins, offline mode, survey-grade accuracy claims |

## 6. Current state (16 Oct)

- **Built and merged:**
  - everything in the spec's core, plus the extras above
  - the `site` building under construction with four iPad viewpoints (P1–P4)
  - colour by element type
  - the fixes from the 15 Oct audit: every high and medium finding is fixed (`docs/audit-2026-10-15.md`)
- **Tests:** all green with `make test`: BIM 110, server about 410, web about 300.
- **Phone-tested on Android over the LAN:**
  - desk sheet D1 overlay ✓
  - live *Check as-built* call ✓
  - QR scan ✓
  - **Not yet confirmed on a device:** the redesigned place-by-code AR (level, on the ground, world-locked), the iPad Quick Look walk-in, and look-around on iPhone. The audit doc lists the exact checks.
- **Gemini:**
  - The real client is tested with mocks. The free-tier key works but was overloaded (503) on 14 Oct. Paid access is pending the Cloud billing.
  - The rooftop setting-out prompt (`check_note`) needs one live call before the shoot.
- **Google Cloud:**
  - Project `truesite-hack-2026` exists, owned by Wai's Gmail. **Billing is not linked yet:** Michael's free-trial billing account will be linked. Nothing is deployed yet.
  - `make setup` / `make deploy` / `make verify` are ready: daily caps of 300 checks and 300 asks (30 checks per IP per hour); the deploy renders the QR sheets for the service URL; `make verify` ends with `SMOKE OK`.
- **Open work:** see GitHub Issues. Human-only items:
  - deploy and billing (#1)
  - device runs (#33, #35)
  - samples (#9)
  - measurements (#13)
  - video and deck (#15)

## 7. How we work

- **Branches, PRs and `make test`:** branch per issue, PR with `Closes #n`, merge when green. Never push to `main` directly.
- **One active builder at a time** on the same files, to avoid conflicts. Wai's Mac also runs the LAN phone-test servers and holds the gcloud setup.
- **Phone testing on the LAN:**
  - `make dev-server` (fake Gemini) and `cd web && npm run dev:https`
  - open `https://<lan-ip>:5173` on the phone and accept the certificate warning
  - `make sheets BASE_URL=https://<lan-ip>:5173` makes printable sheets for that address
- **Speed over ceremony:** Wai wants decisions made and work done without routine permission questions. Still never commit secrets, never use pre-existing code, and never claim accuracy we haven't measured.
