import { isolate } from '../../bidi'
import { isNoData } from '../../rasterEngine'
import { getRaster, gridOutput, outputName, rasterInput, IMAGE_ANALYST_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

export const majorityFilterTool: ToolboxTool = {
  id: 'majorityFilter',
  name: 'Majority Filter',
  category: IMAGE_ANALYST_CATEGORY,
  subcategory: 'Filtering',
  description: 'Replace each valid cell with the most frequent valid value in its 3 × 3 neighborhood. Ties keep the center value; NoData cells stay NoData.',
  keywords: ['majority', 'filter', 'smoothing', '3x3', 'neighborhood'],
  parameters: [
    rasterInput(),
    { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Majority filtered raster' },
  ],
  execute: (context, parameters) => {
    const { layer, grid } = getRaster(context, parameters)
    const values = new Float32Array(grid.values.length).fill(Number.NaN)
    for (let row = 0; row < grid.height; row += 1) {
      for (let column = 0; column < grid.width; column += 1) {
        const index = row * grid.width + column
        const center = grid.values[index]
        if (isNoData(center, grid.noData)) continue
        const counts = new Map<number, number>()
        for (let neighborRow = Math.max(0, row - 1); neighborRow <= Math.min(grid.height - 1, row + 1); neighborRow += 1) {
          for (let neighborColumn = Math.max(0, column - 1); neighborColumn <= Math.min(grid.width - 1, column + 1); neighborColumn += 1) {
            const value = grid.values[neighborRow * grid.width + neighborColumn]
            if (!isNoData(value, grid.noData)) counts.set(value, (counts.get(value) ?? 0) + 1)
          }
        }
        let winner = center
        let highestCount = counts.get(center) ?? 0
        for (const [value, count] of counts) {
          if (count > highestCount || (count === highestCount && value === center)) {
            winner = value
            highestCount = count
          }
        }
        values[index] = winner
      }
    }
    const output = gridOutput(outputName(parameters, `${layer.name} Majority Filter`), { ...grid, values, noData: Number.NaN })
    return { message: `${isolate(output.name)}: majority-filtered ${grid.values.length.toLocaleString()} cells with a 3 × 3 neighborhood.`, layers: [output] }
  },
}
