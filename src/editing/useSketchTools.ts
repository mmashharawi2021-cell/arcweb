import { rectangle, circleFromPoints } from './constructionTools'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Feature, Geometry } from 'geojson'
import { setMeasureOverlay, setSketchOverlay } from '../mapRendering'
import { isEditingTool } from '../ribbon/contextualTabs'
import { useArcWebStore, type FeatureId, type MapLayer, type ToolMode } from '../store'

type Notify = (message: string, kind?: 'success' | 'error' | 'warning') => void
type Coordinate = [number, number]

/** Vertices as points plus the connecting line, or a closed ring once `closed` has 3+ vertices. */
function vertexFeatures(points: Coordinate[], closed: boolean): Feature<Geometry>[] {
  const features: Feature<Geometry>[] = points.map((coordinates) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates },
  }))
  if (points.length > 1) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: closed && points.length > 2
        ? { type: 'Polygon', coordinates: [[...points, points[0]]] }
        : { type: 'LineString', coordinates: points },
    })
  }
  return features
}

export function drawMeasureOverlay(map: MapLibreMap, points: Coordinate[], mode: 'distance' | 'area' | 'pan') {
  setMeasureOverlay(map, vertexFeatures(points, mode === 'area'))
}

export function drawSketchOverlay(map: MapLibreMap, points: Coordinate[], mode: ToolMode) {
  setSketchOverlay(map, vertexFeatures(points, mode === 'draw-polygon'))
}

interface SketchToolOptions {
  mapRef: RefObject<MapLibreMap | null>
  mapLoaded: boolean
  notify: Notify
  appendFeature: (layer: MapLayer, geometry: Geometry) => void
}

/**
 * Interactive map tools: measure distance/area, sketch lines/polygons and move-vertex.
 * Owns the in-progress vertices, keeps their map overlays in sync and switches tools
 * (joining the edit session for editing tools). Callbacks keep stable identities, because
 * the map's event wiring is rebuilt when they change.
 */
