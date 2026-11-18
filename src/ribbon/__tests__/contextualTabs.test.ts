import { beforeEach, describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { createMapLayer } from '../../geo'
import { createRasterGrid, rasterToFeatureCollection } from '../../rasterEngine'
import { useArcWebStore, type ContextualTab, type MapLayer } from '../../store'
import {
  migrateTabId, CORE_TABS, getVisibleContextualTabs, hasPendingEdits, isEditingTool, isRasterLayer, reconcileRibbonTabs,
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

describe('contextual groups', () => {
  const feature: ContextualTab[] = ['FeatureAppearance', 'FeatureLabeling', 'FeatureData']
  const raster: ContextualTab[] = ['RasterAppearance', 'RasterData']
  const layout: ContextualTab[] = ['LayoutInsert', 'LayoutExport']
  it('shows three feature tabs and activates Appearance from Map', () => {
    expect(getVisibleContextualTabs({ selectedLayer: vectorLayer(), viewMode: 'map' })).toEqual(feature)
    expect(reconcileRibbonTabs({ activeTab: 'Map', returnTab: 'Map' }, [], feature)).toEqual({ activeTab: 'FeatureAppearance', returnTab: 'Map' })
  })
  it('shows raster tabs and preserves Data when changing layer type', () => {
    expect(isRasterLayer(rasterLayer())).toBe(true)
    expect(getVisibleContextualTabs({ selectedLayer: rasterLayer(), viewMode: 'map' })).toEqual(raster)
    expect(reconcileRibbonTabs({ activeTab: 'FeatureData', returnTab: 'Insert' }, feature, raster)).toEqual({ activeTab: 'RasterData', returnTab: 'Insert' })
  })
  it('shows Layout only in layout view and returns when leaving it', () => {
    expect(getVisibleContextualTabs({ selectedLayer: null, viewMode: 'layout' })).toEqual(layout)
    const state = reconcileRibbonTabs({ activeTab: 'View', returnTab: 'Map' }, [], layout)
    expect(state).toEqual({ activeTab: 'LayoutInsert', returnTab: 'View' })
    expect(reconcileRibbonTabs(state, layout, [])).toEqual({ activeTab: 'View', returnTab: 'Map' })
    expect(getVisibleContextualTabs({ selectedLayer: vectorLayer(), viewMode: 'layout' })).toEqual([...feature, ...layout])
  })
  it('does not steal focus from Analysis', () => {
    const state = { activeTab: 'Analysis' as const, returnTab: 'Map' as const }
    expect(reconcileRibbonTabs(state, [], feature)).toBe(state)
  })
  it('standalone tables have no layer group', () => {
    expect(getVisibleContextualTabs({ selectedLayer: { ...vectorLayer(), geometry: 'Unknown' }, viewMode: 'map' })).toEqual([])
  })
  it('returns to the previous core tab when a layer is deselected', () => {
    expect(reconcileRibbonTabs({ activeTab: 'FeatureLabeling', returnTab: 'Insert' }, feature, [])).toEqual({ activeTab: 'Insert', returnTab: 'Map' })
  })
  it('does not change tabs when the context stays the same', () => {
    const state = { activeTab: 'FeatureData' as const, returnTab: 'Map' as const }
    expect(reconcileRibbonTabs(state, feature, feature)).toBe(state)
  })
  it('keeps Edit permanent and recognizes editing tools', () => {
    expect(CORE_TABS).toEqual(['Map', 'Insert', 'Analysis', 'Edit', 'View', 'Share'])
    expect(isEditingTool('draw-point')).toBe(true)
    expect(isEditingTool('pan')).toBe(false)
  })
  it('migrates legacy ids and safely defaults unknown ids', () => {
    expect(migrateTabId('FeatureLayer')).toBe('FeatureAppearance')
    expect(migrateTabId('RasterLayer')).toBe('RasterAppearance')
    expect(migrateTabId('EditSession')).toBe('Edit')
    expect(migrateTabId('Layout')).toBe('Map')
    expect(migrateTabId('FeatureData')).toBe('FeatureData')
    expect(migrateTabId('bad')).toBe('Map')
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
