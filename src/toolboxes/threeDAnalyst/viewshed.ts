import { isolate } from '../../bidi'
import { createRasterGrid } from '../../rasterEngine'
import { gridOutput, getRaster, rasterInput } from '../spatialAnalyst/_shared'
import { getLayer, getNumber } from '../shared'
import { getPointCoordinates, gridNativeCoordinate, lineCoordinateToRasterNative, terrainElevation } from './_visibility'
import { outputNameParameter, sampleRasterNative, THREE_D_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

const MAX_VIEWSHED_CELLS = 10_000
const MAX_VIEWSHED_SAMPLES = 2_000_000

export const viewshedTool: ToolboxTool = {
  id: 'viewshed',
  name: 'Viewshed',
  category: THREE_D_CATEGORY,
  subcategory: 'Visibility',
  description: 'Create a binary raster showing terrain cells visible from a point observer above the input elevation surface.',
  keywords: ['visibility', 'viewshed', 'observer', 'terrain', 'elevation'],
  parameters: [
    { id: 'points', label: 'Observer point layer', kind: 'layer', required: true },
    rasterInput(),
    { id: 'observerIndex', label: 'Observer point number (zero-based)', kind: 'number', defaultValue: 0, min: 0, step: 1 },
    { id: 'observerHeight', label: 'Observer height above terrain (m)', kind: 'number', defaultValue: 1.7, min: 0 },
    { id: 'valueField', label: 'Raster elevation field', kind: 'text', defaultValue: 'value' },
    outputNameParameter('Viewshed'),
  ],
  execute: (context, parameters) => {
    const points = getLayer(context, parameters, 'points')
    const { layer, grid } = getRaster(context, parameters)
    const observer = getPointCoordinates(points.data, getNumber(parameters, 'observerIndex', 'observer point number'), 'Observer')
    const observerNative = lineCoordinateToRasterNative(grid, observer)
    const observerElevation = sampleRasterNative(grid, ...observerNative)
    if (observerElevation === null) throw new Error('The observer must lie over a valid, non-NoData elevation cell.')
    if (grid.width * grid.height > MAX_VIEWSHED_CELLS) {
      throw new Error(`Viewshed is limited to ${MAX_VIEWSHED_CELLS.toLocaleString()} raster cells per run. Resample the elevation raster first.`)
    }
    const observerHeight = getNumber(parameters, 'observerHeight', 'observer height')
    if (observerHeight < 0) throw new Error('Observer height cannot be negative.')
    const eye = observerElevation + observerHeight
    const values = new Float32Array(grid.values.length).fill(grid.noData)
    let totalSamples = 0
    let visibleCount = 0
    let noDataSamplesIgnored = 0
    for (let row = 0; row < grid.height; row += 1) {
      for (let column = 0; column < grid.width; column += 1) {
        const targetElevation = terrainElevation(grid, row, column)
        if (targetElevation === null) continue
        const targetNative = gridNativeCoordinate(grid, row, column)
        const targetColumn = (targetNative[0] - grid.origin[0]) / grid.resolution[0] - 0.5
        const targetRow = (targetNative[1] - grid.origin[1]) / grid.resolution[1] - 0.5
        const observerColumn = (observerNative[0] - grid.origin[0]) / grid.resolution[0] - 0.5
        const observerRow = (observerNative[1] - grid.origin[1]) / grid.resolution[1] - 0.5
        const steps = Math.ceil(Math.max(Math.abs(targetColumn - observerColumn), Math.abs(targetRow - observerRow)) * 2)
        if (totalSamples + Math.max(0, steps - 1) > MAX_VIEWSHED_SAMPLES) {
          throw new Error(`Viewshed exceeded the ${MAX_VIEWSHED_SAMPLES.toLocaleString()} terrain-sample limit. Use a smaller or coarser raster.`)
        }
        totalSamples += Math.max(0, steps - 1)
        let visible = true
        for (let step = 1; step < steps; step += 1) {
          const fraction = step / steps
          const sampleColumn = observerColumn + (targetColumn - observerColumn) * fraction
          const sampleRow = observerRow + (targetRow - observerRow) * fraction
          const terrain = sampleRasterNative(grid,
            grid.origin[0] + (sampleColumn + 0.5) * grid.resolution[0],
            grid.origin[1] + (sampleRow + 0.5) * grid.resolution[1],
          )
          if (terrain === null) { noDataSamplesIgnored += 1; continue }
          if (terrain > eye + (targetElevation - eye) * fraction + 1e-6) {
            visible = false
            break
          }
        }
        values[row * grid.width + column] = visible ? 1 : 0
        if (visible) visibleCount += 1
      }
    }
    const name = typeof parameters.outputName === 'string' && parameters.outputName.trim() ? parameters.outputName.trim() : `${layer.name} Viewshed`
    const output = gridOutput(name, createRasterGrid(grid.width, grid.height, values, {
      origin: grid.origin, resolution: grid.resolution, crs: grid.crs, noData: grid.noData,
    }))
    output.fillColor = '#55d6a4'
    return {
      message: `${isolate(name)}: ${visibleCount.toLocaleString()} of ${grid.width * grid.height} raster cells are visible. NoData target cells were excluded${noDataSamplesIgnored ? `; ${noDataSamplesIgnored.toLocaleString()} intermediate NoData samples were ignored` : ''}.`,
      ...(noDataSamplesIgnored ? { kind: 'warning' as const } : {}),
      layers: [output],
    }
  },
}
