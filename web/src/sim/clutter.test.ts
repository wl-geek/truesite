import { describe, expect, it } from 'vitest'
import { SITE_VIEWPOINTS, STAND_OFF_M } from '../ui/siteViewpoints'
import { CLUTTER } from './clutter'

describe('CLUTTER', () => {
  it('leaves every QR spot, its board and the view just in front of the camera clear', () => {
    for (const vp of SITE_VIEWPOINTS) {
      const board = [vp.stand[0] + vp.look[0] * STAND_OFF_M, vp.stand[1] + vp.look[1] * STAND_OFF_M]
      for (const it of CLUTTER) {
        const [dx, dy] = [it.at[0] - vp.stand[0], it.at[1] - vp.stand[1]]
        const label = `${it.what} at ${it.at} from ${vp.id}`
        expect(Math.hypot(dx, dy), label).toBeGreaterThan(it.r + 1)
        expect(Math.hypot(it.at[0] - board[0], it.at[1] - board[1]), label).toBeGreaterThan(it.r + 0.6)
        const ahead = dx * vp.look[0] + dy * vp.look[1]
        const aside = Math.abs(dx * vp.look[1] - dy * vp.look[0])
        expect(ahead > 0 && ahead < 3 && aside < it.r + 0.5, label).toBe(false)
      }
    }
  })

  it('stands inside the site: on the ground, or on the level 1 slab over bays A to C', () => {
    for (const it of CLUTTER) {
      expect(it.at[0]).toBeGreaterThan(-3)
      expect(it.at[0]).toBeLessThan(22)
      if (it.z) expect(it.at[0], `${it.what} is up on the slab`).toBeLessThan(12)
    }
  })
})
