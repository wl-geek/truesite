/**
 * The simulated site: the as-built model drawn the way a camera would see it (opaque concrete, painted steel,
 * rusty rebar, a yellow guardrail), under a sky, on a car park, with sun shadows and the QR boards on their
 * stands. Shared by the virtual site (ui/VirtualSite.tsx) and the sample photo studio (dev/sampleStudio.ts).
 * Everything is in IFC coordinates (metres, Z up): the model's ifcRoot keeps an identity matrix.
 */
import {
  BoxGeometry, CanvasTexture, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshStandardMaterial, NearestFilter,
  PlaneGeometry, Scene, SRGBColorSpace, Vector3,
} from 'three'
import type { Anchor, Element } from '../api/types'
import { kindOf } from '../scene/palette'
import type { LoadedModel } from '../scene/loadModel'
import type { Deviation } from './asBuilt'

// Flat shading: the exported meshes carry no normals, so the GPU derives each face's normal (as the design viewer does).
const MAT = {
  concrete: new MeshStandardMaterial({ color: 0xb3b0a8, roughness: 0.95, flatShading: true }),
  footing: new MeshStandardMaterial({ color: 0x9a978f, roughness: 1, flatShading: true }),
  steel: new MeshStandardMaterial({ color: 0x6c7782, roughness: 0.55, metalness: 0.35, flatShading: true }),
  truss: new MeshStandardMaterial({ color: 0x7f8a93, roughness: 0.5, metalness: 0.35, flatShading: true }),
  purlin: new MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.4, metalness: 0.55, flatShading: true }),
  brace: new MeshStandardMaterial({ color: 0x555c63, roughness: 0.5, metalness: 0.4, flatShading: true }),
  rebar: new MeshStandardMaterial({ color: 0x7a4529, roughness: 0.8, metalness: 0.2, flatShading: true }),
  rail: new MeshStandardMaterial({ color: 0xd8a414, roughness: 0.6, metalness: 0.1, flatShading: true }),
}

export function realisticMaterial(e: Element): MeshStandardMaterial {
  const kind = kindOf(e.ifc_class, String(e.props?.PredefinedType ?? ''))
  const concrete = /concrete/i.test(String(e.props?.Material ?? ''))
  if (e.ifc_class === 'IfcFooting') return MAT.footing
  if (kind === 'rebar') return MAT.rebar
  if (kind === 'concrete' || concrete) return MAT.concrete
  if (kind === 'column' || kind === 'beam') return MAT.steel
  if (kind === 'truss') return MAT.truss
  if (kind === 'purlin') return MAT.purlin
  if (kind === 'brace') return MAT.brace
  return MAT.rail
}

/** Paint the model like the real thing and build it "as built": missing elements hidden, shifted ones moved. */
export function makeAsBuilt(model: LoadedModel, elements: readonly Element[], deviations: readonly Deviation[]): void {
  const byGuid = new Map(elements.map((e) => [e.guid, e]))
  const byName = new Map(elements.map((e) => [e.name, e]))
  for (const mesh of model.meshes) {
    const e = byGuid.get(model.meshGuid.get(mesh)!)
    if (!e) continue
    mesh.material = realisticMaterial(e)
    mesh.castShadow = e.ifc_class !== 'IfcFooting' // 2 cm pads: self-shadowing would turn them black
    mesh.receiveShadow = true
  }
  for (const d of deviations) {
    const e = byName.get(d.element)
    const node = e && model.byGuid.get(e.guid)
    if (!node) throw new Error(`as-built: no element named ${d.element}`)
    if (d.kind === 'missing') node.visible = false
    else {
      const move = new Vector3(d.offsetM[0], d.offsetM[2], -d.offsetM[1]) // IFC (x, y, z) -> glTF (x, z, -y)
      for (const name of [d.element, ...(d.alsoMoves ?? [])]) {
        const e2 = byName.get(name)
        const n2 = e2 && model.byGuid.get(e2.guid)
        if (!n2) throw new Error(`as-built: no element named ${name}`)
        n2.position.add(move)
      }
    }
  }
  model.ifcRoot.updateMatrixWorld(true)
}

/** Small deterministic PRNG, so a re-render gives the same ground and grain. */
export function rng(seed: string): () => number {
  let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 2166136261)
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h })
  return [c, c.getContext('2d')!]
}

function texture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

function skyTexture(): CanvasTexture {
  const [c, g] = canvas(4, 256)
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#6f9fd0')
  grad.addColorStop(0.55, '#a9c7e3')
  grad.addColorStop(1, '#e4ecf2')
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 256)
  return texture(c)
}

