import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { baseStyle } from '../basemaps'
import { ensureMapOverlays, setSelectionOverlay, syncMapLayers } from '../mapRendering'
import { applySceneTerrain, type TerrainState } from '../scene/terrain'
import { useArcWebStore, type ViewMode } from '../store'
import { offlineStyle, type OfflineBasemap } from '../storage/offlineBasemap'

interface MapSyncOptions {
  mapRef: RefObject<MapLibreMap | null>
  mapLoaded: boolean
  sceneView: boolean
  /** Mirrors `sceneView` for map callbacks that run outside React renders. */
  sceneViewRef: RefObject<boolean>
  viewMode: ViewMode
  offlineBasemap: OfflineBasemap | undefined
  /** The basemap is applied only once the stored project has been restored. */
  projectStorageReady: boolean
  /** Redraws measure/sketch overlays after a basemap swap rebuilt the style. */
  redrawOverlays: (map: MapLibreMap) => void
}

/**
 * Keeps the MapLibre map in step with application state: basemap swaps, layer rendering and
 * selection overlays, the 3D scene camera, and scene terrain. Returns the terrain status.
 */
export function useMapSync({ mapRef, mapLoaded, sceneView, sceneViewRef, viewMode, offlineBasemap, projectStorageReady, redrawOverlays }: MapSyncOptions) {
  const layers = useArcWebStore((state) => state.layers)
  const selectedFeature = useArcWebStore((state) => state.selectedFeature)
  const selections = useArcWebStore((state) => state.selections)
  const basemap = useArcWebStore((state) => state.basemap)
  const sceneSettings = useArcWebStore((state) => state.sceneSettings)
  const previousBasemapRef = useRef<string | null>(null)
  const [terrainState, setTerrainState] = useState<TerrainState>({ warning: null, range: null })

  // Basemap swaps rebuild the style, so overlays, layers and selection are re-added afterwards.
  useEffect(() => {
    const map = mapRef.current
    const key = offlineBasemap?.assetId ?? basemap
    if (!map || !mapLoaded || !projectStorageReady || previousBasemapRef.current === key) return
    previousBasemapRef.current = key
    const onStyleReady = () => {
      window.requestAnimationFrame(() => {
        if (!map.isStyleLoaded()) {
          map.once('idle', onStyleReady)
          return
        }
        ensureMapOverlays(map)
        syncMapLayers(map, useArcWebStore.getState().layers, sceneViewRef.current)
        setSelectionOverlay(map, useArcWebStore.getState().layers, useArcWebStore.getState().selectedFeature, useArcWebStore.getState().selections)
        redrawOverlays(map)
      })
    }
    map.once('style.load', onStyleReady)
    map.setStyle(offlineBasemap ? offlineStyle(offlineBasemap) : baseStyle(basemap))
  }, [basemap, offlineBasemap, projectStorageReady, mapLoaded, redrawOverlays, mapRef, sceneViewRef])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const syncMapState = () => {
      if (mapRef.current !== map) return
      if (!map.isStyleLoaded()) {
        map.once('idle', syncMapState)
        return
      }
      const state = useArcWebStore.getState()
      syncMapLayers(map, state.layers, sceneView)
      setSelectionOverlay(map, state.layers, state.selectedFeature, state.selections)
    }
    syncMapState()
  }, [layers, mapLoaded, selectedFeature, selections, sceneView, mapRef])

  useEffect(() => {
    sceneViewRef.current = sceneView
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (sceneView) map.dragRotate.enable()
    else map.dragRotate.disable()
    // Leaving 3D also returns the map to north-up.
    map.easeTo(sceneView ? { pitch: 60, duration: 350 } : { pitch: 0, bearing: 0, duration: 350 })
    if (viewMode !== 'layout' && map.isStyleLoaded()) {
      syncMapLayers(map, useArcWebStore.getState().layers, sceneView)
    }
  }, [sceneView, mapLoaded, viewMode, mapRef, sceneViewRef])

  // Terrain follows the scene settings, the DEM layer's data and basemap swaps (which rebuild the style).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    let cancelled = false
    const apply = () => {
      if (cancelled) return
      if (!map.isStyleLoaded()) {
        map.once('idle', apply)
        return
      }
      try {
        setTerrainState(applySceneTerrain(map, sceneSettings, layers, sceneView && viewMode === 'map'))
      } catch (error) {
        setTerrainState({ warning: `Terrain could not be shown: ${error instanceof Error ? error.message : 'MapLibre error'}`, range: null })
      }
    }
    apply()
    return () => { cancelled = true }
  }, [sceneSettings, layers, sceneView, viewMode, mapLoaded, basemap, mapRef])

  return terrainState
}
