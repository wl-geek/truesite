# Submission checklist (target Sat 17 Oct 2026; official deadline Sun 18 Oct)

## App
- [ ] The deployed Cloud Run URL works while signed out on iPhone Safari, Android Chrome and desktop Chrome.
- [ ] `/samples` runs at least 4 sample checks. Each sample falls back to its saved result if Gemini or the cap is unavailable.
- [ ] `/a/room1/D1` works with the printed A4 sheet at 1:20, and `/a/room1/A1` works in the room at 1:1.
- [ ] `make verify` passes: `/api/health` shows `gemini_mode: live` and `store_backend: gcp`, the start page's sheets are PDFs that link to the service URL, and one Ask round trip works.
- [ ] Daily caps are set for judging (`DAILY_CHECK_CAP=100`, `DAILY_ASK_CAP=300`). Budget alert is on. Consider `--min 1` during judging to avoid cold starts.

## Repository (public on submission day)
- [ ] `make test` is green.
- [ ] README has the live link and the measured numbers (overlay error at 1/2/3 m; check hits, misses, false alarms).
- [ ] No secrets or personal data. Check `git log -p | grep -i -E 'api[_-]?key|secret|token|password'`. `.env` stays ignored.
- [ ] Repository visibility switched to public.

## Video (strictly under 3:00, target 2:45, English)
1. The problem: field engineers build without the model in front of them.
2. Scan → the overlay at 1:1 in the room.
3. *Check as-built* catches the staged deviations. Say that they are staged.
4. Pins → Ask → Draft and save an issue.
5. Desk mode on the 1:20 physical model.
6. Measured accuracy (real numbers only).
7. Google Cloud architecture.

## Deck PDF
- [ ] The theme, verbatim, and the problem.
- [ ] Solution and demo screenshots.
- [ ] **Architecture** (the README diagram).
- [ ] **Business case:**
  - pricing per field seat or per project
  - value: less rework, faster inspections, fewer clarification requests
  - first markets: Singapore and Taiwan
- [ ] Measured numbers, each labelled as measured (simulation numbers labelled separately).
- [ ] Prior art (Dalux, Trimble SiteVision, GAMMA AR, XYZ Reality) and our difference.
- [ ] Team.
- [ ] Every statistic has a source, verified before it goes on a slide (spec §12): FMI/PlanGrid 2018, McKinsey 2017, and one JAPAC source.

## Hack2skill form
- [ ] Deployed URL, public GitHub URL, video link, deck PDF.
- [ ] Both members still eligible (not current students, 21+, JAPAC residents, on no other team).
- [ ] Screenshot of the submission confirmation.
