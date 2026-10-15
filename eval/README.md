# Evaluation (spec section 10): measured numbers only

## 1. Overlay accuracy at 1, 2 and 3 m
1. Put tape marks on the real features listed in `web/public/eval/points.json`. Each point is in IFC metres; edit the list when the real room model lands.
2. On the phone, open `/a/room1/A1?eval=1` (HTTPS) and start the camera. Green crosses appear at the points.
3. At 1, 2 and 3 m from the wall code, measure the on-screen offset between each cross and its tape mark, converted to millimetres on the wall (hold a ruler at the mark). Do 3 tries per distance.
4. Add one row per measurement to `overlay.csv`: `distance_m,point_id,offset_mm,try`.
5. Run `python3 eval/summarise.py overlay eval/overlay.csv` and paste the table into the README.

## 2. Check quality on labelled photos
1. Capture samples with `/a/room1/A1?dev=1` → **Save as sample** (issue #9). Each tap downloads `<sample_id>-photo.jpg` and `<sample_id>-meta.json`. Package each sample like this (contract section 8):
   - move the two files to `web/public/samples/<sample_id>/photo.jpg` and `web/public/samples/<sample_id>/meta.json`
   - add a row to `web/public/samples/index.json`: `{"sample_id": "<sample_id>", "label": "<what judges see>", "project_id": "room1", "anchor_id": "A1"}` (the ids are in `meta.json`)
   - commit the folder and `index.json` together
2. Fill `labels.json` with what each sample *should* report: `{"<sample_id>": {"<guid>": "missing" | "misplaced" | "different_from_design" | "present_ok"}}`. Use the staged deviations, and `present_ok` for everything else in view. Any other status is rejected as a typo.
3. On the deployed app (real Gemini), open `/samples?dev=1` → **Run all samples → results.json**. Each run is also saved as that sample's fallback result for judges.
   - The deploy allows 10 checks per IP per hour (`CHECKS_PER_IP_PER_HOUR`). With more than 10 samples, the rest fail with "Too many checks from this network". The page lists the samples that did not run. Keep the page open and tap **Run all** again after the hour: it runs only those and downloads one `results.json` with everything.
4. Run `python3 eval/summarise.py check eval/labels.json results.json` and paste the table into the README. Don't round anything up.
   - Samples with no result are counted as **Not run**, not as "can't judge", and are left out of the can't-judge share. The script then exits with code 1 and names them: run them again before you publish the table.
