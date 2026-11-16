import area from '@turf/area'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { kinks } from '@turf/turf'
import type { Feature, FeatureCollection, Geometry, LineString, Polygon, Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import { projectPosition } from '../../../crs'
import type { MapLayer } from '../../../store'
import { haversine } from '../../spatial'
import { runTool, testLayer } from '../../testUtils'
import type { ToolboxTool, ToolExecutionResult } from '../../types'
import { addFieldTool } from '../addField'
import { alterFieldTool } from '../alterField'
import { addXYCoordinatesTool } from '../addXYCoordinates'
import { appendTool } from '../append'
import { calculateFieldTool } from '../calculateField'
import { calculateGeometryTool } from '../calculateGeometry'
import { checkGeometryTool, geometryProblems } from '../checkGeometry'
import { createFishnetTool } from '../createFishnet'
import { createRandomPointsTool } from '../createRandomPoints'
import { defineProjectionTool } from '../defineProjection'
import { deleteFieldTool } from '../deleteField'
import { deleteIdenticalTool } from '../deleteIdentical'
import { dissolveTool } from '../dissolve'
import { eliminatePolygonPartTool } from '../eliminatePolygonPart'
import { featureClassToFeatureClassTool } from '../featureClassToFeatureClass'
import { featureToLineTool } from '../featureToLine'
import { featureToPointTool } from '../featureToPoint'
import { featureToPolygonTool } from '../featureToPolygon'
import { findIdenticalTool } from '../findIdentical'
import { generatePointsAlongLinesTool } from '../generatePointsAlongLines'
import { dataManagementTools } from '../index'
import { mergeTool } from '../merge'
import { minimumBoundingGeometryTool } from '../minimumBoundingGeometry'
import { multipartToSinglepartTool } from '../multipartToSinglepart'
import { projectTool } from '../project'
import { repairGeometryTool } from '../repairGeometry'
import { simplifyLineTool } from '../simplifyLine'
import { simplifyPolygonTool } from '../simplifyPolygon'
import { smoothLineTool } from '../smoothLine'
import { smoothPolygonTool } from '../smoothPolygon'
import { sortTool } from '../sort'

// ---------- fixtures (near lon 35, lat 31) ----------

const ring = (x: number, y: number, size: number): Position[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
const square = (x: number, y: number, size: number, properties: Record<string, unknown> = {}): Feature<Polygon> =>
  ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring(x, y, size)] } })
const line = (coordinates: Position[], properties: Record<string, unknown> = {}): Feature<LineString> =>
  ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } })
const point = (x: number, y: number, properties: Record<string, unknown> = {}): Feature<Geometry> =>
  ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [x, y] } })
const raw = (geometry: unknown, properties: Record<string, unknown> = {}) => ({ type: 'Feature', properties, geometry }) as Feature<Geometry>

const SIZE = 0.01
const squareArea = area(square(35, 31, SIZE))

const firstLayer = (result: ToolExecutionResult): MapLayer => {
  expect(result.layers?.length).toBeGreaterThan(0)
  return result.layers![0]
}
const updatedData = (result: ToolExecutionResult): FeatureCollection => result.updates![0].updates.data!
const props = (layer: MapLayer | FeatureCollection) => ('data' in layer ? layer.data : layer).features.map((feature) => feature.properties ?? {})
const run = (tool: ToolboxTool, layers: MapLayer[], parameters: Record<string, string | number | undefined>) => runTool(tool, layers, parameters)
const expectValid = (feature: Feature) => {
  expect(feature.geometry).toBeTruthy()
  expect(geometryProblems(feature.geometry)).toEqual([])
}

// ---------- registry ----------

describe('Data Management index', () => {
  it('exports every tool once, in toolset then alphabetical order', () => {
    const ids = dataManagementTools.map((tool) => tool.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining([
      'add-xy-coordinates', 'check-geometry', 'repair-geometry', 'feature-to-point', 'feature-to-line', 'feature-to-polygon',
      'copy-features', 'feature-vertices-to-points',
      'multipart-to-singlepart', 'dissolve', 'eliminate-polygon-part', 'minimum-bounding-geometry',
      'add-field', 'delete-field', 'calculate-field', 'calculate-geometry',
      'alter-field',
      'append', 'merge', 'find-identical', 'delete-identical', 'sort', 'feature-class-to-feature-class',
      'add-join', 'create-feature-class',
      'simplify-line', 'simplify-polygon', 'smooth-line', 'smooth-polygon', 'define-projection', 'project',
      'create-fishnet', 'create-random-points', 'generate-points-along-lines',
    ]))
    expect(ids).toHaveLength(34)
    const toolsets = ['Features', 'Fields', 'General', 'Generalization', 'Projections', 'Sampling']
    for (const tool of dataManagementTools) {
      expect(tool.category).toBe('Data Management')
      expect(toolsets).toContain(tool.subcategory)
    }
    const order = dataManagementTools.map((tool) => [toolsets.indexOf(tool.subcategory!), tool.name] as const)
    const sorted = [...order].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
    expect(order).toEqual(sorted)
    expect(dataManagementTools[0].id).toBe('add-xy-coordinates')
    expect(dataManagementTools.at(-1)!.id).toBe('generate-points-along-lines')
  })
})

// ---------- Features ----------

