import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import { createRasterGrid } from '../../rasterEngine'
import { getLayer, getNumber, getOptionalText } from '../shared'
import { assertValidCellCount, gridOutput, outputName, IMAGE_ANALYST_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

function visitPositions(value: unknown, visit: (position: Position) => void): void {
  if (!Array.isArray(value)) return
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    visit(value as Position)
    return
  }
  value.forEach((child) => visitPositions(child, visit))
}

export const polygonToRasterTool: ToolboxTool = {
  id: 'polygonToRaster',
  name: 'Polygon To Raster',
  category: IMAGE_ANALYST_CATEGORY,
  subcategory: 'Conversion',
  description: 'Rasterize polygon features by testing cell centers in WGS84. The first matching feature wins where polygons overlap.',
  keywords: ['polygon', 'rasterize', 'conversion', 'cell size'],
  parameters: [
    { id: 'polygons', label: 'Input polygon layer', kind: 'layer', required: true },
    { id: 'valueField', label: 'Numeric value field', kind: 'field', layerParameter: 'polygons', required: true },
    { id: 'cellSize', label: 'Cell size (degrees)', kind: 'number', required: true, defaultValue: 0.01, min: 0.000001 },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Polygon raster' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'polygons')
    const valueField = getOptionalText(parameters, 'valueField')
    if (!valueField) throw new Error('Choose a numeric value field.')
    const sourcePolygons = layer.data.features.filter((feature): feature is Feature<Polygon | MultiPolygon> =>
      feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon')
    if (!sourcePolygons.length) throw new Error('The input layer must contain polygon or multipolygon features.')
    const polygons = sourcePolygons.flatMap((feature) => {
      let validCoordinates = true
      visitPositions(feature.geometry.coordinates, (position) => {
        if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) validCoordinates = false
      })
      const value = Number(feature.properties?.[valueField])
      return validCoordinates && Number.isFinite(value) ? [{ feature, value }] : []
    })
    if (!polygons.length) throw new Error(`No polygon has a valid geometry and numeric "${valueField}" value.`)
    const bounds = [Infinity, Infinity, -Infinity, -Infinity]
    for (const { feature } of polygons) {
      visitPositions(feature.geometry.coordinates, ([x, y]) => {
        bounds[0] = Math.min(bounds[0], x)
        bounds[1] = Math.min(bounds[1], y)
        bounds[2] = Math.max(bounds[2], x)
        bounds[3] = Math.max(bounds[3], y)
      })
    }
    if (!bounds.every(Number.isFinite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
      throw new Error('The polygon layer has no usable non-zero extent.')
    }
    const rawCellSize = parameters.cellSize
    const cellSize = typeof rawCellSize === 'number' ? rawCellSize : getNumber(parameters, 'cellSize', 'Cell size')
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new Error('Cell size must be a positive finite number.')
    const width = Math.max(1, Math.ceil((bounds[2] - bounds[0]) / cellSize))
    const height = Math.max(1, Math.ceil((bounds[3] - bounds[1]) / cellSize))
    assertValidCellCount(width, height)
    if (width * height * polygons.length > 5_000_000) {
      throw new Error('Polygon rasterization would exceed 5,000,000 cell/polygon checks. Use fewer polygons or a larger cell size.')
    }
    const values = new Float32Array(width * height).fill(Number.NaN)
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const index = row * width + column
        const location = point([
          bounds[0] + (column + 0.5) * cellSize,
          bounds[3] - (row + 0.5) * cellSize,
        ])
        const match = polygons.find(({ feature }) => booleanPointInPolygon(location, feature))
        if (match) values[index] = match.value
      }
    }
    if (!values.some(Number.isFinite)) throw new Error('No raster cell centers fell inside a polygon.')
    const grid = createRasterGrid(width, height, values, {
      origin: [bounds[0], bounds[3]], resolution: [cellSize, -cellSize], noData: Number.NaN, crs: 'EPSG:4326',
    })
    const name = outputName(parameters, `${layer.name} Raster`)
    const output = gridOutput(name, grid)
    return { message: `${name}: rasterized ${polygons.length} polygon features to ${width} × ${height} cells at ${cellSize}° resolution.`, layers: [output] }
  },
}
