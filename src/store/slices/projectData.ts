import type { StateCreator } from 'zustand'
import { DEFAULT_SCENE_SETTINGS, MAX_ANALYSIS_HISTORY } from '../types'
import type { AnalysisRecord, ArcWebState, SceneSettings, TableView } from '../types'

export interface ProjectDataSlice {
  /** Most recent first. */
  analysisHistory: AnalysisRecord[]
  tableViews: Record<string, TableView>
  sceneSettings: SceneSettings
  addAnalysisRecord: (record: AnalysisRecord) => void
  setTableView: (layerId: string, view: Partial<TableView>) => void
  setTableViews: (views: Record<string, TableView>) => void
  setSceneSettings: (settings: Partial<SceneSettings>) => void
  setAnalysisHistory: (records: AnalysisRecord[]) => void
}

export const createProjectDataSlice: StateCreator<ArcWebState, [], [], ProjectDataSlice> = (set) => ({
  analysisHistory: [],
  tableViews: {},
  sceneSettings: DEFAULT_SCENE_SETTINGS,
  addAnalysisRecord: (record) => set((state) => ({ analysisHistory: [record, ...state.analysisHistory].slice(0, MAX_ANALYSIS_HISTORY) })),
  setTableView: (layerId, view) => set((state) => {
    const current = state.tableViews[layerId] ?? { sort: null, filters: {} }
    return { tableViews: { ...state.tableViews, [layerId]: { ...current, ...view } } }
  }),
  setTableViews: (tableViews) => set({ tableViews }),
  setSceneSettings: (settings) => set((state) => ({ sceneSettings: { ...state.sceneSettings, ...settings } })),
  setAnalysisHistory: (analysisHistory) => set({ analysisHistory: analysisHistory.slice(0, MAX_ANALYSIS_HISTORY) }),
})
