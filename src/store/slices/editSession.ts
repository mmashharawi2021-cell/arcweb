import type { StateCreator } from 'zustand'
import type { FeatureCollection } from 'geojson'
import { MAX_UNDO_STEPS } from '../types'
import type { ArcWebState, EditStep } from '../types'

export interface EditSessionSlice {
  /**
   * Edit session: each layer's data as it was before the session first touched it.
   * A layer has pending edits while its current data differs from its snapshot.
   */
  editSnapshots: Record<string, FeatureCollection>
  undoStack: EditStep[]
  redoStack: EditStep[]
  /** Snapshots a layer so its edits can be discarded; no-op if the session already holds it. */
  beginEdit: (layerId: string) => void
  saveEdits: () => void
  discardEdits: () => void
  /** Replaces a layer's features as one undoable edit-session step. */
  commitEdit: (layerId: string, data: FeatureCollection, label: string) => void
  /** Returns the label of the step undone/redone, or null when there is nothing (valid) to apply. */
  undo: () => string | null
  redo: () => string | null
  /**
   * Resumes an edit session saved before a reload. Only snapshots of layers that exist and whose
   * data still differs from the snapshot are kept (anything else has nothing to discard).
   */
  restoreEditSnapshots: (snapshots: Record<string, FeatureCollection>) => void
}

export const createEditSessionSlice: StateCreator<ArcWebState, [], [], EditSessionSlice> = (set, get) => {
  /**
   * Moves one step between the undo and redo stacks. A step only applies while the layer still holds
   * the data that step produced; if something else changed the layer since (a tool, an import), the
   * history for that direction is stale and is dropped rather than overwriting newer work.
   */
  function applyHistoryStep(direction: 'undo' | 'redo'): string | null {
    const state = get()
    const from = direction === 'undo' ? state.undoStack : state.redoStack
    const step = from[from.length - 1]
    if (!step) return null
    const layer = state.layers.find((item) => item.id === step.layerId)
    const expected = direction === 'undo' ? step.after : step.before
    if (!layer || layer.data !== expected) {
      set(direction === 'undo' ? { undoStack: [] } : { redoStack: [] })
      return null
    }
    const data = direction === 'undo' ? step.before : step.after
    const remaining = from.slice(0, -1)
    const to = direction === 'undo' ? [...state.redoStack, step] : [...state.undoStack, step]
    const selectedFeature = state.selectedFeature?.layerId === step.layerId &&
      !data.features.some((feature) => feature.id === state.selectedFeature?.featureId) ? null : state.selectedFeature
    set({
      layers: state.layers.map((item) => item.id === step.layerId ? { ...item, data } : item),
      selectedFeature,
      ...(direction === 'undo' ? { undoStack: remaining, redoStack: to } : { redoStack: remaining, undoStack: to }),
    })
    return step.label
  }

  return {
    editSnapshots: {},
    undoStack: [],
    redoStack: [],
    beginEdit: (layerId) => set((state) => {
      const layer = state.layers.find((item) => item.id === layerId)
      if (!layer || layer.editable === false || state.editSnapshots[layerId]) return {}
      return { editSnapshots: { ...state.editSnapshots, [layerId]: layer.data } }
    }),
    saveEdits: () => set({ editSnapshots: {}, undoStack: [], redoStack: [], tool: 'pan' }),
    // Cross-slice: reverts layer data and drops selections on the layers that were reverted.
    discardEdits: () => set((state) => {
      const snapshots = state.editSnapshots
      const layers = state.layers.map((layer) => snapshots[layer.id] ? { ...layer, data: snapshots[layer.id] } : layer)
      const selections = Object.fromEntries(Object.entries(state.selections).filter(([layerId]) => !snapshots[layerId]))
      const selectedFeature = state.selectedFeature && snapshots[state.selectedFeature.layerId] ? null : state.selectedFeature
      return { layers, selections, selectedFeature, editSnapshots: {}, undoStack: [], redoStack: [], tool: 'pan' }
    }),
    commitEdit: (layerId, data, label) => set((state) => {
      const layer = state.layers.find((item) => item.id === layerId)
      if (!layer || layer.editable === false || layer.data === data) return {}
      return {
        layers: state.layers.map((item) => item.id === layerId ? { ...item, data } : item),
        editSnapshots: state.editSnapshots[layerId] ? state.editSnapshots : { ...state.editSnapshots, [layerId]: layer.data },
        undoStack: [...state.undoStack, { layerId, label, before: layer.data, after: data }].slice(-MAX_UNDO_STEPS),
        redoStack: [],
      }
    }),
    undo: () => applyHistoryStep('undo'),
    redo: () => applyHistoryStep('redo'),
    restoreEditSnapshots: (snapshots) => set((state) => ({
      editSnapshots: Object.fromEntries(Object.entries(snapshots).filter(([layerId, snapshot]) => {
        const layer = state.layers.find((item) => item.id === layerId)
        return Boolean(layer && snapshot && Array.isArray(snapshot.features) && JSON.stringify(layer.data) !== JSON.stringify(snapshot))
      })),
    })),
  }
}
