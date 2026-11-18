// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import type { ComponentProps } from 'react'
import { LayoutRibbon } from '../LayoutRibbon'
import { RasterLayerRibbon } from '../LayerRibbons'
import { insertableElements } from '../../layout/catalog'
import { createMapLayer } from '../../geo'
import { renderComponent } from '../../__tests__/helpers/renderComponent'
const command = (id: string) => document.querySelector(`[data-command="${id}"]`) as HTMLButtonElement
function props(overrides: Partial<ComponentProps<typeof LayoutRibbon>> = {}): ComponentProps<typeof LayoutRibbon> {
  return { tab: 'LayoutInsert', paper: 'A4', orientation: 'landscape', exporting: false, onPage: vi.fn(), onInsert: vi.fn(), onExport: vi.fn(), onClose: vi.fn(), ...overrides }
}
afterEach(() => { document.body.innerHTML = '' })
describe('Layout contextual ribbons', () => {
  it('Insert lists and invokes every supported element', () => {
    const p = props(); renderComponent(createElement(LayoutRibbon, p))
    for (const { type } of insertableElements) { act(() => command('layout-insert-' + type).click()); expect(p.onInsert).toHaveBeenLastCalledWith(type) }
    expect(command('layout-export-png')).toBeNull()
  })
  it('Export passes the chosen DPI to both formats', () => {
    const p = props({ tab: 'LayoutExport' }); renderComponent(createElement(LayoutRibbon, p))
    act(() => command('layout-dpi').click())
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(x => x.textContent?.includes('300 DPI')) as HTMLButtonElement
    act(() => item.click())
    act(() => command('layout-export-png').click()); expect(p.onExport).toHaveBeenLastCalledWith('png', 300)
    act(() => command('layout-export-pdf').click()); expect(p.onExport).toHaveBeenLastCalledWith('pdf', 300)
  })
  it('Close Layout invokes the map-view callback and is disabled during export', () => {
    const p = props({ tab: 'LayoutExport' }); const view = renderComponent(createElement(LayoutRibbon, p))
    act(() => command('layout-close').click()); expect(p.onClose).toHaveBeenCalledOnce()
    view.rerender(createElement(LayoutRibbon, { ...p, exporting: true }))
    expect(command('layout-close').disabled).toBe(true)
    expect(command('layout-export-pdf').disabled).toBe(true)
  })
  it('changes page size while retaining orientation', () => {
    const p = props(); renderComponent(createElement(LayoutRibbon, p)); act(() => command('layout-paper').click())
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(x => x.textContent?.includes('US Letter')) as HTMLButtonElement
    act(() => item.click()); expect(p.onPage).toHaveBeenCalledWith('Letter', 'landscape')
  })
})
describe('Raster Data', () => {
  it('opens the table and exports CSV without appearance controls', () => {
    const onTable = vi.fn(), onExport = vi.fn()
    renderComponent(createElement(RasterLayerRibbon, { tab: 'RasterData', layer: createMapLayer('Raster', { type: 'FeatureCollection', features: [] }), onUpdate: vi.fn(), onZoomToLayer: vi.fn(), onError: vi.fn(), onTable, onExport }))
    act(() => command('raster-table').click()); expect(onTable).toHaveBeenCalledOnce()
    expect(document.querySelector('[aria-label="Stretch type"]')).toBeNull()
    act(() => command('raster-export').click())
    const csv = [...document.querySelectorAll('[role="menuitem"]')].find(x => x.textContent === 'CSV') as HTMLButtonElement
    act(() => csv.click()); expect(onExport).toHaveBeenCalledWith('csv')
  })
})
