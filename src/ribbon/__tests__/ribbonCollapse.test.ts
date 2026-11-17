// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useRef } from 'react'
import { useRibbonCollapse } from '../useRibbonCollapse'
import { renderComponent } from '../../__tests__/helpers/renderComponent'

/** Expanded widths by group label; a collapsed group measures `collapsedWidth`. */
let expandedWidths: Record<string, number> = {}
let collapsedWidth = 80
let toolbarWidth = 1000
let resize: (() => void) | null = null
const seen: Record<string, boolean>[] = []

function Toolbar({ groups }: { groups: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const collapsed = useRibbonCollapse(ref)
  seen.push(collapsed)
  // createElement form of <div ref={ref}>: passing the ref object is not a render-time read of ref.current.
  // oxlint-disable-next-line react/refs
  return createElement('div', { ref, 'data-testid': 'toolbar' }, groups.map((label) =>
    createElement('div', { key: label, className: 'ribbon-group', 'aria-label': label, 'data-collapsed': String(collapsed[label] ?? false) })))
}

describe('useRibbonCollapse', () => {
  beforeEach(() => {
    seen.length = 0
    expandedWidths = { Navigate: 200, Layer: 150, Selection: 120 }
    collapsedWidth = 80
    toolbarWidth = 1000
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const label = this.getAttribute('aria-label') ?? ''
      const width = this.dataset.collapsed === 'true' ? collapsedWidth : expandedWidths[label] ?? 0
      return { width } as DOMRect
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'toolbar' ? toolbarWidth : 0
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('keys collapse state by group label', () => {
    renderComponent(createElement(Toolbar, { groups: ['Navigate', 'Layer', 'Selection'] }))
    toolbarWidth = 410
    act(() => resize?.())
    expect(seen.at(-1)).toEqual({ Navigate: false, Layer: true, Selection: true })
  })

  it('uses the measured collapsed width instead of assuming 56px', () => {
    renderComponent(createElement(Toolbar, { groups: ['Navigate', 'Layer', 'Selection'] }))
    collapsedWidth = 56
    toolbarWidth = 410
    act(() => resize?.())
    // With the assumed default (77px) both would collapse; once a collapsed group measures 56px, only one needs to.
    act(() => resize?.())
    expect(seen.at(-1)).toEqual({ Navigate: false, Layer: false, Selection: true })
  })

  it('re-measures when the groups change at a constant toolbar width', async () => {
    const view = renderComponent(createElement(Toolbar, { groups: ['Navigate', 'Layer', 'Selection'] }))
    toolbarWidth = 410
    act(() => resize?.())
    expect(seen.at(-1)).toMatchObject({ Layer: true, Selection: true })

    // Switching tabs replaces the groups; the toolbar keeps its size, so no resize callback fires.
    expandedWidths = { ...expandedWidths, Insert: 100, Project: 90 }
    await act(async () => {
      view.rerender(createElement(Toolbar, { groups: ['Insert', 'Project'] }))
      await Promise.resolve()
    })
    expect(seen.at(-1)).toEqual({ Insert: false, Project: false })
  })

  it('does not reuse another group’s width for a group with the same position', async () => {
    const view = renderComponent(createElement(Toolbar, { groups: ['Navigate', 'Layer', 'Selection'] }))
    toolbarWidth = 410
    act(() => resize?.())
    expandedWidths = { ...expandedWidths, Wide: 400, Narrow: 40 }
    await act(async () => {
      view.rerender(createElement(Toolbar, { groups: ['Navigate', 'Wide', 'Narrow'] }))
      await Promise.resolve()
    })
    // 200 + 400 + 40 = 640 > 410: Wide (not the old Layer width) must collapse; Narrow is too small to help.
    expect(seen.at(-1)).toEqual({ Navigate: false, Wide: true, Narrow: false })
  })
})
