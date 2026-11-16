import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature } from 'geojson'
import { isNoData, rasterValue, type RasterGrid } from '../../rasterEngine'
import { outputLayer } from '../shared'
import { rasterCoordinateToWgs84 } from '../../rasterEngine'
import { gridCenter, gridOutput, getNumber, getNumberOrDefault, getRaster, outputName, rasterInput, SPATIAL_ANALYST_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

function derivatives(grid: RasterGrid, row: number, column: number, zFactor: number): [number, number] | null {
  const values = [
    rasterValue(grid, row - 1, column - 1), rasterValue(grid, row - 1, column), rasterValue(grid, row - 1, column + 1),
    rasterValue(grid, row, column - 1), rasterValue(grid, row, column + 1),
    rasterValue(grid, row + 1, column - 1), rasterValue(grid, row + 1, column), rasterValue(grid, row + 1, column + 1),
  ]
  if (values.some((value) => isNoData(value, grid.noData))) return null
  const [a, b, c, d, f, g, h, i] = values
  const isGeographic = grid.crs === 'EPSG:4326' || grid.crs === 'OGC:CRS84'
  const latitude = grid.origin[1] + (row + 0.5) * grid.resolution[1]
  const dx = Math.abs(grid.resolution[0]) * (isGeographic ? 111319.49079327358 * Math.cos(latitude * Math.PI / 180) : 1)
  const dy = Math.abs(grid.resolution[1]) * (isGeographic ? 111132.92 : 1)
  if (!dx || !dy) throw new Error('Raster cell resolution must be non-zero for terrain analysis.')
  return [
    ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * dx) * zFactor,
    ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * dy) * zFactor,
  ]
}

