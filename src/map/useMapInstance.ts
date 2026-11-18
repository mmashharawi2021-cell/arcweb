import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { isRightClickGesture } from '../contextMenu/menuModel'
import { syncLayerScaleRanges, ensureMapOverlays, getRenderedFeatureLayerIds, setSelectionOverlay, syncMapLayers } from '../mapRendering'
import { useArcWebStore, type ViewMode } from '../store'

/** A right-click on the map canvas (not a right-drag rotation). */
export interface CanvasMenuRequest {
  x: number
  y: number
  point: { x: number; y: number }
  lngLat: [number, number]
  canIdentify: boolean
}

/** Map event handlers. They are read through a ref, so they may change without rebuilding the map. */
export interface MapEvents {
  onClick: (map: MapLibreMap, event: maplibregl.MapMouseEvent) => void
  /** Double-click while sketching a line or polygon. */
  onFinishSketch: () => void
  onCanvasMenu: (request: CanvasMenuRequest) => void
}

interface MapInstanceOptions {
  mapRef: RefObject<MapLibreMap | null>
  /** Element the map container normally lives in. */
  mapHostRef: RefObject<HTMLDivElement | null>
  /** Element whose size changes require a map resize. */
  workspaceRef: RefObject<HTMLElement | null>
  /** Whether the 3D scene is active, for the first layer sync. */
  sceneViewRef: RefObject<boolean>
  eventsRef: RefObject<MapEvents | null>
  viewMode: ViewMode
  /** The print layout's map frame, which hosts the live map in layout view. */
  mapFrameHost: HTMLDivElement | null
}

/**
 * Creates the single MapLibre instance and wires its events, keeps it sized to the workspace,
 * and moves it between the map view and the layout's map frame without re-creating it.
 */
export function useMapInstance({ mapRef, mapHostRef, workspaceRef, sceneViewRef, eventsRef, viewMode, mapFrameHost }: MapInstanceOptions) {
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = mapHostRef.current
    if (!host) return
    // The map lives in a container React does not own, so it can be moved into the
    // layout's map frame and back without re-creating the MapLibre instance.
    const element = document.createElement('div')
    element.className = 'map-canvas'
    host.appendChild(element)
    containerRef.current = element
    const map = new maplibregl.Map({
      container: element,
      style: { version: 8, sources: {}, layers: [{ id: 'initial-background', type: 'background', paint: { 'background-color': '#19242b' } }] },
      center: [-98, 39],
      zoom: 3.15,
      attributionControl: false,
      maxZoom: 20,
      // Terrain views need a lower horizon than the 60° default.
      maxPitch: 85,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    const onReady = () => {
      if (!map.isStyleLoaded()) {
        map.once('idle', onReady)
        return
      }
      ensureMapOverlays(map)
      syncMapLayers(map, useArcWebStore.getState().layers, sceneViewRef.current)
      setSelectionOverlay(map, useArcWebStore.getState().layers, useArcWebStore.getState().selectedFeature, useArcWebStore.getState().selections)
      window.requestAnimationFrame(() => {
        setMapInstance(map)
        setMapLoaded(true)
      })
    }
    const onClick = (event: maplibregl.MapMouseEvent) => eventsRef.current?.onClick(map, event)
    let rightDown: { x: number; y: number } | null = null
    const onMouseDown = (event: maplibregl.MapMouseEvent) => {
      if (event.originalEvent.button === 2) rightDown = { x: event.point.x, y: event.point.y }
    }
    const onContextMenu = (event: maplibregl.MapMouseEvent) => {
      event.originalEvent.preventDefault()
      const wasClick = isRightClickGesture(rightDown, event.point)
      rightDown = null
      // Skip the end of a right-drag rotation, and the map frame inside the print layout.
      if (!wasClick || useArcWebStore.getState().viewMode !== 'map') return
      eventsRef.current?.onCanvasMenu({
        x: event.originalEvent.clientX,
        y: event.originalEvent.clientY,
        point: { x: event.point.x, y: event.point.y },
        lngLat: [event.lngLat.lng, event.lngLat.lat],
        canIdentify: getRenderedFeatureLayerIds(map, useArcWebStore.getState().layers).length > 0,
      })
    }
    const onDoubleClick = (event: maplibregl.MapMouseEvent) => {
      const activeTool = useArcWebStore.getState().tool
      if (activeTool === 'draw-line' || activeTool === 'draw-polygon') {
        event.preventDefault()
        eventsRef.current?.onFinishSketch()
      }
    }
    let scaleLatitude = map.getCenter().lat
    const onScaleMove = () => {
      if (Math.abs(map.getCenter().lat - scaleLatitude) <= 5) return
      scaleLatitude = map.getCenter().lat
      syncLayerScaleRanges(map, useArcWebStore.getState().layers)
    }
    map.on('moveend', onScaleMove)
    map.once('load', onReady)
    map.on('click', onClick)
    map.on('dblclick', onDoubleClick)
    map.on('mousedown', onMouseDown)
    map.on('contextmenu', onContextMenu)
    return () => {
      map.off('moveend', onScaleMove)
      map.off('load', onReady)
      map.off('mousedown', onMouseDown)
      map.off('contextmenu', onContextMenu)
      map.off('click', onClick)
      map.off('dblclick', onDoubleClick)
      map.remove()
      element.remove()
      containerRef.current = null
      mapRef.current = null
      setMapInstance(null)
    }
  }, [mapRef, mapHostRef, sceneViewRef, eventsRef])

  // Keep the canvas sized to the workspace, at most once per frame.
  useEffect(() => {
    const workspace = workspaceRef.current
    const map = mapRef.current
    if (!workspace || !map || !mapLoaded) return
    let frame: number | null = null
    const resizeMap = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => { frame = null; map.resize() })
    }
    const cancelResize = () => { if (frame !== null) window.cancelAnimationFrame(frame) }
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', resizeMap)
      return () => { window.removeEventListener('resize', resizeMap); cancelResize() }
    }
    const observer = new ResizeObserver(resizeMap)
    observer.observe(workspace)
    return () => { observer.disconnect(); cancelResize() }
  }, [mapLoaded, mapRef, workspaceRef])

  // Layout view shows the live map inside the map frame; map view puts it back in the workspace.
  useEffect(() => {
    const container = containerRef.current
    const target = viewMode === 'layout' && mapFrameHost ? mapFrameHost : mapHostRef.current
    if (!container || !target || container.parentElement === target) return
    target.appendChild(container)
    mapRef.current?.resize()
  }, [viewMode, mapFrameHost, mapLoaded, mapHostRef, mapRef])

  return { mapInstance, mapLoaded }
}
