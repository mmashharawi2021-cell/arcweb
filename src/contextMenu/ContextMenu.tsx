import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { clampMenuPosition, stepMenuFocus, type MenuEntry, type Point } from './menuModel'

interface ContextMenuProps {
  /** Pointer position in viewport (client) coordinates. */
  anchor: Point
  entries: MenuEntry[]
  label: string
  /** Called with the chosen item's action id, after the menu has asked to close. */
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * A right-click menu rendered in viewport space. It measures itself before paint and flips/clamps
 * so it never clips off-screen, supports arrow-key navigation, and closes on Escape, an outside
 * press, scrolling, resizing or the window losing focus.
 */
export default function ContextMenu({ anchor, entries, label, onSelect, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<Point | null>(null)
  const [focusIndex, setFocusIndex] = useState(() => stepMenuFocus(entries, -1, 1))

  // Give focus back to whatever opened the menu (e.g. the layer row for a keyboard user) when it
  // closes — but only if focus would otherwise be lost, so a dialog opened by the chosen item keeps it.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const menu = menuRef.current
    return () => {
      const active = document.activeElement
      const focusLost = !active || active === document.body || (menu?.contains(active) ?? false)
      if (focusLost && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setPosition(clampMenuPosition({ x: anchor.x, y: anchor.y }, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [anchor.x, anchor.y, entries.length])

  useEffect(() => {
    if (focusIndex < 0) {
      menuRef.current?.focus()
      return
    }
    menuRef.current?.querySelector<HTMLButtonElement>(`[data-menu-index="${focusIndex}"]`)?.focus()
  }, [focusIndex, position])

  useEffect(() => {
    const close = () => onClose()
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    // Capture phase so scrolling any panel (not only the window) dismisses the menu.
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setFocusIndex((current) => stepMenuFocus(entries, current, event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setFocusIndex(event.key === 'Home' ? stepMenuFocus(entries, -1, 1) : stepMenuFocus(entries, entries.length, -1))
    }
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      // Rendered invisibly at the anchor first so it can be measured, then moved into place.
      style={{ left: position?.x ?? anchor.x, top: position?.y ?? anchor.y, visibility: position ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') return <div key={entry.id} className="context-menu-separator" role="separator" />
        if (entry.kind === 'label') return <div key={entry.id} className="context-menu-label" dir="auto" title={entry.label}>{entry.label}</div>
        const Icon = entry.icon
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            data-menu-index={index}
            className={entry.danger ? 'danger' : undefined}
            disabled={entry.disabled}
            tabIndex={index === focusIndex ? 0 : -1}
            onPointerEnter={() => { if (!entry.disabled) setFocusIndex(index) }}
            onClick={() => {
              onClose()
              onSelect(entry.id)
            }}
          >
            {Icon ? <Icon size={13} /> : <span className="context-menu-icon-gap" />}
            <span>{entry.label}</span>
          </button>
        )
      })}
    </div>
  )
}
