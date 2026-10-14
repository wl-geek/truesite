import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { buildLoadedModel } from './loadModel'
import { buildWalkScene, exportUsdz, isAndroid, isAppleMobile, recentreOffset, sceneViewerUrl } from './walkthrough'

describe('walk inside', () => {
  it('detects phones', () => {
    expect(isAppleMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', 'iPhone', 5)).toBe(true)
    expect(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true) // iPadOS desktop UA
    expect(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false)
    expect(isAndroid('Mozilla/5.0 (Linux; Android 16; Pixel 10)')).toBe(true)
  })

  it('recentres the IFC floor point to the origin in glTF axes', () => {
    expect(recentreOffset(4.5, 4.5)).toEqual([-4.5, 0, 4.5])
  })

  it('builds a Scene Viewer intent with the glb, AR only and fixed scale', () => {
    const url = sceneViewerUrl('https://x.test/api/projects/rooftop/model.glb', 'Rooftop', 'https://x.test/a/rooftop/R1')
    expect(url.startsWith('intent://arvr.google.com/scene-viewer/1.2?file=https%3A%2F%2Fx.test%2Fapi%2Fprojects%2Frooftop%2Fmodel.glb')).toBe(true)
    expect(url).toContain('mode=ar_only')
    expect(url).toContain('resizable=false')
    expect(url).toContain('S.browser_fallback_url=https%3A%2F%2Fx.test%2Fa%2Frooftop%2FR1')
  })

  it('exports a USDZ (zip) with a recentred copy of the model', async () => {
    const gltf = new Group()
    const col = new Mesh(new BoxGeometry(0.4, 3.3, 0.4), new MeshBasicMaterial())
    col.name = 'A'.repeat(22)
    col.position.set(4.5, 1.65, -4.5) // glTF position of a column at IFC (4.5, 4.5)
    gltf.add(col)
    const model = buildLoadedModel(gltf, new Set(['A'.repeat(22)]))
    const scene = buildWalkScene(model, () => 'IfcColumn', [4.5, 4.5])
    const copy = scene.children[0].children[0] as Mesh
    copy.updateMatrixWorld(true)
    const p = copy.getWorldPosition(copy.position.clone())
    expect([p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100)).toEqual([0, 1.65, 0])
    const blob = await exportUsdz(scene)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')
    expect(blob.size).toBeGreaterThan(500)
  })
})
