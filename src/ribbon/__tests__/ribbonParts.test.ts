// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { Map as MapIcon, MousePointer2, Ruler } from 'lucide-react'
import { RibbonButton, RibbonGallery, RibbonGroup, RibbonMenuButton } from '../RibbonParts'
import { renderComponent } from '../../__tests__/helpers/renderComponent'

const key = (target: Element, name: string) =>
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })

describe('ribbon parts', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('renders large and small buttons with their own tooltip', () => {
    const { container } = renderComponent(createElement('div', null,
      createElement(RibbonButton, { id: 'explore', label: 'Explore', icon: MousePointer2, size: 'large', tooltip: { title: 'Explore', shortcut: 'Esc' }, onClick: () => {} }),
      createElement(RibbonButton, { id: 'zoom-in', label: 'Zoom In', icon: MapIcon, size: 'small', onClick: () => {} }),
    ))
    const [large, small] = container.querySelectorAll('button')
    expect(large.classList.contains('ribbon-button-large')).toBe(true)
    expect(large.dataset.ribbonTooltip).toBe('Explore (Esc)')
    expect(large.getAttribute('aria-label')).toBe('Explore')
    expect(small.classList.contains('ribbon-button-small')).toBe(true)
    // Without an explicit tooltip the label is used.
    expect(small.dataset.ribbonTooltip).toBe('Zoom In')
  })

  it('reports a toggle state only when pressed is given', () => {
    const { container } = renderComponent(createElement('div', null,
      createElement(RibbonButton, { id: 'a', label: 'Snapping', icon: Ruler, size: 'large', pressed: true, onClick: () => {} }),
      createElement(RibbonButton, { id: 'b', label: 'Full Extent', icon: Ruler, size: 'small', onClick: () => {} }),
    ))
    const [toggle, plain] = container.querySelectorAll('button')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(plain.hasAttribute('aria-pressed')).toBe(false)
  })

  it('menu button opens with Enter, closes with Escape and returns focus', () => {
    const onSelect = vi.fn()
    const { container } = renderComponent(createElement(RibbonMenuButton, {
      id: 'measure', label: 'Measure', icon: Ruler, size: 'large',
      items: [{ id: 'distance', label: 'Distance', onSelect }, { id: 'area', label: 'Area', onSelect: () => {} }],
    }))
    const trigger = container.querySelector('button')!
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    act(() => trigger.focus())
    key(trigger, 'Enter')
    const items = document.querySelectorAll('[role="menuitem"]')
    expect(items).toHaveLength(2)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    key(items[0], 'Escape')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('menu item runs its action and closes the menu', () => {
    const onSelect = vi.fn()
    const { container } = renderComponent(createElement(RibbonMenuButton, {
      id: 'measure', label: 'Measure', icon: Ruler, size: 'large', items: [{ id: 'area', label: 'Area', onSelect }],
    }))
    act(() => container.querySelector('button')!.click())
    act(() => (document.querySelector('[role="menuitem"]') as HTMLElement).click())
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('closes the menu on an outside pointer press', () => {
    const { container } = renderComponent(createElement(RibbonMenuButton, {
      id: 'm', label: 'Measure', icon: Ruler, size: 'large', items: [{ id: 'a', label: 'Area', onSelect: () => {} }],
    }))
    act(() => container.querySelector('button')!.click())
    act(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('split menu button runs the main action without opening the menu', () => {
    const onClick = vi.fn()
    const { container } = renderComponent(createElement(RibbonMenuButton, {
      id: 'measure', label: 'Measure', icon: Ruler, size: 'large', split: true, onClick,
      items: [{ id: 'area', label: 'Area', onSelect: () => {} }],
    }))
    const [main, arrow] = container.querySelectorAll('button')
    act(() => main.click())
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    act(() => arrow.click())
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('skips disabled menu items', () => {
    const onSelect = vi.fn()
    const { container } = renderComponent(createElement(RibbonMenuButton, {
      id: 'm', label: 'Measure', icon: Ruler, size: 'large', items: [{ id: 'a', label: 'Area', onSelect, disabled: true }],
    }))
    act(() => container.querySelector('button')!.click())
    const item = document.querySelector('[role="menuitem"]') as HTMLButtonElement
    expect(item.disabled).toBe(true)
  })

  it('gallery marks the selected item and reports a choice', () => {
    const onSelect = vi.fn()
    const { container } = renderComponent(createElement(RibbonGallery, {
      id: 'basemap', label: 'Basemap', icon: MapIcon, onSelect,
      items: [
        { id: 'osm', label: 'Streets', preview: createElement('span'), selected: true },
        { id: 'dark', label: 'Dark Gray', preview: createElement('span') },
      ],
    }))
    act(() => container.querySelector('button')!.click())
    const options = document.querySelectorAll('[role="option"]')
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    act(() => (options[1] as HTMLElement).click())
    expect(onSelect).toHaveBeenCalledWith('dark')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('a collapsed group shows one button that opens its commands', () => {
    const { container } = renderComponent(createElement(RibbonGroup, { label: 'Navigate', icon: MapIcon, collapsed: true },
      createElement(RibbonButton, { id: 'explore', label: 'Explore', icon: MousePointer2, size: 'large', onClick: () => {} }),
    ))
    const group = container.querySelector('[role="group"]')!
    expect(group.getAttribute('aria-label')).toBe('Navigate')
    expect(container.querySelector('[aria-label="Explore"]')).toBeNull()
    act(() => (group.querySelector('button') as HTMLElement).click())
    expect(document.querySelector('[aria-label="Explore"]')).not.toBeNull()
  })

  it('an expanded group shows its commands and caption', () => {
    const { container } = renderComponent(createElement(RibbonGroup, { label: 'Navigate' },
      createElement(RibbonButton, { id: 'explore', label: 'Explore', icon: MousePointer2, size: 'large', onClick: () => {} }),
    ))
    expect(container.querySelector('[aria-label="Explore"]')).not.toBeNull()
    expect(container.querySelector('.ribbon-group-caption')?.textContent).toBe('Navigate')
  })
})

describe('useRibbonCollapse', () => {
  it('collapses groups that do not fit and remembers their expanded width', async () => {
    const { useRibbonCollapse } = await import('../useRibbonCollapse')
    const { useRef } = await import('react')
    let resize: (() => void) | null = null
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
    let toolbarWidth = 1000
    const widths = [200, 150, 120]
    const seen: boolean[][] = []
    function Toolbar() {
      const ref = useRef<HTMLDivElement>(null)
      const collapsed = useRibbonCollapse(ref)
      seen.push(collapsed)
      return createElement('div', { ref, 'data-testid': 'toolbar' }, widths.map((_, index) =>
        createElement('div', { key: index, className: 'ribbon-group', 'data-collapsed': String(collapsed[index] ?? false) })))
    }
    const { container } = renderComponent(createElement(Toolbar))
    const toolbar = container.querySelector('[data-testid="toolbar"]') as HTMLElement
    Object.defineProperty(toolbar, 'clientWidth', { get: () => toolbarWidth })
    toolbar.querySelectorAll<HTMLElement>('.ribbon-group').forEach((group, index) => {
      group.getBoundingClientRect = () => ({ width: group.dataset.collapsed === 'true' ? 56 : widths[index] }) as DOMRect
    })
    act(() => resize?.())
    expect(seen.at(-1)).toEqual([false, false, false])
    toolbarWidth = 420
    act(() => resize?.())
    expect(seen.at(-1)).toEqual([false, false, true])
    // The collapsed group now measures 56px, but widening restores it from its remembered width.
    toolbarWidth = 1000
    act(() => resize?.())
    expect(seen.at(-1)).toEqual([false, false, false])
    vi.unstubAllGlobals()
  })
})
