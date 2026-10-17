import type { Page } from '@playwright/test'
import { BUG } from '../support/bugs'
import { enterVirtualSite, expectClean, expect, FEATURED, PLANTED_TOTAL, recordCheckUploads, runVirtualCheck, stubGeminiFindsPlanted, test, VIEWPOINTS } from '../support/fixtures'

/** The 3D view's pixels (an element screenshot also shows what lies over it, so the coach card is masked). */
const canvasShot = (page: Page) => page.locator('canvas.vs-canvas').screenshot({ mask: [page.locator('.vs-coach')] })

/** Drag across the view, in fractions of the canvas. */
async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await page.locator('canvas.vs-canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 })
  await page.mouse.up()
}

test.describe('virtual demo', () => {
  for (const v of VIEWPOINTS) {
    test(`${v.id}: intro, look around, design overlay, Check as-built with the offline stand-in`, async ({ page, log }) => {
      const uploads = await recordCheckUploads(page)
      await enterVirtualSite(page, v.id)
      await expect(page).toHaveTitle('Virtual demo · TrueSite')
      await expect(page.locator('.vs-chip')).toHaveText(`Virtual demo${v.id} · ${v.name}`)
      const coach = page.getByRole('note')
      await expect(coach).toContainText(`You're on the X at ${v.id}.`)
      await expect(coach).toContainText('drag, or use the arrow keys.')
      await expect(page.locator('canvas.vs-canvas')).toBeFocused() // arrow keys work straight away

      // Turn on the spot: the first key puts the coach away, the next ones turn the view.
      await page.keyboard.press('ArrowLeft')
      await expect(coach).toBeHidden()
      const before = await canvasShot(page)
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
      await expect.poll(async () => (await canvasShot(page)).equals(before)).toBe(false)
      for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight')

      const overlay = page.getByRole('button', { name: 'Design overlay' })
      await expect(overlay).toHaveAttribute('aria-pressed', 'false')
      await overlay.click()
      await expect(overlay).toHaveAttribute('aria-pressed', 'true')
      await overlay.click()

      const answer = page.waitForResponse((r) => r.url().endsWith('/api/check'))
      await runVirtualCheck(page, v.id)
      const response = await (await answer).json()
      expect(response).toMatchObject({ saved: true, photo_url: `/api/runs/${response.run_id}/photo.jpg`, result: { image_quality: 'good' } })
      const compared = response.result.findings.length as number
      // IMAGE 3 (#104): the photo with each marked element's design outline goes up with the photo and the render.
      const parts = await uploads()
      expect(parts.map((part) => part.name)).toEqual(['photo', 'render', 'overlay', 'context'])
      expect(parts.find((part) => part.name === 'overlay')).toMatchObject({ filename: 'overlay.jpg', type: 'image/jpeg', head: 'ffd8ff' })
      // Every planted defect this spot features has a numbered mark (#103), so Gemini is asked about it.
      const marked = (response.result.findings as { name: string }[]).map((f) => f.name)
      expect(marked).toEqual(expect.arrayContaining([...FEATURED[v.id]]))

      const results = page.getByRole('complementary', { name: 'Check results' })
      // Honest offline mode: the stand-in is never passed off as Gemini.
      await expect(results.locator('.vs-score-line')).toHaveText("Offline test mode: Gemini isn't connected on this server")
      await expect(results.locator('.vs-judged')).toHaveText(new RegExp(String.raw`^Checked by the offline stand-in \(not Gemini\) in \d+\.\d s · ${compared} elements compared · about US\$0\.000$`))
      await expect(results.getByRole('img', { name: /The BIM design render with numbered marks/ })).toBeVisible()
      await expect(results.getByRole('img', { name: 'Photo used for the as-built check' })).toBeVisible()
      for (const img of await results.locator('img').all()) {
        expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
      }
      const findings = results.getByRole('region', { name: 'As-built check results' })
      await expect(findings.locator('h2')).toHaveText(`0 possible deviations · ${compared} match · 0 can't judge`)
      await expect(findings).toContainText('Visual check, not a survey.')
      // Some planted defects are in this opening view, the rest are listed as not checked (C-24: not "elsewhere").
      const elsewhere = results.locator('details.vs-truth summary')
      await expect(elsewhere).toHaveText(/^Not checked in this view \(\d\)$/)
      expect(Number(/\((\d+)\)/.exec((await elsewhere.textContent())!)![1])).toBeLessThanOrEqual(PLANTED_TOTAL - FEATURED[v.id].length)

      await results.getByRole('button', { name: 'Back to the view' }).click()
      await expect(results).toBeHidden()
      await page.getByRole('button', { name: 'Show results' }).click()
      await expect(results).toBeVisible()

      await page.getByRole('button', { name: 'Exit' }).click()
      await expect(page).toHaveURL(/\/#virtual$/)
      expectClean(log)
    })
  }

  test('every planted defect in the opening view gets a numbered mark on a tablet and a phone @handheld', async ({ page, log }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop-chrome', 'the P1-P4 tests above check this on a laptop')
    const uploads = await recordCheckUploads(page)
    for (const v of VIEWPOINTS) {
      await enterVirtualSite(page, v.id)
      const answer = page.waitForResponse((r) => r.url().endsWith('/api/check'))
      await runVirtualCheck(page, v.id)
      const response = await answer
      const marked = ((await response.json()).result.findings as { name: string }[]).map((f) => f.name)
      expect.soft(marked, `numbered marks at ${v.id}`).toEqual(expect.arrayContaining([...FEATURED[v.id]]))
      expect.soft((await uploads()).map((part) => part.name), `IMAGE 3 sent at ${v.id}`).toContain('overlay')
    }
    expectClean(log)
  })

  test("Gemini's findings (stubbed): scorecard, Why it matters, Draft issue in Thai, save, site report", async ({ page, context, log }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const stub = await stubGeminiFindsPlanted(page)
    await enterVirtualSite(page, 'P1')
    const checked = page.waitForResponse((r) => r.url().endsWith('/api/check'))
    await runVirtualCheck(page, 'P1')
    const runId = (await (await checked).json()).run_id as string
    const results = page.getByRole('complementary', { name: 'Check results' })

    // Scorecard against the planted truth: every planted defect in view but one found, one missed.
    const found = stub.last().filter((f) => f.severity !== null).length
    expect(found).toBeGreaterThan(0)
    await expect(results.locator('.vs-score-line')).toHaveText(`Gemini found ${found} of ${found + 1} planted defects in this view · no false alarms`)
    await expect(results.locator('.vs-score-list li.hit')).toHaveCount(found)
    await expect(results.locator('.vs-score-list li.miss')).toHaveCount(1)
    await expect(results.locator('.vs-judged')).toHaveText(/^Checked by gemini-3\.8-flash in /)

    // Findings: deviations first, with Gemini's words and the fixed "Why it matters" rule.
    const deviations = results.getByRole('list', { name: 'Possible deviations' }).getByRole('listitem')
    await expect(deviations).toHaveCount(found)
    await expect(deviations.first()).toContainText('Gemini:')
    await expect(deviations.first()).toContainText('Why it matters:')
    await expect(results.locator('.evidence-box')).toHaveCount(found)

    // Draft an issue from the first finding, in Thai.
    await deviations.first().getByRole('button', { name: 'Draft issue' }).click()
    const dialog = page.getByRole('dialog', { name: 'New issue' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Title' })).not.toHaveValue('')
    const thai = page.waitForRequest((r) => r.url().endsWith('/api/issues/draft') && JSON.parse(r.postData() ?? '{}').language === 'th')
    await dialog.getByLabel(/Crew's language/).selectOption('th')
    expect(JSON.parse((await thai).postData()!)).toMatchObject({ run_id: runId, language: 'th' })
    await expect(dialog.getByRole('textbox', { name: 'Title' })).not.toHaveValue('')
    await expect(dialog.getByRole('textbox', { name: 'Description' })).toHaveValue(/Visual check, not a survey\./)
    await expect(dialog).toContainText('(set by TrueSite from the element type)')
    await dialog.getByRole('textbox', { name: 'Title' }).fill('ตรวจสอบเสา (e2e)')
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/issues') && r.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Save issue' }).click()
    const issue = await (await saved).json()
    expect((await saved).status()).toBe(201)
    expect(issue).toMatchObject({ project_id: 'site', run_id: runId, title: 'ตรวจสอบเสา (e2e)', photo_url: `/api/runs/${runId}/photo.jpg` })
    await expect(dialog).toBeHidden()
    await expect(results.getByRole('status').filter({ hasText: 'Issue saved.' })).toBeVisible()
    // Saved for this browser session (there is no Issues page: the API lists them).
    const listed = await page.evaluate(async () => {
      const r = await fetch('/api/issues?project_id=site', { headers: { 'X-Session-Id': localStorage.getItem('truesite.session')! } })
      return ((await r.json()).issues as { title: string }[]).map((i) => i.title)
    })
    expect(listed).toContain('ตรวจสอบเสา (e2e)')

    // The day's site report from this visit's check, then in Thai, then copied.
    await results.getByRole('button', { name: "Write today's site report" }).click()
    const report = page.getByRole('dialog', { name: /Site report|Today's site report/ })
    await expect(report).toBeVisible()
    await expect(report.locator('.report')).toContainText('Visual check, not a survey.')
    const thaiReport = page.waitForRequest((r) => r.url().endsWith('/api/report') && JSON.parse(r.postData() ?? '{}').language === 'th')
    await report.getByLabel('Language').selectOption('th')
    expect(JSON.parse((await thaiReport).postData()!)).toEqual({ run_ids: [runId], language: 'th' })
    await expect(report.locator('.report')).toBeVisible()
    await report.getByRole('button', { name: 'Copy the report' }).click()
    await expect(report.getByRole('button', { name: 'Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Visual check, not a survey.')
    await report.getByRole('button', { name: 'Close' }).first().click()
    await expect(report).toBeHidden()
    expectClean(log)
  })

  test("Gemini's words are shown as text, never as HTML", async ({ page }) => {
    await page.route('**/api/check', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      Object.assign(body.result.findings[0], { status: 'missing', severity: 'high', explanation: '<img src=x onerror="window.__xss=1">gone' })
      body.result.summary = '<b>bold</b><script>window.__xss=2</script>'
      body.result.unexpected = [{ description: '<img src=y onerror="window.__xss=3">a skip', evidence_box: [10, 10, 100, 100] }]
      await route.fulfill({ response, json: body })
    })
    await enterVirtualSite(page, 'P1')
    await runVirtualCheck(page, 'P1')
    const results = page.getByRole('complementary', { name: 'Check results' })
    await expect(results.locator('.findings-panel .summary')).toHaveText('<b>bold</b><script>window.__xss=2</script>')
    await expect(results.getByText('<img src=x onerror="window.__xss=1">gone')).toBeVisible()
    await expect(results.getByText('<img src=y onerror="window.__xss=3">a skip')).toBeVisible()
    await expect(page.locator('img[src="x"], img[src="y"], .findings-panel b, .findings-panel script')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  })

  test('a failed save keeps the draft open and says so', async ({ page }) => {
    await stubGeminiFindsPlanted(page)
    await enterVirtualSite(page, 'P2')
    await runVirtualCheck(page, 'P2')
    await page.route('**/api/issues', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 503, json: { detail: { code: 'busy' } } }) : r.continue()))
    await page.getByRole('button', { name: 'Draft issue' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New issue' })
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Keep me')
    await dialog.getByRole('button', { name: 'Save issue' }).click()
    await expect(dialog.getByRole('alert')).toHaveText("Couldn't save — try again.")
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Keep me')
  })

  test(BUG.issueErrorCopy, async ({ page }) => {
    await stubGeminiFindsPlanted(page)
    await enterVirtualSite(page, 'P2')
    await runVirtualCheck(page, 'P2')
    for (const detail of [{ code: 'rate_limited', retry_after_s: 600 }, { code: 'issue_cap' }]) {
      await page.unroute('**/api/issues')
      await page.route('**/api/issues', (r) => r.fulfill({ status: 429, json: { detail } }))
      await page.getByRole('button', { name: 'Draft issue' }).first().click()
      const dialog = page.getByRole('dialog', { name: 'New issue' })
      await dialog.getByRole('button', { name: 'Save issue' }).click()
      await expect(dialog.getByRole('alert')).not.toContainText('questions')
      await expect(dialog.getByRole('alert')).not.toHaveText("Couldn't save — try again.")
      await dialog.getByRole('button', { name: 'Cancel' }).click()
    }
  })

  test('two checks on one visit: the site report covers both', async ({ page }) => {
    await enterVirtualSite(page, 'P3')
    await runVirtualCheck(page, 'P3')
    await page.getByRole('button', { name: 'Back to the view' }).click()
    await page.locator('canvas.vs-canvas').focus()
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
    await runVirtualCheck(page, 'P3')
    await expect(page.locator('.vs-report')).toContainText('The offline stand-in writes the site report from your 2 checks at P3:')
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/report'))
    await page.getByRole('button', { name: "Write today's site report" }).click()
    expect(JSON.parse((await sent).postData()!).run_ids).toHaveLength(2)
    await expect(page.getByRole('dialog').locator('h2')).toHaveText('Site report: 0 items from 2 checks')
  })

  test("checks at two QR spots: the day's site report covers both (C-03)", async ({ page }) => {
    const runIds: string[] = []
    page.on('response', async (r) => {
      if (r.url().endsWith('/api/check') && r.ok()) runIds.push((await r.json()).run_id)
    })
    await enterVirtualSite(page, 'P1')
    await runVirtualCheck(page, 'P1')
    await page.getByRole('button', { name: 'Exit' }).click()
    await expect(page).toHaveURL(/\/#virtual$/)
    await page.locator('#virtual .vp-card', { hasText: VIEWPOINTS[1].name }).click()
    await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible({ timeout: 60_000 })
    await runVirtualCheck(page, 'P2')
    await expect(page.locator('.vs-report')).toContainText('writes the site report from your 2 checks at P1 and P2:')
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/report'))
    await page.getByRole('button', { name: "Write today's site report" }).click()
    await expect.poll(() => runIds.length).toBe(2)
    expect(JSON.parse((await sent).postData()!).run_ids).toEqual(runIds)
    await expect(page.getByRole('dialog').locator('h2')).toHaveText('Site report: 0 items from 2 checks')
  })

  test(BUG.offlineReport, async ({ page }) => {
    await enterVirtualSite(page, 'P1')
    await runVirtualCheck(page, 'P1')
    await expect(page.locator('.vs-score-line')).toHaveText("Offline test mode: Gemini isn't connected on this server")
    await page.getByRole('button', { name: "Write today's site report" }).click()
    const report = page.getByRole('dialog')
    await expect(report.locator('.report')).toBeVisible()
    await expect(report).not.toContainText('Gemini')
  })

  test('dragging turns the view @handheld', async ({ page }) => {
    await enterVirtualSite(page, 'P2')
    await drag(page, [0.12, 0.25], [0.18, 0.26]) // beside the coach card, which sits in the middle of the view
    await expect(page.getByRole('note')).toBeHidden()
    const before = await canvasShot(page)
    await drag(page, [0.12, 0.25], [0.4, 0.3])
    await expect.poll(async () => (await canvasShot(page)).equals(before)).toBe(false)
  })

  test(BUG.coachBlocksDrag, async ({ page }) => {
    await enterVirtualSite(page, 'P2')
    const card = (await page.getByRole('note').boundingBox())!
    await page.mouse.move(card.x + card.width * 0.7, card.y + card.height * 0.3) // the middle of the view, where a first drag starts
    await page.mouse.down()
    await page.mouse.move(card.x + card.width * 0.1, card.y + card.height * 0.4, { steps: 8 })
    await page.mouse.up()
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('')
    await expect(page.getByRole('note')).toBeHidden() // the canvas took the drag
  })

  test('on a tablet the coach offers Turn with device @handheld', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touch devices only')
    await enterVirtualSite(page, 'P1')
    await expect(page.getByRole('note')).toContainText('drag, or tap Turn with device and turn the iPad.')
    await expect(page.getByRole('button', { name: 'Turn with device' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('ten visits in one tab keep WebGL alive: each exit releases its contexts', async ({ page }) => {
    test.slow()
    const lost: string[] = []
    page.on('console', (m) => { if (/too many active webgl contexts|context lost/i.test(m.text())) lost.push(m.text()) })
    await page.goto('/#virtual')
    for (let i = 0; i < 10; i++) {
      const v = VIEWPOINTS[i % VIEWPOINTS.length]
      await page.locator('#virtual .vp-card', { hasText: v.name }).click() // in-app navigation: one document throughout
      await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible({ timeout: 60_000 })
      await page.getByRole('button', { name: 'Exit' }).click()
      await expect(page).toHaveURL(/\/#virtual$/)
    }
    await page.locator('#virtual .vp-card', { hasText: 'South approach' }).click()
    await runVirtualCheck(page, 'P1')
    await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0)
    expect(lost).toEqual([])
  })

  test('/samples on its own goes to the virtual demo section of the start page', async ({ page }) => {
    await page.goto('/samples')
    await expect(page).toHaveURL(/\/#virtual$/)
    await expect(page.getByRole('heading', { name: 'Try the idea in a virtual demo' })).toBeInViewport()
  })

  test('the /samples redirect and Exit replace their history entry: Back never bounces or re-opens the spot (C-27)', async ({ page }) => {
    await page.goto('/')
    const start = await page.evaluate(() => history.length)
    await page.goto('/samples')
    await expect(page).toHaveURL(/\/#virtual$/)
    expect(await page.evaluate(() => history.length)).toBe(start + 1) // /samples became /#virtual: no entry of its own
    await page.locator('#virtual .vp-card', { hasText: VIEWPOINTS[0].name }).click()
    await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Exit' }).click()
    await expect(page).toHaveURL(/\/#virtual$/)
    expect(await page.evaluate(() => history.length)).toBe(start + 2) // the spot became /#virtual too
    await page.goBack()
    await expect(page).toHaveURL(/\/#virtual$/)
    await expect(page.getByRole('application')).toHaveCount(0)
  })
})

test.describe('virtual demo: when the check cannot run', () => {
  /** A Gemini usage limit also opens the popup with a countdown over the page (#117); other failures don't. */
  type Limit = { title: string; wait: string; left: RegExp }
  const cases: { name: string; status: number; body: object | null; headers: Record<string, string>; text: string; limit?: Limit }[] = [
    { name: 'Gemini busy (503)', status: 503, body: { detail: { code: 'model_unavailable' } }, headers: { 'Retry-After': '5' },
      text: 'Gemini is busy right now. Try again in a minute.' },
    { name: 'per-IP limit (429)', status: 429, body: { detail: { code: 'rate_limited', retry_after_s: 1500 } }, headers: { 'Retry-After': '1500' },
      text: 'Too many checks from this network. Try again in about 25 min.',
      limit: { title: 'This network has used its Gemini checks for now', wait: 'Gemini is back for this network in', left: /^2[45]:\d\d$/ } },
    { name: 'daily cap (429)', status: 429, body: { detail: { code: 'daily_cap' } }, headers: {},
      text: "Today's free Gemini use is used up. Try the ready-made views (saved results), or come back tomorrow.",
      limit: { title: "Today's free Gemini use is used up", wait: 'Gemini is back in', left: /^(\d{1,2}:)?\d{1,2}:\d\d$/ } }, // to 00:00 UTC
    { name: "Google's quota (429)", status: 429, body: { detail: { code: 'model_quota', retry_after_s: 30 } }, headers: { 'Retry-After': '30' },
      text: "Gemini's usage limit is reached. Try again in about 1 min.",
      limit: { title: "Gemini's usage limit is reached", wait: 'Try again in', left: /^0:[0-3]\d$/ } },
    { name: 'photo blocked (422)', status: 422, body: { detail: { code: 'model_blocked' } }, headers: {},
      text: "This photo couldn't be checked. Try a different view." },
    { name: 'a proxy error page (502)', status: 502, body: null, headers: {}, text: 'Check failed. Try again.' },
  ]
  for (const c of cases) {
    test(`${c.name}: says so and offers a ready-made view`, async ({ page }) => {
      await page.route('**/api/check', (route) => route.fulfill(c.body
        ? { status: c.status, json: c.body, headers: c.headers }
        : { status: c.status, body: '<html>Bad gateway</html>', contentType: 'text/html' }))
      await enterVirtualSite(page, 'P4')
      await page.getByRole('button', { name: 'Check as-built' }).click()
      await expect(page.locator('.vs-notice')).toHaveText(c.text)
      if (c.limit) {
        const popup = page.getByRole('dialog', { name: c.limit.title })
        await expect(popup).toHaveAttribute('aria-modal', 'true')
        await expect(popup.locator('.ld-kicker')).toHaveText('Usage limit · not an error')
        await expect(popup.getByRole('timer')).toContainText(c.limit.wait)
        await expect(popup.getByRole('timer').locator('strong')).toHaveText(c.limit.left)
        await expect(popup.getByRole('button', { name: 'Open the ready-made views' })).toBeVisible()
        await expect(popup.getByRole('button', { name: 'Close' })).toBeFocused()
        await popup.getByRole('button', { name: 'Close' }).click()
        await expect(popup).toBeHidden()
      } else {
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
      await expect(page.getByRole('link', { name: 'Use a ready-made view instead' })).toHaveAttribute('href', '/samples?photos')
      await expect(page.getByRole('button', { name: 'Check as-built' })).toBeEnabled()
    })
  }

  // Open: LimitDialog focuses Close and handles Escape itself instead of using useModal, so Tab goes to the page.
  test.fixme(BUG.limitFocus, async ({ page }) => {
    await page.route('**/api/check', (route) => route.fulfill({ status: 429, json: { detail: { code: 'rate_limited', retry_after_s: 1500 } } }))
    await enterVirtualSite(page, 'P4')
    await page.getByRole('button', { name: 'Check as-built' }).click()
    const popup = page.getByRole('dialog', { name: 'This network has used its Gemini checks for now' })
    await expect(popup.getByRole('button', { name: 'Close' })).toBeFocused()
    for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)
      expect(await popup.evaluate((d) => d.contains(document.activeElement)), `focus inside the popup after ${key}`).toBe(true)
    }
  })

  test('no connection: says so', async ({ page }) => {
    await page.route('**/api/check', (route) => route.abort('internetdisconnected'))
    await enterVirtualSite(page, 'P4')
    await page.getByRole('button', { name: 'Check as-built' }).click()
    await expect(page.locator('.vs-notice')).toHaveText('No connection. Check your network and try again.')
  })
})
