// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import type { ComponentProps } from 'react'
import { EditRibbon } from '../CoreRibbons'
import { renderComponent } from '../../__tests__/helpers/renderComponent'

type Props = ComponentProps<typeof EditRibbon>
function props(overrides: Partial<Props> = {}): Props {
  return {
    tool: 'pan', hasLayer: true, selectedFeatureIsEditable: true, pendingEdits: true, canUndo: true, canRedo: false,
    hasSelection: true, snapping: { enabled: true, tolerancePx: 10 },
    onSetTool: vi.fn(), onSave: vi.fn(), onDiscard: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
    onSnapping: vi.fn(), onDeleteSelected: vi.fn(), onSelectTool: vi.fn(), onClearSelection: vi.fn(),
    ...overrides,
  }
}
const command = (id: string) => document.querySelector(`[data-command="${id}"]`) as HTMLButtonElement
const arrowOf = (id: string) => command(id).parentElement!.querySelector('.ribbon-split-arrow') as HTMLButtonElement
const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[]

describe('Edit tab', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('shows Pro groups in order', () => {
    renderComponent(createElement(EditRibbon, props()))
    expect([...document.querySelectorAll('.ribbon-group[role="group"]')].map((group) => group.getAttribute('aria-label')))
      .toEqual(['Manage Edits', 'Snapping', 'Features', 'Selection'])
  })

  it('Edit ribbon disables Save/Discard without pending edits', () => {
    renderComponent(createElement(EditRibbon, props({ pendingEdits: false, canUndo: false })))
    expect(command('save-edits').disabled).toBe(true)
    expect(command('discard-edits').disabled).toBe(true)
    expect(command('undo-edit').disabled).toBe(true)
    expect(command('redo-edit').disabled).toBe(true)
  })

  it('saves, discards, undoes and redoes', () => {
    const p = props({ canRedo: true })
    renderComponent(createElement(EditRibbon, p))
    act(() => command('save-edits').click())
    act(() => command('discard-edits').click())
    act(() => command('undo-edit').click())
    act(() => command('redo-edit').click())
    expect([p.onSave, p.onDiscard, p.onUndo, p.onRedo].map((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1, 1])
  })

  it('toggles snapping and picks a tolerance', () => {
    const onSnapping = vi.fn()
    renderComponent(createElement(EditRibbon, props({ onSnapping })))
    expect(command('snapping').getAttribute('aria-pressed')).toBe('true')
    act(() => command('snapping').click())
    expect(onSnapping).toHaveBeenLastCalledWith({ enabled: false, tolerancePx: 10 })
    act(() => arrowOf('snapping').click())
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(['5 px', '10 px ✓', '15 px', '20 px'])
    act(() => menuItems()[3].click())
    expect(onSnapping).toHaveBeenLastCalledWith({ enabled: true, tolerancePx: 20 })
  })

  it('Create offers the construction tools for the target layer', () => {
    const onSetTool = vi.fn()
    renderComponent(createElement(EditRibbon, props({ onSetTool })))
    act(() => command('create-features').click())
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(['Point', 'Line', 'Polygon'])
    act(() => menuItems()[1].click())
    expect(onSetTool).toHaveBeenCalledWith('draw-line')
  })

  it('Move Vertex needs an editable selected feature and toggles off when active', () => {
    const onSetTool = vi.fn()
    const { rerender } = renderComponent(createElement(EditRibbon, props({ selectedFeatureIsEditable: false })))
    expect(command('move-vertex').disabled).toBe(true)
    rerender(createElement(EditRibbon, props({ tool: 'move-vertex', onSetTool })))
    expect(command('move-vertex').getAttribute('aria-pressed')).toBe('true')
    act(() => command('move-vertex').click())
    expect(onSetTool).toHaveBeenCalledWith('pan')
  })

  it('Delete and Clear need a selection', () => {
    const p = props({ hasSelection: false })
    renderComponent(createElement(EditRibbon, p))
    expect(command('delete-features').disabled).toBe(true)
    expect(command('edit-clear-selection').disabled).toBe(true)
  })
})
