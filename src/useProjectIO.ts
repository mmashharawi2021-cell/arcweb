import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { isolate } from './bidi'
import { useLayoutStore } from './layout/layoutStore'
import { buildProject, parseProject, projectFileName, type ArcWebProject } from './project'
import { useArcWebStore } from './store'
import type { OfflineBasemap } from './storage/offlineBasemap'
import type { WorkspaceSnapshot } from './storage/projectRepository'
import { useProjectLibrary } from './storage/useProjectLibrary'

type Notify = (message: string, kind?: 'success' | 'error' | 'warning') => void

interface ProjectIOOptions {
  mapRef: RefObject<MapLibreMap | null>
  mapInstance: MapLibreMap | null
  notify: Notify
  /** Marks the current contextual ribbon tabs as seen, so a restore does not switch tabs. */
  adoptRibbonContext: () => void
  /** Resets App-owned view state (3D scene, identify pop-up) when a project replaces the workspace. */
  onWorkspaceReplaced: () => void
}

/** Builds a project document from the live stores and map camera. */
function currentProject(map: MapLibreMap | null): ArcWebProject {
  const state = useArcWebStore.getState()
  const layout = useLayoutStore.getState()
  return buildProject({
    name: state.projectName.trim() || 'Untitled map',
    basemap: state.basemap,
    displayCrs: state.displayCrs,
    camera: map ? { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() } : null,
    bookmarks: state.bookmarks,
    layers: state.layers,
    layout: { paper: layout.paper, orientation: layout.orientation, elements: layout.elements },
    workspaceLayout: state.workspaceLayout,
    scene: state.sceneSettings,
    analysisHistory: state.analysisHistory,
    tableViews: state.tableViews,
  })
}

/**
 * Project persistence for the workspace: the local project library session, project files
 * (open / save as .arcweb.json), source-file assets and the selected offline basemap.
 *
 * `capture` and `restore` handed to the library keep a stable identity — the library session
 * restarts whenever they change — so App callbacks are read through a ref.
 */
