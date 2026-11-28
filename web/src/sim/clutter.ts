/**
 * Site clutter for the cluttered test site (/samples?at=P1&clutter): the everyday things a real site has and the
 * BIM model doesn't. Pallets of blocks, slab props, scaffold towers, a mixer, spare rebar, a tarp, a banner,
 * people, stains and spray marks. The default virtual site never loads this, so its tested numbers stay as they are.
 * IFC metres, Z up. Places are fixed (CLUTTER) with a little seeded jitter, so every run sees the same site.
 */
import {
  BoxGeometry, CapsuleGeometry, type CanvasTexture, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh,
  MeshStandardMaterial, type Object3D, PlaneGeometry, RepeatWrapping, SphereGeometry, Vector3,
} from 'three'
import { SITE_AS_BUILT, type Deviation } from './asBuilt'
import { canvas, rng, texture } from './world'

type V3 = [number, number, number]

/** One thing standing on the site: where (plan x, y), how much room it takes (radius r), and its base level z. */
export interface ClutterItem {
  what: 'pallet' | 'bags' | 'barrow' | 'mixer' | 'prop' | 'worker' | 'tower' | 'timber' | 'rebar' | 'cage' | 'cone' | 'post'
  at: [number, number]
  r: number
  rot?: number
  z?: number
  /** pallet: height of the block stack; tower: number of 2 m lifts. */
  n?: number
}

/**
 * Nothing here stands on a QR spot, on its board, or right in front of the camera (clutter.test.ts checks).
 * Otherwise things are where a site would leave them: they may well hide part of an element, as on a real site.
 */
export const CLUTTER: readonly ClutterItem[] = [
  // Ground floor, bay B-C between rows 1 and 2: what P1 and P2 look into. Things stand in the open middle of each
  // opening view, between the columns' sight lines, not in front of an element the check marks.
  { what: 'pallet', at: [9.6, 3.4], r: 0.8, rot: 0.2, n: 0.9 },
  { what: 'bags', at: [9.9, 2.6], r: 0.6, rot: 0.3 },
  { what: 'barrow', at: [9.0, 5.8], r: 0.8, rot: 2.2 },
  { what: 'worker', at: [8.4, 3.0], r: 0.4, rot: 0.6 },
  ...([[8.3, 1.6], [8.3, 4.4], [1.5, 1.5], [4.5, 1.3], [1.5, 4.5], [4.5, 4.7]] as const)
    .map(([x, y]): ClutterItem => ({ what: 'prop', at: [x, y], r: 0.15 })),
  { what: 'timber', at: [1.2, 9.0], r: 1.6, rot: 0.05 },
  // The open bay C-D: down its middle strip.
  { what: 'pallet', at: [15.8, 2.3], r: 0.8, rot: -0.15, n: 0.7 },
  { what: 'mixer', at: [13.6, 3.6], r: 0.8, rot: 0.5 },
  { what: 'rebar', at: [16.0, 4.4], r: 0.5 },
  // Outside: cones by the south entrance, tape posts across the open bay, a scaffold tower at the north-east corner.
  { what: 'cone', at: [8.0, -1.6], r: 0.2 },
  { what: 'cone', at: [10.0, -1.6], r: 0.2 },
  { what: 'cone', at: [13.3, 5.6], r: 0.2 },
  { what: 'post', at: [12.4, -0.5], r: 0.1 },
  { what: 'post', at: [17.6, -0.5], r: 0.1 },
  { what: 'tower', at: [19.3, 11.6], r: 1.2, n: 3 },
  // Up on the level 1 slab, back from its edge: a short tower for the steel fixers, with someone on it.
  { what: 'tower', at: [7.5, 9.5], r: 1.1, z: 4.5, n: 1 },
  { what: 'worker', at: [7.5, 9.3], r: 0.4, z: 6.56, rot: 1.6 },
]

const UP_Y = new Vector3(0, 1, 0)
const UP_Z = new Vector3(0, 0, 1)
const SLAB_SOFFIT_Z = 4.3
const COLUMN_HALF_M = 0.225

