import { fromArrayBuffer } from 'geotiff'
import proj4 from 'proj4'
import { getCrs } from './crs'

export const MAX_RASTER_CELLS = 250_000

export interface RasterGrid {
  width: number
  height: number
  /** Upper-left corner in the raster's native coordinate system. */
  origin: [number, number]
  /** Pixel width and signed pixel height; north-up rasters use a negative Y size. */
  resolution: [number, number]
  values: Float32Array
  noData: number
  crs: string
}

export function createRasterGrid(
  width: number,
  height: number,
  values: ArrayLike<number>,
  options: Partial<Pick<RasterGrid, 'origin' | 'resolution' | 'noData' | 'crs'>> = {},
): RasterGrid {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Raster width and height must be positive integers.')
  }
  if (values.length !== width * height) throw new Error(`Raster has ${values.length} values; expected ${width * height}.`)
  return {
    width, height,
    origin: options.origin ?? [0, 0],
    resolution: options.resolution ?? [1, -1],
    values: Float32Array.from(values),
    noData: options.noData ?? Number.NaN,
    crs: options.crs ?? 'EPSG:4326',
  }
}

export function isNoData(value: number, noData: number): boolean {
  return !Number.isFinite(value) || (Number.isNaN(noData) ? Number.isNaN(value) : value === noData)
}

export function rasterIndex(grid: RasterGrid, row: number, column: number): number {
  return row * grid.width + column
}

export function rasterValue(grid: RasterGrid, row: number, column: number): number {
  if (row < 0 || column < 0 || row >= grid.height || column >= grid.width) return grid.noData
  return grid.values[rasterIndex(grid, row, column)]
}

export function mapRasterValues(grid: RasterGrid, operation: (value: number, index: number) => number): RasterGrid {
  const values = new Float32Array(grid.values.length)
  for (let index = 0; index < values.length; index += 1) {
    const value = grid.values[index]
    values[index] = isNoData(value, grid.noData) ? grid.noData : operation(value, index)
  }
  return { ...grid, values }
}

export function rasterBounds(grid: RasterGrid): [number, number, number, number] {
  const x1 = grid.origin[0]
  const x2 = x1 + grid.width * grid.resolution[0]
  const y1 = grid.origin[1]
  const y2 = y1 + grid.height * grid.resolution[1]
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
}