/** 80 x 80 m of car park around the site: asphalt, bay lines, and a concrete pad under the building. */
function groundTexture(rand: () => number): CanvasTexture {
  const px = 2048
  const m = px / 80 // pixels per metre; the canvas covers x -31..49, y -34..46 (centred on the building)
  const [c, g] = canvas(px, px)
  const X = (x: number) => (x + 31) * m
  const Y = (y: number) => (46 - y) * m
  g.fillStyle = '#3d4043'
  g.fillRect(0, 0, px, px)
  for (let i = 0; i < 60000; i++) {
    const v = 40 + rand() * 50
    g.fillStyle = `rgb(${v},${v + 2},${v + 4})`
    g.fillRect(rand() * px, rand() * px, 2, 2)
  }
  g.fillStyle = '#8f8c86'
  g.fillRect(X(-2), Y(14), 22 * m, 16 * m)
  for (let i = 0; i < 20000; i++) {
    const v = 120 + rand() * 40
    g.fillStyle = `rgba(${v},${v - 3},${v - 8},0.6)`
    g.fillRect(X(-2) + rand() * 22 * m, Y(14) + rand() * 16 * m, 2, 2)
  }
  g.strokeStyle = 'rgba(235,235,225,0.85)'
  g.lineWidth = 0.12 * m
  for (const row of [-8, -20]) {
    for (let x = -24; x <= 42; x += 2.5) {
      g.beginPath()
      g.moveTo(X(x), Y(row))
      g.lineTo(X(x), Y(row - 5))
      g.stroke()
    }
  }
  for (let y = -4; y <= 40; y += 2.5) {
    g.beginPath()
    g.moveTo(X(34), Y(y))
    g.lineTo(X(39), Y(y))
    g.stroke()
  }
  const t = texture(c)
  t.anisotropy = 8
  return t
}

/**
 * The life-size site sheet (bim/truesite_bim/qr_sheets.py, LIFE_* layout): US Letter portrait, a 16 cm code whose
 * centre is 178 mm above the sheet's bottom edge, in metres.
 */
export const SHEET_M = { w: 0.2159, h: 0.2794, code: 0.16, codeUp: 0.178 } as const
/** The rigid board the sheet is mounted on shows this much around it. */
const BOARD_MARGIN_M = 0.01
const BOARD_THICK_M = 0.012
const POLE_M = 0.03

/**
 * The stand for a code centre `codeZ` above the ground: the board's centre and height, and a pole that rises from
 * the foot to the board's middle, behind it (so the board is held, not floating, and the pole doesn't show above it).
 */
export function qrStand(codeZ: number): { boardZ: number; boardH: number; poleH: number } {
  const boardZ = codeZ - (SHEET_M.codeUp - SHEET_M.h / 2)
  return { boardZ, boardH: SHEET_M.h + 2 * BOARD_MARGIN_M, poleH: boardZ }
}

/**
 * The printed face: the grey board edge, the white Letter sheet, a QR-like code (finder squares and random modules)
 * where the real sheet prints it, the viewpoint label, the instruction lines and the check bar. Decorative: it doesn't scan.
 */
function qrTexture(rand: () => number, label: string): CanvasTexture {
  const px = 3 // canvas pixels per mm
  const mm = (v: number) => Math.round(v * px)
  const margin = BOARD_MARGIN_M * 1000
  const [pageW, pageH] = [SHEET_M.w * 1000, SHEET_M.h * 1000]
  const [c, g] = canvas(mm(pageW + 2 * margin), mm(pageH + 2 * margin))
  g.fillStyle = '#9a978f'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#ffffff'
  g.fillRect(mm(margin), mm(margin), mm(pageW), mm(pageH))
  // Page coordinates in mm, measured from the sheet's top-left corner, as canvas pixels.
  const at = (x: number, y: number, w: number, h: number) => g.fillRect(mm(margin + x), mm(margin + y), mm(w), mm(h))
  const n = 29
  const cell = (SHEET_M.code * 1000) / n
  const x0 = pageW / 2 - (SHEET_M.code * 1000) / 2
  const y0 = pageH - SHEET_M.codeUp * 1000 - (SHEET_M.code * 1000) / 2
  g.fillStyle = '#111111'
  const finder = (fx: number, fy: number) => {
    at(x0 + fx * cell, y0 + fy * cell, 7 * cell, 7 * cell)
    g.fillStyle = '#ffffff'
    at(x0 + (fx + 1) * cell, y0 + (fy + 1) * cell, 5 * cell, 5 * cell)
    g.fillStyle = '#111111'
    at(x0 + (fx + 2) * cell, y0 + (fy + 2) * cell, 3 * cell, 3 * cell)
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const inFinder = (i < 8 && j < 8) || (i >= n - 8 && j < 8) || (i < 8 && j >= n - 8)
      if (!inFinder && rand() < 0.5) at(x0 + i * cell, y0 + j * cell, cell, cell)
    }
  }
  finder(0, 0)
  finder(n - 7, 0)
  finder(0, n - 7)
  // The instruction block (LIFE_TEXT_BOX_MM: 15 mm from the left, its top 70 mm above the bottom edge) and the check bar.
  const textTop = pageH - 70
  g.font = `bold ${mm(12)}px system-ui, sans-serif`
  g.textBaseline = 'top'
  g.fillText(label, mm(margin + 15), mm(margin + textTop))
  g.fillStyle = '#8a8a8a'
  for (const [i, w] of [140, 175, 160, 120].entries()) at(15, textTop + 18 + i * 7, w, 2.5)
  g.fillStyle = '#111111'
  at(57.95, pageH - 12 - 5, 100, 5)
  const t = texture(c)
  t.magFilter = NearestFilter
  t.center.set(0.5, 0.5)
  t.rotation = Math.PI // the box's +y face maps the canvas upside down
  return t
}