export function useProjectIO({ mapRef, mapInstance, notify, adoptRibbonContext, onWorkspaceReplaced }: ProjectIOOptions) {
  const [pendingProject, setPendingProject] = useState<ArcWebProject | null>(null)
  const [offlineBasemap, setOfflineBasemap] = useState<OfflineBasemap>()
  const offlineBasemapRef = useRef<OfflineBasemap | undefined>(undefined)
  const sourceAssetsRef = useRef<string[]>([])
  const [projectStorageReady, setProjectStorageReady] = useState(false)

  const callbacksRef = useRef({ notify, adoptRibbonContext, onWorkspaceReplaced })
  useEffect(() => { callbacksRef.current = { notify, adoptRibbonContext, onWorkspaceReplaced } })

  /** Replaces the whole workspace with the contents of a project file. */
  const restoreProject = useCallback((project: ArcWebProject, announce = true) => {
    const { notify, adoptRibbonContext, onWorkspaceReplaced } = callbacksRef.current
    const state = useArcWebStore.getState()
    state.restoreLayers(project.layers)
    state.setBasemap(project.map.basemap)
    state.setDisplayCrs(project.map.displayCrs)
    state.setBookmarks(project.map.bookmarks)
    state.setSceneSettings(project.map.scene)
    state.setAnalysisHistory(project.analysisHistory)
    state.setTableViews(project.tableViews)
    state.setProjectName(project.name)
    state.setTableOpen(false)
    state.setTool('pan')
    adoptRibbonContext()
    state.setWorkspaceLayout(project.workspaceLayout)
    if (project.workspaceLayout.preset === 'analysis') {
      state.setActiveTab('Analysis')
      state.setViewMode('map')
    } else if (project.workspaceLayout.preset === 'cartography') {
      state.setActiveTab('LayoutInsert')
      state.setViewMode('layout')
    } else {
      state.setActiveTab('Map')
      state.setViewMode('map')
    }
    useLayoutStore.getState().restore(project.layout)
    onWorkspaceReplaced()
    setPendingProject(null)
    const camera = project.map.camera
    if (camera) mapRef.current?.jumpTo(camera)
    if (announce) notify(`Opened project “${isolate(project.name)}” — ${project.layers.length} layer${project.layers.length === 1 ? '' : 's'}, ${project.layout.elements.length} layout elements, ${project.map.bookmarks.length} bookmark${project.map.bookmarks.length === 1 ? '' : 's'}.`)
  }, [mapRef])

  const captureWorkspace = useCallback((): WorkspaceSnapshot => ({
    project: currentProject(mapRef.current),
    editSnapshots: useArcWebStore.getState().editSnapshots,
    assetIds: sourceAssetsRef.current,
    offlineBasemap: offlineBasemapRef.current,
  }), [mapRef])

  const restoreWorkspace = useCallback((snapshot: WorkspaceSnapshot) => {
    sourceAssetsRef.current = snapshot.assetIds ?? []
    offlineBasemapRef.current = snapshot.offlineBasemap
    setOfflineBasemap(snapshot.offlineBasemap)
    restoreProject(snapshot.project, false)
    useArcWebStore.getState().restoreEditSnapshots(snapshot.editSnapshots)
    callbacksRef.current.adoptRibbonContext()
    setProjectStorageReady(true)
  }, [restoreProject])

  const library = useProjectLibrary(captureWorkspace, restoreWorkspace)
  const scheduleLibrary = library.schedule
  const createLibraryProject = library.create

  // Camera moves are part of the saved workspace.
  useEffect(() => {
    if (!mapInstance) return
    mapInstance.on('moveend', scheduleLibrary)
    return () => { mapInstance.off('moveend', scheduleLibrary) }
  }, [mapInstance, scheduleLibrary])

  const getOfflineAreaBounds = useCallback((): [number, number, number, number] | null => {
    const bounds = mapRef.current?.getBounds()
    return bounds ? [bounds.getWest(), Math.max(-85.0511287798066, bounds.getSouth()), bounds.getEast(), Math.min(85.0511287798066, bounds.getNorth())] : null
  }, [mapRef])

  const selectOfflineBasemap = useCallback((basemap: OfflineBasemap | undefined) => {
    offlineBasemapRef.current = basemap
    setOfflineBasemap(basemap)
    if (basemap && !sourceAssetsRef.current.includes(basemap.assetId)) sourceAssetsRef.current = [...sourceAssetsRef.current, basemap.assetId]
    scheduleLibrary()
  }, [scheduleLibrary])

  /** Records an imported source file so it is kept with the project. */
  const addSourceAsset = useCallback((assetId: string) => {
    sourceAssetsRef.current = [...sourceAssetsRef.current, assetId]
  }, [])

  const applyProject = useCallback(async (project: ArcWebProject) => {
    try { await createLibraryProject({ project, editSnapshots: {} }); notify(`Opened project “${isolate(project.name)}”. Previous work remains in Projects.`) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save the current workspace before opening the project.', 'error') }
  }, [createLibraryProject, notify])

  const loadProjectFile = useCallback(async (file: File) => {
    try {
      const layout = useLayoutStore.getState()
      const project = parseProject(await file.text(), { paper: layout.paper, orientation: layout.orientation, elements: layout.elements })
      // Opening a project discards the current workspace, so ask first when there is something to lose.
      if (useArcWebStore.getState().layers.length) setPendingProject(project)
      else await applyProject(project)
    } catch (error) {
      notify(`Could not open ${isolate(file.name)}: ${error instanceof Error ? error.message : 'Unreadable project file.'}`, 'error')
    }
  }, [applyProject, notify])

  /** Downloads the whole workspace as an .arcweb.json project file. */
  const saveProject = useCallback(() => {
    const project = currentProject(mapRef.current)
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = projectFileName(project.name)
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    notify(`Saved ${isolate(anchor.download)} — ${project.layers.length} layer${project.layers.length === 1 ? '' : 's'}, ${(blob.size / 1024).toLocaleString('en-US', { maximumFractionDigits: 0 })} KB.`)
  }, [mapRef, notify])

  /** Starts an empty workspace in a new library project, keeping the current one in Projects. */
  const startNewWorkspace = useCallback(async () => {
    const snapshot = captureWorkspace()
    await createLibraryProject({ project: { ...snapshot.project, name: 'Untitled map', layers: [], analysisHistory: [], tableViews: {}, map: { ...snapshot.project.map, bookmarks: [] }, layout: { ...snapshot.project.layout, elements: [] } }, editSnapshots: {} })
  }, [captureWorkspace, createLibraryProject])

  return {
    library, captureWorkspace, projectStorageReady,
    pendingProject, cancelPendingProject: useCallback(() => setPendingProject(null), []),
    offlineBasemap, selectOfflineBasemap, getOfflineAreaBounds, addSourceAsset,
    applyProject, loadProjectFile, saveProject, startNewWorkspace,
  }
}
