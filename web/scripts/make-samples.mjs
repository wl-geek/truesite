// Renders the simulated sample photos into public/samples (photo.jpg + meta.json per sample, plus index.json).
//   npm run dev:https            (the studio page and /api must be up on https://localhost:5173)
//   node scripts/make-samples.mjs [https://localhost:5173]
// Each sample is one page of sample-studio.html?id=<sample_id> (src/dev/sampleStudio.ts) in headless Chrome, which
// leaves { meta, photo } as JSON in the DOM. Simulated photos are labelled as such in index.json and meta.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const base = process.argv[2] ?? 'https://localhost:5173'
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const root = new URL('..', import.meta.url).pathname
const specs = JSON.parse(readFileSync(join(root, 'scripts/sample-specs.json'), 'utf8'))
const outDir = join(root, 'public/samples')
/** Compass word for a plan offset (IFC x east, y north), e.g. [0.45, 0, 0] -> "east". */
function direction([dx, dy, dz]) {
  if (Math.abs(dz) > Math.hypot(dx, dy)) return dz > 0 ? 'above' : 'below'
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'north' : 'south')
}

const browser = await puppeteer.launch({
  executablePath: chrome, headless: true, acceptInsecureCerts: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors'],
})

const index = []
for (const spec of specs) {
  const page = await browser.newPage()
  await page.goto(`${base}/sample-studio.html?id=${spec.sample_id}`)
  const done = await page.waitForSelector('#sample-out, #sample-error', { timeout: 180000 })
  const text = await done.evaluate((el) => el.textContent ?? '')
  if (await done.evaluate((el) => el.id === 'sample-error')) throw new Error(`${spec.sample_id}: ${text}`)
  await page.close()
  const { meta, photo } = JSON.parse(text)
  const dir = join(outDir, spec.sample_id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'photo.jpg'), Buffer.from(photo.replace(/^data:image\/jpeg;base64,/, ''), 'base64'))
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  const staged = [
    ...spec.hidden.map((n) => `${n}: missing`),
    ...spec.shifted.map((s) => `${s.name}: about ${Math.round(Math.hypot(...s.d) * 100)} cm ${direction(s.d)} of the design`),
  ]
  index.push({ sample_id: meta.sample_id, label: meta.label, project_id: meta.project_id, anchor_id: meta.anchor_id, simulated: true, staged })
  console.log(`${spec.sample_id}: ${Math.round(photo.length * 0.75 / 1024)} KB`)
}
await browser.close()
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`wrote ${index.length} samples to ${outDir}`)