/** The upright Letter sheet on its board and stand at an anchor: printed face towards anchor.normal, code centre at the anchor. */
function qrBoard(anchor: Anchor, rand: () => number): Group {
  const g = new Group()
  const [nx, ny] = anchor.normal
  const [x, y, z] = anchor.position_m
  const { boardZ, boardH, poleH } = qrStand(z)
  const board = new Mesh(new BoxGeometry(SHEET_M.w + 2 * BOARD_MARGIN_M, BOARD_THICK_M, boardH), [
    MAT.footing, MAT.footing, new MeshStandardMaterial({ map: qrTexture(rand, anchor.anchor_id), roughness: 0.8 }), MAT.footing,
    MAT.footing, MAT.footing,
  ])
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z. Turn the box so its +y face looks along the normal.
  board.rotation.z = Math.atan2(ny, nx) - Math.PI / 2
  board.position.set(x, y, boardZ)
  const back = (BOARD_THICK_M + POLE_M) / 2 // the pole touches the board's back
  const pole = new Mesh(new BoxGeometry(POLE_M, POLE_M, poleH), MAT.brace)
  pole.position.set(x - back * nx, y - back * ny, poleH / 2)
  const foot = new Mesh(new BoxGeometry(0.5, 0.5, 0.03), MAT.brace)
  foot.position.set(x - back * nx, y - back * ny, 0.015)
  for (const m of [board, pole, foot]) {
    m.castShadow = true
    m.receiveShadow = true
  }
  g.add(board, pole, foot)
  return g
}

/** Sky, fog, the car park to the horizon, a few distant buildings, sun and sky light, and the QR boards. */
export function buildWorld(seed: string, anchors: readonly Anchor[]): Scene {
  const rand = rng(seed)
  const scene = new Scene()
  scene.background = skyTexture()
  scene.fog = new Fog(new Color('#dfe8ef'), 70, 260)
  const ground = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ map: groundTexture(rand), roughness: 1 }))
  ground.position.set(9, 6, -0.01)
  ground.receiveShadow = true
  const land = new Mesh(new PlaneGeometry(1200, 1200), new MeshStandardMaterial({ color: 0x55585a, roughness: 1 }))
  land.position.set(9, 6, -0.03)
  land.receiveShadow = true
  scene.add(ground, land)
  const far = new MeshStandardMaterial({ color: 0x9aa3ab, roughness: 1 })
  for (const [x, y, w, d, h] of [[-70, 60, 30, 20, 24], [40, 110, 40, 25, 36], [95, 20, 25, 40, 18], [-40, -90, 50, 20, 15], [90, -70, 30, 30, 28]]) {
    const b = new Mesh(new BoxGeometry(w, d, h), far)
    b.position.set(x, y, h / 2)
    scene.add(b)
  }
  scene.add(new HemisphereLight(0xcfe2ff, 0x8a8174, 2.4))
  const fill = new DirectionalLight(0xdfe8f2, 0.9) // sky and ground bounce, so shade reads as grey concrete, not black
  fill.position.set(9 + 30, 6 + 25, 20)
  fill.target.position.set(9, 6, 0)
  scene.add(fill, fill.target)
  const sun = new DirectionalLight(0xfff1dc, 3.2)
  sun.position.set(9 - 28, 6 - 36, 48)
  sun.target.position.set(9, 6, 0)
  sun.castShadow = true
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  scene.add(sun, sun.target)
  for (const a of anchors) if (a.scale === 1 && Math.abs(a.normal[2]) < 0.1) scene.add(qrBoard(a, rand))
  return scene
}

/** Grain and a soft vignette, like a phone camera frame. Returns a JPEG blob. */
export function photoFinish(src: HTMLCanvasElement, w: number, h: number, rand: () => number): Promise<Blob> {
  const [c, g] = canvas(w, h)
  g.drawImage(src, 0, 0, w, h)
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2))
      const v = 1 - 0.18 * Math.max(0, r - 0.45) ** 2
      const n = (rand() - 0.5) * 10
      d[i] = d[i] * v + n
      d[i + 1] = d[i + 1] * v + n
      d[i + 2] = d[i + 2] * v + n
    }
  }
  g.putImageData(img, 0, 0)
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('photo encode failed'))), 'image/jpeg', 0.88))
}