describe('Add XY Coordinates', () => {
  it('writes WGS 84 coordinates for points', async () => {
    const layer = testLayer('pts', [point(35.1, 31.2), point(35.3, 31.4)])
    const result = await run(addXYCoordinatesTool, [layer], { target: layer.id, crs: 'EPSG:4326' })
    expect(props(updatedData(result))).toEqual([{ POINT_X: 35.1, POINT_Y: 31.2 }, { POINT_X: 35.3, POINT_Y: 31.4 }])
    expect(result.updates![0].updates.customFields).toEqual(['POINT_X', 'POINT_Y'])
  })

  it('uses the layer source CRS (UTM 36N) by default', async () => {
    const layer = testLayer('pts', [point(35.1, 31.2)], 'EPSG:32636')
    const result = await run(addXYCoordinatesTool, [layer], { target: layer.id })
    const expected = projectPosition('EPSG:4326', 'EPSG:32636', [35.1, 31.2])!
    const [row] = props(updatedData(result))
    expect(row.POINT_X).toBeCloseTo(expected[0], 2)
    expect(row.POINT_Y).toBeCloseTo(expected[1], 2)
    expect(row.POINT_X as number).toBeGreaterThan(600000)
  })

  it('rejects non-point layers', async () => {
    const layer = testLayer('poly', [square(35, 31, SIZE)])
    await expect(run(addXYCoordinatesTool, [layer], { target: layer.id })).rejects.toThrow(/point layer/)
  })
})

describe('Check Geometry', () => {
  it('reports each class of problem', async () => {
    const layer = testLayer('bad', [
      square(35, 31, SIZE),
      raw(null),
      raw({ type: 'Polygon', coordinates: [[[35, 31], [35.01, 31], [35.01, 31.01], [35, 31.01]]] }),
      raw({ type: 'Polygon', coordinates: [[[35, 31], [35, 31.01], [35.01, 31.01], [35.01, 31], [35, 31]]] }),
      raw({ type: 'Polygon', coordinates: [[[35, 31], [35.01, 31.01], [35.01, 31], [35, 31.01], [35, 31]]] }),
      raw({ type: 'LineString', coordinates: [[35, 31], [35, 31], [35.01, 31]] }),
      raw({ type: 'LineString', coordinates: [[35, 31]] }),
    ])
    const table = firstLayer(await run(checkGeometryTool, [layer], { target: layer.id }))
    const problems = props(table).map((row) => [row.ORIG_FID, row.PROBLEM])
    expect(problems).toEqual(expect.arrayContaining([
      [2, 'null geometry'], [3, 'unclosed rings'], [4, 'incorrect ring orientation'], [5, 'self intersections'],
      [6, 'duplicate vertices'], [7, 'too few points'],
    ]))
    expect(problems.some(([fid]) => fid === 1)).toBe(false)
    expect(table.data.features.every((feature) => feature.geometry === null)).toBe(true)
  })

  it('returns no table for a valid layer', async () => {
    const layer = testLayer('ok', [square(35, 31, SIZE), line([[35, 31], [35.01, 31.01]])])
    const result = await run(checkGeometryTool, [layer], { target: layer.id })
    expect(result.layers).toBeUndefined()
    expect(result.message).toMatch(/no geometry problems/)
  })
})

describe('Repair Geometry', () => {
  it('fixes bow-ties, orientation, unclosed rings and drops null geometry', async () => {
    const layer = testLayer('bad', [
      raw({ type: 'Polygon', coordinates: [[[35, 31], [35.01, 31.01], [35.01, 31], [35, 31.01], [35, 31]]] }, { id: 1 }),
      raw({ type: 'Polygon', coordinates: [[[35, 31], [35, 31.01], [35.01, 31.01], [35.01, 31], [35, 31]]] }, { id: 2 }),
      raw({ type: 'Polygon', coordinates: [[[35, 31], [35.01, 31], [35.01, 31], [35.01, 31.01], [35, 31.01]]] }, { id: 3 }),
      raw(null, { id: 4 }),
      raw({ type: 'LineString', coordinates: [[35, 31], [35, 31]] }, { id: 5 }),
    ])
    const result = await run(repairGeometryTool, [layer], { target: layer.id })
    const output = firstLayer(result)
    expect(props(output).map((row) => row.id)).toEqual([1, 2, 3])
    output.data.features.forEach(expectValid)
    expect(output.data.features[0].geometry.type).toBe('MultiPolygon')
    expect(area(output.data.features[0])).toBeCloseTo(squareArea / 2, -2)
    expect(area(output.data.features[1])).toBeCloseTo(squareArea, -2)
    expect(result.message).toMatch(/deleted/)
  })

  it('can repair in place and keep null records', async () => {
    const layer = testLayer('bad', [raw({ type: 'Polygon', coordinates: [[[35, 31], [35, 31.01], [35.01, 31.01], [35.01, 31], [35, 31]]] }), raw(null)])
    const result = await run(repairGeometryTool, [layer], { target: layer.id, output: 'inplace', deleteNull: 'no' })
    const data = updatedData(result)
    expect(data.features).toHaveLength(2)
    expect(data.features[0].id).toBe(layer.data.features[0].id)
    expectValid(data.features[0])
  })
})

