import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/*
 * ArcGIS Pro–style ribbon building blocks. Each button decorates itself with a styled
 * tooltip (data-ribbon-tooltip), so no tree-walking decorator is needed.
 */

export interface RibbonTooltip {
  title: string
  body?: string
  shortcut?: string
}

interface RibbonButtonProps {
  /** Command id, used by the icon registry and command search. */
  id: string
  label: string
  icon: LucideIcon
  size: 'large' | 'small'
  tooltip?: RibbonTooltip
  /** Set for toggle commands; omitted for plain actions. */
  pressed?: boolean
  disabled?: boolean
  onClick?: () => void
}

function tooltipText(label: string, tooltip?: RibbonTooltip) {
  if (!tooltip) return label
  return tooltip.shortcut ? `${tooltip.title} (${tooltip.shortcut})` : tooltip.title
}

function ButtonFace({ icon: Icon, label, size }: Pick<RibbonButtonProps, 'icon' | 'label' | 'size'>) {
  return (
    <>
      <Icon size={size === 'large' ? 32 : 16} strokeWidth={size === 'large' ? 1.6 : 2} aria-hidden="true" className="ribbon-button-icon" />
      <span className="ribbon-button-label">{label}</span>
    </>
  )
}

export function RibbonButton({ id, label, icon, size, tooltip, pressed, disabled, onClick }: RibbonButtonProps) {
  return (
    <button
      type="button"
      className={`ribbon-button ribbon-button-${size}${pressed ? ' is-pressed' : ''}`}
      data-command={id}
      aria-label={label}
      aria-pressed={pressed}
      data-ribbon-tooltip={tooltipText(label, tooltip)}
      data-ribbon-tooltip-body={tooltip?.body}
      disabled={disabled}
      onClick={onClick}
    >
      <ButtonFace icon={icon} label={label} size={size} />
    </button>
  )
}

/** Open/close state for a popover anchored in `wrapperRef`; closes on outside press or Escape. */
function usePopover(onClosed?: () => void) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const closedRef = useRef(onClosed)
  useEffect(() => { closedRef.current = onClosed })
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])
  const close = (restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) closedRef.current?.()
  }
  /**
   * Escape handler for the wrapper (trigger and popover): while open, Escape closes the popover
   * and stops there, even if focus is still on the trigger; while closed it passes through.
   */
  const onWrapperKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    close(true)
  }
  return { open, setOpen, close, wrapperRef, onWrapperKeyDown }
}

/** Moves focus between enabled items of a menu or list with the arrow keys. */
function moveFocus(event: ReactKeyboardEvent<HTMLElement>, selector: string) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)].filter((item) => !(item as HTMLButtonElement).disabled)
  if (!items.length) return
  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
  items[next].focus()
}

export interface RibbonMenuItem {
  id: string
  label: string
  icon?: LucideIcon
  disabled?: boolean
  onSelect: () => void
}

interface RibbonMenuButtonProps extends RibbonButtonProps {
  items: RibbonMenuItem[]
  /** Split button: the main part runs `onClick`, the arrow opens the menu. */
  split?: boolean
}

