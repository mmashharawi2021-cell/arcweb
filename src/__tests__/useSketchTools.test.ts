// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Feature } from 'geojson'
import { createMapLayer } from '../geo'
import { useArcWebStore } from '../store'
import { renderHook } from './helpers/renderHook'

const overlays = vi.hoisted(() => ({ measure: [] as Feature[][], sketch: [] as Feature[][] }))
vi.mock('../mapRendering', () => ({
  setMeasureOverlay: (_map: unknown, features: Feature[]) => { overlays.measure.push(features) },
  setSketchOverlay: (_map: unknown, features: Feature[]) => { overlays.sketch.push(features) },
}))

const { useSketchTools } = await import('../editing/useSketchTools')

/** Just enough of a MapLibre map for the tool effect: cursor and double-click zoom. */
function fakeMap() {
  const canvas = { style: { cursor: '' } }
  return {
    canvas,
    doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
    getCanvas: () => canvas,
  }
}

function setup(mapLoaded = true) {
  const map = fakeMap()
  const mapRef = { current: map as unknown as MapLibreMap }
  const notify = vi.fn()
  const appendFeature = vi.fn()
  const hook = renderHook((props: { mapLoaded: boolean }) => useSketchTools({ mapRef, mapLoaded: props.mapLoaded, notify, appendFeature }), { mapLoaded })
  return { ...hook, map, mapRef, notify, appendFeature }
}

function addTargetLayer(geometry: 'Line' | 'Polygon' = 'Line') {
  const layer = { ...createMapLayer('Roads', { type: 'FeatureCollection', features: [] }), geometry }
  useArcWebStore.getState().addLayer(layer)
  useArcWebStore.getState().setSelectedLayer(layer.id)
  return useArcWebStore.getState().layers.find((item) => item.id === layer.id)!
}

describe('useSketchTools', () => {
  beforeEach(() => {
    useArcWebStore.getState().clearSession()
    overlays.measure.length = 0
    overlays.sketch.length = 0
  })

  it('keeps callback identities stable across renders and tool changes (the map wiring depends on it)', () => {
    const { result, rerender, map } = setup()
    const first = { ...result.current }
    act(() => useArcWebStore.getState().setTool('distance'))
    act(() => result.current.addMeasurePoint(map as unknown as MapLibreMap, [0, 0], 'distance'))
    rerender()
    for (const name of ['finishSketch', 'setEditingTool', 'addMeasurePoint', 'addSketchPoint', 'redrawOverlays', 'toggleMeasureTool', 'clearMeasurements', 'saveEdits', 'discardEdits'] as const) {
      expect(result.current[name], name).toBe(first[name])
    }
    expect(result.current.movingVertexRef).toBe(first.movingVertexRef)
  })

  it('measures: draws vertices, a line from two points and a closed ring in area mode', () => {
    const { result, map } = setup()
    const target = map as unknown as MapLibreMap
    act(() => result.current.addMeasurePoint(target, [0, 0], 'area'))
    act(() => result.current.addMeasurePoint(target, [1, 0], 'area'))
    expect(overlays.measure.at(-1)!.map((feature) => feature.geometry.type)).toEqual(['Point', 'Point', 'LineString'])
    act(() => result.current.addMeasurePoint(target, [1, 1], 'area'))
    const ring = overlays.measure.at(-1)!.at(-1)!
    expect(ring.geometry).toEqual({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })
    expect(result.current.measurePoints).toHaveLength(3)

    act(() => result.current.clearMeasurements())
    expect(result.current.measurePoints).toEqual([])
    expect(overlays.measure.at(-1)).toEqual([])
  })

  it('toggles a measure tool on and off', () => {
    const { result } = setup()
    act(() => result.current.toggleMeasureTool('area'))
    expect(useArcWebStore.getState().tool).toBe('area')
    act(() => result.current.toggleMeasureTool('area'))
    expect(useArcWebStore.getState().tool).toBe('pan')
  })

  it('joins the edit session when an editing tool is picked, and clears in-progress vertices', () => {
    const layer = addTargetLayer()
    const { result, map } = setup()
    act(() => result.current.addSketchPoint(map as unknown as MapLibreMap, [0, 0], 'draw-line'))
    act(() => result.current.setEditingTool('draw-line'))
    expect(useArcWebStore.getState().tool).toBe('draw-line')
    expect(useArcWebStore.getState().editSnapshots[layer.id]).toBe(layer.data)
    expect(result.current.sketchPoints).toEqual([])
  })

  it('refuses a line with fewer than two distinct vertices', () => {
    addTargetLayer()
    const { result, map, notify, appendFeature } = setup()
    act(() => result.current.setEditingTool('draw-line'))
    act(() => result.current.addSketchPoint(map as unknown as MapLibreMap, [5, 5], 'draw-line'))
    // A double-click adds the same vertex twice; duplicates collapse before validation.
    act(() => result.current.addSketchPoint(map as unknown as MapLibreMap, [5, 5], 'draw-line'))
    act(() => result.current.finishSketch())
    expect(appendFeature).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('A line needs at least two vertices.', 'warning')
    expect(useArcWebStore.getState().tool).toBe('draw-line')
  })

  it('finishes a polygon as a closed ring, then resets the sketch and returns to pan', () => {
    const layer = addTargetLayer('Polygon')
    const { result, map, appendFeature } = setup()
    const target = map as unknown as MapLibreMap
    act(() => result.current.setEditingTool('draw-polygon'))
    for (const vertex of [[0, 0], [2, 0], [2, 2], [2, 2]] as [number, number][]) {
      act(() => result.current.addSketchPoint(target, vertex, 'draw-polygon'))
    }
    act(() => result.current.finishSketch())
    expect(appendFeature).toHaveBeenCalledTimes(1)
    expect(appendFeature.mock.calls[0][0].id).toBe(layer.id)
    expect(appendFeature.mock.calls[0][1]).toEqual({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] })
    expect(result.current.sketchPoints).toEqual([])
    expect(useArcWebStore.getState().tool).toBe('pan')
  })

  it('applies the tool to the map: crosshair and no double-click zoom while sketching, grab when panning', () => {
    const { map } = setup()
    act(() => useArcWebStore.getState().setTool('draw-line'))
    expect(map.canvas.style.cursor).toBe('crosshair')
    expect(map.doubleClickZoom.disable).toHaveBeenCalled()
    act(() => useArcWebStore.getState().setTool('pan'))
    expect(map.canvas.style.cursor).toBe('grab')
    expect(map.doubleClickZoom.enable).toHaveBeenCalled()
  })

  it('leaves the map alone until it has loaded', () => {
    const { map } = setup(false)
    act(() => useArcWebStore.getState().setTool('draw-line'))
    expect(map.canvas.style.cursor).toBe('')
  })
})