describe('Feature To Point / Line', () => {
  it('creates centroids and boundaries', async () => {
    const layer = testLayer('sq', [square(35, 31, SIZE, { NAME: 'a' })])
    const points = firstLayer(await run(featureToPointTool, [layer], { target: layer.id }))
    const [cx, cy] = (points.data.features[0].geometry as { coordinates: Position }).coordinates
    expect(cx).toBeCloseTo(35.005, 9)
    expect(cy).toBeCloseTo(31.005, 9)
    const lines = firstLayer(await run(featureToLineTool, [layer], { target: layer.id }))
    expect(lines.data.features[0].geometry.type).toBe('LineString')
    expect(props(lines)[0].NAME).toBe('a')
  })
})

describe('Feature To Polygon', () => {
  it('polygonizes crossing lines after noding them', async () => {
    const layer = testLayer('lines', [
      line([[34.995, 31], [35.015, 31]]), line([[34.995, 31.01], [35.015, 31.01]]),
      line([[35, 30.995], [35, 31.015]]), line([[35.01, 30.995], [35.01, 31.015]]),
    ])
    const output = firstLayer(await run(featureToPolygonTool, [layer], { inputs: layer.id }))
    expect(output.data.features).toHaveLength(1)
    expect(area(output.data.features[0])).toBeCloseTo(squareArea, -1)
    expectValid(output.data.features[0])
  })

  it('splits overlapping polygons into faces and carries attributes', async () => {
    const layer = testLayer('polys', [square(35, 31, SIZE, { NAME: 'A' }), square(35.02, 31, SIZE, { NAME: 'B' })])
    const labels = testLayer('labels', [point(35.025, 31.005, { LABEL: 'from point' })])
    const output = firstLayer(await run(featureToPolygonTool, [layer, labels], { inputs: layer.id, labels: labels.id }))
    expect(output.data.features).toHaveLength(2)
    const names = props(output).map((row) => row.LABEL ?? row.NAME).sort()
    expect(names).toEqual(['A', 'from point'])
  })

  it('creates a face for each region of overlapping polygons', async () => {
    const layer = testLayer('polys', [square(35, 31, SIZE), square(35.005, 31, SIZE)])
    const output = firstLayer(await run(featureToPolygonTool, [layer], { inputs: layer.id }))
    expect(output.data.features).toHaveLength(3)
    const total = output.data.features.reduce((sum, feature) => sum + area(feature), 0)
    expect(total).toBeCloseTo(squareArea * 1.5, -2)
  })

  it('fails when nothing encloses an area', async () => {
    const layer = testLayer('l', [line([[35, 31], [35.01, 31]])])
    await expect(run(featureToPolygonTool, [layer], { inputs: layer.id })).rejects.toThrow(/do not enclose/)
  })
})

describe('Multipart To Singlepart', () => {
  it('explodes parts and records ORIG_FID', async () => {
    const layer = testLayer('mp', [
      raw({ type: 'MultiPolygon', coordinates: [[ring(35, 31, SIZE)], [ring(35.02, 31, SIZE)]] }, { NAME: 'multi' }),
      square(35.05, 31, SIZE, { NAME: 'single' }),
    ])
    const output = firstLayer(await run(multipartToSinglepartTool, [layer], { target: layer.id }))
    expect(output.data.features.map((feature) => feature.geometry.type)).toEqual(['Polygon', 'Polygon', 'Polygon'])
    expect(props(output).map((row) => [row.NAME, row.ORIG_FID])).toEqual([['multi', 1], ['multi', 1], ['single', 2]])
  })
})

describe('Dissolve', () => {
  const zones = () => testLayer('zones', [
    square(35, 31, SIZE, { ZONE: 'A', POP: 10 }),
    square(35.01, 31, SIZE, { ZONE: 'A', POP: 30 }),
    square(35.1, 31, SIZE, { ZONE: 'B', POP: 5 }),
    square(35.2, 31, SIZE, { ZONE: 'B', POP: null }),
  ])

  it('merges by field with statistics', async () => {
    const layer = zones()
    const output = firstLayer(await run(dissolveTool, [layer], { target: layer.id, fields: 'ZONE', statistics: 'POP SUM, POP MEAN, POP COUNT' }))
    expect(output.data.features).toHaveLength(2)
    const a = output.data.features.find((feature) => feature.properties?.ZONE === 'A')!
    expect(a.geometry.type).toBe('Polygon')
    expect(area(a)).toBeCloseTo(squareArea * 2, -2)
    expect(a.properties).toMatchObject({ SUM_POP: 40, MEAN_POP: 20, COUNT_POP: 2 })
    const b = output.data.features.find((feature) => feature.properties?.ZONE === 'B')!
    expect(b.geometry.type).toBe('MultiPolygon')
    expect(b.properties).toMatchObject({ SUM_POP: 5, COUNT_POP: 1 })
    output.data.features.forEach(expectValid)
  })

  it('dissolves everything and splits parts when multipart is off', async () => {
    const layer = zones()
    const output = firstLayer(await run(dissolveTool, [layer], { target: layer.id, multipart: 'no' }))
    expect(output.data.features).toHaveLength(3)
    expect(output.data.features.every((feature) => feature.geometry.type === 'Polygon')).toBe(true)
  })

  it('rejects unknown fields and statistics', async () => {
    const layer = zones()
    await expect(run(dissolveTool, [layer], { target: layer.id, fields: 'NOPE' })).rejects.toThrow(/does not exist/)
    await expect(run(dissolveTool, [layer], { target: layer.id, statistics: 'POP MEDIAN' })).rejects.toThrow(/Unknown statistic/)
  })
})

