import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'

const FLASH_MS = 1600

/** Briefly pulses a location on the map (Go To XY › Flash). Purely visual; removed after 1.6 s. */
export function flashLocation(map: MapLibreMap, lngLat: [number, number]): void {
  const element = document.createElement('div')
  element.className = 'map-flash'
  element.setAttribute('aria-hidden', 'true')
  const marker = new maplibregl.Marker({ element }).setLngLat(lngLat).addTo(map)
  window.setTimeout(() => marker.remove(), FLASH_MS)
}
