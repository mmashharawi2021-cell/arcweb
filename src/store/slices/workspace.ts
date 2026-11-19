import { openView, closeView, type ViewKind, type ViewRef } from '../../views/viewState'
import type { StateCreator } from 'zustand'
import { isContextualTab, isEditingTool, migrateTabId } from '../../ribbon/contextualTabs'
import { defaultWorkspaceLayout } from '../../workspaceLayout'
import type { WorkspaceLayoutConfig } from '../../workspaceLayout'
import { loadUiSettings, type CoordinateFormat, type LengthUnit } from '../../ui/uiSettings'
import type { AppTab, ArcWebState, BasemapId, Bookmark, ToolMode, ViewMode } from '../types'

export interface WorkspaceSlice {
  notifications: {id:string;message:string;kind:'success'|'warning'|'error';at:number;read:boolean}[]
  addNotification:(message:string,kind:'success'|'warning'|'error')=>void
  markNotificationsRead:()=>void

  openViews: ViewRef[]
  activeView: ViewKind
  openView: (kind: ViewKind) => void
  closeView: (kind: ViewKind) => void
  openTables: string[]
  activeTable: string | null
  openTable: (id: string) => void
  closeTable: (id: string) => void

  bookmarks: Bookmark[]
  projectName: string
  tableOpen: boolean
  basemap: BasemapId
  theme: 'dark' | 'light'
  /** Measure tool units (Backstage › Options). */
  measureUnits: LengthUnit
  /** Status-bar coordinate notation (Backstage › Options). */
  coordinateFormat: CoordinateFormat
  /** Edit › Snapping: snap sketch and move-vertex clicks to nearby vertices within `tolerancePx`. */
  snapping: { enabled: boolean; tolerancePx: number }
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
  setMeasureUnits: (units: LengthUnit) => void
  setCoordinateFormat: (format: CoordinateFormat) => void
  setSnapping: (snapping: { enabled: boolean; tolerancePx: number }) => void
  setActiveTab: (tab: AppTab | string) => void
  setRibbonTabs: (activeTab: AppTab, returnTab: AppTab) => void
  setTool: (tool: ToolMode) => void
  setDisplayCrs: (code: string) => void
  setViewMode: (mode: ViewMode) => void
  setMapPropertiesOpen: (open: boolean) => void
  setWorkspaceLayout: (layout: WorkspaceLayoutConfig) => void
}

export const createWorkspaceSlice: StateCreator<ArcWebState, [], [], WorkspaceSlice> = (set) => {
  const settings = loadUiSettings()
  return {
    notifications: [],
    addNotification:(message,kind)=>set(state=>({notifications:[{id:crypto.randomUUID(),message,kind,at:Date.now(),read:false},...state.notifications].slice(0,50)})),
    markNotificationsRead:()=>set(state=>({notifications:state.notifications.map(item=>({...item,read:true}))})),
    openViews: [{kind:'map'}], activeView: 'map',
    openView: kind => set(state=>({openViews:openView(state.openViews,kind),activeView:kind,viewMode:kind==='layout'?'layout':'map'})),
    closeView: kind => set(state=>{if(kind==='map')return {};const next=closeView(state.openViews,kind);return {openViews:next.views,...(state.activeView===kind?{activeView:next.next,viewMode:next.next==='layout'?'layout' as const:'map' as const}:{})}}),
    openTables: [], activeTable: null,
    openTable: id => set(state=>({openTables:state.openTables.includes(id)?state.openTables:[...state.openTables,id],activeTable:id,tableOpen:true})),
    closeTable: id => set(state=>{const openTables=state.openTables.filter(value=>value!==id);return {openTables,activeTable:state.activeTable===id?openTables.at(-1)??null:state.activeTable,tableOpen:openTables.length>0}}),
    bookmarks: [],
    projectName: 'Untitled map',
    tableOpen: false,
    basemap: 'osm',
    theme: settings.theme,
    measureUnits: settings.measureUnits,
    coordinateFormat: settings.coordinateFormat,
    snapping: settings.snapping ?? { enabled: true, tolerancePx: 10 },
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
    setTableOpen: (tableOpen) => set(state=>({tableOpen,...(tableOpen&&state.selectedLayerId?{openTables:state.openTables.includes(state.selectedLayerId)?state.openTables:[...state.openTables,state.selectedLayerId],activeTable:state.selectedLayerId}:{})})),
    setBasemap: (basemap) => set({ basemap }),
    setTheme: (theme) => set({ theme }),
    setMeasureUnits: (measureUnits) => set({ measureUnits }),
    setCoordinateFormat: (coordinateFormat) => set({ coordinateFormat }),
    setSnapping: (snapping) => set({ snapping }),
    setActiveTab: (id) => set((state) => { const activeTab = migrateTabId(id); return activeTab === state.activeTab ? {} : {
      activeTab,
      // Entering a contextual tab by hand remembers the tab to return to when its context ends.
      ribbonReturnTab: isContextualTab(activeTab) && !isContextualTab(state.activeTab) ? state.activeTab : state.ribbonReturnTab,
    } }),
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
    setViewMode: (viewMode) => set(state=>({viewMode, ...(viewMode==='layout'?{openViews:openView(state.openViews,'layout'),activeView:'layout' as const}:state.activeView==='layout'?{activeView:'map' as const}:{})})),
    setMapPropertiesOpen: (mapPropertiesOpen) => set({ mapPropertiesOpen }),
    setWorkspaceLayout: (workspaceLayout) => set({ workspaceLayout }),
  }
}
