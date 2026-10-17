import { describe, expect, it } from 'vitest'
import { qrStand, SHEET_M } from './world'

describe('qrStand', () => {
  it('holds the printed code centre at the anchor height, as the life-size Letter layout prints it', () => {
    const s = qrStand(1.4)
    // qr_sheets.py LIFE_QR_CENTRE_MM: the code centre is 178 mm above the sheet's bottom edge.
    expect(s.boardZ - SHEET_M.h / 2 + SHEET_M.codeUp).toBeCloseTo(1.4, 6)
    expect(SHEET_M).toMatchObject({ w: 0.2159, h: 0.2794, code: 0.16, codeUp: 0.178 })
  })

  it('runs the pole up behind the board, so the board never floats above it', () => {
    for (const z of [1.3, 1.4]) {
      const s = qrStand(z)
      const boardBottom = s.boardZ - s.boardH / 2
      expect(s.poleH).toBeGreaterThan(boardBottom + 0.05) // well into the board, hidden behind it
      expect(s.poleH).toBeLessThan(s.boardZ + s.boardH / 2) // and not sticking out over its top
    }
  })
})
