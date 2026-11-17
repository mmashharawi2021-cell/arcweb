// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import type { Point } from 'geojson'
import { createMapLayer } from '../geo'
import { useArcWebStore, type FeatureSelection, type MapLayer } from '../store'
import type { IdentifyState } from '../map/useMapClick'
import { renderHook } from './helpers/renderHook'

/** Rendered-feature queries need a real map; tests decide what they return. */
const geometry = vi.hoisted(() => ({
  snapped: [10, 20] as [number, number],
  hits: [] as FeatureSelection[],
  nearest: null as { path: number[]; distance: number } | null,
}))
vi.mock('../mapGeometry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mapGeometry')>()),
  snapCoordinate: () => geometry.snapped,
  queryFeaturesAt: () => geometry.hits,
  nearestVertexPath: () => geometry.nearest,
}))

const { useMapClick } = await import('../map/useMapClick')

const map = {} as MapLibreMap
function click(options: { ctrlKey?: boolean } = {}) {
  return {
    lngLat: { lng: 34.5, lat: 31.5 },
    point: { x: 120, y: 80 },
    originalEvent: { clientX: 300, clientY: 200, ctrlKey: options.ctrlKey ?? false, metaKey: false },
  } as unknown as MapMouseEvent
}

function setup() {
  const identify: { current: IdentifyState | null } = { current: null }
  const options = {
    notify: vi.fn(),
    workspaceRef: { current: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 900, height: 600 }) } as unknown as HTMLElement },
    setIdentify: vi.fn((next: IdentifyState | null | ((value: IdentifyState | null) => IdentifyState | null)) => {
      identify.current = typeof next === 'function' ? next(identify.current) : next
    }),
    appendFeature: vi.fn(),
    addMeasurePoint: vi.fn(),
    addSketchPoint: vi.fn(),
    movingVertexRef: { current: null as { layerId: string; featureId: string | number; path: number[] } | null },
  }
  const hook = renderHook(() => useMapClick(options), undefined)
  return { ...hook, options, identify }
}

function addLayer(kind: MapLayer['geometry'] = 'Point'): MapLayer {
  const layer = {
    ...createMapLayer('Wells', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'w1', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }],
    }),
    geometry: kind,
  }
  act(() => {
    useArcWebStore.getState().addLayer(layer)
    useArcWebStore.getState().setSelectedLayer(layer.id)
  })
  return useArcWebStore.getState().layers.find((item) => item.id === layer.id)!
}

describe('useMapClick', () => {
  beforeEach(() => {
    useArcWebStore.getState().clearSession()
    geometry.hits = []
    geometry.nearest = null
  })

  it('adds a measure vertex at the clicked location', () => {
    const { result, options } = setup()
    act(() => useArcWebStore.getState().setTool('area'))
    act(() => result.current.handleMapClick(map, click()))
    expect(options.addMeasurePoint).toHaveBeenCalledWith(map, [34.5, 31.5], 'area')
  })

  it('needs a target layer with matching geometry before sketching', () => {
    const { result, options } = setup()
    act(() => useArcWebStore.getState().setTool('draw-line'))
    act(() => result.current.handleMapClick(map, click()))
    expect(options.notify).toHaveBeenCalledWith('Create or select a target layer before drawing.', 'warning')

    addLayer('Point')
    act(() => useArcWebStore.getState().setTool('draw-line'))
    act(() => result.current.handleMapClick(map, click()))
    expect(options.notify).toHaveBeenLastCalledWith(expect.stringContaining('choose a matching sketch tool'), 'warning')
    expect(options.addSketchPoint).not.toHaveBeenCalled()
  })

  it('adds points directly and line vertices at the snapped coordinate', () => {
    const { result, options } = setup()
    const layer = addLayer('Mixed')
    act(() => useArcWebStore.getState().setTool('draw-point'))
    act(() => result.current.handleMapClick(map, click()))
    expect(options.appendFeature).toHaveBeenCalledWith(expect.objectContaining({ id: layer.id }), { type: 'Point', coordinates: [10, 20] })

    act(() => useArcWebStore.getState().setTool('draw-line'))
    act(() => result.current.handleMapClick(map, click()))
    expect(options.addSketchPoint).toHaveBeenCalledWith(map, [10, 20], 'draw-line')
  })

  it('moves a vertex in two clicks: pick within reach, then commit the snapped location', () => {
    const { result, options } = setup()
    const layer = addLayer('Point')
    act(() => {
      useArcWebStore.getState().setSelectedFeature({ layerId: layer.id, featureId: 'w1' })
      useArcWebStore.getState().setTool('move-vertex')
    })
    // Too far from any vertex.
    act(() => result.current.handleMapClick(map, click()))
    expect(options.notify).toHaveBeenLastCalledWith('Click within 18 px of a vertex to select it.', 'warning')

    geometry.nearest = { path: [], distance: 3 }
    act(() => result.current.handleMapClick(map, click()))
    expect(options.movingVertexRef.current).toEqual({ layerId: layer.id, featureId: 'w1', path: [] })

    act(() => result.current.handleMapClick(map, click()))
    const moved = useArcWebStore.getState().layers[0].data.features[0].geometry as Point
    expect(moved.coordinates).toEqual([10, 20])
    expect(options.movingVertexRef.current).toBeNull()
    expect(useArcWebStore.getState().undoStack.at(-1)?.label).toBe('Move vertex')
  })

  it('Explore: opens Identify inside the workspace, Ctrl+click toggles selection, empty clicks clear', () => {
    const { result, identify } = setup()
    const layer = addLayer('Point')
    geometry.hits = [{ layerId: layer.id, featureId: 'w1' }]
    act(() => result.current.handleMapClick(map, click()))
    expect(useArcWebStore.getState().selectedFeature).toEqual({ layerId: layer.id, featureId: 'w1' })
    // Client (300, 200) relative to the workspace at (100, 50), offset next to the pointer.
    expect(identify.current).toMatchObject({ x: 218, y: 126, index: 0, lngLat: [34.5, 31.5] })

    act(() => result.current.handleMapClick(map, click({ ctrlKey: true })))
    expect(useArcWebStore.getState().selections[layer.id]).toEqual(['w1'])

    geometry.hits = []
    act(() => result.current.handleMapClick(map, click()))
    expect(identify.current).toBeNull()
    expect(useArcWebStore.getState().selectedFeature).toBeNull()
  })

  it('leaves clicks to the rectangle selection tool', () => {
    const { result, identify } = setup()
    const layer = addLayer('Point')
    geometry.hits = [{ layerId: layer.id, featureId: 'w1' }]
    act(() => useArcWebStore.getState().setTool('select-box'))
    act(() => result.current.handleMapClick(map, click()))
    expect(identify.current).toBeNull()
    expect(useArcWebStore.getState().selectedFeature).toBeNull()
  })

  it('keeps handleMapClick stable across renders', () => {
    const { result, rerender } = setup()
    const first = result.current.handleMapClick
    act(() => useArcWebStore.getState().setTool('distance'))
    rerender()
    expect(result.current.handleMapClick).toBe(first)
  })
})
