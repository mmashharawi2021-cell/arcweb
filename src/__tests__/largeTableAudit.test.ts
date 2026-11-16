import { describe, expect, it } from 'vitest'
import { buildDbf } from '../toolboxes/conversion/_shapefile'
import { summaryStatisticsTool } from '../toolboxes/analysis/summaryStatistics'
import { computeStatistic } from '../toolboxes/dataManagement/dissolve'
import { rowsToRecords } from '../toolboxes/conversion/_utils'
import { testLayer, runTool } from '../toolboxes/testUtils'

describe('large attribute tables', () => {
  it('imports 150,000 spreadsheet rows without exceeding argument limits', () => {
    const result = rowsToRecords([['name', 'value'], ...Array.from({ length: 150_000 }, (_, index) => ['station', index])])
    expect(result.fields).toEqual(['name', 'value'])
    expect(result.records).toHaveLength(150_000)
    expect(result.records[149_999].value).toBe(149_999)
  })

  it('exports DBF numeric and text columns without spreading rows into function arguments', () => {
    const rows = Array.from({ length: 150_000 }, (_, value) => ({ value, label: 'station' }))
    const { buffer, fields } = buildDbf(rows, ['value', 'label'])
    expect(new DataView(buffer).getUint32(4, true)).toBe(rows.length)
    expect(fields.map(({ type, size }) => ({ type, size }))).toEqual([{ type: 'N', size: 6 }, { type: 'C', size: 7 }])
  })

  it('calculates summary extrema and dissolve range for 150,000 records', async () => {
    const numbers = Array.from({ length: 150_000 }, (_, index) => index - 100)
    expect(computeStatistic(numbers, 'RANGE')).toBe(149_999)
    const layer = testLayer('Large table', numbers.map((value) => ({
      type: 'Feature', properties: { value }, geometry: null,
    })))
    const result = await runTool(summaryStatisticsTool, [layer], {
      target: layer.id, statistics: 'value MIN, value MAX, value RANGE',
    })
    expect(result.layers![0].data.features[0].properties).toMatchObject({
      FREQUENCY: 150_000, MIN_value: -100, MAX_value: 149_899, RANGE_value: 149_999,
    })
  })
})
