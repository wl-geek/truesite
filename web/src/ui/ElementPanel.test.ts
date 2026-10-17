import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { Element, Finding, Issue } from '../api/types'
import { AskBox } from './AskBox'
import { ElementPanel } from './ElementPanel'
import { CopyIssueButton } from './SavedIssues'

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

/** Components with state: left as elements (their own tests cover them). */
const STATEFUL = new Set<unknown>([AskBox, CopyIssueButton])

/** All the text in a rendered tree, joined (ElementPanel and its sections have no hooks). */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!isValidElement(node)) return ''
  if (typeof node.type === 'function' && !STATEFUL.has(node.type)) return textOf((node.type as (p: unknown) => ReactNode)(node.props))
  return textOf((node.props as { children?: ReactNode }).children)
}

function buttons(node: ReactNode, label: string): ReactElement[] {
  const out: ReactElement[] = []
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!isValidElement(n)) return
    if (typeof n.type === 'function' && !STATEFUL.has(n.type)) return walk((n.type as (p: unknown) => ReactNode)(n.props))
    if (n.type === 'button' && textOf((n.props as { children?: ReactNode }).children).includes(label)) out.push(n)
    walk((n.props as { children?: ReactNode }).children)
  }
  walk(node)
  return out
}

describe('ElementPanel with a check result', () => {
  const column = el('C'.repeat(22), 'IfcColumn')
  const finding: Finding = {
    mark: 8, guid: column.guid, name: column.name, ifc_class: 'IfcColumn', status: 'misplaced', confidence: 0.8, evidence_box: null,
    offset: { direction: 'left', approx_cm: 60 }, explanation: 'It stands to the left of its outline.', severity: 'high',
  }

  it("shows the element's finding: status, severity, Gemini's reason, why it matters, and Draft issue", () => {
    const drafted: Finding[] = []
    const tree = ElementPanel({ projectId: 'site', element: column, onClose: () => undefined, finding, onDraftIssue: (f) => drafted.push(f) })
    const text = textOf(tree)
    expect(text).toContain('As-built check · mark 8')
    expect(text).toContain('Misplaced, about 60 cm left')
    expect(text).toContain('high')
    expect(text).toContain('Gemini: It stands to the left of its outline.')
    expect(text).toContain('Why it matters:')
    const [draft] = buttons(tree, 'Draft issue')
    ;(draft.props as { onClick: () => void }).onClick()
    expect(drafted).toEqual([finding])
  })

  it('offers no Draft issue without a handler (a poor photo) or for an element that matches', () => {
    expect(buttons(ElementPanel({ projectId: 'site', element: column, onClose: () => undefined, finding }), 'Draft issue')).toHaveLength(0)
    const ok = { ...finding, status: 'present_ok' as const, offset: null, severity: null, explanation: '' }
    const tree = ElementPanel({ projectId: 'site', element: column, onClose: () => undefined, finding: ok, onDraftIssue: () => undefined })
    expect(textOf(tree)).toContain('Matches the design')
    expect(buttons(tree, 'Draft issue')).toHaveLength(0)
  })

  it('says what was planted, in the virtual demo, and names its own camera action', () => {
    const tree = ElementPanel({ projectId: 'site', element: column, onClose: () => undefined, onZoom: () => undefined,
      zoomLabel: 'Turn to element', planted: 'about 60 cm west of the design' })
    expect(textOf(tree)).toContain('Planted in this demo: about 60 cm west of the design')
    expect(buttons(tree, 'Turn to element')).toHaveLength(1)
    expect(buttons(tree, 'Zoom to element')).toHaveLength(0)
  })
})

describe('ElementPanel with saved issues', () => {
  it('says each saved issue for this element, with its title and a Copy issue button', () => {
    const column = el('C'.repeat(22), 'IfcColumn')
    const issue: Issue = {
      id: 'i1', session_id: 's', project_id: 'site', guid: column.guid, finding_ref: null, run_id: null, title: 'B2 off its grid line',
      description: '', suggested_action: '', severity: 'high', crop_box: null, photo_url: null, created_at: new Date().toISOString(), status: 'open',
    }
    const tree = ElementPanel({ projectId: 'site', element: column, onClose: () => undefined, savedIssues: [issue] })
    expect(textOf(tree)).toContain('Issue saved · just now')
    expect(textOf(tree)).toContain('B2 off its grid line')
    const copy = find(tree, CopyIssueButton)
    expect((copy?.props as { issue: Issue }).issue).toBe(issue)
    expect(find(ElementPanel({ projectId: 'site', element: column, onClose: () => undefined, savedIssues: [] }), CopyIssueButton)).toBeNull()
  })
})

describe('ElementPanel as a compact sheet (live AR on a phone)', () => {
  const column: Element = { ...el('C'.repeat(22), 'IfcColumn'), bbox_m: [[0, 0, 0], [0.45, 0.45, 4.5]],
    props: { Material: 'Concrete C30/37', 'Pset_ColumnCommon.LoadBearing': true, 'TrueSite_Notes.Design': '8 T20 bars' } }

  it('peeks: what it is, two facts and More details, without Ask or the IFC data', () => {
    let toggled = 0
    const tree = ElementPanel({ projectId: 'site', element: column, onClose: () => undefined, size: { compact: true, toggle: () => toggled++ } })
    expect(find(tree, AskBox)).toBeNull()
    expect(textOf(tree)).not.toContain('BIM data (IFC)')
    expect(textOf(tree)).not.toContain('8 T20 bars')
    const [more] = buttons(tree, 'More details')
    ;(more.props as { onClick: () => void }).onClick()
    const [grab] = buttons(tree, '').filter((b) => (b.props as { className?: string }).className === 'ep-grabber')
    expect((grab.props as { 'aria-expanded': boolean })['aria-expanded']).toBe(false)
    ;(grab.props as { onClick: () => void }).onClick()
    expect(toggled).toBe(2)
  })

  it('opens fully with the same grabber, which now shows less', () => {
    const tree = ElementPanel({ projectId: 'site', element: column, onClose: () => undefined, size: { compact: false, toggle: () => undefined } })
    expect(find(tree, AskBox)).not.toBeNull()
    expect(buttons(tree, 'More details')).toHaveLength(0)
    const [grab] = buttons(tree, '').filter((b) => (b.props as { className?: string }).className === 'ep-grabber')
    expect((grab.props as { 'aria-label': string })['aria-label']).toBe('Collapse details')
  })
})
