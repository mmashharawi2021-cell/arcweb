import type { StyleSpecification } from 'maplibre-gl'
import type { BasemapId } from './store'

export const basemaps: { id: BasemapId; name: string; note: string; preview: string }[] = [
  { id: 'osm', name: 'OpenStreetMap', note: 'Streets', preview: 'map-preview-osm' },
  { id: 'satellite', name: 'World Imagery', note: 'Satellite', preview: 'map-preview-satellite' },
  { id: 'dark', name: 'Dark Matter', note: 'Carto', preview: 'map-preview-dark' },
  { id: 'light', name: 'Positron Light', note: 'Carto', preview: 'map-preview-light' },
]

export function baseStyle(id: BasemapId): StyleSpecification | string {
  if (id === 'dark') return 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
  if (id === 'light') return 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
  const configs = {
    osm: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
    },
  } satisfies Record<'osm' | 'satellite', { url: string; attribution: string }>
  const selected = configs[id]
  return {
    version: 8,
    sources: {
      'arcweb-basemap': {
        type: 'raster',
        tiles: [selected.url],
        tileSize: 256,
        attribution: selected.attribution,
      },
    },
    layers: [{ id: 'arcweb-basemap', type: 'raster', source: 'arcweb-basemap' }],
  }
}
