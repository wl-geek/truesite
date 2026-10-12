import type { Element, Finding, Issue } from '../api/types'

export type IssueDialogProps = {
  open: boolean
  projectId: string
  runId: string | null
  mark: number | null
  finding: Finding | null
  element: Element | null
  onClose: () => void
  onSaved: (issue: Issue) => void
}

/** Issue drafting and saving. Stub: Part 4 replaces this file; the props are final. */
export function IssueDialog(props: IssueDialogProps): null {
  void props
  return null
}
