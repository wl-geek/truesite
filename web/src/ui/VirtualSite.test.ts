import { Group, Scene, type WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import { type LoadedModel } from '../scene/loadModel'
import { releaseWorld } from './VirtualSite'

function fakeRenderer(calls: string[], name: string): WebGLRenderer {
  const r = { dispose: () => calls.push(`${name}.dispose`), forceContextLoss: () => calls.push(`${name}.forceContextLoss`) }
  return r as unknown as WebGLRenderer
}
const fakeModel = () => ({ ifcRoot: new Group(), gltfScene: new Group() }) as unknown as LoadedModel

describe('releaseWorld (audit B-06)', () => {
  it('drops both WebGL contexts on exit, the view and the check render, not at garbage collection', () => {
    const calls: string[] = []
    let restored = false
    releaseWorld({
      renderer: fakeRenderer(calls, 'view'), asBuilt: fakeModel(), design: fakeModel(),
      check: { model: fakeModel(), scene: new Scene(), renderer: fakeRenderer(calls, 'check') },
      restoreColours: () => { restored = true },
    })
    expect(calls).toEqual(['view.dispose', 'view.forceContextLoss', 'check.dispose', 'check.forceContextLoss'])
    expect(restored).toBe(true)
  })
})
