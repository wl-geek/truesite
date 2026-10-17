import { describe, expect, it } from 'vitest'
import { angleBetweenDeg, deviceRotation } from './motion'
import { RotationSmoother, StillRotation } from './rotationFilter'

/** A repeatable Gaussian noise source. */
function gauss(seed: number): () => number {
  let s = seed
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 2 ** 32
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u())
}

describe('RotationSmoother (the motion sensors, before they turn the model)', () => {
  it('passes the first reading through', () => {
    const D = deviceRotation(30, 80, 5, 90)
    expect(angleBetweenDeg(new RotationSmoother().filter(D, 0), D)).toBeLessThan(1e-9)
  })

  it('takes most of the noise out at rest (a phone on a stand)', () => {
    for (const sigma of [0.05, 0.15]) {
      const g = gauss(7)
      const f = new RotationSmoother()
      const truth = deviceRotation(30, 80, 5, 90)
      let inSq = 0, outSq = 0, n = 0
      for (let i = 0; i < 300; i++) {
        const D = deviceRotation(30 + sigma * g(), 80 + sigma * g(), 5 + sigma * g(), 90)
        const out = f.filter(D, i * 16.7)
        if (i < 60) continue // settle
        inSq += angleBetweenDeg(D, truth) ** 2
        outSq += angleBetweenDeg(out, truth) ** 2
        n++
      }
      const [inRms, outRms] = [Math.sqrt(inSq / n), Math.sqrt(outSq / n)]
      console.log(`[rotation filter] at rest, ${sigma} deg per angle: ${inRms.toFixed(3)} -> ${outRms.toFixed(3)} deg`)
      expect(outRms).toBeLessThan(inRms / 2.5)
    }
  })

  it('keeps up with a turn: at 30 degrees/s it trails the device by about a third of a degree or less', () => {
    const f = new RotationSmoother()
    let lag = 0
    for (let i = 0; i <= 60; i++) {
      const D = deviceRotation(30 + 30 * (i * 16.7) / 1000, 80, 5, 90)
      lag = angleBetweenDeg(f.filter(D, i * 16.7), D)
    }
    console.log(`[rotation filter] 30 deg/s turn: trails by ${lag.toFixed(2)} deg`)
    expect(lag).toBeLessThan(0.35)
  })
})

describe('StillRotation (the sensors, while the code shows the camera is still)', () => {
  it('passes the live reading through while the camera moves', () => {
    const h = new StillRotation()
    const D = deviceRotation(30, 80, 5, 90)
    expect(h.update(D, false)).toBe(D)
  })

  it('averages the readings over the whole still spell: the noise all but goes', () => {
    const g = gauss(11)
    const h = new StillRotation()
    const truth = deviceRotation(30, 80, 5, 90)
    let out = truth
    for (let i = 0; i < 180; i++) out = h.update(deviceRotation(30 + 0.1 * g(), 80 + 0.1 * g(), 5 + 0.1 * g(), 90), true)
    expect(angleBetweenDeg(out, truth)).toBeLessThan(0.03)
  })

  it('lets go at once when the camera moves, and starts a new spell after', () => {
    const h = new StillRotation()
    for (let i = 0; i < 30; i++) h.update(deviceRotation(30, 80, 5, 90), true)
    const turned = deviceRotation(40, 80, 5, 90)
    expect(h.update(turned, false)).toBe(turned)
    expect(h.update(turned, true)).toBe(turned) // a new spell starts from the live reading itself
  })
})

describe('StillRotation and a sensor jump', () => {
  it('starts a new spell when the reading jumps by more than noise (a sensor reset): it never averages across it', () => {
    const h = new StillRotation()
    for (let i = 0; i < 60; i++) h.update(deviceRotation(30, 80, 5, 90), true)
    const jumped = deviceRotation(30, 80, 17, 90) // 12 degrees of roll, the camera still
    expect(h.update(jumped, true)).toBe(jumped)
  })
})