describe('Eliminate Polygon Part', () => {
  const holed = () => testLayer('holed', [raw({
    type: 'Polygon',
    coordinates: [
      ring(35, 31, 0.1),
      [...ring(35.01, 31.01, 0.001)].reverse(), // ≈ 10,000 m²
      [...ring(35.05, 31.05, 0.03)].reverse(), // ≈ 9 km²
    ],
  }, { NAME: 'park' })])

  it('fills holes smaller than an area', async () => {
    const layer = holed()
    const output = firstLayer(await run(eliminatePolygonPartTool, [layer], { target: layer.id, condition: 'AREA', area: 100000 }))
    const geometry = output.data.features[0].geometry as Polygon
    expect(geometry.coordinates).toHaveLength(2)
    expect(output.data.features[0].properties?.NAME).toBe('park')
  })

  it('fills holes smaller than a percentage', async () => {
    const layer = holed()
    const output = firstLayer(await run(eliminatePolygonPartTool, [layer], { target: layer.id, condition: 'PERCENT', percent: 50 }))
    expect((output.data.features[0].geometry as Polygon).coordinates).toHaveLength(1)
  })

  it('drops small separate parts with ANY', async () => {
    const layer = testLayer('mp', [raw({ type: 'MultiPolygon', coordinates: [[ring(35, 31, 0.1)], [ring(35.2, 31, 0.001)]] })])
    const output = firstLayer(await run(eliminatePolygonPartTool, [layer], { target: layer.id, condition: 'AREA', area: 100000, partOption: 'ANY' }))
    expect(output.data.features[0].geometry.type).toBe('Polygon')
  })

  it('requires a positive threshold', async () => {
    const layer = holed()
    await expect(run(eliminatePolygonPartTool, [layer], { target: layer.id, condition: 'AREA', area: 0 })).rejects.toThrow(/threshold/)
  })
})

describe('Minimum Bounding Geometry', () => {
  const lShape = raw({ type: 'Polygon', coordinates: [[[35, 31], [35.02, 31], [35.02, 31.01], [35.01, 31.01], [35.01, 31.02], [35, 31.02], [35, 31]]] }, { KIND: 'L' })

  it('builds convex hulls and envelopes per feature', async () => {
    const layer = testLayer('l', [lShape])
    const hull = firstLayer(await run(minimumBoundingGeometryTool, [layer], { target: layer.id, geometryType: 'CONVEX_HULL' }))
    const envelope = firstLayer(await run(minimumBoundingGeometryTool, [layer], { target: layer.id, geometryType: 'ENVELOPE' }))
    const lArea = area(lShape)
    const hullArea = area(hull.data.features[0])
    const envelopeArea = area(envelope.data.features[0])
    expect(hullArea).toBeGreaterThan(lArea)
    expect(envelopeArea).toBeCloseTo(squareArea * 4, -3)
    expect(hullArea).toBeLessThan(envelopeArea)
    expect(hull.data.features[0].properties).toMatchObject({ KIND: 'L', ORIG_FID: 1 })
    expect(envelope.data.features[0].properties?.MBG_Width).toBeGreaterThan(1800)
    expectValid(hull.data.features[0])
  })

  it('builds the minimum enclosing circle', async () => {
    // Two points ~1 km apart east-west at lat 31: circle diameter equals their distance.
    const a: Position = [35, 31]
    const b: Position = [35.0105, 31]
    const layer = testLayer('pts', [point(a[0], a[1]), point(b[0], b[1]), point(35.005, 31.001)])
    const circle = firstLayer(await run(minimumBoundingGeometryTool, [layer], { target: layer.id, geometryType: 'CIRCLE', group: 'ALL' }))
    expect(circle.data.features).toHaveLength(1)
    expect(circle.data.features[0].properties?.MBG_Diameter).toBeCloseTo(haversine(a, b), -1)
    for (const position of [a, b]) expect(booleanPointInPolygon([position[0] + (position[0] > 35.005 ? -1e-6 : 1e-6), position[1]], circle.data.features[0] as Feature<Polygon>)).toBe(true)
  })

  it('groups by a field list and skips degenerate inputs', async () => {
    const layer = testLayer('pts', [
      point(35, 31, { G: 'x' }), point(35.01, 31, { G: 'x' }), point(35, 31.01, { G: 'x' }),
      point(35.1, 31, { G: 'y' }),
    ])
    const result = await run(minimumBoundingGeometryTool, [layer], { target: layer.id, group: 'LIST', groupField: 'G' })
    const output = firstLayer(result)
    expect(props(output)).toEqual([{ G: 'x' }])
    expect(result.kind).toBe('warning')
    await expect(run(minimumBoundingGeometryTool, [layer], { target: layer.id, group: 'LIST' })).rejects.toThrow(/group field/)
  })
})

// ---------- Fields ----------

