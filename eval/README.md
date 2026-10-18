# Evaluation (spec section 10): measured numbers only

## 0. Set out P1 first
The overlay can only be as right as the P1 stand. Set it out from `site-layout.pdf`: code centre at model (9, -2.5, 1.4) m, that is 9 m east of point O (grid corner A1) and 2.5 m south of grid line 1, 1.4 m above the ground, sheet upright and facing south. Then tape the points in `web/public/eval/points.json` on the ground, measured from point O (they are column corners on grid lines 1 and 2, in IFC metres).

Otherwise every offset below includes the error in where the stand is placed.

## 1. Overlay accuracy at 1, 2 and 3 m

**Status (17 Oct):** not measured on a device yet; `overlay.csv` has only its header. The Playwright `live-ar` tests in `web/e2e` compare the overlay with synthetic camera videos, which checks the code, not a real phone.

1. Tape the points listed in `web/public/eval/points.json` on the ground (§0). Each point is in IFC metres.
2. On the phone, open `/a/site/P1?eval=1` (HTTPS) and start the camera. Green crosses appear at the points.
3. At 1, 2 and 3 m from the code, measure the on-screen offset between each cross and its tape mark, converted to millimetres on the ground (lay a ruler at the mark). Do 3 tries per distance.
4. Add one row per measurement to `overlay.csv`: `distance_m,point_id,offset_mm,try`.
5. Run `python3 eval/summarise.py overlay eval/overlay.csv` and paste the table into the README.

## 2. Check quality on labelled photos

**The shipped samples are simulated.** The four committed samples (`site-p1-south`, `site-p2-slab`, `site-p3-openbay`, `site-p4-gable`) are renders of the site model's simulated as-built, made with `web/scripts/make-samples.mjs` and marked `"simulated": true`. They are not photos. Label them from `SITE_AS_BUILT` in `web/src/sim/asBuilt.ts`: a `missing` deviation becomes `missing`, and a `shifted` one becomes `misplaced`, together with the elements in its `alsoMoves` (Column cage B2, Column cage C1), which moved with it. Otherwise a correct finding on a moved cage would count as a false alarm, while §3's scorecard counts it as found. Everything else in view is `present_ok`. Any table made from them must be headed "simulated photos", in this README and in the main README, and kept apart from numbers measured on real photos.

To measure on real photos instead:

1. Capture samples with `/a/site/P1?dev=1` (or P2–P4) → **Save as sample** (issue #9). Each tap downloads `<sample_id>-photo.jpg` and `<sample_id>-meta.json`. Package each sample like this (contract section 8):
   - move the two files to `web/public/samples/<sample_id>/photo.jpg` and `web/public/samples/<sample_id>/meta.json`
   - add a row to `web/public/samples/index.json`: `{"sample_id": "<sample_id>", "label": "<what judges see>", "project_id": "site", "anchor_id": "P1"}` (the ids are in `meta.json`)
   - commit the folder and `index.json` together
2. Fill `labels.json` with what each sample *should* report: `{"<sample_id>": {"<guid>": "missing" | "misplaced" | "different_from_design" | "present_ok"}}`. Use the staged deviations, and `present_ok` for everything else in view. Any other status is rejected as a typo.
3. On the deployed app (real Gemini), open `/samples?dev=1` → **Run all samples → results.json**. Each run is also saved as that sample's fallback result for judges.
   - The deploy allows 30 checks per IP per hour (`CHECKS_PER_IP_PER_HOUR`, set by `make deploy`). With more than 30 samples, the rest fail with "Too many checks from this network". The page lists the samples that did not run. Keep the page open and tap **Run all** again after the hour: it runs only those and downloads one `results.json` with everything.
4. Run `python3 eval/summarise.py check eval/labels.json results.json` and paste the table into the README. Don't round anything up.
   - Samples with no result are counted as **Not run**, not as "can't judge", and are left out of the can't-judge share. The script then exits with code 1 and names them: run them again before you publish the table.

## 3. Virtual demo with live Gemini (simulated as-built, 17 Oct 2026)

**Simulated, not photos.** The virtual demo's *Check as-built* at each QR spot P1–P4 (1180 × 820 view, opening framing), on `gemini-3.8-flash` through Agent Platform. A planted defect counts as found when Gemini gives its element (or what moved with it) any deviation status. A false alarm is a deviation on an element we didn't change. In-view counts add up across spots: some defects show from two spots, 16 in all. One check costs about US$0.015 with IMAGE 3: about 6,900 input and 2,600 output tokens, from the usage logged on the deployed service. Without IMAGE 3 it was about US$0.011.

| Version | Found (of 16) | False alarms | Runs |
|---|---|---|---|
| Photo + design render (two images) | 8 | 5 | 1 |
| + IMAGE 3 outlines, 1 px gap | 10 | 7 | 1 |
| **+ IMAGE 3 outlines, 5 px gap (shipped)** | **12, 11, 7** | **5, 8, 0** | 3 (the third on the deployed service) |
| + size cut-off and a "can't judge thin members" prompt (dropped) | 9, 9 | 4, 5 | 2 |
| Closed outlines that cross neighbours (dropped) | 8 | 3 | 1 |
| Medium thinking instead of low (dropped) | 3 and 4 in the two views that finished | 1, 5 | 1 (about 65 s a check; most checks hit the 45 s limit twice and failed) |

**What works:**
- elements not built: an uncast column with only its cage, open-bay beams, a missing guardrail
- a column 60 cm off sideways, since IMAGE 3 shows it beside its outline

**What doesn't:**
- a 60 cm shift towards or away from the camera
- thin far members: purlins and truss diagonals
- a pad footing under a shifted column, which Gemini often says moved with it

Runs vary a lot, and P3 alone has gone from 0 to 3 of 4. Read single runs as rough: the shipped version averages about 10 of 16 found and 4 false alarms over 3 runs.