function blockTexture(courses: number): CanvasTexture {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#6f6d68'
  g.fillRect(0, 0, 256, 256)
  const bh = 256 / courses
  const bw = 256 / 3
  for (let row = 0; row < courses; row++) {
    for (let i = -1; i < 3; i++) {
      const v = 150 + (((row * 7 + i * 13) % 5) + 5) % 5 * 6
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`
      g.fillRect(i * bw + ((row % 2) * bw) / 2 + 2, row * bh + 2, bw - 4, bh - 4)
    }
  }
  return texture(c)
}

/** A soft-edged blotch: spilt oil, cement slurry, a damp patch. `rgb` is "r,g,b". */
function stainTexture(rand: () => number, rgb: string): CanvasTexture {
  const [c, g] = canvas(256, 256)
  for (let i = 0; i < 10; i++) {
    const x = 128 + (rand() - 0.5) * 110
    const y = 128 + (rand() - 0.5) * 110
    const r = 25 + rand() * 45
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(${rgb},0.5)`)
    grad.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
  }
  return texture(c)
}

/** Streaks running down a face: rust from the rebar, grout leaking from the formwork. */
function dripTexture(rand: () => number, rgb: string): CanvasTexture {
  const [c, g] = canvas(128, 512)
  for (let i = 0; i < 7; i++) {
    const len = 150 + rand() * 340
    const grad = g.createLinearGradient(0, 0, 0, len)
    grad.addColorStop(0, `rgba(${rgb},0.55)`)
    grad.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = grad
    g.fillRect(14 + rand() * 100, 0, 4 + rand() * 12, len)
  }
  return texture(c)
}

/** A setting-out mark sprayed on by hand: a grid name, a level, a cross. */
function sprayTexture(text: string, colour: string): CanvasTexture {
  const [c, g] = canvas(512, 256)
  g.shadowColor = colour
  g.shadowBlur = 12
  g.fillStyle = colour
  g.globalAlpha = 0.85
  g.font = 'bold 150px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 256, 132, 480)
  return texture(c)
}

function bannerTexture(): CanvasTexture {
  const [c, g] = canvas(1024, 384)
  g.fillStyle = '#f2c200'
  g.fillRect(0, 0, 1024, 384)
  g.strokeStyle = '#111111'
  g.lineWidth = 16
  g.strokeRect(16, 16, 992, 352)
  g.fillStyle = '#111111'
  g.textAlign = 'center'
  g.font = 'bold 150px system-ui, sans-serif'
  g.fillText('SAFETY FIRST', 512, 190, 900)
  g.font = 'bold 54px system-ui, sans-serif'
  g.fillText('Hard hats and boots beyond this point', 512, 300, 900)
  return texture(c)
}

function tapeTexture(): CanvasTexture {
  const [c, g] = canvas(64, 16)
  g.fillStyle = '#f4f4f0'
  g.fillRect(0, 0, 64, 16)
  g.fillStyle = '#c8201c'
  for (const x of [0, 32]) {
    g.beginPath()
    g.moveTo(x, 16)
    g.lineTo(x + 16, 0)
    g.lineTo(x + 32, 0)
    g.lineTo(x + 16, 16)
    g.fill()
  }
  const t = texture(c)
  t.wrapS = RepeatWrapping
  return t
}

