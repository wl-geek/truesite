import { describe, expect, it } from 'vitest'
import type { Anchor, ProjectManifest } from '../api/types'
import { effectiveQrSize, findAnchor, isDeskAnchor, isFar, poseAnchor, toVideoPixels } from './arMath'

const A1: Anchor = { anchor_id: 'A1', project_id: 'room1', qr_size_m: 0.23, position_m: [0.1, 1.5, 1.35], normal: [1, 0, 0], up: [0, 0, 1], scale: 1, label: 'Wall' }
const D1: Anchor = { ...A1, anchor_id: 'D1', qr_size_m: 0.12, normal: [0, 0, 1], up: [0, 1, 0], scale: 0.05 }
const PROJECT: ProjectManifest = { project_id: 'room1', name: 'Demo room', model_url: '/m.glb', elements: [], anchors: [A1, D1] }

describe('arMath', () => {
  it('scales detector corners from the 640 px frame back to video pixels', () => {
    const c = toVideoPixels([{ x: 10, y: 20 }, { x: 640, y: 360 }], 640, 360, 1920, 1080)
    expect(c).toEqual([[30, 60], [1920, 1080]])
  })

  it('applies the print-scale correction to the printed size', () => {
    expect(effectiveQrSize(A1, 1)).toBe(0.23)
    expect(effectiveQrSize(D1, 0.95)).toBeCloseTo(0.114, 9)
  })

  it('maps the API anchor to the pose module anchor', () => {
    expect(poseAnchor(D1)).toEqual({ position_m: [0.1, 1.5, 1.35], normal: [0, 0, 1], up: [0, 1, 0], scale: 0.05 })
  })

  it('finds anchors and recognises desk anchors', () => {
    expect(findAnchor(PROJECT, 'D1')).toBe(D1)
    expect(findAnchor(PROJECT, 'Z9')).toBeNull()
    expect(isDeskAnchor(D1)).toBe(true)
    expect(isDeskAnchor(A1)).toBe(false)
  })

  it('warns beyond 3 m only', () => {
    expect(isFar(null)).toBe(false)
    expect(isFar(2.9)).toBe(false)
    expect(isFar(3.2)).toBe(true)
  })
})
