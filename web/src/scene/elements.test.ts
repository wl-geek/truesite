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
    expect(all[0]).toMatchObject({ pixels: 6, coverage: 0.06, box: [0, 0, 200, 300], centroid: { x: 1.5, y: 1 }, anchor: { x: 1.5, y: 1 } })
    expect(all[1].box).toEqual([900, 900, 1000, 1000])
    expect(visibleFromIdBuffer(buf, w, h, 0.02).map((e) => e.index)).toEqual([4]) // 1% dropped
  })
})

describe('mark anchors', () => {
  // A top-down test image: paint(index, x0, y0, x1, y1) fills an inclusive block in image rows (row 0 = top).
  function image(w: number, h: number) {
    const buf = new Uint8Array(w * h * 4)
    const paint = (index: number, x0: number, y0: number, x1: number, y1: number) => {
      const c = idColor(index)
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const o = ((h - 1 - y) * w + x) * 4 // GL rows are bottom-up
        buf[o] = Math.round(c.r * 255); buf[o + 1] = Math.round(c.g * 255); buf[o + 2] = Math.round(c.b * 255); buf[o + 3] = 255
      }
    }
    const idAt = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return -1
      const o = ((h - 1 - y) * w + x) * 4
      return decodeId(buf[o], buf[o + 1], buf[o + 2])
    }
    return { buf, paint, idAt }
  }

  /** The anchor pixel and every pixel within `r` of it belong to the element. */
  function wellInside(idAt: (x: number, y: number) => number, index: number, anchor: { x: number; y: number }, r: number) {
    const ax = Math.floor(anchor.x)
    const ay = Math.floor(anchor.y)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (idAt(ax + dx, ay + dy) !== index) return false
    return true
  }

  it("moves a U-shaped region's mark off the gap and away from its edges", () => {
    const { buf, paint, idAt } = image(24, 24)
    paint(3, 2, 2, 6, 21) // left arm, 5 px wide
    paint(3, 17, 2, 21, 21) // right arm
    paint(3, 2, 17, 21, 21) // bottom
    const [u] = visibleFromIdBuffer(buf, 24, 24, 0)
    expect(idAt(Math.floor(u.centroid.x), Math.floor(u.centroid.y))).toBe(-1) // the centroid is in the gap
    expect(wellInside(idAt, 3, u.anchor, 2)).toBe(true)
  })

  it('moves the mark of a region split by an occluder onto the region itself', () => {
    const { buf, paint, idAt } = image(30, 20)
    paint(1, 0, 4, 29, 15) // a beam across the frame
    paint(2, 11, 0, 18, 19) // a column in front of it, covering the middle
    const beam = visibleFromIdBuffer(buf, 30, 20, 0).find((v) => v.index === 1)!
    expect(idAt(Math.floor(beam.centroid.x), Math.floor(beam.centroid.y))).toBe(2) // the centroid is on the column
    expect(wellInside(idAt, 1, beam.anchor, 3)).toBe(true)
  })

  it("keeps the centroid when it is the element's own pixel", () => {
    const { buf, paint } = image(20, 20)
    paint(5, 4, 6, 13, 11)
    const [v] = visibleFromIdBuffer(buf, 20, 20, 0)
    expect(v.anchor).toEqual(v.centroid)
  })
})
