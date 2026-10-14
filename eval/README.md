# Evaluation (spec section 10): measured numbers only

## 1. Overlay accuracy at 1, 2 and 3 m
1. Put tape marks on the real features listed in `web/public/eval/points.json`. Each point is in IFC metres; edit the list when the real room model lands.
2. On the phone, open `/a/room1/A1?eval=1` (HTTPS) and start the camera. Green crosses appear at the points.
3. At 1, 2 and 3 m from the wall code, measure the on-screen offset between each cross and its tape mark, converted to millimetres on the wall (hold a ruler at the mark). Do 3 tries per distance.
4. Add one row per measurement to `overlay.csv`: `distance_m,point_id,offset_mm,try`.
5. Run `python3 eval/summarise.py overlay eval/overlay.csv` and paste the table into the README.

## 2. Check quality on labelled photos
1. Capture samples with `/a/room1/A1?dev=1` → **Save as sample** (issue #9), and commit them under `web/public/samples/`.
2. Fill `labels.json` with what each sample *should* report: `{"<sample_id>": {"<guid>": "missing" | "misplaced" | "different_from_design" | "present_ok"}}`. Use the staged deviations, and `present_ok` for everything else in view.
3. On the deployed app (real Gemini), open `/samples?dev=1` → **Run all samples → results.json**.
4. Run `python3 eval/summarise.py check eval/labels.json results.json` and paste the table into the README. Don't round anything up.
