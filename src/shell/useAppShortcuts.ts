import { useEffect, useRef } from 'react'

interface ShortcutHandlers {
  /** Ctrl/⌘+S — works even while typing, like a desktop app. */
  save: () => void
  /** Ctrl/⌘+O */
  open: () => void
  /** Alt+Q — only handled when provided. */
  commandSearch?: () => void
}

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)))
}

/**
 * Application-wide shortcuts. Handlers are read through a ref, so passing new functions
 * never re-registers the listener; events another handler already took are ignored.
 */
export function useAppShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers)
  useEffect(() => { handlersRef.current = handlers })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const key = event.key.toLowerCase()
      const command = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      const { save, open, commandSearch } = handlersRef.current
      if (command && key === 's') {
        event.preventDefault()
        save()
        return
      }
      if (isTyping(event.target)) return
      if (command && key === 'o') {
        event.preventDefault()
        open()
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'q' && commandSearch) {
        event.preventDefault()
        commandSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
