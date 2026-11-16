import { isNoData, rasterIndex, rasterValue, type RasterGrid } from '../../rasterEngine'
import { gridOutput, getRaster, outputName, rasterInput, SPATIAL_ANALYST_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

const neighbors = [
  { row: 0, column: 1, code: 1 }, { row: 1, column: 1, code: 2 },
  { row: 1, column: 0, code: 4 }, { row: 1, column: -1, code: 8 },
  { row: 0, column: -1, code: 16 }, { row: -1, column: -1, code: 32 },
  { row: -1, column: 0, code: 64 }, { row: -1, column: 1, code: 128 },
]

class MinHeap {
  private readonly items: { value: number; index: number }[] = []
  get size() { return this.items.length }
  push(item: { value: number; index: number }) {
    this.items.push(item)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.items[parent].value <= item.value) break
      this.items[index] = this.items[parent]
      index = parent
    }
    this.items[index] = item
  }
  pop(): { value: number; index: number } | undefined {
    const root = this.items[0]
    const last = this.items.pop()
    if (!last || !this.items.length) return root
    let index = 0
    while (index * 2 + 1 < this.items.length) {
      let child = index * 2 + 1
      if (child + 1 < this.items.length && this.items[child + 1].value < this.items[child].value) child += 1
      if (this.items[child].value >= last.value) break
      this.items[index] = this.items[child]
      index = child
    }
    this.items[index] = last
    return root
  }
}

export function fillSinks(grid: RasterGrid): RasterGrid {
  const values = new Float32Array(grid.values)
  const visited = new Uint8Array(values.length)
  const queue = new MinHeap()
  const addSeed = (row: number, column: number) => {
    const index = rasterIndex(grid, row, column)
    if (visited[index] || isNoData(values[index], grid.noData)) return
    visited[index] = 1
    queue.push({ value: values[index], index })
  }
  for (let row = 0; row < grid.height; row += 1) {
    addSeed(row, 0)
    if (grid.width > 1) addSeed(row, grid.width - 1)
  }
  for (let column = 0; column < grid.width; column += 1) {
    addSeed(0, column)
    if (grid.height > 1) addSeed(grid.height - 1, column)
  }
  for (let row = 1; row < grid.height - 1; row += 1) {
    for (let column = 1; column < grid.width - 1; column += 1) {
      if (isNoData(values[rasterIndex(grid, row, column)], grid.noData)) continue
      if (neighbors.some((neighbor) => isNoData(
        rasterValue(grid, row + neighbor.row, column + neighbor.column), grid.noData,
      ))) addSeed(row, column)
    }
  }
  while (queue.size) {
    const current = queue.pop()!
    const row = Math.floor(current.index / grid.width)
    const column = current.index % grid.width
    for (const neighbor of neighbors) {
      const nextRow = row + neighbor.row; const nextColumn = column + neighbor.column
      if (nextRow < 0 || nextColumn < 0 || nextRow >= grid.height || nextColumn >= grid.width) continue
      const index = rasterIndex(grid, nextRow, nextColumn)
      if (visited[index] || isNoData(values[index], grid.noData)) continue
      visited[index] = 1
      if (values[index] < current.value) values[index] = current.value
      queue.push({ value: values[index], index })
    }
  }
  return { ...grid, values }
}

