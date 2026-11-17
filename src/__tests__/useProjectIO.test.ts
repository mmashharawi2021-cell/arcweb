// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { createMapLayer } from '../geo'
import { useArcWebStore } from '../store'
import type { OfflineBasemap } from '../storage/offlineBasemap'
import type { WorkspaceSnapshot } from '../storage/projectRepository'
import { renderHook } from './helpers/renderHook'

/** Records what the library session receives on every render, without touching IndexedDB. */
const library = vi.hoisted(() => ({
  received: [] as { capture: () => unknown; restore: (snapshot: never) => void }[],
  schedule: vi.fn(),
  create: vi.fn(async () => undefined),
}))
vi.mock('../storage/useProjectLibrary', () => ({
  useProjectLibrary: (capture: () => unknown, restore: (snapshot: never) => void) => {
    library.received.push({ capture, restore })
    return { state: 'saved', error: '', projectId: 'p1', schedule: library.schedule, create: library.create, flush: vi.fn(), open: vi.fn(), recover: vi.fn() }
  },
}))

const { useProjectIO } = await import('../useProjectIO')

function fakeMap() {
  return {
    getCenter: () => ({ lng: 35, lat: 31.5 }),
    getZoom: () => 9,
    getBearing: () => 0,
    getPitch: () => 0,
    jumpTo: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }
}

const offline: OfflineBasemap = {
  assetId: 'tiles-1', name: 'Gaza tiles', attribution: 'local', minZoom: 0, maxZoom: 12, tileSize: 256,
  bounds: [34, 31, 35, 32], format: 'png',
}

type Callbacks = { notify: (message: string, kind?: string) => void; onWorkspaceReplaced: () => void; adoptRibbonContext: () => void }

function setup(callbacks: Callbacks = { notify: vi.fn(), onWorkspaceReplaced: vi.fn(), adoptRibbonContext: vi.fn() }) {
  const map = fakeMap()
  const mapRef = { current: map as unknown as MapLibreMap }
  const hook = renderHook((props: Callbacks) => useProjectIO({ mapRef, mapInstance: null, ...props }), callbacks)
  return { ...hook, map, callbacks }
}

function addLayer(name = 'Wells') {
  const layer = createMapLayer(name, {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: `${name}:1`, properties: { depth: 12 }, geometry: { type: 'Point', coordinates: [34.45, 31.5] } }],
  })
  act(() => useArcWebStore.getState().addLayer(layer))
  return layer
}

describe('useProjectIO', () => {
  beforeEach(() => {
    useArcWebStore.getState().clearSession()
    library.received.length = 0
    library.schedule.mockClear()
    library.create.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('hands the library the same capture/restore functions on every render, even when App callbacks change', () => {
    const { rerender } = setup()
    rerender({ notify: vi.fn(), onWorkspaceReplaced: vi.fn(), adoptRibbonContext: vi.fn() })
    act(() => useArcWebStore.getState().setProjectName('Renamed'))
    rerender()
    expect(library.received.length).toBeGreaterThan(2)
    const [first] = library.received
    for (const call of library.received) {
      expect(call.capture).toBe(first.capture)
      expect(call.restore).toBe(first.restore)
    }
  })

  it('round-trips the workspace through capture and restore, using the latest App callbacks', () => {
    const { result, rerender, map } = setup()
    addLayer()
    act(() => useArcWebStore.getState().setProjectName('Gaza wells'))
    act(() => result.current.addSourceAsset('source-1'))
    act(() => result.current.selectOfflineBasemap(offline))
    const snapshot = result.current.captureWorkspace()
    expect(snapshot.project.name).toBe('Gaza wells')
    expect(snapshot.project.layers).toHaveLength(1)
    expect(snapshot.project.map.camera).toMatchObject({ center: [35, 31.5], zoom: 9 })
    expect(snapshot.assetIds).toEqual(['source-1', 'tiles-1'])
    expect(snapshot.offlineBasemap).toBe(offline)

    const latest = { notify: vi.fn(), onWorkspaceReplaced: vi.fn(), adoptRibbonContext: vi.fn() }
    rerender(latest)
    act(() => useArcWebStore.getState().clearSession())
    expect(useArcWebStore.getState().layers).toHaveLength(0)

    const restore = library.received[0].restore as (snapshot: WorkspaceSnapshot) => void
    act(() => restore(snapshot))
    const state = useArcWebStore.getState()
    expect(state.projectName).toBe('Gaza wells')
    expect(state.layers.map((layer) => layer.name)).toEqual(['Wells'])
    expect(state.tool).toBe('pan')
    expect(result.current.projectStorageReady).toBe(true)
    expect(result.current.offlineBasemap).toEqual(offline)
    expect(map.jumpTo).toHaveBeenCalledWith(snapshot.project.map.camera)
    expect(latest.onWorkspaceReplaced).toHaveBeenCalledTimes(1)
    expect(latest.adoptRibbonContext).toHaveBeenCalled()
    // A silent restore (session reopen) does not announce itself.
    expect(latest.notify).not.toHaveBeenCalled()
  })

  it('does not record an offline basemap asset twice', () => {
    const { result } = setup()
    act(() => result.current.selectOfflineBasemap(offline))
    act(() => result.current.selectOfflineBasemap(offline))
    expect(result.current.captureWorkspace().assetIds).toEqual(['tiles-1'])
    expect(library.schedule).toHaveBeenCalledTimes(2)
  })

  it('opens a project file straight into a new library project when the map is empty', async () => {
    const { result } = setup()
    addLayer()
    const project = result.current.captureWorkspace().project
    act(() => useArcWebStore.getState().clearSession())
    const file = new File([JSON.stringify({ ...project, name: 'From disk' })], 'from-disk.arcweb.json')
    await act(() => result.current.loadProjectFile(file))
    expect(library.create).toHaveBeenCalledTimes(1)
    expect(library.create.mock.calls[0]).toEqual([expect.objectContaining({ project: expect.objectContaining({ name: 'From disk' }) })])
    expect(result.current.pendingProject).toBeNull()
  })

  it('asks before replacing a workspace that has layers, and can be cancelled', async () => {
    const { result } = setup()
    addLayer()
    const project = result.current.captureWorkspace().project
    await act(() => result.current.loadProjectFile(new File([JSON.stringify(project)], 'p.arcweb.json')))
    expect(library.create).not.toHaveBeenCalled()
    expect(result.current.pendingProject?.name).toBe(project.name)
    act(() => result.current.cancelPendingProject())
    expect(result.current.pendingProject).toBeNull()
  })

  it('reports an unreadable project file instead of throwing', async () => {
    const { result, callbacks } = setup()
    await act(() => result.current.loadProjectFile(new File(['{not json'], 'broken.arcweb.json')))
    expect(library.create).not.toHaveBeenCalled()
    expect(callbacks.notify).toHaveBeenCalledWith(expect.stringContaining('Could not open'), 'error')
  })

  it('downloads the workspace as an .arcweb.json file', async () => {
    const { result } = setup()
    addLayer()
    act(() => useArcWebStore.getState().setProjectName('Field survey'))
    let downloaded: { name: string; blob: Blob } | null = null
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      downloaded = { name: '', blob: blob as Blob }
      return 'blob:test'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (downloaded) downloaded.name = this.download
    })
    act(() => result.current.saveProject())
    expect(downloaded).not.toBeNull()
    const saved = downloaded as unknown as { name: string; blob: Blob }
    expect(saved.name).toBe('Field_survey.arcweb.json')
    const project = JSON.parse(await saved.blob.text())
    expect(project.name).toBe('Field survey')
    expect(project.layers).toHaveLength(1)
  })
})
