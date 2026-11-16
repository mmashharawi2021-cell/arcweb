import { isolate } from '../../bidi'
import { Delaunay } from 'd3-delaunay'
import { createRasterGrid } from '../../rasterEngine'
import { getPositiveNumber, getPointSamples, gridOutput, outputName, SPATIAL_ANALYST_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

function uniqueSamples(samples: { x: number; y: number; value: number }[]) {
  const grouped = new Map<string, { x: number; y: number; sum: number; count: number }>()
  for (const sample of samples) {
    const key = `${sample.x},${sample.y}`
    const group = grouped.get(key)
    if (group) { group.sum += sample.value; group.count += 1 }
    else grouped.set(key, { x: sample.x, y: sample.y, sum: sample.value, count: 1 })
  }
  return [...grouped.values()].map(({ x, y, sum, count }) => ({ x, y, value: sum / count }))
}

function tinGrid(samples: { x: number; y: number; value: number }[], cellSize: number) {
  const bounds = samples.reduce<[number, number, number, number]>(
    ([minX, minY, maxX, maxY], sample) => [
      Math.min(minX, sample.x), Math.min(minY, sample.y), Math.max(maxX, sample.x), Math.max(maxY, sample.y),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
  const [minX, minY, maxX, maxY] = bounds
  const width = Math.max(1, Math.ceil((maxX - minX) / cellSize))
  const height = Math.max(1, Math.ceil((maxY - minY) / cellSize))
  if (width * height > 250_000) {
    throw new Error('Output exceeds the 250,000-cell processing limit. Increase the cell size or reduce the input extent.')
  }
  const grid = createRasterGrid(width, height, new Float32Array(width * height).fill(Number.NaN), {
    origin: [minX, maxY], resolution: [cellSize, -cellSize], noData: Number.NaN,
  })
  const triangulation = Delaunay.from(samples, (sample) => sample.x, (sample) => sample.y)
  if (!triangulation.triangles.length) {
    throw new Error('TIN interpolation requires at least three distinct, non-collinear point locations.')
  }
  let candidates = 0
  for (let triangle = 0; triangle < triangulation.triangles.length; triangle += 3) {
    const a = samples[triangulation.triangles[triangle]]
    const b = samples[triangulation.triangles[triangle + 1]]
    const c = samples[triangulation.triangles[triangle + 2]]
    const minTriangleX = Math.min(a.x, b.x, c.x)
    const maxTriangleX = Math.max(a.x, b.x, c.x)
    const minTriangleY = Math.min(a.y, b.y, c.y)
    const maxTriangleY = Math.max(a.y, b.y, c.y)
    const firstColumn = Math.max(0, Math.ceil((minTriangleX - minX) / cellSize - 0.5))
    const lastColumn = Math.min(width - 1, Math.floor((maxTriangleX - minX) / cellSize - 0.5))
    const firstRow = Math.max(0, Math.ceil((maxY - maxTriangleY) / cellSize - 0.5))
    const lastRow = Math.min(height - 1, Math.floor((maxY - minTriangleY) / cellSize - 0.5))
    if (firstColumn > lastColumn || firstRow > lastRow) continue
    candidates += (lastColumn - firstColumn + 1) * (lastRow - firstRow + 1)
    if (candidates > 5_000_000) {
      throw new Error('TIN interpolation exceeded 5,000,000 triangle/cell checks. Increase the cell size or reduce the input extent.')
    }
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
    if (Math.abs(denominator) < Number.EPSILON) continue
    for (let row = firstRow; row <= lastRow; row += 1) {
      const y = maxY - (row + 0.5) * cellSize
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const x = minX + (column + 0.5) * cellSize
        const weightA = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator
        const weightB = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator
        const weightC = 1 - weightA - weightB
        const tolerance = 1e-10
        if (weightA < -tolerance || weightB < -tolerance || weightC < -tolerance ||
          weightA > 1 + tolerance || weightB > 1 + tolerance || weightC > 1 + tolerance) continue
        grid.values[row * width + column] = weightA * a.value + weightB * b.value + weightC * c.value
      }
    }
  }
  return grid
}

export const tinInterpolationTool: ToolboxTool = {
  id: 'tin-interpolation',
  name: 'TIN Interpolation',
  category: SPATIAL_ANALYST_CATEGORY,
  subcategory: 'Interpolation',
  description: 'Interpolate point values over a Delaunay triangulated irregular network using linear barycentric interpolation. Cells outside the convex hull are NoData.',
  keywords: ['TIN', 'Delaunay', 'interpolation', 'triangulation', 'surface'],
  parameters: [
    { id: 'points', label: 'Input point features', kind: 'layer', required: true },
    { id: 'valueField', label: 'Numeric value field', kind: 'text', required: true, defaultValue: 'value' },
    { id: 'cellSize', label: 'Cell size (degrees)', kind: 'number', defaultValue: 0.01, min: 0.000001 },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'TIN interpolation' },
  ],
  execute: (context, parameters) => {
    const field = typeof parameters.valueField === 'string' ? parameters.valueField.trim() : ''
    if (!field) throw new Error('Choose a numeric value field for TIN interpolation.')
    const { layer, samples: inputSamples } = getPointSamples(context, parameters, field)
    const samples = uniqueSamples(inputSamples)
    if (samples.length < 3) throw new Error('TIN interpolation requires at least three distinct point locations.')
    const cellSize = getPositiveNumber(parameters, 'cellSize', 'Cell size', 0.01)
    const grid = tinGrid(samples, cellSize)
    const output = gridOutput(outputName(parameters, `${layer.name} TIN`), grid)
    return {
      message: `${isolate(output.name)}: interpolated ${samples.length} points with a Delaunay TIN to a ${grid.width} × ${grid.height} grid; cells outside the hull are NoData.`,
      layers: [output],
    }
  },
}
