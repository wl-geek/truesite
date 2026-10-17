# iPad AR filming: requirements for the building site demo

The demo uses the **camera overlay only**: scan an upright QR sheet, lock, then turn on the spot. Walk inside and Start AR are hidden; they come back with `?xr=1` on the page URL. The model is `site`: a two-storey building under construction, 18 × 12 m on 6 m bays, 3.9 m clear under the level 1 beams, ridge at about 10.5 m.

Files: the four sheets `site-P1.pdf` … `site-P4.pdf` (US Letter, 16 cm code), the layout plan `site-layout.pdf` (US Letter), all on the start page.

## 1. The holding attitude (required)

Sized for a filmer about **1.70 m (5'7")** tall, standing upright.

| What | Requirement | Why |
|---|---|---|
| Code centre height | **1.40 m** above the ground (± 2 cm) | Camera height of an iPad held upright at chest height by a 1.70 m adult. The model's ground is set 1.40 m below the code centre. |
| iPad pitch | **Upright, screen vertical** (± 5°). The code sits in the middle of the screen, top to bottom. | A head-on view at the same height as the code. Tilt up only after the lock. |
| iPad roll | **None**: the long edge level with the horizon | Roll blurs the code corners and slows the lock. |
| Orientation | **Landscape**, the same from calibration to the end of the take | Calibration is stored per orientation. Rotating restarts tracking. |
| Grip | Both hands, elbows against the ribs | Steady corners mean a steady model. |
| Lock distance | **0.6–0.8 m** from the code, **20–30° to one side** | A close, slightly oblique view is unambiguous: only then does the badge go to **Alignment: Good**. |
| Filming distance | Back on the **X, 1.5 m** in front of the code | Room to turn; the code still fills about 15% of the width. |

## 2. Before the shoot (once)

1. **Print** each P sheet on US Letter, **100% / Actual size** (not "Fit"), matte paper. Measure the **10 cm check bar**: it must read 10.0 cm (± 1 mm).
2. **Mount** each sheet flat on foam board or plywood, with no curl or wrinkles. Put it on a tripod, easel or stand, or tape it to a pole. Weigh it down against wind.
3. **Set out** with the layout plan:
   - Tape a cross at **O** (grid corner A1).
   - Run a long tape east along a straight line (a parking bay line works).
   - Square off with 3-4-5 (3 m along, 4 m up, 5 m diagonal).
   - Tape each code spot and its standing X.
   - Check the code-to-code tape distances on the plan (± 5 cm).
4. **Align each board:**
   - Code centre at **1.40 m**.
   - Board **vertical**: a phone level app on its edge reads 90° ± 1°.
   - Face **square to its grid axis**: the bottom edge sits on a 1 m tape line parallel to x (P1) or y (P2–P4). This matters most: 1° off swings the far end of the building about 20 cm.
5. **iPad settings:**
   - Safari, brightness at maximum, Low Power Mode off.
   - Auto-Lock: Never. Do Not Disturb on.
   - Close other camera apps.
   - Allow Camera and **Motion & Orientation** when Safari asks. Motion is what keeps the model level.
6. **Calibrate once** in good light, in landscape:
   1. Scan any P sheet and tap **Start camera**.
   2. Tap **Setup**, then Start, and tilt slowly around the code until it finishes.
   3. On "Check the print", enter the measured bar length. This is saved **per sheet**, so do the bar step on each of P1–P4 if their prints differ.
7. **URL:** use the deployed Cloud Run link, or the tunnel link with the Mac awake and online.

## 3. Each take (about 30 s per viewpoint)

1. Start the screen recording (Control Centre) before you scan.
2. Stand near the code, scan it, and tap **Start camera**.
3. **Lock:**
   - Hold the iPad upright at 0.6–0.8 m from the code, slightly to one side, code in the middle of the screen.
   - Hold still until the badge reads **Alignment: Good**: about 1–2 s.
4. Step back slowly onto the **X**, keeping the code in view. Pause 2 s.
5. Turn slowly on the spot (about 30° per second or slower), then tilt up to the trusses and back down.
   - **Don't walk**: the model is held by the motion sensors from where you locked.
6. Bring the code back into view to re-align at least every 60 s. Look-around stops after 90 s.
7. Nobody walks between the iPad and the code while it locks.

## 4. Light and site

- Daylight or overcast is best. Avoid direct sun glare on the sheet, a shadow across the code, and strong backlight (the sun behind the sheet).
- Only the four stands and the four X spots need to be clear. The model can overlap parked cars.
- The whole layout needs about 24 × 18 m including the outside viewpoints P1 and P4.

## 5. What each viewpoint shows

| Sheet | Stand at (x, y) | Look | Shows |
|---|---|---|---|
| P1 South approach | 9, −4 | north | The whole long side: concrete storey, edge protection, steel storey, trusses |
| P2 Inside, under the cast slab | 3, 3 | east | Concrete columns with their cages, beams and the slab overhead, the open bay ahead |
| P3 Inside, under the open bay | 15, 9 | west | The rebar mat at 4.3 m, and the steel and trusses through it |
| P4 East gable | 22, 6 | west | The truss profile, the end-bay bracing and the column lines |

## 6. If it looks wrong

| Symptom | Cause and fix |
|---|---|
| The model is too small or too big | Print not at 100%: measure the bar and enter it in Setup. Or calibration skipped: run Setup. |
| The model tilts or floats | Motion access denied: reload and allow it. Or the board leans: re-level it. |
| The model is rotated a few degrees | The board isn't square to its axis: re-align it with the tape line. |
| It never says Good | Too far or too head-on: lock at 0.6–0.8 m, slightly to one side. Or too dark or glare: move or shade the sheet. |
| The model drifts during look-around | Gyro drift: point back at the code to re-align. |
