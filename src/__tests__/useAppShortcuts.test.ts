// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { useAppShortcuts } from '../shell/useAppShortcuts'
import { renderHook as renderHookBase } from './helpers/renderHook'

// Every mounted hook keeps a window listener; unmount them all after each test.
const mounted: (() => void)[] = []
const renderHook: typeof renderHookBase = (hook, props) => {
  const view = renderHookBase(hook, props)
  mounted.push(view.unmount)
  return view
}

function press(init: KeyboardEventInit, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => { target.dispatchEvent(event) })
  return event
}

describe('useAppShortcuts', () => {
  afterEach(() => {
    mounted.splice(0).forEach((unmount) => unmount())
    document.body.innerHTML = ''
  })

  it('Ctrl+S calls save and prevents the browser dialog', () => {
    const save = vi.fn()
    renderHook(() => useAppShortcuts({ save, open: vi.fn() }), undefined)
    expect(press({ key: 's', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(press({ key: 'S', metaKey: true }).defaultPrevented).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('Ctrl+O calls open', () => {
    const open = vi.fn()
    renderHook(() => useAppShortcuts({ save: vi.fn(), open }), undefined)
    expect(press({ key: 'o', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('Alt+Q opens command search only when it is provided', () => {
    const commandSearch = vi.fn()
    const { rerender } = renderHook((props: { search?: () => void }) => useAppShortcuts({ save: vi.fn(), open: vi.fn(), commandSearch: props.search }), { search: undefined } as { search?: () => void })
    expect(press({ key: 'q', altKey: true }).defaultPrevented).toBe(false)
    rerender({ search: commandSearch })
    expect(press({ key: 'q', altKey: true }).defaultPrevented).toBe(true)
    expect(commandSearch).toHaveBeenCalledTimes(1)
  })

  it('ignores events already handled elsewhere', () => {
    const save = vi.fn()
    renderHook(() => useAppShortcuts({ save, open: vi.fn() }), undefined)
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    event.preventDefault()
    act(() => { window.dispatchEvent(event) })
    expect(save).not.toHaveBeenCalled()
  })

  it('shortcuts are ignored while typing in an input except Ctrl+S', () => {
    const save = vi.fn()
    const open = vi.fn()
    renderHook(() => useAppShortcuts({ save, open }), undefined)
    const input = document.body.appendChild(document.createElement('input'))
    press({ key: 'o', ctrlKey: true }, input)
    press({ key: 's', ctrlKey: true }, input)
    expect(open).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not react to plain keys or Ctrl+Shift+S', () => {
    const save = vi.fn()
    renderHook(() => useAppShortcuts({ save, open: vi.fn() }), undefined)
    press({ key: 's' })
    press({ key: 's', ctrlKey: true, shiftKey: true })
    expect(save).not.toHaveBeenCalled()
  })

  it('uses the latest handlers without re-registering', () => {
    const first = vi.fn()
    const second = vi.fn()
    const add = vi.spyOn(window, 'addEventListener')
    const { rerender } = renderHook((props: { save: () => void }) => useAppShortcuts({ save: props.save, open: vi.fn() }), { save: first })
    const registrations = add.mock.calls.filter(([type]) => type === 'keydown').length
    rerender({ save: second })
    press({ key: 's', ctrlKey: true })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(add.mock.calls.filter(([type]) => type === 'keydown').length).toBe(registrations)
    add.mockRestore()
  })
})
