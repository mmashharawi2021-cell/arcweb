// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import type { ComponentProps } from 'react'
import { FeatureLayerRibbon } from '../LayerRibbons'
import { createMapLayer } from '../../geo'
import { renderComponent } from '../../__tests__/helpers/renderComponent'
import { scaleDenominator, zoomForScale } from '../../crs'

type Props = ComponentProps<typeof FeatureLayerRibbon>
function props(tab: Props['tab'], overrides: Partial<Props> = {}): Props {
  return { tab, layer: createMapLayer('Places', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'A', value: 10 }, geometry: { type: 'Point', coordinates: [0, 0] } }] }), currentScale: () => 12345, onUpdate: vi.fn(), onSymbology: vi.fn(), onTable: vi.fn(), onCalculate: vi.fn(), onSelect: vi.fn(), onZoomSelection: vi.fn(), onClear: vi.fn(), hasSelection: false, onExport: vi.fn(), ...overrides }
}
const command = (id: string) => document.querySelector(`[data-command="${id}"]`) as HTMLButtonElement
function change(label: string, value: string) {
  const input = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement
  act(() => { const setter = Object.getOwnPropertyDescriptor(input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!; setter.call(input, value); input.dispatchEvent(new Event(input.type === 'range' ? 'input' : 'change', { bubbles: true })) })
}
afterEach(() => { document.body.innerHTML = '' })
describe('Feature Layer ribbons', () => {
  it('Appearance transparency 30% sets opacity to 0.7', () => {
    const p = props('FeatureAppearance'); renderComponent(createElement(FeatureLayerRibbon, p))
    change('Transparency', '30'); expect(p.onUpdate).toHaveBeenCalledWith({ opacity: 0.7 })
  })
  it('supports current scale and clears an incompatible opposite limit', () => {
    const p = props('FeatureAppearance'); p.layer.maxScale = 50000
    renderComponent(createElement(FeatureLayerRibbon, p)); change('Out Beyond', 'current')
    expect(p.onUpdate).toHaveBeenCalledWith({ minScale: 12345, maxScale: undefined })
  })
  it('Labeling toggles labelStyle.enabled and supplies a default field', () => {
    const p = props('FeatureLabeling'); p.layer.labelStyle.enabled = false
    renderComponent(createElement(FeatureLayerRibbon, p)); act(() => command('layer-labels').click())
    expect(p.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ labelField: 'name', labelStyle: expect.objectContaining({ enabled: true }) }))
    expect(document.querySelector('[aria-label="Transparency"]')).toBeNull()
  })
  it('opens the expression editor and table calculator directly', () => {
    const p = props('FeatureLabeling'); const view = renderComponent(createElement(FeatureLayerRibbon, p))
    act(() => command('label-expression').click()); expect(p.onSymbology).toHaveBeenCalledWith(undefined, true)
    view.rerender(createElement(FeatureLayerRibbon, { ...p, tab: 'FeatureData' }))
    act(() => command('layer-calculate').click()); expect(p.onCalculate).toHaveBeenCalledOnce()
    expect(command('layer-clear-selection').disabled).toBe(true)
  })
})
describe('scale inverse', () => {
  it.each([0, 31.5, 70])('inverts scaleDenominator at latitude %s', latitude => {
    expect(scaleDenominator(latitude, zoomForScale(latitude, 50000))).toBeCloseTo(50000, 6)
  })
})

// Style limits apply to every representation of a layer, including labels and 3D.
describe('map scale ranges', () => {
  it('applies and clears limits without touching sources', async () => {
    const { syncLayerScaleRanges, getLayerIds } = await import('../../mapRendering')
    const p = props('FeatureAppearance'); p.layer.minScale = 500000; p.layer.maxScale = 1000
    const ids = getLayerIds(p.layer.id)
    const setLayerZoomRange = vi.fn()
    const map = { isStyleLoaded: () => true, getCenter: () => ({ lat: 31.5 }), getLayer: (id: string) => id !== ids.source, setLayerZoomRange }
    syncLayerScaleRanges(map as unknown as Parameters<typeof syncLayerScaleRanges>[0], [p.layer])
    expect(setLayerZoomRange).toHaveBeenCalledWith(ids.label, zoomForScale(31.5, 500000), zoomForScale(31.5, 1000))
    syncLayerScaleRanges(map as unknown as Parameters<typeof syncLayerScaleRanges>[0], [{ ...p.layer, minScale: undefined, maxScale: undefined }])
    expect(setLayerZoomRange).toHaveBeenCalledWith(ids.label, 0, 24)
  })
})
