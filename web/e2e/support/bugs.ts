/**
 * Bugs this suite found. Each has a test with this title that asserts the fixed behaviour: test.fixme while the bug
 * is open, test once the fix lands, so it guards the fix. As of 17 Oct 2026 all of these are fixed and their tests on.
 * Scans that would trip over an open bug (axe, tap targets) leave that one finding out and note the bug on the test.
 */
export const BUG = {
  orangeContrast: 'BUG: white text on the brand orange #ff6a13 has 2.86:1 contrast (finding mark numbers, live scale chip)',
  summaryTargets: "BUG: the findings toggles (Matches the design, Can't judge) are 20 px tall with no spacing (WCAG 2.5.8)",
  tipOverBrokenLink: 'BUG: on a laptop the device popup covers a broken live link and offers to hand it to a phone',
  dialogFocus: "BUG: the New issue and site report dialogs don't take focus and don't close on Escape",
  tipFocus: 'BUG: Tab and Shift+Tab leave the laptop popup for the page behind it',
  capCopy: "BUG: the daily-cap message sends people to 'the sample photos', also on that page (the app calls them ready-made views)",
  offlineReport: "BUG: with the offline stand-in, the site report still says 'Draft by Gemini'",
  viewerOverlap: 'BUG: in the 3D viewer, picking a finding opens the element panel over the findings and hides their Draft issue buttons',
  issueErrorCopy: "BUG: saving an issue past the hourly limit says 'Too many questions'; past the session cap it says 'try again'",
  coachBlocksDrag: 'BUG: in the virtual demo, a drag that starts on the coach card selects its text instead of turning the view',
  lookAroundLock: 'BUG: after a turn at the filming pace (30 degrees/s), look-around holds the model 1.3-2.8 degrees off: its lock pairs the smoothed QR pose with the newest motion sample',
  motionDenied: "BUG: with Motion & Orientation denied on an iPad, the live view never says that levelling and look-around are off",
} as const

/** axe findings that belong to a known bug: rule id plus a pattern on the node's selector. */
export const KNOWN_AXE: { rule: string; node: RegExp; bug: string }[] = []

/** Undersized tap targets that belong to a known bug (smallTapTargets output). */
export const KNOWN_SMALL_TARGETS: { target: RegExp; bug: string }[] = []
