import { useCallback } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { isolate } from '../bidi'
import { nearestVertexPath, queryFeaturesAt, replaceCoordinate, snapCoordinate } from '../mapGeometry'
import { useArcWebStore, type FeatureId, type FeatureSelection, type MapLayer, type ToolMode } from '../store'

type Notify = (message: string, kind?: 'success' | 'error' | 'warning') => void
type Coordinate = [number, number]

/** Features identified by the last Explore click and where to float their pop-up. */
export interface IdentifyState {
  key: number
  hits: FeatureSelection[]
  index: number
  x: number
  y: number
  lngLat: [number, number]
}

interface MapClickOptions {
  notify: Notify
  /** The map workspace; Identify pop-ups are positioned relative to it. */
  workspaceRef: RefObject<HTMLElement | null>
  setIdentify: Dispatch<SetStateAction<IdentifyState | null>>
  appendFeature: (layer: MapLayer, geometry: Geometry) => void
  addMeasurePoint: (map: MapLibreMap, coordinate: Coordinate, mode: 'distance' | 'area') => void
  addSketchPoint: (map: MapLibreMap, coordinate: Coordinate, mode: ToolMode) => void
  movingVertexRef: RefObject<{ layerId: string; featureId: FeatureId; path: number[] } | null>
}

/**
 * Routes a map click to the active tool: measure, sketch (with vertex snapping), move-vertex,
 * or Explore (identify, Ctrl/Cmd+click toggles selection).
 */
export function useMapClick({ notify, workspaceRef, setIdentify, appendFeature, addMeasurePoint, addSketchPoint, movingVertexRef }: MapClickOptions) {
  /** Selects the first hit and opens the Identify pop-up next to a viewport point. */
  const showIdentify = useCallback((hits: FeatureSelection[], client: { x: number; y: number }, lngLat: [number, number]) => {
    const state = useArcWebStore.getState()
    state.setSelectedLayer(hits[0].layerId)
    state.setSelectedFeature(hits[0])
    const bounds = workspaceRef.current?.getBoundingClientRect()
    const x = client.x - (bounds?.left ?? 0)
    const y = client.y - (bounds?.top ?? 0)
    setIdentify({
      key: Date.now(),
      hits,
      index: 0,
      x: Math.max(8, Math.min(x + 18, (bounds?.width ?? 900) - 328)),
      y: Math.max(8, Math.min(y - 24, (bounds?.height ?? 600) - 380)),
      lngLat,
    })
  }, [workspaceRef, setIdentify])

  const handleMapClick = useCallback((map: MapLibreMap, event: maplibregl.MapMouseEvent) => {
    const state = useArcWebStore.getState()
    const activeTool = state.tool
    // The rectangle selection tool handles its own clicks and drags (useBoxSelect).
    if (activeTool === 'select-box') return
    if (activeTool === 'distance' || activeTool === 'area') {
      addMeasurePoint(map, [event.lngLat.lng, event.lngLat.lat], activeTool)
      return
    }
    if (activeTool === 'draw-point' || activeTool === 'draw-line' || activeTool === 'draw-polygon') {
      const layer = state.layers.find((item) => item.id === state.selectedLayerId)
      if (!layer) {
        notify('Create or select a target layer before drawing.', 'warning')
        return
      }
      const expectedGeometry = activeTool === 'draw-point' ? 'Point' : activeTool === 'draw-line' ? 'Line' : 'Polygon'
      if (layer.geometry !== 'Unknown' && layer.geometry !== 'Mixed' && layer.geometry !== expectedGeometry) {
        notify(`${isolate(layer.name)} stores ${layer.geometry.toLowerCase()} features; choose a matching sketch tool.`, 'warning')
        return
      }
      const coordinate = snapCoordinate(map, event, state.layers)
      if (activeTool === 'draw-point') {
        appendFeature(layer, { type: 'Point', coordinates: coordinate })
        return
      }
      addSketchPoint(map, coordinate, activeTool)
      return
    }
    if (activeTool === 'move-vertex') {
      const selection = state.selectedFeature
      const layer = selection && state.layers.find((item) => item.id === selection.layerId)
      const feature = layer?.data.features.find((item) => item.id === selection?.featureId)
      if (!layer || !feature?.geometry || feature.geometry.type === 'GeometryCollection') {
        movingVertexRef.current = null
        notify('Select a feature with an editable geometry first.', 'warning')
        return
      }
      const pending = movingVertexRef.current
      if (pending?.layerId === layer.id && pending.featureId === selection.featureId) {
        const coordinate = snapCoordinate(map, event, state.layers, selection)
        const nextFeature = {
          ...feature,
          geometry: {
            ...feature.geometry,
            coordinates: replaceCoordinate(feature.geometry.coordinates, pending.path, coordinate),
          },
        } as Feature<Geometry>
        const data: FeatureCollection = {
          ...layer.data,
          features: layer.data.features.map((item) => item.id === selection.featureId ? nextFeature : item),
        }
        useArcWebStore.getState().commitEdit(layer.id, data, 'Move vertex')
        movingVertexRef.current = null
        notify('Feature vertex moved.')
        return
      }
      movingVertexRef.current = null
      const nearest = nearestVertexPath(map, feature as Feature<Geometry>, event.point)
      if (!nearest) {
        notify('Click within 18 px of a vertex to select it.', 'warning')
        return
      }
      movingVertexRef.current = { layerId: layer.id, featureId: selection.featureId, path: nearest.path }
      notify('Vertex selected. Click its new location.')
      return
    }

    // Explore tool: identify every feature under the pointer.
    const hits = queryFeaturesAt(map, event.point, state.layers)
    if (!hits.length) {
      state.setSelectedFeature(null)
      setIdentify(null)
      return
    }
    // Ctrl/Cmd+click adds or removes the feature from the selection. (Shift+click cannot be
    // used: MapLibre reserves Shift for box zoom and suppresses the click.)
    if (event.originalEvent.ctrlKey || event.originalEvent.metaKey) {
      state.toggleSelected(hits[0].layerId, hits[0].featureId)
      return
    }
    showIdentify(hits, { x: event.originalEvent.clientX, y: event.originalEvent.clientY }, [event.lngLat.lng, event.lngLat.lat])
  }, [appendFeature, notify, showIdentify, addMeasurePoint, addSketchPoint, movingVertexRef, setIdentify])

  return { handleMapClick, showIdentify }
}
