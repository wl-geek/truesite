import { Color, Group, Mesh, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { decodeId, guidOf, idColor, IFC_GUID_RE, visibleFromIdBuffer } from './elements'

const GUID_WALL = '2O2Fr$t4X7Zf8NOew3FLOH'
const GUID_DOOR = '0K7w7JN$X5TfX$gBMMqb5_'

describe('guidOf', () => {
  it('walks up to the nearest ancestor named with a GUID, preferring the raw glTF name', () => {
    const door = new Group()
    door.name = `${GUID_DOOR}_1` // GLTFLoader de-duplicated the sanitised name...
    door.userData.name = GUID_DOOR // ...but keeps the raw glTF name here
    const leaf = new Mesh()
    leaf.name = 'doorMesh_1'
    door.add(leaf)
    expect(guidOf(leaf)).toBe(GUID_DOOR)
    expect(guidOf(leaf, new Set([GUID_DOOR]))).toBe(GUID_DOOR)
    expect(guidOf(leaf, new Set([GUID_WALL]))).toBeNull()
    expect(guidOf(new Object3D())).toBeNull()
    expect(guidOf(null)).toBeNull()
  })

  it('accepts exactly the 22-character IFC base-64 alphabet', () => {
    expect(IFC_GUID_RE.test(GUID_WALL)).toBe(true)
    expect(IFC_GUID_RE.test('2O2Fr$t4X7Zf8NOew3FLO')).toBe(false)
    expect(IFC_GUID_RE.test('2O2Fr$t4X7Zf8NOew3FLO-')).toBe(false)
  })
})

describe('ID buffer colours', () => {
  it('idColor stores exact byte fractions (linear); setHex would convert sRGB to linear', () => {
    for (const i of [0, 1, 254, 255, 256, 65535, 70000]) {
      const c = idColor(i)
      const bytes = [c.r, c.g, c.b].map((x) => x * 255)
      bytes.forEach((b) => expect(Math.abs(b - Math.round(b))).toBeLessThan(1e-9))
      expect(decodeId(Math.round(bytes[0]), Math.round(bytes[1]), Math.round(bytes[2]))).toBe(i)
    }
    expect(Math.round(new Color().setHex(0x000080).b * 255)).not.toBe(0x80)
    expect(decodeId(0, 0, 0)).toBe(-1) // background
  })

  it('visibleFromIdBuffer flips GL bottom-up rows and returns Gemini-style boxes', () => {
    const w = 10, h = 10
    const buf = new Uint8Array(w * h * 4)
    const paint = (index: number, rows: number[], cols: number[]) => {
      const c = idColor(index)
      for (const row of rows) for (const x of cols) {
        const o = (row * w + x) * 4
        buf[o] = Math.round(c.r * 255); buf[o + 1] = Math.round(c.g * 255); buf[o + 2] = Math.round(c.b * 255); buf[o + 3] = 255
      }
    }
    paint(4, [8, 9], [0, 1, 2]) // the TOP-LEFT 3x2 block of the image = GL rows 8..9
    paint(7, [0], [9]) // one pixel, bottom-right
    const all = visibleFromIdBuffer(buf, w, h, 0)
    expect(all.map((e) => e.index)).toEqual([4, 7]) // largest first
    expect(all[0]).toMatchObject({ pixels: 6, coverage: 0.06, box: [0, 0, 200, 300], centroid: { x: 1.5, y: 1 } })
    expect(all[1].box).toEqual([900, 900, 1000, 1000])
    expect(visibleFromIdBuffer(buf, w, h, 0.02).map((e) => e.index)).toEqual([4]) // 1% dropped
  })
})
