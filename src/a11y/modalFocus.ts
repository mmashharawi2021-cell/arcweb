import { useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** Keeps Tab / Shift+Tab inside a modal dialog. */
export function trapTabKey(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Remembers the element focused when a modal opens and refocuses it when the modal closes,
 * but only if focus would otherwise be lost (on the body, or on an element removed with the dialog).
 * A close action that deliberately moved focus elsewhere keeps that focus.
 */
export function useRestoreFocus(): void {
  const [opener] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null)
  useEffect(() => () => {
    const target = opener
    const active = document.activeElement
    const focusLost = !active || active === document.body || !active.isConnected
    if (focusLost && target?.isConnected) target.focus()
  }, [opener])
}
