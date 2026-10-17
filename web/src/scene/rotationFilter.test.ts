import { describe, expect, it } from 'vitest'
import { angleBetweenDeg, deviceRotation } from './motion'
import { RotationSmoother } from './rotationFilter'

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
