import { useEffect, useRef, type RefObject } from 'react'

/** Controls Tab can reach (disabled and hidden ones are left out when the list is read). */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Where Tab has to send focus to stay inside a modal: from the last control Tab wraps to the first, from the first
 * Shift+Tab wraps to the last, and from outside it comes back in. null: the browser's own move stays inside.
 */
export function tabTarget<T>(items: readonly T[], active: T | null, back: boolean): T | null {
  if (!items.length) return null
  const i = active === null ? -1 : items.indexOf(active)
  if (i === -1) return back ? items[items.length - 1] : items[0]
  if (back ? i === 0 : i === items.length - 1) return back ? items[items.length - 1] : items[0]
  return null
}

/** Where focus goes when a modal opens: its first text field, else its first control. */
export function firstFocus<T>(items: readonly T[], isField: (item: T) => boolean): T | null {
  return items.find(isField) ?? items[0] ?? null
}

/**
 * Keyboard behaviour of a modal dialog while `open` (audit C-11, C-28): focus moves into `ref`, Tab and Shift+Tab
 * stay inside, Escape closes, and focus goes back to where it was when the dialog closes.
 */
export function useModal(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const controls = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
    // Not a <select>: the issue dialog disables its language list while Gemini drafts, which would drop the focus.
    if (!dialog.contains(document.activeElement)) firstFocus(controls(), (el) => el.matches('input, textarea'))?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault()
        close.current()
      } else if (e.key === 'Tab') {
        const to = tabTarget(controls(), document.activeElement as HTMLElement | null, e.shiftKey)
        if (to) {
          e.preventDefault()
          to.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [ref, open])
}
