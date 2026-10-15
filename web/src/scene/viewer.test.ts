import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { buildLoadedModel } from './loadModel'
import { KIND_COLOURS, type Paint } from './palette'
import { applyTypeColours, frameDistance, isTap, pointerToNdc } from './viewer'

describe('viewer pointer helpers', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 }

  it('maps client pixels to normalised device coordinates (y up)', () => {
    expect(pointerToNdc(100, 50, rect)).toEqual({ x: -1, y: 1 })
    expect(pointerToNdc(500, 250, rect)).toEqual({ x: 1, y: -1 })
    expect(pointerToNdc(300, 150, rect)).toEqual({ x: 0, y: 0 })
  })

  it('treats short, still presses as taps and drags as orbiting', () => {
    expect(isTap({ x: 10, y: 10, t: 0 }, { x: 13, y: 14, t: 200 })).toBe(true)
    expect(isTap({ x: 10, y: 10, t: 0 }, { x: 30, y: 10, t: 200 })).toBe(false)
    expect(isTap({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 900 })).toBe(false)
  })
})

describe('frameDistance', () => {
  const rad = (deg: number) => (deg * Math.PI) / 180

  it('fits the vertical field of view on a landscape screen', () => {
    expect(frameDistance(2, 50, 16 / 9)).toBeCloseTo(2 / Math.sin(rad(25)), 9)
  })

  it('backs off on a portrait phone so the model fits the narrower horizontal view', () => {
    const portrait = frameDistance(2, 50, 9 / 19.5)
    expect(portrait).toBeGreaterThan(frameDistance(2, 50, 16 / 9))
    const hfov = 2 * Math.atan(Math.tan(rad(25)) * (9 / 19.5))
    expect(2 / portrait).toBeCloseTo(Math.sin(hfov / 2), 9) // the sphere just touches the left and right edges
  })
})

describe('viewer colours', () => {
  it('paints each element by type, see-through concrete, and restores the glb materials', () => {
    const g = new Group()
    const original = new MeshBasicMaterial()
    const names = ['C'.repeat(22), 'F'.repeat(22), 'X'.repeat(22)]
    for (const name of names) {
      const m = new Mesh(new BoxGeometry(1, 1, 1), original)
      m.name = name
      g.add(m)
    }
    const model = buildLoadedModel(g, new Set(names))
    const paint: Record<string, Paint> = { [names[0]]: { kind: 'column', solid: true }, [names[1]]: { kind: 'concrete', solid: false } }
    const restore = applyTypeColours(model, (guid) => paint[guid])
    const [col, pad, unknown] = model.meshes.map((m) => m.material as MeshStandardMaterial)
    expect(col.color.getHex()).toBe(KIND_COLOURS.column)
    expect(col.transparent).toBe(false)
    expect(pad.color.getHex()).toBe(KIND_COLOURS.concrete)
    expect(pad.transparent && pad.opacity).toBe(0.45)
    expect(unknown).toBe(original) // no element row: left as the glb has it
    restore()
    expect(model.meshes.every((m) => m.material === original)).toBe(true)
  })
})
