import JSZip from 'jszip'
import { addProtocol } from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import { getAsset, putAsset } from './assets'

export interface OfflineBasemap {
  assetId: string; name: string; attribution: string; minZoom: number; maxZoom: number; tileSize: number
  bounds: [number, number, number, number]; format: 'png' | 'jpg' | 'webp'
}
export function parseOfflineMetadata(value: unknown): Omit<OfflineBasemap, 'assetId'> {
  if (!value || typeof value !== 'object') throw new Error('Missing tile metadata.')
  const record = value as Record<string, unknown>
  const { name, attribution, minZoom, maxZoom, tileSize, bounds, format } = record
  if (typeof name !== 'string' || !name.trim() || typeof attribution !== 'string' || !Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || typeof minZoom !== 'number' || typeof maxZoom !== 'number' || minZoom < 0 || maxZoom > 22 || minZoom > maxZoom || (tileSize !== 256 && tileSize !== 512) || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(v => typeof v === 'number' && Number.isFinite(v)) || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -85.051129 || bounds[3] > 85.051129 || bounds[0] >= bounds[2] || bounds[1] >= bounds[3] || !['png', 'jpg', 'webp'].includes(String(format))) throw new Error('Invalid XYZ tile metadata. See the offline package instructions.')
  return { name, attribution, minZoom, maxZoom, tileSize, bounds: [bounds[0], bounds[1], bounds[2], bounds[3]], format: format as OfflineBasemap['format'] }
}
export async function importOfflineBasemap(file: File): Promise<OfflineBasemap> {
  if (file.size > 250 * 1024 * 1024) throw new Error('Offline tile packages are limited to 250 MB per file.')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const entry = zip.file('metadata.json')
  if (!entry) throw new Error('Expected metadata.json and tiles/z/x/y.png (or jpg/webp) in the ZIP.')
  const metadata = parseOfflineMetadata(JSON.parse(await entry.async('string')))
  const tiles = Object.keys(zip.files).filter(path => new RegExp(`^tiles/\\d+/\\d+/\\d+\\.${metadata.format}$`).test(path))
  if (!tiles.length) throw new Error('This package contains no XYZ tiles.')
  return { ...metadata, assetId: await putAsset(file, file.name) }
}
let registered = false
let archive: { id: string; data: Promise<JSZip> } | undefined
export function registerOfflineProtocol() {
  if (registered) return
  registered = true
  addProtocol('arcweb-tile', async (request, controller) => {
    const url = new URL(request.url)
    const id = url.hostname
    if (!archive || archive.id !== id) archive = { id, data: getAsset(id).then(async blob => JSZip.loadAsync(await blob.arrayBuffer())) }
    const zip = await archive.data
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const entry = zip.file(`tiles${url.pathname}`)
    // Packages cover finite areas/zooms: uncovered tiles are transparent, never fetched online.
    const data = entry ? await entry.async('arraybuffer') : Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='), char => char.charCodeAt(0)).buffer
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    return { data }
  })
}
export function offlineStyle(basemap: OfflineBasemap): StyleSpecification {
  const attribution = basemap.attribution.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
  return { version: 8, sources: { offline: { type: 'raster', tiles: [`arcweb-tile://${basemap.assetId}/{z}/{x}/{y}.${basemap.format}`], tileSize: basemap.tileSize, minzoom: basemap.minZoom, maxzoom: basemap.maxZoom, bounds: basemap.bounds, attribution } }, layers: [{ id: 'offline-basemap', source: 'offline', type: 'raster' }] }
}