export function useSketchTools({ mapRef, mapLoaded, notify, appendFeature }: SketchToolOptions) {
  const tool = useArcWebStore((state) => state.tool)
  const [measurePoints, setMeasurePoints] = useState<Coordinate[]>([])
  const [sketchPoints, setSketchPoints] = useState<Coordinate[]>([])
  const measurePointsRef = useRef<Coordinate[]>([])
  const sketchPointsRef = useRef<Coordinate[]>([])
  /** The vertex picked by the move-vertex tool, waiting for its new location. */
  const movingVertexRef = useRef<{ layerId: string; featureId: FeatureId; path: number[] } | null>(null)

  const setMeasure = useCallback((points: Coordinate[]) => {
    measurePointsRef.current = points
    setMeasurePoints(points)
  }, [])
  const setSketch = useCallback((points: Coordinate[]) => {
    sketchPointsRef.current = points
    setSketchPoints(points)
  }, [])

  const addMeasurePoint = useCallback((map: MapLibreMap, coordinate: Coordinate, mode: 'distance' | 'area') => {
    const next = [...measurePointsRef.current, coordinate]
    setMeasure(next)
    drawMeasureOverlay(map, next, mode)
  }, [setMeasure])

  const addSketchPoint = useCallback((map: MapLibreMap, coordinate: Coordinate, mode: ToolMode) => {
    const next = [...sketchPointsRef.current, coordinate]
    if ((mode==='draw-rectangle'||mode==='draw-circle') && next.length===2) {
      const state=useArcWebStore.getState(), layer=state.layers.find(layer=>layer.id===state.selectedLayerId)
      const geometry=mode==='draw-rectangle'?rectangle(next[0],next[1]):circleFromPoints(next[0],next[1])
      if(!geometry){notify('Choose two different corners or a non-zero radius.', 'warning');setSketch([]);drawSketchOverlay(map,[],'pan');return}
      if(layer)appendFeature(layer,geometry)
      setSketch([]);drawSketchOverlay(map,[],'pan');state.setTool('pan');return
    }
    setSketch(next)
    drawSketchOverlay(map, next, mode)
  }, [setSketch, appendFeature, notify])

  /** Redraws in-progress overlays, e.g. after a basemap swap rebuilt the style. */
  const redrawOverlays = useCallback((map: MapLibreMap) => {
    const activeTool = useArcWebStore.getState().tool
    drawMeasureOverlay(map, measurePointsRef.current, activeTool === 'area' ? 'area' : 'distance')
    drawSketchOverlay(map, sketchPointsRef.current, activeTool)
  }, [])

  const finishSketch = useCallback(() => {
    const state = useArcWebStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    const coordinates = sketchPointsRef.current.filter((coordinate, index, list) =>
      index === 0 || coordinate[0] !== list[index - 1][0] || coordinate[1] !== list[index - 1][1])
    if (!layer || (state.tool !== 'draw-line' && state.tool !== 'draw-polygon')) {
      if (state.tool === 'draw-line' || state.tool === 'draw-polygon') notify('Select a target layer before drawing.')
      return
    }
    if (state.tool === 'draw-line' && coordinates.length < 2) {
      notify('A line needs at least two vertices.', 'warning')
      return
    }
    if (state.tool === 'draw-polygon' && coordinates.length < 3) {
      notify('A polygon needs at least three vertices.', 'warning')
      return
    }
    if (state.tool === 'draw-line') {
      appendFeature(layer, { type: 'LineString', coordinates })
    } else {
      appendFeature(layer, { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] })
    }
    setSketch([])
    if (mapRef.current) drawSketchOverlay(mapRef.current, [], 'pan')
    state.setTool('pan')
  }, [appendFeature, notify, mapRef, setSketch])

  const setEditingTool = useCallback((nextTool: ToolMode) => {
    setSketch([])
    setMeasure([])
    movingVertexRef.current = null
    const state = useArcWebStore.getState()
    const target=state.layers.find(layer=>layer.id===state.selectedLayerId)
    if(isEditingTool(nextTool)&&target?.editable===false){notify(`${target.name} is not editable.`, 'warning');return}
    // Picking an editing tool opens (or joins) the edit session for the target layer.
    if (isEditingTool(nextTool) && state.selectedLayerId) state.beginEdit(state.selectedLayerId)
    state.setTool(nextTool)
    if (mapRef.current) {
      drawMeasureOverlay(mapRef.current, [], 'pan')
      drawSketchOverlay(mapRef.current, [], 'pan')
    }
  }, [mapRef, setMeasure, setSketch, notify])

  /** Turns a measure tool on, or off when it is already active, starting a fresh measurement. */
  const toggleMeasureTool = useCallback((nextTool: 'distance' | 'area') => {
    const state = useArcWebStore.getState()
    state.setTool(state.tool === nextTool ? 'pan' : nextTool)
    setMeasure([])
    if (mapRef.current) drawMeasureOverlay(mapRef.current, [], nextTool)
  }, [mapRef, setMeasure])

  const clearMeasurements = useCallback(() => {
    setMeasure([])
    const activeTool = useArcWebStore.getState().tool
    if (mapRef.current) drawMeasureOverlay(mapRef.current, [], activeTool === 'area' || activeTool === 'distance' ? activeTool : 'pan')
  }, [mapRef, setMeasure])

  const undoLastVertex = useCallback(() => { const points=sketchPointsRef.current.slice(0,-1);setSketch(points);if(mapRef.current)drawSketchOverlay(mapRef.current,points,useArcWebStore.getState().tool) }, [setSketch,mapRef])
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented || document.querySelector('[aria-modal="true"], [role="menu"], [role="listbox"]'))return
      const target=event.target as HTMLElement|null
      if(target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))return
      const active=useArcWebStore.getState().tool
      if(!isEditingTool(active)||active==='move-vertex')return
      if(event.key==='F2'){event.preventDefault();finishSketch()}
      if(event.key==='Escape'){event.preventDefault();setEditingTool('pan')}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&sketchPointsRef.current.length){event.preventDefault();event.stopImmediatePropagation();undoLastVertex()}
    }
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)
  },[finishSketch,setEditingTool,undoLastVertex])
  const saveEdits = useCallback(() => {
    setEditingTool('pan')
    useArcWebStore.getState().saveEdits()
    notify('Edits saved.')
  }, [notify, setEditingTool])

  const discardEdits = useCallback(() => {
    setEditingTool('pan')
    useArcWebStore.getState().discardEdits()
    notify('Edits discarded; features restored.', 'warning')
  }, [notify, setEditingTool])

  // Cursor, double-click zoom and overlays follow the active tool.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (tool !== 'move-vertex') movingVertexRef.current = null
    if (tool === 'pan') {
      map.doubleClickZoom.enable()
      drawMeasureOverlay(map, [], 'pan')
      drawSketchOverlay(map, [], 'pan')
      map.getCanvas().style.cursor = 'grab'
      return
    }
    if (tool === 'draw-line' || tool === 'draw-polygon' || tool === 'draw-rectangle' || tool === 'draw-circle' || tool === 'area' || tool === 'distance') map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
    map.getCanvas().style.cursor = 'crosshair'
    if (tool === 'distance' || tool === 'area') drawMeasureOverlay(map, measurePointsRef.current, tool)
    if (tool === 'draw-line' || tool === 'draw-polygon') drawSketchOverlay(map, sketchPointsRef.current, tool)
  }, [tool, mapLoaded, mapRef])

  return {
    measurePoints, sketchPoints, movingVertexRef,
    addMeasurePoint, addSketchPoint, redrawOverlays, finishSketch, undoLastVertex, setEditingTool, toggleMeasureTool, clearMeasurements,
    saveEdits, discardEdits,
  }
}
