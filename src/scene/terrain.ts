import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Position } from 'geojson'
import type { MapLayer, SceneSettings } from '../store'

/**
 * Terrain for the 3D Scene. Two sources are supported:
 *  - "world": public Terrarium-encoded elevation tiles (online, like the basemaps);
 *  - "layer": a DEM raster already loaded in ArcWeb. Its tiles are generated in the browser through
 *    a custom `arcweb-dem://` protocol, so a GeoTIFF DEM becomes real terrain with no server.
 */

export const WORLD_TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const TERRAIN_SOURCE = 'arcweb-terrain'
const HILLSHADE_SOURCE = 'arcweb-hillshade-dem'
const HILLSHADE_LAYER = 'arcweb-hillshade'
const PROTOCOL = 'arcweb-dem'
const TILE_SIZE = 256

// ── Terrarium encoding (elevation = R·256 + G + B/256 − 32768) ───────────────

export function encodeTerrarium(elevation: number): [number, number, number] {
  const value = Math.max(0, Math.min(65535.996, elevation + 32768))
  const r = Math.floor(value / 256)
  const g = Math.floor(value) % 256
  const b = Math.floor((value - Math.floor(value)) * 256)
  return [r, g, b]
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

// ── DEM sampling from ArcWeb raster layers ───────────────────────────────────

export interface DemSampler {
  bounds: [number, number, number, number]
  min: number
  max: number
  /** Elevation at a WGS84 position, or null outside the raster / on NoData cells. */
  sample: (lng: number, lat: number) => number | null
}

function forEachPosition(coordinates: unknown, visit: (position: Position) => void) {
  if (!Array.isArray(coordinates)) return
  if (typeof coordinates[0] === 'number') visit(coordinates as Position)
  else coordinates.forEach((child) => forEachPosition(child, visit))
}

/**
 * Builds a lookup grid from raster cell features (row/column/value, as created on GeoTIFF import).
 * Cells are placed on the raster's WGS84 bounding box; for projected rasters this is a close
 * approximation that is ample for visual terrain.
 */
export function buildDemSampler(layer: Pick<MapLayer, 'data'>): DemSampler | null {
  const first = layer.data.features[0]?.properties
  const width = Number(first?.rasterWidth)
  const height = Number(first?.rasterHeight)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null
  const grid = new Float32Array(width * height).fill(Number.NaN)
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity]
  let [min, max] = [Infinity, -Infinity]
  for (const feature of layer.data.features) {
    const { row, column, value } = feature.properties ?? {}
    if (!Number.isInteger(row) || !Number.isInteger(column) || typeof value !== 'number' || !Number.isFinite(value)) continue
    if (row < 0 || column < 0 || row >= height || column >= width) continue
    grid[row * width + column] = value
    if (value < min) min = value
    if (value > max) max = value
    if (feature.geometry && 'coordinates' in feature.geometry) {
      forEachPosition(feature.geometry.coordinates, ([lng, lat]) => {
        if (lng < west) west = lng
        if (lng > east) east = lng
        if (lat < south) south = lat
        if (lat > north) north = lat
      })
    }
  }
  if (!Number.isFinite(min) || east <= west || north <= south) return null
  const sample = (lng: number, lat: number) => {
    if (lng < west || lng > east || lat < south || lat > north) return null
    const column = Math.min(width - 1, Math.floor((lng - west) / (east - west) * width))
    const row = Math.min(height - 1, Math.floor((north - lat) / (north - south) * height))
    const value = grid[row * width + column]
    return Number.isNaN(value) ? null : value
  }
  return { bounds: [west, south, east, north], min, max, sample }
}

/** WGS84 position of a pixel centre inside a Web Mercator tile. */
export function tilePixelToLngLat(z: number, x: number, y: number, px: number, py: number, size = TILE_SIZE): [number, number] {
  const scale = 2 ** z
  const lng = (x + (px + 0.5) / size) / scale * 360 - 180
  const mercatorY = Math.PI * (1 - 2 * (y + (py + 0.5) / size) / scale)
  return [lng, Math.atan(Math.sinh(mercatorY)) * 180 / Math.PI]
}

/**
 * RGBA pixels of one Terrarium tile. Outside the DEM the surface sits at the DEM's lowest value so
 * the raster's edge does not drop into a cliff down to sea level.
 */
export function renderDemTile(sampler: DemSampler, z: number, x: number, y: number, size = TILE_SIZE): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const [lng, lat] = tilePixelToLngLat(z, x, y, px, py, size)
      const [r, g, b] = encodeTerrarium(sampler.sample(lng, lat) ?? sampler.min)
      const offset = (py * size + px) * 4
      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = 255
    }
  }
  return pixels
}

// ── MapLibre wiring ──────────────────────────────────────────────────────────