export function RibbonMenuButton({ items, split = false, ...button }: RibbonMenuButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { open, setOpen, close, wrapperRef, onWrapperKeyDown } = usePopover(() => triggerRef.current?.focus())

  // Focus the first enabled item when the menu opens.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open])

  const onTriggerKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
    // Prevent the browser's synthetic click, which would toggle the menu shut again.
    event.preventDefault()
    setOpen(true)
  }
  const tooltip = tooltipText(button.label, button.tooltip)
  const menuTrigger = {
    ref: triggerRef,
    type: 'button' as const,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    disabled: button.disabled,
    onKeyDown: onTriggerKeyDown,
    onClick: () => setOpen(!open),
  }

  return (
    <div ref={wrapperRef} className={`ribbon-menu ribbon-menu-${button.size}${split ? ' is-split' : ''}`} onKeyDown={onWrapperKeyDown}>
      {split ? (
        <>
          <button type="button" className={`ribbon-button ribbon-button-${button.size}`} data-command={button.id} aria-label={button.label}
            data-ribbon-tooltip={tooltip} disabled={button.disabled} onClick={button.onClick}>
            <ButtonFace icon={button.icon} label={button.label} size={button.size} />
          </button>
          <button {...menuTrigger} className="ribbon-split-arrow" aria-label={`${button.label} options`} data-ribbon-tooltip={`${button.label} options`}>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </>
      ) : (
        <button {...menuTrigger} className={`ribbon-button ribbon-button-${button.size}`} data-command={button.id} aria-label={button.label} data-ribbon-tooltip={tooltip}>
          <ButtonFace icon={button.icon} label={button.label} size={button.size} />
          <ChevronDown size={10} aria-hidden="true" className="ribbon-menu-caret" />
        </button>
      )}
      {open && (
        <div ref={menuRef} role="menu" aria-label={button.label} className="ribbon-popover ribbon-dropdown"
          onKeyDown={(event) => moveFocus(event, '[role="menuitem"]')}>
          {items.map(({ id, label, icon: Icon, disabled, onSelect }) => (
            <button key={id} type="button" role="menuitem" className="ribbon-dropdown-item" disabled={disabled}
              onClick={() => { close(true); onSelect() }}>
              {Icon ? <Icon size={16} aria-hidden="true" /> : <span className="ribbon-dropdown-spacer" />}
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface RibbonGalleryItem {
  id: string
  label: string
  preview: ReactNode
  selected?: boolean
}

interface RibbonGalleryProps {
  id: string
  label: string
  icon: LucideIcon
  items: RibbonGalleryItem[]
  onSelect: (id: string) => void
}

/** A large button that drops down a grid of choices (basemaps, tools). */
export function RibbonGallery({ id, label, icon, items, onSelect }: RibbonGalleryProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { open, setOpen, close, wrapperRef, onWrapperKeyDown } = usePopover(() => triggerRef.current?.focus())
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    ;(list?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list?.querySelector<HTMLElement>('[role="option"]'))?.focus()
  }, [open])
  return (
    <div ref={wrapperRef} className="ribbon-menu ribbon-menu-large" onKeyDown={onWrapperKeyDown}>
      <button ref={triggerRef} type="button" className="ribbon-button ribbon-button-large" data-command={id} aria-label={label}
        aria-haspopup="listbox" aria-expanded={open} data-ribbon-tooltip={label}
        onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}
        onClick={() => setOpen(!open)}>
        <ButtonFace icon={icon} label={label} size="large" />
        <ChevronDown size={10} aria-hidden="true" className="ribbon-menu-caret" />
      </button>
      {open && (
        <div ref={listRef} role="listbox" aria-label={label} className="ribbon-popover ribbon-gallery"
          onKeyDown={(event) => moveFocus(event, '[role="option"]')}>
          {items.map((item) => (
            <button key={item.id} type="button" role="option" aria-selected={Boolean(item.selected)} className="ribbon-gallery-item"
              onClick={() => { close(true); onSelect(item.id) }}>
              <span className="ribbon-gallery-preview">{item.preview}</span>
              <span className="ribbon-gallery-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface RibbonGroupProps {
  label: string
  /** Icon shown on the single button of a collapsed group. */
  icon?: LucideIcon
  collapsed?: boolean
  /** Pro's dialog launcher: the small arrow in the group caption that opens related settings. */
  onLauncher?: () => void
  children?: ReactNode
}

export function RibbonGroup({ label, icon, collapsed = false, onLauncher, children }: RibbonGroupProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const { open, setOpen, wrapperRef, onWrapperKeyDown } = usePopover(() => triggerRef.current?.focus())
  // Opening a collapsed group moves focus to its first command, as a menu does.
  useEffect(() => {
    if (open) popoverRef.current?.querySelector<HTMLElement>('button:not(:disabled), input, select, [tabindex]:not([tabindex="-1"])')?.focus()
  }, [open])
  const caption = (
    <div className="ribbon-group-caption">
      {label}
      {onLauncher && (
        <button type="button" className="ribbon-group-launcher" aria-label={`${label} settings`} data-ribbon-tooltip={`${label} settings`} onClick={onLauncher}>
          <ChevronDown size={9} aria-hidden="true" />
        </button>
      )}
    </div>
  )
  if (!collapsed) {
    return (
      <div className="ribbon-group" role="group" aria-label={label} data-collapsed="false">
        <div className="ribbon-group-body">{children}</div>
        {caption}
      </div>
    )
  }
  const Icon = icon ?? ChevronDown
  return (
    <div ref={wrapperRef} className="ribbon-group is-collapsed" role="group" aria-label={label} data-collapsed="true" onKeyDown={onWrapperKeyDown}>
      <button ref={triggerRef} type="button" className="ribbon-button ribbon-button-large" aria-expanded={open}
        data-ribbon-tooltip={label}
        onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}
        onClick={() => setOpen(!open)}>
        <ButtonFace icon={Icon} label={label} size="large" />
        <ChevronDown size={10} aria-hidden="true" className="ribbon-menu-caret" />
      </button>
      {open && (
        <div ref={popoverRef} className="ribbon-popover ribbon-group-popover" role="group" aria-label={`${label} commands`}>
          <div className="ribbon-group-body">{children}</div>
          {caption}
        </div>
      )}
    </div>
  )
}