describe('Fields toolset', () => {
  it('Add Field adds a typed field with a default value', async () => {
    const layer = testLayer('pts', [point(35, 31, { NAME: 'a' })])
    const result = await run(addFieldTool, [layer], { target: layer.id, fieldName: 'SCORE', fieldType: 'DOUBLE', defaultValue: '2.5' })
    expect(props(updatedData(result))[0]).toEqual({ NAME: 'a', SCORE: 2.5 })
    expect(result.updates![0].updates.customFields).toEqual(['SCORE'])
    await expect(run(addFieldTool, [layer], { target: layer.id, fieldName: 'name' })).rejects.toThrow(/already exists/)
    await expect(run(addFieldTool, [layer], { target: layer.id, fieldName: '1bad' })).rejects.toThrow(/not a valid field name/)
    await expect(run(addFieldTool, [layer], { target: layer.id, fieldName: 'N', fieldType: 'LONG', defaultValue: '1.5' })).rejects.toThrow(/integer/)
  })

  it('Delete Field removes several fields and clears the label field', async () => {
    const layer = { ...testLayer('pts', [point(35, 31, { A: 1, B: 2, C: 3 })]), labelField: 'B' }
    const result = await run(deleteFieldTool, [layer], { target: layer.id, field: 'A', moreFields: 'B' })
    expect(props(updatedData(result))[0]).toEqual({ C: 3 })
    expect(result.updates![0].updates.labelField).toBe('')
    await expect(run(deleteFieldTool, [layer], { target: layer.id, field: 'Z' })).rejects.toThrow(/does not exist/)
  })

  it('Calculate Field evaluates expressions', async () => {
    const layer = testLayer('pts', [point(35, 31, { A: 4 }), point(35, 31, { A: 6 })])
    const result = await run(calculateFieldTool, [layer], { target: layer.id, fieldName: 'B', expression: '[A] * 2 + 1' })
    expect(props(updatedData(result)).map((row) => row.B)).toEqual([9, 13])
    await expect(run(calculateFieldTool, [layer], { target: layer.id, fieldName: 'B', expression: '[A] / 0' })).rejects.toThrow()
  })

  it('Calculate Geometry Attributes measures area', async () => {
    const layer = testLayer('sq', [square(35, 31, SIZE)])
    const result = await run(calculateGeometryTool, [layer], { target: layer.id, areaUnit: 'sqm', lengthUnit: 'none' })
    expect(props(updatedData(result))[0].AREA_SQM).toBeCloseTo(squareArea, 0)
  })
})

// ---------- General ----------

describe('Append', () => {
  it('appends with field mapping and fresh IDs', async () => {
    const target = testLayer('target', [point(35, 31, { NAME: 'a' }), point(35.1, 31, { NAME: 'b' })])
    const input = testLayer('input', [point(35.2, 31, { NAME: 'c', EXTRA: 1 })])
    const result = await run(appendTool, [target, input], { target: target.id, inputs: input.id })
    const data = updatedData(result)
    expect(props(data)).toEqual([{ NAME: 'a' }, { NAME: 'b' }, { NAME: 'c' }])
    expect(new Set(data.features.map((feature) => feature.id)).size).toBe(3)
    expect(result.updates![0].layerId).toBe(target.id)
  })

  it('enforces the schema with TEST and matching geometry', async () => {
    const target = testLayer('target', [point(35, 31, { NAME: 'a' })])
    const input = testLayer('input', [point(35.2, 31, { NAME: 'c', EXTRA: 1 })])
    const polygons = testLayer('polys', [square(35, 31, SIZE, { NAME: 'p' })])
    await expect(run(appendTool, [target, input], { target: target.id, inputs: input.id, schema: 'TEST' })).rejects.toThrow(/Schema mismatch/)
    await expect(run(appendTool, [target, polygons], { target: target.id, inputs: polygons.id })).rejects.toThrow(/geometry/)
  })
})

describe('Merge', () => {
  it('combines layers with a source field', async () => {
    const a = testLayer('A', [point(35, 31, { X: 1 })])
    const b = testLayer('B', [point(35.1, 31, { Y: 2 }), point(35.2, 31)])
    const output = firstLayer(await run(mergeTool, [a, b], { inputs: `${a.id},${b.id}` }))
    expect(props(output)).toEqual([
      { X: 1, Y: null, MERGE_SRC: 'A' }, { X: null, Y: 2, MERGE_SRC: 'B' }, { X: null, Y: null, MERGE_SRC: 'B' },
    ])
  })
})

describe('Find / Delete Identical', () => {
  const dupes = () => testLayer('dupes', [
    point(35, 31, { NAME: 'a' }), point(35.1, 31, { NAME: 'b' }), point(35, 31, { NAME: 'c' }),
    point(35.0000001, 31, { NAME: 'a' }), point(35.2, 31, { NAME: 'b' }),
  ])

  it('finds identical shapes, with tolerance and fields', async () => {
    const layer = dupes()
    const exact = firstLayer(await run(findIdenticalTool, [layer], { target: layer.id, fields: 'Shape' }))
    expect(props(exact)).toEqual([{ IN_FID: 1, FEAT_SEQ: 1 }, { IN_FID: 3, FEAT_SEQ: 1 }])
    expect(exact.data.features.every((feature) => feature.geometry === null)).toBe(true)
    const tolerant = firstLayer(await run(findIdenticalTool, [layer], { target: layer.id, fields: 'Shape', tolerance: 1 }))
    expect(props(tolerant).map((row) => row.IN_FID)).toEqual([1, 3, 4])
    const byName = firstLayer(await run(findIdenticalTool, [layer], { target: layer.id, fields: 'NAME' }))
    expect(props(byName)).toHaveLength(4)
    const all = firstLayer(await run(findIdenticalTool, [layer], { target: layer.id, fields: 'NAME', onlyDuplicates: 'no' }))
    expect(props(all)).toHaveLength(5)
    await expect(run(findIdenticalTool, [layer], { target: layer.id, fields: 'MISSING' })).rejects.toThrow(/does not exist/)
  })

  it('deletes all but the first identical record', async () => {
    const layer = dupes()
    const result = await run(deleteIdenticalTool, [layer], { target: layer.id, fields: 'Shape, NAME', tolerance: 1 })
    expect(props(updatedData(result)).map((row) => row.NAME)).toEqual(['a', 'b', 'c', 'b'])
    const none = await run(deleteIdenticalTool, [layer], { target: layer.id, fields: 'Shape' })
    expect(props(updatedData(none))).toHaveLength(4)
  })
})

