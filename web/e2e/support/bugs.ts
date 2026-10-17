/**
 * Bugs this suite found that are not fixed yet (17 Oct 2026). Each has a test.fixme with this title that asserts
 * the fixed behaviour: when a fix lands, change test.fixme to test and it guards the fix. Scans that would trip
 * over a known bug (axe, tap targets) leave that one finding out and note the bug on the test instead.
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
export const KNOWN_AXE: { rule: string; node: RegExp; bug: string }[] = [
  { rule: 'color-contrast', node: /\.mark-dot|\.mode-chip/, bug: BUG.orangeContrast },
  { rule: 'target-size', node: /summary$/, bug: BUG.summaryTargets },
]

/** Undersized tap targets that belong to a known bug (smallTapTargets output). */
export const KNOWN_SMALL_TARGETS: { target: RegExp; bug: string }[] = [
  { target: /^summary "(Matches the design|Can't judge) \(\d+\)"/, bug: BUG.summaryTargets },
]