function transformCoordinate(x: number, y: number, crs: string): [number, number] {
  if (crs === 'EPSG:4326' || crs === 'OGC:CRS84') return [x, y]
  try {
    return proj4(getCrs(crs)?.proj4 ?? crs, 'EPSG:4326', [x, y]) as [number, number]
  } catch (error) {
    throw new Error(`Cannot convert raster coordinates from ${crs} to WGS84: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}

/** Polygon-cell adapter for MapLayer/MapLibre; grid metadata is repeated so outputs can be used as inputs. */
export function rasterToFeatureCollection(grid: RasterGrid) {
  if (grid.width * grid.height > MAX_RASTER_CELLS) {
    throw new Error(`Raster exceeds the ${MAX_RASTER_CELLS.toLocaleString()}-cell MapLayer limit. Resample it before creating a map layer.`)
  }
  const features = []
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const value = rasterValue(grid, row, column)
      if (isNoData(value, grid.noData)) continue
      const x0 = grid.origin[0] + column * grid.resolution[0]
      const x1 = x0 + grid.resolution[0]
      const y0 = grid.origin[1] + row * grid.resolution[1]
      const y1 = y0 + grid.resolution[1]
      const ring = [
        transformCoordinate(x0, y0, grid.crs), transformCoordinate(x1, y0, grid.crs),
        transformCoordinate(x1, y1, grid.crs), transformCoordinate(x0, y1, grid.crs),
        transformCoordinate(x0, y0, grid.crs),
      ]
      features.push({
        type: 'Feature' as const,
        properties: {
          value, row, column, rasterWidth: grid.width, rasterHeight: grid.height,
          rasterOriginX: grid.origin[0], rasterOriginY: grid.origin[1],
          rasterResolutionX: grid.resolution[0], rasterResolutionY: grid.resolution[1],
          rasterCrs: grid.crs,
        },
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
      })
    }
  }
  return { type: 'FeatureCollection' as const, features }
}

/** Rebuilds grids made by rasterToFeatureCollection without relying on process-local state. */
export function rasterFromFeatureCollection(collection: {
  features: { properties?: Record<string, unknown> | null; geometry?: { type: string; coordinates?: unknown } | null }[]
}, valueField = 'value'): RasterGrid {
  const samples = collection.features.flatMap((feature) => {
    const properties = feature.properties
    const value = Number(properties?.[valueField])
    const row = Number(properties?.row)
    const column = Number(properties?.column)
    const geometry = feature.geometry
    if (!Number.isFinite(value) || !Number.isInteger(row) || !Number.isInteger(column) || !geometry) return []
    if (geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return []
    const ring = geometry.coordinates[0] as [number, number][]
    if (!ring || ring.length < 4) return []
    const x = ring.reduce((sum, point) => sum + point[0], 0) / ring.length
    const y = ring.reduce((sum, point) => sum + point[1], 0) / ring.length
    return [{ row, column, value, x, y, width: Number(properties?.rasterWidth), height: Number(properties?.rasterHeight) }]
  })
  if (!samples.length) throw new Error('The selected layer is not a raster layer. Choose a raster output or import a GeoTIFF.')
  const width = samples.reduce((max, sample) => Math.max(max, sample.width || sample.column + 1), 0)
  const height = samples.reduce((max, sample) => Math.max(max, sample.height || sample.row + 1), 0)
  if (width * height > MAX_RASTER_CELLS) throw new Error(`Raster exceeds the ${MAX_RASTER_CELLS.toLocaleString()}-cell in-memory processing limit.`)
  const metadata = collection.features.find((feature) =>
    Number.isFinite(Number(feature.properties?.rasterOriginX)) &&
    Number.isFinite(Number(feature.properties?.rasterResolutionX)))
  const metadataProps = metadata?.properties
  const values = new Float32Array(width * height).fill(Number.NaN)
  for (const sample of samples) values[sample.row * width + sample.column] = sample.value
  if (metadataProps) {
    return createRasterGrid(width, height, values, {
      origin: [Number(metadataProps.rasterOriginX), Number(metadataProps.rasterOriginY)],
      resolution: [Number(metadataProps.rasterResolutionX), Number(metadataProps.rasterResolutionY)],
      crs: typeof metadataProps.rasterCrs === 'string' ? metadataProps.rasterCrs : 'EPSG:4326',
    })
  }
  const first = samples[0]
  const topLeft = samples.find((sample) => sample.row === 0 && sample.column === 0) ?? first
  const nextX = samples.find((sample) => sample.row === topLeft.row && sample.column === topLeft.column + 1)
  const nextY = samples.find((sample) => sample.row === topLeft.row + 1 && sample.column === topLeft.column)
  const resolution: [number, number] = [nextX ? nextX.x - topLeft.x : 1, nextY ? nextY.y - topLeft.y : -1]
  const origin: [number, number] = [
    topLeft.x - (topLeft.column + 0.5) * resolution[0],
    topLeft.y - (topLeft.row + 0.5) * resolution[1],
  ]
  return createRasterGrid(width, height, values, { origin, resolution, crs: 'EPSG:4326' })
}

export function rasterCoordinateToWgs84(x: number, y: number, crs: string): [number, number] {
  return transformCoordinate(x, y, crs)
}

/** Reads the first numeric band in a GeoTIFF in-browser (no filesystem or server APIs). */
export async function readGeoTiff(file: Blob): Promise<RasterGrid> {
  let image
  try {
    const tiff = await fromArrayBuffer(await file.arrayBuffer())
    image = await tiff.getImage()
  } catch (error) {
    throw new Error(`Could not read GeoTIFF: ${error instanceof Error ? error.message : 'invalid TIFF data'}`)
  }
  const width = image.getWidth()
  const height = image.getHeight()
  if (width * height > MAX_RASTER_CELLS) throw new Error(`GeoTIFF exceeds the ${MAX_RASTER_CELLS.toLocaleString()}-cell in-memory processing limit. Resample it before import.`)
  let values: Float32Array
  try {
    const raster = await image.readRasters({ samples: [0], interleave: true })
    values = Float32Array.from(raster as ArrayLike<number>)
  } catch (error) {
    throw new Error(`Could not decode the GeoTIFF first band: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
  const origin = image.getOrigin()
  const resolution = image.getResolution()
  if (!origin || !resolution || resolution[0] === 0 || resolution[1] === 0) {
    throw new Error('GeoTIFF has no usable affine origin/resolution; rotated or ungeoreferenced rasters are not supported.')
  }
  const keys = image.getGeoKeys() as Record<string, number | undefined>
  const code = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey
  const crs = code && code !== 32767 ? `EPSG:${code}` : 'EPSG:4326'
  const noDataValue = image.getGDALNoData()
  const noData = noDataValue === null ? Number.NaN : Number(noDataValue)
  if (crs === 'EPSG:4326') {
    const bounds = [origin[0], origin[1], origin[0] + width * resolution[0], origin[1] + height * resolution[1]]
    if (Math.min(bounds[0], bounds[2]) < -180 || Math.max(bounds[0], bounds[2]) > 180 ||
      Math.min(bounds[1], bounds[3]) < -90 || Math.max(bounds[1], bounds[3]) > 90) {
      throw new Error('GeoTIFF has no supported CRS key and coordinates are not valid WGS84. Reproject it to EPSG:4326 before import.')
    }
  }
  return createRasterGrid(width, height, values, { origin: [origin[0], origin[1]], resolution: [resolution[0], resolution[1]], noData, crs })
}
