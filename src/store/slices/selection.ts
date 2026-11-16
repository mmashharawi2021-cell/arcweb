import type { StateCreator } from 'zustand'
import type { ArcWebState, FeatureId, FeatureSelection, SelectionMethod } from '../types'

export interface SelectionSlice {
  /** The single identified / edited feature (the "primary" feature). */
  selectedFeature: FeatureSelection | null
  /** Selection sets made with the selection tools, keyed by layer ID. */
  selections: Record<string, FeatureId[]>
  setSelectedFeature: (selection: FeatureSelection | null) => void
  setSelection: (layerId: string, featureIds: FeatureId[], method?: SelectionMethod) => void
  toggleSelected: (layerId: string, featureId: FeatureId) => void
  clearSelection: () => void
}

export const createSelectionSlice: StateCreator<ArcWebState, [], [], SelectionSlice> = (set) => ({
  selectedFeature: null,
  selections: {},
  setSelectedFeature: (selectedFeature) => set({ selectedFeature }),
  setSelection: (layerId, featureIds, method = 'new') => set((state) => {
    const current = state.selections[layerId] ?? []
    const incoming = new Set(featureIds)
    const next = method === 'add' ? [...current, ...featureIds.filter((id) => !current.includes(id))]
      : method === 'remove' ? current.filter((id) => !incoming.has(id))
        : method === 'subset' ? current.filter((id) => incoming.has(id))
          : featureIds
    const selections = { ...state.selections }
    if (next.length) selections[layerId] = next
    else delete selections[layerId]
    return { selections }
  }),
  toggleSelected: (layerId, featureId) => set((state) => {
    const current = state.selections[layerId] ?? []
    const next = current.includes(featureId) ? current.filter((id) => id !== featureId) : [...current, featureId]
    const selections = { ...state.selections }
    if (next.length) selections[layerId] = next
    else delete selections[layerId]
    return { selections }
  }),
  clearSelection: () => set({ selections: {}, selectedFeature: null }),
})