/** Adds the clutter to the simulated site and returns its group. Spray marks follow a column that was built off line. */
export function addClutter(scene: Object3D, deviations: readonly Deviation[] = SITE_AS_BUILT, seed = 'site-clutter'): Group {
  const rand = rng(seed)
  const root = new Group()
  root.name = 'clutter'
  const flat = (color: number, roughness = 0.9, metalness = 0) => new MeshStandardMaterial({ color, roughness, metalness })
  const M = {
    timber: flat(0xb08a56), ply: flat(0x9c7a4a), bag: flat(0xc9b78f), scaffold: flat(0xa9b0b6, 0.45, 0.6),
    prop: flat(0xb5351f, 0.6, 0.3), propInner: flat(0x8d9399, 0.5, 0.5), rebar: flat(0x7a4529, 0.8, 0.2),
    green: flat(0x2f6b3c, 0.7, 0.1), orange: flat(0xe0731a, 0.6, 0.1), dark: flat(0x2c2f33, 0.7, 0.3),
    rubber: flat(0x1b1b1d, 0.95), cone: flat(0xf05a14, 0.7), vest: flat(0xf2c21a, 0.8), vest2: flat(0xf26a1b, 0.8),
    trousers: flat(0x2a3550), skin: flat(0xb98a66), helmet: flat(0xf4f4f0, 0.5), helmet2: flat(0x2b6fd1, 0.5),
    tarp: new MeshStandardMaterial({ color: 0x2a5db0, roughness: 0.55, side: DoubleSide }),
  }
  const shade = <T extends Mesh>(m: T): T => {
    m.castShadow = true
    m.receiveShadow = true
    return m
  }
  const place = (x: number, y: number, z = 0, rot = 0): Group => {
    const g = new Group()
    g.position.set(x, y, z)
    g.rotation.z = rot
    root.add(g)
    return g
  }
  /** A box standing on z, centred on (x, y). */
  const box = (p: Object3D, w: number, d: number, h: number, mat: MeshStandardMaterial, x = 0, y = 0, z = 0, rot = 0): Mesh => {
    const m = shade(new Mesh(new BoxGeometry(w, d, h), mat))
    m.position.set(x, y, z + h / 2)
    m.rotation.z = rot
    p.add(m)
    return m
  }
  /** A round bar from a to b. */
  const tube = (p: Object3D, a: V3, b: V3, r: number, mat: MeshStandardMaterial, r2 = r): Mesh => {
    const va = new Vector3(...a)
    const dir = new Vector3(...b).sub(va)
    const m = shade(new Mesh(new CylinderGeometry(r2, r, dir.length(), 10), mat))
    m.position.copy(va).addScaledVector(dir, 0.5)
    m.quaternion.setFromUnitVectors(UP_Y, dir.normalize())
    p.add(m)
    return m
  }
  /** A flat mark stuck on a face: on the ground (normal up), a soffit (normal down) or a wall (normal level). */
  const decal = (tex: CanvasTexture, w: number, h: number, pos: V3, normal: V3, opacity = 1, turn = 0): void => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({
      map: tex, transparent: true, opacity, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4,
    }))
    const n = new Vector3(...normal)
    if (Math.abs(n.z) > 0.9) m.rotation.set(n.z < 0 ? Math.PI : 0, 0, turn)
    else m.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(UP_Z.clone().cross(n), UP_Z, n))
    m.position.set(...pos)
    m.receiveShadow = true
    root.add(m)
  }
  const onColumn = (col: string, n: [number, number], z: number, w: number, h: number, tex: CanvasTexture): void => {
    const d = deviations.find((dev) => dev.element === `RC column ${col}`)
    if (d?.kind === 'missing') return
    const off = d?.kind === 'shifted' ? d.offsetM : [0, 0, 0]
    const cx = 'ABCD'.indexOf(col[0]) * 6 + off[0]
    const cy = (Number(col[1]) - 1) * 6 + off[1]
    const out = COLUMN_HALF_M + 0.004
    decal(tex, w, h, [cx + n[0] * out, cy + n[1] * out, z], [n[0], n[1], 0])
  }

  const builders: Record<ClutterItem['what'], (it: ClutterItem) => void> = {
    pallet: ({ at, rot, n = 0.8 }) => {
      const g = place(at[0], at[1], 0, rot)
      box(g, 1.2, 1.0, 0.14, M.timber)
      box(g, 1.12, 0.92, n, new MeshStandardMaterial({ map: blockTexture(Math.round(n / 0.2)), roughness: 0.95 }), 0, 0, 0.14)
      const block = flat(0x9d9b95, 0.95)
      for (let i = 0; i < 5; i++) box(g, 0.39, 0.19, 0.19, block, 0.95 + rand() * 0.5, (rand() - 0.5) * 1.2, 0, rand() * 3)
    },
    bags: ({ at, rot }) => {
      const g = place(at[0], at[1], 0, rot)
      for (let layer = 0; layer < 4; layer++) {
        const across = layer % 2 === 1
        for (const s of [-0.2, 0.2]) box(g, 0.6, 0.38, 0.13, M.bag, across ? s : 0, across ? 0 : s, layer * 0.13, across ? Math.PI / 2 : 0)
      }
      box(g, 0.6, 0.38, 0.13, M.bag, 0.75, 0.1, 0, 0.5)
    },
    barrow: ({ at, rot }) => {
      const g = place(at[0], at[1], 0, rot)
      box(g, 0.85, 0.55, 0.22, M.green, 0, 0, 0.36)
      tube(g, [0.55, -0.04, 0.19], [0.55, 0.04, 0.19], 0.19, M.rubber)
      for (const s of [-1, 1]) {
        tube(g, [-0.4, s * 0.25, 0.5], [-1.05, s * 0.28, 0.62], 0.016, M.dark)
        tube(g, [-0.3, s * 0.22, 0.36], [-0.35, s * 0.22, 0], 0.016, M.dark)
      }
    },
    mixer: ({ at, rot }) => {
      const g = place(at[0], at[1], 0, rot)
      box(g, 1.1, 0.6, 0.08, M.dark, 0, 0, 0.34)
      box(g, 0.08, 0.08, 0.5, M.dark, 0.1, 0, 0.4)
      box(g, 0.35, 0.4, 0.35, M.orange, -0.35, 0, 0.42)
      for (const s of [-1, 1]) tube(g, [-0.3, s * 0.32, 0.22], [-0.3, s * 0.4, 0.22], 0.22, M.rubber)
      tube(g, [-0.1, 0, 0.75], [0.33, 0, 1.45], 0.4, M.orange, 0.26)
      tube(g, [0.5, 0, 0.36], [1.2, 0, 0.3], 0.02, M.dark)
    },
    prop: ({ at: [x, y] }) => {
      tube(root, [x, y, 0], [x, y, SLAB_SOFFIT_Z * 0.55], 0.034, M.prop)
      tube(root, [x, y, SLAB_SOFFIT_Z * 0.55], [x, y, SLAB_SOFFIT_Z], 0.026, M.propInner)
      box(root, 0.15, 0.15, 0.008, M.prop, x, y, 0)
      box(root, 0.15, 0.15, 0.008, M.prop, x, y, SLAB_SOFFIT_Z - 0.008)
    },
    worker: ({ at, z, rot }) => {
      const g = place(at[0], at[1], z, rot)
      const vest = z ? M.vest2 : M.vest
      const limb = (r: number, len: number, mat: MeshStandardMaterial, x: number, h: number): void => {
        const m = shade(new Mesh(new CapsuleGeometry(r, len, 4, 10), mat))
        m.rotation.x = Math.PI / 2
        m.position.set(x, 0, h)
        g.add(m)
      }
      for (const s of [-0.1, 0.1]) limb(0.075, 0.68, M.trousers, s, 0.42)
      limb(0.17, 0.36, vest, 0, 1.13)
      for (const s of [-0.25, 0.25]) limb(0.055, 0.5, vest, s, 1.1)
      const head = shade(new Mesh(new SphereGeometry(0.105, 14, 10), M.skin))
      head.position.set(0, 0, 1.56)
      const helmet = shade(new Mesh(new SphereGeometry(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), z ? M.helmet2 : M.helmet))
      helmet.rotation.x = Math.PI / 2
      helmet.position.set(0, 0, 1.59)
      g.add(head, helmet)
    },
    tower: ({ at, z, rot, n = 1 }) => {
      const g = place(at[0], at[1], z, rot)
      const [w, d, lift] = [1.1, 1.9, 2]
      const deck = n * lift
      const top = deck + 1
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          tube(g, [(sx * w) / 2, (sy * d) / 2, 0], [(sx * w) / 2, (sy * d) / 2, top], 0.024, M.scaffold)
          box(g, 0.15, 0.15, 0.01, M.scaffold, (sx * w) / 2, (sy * d) / 2, 0)
        }
      }
      const ring = (h: number): void => {
        for (const s of [-1, 1]) {
          tube(g, [-w / 2, (s * d) / 2, h], [w / 2, (s * d) / 2, h], 0.022, M.scaffold)
          tube(g, [(s * w) / 2, -d / 2, h], [(s * w) / 2, d / 2, h], 0.022, M.scaffold)
        }
      }
      for (let i = 0; i <= n; i++) {
        ring(Math.max(0.15, i * lift))
        if (i < n) for (const s of [-1, 1]) tube(g, [(s * w) / 2, -d / 2, i * lift + 0.15], [(s * w) / 2, d / 2, (i + 1) * lift - 0.1], 0.02, M.scaffold)
      }
      ring(deck + 0.5)
      ring(top)
      box(g, w - 0.06, d - 0.06, 0.04, M.timber, 0, 0, deck + 0.02)
      for (const s of [-1, 1]) box(g, 0.025, d, 0.15, M.timber, s * (w / 2 - 0.02), 0, deck + 0.06)
    },
    timber: ({ at, rot }) => {
      const g = place(at[0], at[1], 0, rot)
      for (let layer = 0; layer < 3; layer++) {
        for (let i = 0; i < 4; i++) box(g, 0.2, 3, 0.05, M.timber, -0.33 + i * 0.22, (rand() - 0.5) * 0.3, layer * 0.055, (rand() - 0.5) * 0.03)
      }
      // A few sheets of plywood stacked flat beside the timber.
      for (let i = 0; i < 4; i++) box(g, 1.22, 2.44, 0.018, M.ply, 1.5 + (rand() - 0.5) * 0.06, (rand() - 0.5) * 0.1, i * 0.02)
    },
    rebar: ({ at: [x, y] }) => {
      for (const s of [-1.5, 1.5]) box(root, 0.1, 0.6, 0.08, M.timber, x + s, y, 0)
      for (let i = 0; i < 14; i++) {
        const dy = (rand() - 0.5) * 0.3
        const h = 0.095 + rand() * 0.07
        tube(root, [x - 2 + rand() * 0.2, y + dy, h], [x + 2 + rand() * 0.2, y + dy, h], 0.012, M.rebar)
      }
    },
    // A spare column cage lying on bearers, running east from `at`.
    cage: ({ at: [x, y] }) => {
      const [len, half, z0] = [4, 0.16, 0.1]
      for (const s of [0.6, 3.4]) box(root, 0.1, 0.7, 0.08, M.timber, x + s, y, 0)
      for (const sy of [-half, half]) for (const sz of [0, half * 2]) tube(root, [x, y + sy, z0 + sz], [x + len, y + sy, z0 + sz], 0.012, M.rebar)
      for (let t = 0.1; t < len; t += 0.3) {
        const corners: V3[] = [[x + t, y - half, z0], [x + t, y + half, z0], [x + t, y + half, z0 + half * 2], [x + t, y - half, z0 + half * 2]]
        corners.forEach((c, i) => tube(root, c, corners[(i + 1) % 4], 0.006, M.rebar))
      }
    },
    cone: ({ at }) => {
      const g = place(at[0], at[1])
      box(g, 0.3, 0.3, 0.03, M.cone)
      tube(g, [0, 0, 0.03], [0, 0, 0.53], 0.13, M.cone, 0.02)
    },
    post: ({ at: [x, y] }) => {
      tube(root, [x, y, 0], [x, y, 1.1], 0.02, M.prop)
      box(root, 0.3, 0.3, 0.04, M.rubber, x, y, 0)
    },
  }
  for (const it of CLUTTER) builders[it.what](it)

  // Barrier tape between the two posts across the open bay.
  const posts = CLUTTER.filter((it) => it.what === 'post')
  if (posts.length === 2) {
    const [a, b] = posts.map((p) => p.at)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const tape = tapeTexture()
    tape.repeat.set(len / 0.3, 1)
    const ribbon = new Mesh(new BoxGeometry(len, 0.004, 0.075), new MeshStandardMaterial({ map: tape, roughness: 0.7 }))
    ribbon.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.95)
    ribbon.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0])
    root.add(shade(ribbon))
  }

  // A safety banner tied between columns D1 and D2.
  const banner = shade(new Mesh(new PlaneGeometry(2.6, 1), new MeshStandardMaterial({ map: bannerTexture(), roughness: 0.8 })))
  banner.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0, 1, 0), UP_Z, new Vector3(1, 0, 0)))
  banner.position.set(18.24, 3, 2.8)
  const bannerBack = shade(new Mesh(new PlaneGeometry(2.6, 1), flat(0xd9d6cc, 0.8)))
  bannerBack.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0, -1, 0), UP_Z, new Vector3(-1, 0, 0)))
  bannerBack.position.set(18.236, 3, 2.8)
  root.add(banner, bannerBack)
  for (const z of [2.32, 3.28]) {
    tube(root, [18.24, 1.7, z], [18.2, 0.23, z], 0.004, M.dark)
    tube(root, [18.24, 4.3, z], [18.2, 5.77, z], 0.004, M.dark)
  }
  box(root, 1.3, 1.1, 0.02, M.tarp, 15.8, 2.3, 0.85, -0.15) // a tarp over the open bay's pallet

  // Stains on the ground and under the slab.
  const [oil, slurry, damp, rust] = ['24,22,20', '196,192,182', '52,50,46', '120,62,28']
  const ground: [number, number, number, string][] = [
    [9.6, 1.2, 1.8, oil], [8.6, 5.4, 2.8, slurry], [13.6, 2.8, 2.4, damp], [14.6, 5.3, 2.6, slurry], [2.2, 1.0, 1.6, oil],
    [16.5, 7.0, 3.0, slurry], [15.4, 0.9, 3.2, rust], [9.0, -1.6, 2.2, damp], [4.2, 8.0, 2.4, damp],
  ]
  for (const [x, y, size, rgb] of ground) decal(stainTexture(rand, rgb), size, size * (0.6 + rand() * 0.4), [x, y, 0.004], [0, 0, 1], 1, rand() * 6)
  for (const [x, y, size] of [[8.5, 2.5, 1.8], [10.2, 4.8, 1.4], [3.5, 4.2, 1.6], [10.4, 8.8, 2.0]]) {
    decal(stainTexture(rand, '96,90,82'), size, size, [x, y, SLAB_SOFFIT_Z - 0.004], [0, 0, -1], 0.6, rand() * 6)
  }

  // Spray marks and streaks on the columns, and a couple of setting-out marks on the ground.
  const [red, blue, pink] = ['#d0221c', '#1c4fd0', '#e8408a']
  onColumn('B2', [0, -1], 1.5, 0.4, 0.2, sprayTexture('B2', red))
  onColumn('B2', [0, -1], 3.3, 0.4, 1.6, dripTexture(rand, rust))
  onColumn('C1', [-1, 0], 1.3, 0.4, 0.2, sprayTexture('▼+1.00', blue))
  onColumn('C1', [0, -1], 1.5, 0.4, 0.2, sprayTexture('C1', red))
  onColumn('B1', [0, -1], 1.5, 0.4, 0.2, sprayTexture('B1', red))
  onColumn('B1', [1, 0], 3.4, 0.4, 1.4, dripTexture(rand, slurry))
  onColumn('D1', [-1, 0], 3.3, 0.4, 1.6, dripTexture(rand, rust))
  onColumn('D2', [-1, 0], 1.4, 0.4, 0.2, sprayTexture('✕ CL', pink))
  onColumn('A2', [1, 0], 1.4, 0.4, 0.2, sprayTexture('✕ CL', pink))
  onColumn('A3', [0, -1], 3.4, 0.4, 1.5, dripTexture(rand, slurry))
  onColumn('B3', [0, -1], 1.5, 0.4, 0.2, sprayTexture('B3', red))
  onColumn('C3', [0, -1], 3.3, 0.4, 1.6, dripTexture(rand, rust))
  onColumn('D3', [0, -1], 1.3, 0.4, 0.2, sprayTexture('▼+1.00', blue))
  decal(sprayTexture('← GL B', pink), 1.2, 0.6, [6.9, -0.9, 0.005], [0, 0, 1], 0.9)
  decal(sprayTexture('GL C →', pink), 1.2, 0.6, [11.1, -0.9, 0.005], [0, 0, 1], 0.9)

  scene.add(root)
  return root
}
