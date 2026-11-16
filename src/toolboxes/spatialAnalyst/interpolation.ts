import { isolate } from '../../bidi'
import { getPositiveNumber, getFile, gridOutput, outputName, pointGrid, getPointSamples, rasterLayerBounds, SPATIAL_ANALYST_CATEGORY } from './_shared'
import { rasterToFeatureCollection, readGeoTiff } from '../../rasterEngine'
import { outputLayer } from '../shared'
import type { ToolboxTool } from '../types'

export const idwTool: ToolboxTool = {
  id: 'idw', name: 'IDW', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Interpolation',
  description: 'Interpolate point values onto a regular grid using inverse-distance weighting.',
  keywords: ['interpolation', 'inverse distance', 'prediction'],
  parameters: [
    { id: 'points', label: 'Input point features', kind: 'layer', required: true },
    { id: 'valueField', label: 'Numeric value field', kind: 'text', required: true, defaultValue: 'value' },
    { id: 'power', label: 'Distance power', kind: 'number', defaultValue: 2, min: 0.000001 },
    { id: 'cellSize', label: 'Cell size (degrees)', kind: 'number', defaultValue: 0.01, min: 0.000001 },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'IDW' },
  ],
  execute: (context, parameters) => {
    const field = typeof parameters.valueField === 'string' ? parameters.valueField.trim() : ''
    if (!field) throw new Error('Choose a numeric value field for IDW.')
    const { layer, samples } = getPointSamples(context, parameters, field)
    const power = getPositiveNumber(parameters, 'power', 'Distance power', 2)
    const cellSize = getPositiveNumber(parameters, 'cellSize', 'Cell size', 0.01)
    const grid = pointGrid(rasterLayerBounds(layer), cellSize, (x, y) => {
      let weighted = 0
      let totalWeight = 0
      for (const sample of samples) {
        const distance = Math.hypot(x - sample.x, y - sample.y)
        if (distance < 1e-12) return sample.value
        const weight = 1 / distance ** power
        weighted += weight * sample.value
        totalWeight += weight
      }
      return weighted / totalWeight
    })
    const output = gridOutput(outputName(parameters, `${layer.name} IDW`), grid)
    return { message: `${isolate(output.name)}: interpolated ${samples.length} points to a ${grid.width} × ${grid.height} grid.`, layers: [output] }
  },
}

export const kernelDensityTool: ToolboxTool = {
  id: 'kernelDensity', name: 'Kernel Density', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Density',
  description: 'Estimate point density with a quartic kernel inside the specified search radius.',
  keywords: ['density', 'kernel', 'hotspot'],
  parameters: [
    { id: 'points', label: 'Input point features', kind: 'layer', required: true },
    { id: 'valueField', label: 'Weight field (optional; defaults to 1)', kind: 'text', defaultValue: '' },
    { id: 'radius', label: 'Search radius (degrees)', kind: 'number', required: true, defaultValue: 0.05, min: 0.000001 },
    { id: 'cellSize', label: 'Cell size (degrees)', kind: 'number', defaultValue: 0.01, min: 0.000001 },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Kernel Density' },
  ],
  execute: (context, parameters) => {
    const layer = context.layers.find((item) => item.id === parameters.points)
    if (!layer) throw new Error('Choose a valid input point layer.')
    const field = typeof parameters.valueField === 'string' ? parameters.valueField.trim() : ''
    const samples = layer.data.features.flatMap((feature) => {
      if (feature.geometry?.type !== 'Point') return []
      const value = field ? Number(feature.properties?.[field]) : 1
      const [x, y] = feature.geometry.coordinates
      return Number.isFinite(value) && Number.isFinite(x) && Number.isFinite(y) ? [{ x, y, value }] : []
    })
    if (!samples.length) throw new Error('The input layer has no usable point features and numeric weights.')
    const radius = getPositiveNumber(parameters, 'radius', 'Search radius', 0.05)
    const cellSize = getPositiveNumber(parameters, 'cellSize', 'Cell size', 0.01)
    const [minX, minY, maxX, maxY] = rasterLayerBounds(layer)
    const bounds: [number, number, number, number] = [minX - radius, minY - radius, maxX + radius, maxY + radius]
    const grid = pointGrid(bounds, cellSize, (x, y) => {
      let density = 0
      for (const sample of samples) {
        const distance = Math.hypot(x - sample.x, y - sample.y)
        if (distance < radius) density += sample.value * (1 - (distance / radius) ** 2) ** 2
      }
      return density
    })
    const output = gridOutput(outputName(parameters, `${layer.name} Kernel Density`), grid)
    return { message: `${isolate(output.name)}: calculated kernel density for ${samples.length} points.`, layers: [output] }
  },
}

export const importGeoTiffTool: ToolboxTool = {
  id: 'importGeoTiff', name: 'Import GeoTIFF', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Raster',
  description: 'Read the first numeric band of a GeoTIFF entirely in the browser and convert cells to a map-ready raster layer.',
  keywords: ['geotiff', 'raster', 'import', 'tiff'],
  parameters: [
    { id: 'file', label: 'GeoTIFF file', kind: 'file', required: true, accept: '.tif,.tiff,image/tiff' },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Imported raster' },
  ],
  execute: async (_context, parameters) => {
    const file = getFile(parameters, 'file', 'GeoTIFF')
    const grid = await readGeoTiff(file)
    const name = outputName(parameters, file.name.replace(/\.tiff?$/i, '') || 'Imported raster')
    const output = outputLayer(name, rasterToFeatureCollection(grid), grid.crs)
    output.fillColor = '#63b3ed'
    output.strokeColor = '#172554'
    output.strokeWidth = 0.25
    const message = grid.crs === 'EPSG:4326'
      ? `${isolate(name)}: imported ${grid.width} × ${grid.height} cells.`
      : `${isolate(name)}: imported ${grid.width} × ${grid.height} cells; coordinates are transformed to WGS84 for display.`
    return { message, layers: [output] }
  },
}
