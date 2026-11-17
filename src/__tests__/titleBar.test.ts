// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import type { ComponentProps } from 'react'
import TitleBar from '../shell/TitleBar'
import { renderComponent } from './helpers/renderComponent'

function props(overrides: Partial<ComponentProps<typeof TitleBar>> = {}): ComponentProps<typeof TitleBar> {
  return {
    projectName: 'Gaza wells',
    onRename: vi.fn(),
    saveState: 'saved',
    saveError: '',
    quickAccess: { onSave: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onOpen: vi.fn(), canUndo: true, canRedo: false },
    ...overrides,
  }
}
const qat = (label: string) => document.querySelector(`.quick-access [aria-label="${label}"]`) as HTMLButtonElement

describe('TitleBar', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('QAT buttons call their handlers and disable Undo/Redo by state', () => {
    const quickAccess = { onSave: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onOpen: vi.fn(), canUndo: true, canRedo: false }
    renderComponent(createElement(TitleBar, props({ quickAccess })))
    expect([...document.querySelectorAll('.quick-access button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Save', 'Undo', 'Redo', 'Open'])
    act(() => qat('Save').click())
    act(() => qat('Undo').click())
    act(() => qat('Open').click())
    expect(quickAccess.onSave).toHaveBeenCalledTimes(1)
    expect(quickAccess.onUndo).toHaveBeenCalledTimes(1)
    expect(quickAccess.onOpen).toHaveBeenCalledTimes(1)
    expect(qat('Undo').disabled).toBe(false)
    expect(qat('Redo').disabled).toBe(true)
  })

  it('shows the project name with the application name', () => {
    renderComponent(createElement(TitleBar, props()))
    expect((document.querySelector('input[aria-label="Project name"]') as HTMLInputElement).value).toBe('Gaza wells')
    expect(document.querySelector('.title-bar-title')?.textContent).toContain('— ArcWeb')
  })

  it('renames as the user types', () => {
    const onRename = vi.fn()
    renderComponent(createElement(TitleBar, props({ onRename })))
    const input = document.querySelector('input[aria-label="Project name"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'غزة')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onRename).toHaveBeenLastCalledWith('غزة')
  })

  it('empty project name falls back to "Untitled map" on blur', () => {
    const onRename = vi.fn()
    renderComponent(createElement(TitleBar, props({ projectName: '   ', onRename })))
    const input = document.querySelector('input[aria-label="Project name"]') as HTMLInputElement
    act(() => { input.focus(); input.blur() })
    expect(onRename).toHaveBeenCalledWith('Untitled map')
  })

  it('announces the save state', () => {
    const { rerender } = renderComponent(createElement(TitleBar, props({ saveState: 'saving' })))
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Saving')
    rerender(createElement(TitleBar, props({ saveState: 'error', saveError: 'Quota exceeded' })))
    const status = document.querySelector('[role="status"]')!
    expect(status.textContent).toContain('Save failed')
    expect(status.getAttribute('title')).toBe('Quota exceeded')
  })

  it('renders right-hand slot content', () => {
    renderComponent(createElement(TitleBar, props(), createElement('span', { id: 'slot' }, 'extra')))
    expect(document.getElementById('slot')).not.toBeNull()
  })
})
