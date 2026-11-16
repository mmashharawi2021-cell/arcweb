import { isolate } from '../../bidi'
import type { Geometry, Position } from 'geojson'
import { createRasterGrid, rasterCoordinateToWgs84, rasterFromFeatureCollection, rasterToFeatureCollection, type RasterGrid } from '../../rasterEngine'
import type { MapLayer } from '../../store'
import { getFile, getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import type { ToolboxContext, ToolboxParameters } from '../types'
import type { ToolboxTool } from '../types'

export const SPATIAL_ANALYST_CATEGORY = 'Spatial Analyst' as ToolboxTool['category']
export const rasterInput = (id = 'raster') => ({ id, label: 'Input raster', kind: 'layer' as const, required: true })
export const outputNameInput = (defaultValue: string) => ({ id: 'outputName', label: 'Output name', kind: 'text' as const, defaultValue })

export function getRaster(context: ToolboxContext, parameters: ToolboxParameters, id = 'raster'): { layer: MapLayer; grid: RasterGrid } {
  const layer = getLayer(context, parameters, id)
  const field = getOptionalText(parameters, `${id}ValueField`) || (id === 'raster' ? getOptionalText(parameters, 'valueField') : '') || 'value'
  return { layer, grid: rasterFromFeatureCollection(layer.data, field) }
}

export function gridOutput(name: string, grid: RasterGrid) {
  const data = rasterToFeatureCollection(grid)
  if (!data.features.length) throw new Error('The operation produced no valid raster cells (all output cells are NoData).')
  const layer = outputLayer(name, data, grid.crs)
  layer.fillColor = '#63b3ed'
  layer.strokeColor = '#172554'
  layer.strokeWidth = 0.25
  layer.opacity = 0.9
  return layer
}

export function outputName(parameters: ToolboxParameters, fallback: string): string {
  const name = getOptionalText(parameters, 'outputName')
  return name || fallback
}

export function getPositiveNumber(parameters: ToolboxParameters, id: string, label: string, fallback?: number): number {
  const value = parameters[id] === undefined && fallback !== undefined ? fallback : getNumber(parameters, id, label)
  if (value <= 0) throw new Error(`${label} must be greater than zero.`)
  return value
}

export function getNumberOrDefault(parameters: ToolboxParameters, id: string, label: string, fallback: number): number {
  return parameters[id] === undefined || parameters[id] === '' ? fallback : getNumber(parameters, id, label)
}

export function getPointSamples(context: ToolboxContext, parameters: ToolboxParameters, valueField: string) {
  const layer = getLayer(context, parameters, 'points')
  const samples = layer.data.features.flatMap((feature) => {
    if (feature.geometry?.type !== 'Point') return []
    const raw = feature.properties?.[valueField]
    if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) return []
    const value = Number(raw)
    const [x, y] = feature.geometry.coordinates
    return Number.isFinite(value) && Number.isFinite(x) && Number.isFinite(y) ? [{ x, y, value }] : []
  })
  if (!samples.length) throw new Error(`The input layer has no point features with numeric values in "${isolate(valueField)}".`)
  return { layer, samples }
}

export function pointGrid(
  bounds: [number, number, number, number],
  cellSize: number,
  calculate: (x: number, y: number) => number,
  crs = 'EPSG:4326',
): RasterGrid {
  if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new Error('Cell size must be a positive finite number.')
  const [minX, minY, maxX, maxY] = bounds
  const width = Math.max(1, Math.ceil((maxX - minX) / cellSize))
  const height = Math.max(1, Math.ceil((maxY - minY) / cellSize))
  if (width * height > 250_000) throw new Error('Output exceeds the 250,000-cell processing limit. Increase the cell size or reduce the input extent.')
  const values = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      values[row * width + column] = calculate(minX + (column + 0.5) * cellSize, maxY - (row + 0.5) * cellSize)
    }
  }
  return createRasterGrid(width, height, values, {
    origin: [minX, maxY], resolution: [cellSize, -cellSize], crs,
  })
}

export function rasterLayerBounds(layer: MapLayer): [number, number, number, number] {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  const visitPositions = (coordinates: unknown, visit: (position: Position) => void) => {
    if (!Array.isArray(coordinates)) return
    if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      visit(coordinates as Position)
    } else coordinates.forEach((child) => visitPositions(child, visit))
  }
  for (const feature of layer.data.features) {
    const visit = (geometry: Geometry | null) => {
      if (!geometry) return
      if (geometry.type === 'GeometryCollection') {
        geometry.geometries.forEach(visit)
        return
      }
      visitPositions(geometry.coordinates, ([x, y]) => {
        bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y)
        bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y)
      })
    }
    visit(feature.geometry)
  }
  if (!bounds.every(Number.isFinite)) throw new Error('The input layer has no usable coordinates.')
  return bounds as [number, number, number, number]
}

export function gridCenter(grid: RasterGrid, row: number, column: number): [number, number] {
  return [grid.origin[0] + (column + 0.5) * grid.resolution[0], grid.origin[1] + (row + 0.5) * grid.resolution[1]]
}

export function gridCenterWgs84(grid: RasterGrid, row: number, column: number): [number, number] {
  const [x, y] = gridCenter(grid, row, column)
  return rasterCoordinateToWgs84(x, y, grid.crs)
}

export { getFile, getLayer, getNumber, getOptionalText }
