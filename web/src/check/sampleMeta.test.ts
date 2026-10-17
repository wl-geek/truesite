import { describe, expect, it } from 'vitest'
import { buildSampleMeta, parseSampleIndex, parseSampleMeta } from './sampleMeta'

const META = { sample_id: 'room1-door', project_id: 'room1', anchor_id: 'A1', label: 'Room — door wall', video_w: 1920, video_h: 1080,
  K: { f: 1500, cx: 960, cy: 540 }, pose: { R: [1, 0, 0, 0, -1, 0, 0, 0, -1], t: [0, 0, 1.5] }, captured_at: '2026-10-15T10:00:00Z' }

describe('sample metadata', () => {
  it('keeps valid index rows only', () => {
    const rows = parseSampleIndex([{ sample_id: 'room1-door', project_id: 'room1', anchor_id: 'A1', label: 'Door' },
      { sample_id: 'Bad Id', project_id: 'room1', anchor_id: 'A1' }, { sample_id: 'x', project_id: 'room1', anchor_id: 'A1' }, 'junk'])
    expect(rows.map((r) => r.sample_id)).toEqual(['room1-door', 'x'])
    expect(rows[1].label).toBe('x')
    expect(parseSampleIndex({})).toEqual([])
  })

  it('keeps the simulated flag and the staged list, text only', () => {
    const [row] = parseSampleIndex([{ sample_id: 'site-p1', project_id: 'site', anchor_id: 'P1', simulated: true,
      staged: ['Brace missing', 3, '', '<b>x</b>'] }])
    expect(row.simulated).toBe(true)
    expect(row.staged).toEqual(['Brace missing', '<b>x</b>']) // rendered as text by React, never as HTML
    expect(parseSampleIndex([{ sample_id: 'a', project_id: 'site', anchor_id: 'P1', simulated: 'yes' }])[0].simulated).toBeUndefined()
  })

  it('parses and validates meta.json', () => {
    expect(parseSampleMeta(META).pose.t).toEqual([0, 0, 1.5])
    expect(() => parseSampleMeta({ ...META, K: { f: -1, cx: 0, cy: 0 } })).toThrow(/intrinsics/)
    expect(() => parseSampleMeta({ ...META, pose: { R: [1, 0, 0], t: [0, 0, 1] } })).toThrow(/pose/)
    expect(() => parseSampleMeta({ ...META, pose: { ...META.pose, t: [0, 0, -1] } })).toThrow(/pose/)
    expect(() => parseSampleMeta({ ...META, video_w: 0 })).toThrow(/video/)
    expect(() => parseSampleMeta({ ...META, sample_id: '../x' })).toThrow(/ids/)
  })

  it('round-trips what Save as sample writes', () => {
    const m = buildSampleMeta({ sample_id: 'room1-door', project_id: 'room1', anchor_id: 'A1', label: 'Door' }, 1920, 1080,
      META.K, { R: META.pose.R, t: [0, 0, 1.5] }, new Date('2026-10-15T10:00:00Z'))
    expect(parseSampleMeta(JSON.parse(JSON.stringify(m)))).toEqual(m)
  })
})

describe('sample metadata (mutation-tested)', () => {
  const row = { sample_id: 'site-p1-south', project_id: 'site', anchor_id: 'P1', label: 'P1' }

  it('accepts ids only as a whole match (they end up in URLs)', () => {
    const bad = [
      { ...row, sample_id: 'site-p1/../x' }, { ...row, sample_id: 'site-p1?x' },
      { ...row, project_id: 'site/../x' }, { ...row, project_id: 'Xsite' }, { ...row, project_id: '-site' },
      { ...row, anchor_id: 'P1/../x' }, { ...row, anchor_id: '/P1' }, { ...row, anchor_id: 'P'.repeat(17) },
    ]
    expect(parseSampleIndex(bad)).toEqual([])
    expect(parseSampleIndex([row]).map((r) => r.sample_id)).toEqual(['site-p1-south'])
  })

  it('skips null, numbers and arrays in the index instead of throwing', () => {
    expect(parseSampleIndex([null, 7, [row], row]).map((r) => r.sample_id)).toEqual(['site-p1-south'])
    expect(() => parseSampleMeta(null)).toThrow(/ids/)
    expect(() => parseSampleMeta([META])).toThrow(/ids/)
  })

  it('keeps at most 12 staged lines, text only', () => {
    const staged = [...Array.from({ length: 14 }, (_, i) => `defect ${i}`), ['nested'], { length: 3 }]
    expect(parseSampleIndex([{ ...row, staged }])[0].staged).toEqual(Array.from({ length: 12 }, (_, i) => `defect ${i}`))
    expect(parseSampleIndex([{ ...row, staged: [['a'], { length: 2 }, 'ok'] }])[0].staged).toEqual(['ok'])
  })

  it('rejects zero or infinite sizes, a zero focal length, a code at the camera and a non-number in R', () => {
    expect(() => parseSampleMeta({ ...META, video_h: 0 })).toThrow(/video/)
    expect(() => parseSampleMeta({ ...META, video_w: Infinity })).toThrow(/video/)
    expect(() => parseSampleMeta({ ...META, video_h: '1080' })).toThrow(/video/)
    expect(() => parseSampleMeta({ ...META, K: { f: 0, cx: 960, cy: 540 } })).toThrow(/intrinsics/)
    expect(() => parseSampleMeta({ ...META, K: { f: 1500, cx: NaN, cy: 540 } })).toThrow(/intrinsics/)
    expect(() => parseSampleMeta({ ...META, K: [1500, 960, 540] })).toThrow(/intrinsics/)
    expect(() => parseSampleMeta({ ...META, pose: { ...META.pose, t: [0, 0, 0] } })).toThrow(/pose/)
    expect(() => parseSampleMeta({ ...META, pose: { ...META.pose, R: [1, 0, 0, 0, 1, 0, 0, 0, null] } })).toThrow(/pose/)
  })

  it('copies only the known fields and defaults a missing capture time', () => {
    const m = parseSampleMeta({ ...META, captured_at: 42, K: { ...META.K, extra: 1 } })
    expect(m.captured_at).toBe('')
    expect(m.K).toEqual({ f: 1500, cx: 960, cy: 540 })
  })
})
