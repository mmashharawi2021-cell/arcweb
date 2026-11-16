import { describe, expect, it } from 'vitest'
import type { Feature, FeatureCollection } from 'geojson'
import { bufferTool } from '../analysis/buffer'
import { calculateFieldTool } from '../dataManagement/calculateField'
import { describeToolRun, restoreToolValues } from '../history'
import { mergeScopedData, scopeLayersToSelection, selectedFeatureCount } from '../selectionScope'
import { testLayer } from '../testUtils'
import type { ToolboxTool } from '../types'

const point = (id: string, x: number, value: number): Feature => ({
  type: 'Feature', id, properties: { value }, geometry: { type: 'Point', coordinates: [x, 0] },
})

function layers() {
  const towns = testLayer('Towns', [point('a', 0, 1), point('b', 0.01, 2), point('c', 0.02, 3)])
  const roads = testLayer('Roads', [point('r', 1, 9)])
  return { towns, roads }
}

describe('selection scope for geoprocessing', () => {
  it('limits only layers that have a selection', () => {
    const { towns, roads } = layers()
    const ids = towns.data.features.map((feature) => feature.id!)
    const { layers: scoped, scoped: subsets } = scopeLayersToSelection([towns, roads], { [towns.id]: [ids[0], ids[2]] })
    expect(scoped[0].data.features.map((feature) => feature.properties?.value)).toEqual([1, 3])
    expect(scoped[1]).toBe(roads)
    expect([...subsets.keys()]).toEqual([towns.id])
    expect(selectedFeatureCount([towns, roads], { [towns.id]: [ids[0], ids[2]] })).toBe(2)
  })

  it('runs Buffer on the selected features only', async () => {
    const { towns } = layers()
    const firstId = towns.data.features[0].id!
    const { layers: scoped } = scopeLayersToSelection([towns], { [towns.id]: [firstId] })
    const result = await bufferTool.execute({ layers: scoped, selectedLayerId: towns.id }, { target: towns.id, distance: 100, units: 'meters', dissolve: 'NONE' })
    expect(result.layers?.[0].data.features).toHaveLength(1)
    expect(result.layers?.[0].geometry).toBe('Polygon')
  })

  it('merges an in-place tool edit on a selection back into the whole layer', async () => {
    const { towns } = layers()
    const ids = towns.data.features.map((feature) => feature.id!)
    const { layers: scoped, scoped: subsets } = scopeLayersToSelection([towns], { [towns.id]: [ids[1]] })
    const result = await calculateFieldTool.execute({ layers: scoped, selectedLayerId: towns.id }, { target: towns.id, fieldName: 'value', expression: '[value] * 10' })
    const updated = result.updates![0].updates.data!
    const merged = mergeScopedData(towns.data, subsets.get(towns.id)!, updated)
    // Only the selected feature changed; the other two are untouched and keep their order.
    expect(merged.features.map((feature) => feature.properties?.value)).toEqual([1, 20, 3])
    expect(merged.features.map((feature) => feature.id)).toEqual(ids)
  })

  it('drops removed selected features and appends features the tool added', () => {
    const full: FeatureCollection = { type: 'FeatureCollection', features: [point('a', 0, 1), point('b', 1, 2), point('c', 2, 3)] }
    const subset: FeatureCollection = { ...full, features: [full.features[0], full.features[1]] }
    const updated: FeatureCollection = { ...full, features: [point('a', 0, 1), point('n', 5, 7)] }
    expect(mergeScopedData(full, subset, updated).features.map((feature) => feature.id)).toEqual(['a', 'c', 'n'])
  })

  it('matches by position when a tool rebuilds features without IDs', () => {
    const full: FeatureCollection = { type: 'FeatureCollection', features: [point('a', 0, 1), point('b', 1, 2)] }
    const subset: FeatureCollection = { ...full, features: [full.features[1]] }
    const rebuilt: FeatureCollection = { ...full, features: [{ ...point('x', 1, 99), id: undefined }] }
    const merged = mergeScopedData(full, subset, rebuilt)
    expect(merged.features.map((feature) => [feature.id, feature.properties?.value])).toEqual([['a', 1], ['b', 99]])
  })

  it('refuses an ID-less result whose count changed instead of corrupting the layer', () => {
    const full: FeatureCollection = { type: 'FeatureCollection', features: [point('a', 0, 1), point('b', 1, 2)] }
    const rebuilt: FeatureCollection = { ...full, features: [] }
    rebuilt.features.push({ ...point('x', 0, 0), id: undefined }, { ...point('y', 0, 0), id: undefined })
    expect(() => mergeScopedData(full, { ...full, features: [full.features[0]] }, rebuilt)).toThrow(/cannot be merged/)
  })
})

describe('geoprocessing history records', () => {
  const tool: Pick<ToolboxTool, 'parameters'> = {
    parameters: [
      { id: 'target', label: 'Input', kind: 'layer' },
      { id: 'inputs', label: 'Inputs', kind: 'layers' },
      { id: 'distance', label: 'Distance', kind: 'number' },
      { id: 'units', label: 'Units', kind: 'select', options: [{ value: 'km', label: 'Kilometers' }] },
      { id: 'file', label: 'Table', kind: 'file', accept: '.csv' },
    ],
  }
  const known = [{ id: 'L1', name: 'Rivers' }, { id: 'L2', name: 'Lakes' }]

  it('summarises a run with layer names and stores files by name only', () => {
    const { parameters, summary } = describeToolRun(tool, {
      target: 'L1', inputs: 'L1,L2', distance: 5, units: 'km', file: new File(['x'], 'pts.csv'),
    }, known)
    expect(parameters).toEqual({ target: 'L1', inputs: 'L1,L2', distance: 5, units: 'km', file: 'pts.csv' })
    expect(summary).toBe('Input: Rivers · Inputs: Rivers, Lakes · Distance: 5 · Units: Kilometers · Table: pts.csv')
    expect(JSON.parse(JSON.stringify(parameters))).toEqual(parameters)
  })

  it('restores values for re-running, skipping files and layers that were removed', () => {
    const values = restoreToolValues(tool, { target: 'gone', inputs: 'L1,gone', distance: 5, units: 'km', file: 'pts.csv' }, [{ id: 'L1' }])
    expect(values).toEqual({ inputs: 'L1', distance: 5, units: 'km' })
  })
})
