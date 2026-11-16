import { beforeEach, describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { createMapLayer } from '../../geo'
import { createRasterGrid, rasterToFeatureCollection } from '../../rasterEngine'
import { useArcWebStore, type ContextualTab, type MapLayer } from '../../store'
import {
  CORE_TABS, getVisibleContextualTabs, hasPendingEdits, isEditingTool, isRasterLayer, reconcileRibbonTabs,
} from '../contextualTabs'

const points: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'a', properties: { name: 'A', pop: 10 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    { type: 'Feature', id: 'b', properties: { name: 'B', pop: 20 }, geometry: { type: 'Point', coordinates: [1, 1] } },
  ],
}

function vectorLayer(): MapLayer {
  return createMapLayer('Cities', points)
}

function rasterLayer(): MapLayer {
  const grid = createRasterGrid(2, 2, [1, 2, 3, 4], { origin: [0, 2], resolution: [1, -1] })
  return createMapLayer('Elevation', rasterToFeatureCollection(grid))
}

describe('contextual tab visibility', () => {
  it('shows no contextual tabs without a selected layer or editing', () => {
    expect(getVisibleContextualTabs({ selectedLayer: null, tool: 'pan', pendingEdits: false })).toEqual([])
  })

  it('shows the Feature Layer tab for a selected vector layer', () => {
    const layer = vectorLayer()
    expect(isRasterLayer(layer)).toBe(false)
    expect(getVisibleContextualTabs({ selectedLayer: layer, tool: 'pan', pendingEdits: false })).toEqual(['FeatureLayer'])
  })

  it('shows the Raster Layer tab (not Feature Layer) for a selected raster layer', () => {
    const layer = rasterLayer()
    expect(isRasterLayer(layer)).toBe(true)
    expect(getVisibleContextualTabs({ selectedLayer: layer, tool: 'pan', pendingEdits: false })).toEqual(['RasterLayer'])
  })

  it('shows no appearance tab for a standalone table', () => {
    const table = { ...vectorLayer(), geometry: 'Unknown' as const }
    expect(getVisibleContextualTabs({ selectedLayer: table, tool: 'pan', pendingEdits: false })).toEqual([])
  })

  it.each(['draw-point', 'draw-line', 'draw-polygon', 'move-vertex'] as const)('shows the Edit tab while %s is active', (tool) => {
    expect(isEditingTool(tool)).toBe(true)
    expect(getVisibleContextualTabs({ selectedLayer: vectorLayer(), tool, pendingEdits: false })).toEqual(['EditSession', 'FeatureLayer'])
  })

  it.each(['pan', 'distance', 'area'] as const)('does not treat %s as editing', (tool) => {
    expect(isEditingTool(tool)).toBe(false)
    expect(getVisibleContextualTabs({ selectedLayer: null, tool, pendingEdits: false })).toEqual([])
  })

  it('keeps the Edit tab while edits are unsaved, even after leaving the editing tools', () => {
    expect(getVisibleContextualTabs({ selectedLayer: null, tool: 'pan', pendingEdits: true })).toEqual(['EditSession'])
  })
})

describe('core tab order', () => {
  it('orders core tabs with View between Edit and Layout', () => {
    expect(CORE_TABS).toEqual(['Map', 'Insert', 'Analysis', 'Edit', 'View', 'Layout', 'Share'])
  })

  it('treats View as neutral: a newly selected vector layer takes over the ribbon', () => {
    expect(reconcileRibbonTabs({ activeTab: 'View', returnTab: 'Map' }, [], ['FeatureLayer'])).toEqual({ activeTab: 'FeatureLayer', returnTab: 'View' })
  })
})