describe('Sort', () => {
  const layer = () => testLayer('pts', [
    point(35, 31, { POP: 5, NAME: 'b' }), point(35.1, 31.1, { POP: null, NAME: 'a' }),
    point(35.2, 31.2, { POP: 20, NAME: 'c' }), point(35.3, 31.3, { POP: 5, NAME: 'a' }),
  ])

  it('sorts by fields with nulls last', async () => {
    const input = layer()
    const descending = firstLayer(await run(sortTool, [input], { target: input.id, field: 'POP', direction: 'DESCENDING', field2: 'NAME' }))
    expect(props(descending).map((row) => `${row.POP}${row.NAME}`)).toEqual(['20c', '5a', '5b', 'nulla'])
  })

  it('sorts spatially from the upper left', async () => {
    const input = layer()
    const output = firstLayer(await run(sortTool, [input], { target: input.id, spatial: 'UL' }))
    // Two row bands: the top band (35.2, 35.3) left to right, then the bottom band (35, 35.1).
    expect(props(output).map((row) => row.NAME)).toEqual(['c', 'a', 'b', 'a'])
    expect(props(output).map((row) => row.POP)).toEqual([20, 5, 5, null])
    await expect(run(sortTool, [input], { target: input.id })).rejects.toThrow(/sort field/)
  })
})

describe('Feature Class To Feature Class', () => {
  it('copies a filtered subset keeping the source CRS', async () => {
    const layer = testLayer('pts', [point(35, 31, { T: 'x' }), point(35, 31, { T: 'y' })], 'EPSG:2039')
    const output = firstLayer(await run(featureClassToFeatureClassTool, [layer], { target: layer.id, field: 'T', value: 'y' }))
    expect(props(output)).toEqual([{ T: 'y' }])
    expect(output.sourceCrs).toBe('EPSG:2039')
    await expect(run(featureClassToFeatureClassTool, [layer], { target: layer.id, field: 'T', value: 'z' })).rejects.toThrow(/No features/)
  })
})

// ---------- Generalization ----------

describe('Generalization', () => {
  // A 1.1 km line with ~1 m wiggles.
  const wiggly = (): Position[] => Array.from({ length: 21 }, (_, index) => [35 + index * 0.0005, 31 + (index % 2 ? 0.00001 : 0)])

  it('Simplify Line removes vertices within the metre tolerance', async () => {
    const layer = testLayer('l', [line(wiggly(), { ID: 1 })])
    const coarse = firstLayer(await run(simplifyLineTool, [layer], { target: layer.id, tolerance: 10 }))
    expect((coarse.data.features[0].geometry as LineString).coordinates).toHaveLength(2)
    expect(props(coarse)[0].ID).toBe(1)
    const fine = firstLayer(await run(simplifyLineTool, [layer], { target: layer.id, tolerance: 0.1 }))
    expect((fine.data.features[0].geometry as LineString).coordinates).toHaveLength(21)
    await expect(run(simplifyLineTool, [layer], { target: layer.id, tolerance: 0 })).rejects.toThrow(/greater than zero/)
  })

  it('Simplify Polygon keeps a valid polygon of similar area', async () => {
    const top = wiggly().slice().reverse().map(([x, y]) => [x, y + 0.01])
    const polygon = raw({ type: 'Polygon', coordinates: [[...wiggly(), ...top, wiggly()[0]]] })
    const layer = testLayer('p', [polygon])
    const output = firstLayer(await run(simplifyPolygonTool, [layer], { target: layer.id, tolerance: 10 }))
    const coordinates = (output.data.features[0].geometry as Polygon).coordinates[0]
    expect(coordinates.length).toBeLessThan(10)
    expect(area(output.data.features[0])).toBeCloseTo(area(polygon), -3)
    expectValid(output.data.features[0])
    await expect(run(simplifyPolygonTool, [layer], { target: layer.id, tolerance: 10, minimumArea: 1e9 })).rejects.toThrow(/minimum area/)
  })

  it('Smooth Line keeps end points and adds vertices', async () => {
    const coordinates: Position[] = [[35, 31], [35.01, 31.01], [35.02, 31]]
    const layer = testLayer('l', [line(coordinates)])
    for (const algorithm of ['CHAIKIN', 'BEZIER']) {
      const output = firstLayer(await run(smoothLineTool, [layer], { target: layer.id, algorithm, iterations: 3 }))
      const smoothed = (output.data.features[0].geometry as LineString).coordinates
      expect(smoothed.length).toBeGreaterThan(3)
      expect(smoothed[0]).toEqual(coordinates[0])
      expect(smoothed.at(-1)![0]).toBeCloseTo(35.02, 6)
    }
  })

  it('Smooth Polygon rounds corners and stays valid', async () => {
    const layer = testLayer('p', [square(35, 31, SIZE, { N: 1 })])
    const output = firstLayer(await run(smoothPolygonTool, [layer], { target: layer.id, iterations: 2 }))
    const feature = output.data.features[0]
    expect((feature.geometry as Polygon).coordinates[0].length).toBeGreaterThan(5)
    expect(area(feature)).toBeLessThan(squareArea)
    expect(area(feature)).toBeGreaterThan(squareArea * 0.7)
    expect(kinks(feature as Feature<Polygon>).features).toHaveLength(0)
    expect(feature.properties?.N).toBe(1)
    await expect(run(smoothPolygonTool, [layer], { target: layer.id, iterations: 9 })).rejects.toThrow(/between 1 and 6/)
  })
})

