import { beforeEach, describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import * as store from '../index'
import { createMapLayer } from '../../geo'

const EXPECTED_STATE_KEYS: string[] = ['activeTab', 'addAnalysisRecord', 'addBookmark', 'addLayer', 'analysisHistory', 'basemap', 'beginEdit', 'bookmarks', 'clearSelection', 'clearSession', 'commitEdit', 'coordinateFormat', 'discardEdits', 'displayCrs', 'editSnapshots', 'layers', 'mapPropertiesOpen', 'measureUnits', 'moveLayer', 'projectName', 'redo', 'redoStack', 'removeBookmark', 'removeLayer', 'restoreEditSnapshots', 'restoreLayers', 'ribbonReturnTab', 'saveEdits', 'sceneSettings', 'selectedFeature', 'selectedLayerId', 'selections', 'setActiveTab', 'setAnalysisHistory', 'setBasemap', 'setBookmarks', 'setCoordinateFormat', 'setDisplayCrs', 'setMapPropertiesOpen', 'setMeasureUnits', 'setProjectName', 'setRibbonTabs', 'setSceneSettings', 'setSelectedFeature', 'setSelectedLayer', 'setSelection', 'setSnapping', 'setTableOpen', 'setTableView', 'setTableViews', 'setTheme', 'setTool', 'setViewMode', 'setWorkspaceLayout', 'snapping', 'tableOpen', 'tableViews', 'theme', 'toggleSelected', 'tool', 'undo', 'undoStack', 'updateLayer', 'viewMode', 'workspaceLayout']

const pointCollection = (x: number): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, 0] } }],
})

describe('store public API is unchanged by the split', () => {
  beforeEach(() => store.useArcWebStore.getState().clearSession())

  it('keeps every state key and action', () => {
    expect(Object.keys(store.useArcWebStore.getState()).sort()).toEqual(EXPECTED_STATE_KEYS)
  })

  it('keeps every runtime export', () => {
    expect(Object.keys(store).sort()).toEqual(['DEFAULT_SCENE_SETTINGS', 'MAX_ANALYSIS_HISTORY', 'MAX_UNDO_STEPS', 'useArcWebStore'])
  })

  it('removeLayer still clears the layer from every slice in one update', () => {
    const api = store.useArcWebStore.getState()
    const layer = createMapLayer('Points', pointCollection(1))
    api.addLayer(layer)
    api.setSelection(layer.id, [layer.data.features[0].id as string | number])
    api.setTableView(layer.id, { sort: { field: 'a', direction: 1 }, filters: {} })
    api.beginEdit(layer.id)
    store.useArcWebStore.getState().commitEdit(layer.id, pointCollection(2), 'Move')
    const before = store.useArcWebStore.getState()
    expect(before.undoStack).toHaveLength(1)
    expect(before.editSnapshots[layer.id]).toBeDefined()

    let notifications = 0
    const unsubscribe = store.useArcWebStore.subscribe(() => { notifications += 1 })
    store.useArcWebStore.getState().removeLayer(layer.id)
    unsubscribe()

    const after = store.useArcWebStore.getState()
    expect(notifications).toBe(1)
    expect(layer.id in after.selections).toBe(false)
    expect(layer.id in after.editSnapshots).toBe(false)
    expect(layer.id in after.tableViews).toBe(false)
    expect(after.undoStack.some((step) => step.layerId === layer.id)).toBe(false)
    expect(after.redoStack.some((step) => step.layerId === layer.id)).toBe(false)
  })
})
