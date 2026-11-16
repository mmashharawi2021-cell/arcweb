import { fromArrayBuffer } from 'geotiff'
import type { RasterGrid } from '../../rasterEngine'
import { createRasterGrid, MAX_RASTER_CELLS, rasterFromFeatureCollection, rasterToFeatureCollection } from '../../rasterEngine'
import type { MapLayer } from '../../store'
import { getLayers, getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import type { ToolboxContext, ToolboxParameters, ToolboxTool } from '../types'

export const IMAGE_ANALYST_CATEGORY = 'Image Analyst' as ToolboxTool['category']
export const rasterInput = (id = 'raster') => ({ id, label: 'Input raster', kind: 'layer' as const, required: true })
export const outputNameInput = (defaultValue: string) => ({ id: 'outputName', label: 'Output name', kind: 'text' as const, defaultValue })

export function getRaster(context: ToolboxContext, parameters: ToolboxParameters, id = 'raster'): { layer: MapLayer; grid: RasterGrid } {
  const layer = getLayer(context, parameters, id)
  const field = getOptionalText(parameters, `${id}ValueField`) || (id === 'raster' ? getOptionalText(parameters, 'valueField') : '') || 'value'
  return { layer, grid: validateGrid(rasterFromFeatureCollection(layer.data, field)) }
}

export function validateGrid(grid: RasterGrid): RasterGrid {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1 ||
    grid.width * grid.height > MAX_RASTER_CELLS || grid.values.length !== grid.width * grid.height) {
    throw new Error(`Raster dimensions are invalid or exceed the ${MAX_RASTER_CELLS.toLocaleString()}-cell processing limit.`)
  }
  if (!grid.origin.every(Number.isFinite) || !grid.resolution.every((value) => Number.isFinite(value) && value !== 0)) {
    throw new Error('Raster has invalid origin or cell resolution.')
  }
  return grid
}

export function assertAlignedGrids(grids: RasterGrid[]): void {
  if (!grids.length) throw new Error('Select at least one raster band.')
  const first = validateGrid(grids[0])
  for (const grid of grids.slice(1)) {
    validateGrid(grid)
    if (grid.crs !== first.crs || grid.width !== first.width || grid.height !== first.height ||
      grid.origin.some((value, index) => Math.abs(value - first.origin[index]) > 1e-10) ||
      grid.resolution.some((value, index) => Math.abs(value - first.resolution[index]) > 1e-10)) {
      throw new Error('Raster bands must have the same CRS, dimensions, origin and cell resolution. Resample them first.')
    }
  }
}

function geoTiffCrs(image: Awaited<ReturnType<Awaited<ReturnType<typeof fromArrayBuffer>>['getImage']>>): string {
  const keys = image.getGeoKeys() as Record<string, number | undefined>
  const code = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey
  return code && code !== 32767 ? `EPSG:${code}` : 'EPSG:4326'
}

