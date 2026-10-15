import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import { AskBox } from './AskBox'
import { ElementPanel } from './ElementPanel'

const el = (guid: string, ifc_class: string): Element =>
  ({ guid, ifc_class, name: `${ifc_class} ${guid.slice(0, 4)}`, storey: 'L1', bbox_m: [[0, 0, 0], [1, 1, 1]], load_bearing: null, props: {} })

/** The first element of `type` in a rendered tree (ElementPanel has no hooks, so it can be called directly). */
function find(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type)
      if (hit) return hit
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node
  return find((node.props as { children?: ReactNode }).children, type)
}

describe('ElementPanel', () => {
  it('keys the Ask box by element, so an answer never shows under another element', () => {
    const wall = find(ElementPanel({ projectId: 'room1', element: el('W'.repeat(22), 'IfcWall'), onClose: () => undefined }), AskBox)
    const door = find(ElementPanel({ projectId: 'room1', element: el('D'.repeat(22), 'IfcDoor'), onClose: () => undefined }), AskBox)
    expect(wall?.key).toBe('W'.repeat(22))
    expect(door?.key).toBe('D'.repeat(22))
  })
})
