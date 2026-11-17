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

describe('Escape from ribbon popovers', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function windowEscapeSpy() {
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    return { spy, stop: () => window.removeEventListener('keydown', spy) }
  }

  it('closes an open collapsed group from its trigger without reaching window handlers', () => {
    const { container } = renderComponent(createElement(RibbonGroup, { label: 'Navigate', icon: MapIcon, collapsed: true },
      createElement(RibbonButton, { id: 'explore', label: 'Explore', icon: MousePointer2, size: 'large', onClick: () => {} }),
    ))
    const trigger = container.querySelector('[role="group"] > button') as HTMLButtonElement
    act(() => { trigger.focus(); trigger.click() })
    const { spy, stop } = windowEscapeSpy()
    key(document.activeElement ?? trigger, 'Escape')
    stop()
    expect(document.querySelector('[aria-label="Explore"]')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })

  it('moves focus into a collapsed group when it opens', () => {
    const { container } = renderComponent(createElement(RibbonGroup, { label: 'Navigate', icon: MapIcon, collapsed: true },
      createElement(RibbonButton, { id: 'explore', label: 'Explore', icon: MousePointer2, size: 'large', onClick: () => {} }),
    ))
    act(() => (container.querySelector('[role="group"] > button') as HTMLButtonElement).click())
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Explore')
  })

  it('closes a menu whose items are all disabled from its trigger', () => {
    const { container } = renderComponent(createElement(RibbonMenuButton, {
      id: 'm', label: 'Measure', icon: Ruler, size: 'large', items: [{ id: 'a', label: 'Area', onSelect: () => {}, disabled: true }],
    }))
    const trigger = container.querySelector('button')!
    act(() => { trigger.focus(); trigger.click() })
    const { spy, stop } = windowEscapeSpy()
    key(document.activeElement ?? trigger, 'Escape')
    stop()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('lets Escape through when nothing is open', () => {
    const { container } = renderComponent(createElement(RibbonMenuButton, {
      id: 'm', label: 'Measure', icon: Ruler, size: 'large', items: [{ id: 'a', label: 'Area', onSelect: () => {} }],
    }))
    const { spy, stop } = windowEscapeSpy()
    key(container.querySelector('button')!, 'Escape')
    stop()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('pressed state and captions', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('a split menu button shows its pressed state on the main part', () => {
    const { container } = renderComponent(createElement(RibbonMenuButton, {
      id: 'measure', label: 'Measure', icon: Ruler, size: 'large', split: true, pressed: true, onClick: () => {},
      items: [{ id: 'a', label: 'Area', onSelect: () => {} }],
    }))
    const main = container.querySelector('[data-command="measure"]')!
    expect(main.getAttribute('aria-pressed')).toBe('true')
    expect(main.classList.contains('is-pressed')).toBe(true)
  })

  it('a group can show a caption different from its label', () => {
    const { container } = renderComponent(createElement(RibbonGroup, { label: 'Selection', caption: 'Selection · 3 selected' },
      createElement(RibbonButton, { id: 'x', label: 'Clear', icon: Ruler, size: 'small', onClick: () => {} }),
    ))
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Selection')
    expect(container.querySelector('.ribbon-group-caption')?.textContent).toBe('Selection · 3 selected')
  })
})
