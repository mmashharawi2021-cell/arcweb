import type { StateCreator } from 'zustand'
import { DEFAULT_SCENE_SETTINGS } from '../types'
import type { ArcWebState, LabelStyle, MapLayer, PointShape, StrokeDash } from '../types'

export interface LayersSlice {
  layers: MapLayer[]
  selectedLayerId: string | null
  addLayer: (layer: MapLayer) => void
  removeLayer: (id: string) => void
  updateLayer: (id: string, updates: Partial<MapLayer>) => void
  moveLayer: (id: string, direction: -1 | 1) => void
  setSelectedLayer: (id: string | null) => void
  clearSession: () => void
  restoreLayers: (layers: MapLayer[]) => void
}

function normalizeLabelStyle(style: LabelStyle | undefined, layer: MapLayer): LabelStyle {
  const source = style ?? {
    enabled: Boolean(layer.labelField),
    expression: '',
    fontSize: 11,
    color: layer.strokeColor,
    haloColor: 'rgba(18, 22, 30, 0.88)',
    haloWidth: 1.4,
    placement: 'point' as const,
    offset: 1.15,
  }
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : Boolean(layer.labelField),
    expression: typeof source.expression === 'string' ? source.expression : '',
    fontSize: Number.isFinite(source.fontSize) ? Math.max(6, Math.min(48, source.fontSize)) : 11,
    color: typeof source.color === 'string' ? source.color : layer.strokeColor,
    haloColor: typeof source.haloColor === 'string' ? source.haloColor : 'rgba(18, 22, 30, 0.88)',
    haloWidth: Number.isFinite(source.haloWidth) ? Math.max(0, Math.min(8, source.haloWidth)) : 1.4,
    placement: source.placement === 'line' ? 'line' : 'point',
    offset: Number.isFinite(source.offset) ? Math.max(-5, Math.min(5, source.offset)) : 1.15,
  }
}

export const createLayersSlice: StateCreator<ArcWebState, [], [], LayersSlice> = (set) => ({
  layers: [],
  selectedLayerId: null,
  addLayer: (layer) => set((state) => ({
    layers: [layer, ...state.layers],
    selectedLayerId: layer.id,
    selectedFeature: null,
  })),
  removeLayer: (id) => set((state) => {
    const layers = state.layers.filter((layer) => layer.id !== id)
    const removesSelection = state.selectedFeature?.layerId === id
    const selections = { ...state.selections }
    delete selections[id]
    const editSnapshots = { ...state.editSnapshots }
    delete editSnapshots[id]
    const tableViews = { ...state.tableViews }
    delete tableViews[id]
    const sceneSettings = state.sceneSettings.terrainLayerId === id
      ? { ...state.sceneSettings, terrain: state.sceneSettings.terrain === 'layer' ? 'none' as const : state.sceneSettings.terrain, terrainLayerId: null }
      : state.sceneSettings
    return {
      sceneSettings,
      tableViews,
      undoStack: state.undoStack.filter((step) => step.layerId !== id),
      redoStack: state.redoStack.filter((step) => step.layerId !== id),
      layers,
      selections,
      editSnapshots,
      selectedLayerId: state.selectedLayerId === id ? layers[0]?.id ?? null : state.selectedLayerId,
      selectedFeature: removesSelection ? null : state.selectedFeature,
      tableOpen: removesSelection ? false : state.tableOpen,
    }
  }),
  updateLayer: (id, updates) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === id ? { ...layer, ...updates } : layer),
  })),
  moveLayer: (id, direction) => set((state) => {
    const index = state.layers.findIndex((layer) => layer.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= state.layers.length) return state
    const layers = [...state.layers]
    ;[layers[index], layers[target]] = [layers[target], layers[index]]
    return { layers }
  }),
  setSelectedLayer: (selectedLayerId) => set((state) => selectedLayerId === state.selectedLayerId
    ? {}
    : { selectedLayerId, selectedFeature: null }),
  clearSession: () => set({
    layers: [],
    selectedLayerId: null,
    selectedFeature: null,
    selections: {},
    tableOpen: false,
    tool: 'pan',
    editSnapshots: {},
    undoStack: [],
    redoStack: [],
    tableViews: {},
    analysisHistory: [],
    sceneSettings: DEFAULT_SCENE_SETTINGS,
  }),
  restoreLayers: (layers) => {
    const normalized = layers.map((layer) => {
      const featureIds = new Set<string | number>()
      let idsChanged = false
      const features = layer.data.features.map((feature, index) => {
        const originalId = feature.id ?? `${layer.id}:${index}`
        let uniqueId = originalId
        let suffix = 1
        while (featureIds.has(uniqueId)) {
          uniqueId = `${String(originalId)}:${suffix}`
          suffix += 1
        }
        featureIds.add(uniqueId)
        if (feature.id === uniqueId) return feature
        idsChanged = true
        return { ...feature, id: uniqueId }
      })
      const strokeDash: StrokeDash = layer.strokeDash === 'dashed' || layer.strokeDash === 'dotted' ? layer.strokeDash : 'solid'
      const pointShape: PointShape = layer.pointShape === 'square' || layer.pointShape === 'triangle' || layer.pointShape === 'diamond'
        ? layer.pointShape
        : 'circle'
      return {
        ...layer,
        customFields: layer.customFields ?? [],
        fieldAliases: layer.fieldAliases ?? {},
        renderer: layer.renderer ?? { type: 'single' },
        strokeDash,
        fillOpacity: Number.isFinite(layer.fillOpacity) ? Math.max(0, Math.min(1, layer.fillOpacity)) : 1,
        pointShape,
        labelStyle: normalizeLabelStyle(layer.labelStyle, layer),
        sourceCrs: layer.sourceCrs ?? 'EPSG:4326',
        data: idsChanged ? { ...layer.data, features } : layer.data,
      }
    })
    set({ layers: normalized, selectedLayerId: normalized[0]?.id ?? null, selectedFeature: null, selections: {}, editSnapshots: {}, undoStack: [], redoStack: [] })
  },
})