// ---------- Projections ----------

describe('Projections', () => {
  it('Define Projection sets sourceCrs and warns when overriding', async () => {
    const layer = testLayer('pts', [point(35, 31)], 'EPSG:32636')
    const result = await run(defineProjectionTool, [layer], { target: layer.id, crs: 'EPSG:2039' })
    expect(result.updates).toEqual([{ layerId: layer.id, updates: { sourceCrs: 'EPSG:2039' } }])
    expect(result.kind).toBe('warning')
    const same = await run(defineProjectionTool, [layer], { target: layer.id, crs: 'EPSG:32636' })
    expect(same.updates).toBeUndefined()
    const unknown = testLayer('pts', [point(35, 31)], 'Defined by .prj')
    const defined = await run(defineProjectionTool, [unknown], { target: unknown.id, crs: 'EPSG:28191' })
    expect(defined.kind).toBe('success')
    expect(defined.updates![0].updates.sourceCrs).toBe('EPSG:28191')
    await expect(run(defineProjectionTool, [layer], { target: layer.id, crs: 'EPSG:99999' })).rejects.toThrow(/Unsupported/)
  })

  it('Project tags the output layer and exports projected coordinates', async () => {
    const layer = testLayer('pts', [point(35, 31)])
    const result = await run(projectTool, [layer], { target: layer.id, targetCrs: 'EPSG:32636' })
    expect(firstLayer(result).sourceCrs).toBe('EPSG:32636')
    const exported = JSON.parse(await result.downloads![0].blob.text()) as FeatureCollection
    const [x, y] = (exported.features[0].geometry as { coordinates: number[] }).coordinates
    const expected = projectPosition('EPSG:4326', 'EPSG:32636', [35, 31])!
    expect(x).toBeCloseTo(expected[0], 2)
    expect(y).toBeCloseTo(expected[1], 2)
  })
})

// ---------- Sampling ----------

describe('Create Fishnet', () => {
  it('builds rows × columns over a typed extent with label points', async () => {
    const result = await run(createFishnetTool, [], { extent: '35, 31, 35.05, 31.02', rows: 2, columns: 5, labels: 'yes' })
    const [cells, labels] = result.layers!
    expect(cells.data.features).toHaveLength(10)
    expect(labels.data.features).toHaveLength(10)
    expect(props(cells).at(-1)).toEqual({ CELL_ID: 10, ROW: 2, COL: 5 })
    expect(area(cells.data.features[0])).toBeCloseTo(squareArea, -2)
    expect(labels.data.features[0].geometry).toEqual({ type: 'Point', coordinates: [35.005, 31.005] })
  })

  it('uses a template extent and metre cell size, or polylines', async () => {
    const template = testLayer('t', [square(35, 31, SIZE)])
    const cells = firstLayer(await run(createFishnetTool, [template], { template: template.id, cellWidth: 500 }))
    // 0.01° ≈ 954 m east-west and 1112 m north-south at lat 31 → 2 × 3 cells of 500 m.
    expect(cells.data.features).toHaveLength(6)
    expect(area(cells.data.features[0])).toBeCloseTo(250000, -3)
    const lines = firstLayer(await run(createFishnetTool, [], { extent: '35,31,35.05,31.02', rows: 2, columns: 5, geometryType: 'POLYLINE' }))
    expect(lines.data.features).toHaveLength(3 + 6)
  })

  it('validates the extent and cell limit', async () => {
    await expect(run(createFishnetTool, [], { rows: 2, columns: 2 })).rejects.toThrow(/extent/)
    await expect(run(createFishnetTool, [], { extent: '35,31,34,32', rows: 2, columns: 2 })).rejects.toThrow(/west < east/)
    await expect(run(createFishnetTool, [], { extent: '0,0,10,10', cellWidth: 10 })).rejects.toThrow(/limit/)
  })
})

