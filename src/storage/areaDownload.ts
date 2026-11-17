import JSZip from 'jszip'

export type AreaBounds = [number, number, number, number]
export const NASA_TILE_ROOT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8'
export const MAX_AREA_TILES = 2000
export const MAX_AREA_BYTES = 50 * 1024 * 1024
export interface AreaPlan { bounds: AreaBounds; minZoom: number; maxZoom: number; tiles: { z: number; x: number; y: number }[]; estimatedBytes: number }
const limit = 85.0511287798066
const tileY = (latitude: number, count: number) => (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * count
const clamp = (value: number, count: number) => Math.max(0, Math.min(count - 1, value))

/** XYZ / EPSG:3857 coverage. East/south edges are exclusive at exact tile boundaries. */
export function planArea(bounds: AreaBounds, minZoom: number, maxZoom: number): AreaPlan {
  const [west, south, east, north] = bounds
  if (!bounds.every(Number.isFinite) || west < -180 || east > 180 || west >= east || south < -limit || north > limit || south >= north) throw new Error('Choose valid bounds within ±180° longitude and ±85.0511° latitude. Split date-line crossing areas into two downloads.')
  if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom < 0 || maxZoom > 8 || minZoom > maxZoom) throw new Error('NASA Blue Marble supports zoom levels 0–8. Minimum zoom must not exceed maximum zoom.')
  const tiles: AreaPlan['tiles'] = []
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z
    const firstX = clamp(Math.floor((west + 180) / 360 * n), n)
    const lastX = clamp(Math.ceil((east + 180) / 360 * n) - 1, n)
    const firstY = clamp(Math.floor(tileY(north, n)), n)
    const lastY = clamp(Math.ceil(tileY(south, n)) - 1, n)
    const count = (lastX - firstX + 1) * (lastY - firstY + 1)
    if (tiles.length + count > MAX_AREA_TILES) throw new Error(`This area exceeds ${MAX_AREA_TILES.toLocaleString('en-US')} tiles. Choose a smaller area or lower maximum zoom.`)
    for (let x = firstX; x <= lastX; x++) for (let y = firstY; y <= lastY; y++) tiles.push({ z, x, y })
  }
  return { bounds: [...bounds], minZoom, maxZoom, tiles, estimatedBytes: tiles.length * 25 * 1024 }
}
const cancelled = () => new DOMException('Download cancelled. No partial basemap was saved.', 'AbortError')
export async function downloadArea(plan: AreaPlan, signal: AbortSignal, onProgress: (done: number, total: number, bytes: number) => void): Promise<File> {
  // Revalidate at the network boundary; never trust an externally constructed plan.
  const checked = planArea(plan.bounds, plan.minZoom, plan.maxZoom)
  if (signal.aborted) throw cancelled()
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const zip = new JSZip()
  let next = 0, done = 0, bytes = 0
  const workers = Array.from({ length: Math.min(2, checked.tiles.length) }, async () => {
    while (next < checked.tiles.length) {
      if (controller.signal.aborted) throw cancelled()
      const tile = checked.tiles[next++]
      const response = await fetch(`${NASA_TILE_ROOT}/${tile.z}/${tile.y}/${tile.x}.jpeg`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]), credentials: 'omit', cache: 'force-cache',
      })
      if (!response.ok) throw new Error(`NASA tile download returned HTTP ${response.status}. Retry later; no partial basemap was saved.`)
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/jpeg')) throw new Error('The provider returned an unexpected tile format.')
      const data = await response.arrayBuffer(), header = new Uint8Array(data)
      if (data.byteLength > 2 * 1024 * 1024 || header[0] !== 0xff || header[1] !== 0xd8) throw new Error('The provider returned an invalid or oversized JPEG tile.')
      bytes += data.byteLength
      if (bytes > MAX_AREA_BYTES) throw new Error('Download exceeded 50 MB. Choose a smaller area or lower maximum zoom.')
      zip.file(`tiles/${tile.z}/${tile.x}/${tile.y}.jpg`, data)
      onProgress(++done, checked.tiles.length, bytes)
      // Two workers with a short pause keep requests and bandwidth modest.
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(cancelled()) }
        const pauseMs = Math.max(100, Math.ceil(data.byteLength / (2 * 1024 * 1024) * 1000))
        const timer = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve() }, pauseMs)
        if (controller.signal.aborted) { onAbort(); return }
        controller.signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  })
  try {
    await Promise.all(workers)
    if (signal.aborted) throw cancelled()
    zip.file('metadata.json', JSON.stringify({ name: 'NASA Blue Marble — saved area', attribution: 'Imagery courtesy NASA EOSDIS GIBS / Blue Marble',
      minZoom: checked.minZoom, maxZoom: checked.maxZoom, tileSize: 256, bounds: checked.bounds, format: 'jpg' }))
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, () => { if (signal.aborted) throw cancelled() })
    if (signal.aborted) throw cancelled()
    return new File([blob], 'nasa-blue-marble-area.zip', { type: 'application/zip' })
  } catch (error) {
    controller.abort()
    await Promise.allSettled(workers)
    if (signal.aborted) throw cancelled()
    throw error
  } finally { signal.removeEventListener('abort', abort) }
}
