import type { Feature, Geometry, LineString, Point } from 'geojson'
import { describe, expect, it } from 'vitest'
import { runTool, testLayer } from '../../testUtils'
import { addJoinTool } from '../addJoin'
import { alterFieldTool } from '../alterField'
import { copyFeaturesTool } from '../copyFeatures'
import { createFeatureClassTool } from '../createFeatureClass'
import { featureVerticesToPointsTool } from '../featureVerticesToPoints'
import { deleteFieldTool } from '../deleteField'

const point = (x: number, properties: Record<string, unknown> = {}): Feature<Point> =>
  ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [x, 0] } })
const line = (coordinates: [number, number][], properties: Record<string, unknown> = {}): Feature<LineString> =>
  ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } })

describe('Data Management core tools', () => {
  it('copies feature data independently and creates points for all or selected vertices', async () => {
    const source = testLayer('route', [line([[0, 0], [2, 0], [2, 2]], { name: 'R' })] as Feature<Geometry>[])
    const copied = (await runTool(copyFeaturesTool, [source], { target: source.id })).layers![0]
    expect(copied.data.features).toHaveLength(1)
    expect(copied.data.features[0].properties).toEqual({ name: 'R' })
    expect(copied.id).not.toBe(source.id)
    expect(copied.data.features[0]).not.toBe(source.data.features[0])

    const all = (await runTool(featureVerticesToPointsTool, [source], { target: source.id })).layers![0]
    expect(all.data.features.map((feature) => (feature.geometry as Point).coordinates)).toEqual([[0, 0], [2, 0], [2, 2]])
    expect(all.data.features[0].properties).toMatchObject({ name: 'R', ORIG_FID: 1, VERTEX_ID: 1 })
    const middle = (await runTool(featureVerticesToPointsTool, [source], { target: source.id, pointLocation: 'MID' })).layers![0]
    expect((middle.data.features[0].geometry as Point).coordinates).toEqual([2, 0])
    await expect(runTool(featureVerticesToPointsTool, [source], { target: source.id, pointLocation: 'bad' })).rejects.toThrow(/Unknown/)
  })

  it('renames fields in the data schema and rejects collisions', async () => {
    const source = testLayer('points', [point(0, { name: 'A', label: 'x' })] as Feature<Geometry>[])
    source.customFields = ['name', 'label']
    source.labelField = 'name'
    source.fieldAliases = { name: 'Full name', label: 'Old label' }
    const result = await runTool(alterFieldTool, [source], { target: source.id, field: 'NAME', newName: 'title' })
    const update = result.updates![0].updates
    expect(update.data?.features[0].properties).toEqual({ label: 'x', title: 'A' })
    expect(update.customFields).toEqual(['title', 'label'])
    expect(update.labelField).toBe('title')
    expect(update.fieldAliases).toEqual({ title: 'Full name', label: 'Old label' })
    const renamedAlias = await runTool(alterFieldTool, [source], {
      target: source.id, field: 'name', newName: 'title', aliasAction: 'set', alias: 'Official title',
    })
    expect(renamedAlias.updates![0].updates.fieldAliases).toEqual({ title: 'Official title', label: 'Old label' })
    const setAlias = await runTool(alterFieldTool, [source], {
      target: source.id, field: 'name', newName: 'name', aliasAction: 'set', alias: 'Official name',
    })
    expect(setAlias.updates![0].updates.fieldAliases).toEqual({ name: 'Official name', label: 'Old label' })
    const clearAlias = await runTool(alterFieldTool, [source], {
      target: source.id, field: 'name', newName: 'name', aliasAction: 'clear',
    })
    expect(clearAlias.updates![0].updates.fieldAliases).toEqual({ label: 'Old label' })
    await expect(runTool(alterFieldTool, [source], {
      target: source.id, field: 'name', newName: 'name', aliasAction: 'set',
    })).rejects.toThrow(/Enter an alias/)
    await expect(runTool(alterFieldTool, [source], { target: source.id, field: 'name', newName: 'label' })).rejects.toThrow(/already exists/)
  })

  it('removes display aliases when fields are deleted', async () => {
    const source = testLayer('points', [point(0, { name: 'A', label: 'x' })] as Feature<Geometry>[])
    source.customFields = ['name', 'label']
    source.fieldAliases = { name: 'Full name', label: 'Label' }
    const result = await runTool(deleteFieldTool, [source], { target: source.id, field: 'name' })
    expect(result.updates![0].updates.fieldAliases).toEqual({ label: 'Label' })
  })

  it('creates an empty field schema and validates field definitions', async () => {
    const result = await runTool(createFeatureClassTool, [], { name: 'New roads', geometryType: 'Line', fields: 'NAME, LENGTH' })
    expect(result.layers![0].geometry).toBe('Line')
    expect(result.layers![0].data.features).toEqual([])
    expect(result.layers![0].customFields).toEqual(['NAME', 'LENGTH'])
    await expect(runTool(createFeatureClassTool, [], { name: 'Bad', fields: 'NAME, name' })).rejects.toThrow(/more than once/)
    await expect(runTool(createFeatureClassTool, [], { name: 'Bad', fields: 'not valid text' })).rejects.toThrow(/Invalid field/)
  })

  it('adds a one-to-many table join and leaves unmatched input records', async () => {
    const input = testLayer('roads', [point(0, { road: 'A' }), point(1, { road: 'B' })] as Feature<Geometry>[])
    const table = testLayer('inspection', [
      { type: 'Feature', properties: { id: 'A', rating: 4 }, geometry: null as unknown as Geometry },
      { type: 'Feature', properties: { id: 'A', rating: 5 }, geometry: null as unknown as Geometry },
    ])
    const joined = (await runTool(addJoinTool, [input, table], {
      target: input.id, inputField: 'road', joinTable: table.id, joinField: 'id',
    })).layers![0]
    expect(joined.data.features).toHaveLength(3)
    expect(joined.data.features.map((feature) => feature.properties)).toEqual([
      { road: 'A', inspection_rating: 4 },
      { road: 'A', inspection_rating: 5 },
      { road: 'B', inspection_rating: null },
    ])
    expect(joined.geometry).toBe('Point')
  })
})