/** Reads each requested one-based sample from a GeoTIFF without using rasterEngine's band-1 reader. */
export async function readGeoTiffBands(file: File, requestedBands?: number[], maxBands?: number): Promise<RasterGrid[]> {
  let image
  try {
    const tiff = await fromArrayBuffer(await file.arrayBuffer())
    image = await tiff.getImage()
  } catch (error) {
    throw new Error(`Could not read GeoTIFF: ${error instanceof Error ? error.message : 'invalid TIFF data'}`)
  }
  const width = image.getWidth()
  const height = image.getHeight()
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    width * height > MAX_RASTER_CELLS) {
    throw new Error(`GeoTIFF dimensions are invalid or exceed the ${MAX_RASTER_CELLS.toLocaleString()}-cell processing limit.`)
  }
  const samplesPerPixel = image.getSamplesPerPixel()
  if (maxBands !== undefined && samplesPerPixel > maxBands) {
    throw new Error(`Use no more than ${maxBands} GeoTIFF bands.`)
  }
  const bands = requestedBands ?? Array.from({ length: samplesPerPixel }, (_, index) => index + 1)
  if (!bands.length || bands.some((band) => !Number.isInteger(band) || band < 1 || band > samplesPerPixel)) {
    throw new Error(`Band numbers must be integers from 1 to ${samplesPerPixel}.`)
  }
  const origin = image.getOrigin()
  const resolution = image.getResolution()
  if (!origin || !resolution || resolution[0] === 0 || resolution[1] === 0 ||
    !origin.every(Number.isFinite) || !resolution.every(Number.isFinite)) {
    throw new Error('GeoTIFF has no usable affine origin/resolution; rotated or ungeoreferenced rasters are not supported.')
  }
  const crs = geoTiffCrs(image)
  if (crs === 'EPSG:4326') {
    const bounds = [origin[0], origin[1], origin[0] + width * resolution[0], origin[1] + height * resolution[1]]
    if (Math.min(bounds[0], bounds[2]) < -180 || Math.max(bounds[0], bounds[2]) > 180 ||
      Math.min(bounds[1], bounds[3]) < -90 || Math.max(bounds[1], bounds[3]) > 90) {
      throw new Error('GeoTIFF has no supported geographic CRS key and coordinates are not valid WGS84. Reproject it before use.')
    }
  }
  const noDataValue = image.getGDALNoData()
  const noData = noDataValue === null ? Number.NaN : Number(noDataValue)
  const result: RasterGrid[] = []
  for (const band of bands) {
    try {
      const pixels = await image.readRasters({ samples: [band - 1], interleave: true })
      result.push(createRasterGrid(width, height, pixels as ArrayLike<number>, {
        origin: [origin[0], origin[1]], resolution: [resolution[0], resolution[1]], noData, crs,
      }))
    } catch (error) {
      throw new Error(`Could not decode GeoTIFF band ${band}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  return result
}

/** A GeoTIFF file takes precedence; otherwise use checked, ordered raster-cell layers. */
export async function getBandGrids(
  context: ToolboxContext,
  parameters: ToolboxParameters,
  options: { maxLayers?: number; maxGeoTiffBands?: number; defaultGeoTiffBands?: number[] } = {},
): Promise<{ grids: RasterGrid[]; name: string }> {
  const file = parameters.file
  if (typeof File !== 'undefined' && file instanceof File) {
    return {
      grids: await readGeoTiffBands(file, options.defaultGeoTiffBands, options.maxGeoTiffBands),
      name: file.name.replace(/\.tiff?$/i, '') || 'GeoTIFF',
    }
  }
  const layers = getLayers(context, parameters, 'bandRasters')
  if (!layers.length) throw new Error('Select a GeoTIFF file or one or more separate raster band layers.')
  if (options.maxLayers !== undefined && layers.length > options.maxLayers) {
    throw new Error(`Select no more than ${options.maxLayers} separate raster bands.`)
  }
  const grids = layers.map((layer) => rasterFromFeatureCollection(layer.data, getOptionalText(parameters, 'valueField') || 'value'))
  assertAlignedGrids(grids)
  return { grids, name: layers.map((layer) => layer.name).join(', ') }
}

export function gridOutput(name: string, grid: RasterGrid, extraProperties?: Record<string, unknown>) {
  validateGrid(grid)
  const data = rasterToFeatureCollection(grid)
  if (!data.features.length) throw new Error('The operation produced no valid raster cells (all output cells are NoData).')
  if (extraProperties) {
    for (const feature of data.features) feature.properties = { ...feature.properties, ...extraProperties }
  }
  const layer = outputLayer(name, data, grid.crs)
  layer.fillColor = '#63b3ed'
  layer.strokeColor = '#172554'
  layer.strokeWidth = 0.25
  layer.opacity = 0.9
  return layer
}

export function outputName(parameters: ToolboxParameters, fallback: string): string {
  return getOptionalText(parameters, 'outputName') || fallback
}

export function getPositiveNumber(parameters: ToolboxParameters, id: string, label: string, fallback: number): number {
  const value = parameters[id] === undefined || parameters[id] === '' ? fallback : getNumber(parameters, id, label)
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${label} must be a positive finite number.`)
  return value
}

export function assertValidCellCount(width: number, height: number, label = 'Output'): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    !Number.isSafeInteger(width * height) || width * height > MAX_RASTER_CELLS) {
    throw new Error(`${label} dimensions are invalid or exceed the ${MAX_RASTER_CELLS.toLocaleString()}-cell MapLayer limit.`)
  }
}