const fillSinksTool: ToolboxTool = {
  id: 'fill', name: 'Fill', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Hydrology',
  description: 'Fill enclosed elevation sinks using priority-flood routing from valid raster edges.',
  keywords: ['sink', 'depression', 'hydrology', 'elevation'],
  parameters: [
    rasterInput(), { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Filled elevation' },
  ],
  execute: (context, parameters) => {
    const { layer, grid } = getRaster(context, parameters)
    const output = gridOutput(outputName(parameters, `${layer.name} Filled`), fillSinks(grid))
    return { message: `${output.name}: filled enclosed elevation sinks.`, layers: [output] }
  },
}

function flowDirections(grid: RasterGrid): Float32Array {
  const directions = new Float32Array(grid.values.length).fill(0)
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const elevation = rasterValue(grid, row, column)
      const index = rasterIndex(grid, row, column)
      if (isNoData(elevation, grid.noData)) { directions[index] = Number.NaN; continue }
      let steepest = 0
      let direction = 0
      for (const neighbor of neighbors) {
        const nextRow = row + neighbor.row; const nextColumn = column + neighbor.column
        const adjacent = rasterValue(grid, nextRow, nextColumn)
        if (isNoData(adjacent, grid.noData) || adjacent >= elevation) continue
        const distance = Math.hypot(neighbor.column * Math.abs(grid.resolution[0]), neighbor.row * Math.abs(grid.resolution[1]))
        const slope = (elevation - adjacent) / distance
        if (slope > steepest) { steepest = slope; direction = neighbor.code }
      }
      directions[index] = direction
    }
  }
  return directions
}

export const flowDirectionTool: ToolboxTool = {
  id: 'flowDirection', name: 'Flow Direction', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Hydrology',
  description: 'Assign D8 downslope direction codes (1 east through 128 northeast); 0 marks a sink or flat cell.',
  keywords: ['D8', 'hydrology', 'drainage', 'direction'],
  parameters: [
    rasterInput(), { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Flow direction' },
  ],
  execute: (context, parameters) => {
    const { layer, grid } = getRaster(context, parameters)
    const values = flowDirections(grid)
    const output = gridOutput(outputName(parameters, `${layer.name} Flow Direction`), { ...grid, values, noData: Number.NaN })
    return { message: `${output.name}: calculated D8 directions for ${grid.values.length} cells.`, layers: [output] }
  },
}

export function accumulateFlow(grid: RasterGrid): RasterGrid {
  const directions = flowDirections(grid)
  const count = grid.values.length
  const accumulation = new Float32Array(count).fill(1)
  const indegree = new Uint32Array(count)
  const downstream = new Int32Array(count).fill(-1)
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const index = rasterIndex(grid, row, column)
      const direction = directions[index]
      if (isNoData(direction, Number.NaN) || direction === 0) { accumulation[index] = isNoData(direction, Number.NaN) ? Number.NaN : 1; continue }
      const neighbor = neighbors.find((item) => item.code === direction)!
      const nextRow = row + neighbor.row; const nextColumn = column + neighbor.column
      if (nextRow < 0 || nextColumn < 0 || nextRow >= grid.height || nextColumn >= grid.width) continue
      const nextIndex = rasterIndex(grid, nextRow, nextColumn)
      if (isNoData(grid.values[nextIndex], grid.noData)) continue
      downstream[index] = nextIndex
      indegree[nextIndex] += 1
    }
  }
  const queue: number[] = []
  for (let index = 0; index < count; index += 1) {
    if (!isNoData(accumulation[index], Number.NaN) && indegree[index] === 0) queue.push(index)
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]
    const next = downstream[index]
    if (next < 0) continue
    accumulation[next] += accumulation[index]
    indegree[next] -= 1
    if (indegree[next] === 0) queue.push(next)
  }
  return { ...grid, values: accumulation, noData: Number.NaN }
}

export const flowAccumulationTool: ToolboxTool = {
  id: 'flowAccumulation', name: 'Flow Accumulation', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Hydrology',
  description: 'Count upstream contributing cells using D8 directions derived from the input elevation raster.',
  keywords: ['hydrology', 'drainage', 'accumulation', 'watershed'],
  parameters: [
    rasterInput(), { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Flow accumulation' },
  ],
  execute: (context, parameters) => {
    const { layer, grid } = getRaster(context, parameters)
    const output = gridOutput(outputName(parameters, `${layer.name} Flow Accumulation`), accumulateFlow(grid))
    return { message: `${output.name}: accumulated upstream cell counts.`, layers: [output] }
  },
}

export const fillTool = fillSinksTool
