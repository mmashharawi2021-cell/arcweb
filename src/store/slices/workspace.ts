import type { StateCreator } from 'zustand'
import { isContextualTab, isEditingTool } from '../../ribbon/contextualTabs'
import { defaultWorkspaceLayout } from '../../workspaceLayout'
import type { WorkspaceLayoutConfig } from '../../workspaceLayout'
import type { AppTab, ArcWebState, BasemapId, Bookmark, ToolMode, ViewMode } from '../types'

export interface WorkspaceSlice {
  bookmarks: Bookmark[]
  projectName: string
  tableOpen: boolean
  basemap: BasemapId
  theme: 'dark' | 'light'
  activeTab: AppTab
  /** Tab restored when the active contextual tab disappears. */
  ribbonReturnTab: AppTab
  tool: ToolMode
  /** Coordinate system used for the status-bar readout and Map Properties. */
  displayCrs: string
  viewMode: ViewMode
  mapPropertiesOpen: boolean
  workspaceLayout: WorkspaceLayoutConfig
  addBookmark: (bookmark: Bookmark) => void
  removeBookmark: (id: string) => void
  setBookmarks: (bookmarks: Bookmark[]) => void
  setProjectName: (name: string) => void
  setTableOpen: (open: boolean) => void
  setBasemap: (basemap: BasemapId) => void
  setTheme: (theme: 'dark' | 'light') => void
  setActiveTab: (tab: AppTab) => void
  setRibbonTabs: (activeTab: AppTab, returnTab: AppTab) => void
  setTool: (tool: ToolMode) => void
  setDisplayCrs: (code: string) => void
  setViewMode: (mode: ViewMode) => void
  setMapPropertiesOpen: (open: boolean) => void
  setWorkspaceLayout: (layout: WorkspaceLayoutConfig) => void
}

export const createWorkspaceSlice: StateCreator<ArcWebState, [], [], WorkspaceSlice> = (set) => ({
  bookmarks: [],
  projectName: 'Untitled map',
  tableOpen: false,
  basemap: 'osm',
  theme: 'dark',
  activeTab: 'Map',
  ribbonReturnTab: 'Map',
  tool: 'pan',
  displayCrs: 'EPSG:4326',
  viewMode: 'map',
  mapPropertiesOpen: false,
  workspaceLayout: defaultWorkspaceLayout(),
  addBookmark: (bookmark) => set((state) => ({ bookmarks: [...state.bookmarks, bookmark] })),
  removeBookmark: (id) => set((state) => ({ bookmarks: state.bookmarks.filter((bookmark) => bookmark.id !== id) })),
  setBookmarks: (bookmarks) => set({ bookmarks }),
  setProjectName: (projectName) => set({ projectName }),
  setTableOpen: (tableOpen) => set({ tableOpen }),
  setBasemap: (basemap) => set({ basemap }),
  setTheme: (theme) => set({ theme }),
  setActiveTab: (activeTab) => set((state) => activeTab === state.activeTab ? {} : {
    activeTab,
    // Entering a contextual tab by hand remembers the tab to return to when its context ends.
    ribbonReturnTab: isContextualTab(activeTab) ? state.activeTab : state.ribbonReturnTab,
  }),
  setRibbonTabs: (activeTab, ribbonReturnTab) => set({ activeTab, ribbonReturnTab }),
  // Cross-slice: leaving the editing tools also prunes the edit session's snapshots.
  setTool: (tool) => set((state) => {
    if (isEditingTool(tool)) return { tool }
    // Leaving the editing tools drops snapshots of layers that were never changed.
    // Layers with undo/redo steps keep theirs too, so a redo still has something to discard back to.
    const hasHistory = (layerId: string) => [...state.undoStack, ...state.redoStack].some((step) => step.layerId === layerId)
    const editSnapshots = Object.fromEntries(Object.entries(state.editSnapshots).filter(([layerId, snapshot]) =>
      hasHistory(layerId) || state.layers.some((layer) => layer.id === layerId && layer.data !== snapshot)))
    return { tool, editSnapshots }
  }),
  setDisplayCrs: (displayCrs) => set({ displayCrs }),
  setViewMode: (viewMode) => set({ viewMode }),
  setMapPropertiesOpen: (mapPropertiesOpen) => set({ mapPropertiesOpen }),
  setWorkspaceLayout: (workspaceLayout) => set({ workspaceLayout }),
})
