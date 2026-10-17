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

describe('elements (mutation-tested)', () => {
  it('accepts a GUID only as the whole name', () => {
    expect(IFC_GUID_RE.test(`x${GUID_WALL}`)).toBe(false)
    expect(IFC_GUID_RE.test(`${GUID_WALL}x`)).toBe(false)
    // GLTFLoader's de-duplicated name is GUID + "_1": still base-64 characters, but not a GUID
    const node = new Object3D()
    node.name = `${GUID_DOOR}_1`
    expect(guidOf(node)).toBeNull()
  })

  /** A top-down test image (row 0 = top) stored GL-style, bottom row first. */
  function image(w: number, h: number) {
    const buf = new Uint8Array(w * h * 4)
    const ids = new Int32Array(w * h).fill(-1)
    const set = (index: number, x: number, y: number) => {
      const c = idColor(index)
      const o = ((h - 1 - y) * w + x) * 4
      buf[o] = Math.round(c.r * 255); buf[o + 1] = Math.round(c.g * 255); buf[o + 2] = Math.round(c.b * 255); buf[o + 3] = 255
      ids[y * w + x] = index
    }
    const paint = (index: number, x0: number, y0: number, x1: number, y1: number) => {
      for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) set(index, x, y)
    }
    return { buf, ids, set, paint }
  }

  it('reports element 0 (ID colour 0, 0, 1), which is not the background', () => {
    const { buf, paint } = image(4, 4)
    paint(0, 0, 0, 1, 1)
    const [v] = visibleFromIdBuffer(buf, 4, 4, 0)
    expect(v).toMatchObject({ index: 0, pixels: 4, box: [0, 0, 500, 500] })
  })

  it('boxes an L-shaped region whose top row is the narrowest', () => {
    const { buf, paint } = image(10, 10)
    paint(2, 1, 1, 2, 8) // the upright of the L, top at row 1
    paint(2, 1, 7, 8, 8) // the foot reaches column 8
    const [v] = visibleFromIdBuffer(buf, 10, 10, 0)
    expect(v.box).toEqual([100, 100, 900, 900])
  })

  it('keeps a region whose share of the frame equals the minimum exactly', () => {
    const { buf, paint } = image(10, 10)
    paint(1, 0, 0, 0, 0) // 1 % of the frame
    expect(visibleFromIdBuffer(buf, 10, 10, 0.01)).toHaveLength(1)
    expect(visibleFromIdBuffer(buf, 10, 10, 0.0101)).toHaveLength(0)
  })

  it("keeps the centroid when it is the element's own pixel, even on the region's edge", () => {
    const { buf, paint, ids } = image(20, 20)
    paint(6, 9, 2, 12, 17) // a thick upright...
    paint(6, 13, 9, 13, 10) // ...with a small tab on its right: the centroid lands on its left edge column
    const [v] = visibleFromIdBuffer(buf, 20, 20, 0)
    const cx = Math.floor(v.centroid.x), cy = Math.floor(v.centroid.y)
    expect(ids[cy * 20 + cx]).toBe(6)
    expect(v.anchor).toEqual(v.centroid)
  })

  it('puts the mark on the pixel deepest inside the element (chamfer 3-4), nearest the centroid on ties', () => {
    // Brute force over random shapes whose centroid falls off the element: rings, U shapes, split regions.
    let a = 12345
    const rand = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296)
    const R = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
    let checked = 0
    for (let trial = 0; trial < 400 && checked < 60; trial++) {
      const W = R(12, 28), H = R(12, 28)
      const img = image(W, H)
      for (let k = 0, n = R(2, 4); k < n; k++) img.paint(5, R(0, W - 3), R(0, H - 3), R(2, W - 1), R(2, H - 1))
      for (let k = 0, n = R(1, 3); k < n; k++) img.paint(9, R(0, W - 1), R(0, H - 1), R(0, W - 1), R(0, H - 1)) // occluders
      for (let k = 0, n = R(0, 6); k < n; k++) img.set(R(0, 1) ? 9 : 5, R(0, W - 1), R(0, H - 1)) // speckle
      const v = visibleFromIdBuffer(img.buf, W, H, 0).find((e) => e.index === 5)
      if (!v) continue
      const own = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && img.ids[y * W + x] === 5
      if (own(Math.floor(v.centroid.x), Math.floor(v.centroid.y))) continue
      checked++
      // Exact chamfer 3-4 distance from each pixel of the element to the nearest pixel that isn't (frame edge included).
      const dist = (x: number, y: number) => {
        let best = Infinity
        for (let qy = -1; qy <= H; qy++) for (let qx = -1; qx <= W; qx++) {
          if (own(qx, qy)) continue
          const dx = Math.abs(qx - x), dy = Math.abs(qy - y)
          best = Math.min(best, 3 * Math.max(dx, dy) + Math.min(dx, dy))
        }
        return best
      }
      let maxD = -1
      const deep: [number, number][] = []
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!own(x, y)) continue
        const d = dist(x, y)
        if (d > maxD) { maxD = d; deep.length = 0 }
        if (d === maxD) deep.push([x, y])
      }
      const ax = v.anchor.x - 0.5, ay = v.anchor.y - 0.5
      expect(Number.isInteger(ax) && Number.isInteger(ay), `trial ${trial}: anchor on a pixel centre`).toBe(true)
      expect(own(ax, ay), `trial ${trial}: anchor on the element`).toBe(true)
      expect(dist(ax, ay), `trial ${trial}: anchor as deep as it gets`).toBe(maxD)
      const r = (x: number, y: number) => (x + 0.5 - v.centroid.x) ** 2 + (y + 0.5 - v.centroid.y) ** 2
      expect(r(ax, ay), `trial ${trial}: nearest the centroid among the deepest`).toBeCloseTo(Math.min(...deep.map(([x, y]) => r(x, y))), 9)
    }
    expect(checked).toBeGreaterThanOrEqual(30)
  })
})
