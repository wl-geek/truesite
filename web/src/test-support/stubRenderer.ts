import { Color, Mesh, type Camera, type Material, type Object3D, type Plane, type WebGLRenderer } from 'three'

export type Drawn = { name: string; clip: Plane[]; localClipping: boolean }

/**
 * A WebGLRenderer stand-in for node tests. render() walks the scene the way three's projectObject does
 * (an invisible object hides its subtree; meshes on layers the camera doesn't see are skipped) and records
 * each mesh drawn with a copy of its material's clipping planes. Readback leaves the buffer at zero.
 */
export function stubRenderer() {
  const drawn: Drawn[] = []
  let target: unknown = null
  const clearColor = new Color(0x123456)
  const stub = {
    toneMapping: 4,
    localClippingEnabled: false,
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => { target = t },
    getClearColor: (c: Color) => c.copy(clearColor),
    getClearAlpha: () => 0,
    setClearColor: (c: Color) => { clearColor.copy(c) },
    clear: () => undefined,
    render(scene: Object3D, camera: Camera) {
      const visit = (o: Object3D) => {
        if (!o.visible) return
        if (o instanceof Mesh && camera.layers.test(o.layers)) {
          const mat = o.material as Material
          drawn.push({ name: o.name, clip: (mat.clippingPlanes ?? []).map((p) => p.clone()), localClipping: stub.localClippingEnabled })
        }
        o.children.forEach(visit)
      }
      visit(scene)
    },
    readRenderTargetPixels: () => undefined,
  }
  return { renderer: stub as unknown as WebGLRenderer, stub, drawn }
}
