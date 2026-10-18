# Submission checklist (planning document, 16–17 Oct 2026)

> Status on 18 Oct: submitted with the deployed service, the 3:15 demo video (https://youtu.be/M8zh02kMtk4), the deck (`docs/TrueSite-deck.pdf`) and this repository. The boxes below are the plan as written before submission; the README has the current results.

## App
- [ ] The deployed Cloud Run URL works while signed out on iPhone Safari, Android Chrome and desktop Chrome.
- [ ] The virtual demo (`/samples?at=P1` to `P4`) runs a live check on a laptop and on the iPad.
- [ ] `/samples?photos` runs the four simulated site samples. Seed their saved results first: open `/samples?dev=1` on the deployed app once and tap **Run all samples**. Do it again after the final deploy, so the saved results match the photos re-rendered in #103. After that, each sample falls back to its saved result if Gemini or the cap is unavailable.
- [ ] `/a/site/D1` works with the printed US Letter desk sheet (the building at 1:100). `/a/site/P1` to `P4` work at 1:1 with the Letter sheets set out from `site-layout.pdf` ([iPad filming guide](demo/ipad-ar-filming.md)).
- [ ] `make verify` passes. It checks that `/api/health` shows `gemini_mode: live` and `store_backend: gcp`, and that the start page's sheets are PDFs linking to the service URL. It also checks the layout plan, `site.usdz` and the samples are served, and that one Ask round trip works.
- [ ] Caps for judging are set by `make deploy`: `DAILY_CHECK_CAP=300`, `DAILY_ASK_CAP=300`, `CHECKS_PER_IP_PER_HOUR=30`. The budget alert is on. Consider `--min 1` during judging to avoid cold starts.

## Repository (public on submission day)
- [ ] `make test` is green.
- [ ] README has the live link in its "Live demo" line. The check's found, missed and false-alarm numbers on the simulated as-built are in; the overlay error at 1/2/3 m stays "not measured" until it is measured on a device.
- [ ] No secrets or personal data. Check `git log -p | grep -i -E 'api[_-]?key|secret|token|password'`. `.env` stays ignored.
- [ ] Repository visibility switched to public.

## Video (3 to 4 minutes, English; ours is 3:15)
1. The problem: field engineers build without the model in front of them.
2. Scan P1–P4 on the car park with the iPad: the building at 1:1 in the camera overlay.
3. In the virtual demo, *Check as-built* catches the planted defects. Say that the defects are planted and the views are simulated.
4. Pins → Ask → Draft and save an issue; the day's site report.
5. The site D1 desk sheet: the building at 1:100.
6. Measured numbers only, labelled: the check results on the simulated as-built. No overlay accuracy figure until it is measured on a device.
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