describe('contextual tab activation', () => {
  const run = (activeTab: Parameters<typeof reconcileRibbonTabs>[0]['activeTab'], prev: ContextualTab[], next: ContextualTab[], returnTab: typeof activeTab = 'Map') =>
    reconcileRibbonTabs({ activeTab, returnTab }, prev, next)

  it('switches to the Feature Layer tab from the Map tab and remembers Map', () => {
    expect(run('Map', [], ['FeatureLayer'])).toEqual({ activeTab: 'FeatureLayer', returnTab: 'Map' })
  })

  it('only highlights a layer tab while a workflow tab such as Analysis is active', () => {
    expect(run('Analysis', [], ['FeatureLayer'])).toEqual({ activeTab: 'Analysis', returnTab: 'Map' })
    expect(run('Layout', [], ['RasterLayer'])).toEqual({ activeTab: 'Layout', returnTab: 'Map' })
  })

  it('reverts to the previous tab when the layer is deselected', () => {
    expect(run('FeatureLayer', ['FeatureLayer'], [], 'Insert')).toEqual({ activeTab: 'Insert', returnTab: 'Map' })
  })

  it('moves from the Feature Layer tab to the Raster Layer tab when a raster is selected instead', () => {
    expect(run('FeatureLayer', ['FeatureLayer'], ['RasterLayer'], 'Insert')).toEqual({ activeTab: 'RasterLayer', returnTab: 'Insert' })
  })

  it('always switches to the Edit tab when editing starts and returns when it ends', () => {
    const started = run('Edit', ['FeatureLayer'], ['EditSession', 'FeatureLayer'])
    expect(started).toEqual({ activeTab: 'EditSession', returnTab: 'Edit' })
    expect(reconcileRibbonTabs(started, ['EditSession', 'FeatureLayer'], ['FeatureLayer'])).toEqual({ activeTab: 'Edit', returnTab: 'Map' })
  })

  it('returns to a still-visible contextual tab after editing finishes', () => {
    const started = run('FeatureLayer', ['FeatureLayer'], ['EditSession', 'FeatureLayer'])
    expect(started).toEqual({ activeTab: 'EditSession', returnTab: 'FeatureLayer' })
    expect(reconcileRibbonTabs(started, ['EditSession', 'FeatureLayer'], ['FeatureLayer']).activeTab).toBe('FeatureLayer')
  })

  it('falls back to Map when the remembered tab has also disappeared', () => {
    expect(run('EditSession', ['EditSession', 'FeatureLayer'], [], 'FeatureLayer').activeTab).toBe('Map')
  })

  it('leaves the ribbon alone when nothing appears or disappears', () => {
    const state = { activeTab: 'Share' as const, returnTab: 'Map' as const }
    expect(reconcileRibbonTabs(state, ['FeatureLayer'], ['FeatureLayer'])).toBe(state)
  })
})

describe('edit session store', () => {
  beforeEach(() => {
    useArcWebStore.getState().clearSession()
    useArcWebStore.getState().setActiveTab('Map')
  })

  it('remembers the core tab when a contextual tab is opened by hand', () => {
    useArcWebStore.getState().setActiveTab('Analysis')
    useArcWebStore.getState().setActiveTab('FeatureLayer')
    expect(useArcWebStore.getState().ribbonReturnTab).toBe('Analysis')
  })

  it('discards edits by restoring the snapshot taken when editing began', () => {
    const store = useArcWebStore.getState()
    const layer = vectorLayer()
    store.addLayer(layer)
    store.beginEdit(layer.id)
    store.setTool('draw-point')
    const original = useArcWebStore.getState().layers[0].data
    store.updateLayer(layer.id, { data: { ...original, features: original.features.slice(1) } })
    expect(hasPendingEdits(useArcWebStore.getState().layers, useArcWebStore.getState().editSnapshots)).toBe(true)

    useArcWebStore.getState().discardEdits()
    const after = useArcWebStore.getState()
    expect(after.layers[0].data).toBe(original)
    expect(after.editSnapshots).toEqual({})
    expect(after.tool).toBe('pan')
  })

  it('saves edits by dropping snapshots and keeping the edited data', () => {
    const store = useArcWebStore.getState()
    const layer = vectorLayer()
    store.addLayer(layer)
    store.beginEdit(layer.id)
    const edited = { ...layer.data, features: [] }
    store.updateLayer(layer.id, { data: edited })
    useArcWebStore.getState().saveEdits()
    expect(useArcWebStore.getState().layers[0].data).toBe(edited)
    expect(hasPendingEdits(useArcWebStore.getState().layers, useArcWebStore.getState().editSnapshots)).toBe(false)
  })

  it('drops untouched snapshots when the editing tool is put away', () => {
    const store = useArcWebStore.getState()
    const layer = vectorLayer()
    store.addLayer(layer)
    store.beginEdit(layer.id)
    store.setTool('draw-point')
    useArcWebStore.getState().setTool('pan')
    expect(useArcWebStore.getState().editSnapshots).toEqual({})
  })
})