const samplers = new Map<string, DemSampler>()
const samplerData = new WeakMap<MapLayer['data'], DemSampler | null>()
const dataVersions = new WeakMap<MapLayer['data'], number>()
let nextVersion = 1
let protocolRegistered = false

function samplerFor(layer: MapLayer): DemSampler | null {
  if (!samplerData.has(layer.data)) samplerData.set(layer.data, buildDemSampler(layer))
  return samplerData.get(layer.data) ?? null
}

function versionOf(data: MapLayer['data']) {
  if (!dataVersions.has(data)) dataVersions.set(data, nextVersion++)
  return dataVersions.get(data)!
}

function registerProtocol() {
  if (protocolRegistered) return
  protocolRegistered = true
  maplibregl.addProtocol(PROTOCOL, async (params) => {
    // arcweb-dem://<layerId>/<version>/<z>/<x>/<y>
    const [layerId, , z, x, y] = params.url.slice(`${PROTOCOL}://`.length).split('/')
    const sampler = samplers.get(decodeURIComponent(layerId))
    if (!sampler) throw new Error('The DEM layer for this terrain is no longer in the map.')
    const pixels = renderDemTile(sampler, Number(z), Number(x), Number(y))
    const image = new ImageData(new Uint8ClampedArray(pixels), TILE_SIZE, TILE_SIZE)
    return { data: await createImageBitmap(image, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) }
  })
}

/** Number of DEM samplers currently held for the terrain protocol (for tests). */
export function demSamplerCount(): number {
  return samplers.size
}

export interface TerrainState {
  /** Why terrain could not be shown, if it could not. */
  warning: string | null
  /** Elevation range of a DEM layer, for the UI. */
  range: [number, number] | null
}

function removeTerrain(map: MapLibreMap) {
  if (map.getTerrain()) map.setTerrain(null)
  if (map.getLayer(HILLSHADE_LAYER)) map.removeLayer(HILLSHADE_LAYER)
  for (const source of [TERRAIN_SOURCE, HILLSHADE_SOURCE]) if (map.getSource(source)) map.removeSource(source)
}

const appliedKeys = new WeakMap<MapLibreMap, string>()

/** Adds, swaps or removes terrain and hillshade to match the scene settings. Safe to call often. */
export function applySceneTerrain(map: MapLibreMap, settings: SceneSettings, layers: MapLayer[], sceneView: boolean): TerrainState {
  if (!map.isStyleLoaded()) return { warning: null, range: null }
  // Release samplers (full DEM rasters) of layers that were removed from the map.
  const liveIds = new Set(layers.map((layer) => layer.id))
  for (const id of [...samplers.keys()]) if (!liveIds.has(id)) samplers.delete(id)
  let tiles: string | null = null
  let warning: string | null = null
  let range: [number, number] | null = null
  let maxzoom = 15
  if (sceneView && settings.terrain === 'world') {
    tiles = WORLD_TERRAIN_TILES
  } else if (sceneView && settings.terrain === 'layer') {
    const layer = layers.find((item) => item.id === settings.terrainLayerId)
    const sampler = layer ? samplerFor(layer) : null
    if (!layer) warning = 'Choose a DEM raster layer for the terrain.'
    else if (!sampler) warning = `${layer.name} is not a raster layer with elevation values.`
    else {
      registerProtocol()
      samplers.set(layer.id, sampler)
      range = [sampler.min, sampler.max]
      tiles = `${PROTOCOL}://${encodeURIComponent(layer.id)}/${versionOf(layer.data)}/{z}/{x}/{y}`
      maxzoom = 14
    }
  }
  const key = tiles ? `${tiles}|${settings.hillshade}` : ''
  if (appliedKeys.get(map) !== key || (tiles && !map.getSource(TERRAIN_SOURCE))) {
    removeTerrain(map)
    if (tiles) {
      const source = { type: 'raster-dem' as const, tiles: [tiles], tileSize: TILE_SIZE, encoding: 'terrarium' as const, maxzoom,
        attribution: settings.terrain === 'world' ? 'Terrain: Mapzen Terrain Tiles (AWS Open Data)' : undefined }
      map.addSource(TERRAIN_SOURCE, source)
      if (settings.hillshade) {
        map.addSource(HILLSHADE_SOURCE, source)
        // Shade relief under the data layers so features stay readable.
        const firstDataLayer = map.getStyle().layers.find((layer) => layer.id.startsWith('aw-'))?.id
        map.addLayer({ id: HILLSHADE_LAYER, type: 'hillshade', source: HILLSHADE_SOURCE, paint: { 'hillshade-exaggeration': 0.45 } }, firstDataLayer)
      }
    }
    appliedKeys.set(map, key)
  }
  if (tiles) map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: settings.exaggeration })
  return { warning, range }
}