function terrainTool(kind: 'slope' | 'aspect' | 'hillshade'): ToolboxTool {
  const labels = { slope: 'Slope', aspect: 'Aspect', hillshade: 'Hillshade' }
  const toolName = labels[kind]
  return {
    id: kind, name: toolName, category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Surface',
    description: kind === 'slope' ? 'Calculate maximum elevation change in degrees for each raster cell.' :
      kind === 'aspect' ? 'Calculate downhill compass direction in degrees (flat cells are NoData).' :
        'Create an 8-bit shaded-relief raster from elevation, azimuth and sun altitude.',
    keywords: ['terrain', 'elevation', kind],
    parameters: [
      rasterInput(),
      { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
      { id: 'zFactor', label: 'Vertical scale factor', kind: 'number', defaultValue: 1, min: 0.000001 },
      ...(kind === 'hillshade' ? [
        { id: 'azimuth', label: 'Sun azimuth (degrees clockwise from north)', kind: 'number' as const, defaultValue: 315, min: 0, max: 360 },
        { id: 'altitude', label: 'Sun altitude (degrees)', kind: 'number' as const, defaultValue: 45, min: 0.1, max: 90 },
      ] : []),
      { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: `Raster ${toolName}` },
    ],
    execute: (context, parameters) => {
      const { layer, grid } = getRaster(context, parameters)
      const zFactor = getNumberOrDefault(parameters, 'zFactor', 'vertical scale factor', 1)
      if (zFactor <= 0) throw new Error('Vertical scale factor must be greater than zero.')
      const azimuth = getNumberOrDefault(parameters, 'azimuth', 'sun azimuth', 315) * Math.PI / 180
      const altitude = getNumberOrDefault(parameters, 'altitude', 'sun altitude', 45) * Math.PI / 180
      if (kind === 'hillshade' && (altitude <= 0 || altitude > Math.PI / 2)) throw new Error('Sun altitude must be greater than 0 and no more than 90 degrees.')
      const values = new Float32Array(grid.values.length).fill(grid.noData)
      for (let row = 0; row < grid.height; row += 1) {
        for (let column = 0; column < grid.width; column += 1) {
          if (isNoData(rasterValue(grid, row, column), grid.noData)) continue
          const gradient = derivatives(grid, row, column, zFactor)
          if (!gradient) continue
          const [dx, dy] = gradient
          if (kind === 'slope') values[row * grid.width + column] = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI
          else {
            const slope = Math.atan(Math.hypot(dx, dy))
            if (kind === 'aspect') {
              if (slope < 1e-12) continue
              let bearing = Math.atan2(-dx, -dy) * 180 / Math.PI
              if (bearing < 0) bearing += 360
              values[row * grid.width + column] = bearing
            } else {
              const aspect = Math.atan2(-dx, -dy)
              const illumination = Math.cos(Math.PI / 2 - altitude) * Math.cos(slope) +
                Math.sin(Math.PI / 2 - altitude) * Math.sin(slope) * Math.cos(azimuth - aspect)
              values[row * grid.width + column] = Math.max(0, Math.min(255, Math.round(255 * illumination)))
            }
          }
        }
      }
      const output = gridOutput(outputName(parameters, `${layer.name} ${toolName}`), { ...grid, values })
      return { message: `${isolate(output.name)}: calculated ${toolName.toLowerCase()} for ${grid.width * grid.height} cells.`, layers: [output] }
    },
  }
}

export const slopeTool = terrainTool('slope')
export const aspectTool = terrainTool('aspect')
export const hillshadeTool = terrainTool('hillshade')

export const contourTool: ToolboxTool = {
  id: 'contour', name: 'Contour', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Surface',
  description: 'Generate contour line segments from a numeric elevation raster at a fixed interval.',
  keywords: ['elevation', 'isoline', 'contour'],
  parameters: [
    rasterInput(), { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'interval', label: 'Contour interval', kind: 'number', required: true, defaultValue: 10, min: 0.000001 },
    { id: 'base', label: 'Base contour', kind: 'number', defaultValue: 0 },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Contours' },
  ],
  execute: (context, parameters) => {
    const { layer, grid } = getRaster(context, parameters)
    const interval = getNumber(parameters, 'interval', 'contour interval')
    if (interval <= 0) throw new Error('Contour interval must be greater than zero.')
    const base = getNumberOrDefault(parameters, 'base', 'base contour', 0)
    let minValue = Infinity; let maxValue = -Infinity
    for (const value of grid.values) {
      if (isNoData(value, grid.noData)) continue
      minValue = Math.min(minValue, value); maxValue = Math.max(maxValue, value)
    }
    const estimatedLevels = Math.floor((maxValue - minValue) / interval) + 1
    if (estimatedLevels > 10_000 || estimatedLevels * grid.values.length > 5_000_000) {
      throw new Error('Contour interval would create too many cell-level combinations. Increase the interval or resample the raster.')
    }
    const features: Feature[] = []
    const edges: [number, number, number, number][] = [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0], [1, 0, 0, 0]]
    for (let row = 0; row < grid.height - 1; row += 1) {
      for (let column = 0; column < grid.width - 1; column += 1) {
        const corners = [
          rasterValue(grid, row, column), rasterValue(grid, row, column + 1),
          rasterValue(grid, row + 1, column + 1), rasterValue(grid, row + 1, column),
        ]
        if (corners.some((value) => isNoData(value, grid.noData))) continue
        const low = Math.min(...corners); const high = Math.max(...corners)
        const first = Math.ceil((low - base) / interval)
        const last = Math.floor((high - base) / interval)
        for (let step = first; step <= last; step += 1) {
          const level = base + step * interval
          const crossings: [number, number][] = []
          for (const [edgeIndex, [r1, c1, r2, c2]] of edges.entries()) {
            const value1 = corners[edgeIndex]; const value2 = corners[(edgeIndex + 1) % 4]
            if ((value1 < level && value2 >= level) || (value2 < level && value1 >= level)) {
              const fraction = (level - value1) / (value2 - value1)
              const p1 = gridCenter(grid, row + r1, column + c1)
              const p2 = gridCenter(grid, row + r2, column + c2)
              const x = p1[0] + (p2[0] - p1[0]) * fraction
              const y = p1[1] + (p2[1] - p1[1]) * fraction
              crossings.push(rasterCoordinateToWgs84(x, y, grid.crs))
            }
          }
          if (crossings.length >= 2) {
            for (let index = 0; index + 1 < crossings.length; index += 2) {
              const [start, end] = [crossings[index], crossings[index + 1]]
              features.push({
                type: 'Feature', properties: { elevation: level },
                geometry: { type: 'LineString', coordinates: [start, end] },
              })
            }
          }
        }
      }
    }
    if (!features.length) throw new Error('No contour lines were produced. Check the elevation range and interval.')
    const name = outputName(parameters, `${layer.name} Contours`)
    const lineLayer = outputLayer(name, featureCollection(features), grid.crs)
    return { message: `${isolate(name)}: created ${features.length} contour segments.`, layers: [lineLayer] }
  },
}