describe('Create Random Points', () => {
  it('places the requested count inside each polygon honouring the minimum distance', async () => {
    const layer = testLayer('polys', [square(35, 31, SIZE), square(35.05, 31, SIZE)])
    const result = await run(createRandomPointsTool, [layer], { constraint: layer.id, count: 15, minDistance: 50 })
    const points = firstLayer(result).data.features
    expect(points).toHaveLength(30)
    const polygons = layer.data.features as Feature<Polygon>[]
    for (const feature of points) {
      const cid = feature.properties?.CID as number
      expect(booleanPointInPolygon(feature.geometry as never, polygons[cid - 1])).toBe(true)
    }
    const coordinates = points.map((feature) => (feature.geometry as { coordinates: Position }).coordinates)
    for (let i = 0; i < coordinates.length; i += 1) {
      for (let j = i + 1; j < coordinates.length; j += 1) expect(haversine(coordinates[i], coordinates[j])).toBeGreaterThanOrEqual(50)
    }
  })

  it('uses the layer extent for non-polygon layers and reports shortfalls', async () => {
    const layer = testLayer('pts', [point(35, 31), point(35.01, 31.01)])
    const points = firstLayer(await run(createRandomPointsTool, [layer], { constraint: layer.id, count: 25 })).data.features
    expect(points).toHaveLength(25)
    for (const feature of points) {
      const [x, y] = (feature.geometry as { coordinates: Position }).coordinates
      expect(x).toBeGreaterThanOrEqual(35); expect(x).toBeLessThanOrEqual(35.01)
      expect(y).toBeGreaterThanOrEqual(31); expect(y).toBeLessThanOrEqual(31.01)
    }
    const crowded = await run(createRandomPointsTool, [layer], { constraint: layer.id, count: 50, minDistance: 1000 })
    expect(crowded.kind).toBe('warning')
    expect(firstLayer(crowded).data.features.length).toBeLessThan(50)
    await expect(run(createRandomPointsTool, [layer], { constraint: layer.id, count: 0 })).rejects.toThrow(/at least 1/)
  })
})

describe('Generate Points Along Lines', () => {
  const north: Position[] = [[35, 31], [35, 31.005], [35, 31.01]]
  const total = haversine(north[0], north[2])

  it('places points by distance, with optional end points', async () => {
    const layer = testLayer('l', [line(north, { NAME: 'road' })])
    const without = firstLayer(await run(generatePointsAlongLinesTool, [layer], { target: layer.id, value: 100 })).data.features
    expect(without).toHaveLength(Math.floor(total / 100))
    expect(without[0].properties).toMatchObject({ NAME: 'road', ORIG_FID: 1, DISTANCE_M: 100 })
    const [, y] = (without[0].geometry as { coordinates: Position }).coordinates
    expect(haversine(north[0], [35, y])).toBeCloseTo(100, 1)
    const withEnds = firstLayer(await run(generatePointsAlongLinesTool, [layer], { target: layer.id, value: 100, endPoints: 'yes' })).data.features
    expect(withEnds).toHaveLength(Math.floor(total / 100) + 2)
    expect((withEnds.at(-1)!.geometry as { coordinates: Position }).coordinates).toEqual([35, 31.01])
  })

  it('places points by percentage and on polygon boundaries', async () => {
    const layer = testLayer('l', [line(north)])
    const quarters = firstLayer(await run(generatePointsAlongLinesTool, [layer], { target: layer.id, placement: 'PERCENTAGE', value: 25, endPoints: 'yes' })).data.features
    expect(quarters.map((feature) => (feature.geometry as { coordinates: Position }).coordinates[1])).toEqual([31, 31.0025, 31.005, 31.0075, 31.01].map((value) => expect.closeTo(value, 6)))
    const polygons = testLayer('p', [square(35, 31, SIZE)])
    const ring = firstLayer(await run(generatePointsAlongLinesTool, [polygons], { target: polygons.id, placement: 'PERCENTAGE', value: 10 })).data.features
    expect(ring).toHaveLength(9)
  })

  it('rejects bad values and point layers', async () => {
    const layer = testLayer('l', [line(north)])
    await expect(run(generatePointsAlongLinesTool, [layer], { target: layer.id, placement: 'PERCENTAGE', value: 150 })).rejects.toThrow(/between 0 and 100/)
    const points = testLayer('p', [point(35, 31)])
    await expect(run(generatePointsAlongLinesTool, [points], { target: points.id, value: 10 })).rejects.toThrow(/line or polygon/)
  })
})

describe('Alter Field keeps references consistent', () => {
  const pointFeature = { type: 'Feature' as const, properties: { name: 'A', pop: 5, note: 'x' }, geometry: { type: 'Point' as const, coordinates: [0, 0] } }
  const build = () => {
    const base = testLayer('Cities', [pointFeature])
    return { ...base, labelStyle: { ...base.labelStyle, expression: '{name} ({pop})' }, extrusion: { field: 'pop', multiplier: 2 } }
  }

  it('rewrites label expression tokens and the extrusion field on rename', async () => {
    const layer = build()
    const result = await run(alterFieldTool, [layer], { target: layer.id, field: 'pop', newName: 'population' })
    const updates = result.updates?.[0].updates
    expect(updates?.labelStyle?.expression).toBe('{name} ({population})')
    expect(updates?.extrusion).toEqual({ field: 'population', multiplier: 2 })
  })

  it('leaves them untouched when an unrelated field is renamed', async () => {
    const layer = build()
    const result = await run(alterFieldTool, [layer], { target: layer.id, field: 'note', newName: 'remark' })
    const updates = result.updates?.[0].updates
    expect(updates?.labelStyle?.expression).toBe('{name} ({pop})')
    expect(updates?.extrusion).toEqual({ field: 'pop', multiplier: 2 })
  })
})
