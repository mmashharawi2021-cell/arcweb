import area from '@turf/area'
import length from '@turf/length'
import type { Feature, Geometry, Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import type { MapLayer } from '../../../store'
import { haversine } from '../../spatial'
import { runTool, testLayer } from '../../testUtils'
import type { ToolExecutionResult } from '../../types'
import { bufferTool } from '../buffer'
import { clipTool } from '../clip'
import { createThiessenPolygonsTool } from '../createThiessenPolygons'
import { eraseTool } from '../erase'
import { frequencyTool } from '../frequency'
import { identityTool } from '../identity'
import { analysisTools } from '../index'
import { intersectTool } from '../intersect'
import { multipleRingBufferTool } from '../multipleRingBuffer'
import { distanceMatrixTool, nearTool } from '../near'
import { pointDistanceTool } from '../pointDistance'
import { selectTool } from '../select'
import { spatialJoinTool } from '../spatialJoin'
import { splitTool } from '../split'
import { summaryStatisticsTool } from '../summaryStatistics'
import { symmetricalDifferenceTool } from '../symmetricalDifference'
import { tableSelectTool } from '../tableSelect'
import { tabulateIntersectionTool } from '../tabulateIntersection'
import { unionTool } from '../union'
import { updateTool } from '../update'

type Props = Record<string, unknown>
const X = 35
const Y = 31

const rect = (x1: number, y1: number, x2: number, y2: number, properties: Props = {}): Feature<Geometry> => ({
  type: 'Feature', properties,
  geometry: { type: 'Polygon', coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]] },
})
const square = (x: number, y: number, size: number, properties: Props = {}) => rect(x, y, x + size, y + size, properties)
const pt = (x: number, y: number, properties: Props = {}): Feature<Geometry> => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [x, y] } })
const line = (coordinates: Position[], properties: Props = {}): Feature<Geometry> => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } })

const areaOf = (features: Feature[]) => features.reduce((sum, feature) => sum + (feature.geometry ? area(feature) : 0), 0)
const features = (result: ToolExecutionResult, index = 0) => result.layers?.[index].data.features ?? []
const props = (result: ToolExecutionResult, index = 0) => features(result, index).map((feature) => feature.properties ?? {})
const expectClose = (actual: number, expected: number, relative = 0.002) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * relative + 1e-6)

// A = 0.02° square at (35, 31); B = same size shifted by 0.01° in both axes; overlap = 0.01° square.
const A = () => square(X, Y, 0.02, { NAME: 'a', CODE: 1 })
const B = () => square(X + 0.01, Y + 0.01, 0.02, { NAME: 'b', KIND: 'k' })
const areaA = area(square(X, Y, 0.02))
const areaB = area(square(X + 0.01, Y + 0.01, 0.02))
const overlap = area(square(X + 0.01, Y + 0.01, 0.01))

const layerPair = (first: Feature<Geometry>[], second: Feature<Geometry>[]): [MapLayer, MapLayer] =>
  [testLayer('first', first), testLayer('second', second)]

describe('Analysis toolbox registry', () => {
  it('exposes every tool once with a valid toolset, ordered by toolset then name', () => {
    const order = ['Extract', 'Overlay', 'Proximity', 'Statistics']
    expect(analysisTools.every((tool) => tool.category === 'Analysis' && order.includes(tool.subcategory ?? ''))).toBe(true)
    expect(new Set(analysisTools.map((tool) => tool.id)).size).toBe(analysisTools.length)
    for (let index = 1; index < analysisTools.length; index += 1) {
      const [previous, current] = [analysisTools[index - 1], analysisTools[index]]
      const toolsetOrder = order.indexOf(previous.subcategory!) - order.indexOf(current.subcategory!)
      expect(toolsetOrder < 0 || (toolsetOrder === 0 && previous.name.localeCompare(current.name) < 0)).toBe(true)
    }
    expect(analysisTools.map((tool) => tool.id)).toEqual(expect.arrayContaining([
      'clip', 'select', 'split', 'table-select', 'erase', 'identity', 'intersect', 'symmetrical-difference', 'union', 'update',
      'spatial-join', 'buffer', 'multiple-ring-buffer', 'near', 'point-distance', 'create-thiessen-polygons',
      'summary-statistics', 'summarize-within', 'frequency', 'tabulate-intersection',
    ]))
    expect(analysisTools.some((tool) => tool.id === 'dissolve' || tool.id === 'centroids')).toBe(false)
  })
})

describe('Extract', () => {
  it('Clip cuts polygons, lines and points to the clip area and keeps input attributes only', async () => {
    const [input, clip] = layerPair([
      A(),
      line([[X - 0.01, Y + 0.015], [X + 0.03, Y + 0.015]], { ID: 'road' }),
      pt(X + 0.005, Y + 0.005, { ID: 'in' }),
      pt(X + 0.05, Y + 0.05, { ID: 'out' }),
    ], [square(X, Y, 0.02, { ZONE: 1 })])
    const polygonInput = testLayer('poly', [A()])
    const result = await runTool(clipTool, [input, clip], { target: input.id, overlay: clip.id })
    const out = features(result)
    expect(out).toHaveLength(3)
    expectClose(area(out[0]), areaA)
    expect(out[0].properties).toEqual({ NAME: 'a', CODE: 1 })
    const clippedLine = out.find((feature) => feature.properties?.ID === 'road')!
    expectClose(length(clippedLine), length(line([[X, Y + 0.015], [X + 0.02, Y + 0.015]])), 0.001)
    expect(out.some((feature) => feature.properties?.ID === 'out')).toBe(false)

    const shifted = testLayer('clipB', [B()])
    const partial = await runTool(clipTool, [polygonInput, shifted], { target: polygonInput.id, overlay: shifted.id })
    expectClose(areaOf(features(partial)), overlap)
  })

  it('Clip rejects a clip layer without polygons', async () => {
    const [input, points] = layerPair([A()], [pt(X, Y)])
    await expect(runTool(clipTool, [input, points], { target: input.id, overlay: points.id })).rejects.toThrow(/polygon/)
  })

  const cities = () => testLayer('cities', [
    pt(X, Y, { NAME: 'Alpha', POP: 10, TYPE: 'A' }),
    pt(X + 0.01, Y, { NAME: 'Beta', POP: 20, TYPE: 'B' }),
    pt(X + 0.02, Y, { NAME: "O'Hara", POP: 30, TYPE: 'A' }),
  ])

  it('Select applies AND/OR, LIKE, quoted literals and case-insensitive field names', async () => {
    const layer = cities()
    const run = (expression: string) => runTool(selectTool, [layer], { target: layer.id, expression })
    expect(props(await run("POP > 15 AND TYPE = 'A'")).map((row) => row.NAME)).toEqual(["O'Hara"])
    expect(props(await run("TYPE = 'B' OR pop < 15")).map((row) => row.NAME)).toEqual(['Alpha', 'Beta'])
    expect(props(await run("NAME = 'O''Hara'")).map((row) => row.POP)).toEqual([30])
    expect(props(await run("NAME LIKE '%a'")).map((row) => row.NAME)).toEqual(['Alpha', 'Beta', "O'Hara"])
    expect(props(await run('POP <> 20')).map((row) => row.POP)).toEqual([10, 30])
    expect(features(await run(''))).toHaveLength(3)
    const point = features(await run('POP = 20'))[0]
    expect(point.geometry).toEqual({ type: 'Point', coordinates: [X + 0.01, Y] })
  })

  it('Select reports unknown fields and empty results', async () => {
    const layer = cities()
    await expect(runTool(selectTool, [layer], { target: layer.id, expression: 'HEIGHT > 1' })).rejects.toThrow(/HEIGHT/)
    await expect(runTool(selectTool, [layer], { target: layer.id, expression: 'POP > 1000' })).rejects.toThrow(/No features/)
    await expect(runTool(selectTool, [layer], { target: layer.id, expression: "(POP > 1)" })).rejects.toThrow(/Parentheses/)
  })

  it('Select safely rejects malformed expressions and mismatched literal types', async () => {
    const layer = cities()
    const run = (expression: string) => runTool(selectTool, [layer], { target: layer.id, expression })
    await expect(run("NAME = 'Alpha")).rejects.toThrow(/quote/i)
    await expect(run('POP = twelve')).rejects.toThrow(/numeric value/i)
    await expect(run("POP = '12'")).rejects.toThrow(/type does not match/i)
    await expect(run('NAME = 12')).rejects.toThrow(/type does not match/i)
  })

  it('Table Select outputs geometry-less rows and an optional CSV', async () => {
    const layer = cities()
    const result = await runTool(tableSelectTool, [layer], { target: layer.id, expression: "TYPE = 'A'", download: 'csv' })
    const rows = features(result)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.geometry === null)).toBe(true)
    expect(rows.map((row) => row.properties?.POP)).toEqual([10, 30])
    expect(result.downloads).toHaveLength(1)
    const csv = await result.downloads![0].blob.text()
    expect(csv.split(/\r?\n/)[0]).toBe('NAME,POP,TYPE')
    expect(csv).toContain('Alpha,10,A')
  })

  it('Split writes one layer per split-field value, each clipped to its zone', async () => {
    const [input, zones] = layerPair([A()], [
      rect(X, Y, X + 0.01, Y + 0.02, { ZONE: 'W' }),
      rect(X + 0.01, Y, X + 0.02, Y + 0.02, { ZONE: 'E' }),
      rect(X + 0.5, Y, X + 0.6, Y + 0.1, { ZONE: 'FAR' }),
    ])
    const result = await runTool(splitTool, [input, zones], { target: input.id, split: zones.id, splitField: 'ZONE' })
    expect(result.layers?.map((layer) => layer.name)).toEqual(['first E', 'first W'])
    expectClose(areaOf(features(result, 0)), area(rect(X + 0.01, Y, X + 0.02, Y + 0.02)))
    expectClose(areaOf(features(result, 1)), area(rect(X, Y, X + 0.01, Y + 0.02)))
    expect(features(result, 1)[0].properties).toEqual({ NAME: 'a', CODE: 1 })
  })
})

describe('Overlay', () => {
  it('Erase removes the overlapping area', async () => {
    const [input, eraser] = layerPair([A()], [B()])
    const result = await runTool(eraseTool, [input, eraser], { target: input.id, erase: eraser.id })
    expectClose(areaOf(features(result)), areaA - overlap)
  })

  it('Identity splits input by identity polygons and keeps the whole input area', async () => {
    const [input, identity] = layerPair([A()], [B()])
    const result = await runTool(identityTool, [input, identity], { target: input.id, identity: identity.id })
    const out = features(result)
    expect(out).toHaveLength(2)
    expectClose(areaOf(out), areaA)
    const inside = out.find((feature) => feature.properties?.FID_IDENTITY === 1)!
    expectClose(area(inside), overlap)
    expect(inside.properties).toMatchObject({ FID_INPUT: 1, NAME: 'a', NAME_1: 'b', KIND: 'k' })
    expect(out.find((feature) => feature.properties?.FID_IDENTITY === -1)?.properties).toMatchObject({ NAME: 'a', NAME_1: null })
  })

  it('Intersect polygons with polygons, and points with polygons in either order', async () => {
    const [left, right] = layerPair([A()], [B()])
    const result = await runTool(intersectTool, [left, right], { target: left.id, overlay: right.id })
    expect(features(result)).toHaveLength(1)
    expectClose(areaOf(features(result)), overlap)
    expect(props(result)[0]).toEqual({ FID_INPUT: 1, NAME: 'a', CODE: 1, FID_INTERSECT: 1, NAME_1: 'b', KIND: 'k' })

    const points = testLayer('pts', [pt(X + 0.005, Y + 0.005, { P: 1 }), pt(X + 0.015, Y + 0.015, { P: 2 }), pt(X + 0.1, Y, { P: 3 })])
    const forward = await runTool(intersectTool, [points, right], { target: points.id, overlay: right.id })
    expect(props(forward).map((row) => row.P)).toEqual([2])
    const reverse = await runTool(intersectTool, [left, points], { target: left.id, overlay: points.id })
    expect(props(reverse).map((row) => [row.NAME, row.P])).toEqual([['a', 1], ['a', 2]])
    expect(features(reverse)[0].geometry.type).toBe('Point')
  })

  it('Intersect needs a polygon layer', async () => {
    const [a, b] = layerPair([pt(X, Y)], [pt(X, Y)])
    await expect(runTool(intersectTool, [a, b], { target: a.id, overlay: b.id })).rejects.toThrow(/polygons/)
  })

  it('Symmetrical Difference keeps the non-overlapping parts of both layers', async () => {
    const [left, right] = layerPair([A()], [B()])
    const result = await runTool(symmetricalDifferenceTool, [left, right], { target: left.id, update: right.id })
    expect(features(result)).toHaveLength(2)
    expectClose(areaOf(features(result)), areaA + areaB - 2 * overlap)
    expect(props(result).map((row) => [row.FID_INPUT, row.FID_UPDATE])).toEqual([[1, -1], [-1, 1]])
  })

  it('Union produces three pieces covering both layers', async () => {
    const [left, right] = layerPair([A()], [B()])
    const result = await runTool(unionTool, [left, right], { target: left.id, overlay: right.id })
    expect(features(result)).toHaveLength(3)
    expectClose(areaOf(features(result)), areaA + areaB - overlap)
  })

  it('Update replaces covered input areas and keeps the input schema', async () => {
    const [left, right] = layerPair([A()], [B()])
    const result = await runTool(updateTool, [left, right], { target: left.id, update: right.id })
    expect(features(result)).toHaveLength(2)
    expectClose(area(features(result)[0]), areaA - overlap)
    expectClose(area(features(result)[1]), areaB)
    expect(props(result)).toEqual([{ NAME: 'a', CODE: 1 }, { NAME: 'b', CODE: null }])
  })

  it('Spatial Join counts points inside polygons', async () => {
    const [zones, points] = layerPair([A()], [pt(X + 0.005, Y + 0.005, { V: 1 }), pt(X + 0.006, Y + 0.006, { V: 2 }), pt(X + 1, Y)])
    const result = await runTool(spatialJoinTool, [zones, points], { target: zones.id, overlay: points.id })
    expect(props(result)[0]).toMatchObject({ Join_Count: 2, NAME: 'a', V: 1 })
  })
})

describe('Proximity', () => {
  it('Buffer creates geodesic circles and dissolves them', async () => {
    const layer = testLayer('pts', [pt(X, Y, { G: 'x' }), pt(X + 0.005, Y, { G: 'x' }), pt(X + 0.1, Y, { G: 'y' })])
    const single = await runTool(bufferTool, [layer], { target: layer.id, distance: 1, unit: 'km' })
    expect(features(single)).toHaveLength(3)
    expectClose(area(features(single)[0]), Math.PI * 1e6, 0.01)
    expect(props(single)[0]).toEqual({ G: 'x', BUFF_DIST: 1000 })

    const all = await runTool(bufferTool, [layer], { target: layer.id, distance: 1000, unit: 'm', dissolve: 'ALL' })
    expect(features(all)).toHaveLength(1)
    expect(area(features(all)[0])).toBeLessThan(3 * Math.PI * 1e6 * 0.99)
    expect(area(features(all)[0])).toBeGreaterThan(2 * Math.PI * 1e6)

    const byField = await runTool(bufferTool, [layer], { target: layer.id, distance: 1000, dissolve: 'LIST', dissolveField: 'G' })
    expect(props(byField)).toEqual([{ G: 'x', BUFF_DIST: 1000 }, { G: 'y', BUFF_DIST: 1000 }])
    expectClose(area(features(byField)[1]), Math.PI * 1e6, 0.01)
  })

  it('Buffer shrinks polygons with a negative distance and validates input', async () => {
    const polygon = testLayer('poly', [A()])
    const shrunk = await runTool(bufferTool, [polygon], { target: polygon.id, distance: -100 })
    expect(area(features(shrunk)[0])).toBeLessThan(areaA)
    const points = testLayer('pts', [pt(X, Y)])
    await expect(runTool(bufferTool, [points], { target: points.id, distance: 0 })).rejects.toThrow(/zero/)
    await expect(runTool(bufferTool, [points], { target: points.id, distance: -5 })).rejects.toThrow(/negative/)
  })

  it('Multiple Ring Buffer creates non-overlapping rings', async () => {
    const layer = testLayer('pts', [pt(X, Y, { ID: 1 }), pt(X + 0.1, Y, { ID: 2 })])
    const result = await runTool(multipleRingBufferTool, [layer], { target: layer.id, distances: '200, 100', unit: 'm' })
    const rings = features(result)
    expect(props(result).map((row) => row.distance)).toEqual([100, 200])
    expectClose(area(rings[0]), 2 * Math.PI * 100 ** 2, 0.01)
    expectClose(area(rings[1]), 2 * Math.PI * (200 ** 2 - 100 ** 2), 0.01)
    expect(props(result)[0].UNITS).toBe('Meters')

    const perFeature = await runTool(multipleRingBufferTool, [layer], { target: layer.id, distances: '100,200', dissolve: 'NONE' })
    expect(props(perFeature).map((row) => [row.ID, row.distance])).toEqual([[1, 100], [1, 200], [2, 100], [2, 200]])
    await expect(runTool(multipleRingBufferTool, [layer], { target: layer.id, distances: '100, abc' })).rejects.toThrow(/abc/)
  })

  it('Near writes the nearest feature and distance', async () => {
    const [input, near] = layerPair([pt(X, Y)], [pt(X + 0.01, Y), pt(X + 0.02, Y)])
    const result = await runTool(nearTool, [input, near], { target: input.id, near: near.id })
    const updated = result.updates![0].updates.data!.features[0].properties!
    expect(updated.NEAR_FID).toBe(1)
    expectClose(updated.NEAR_DIST as number, haversine([X, Y], [X + 0.01, Y]), 0.001)
  })

  it('Generate Near Table lists distance pairs', async () => {
    const [input, near] = layerPair([pt(X, Y)], [pt(X + 0.01, Y), pt(X + 0.02, Y)])
    const result = await runTool(distanceMatrixTool, [input, near], { target: input.id, near: near.id, closest: 1 })
    expect(props(result)).toHaveLength(1)
    expect(props(result)[0]).toMatchObject({ IN_FID: 1, NEAR_FID: 1, NEAR_RANK: 1 })
  })

  it('Point Distance tabulates all point pairs within the radius', async () => {
    const layer = testLayer('pts', [pt(X, Y), pt(X + 0.01, Y), pt(X + 0.05, Y)])
    const result = await runTool(pointDistanceTool, [layer], { target: layer.id, near: layer.id, radius: 2000 })
    const rows = props(result)
    expect(rows.map((row) => [row.INPUT_FID, row.NEAR_FID])).toEqual([[1, 2], [2, 1]])
    expectClose(rows[0].DISTANCE as number, haversine([X, Y], [X + 0.01, Y]), 0.0001)
    expect(features(result).every((row) => row.geometry === null)).toBe(true)

    const unlimited = await runTool(pointDistanceTool, [layer], { target: layer.id, near: layer.id, radius: 0 })
    expect(props(unlimited)).toHaveLength(6)
    const polygons = testLayer('poly', [A()])
    await expect(runTool(pointDistanceTool, [polygons, layer], { target: polygons.id, near: layer.id })).rejects.toThrow(/point/)
  })

  it('Create Thiessen Polygons tiles the padded extent and carries point attributes', async () => {
    const layer = testLayer('pts', [
      pt(X, Y, { N: 'sw' }), pt(X + 0.02, Y, { N: 'se' }), pt(X, Y + 0.02, { N: 'nw' }), pt(X + 0.02, Y + 0.02, { N: 'ne' }), pt(X, Y, { N: 'dup' }),
    ])
    const result = await runTool(createThiessenPolygonsTool, [layer], { target: layer.id })
    const cells = features(result)
    expect(cells).toHaveLength(4)
    expect(result.kind).toBe('warning')
    expectClose(areaOf(cells), area(rect(X - 0.002, Y - 0.002, X + 0.022, Y + 0.022)), 0.001)
    const sw = cells.find((cell) => cell.properties?.N === 'sw')!
    expect(sw.properties?.INPUT_FID).toBe(1)
    expectClose(area(sw), area(rect(X - 0.002, Y - 0.002, X + 0.01, Y + 0.01)), 0.001)
  })
})

describe('Statistics', () => {
  const parcels = () => testLayer('parcels', [
    pt(X, Y, { TYPE: 'A', POP: 10, NAME: 'p1' }),
    pt(X, Y, { TYPE: 'B', POP: 5, NAME: 'p2' }),
    pt(X, Y, { TYPE: 'A', POP: 30, NAME: 'p3' }),
    pt(X, Y, { TYPE: 'A', POP: null, NAME: 'p4' }),
  ])

  it('Summary Statistics computes every statistic type per case value', async () => {
    const layer = parcels()
    const result = await runTool(summaryStatisticsTool, [layer], {
      target: layer.id, caseField: 'TYPE',
      statistics: 'POP SUM, POP MEAN, POP MIN, POP MAX, POP RANGE, POP STD, POP COUNT, NAME FIRST, NAME last',
      download: 'csv',
    })
    expect(props(result)).toEqual([
      { TYPE: 'A', FREQUENCY: 3, SUM_POP: 40, MEAN_POP: 20, MIN_POP: 10, MAX_POP: 30, RANGE_POP: 20, STD_POP: 10, COUNT_POP: 2, FIRST_NAME: 'p1', LAST_NAME: 'p4' },
      { TYPE: 'B', FREQUENCY: 1, SUM_POP: 5, MEAN_POP: 5, MIN_POP: 5, MAX_POP: 5, RANGE_POP: 0, STD_POP: 0, COUNT_POP: 1, FIRST_NAME: 'p2', LAST_NAME: 'p2' },
    ])
    expect(result.downloads).toHaveLength(1)
    const total = await runTool(summaryStatisticsTool, [layer], { target: layer.id, statistics: 'POP:SUM' })
    expect(props(total)).toEqual([{ FREQUENCY: 4, SUM_POP: 45 }])
  })

  it('Summary Statistics rejects unknown statistic types and fields', async () => {
    const layer = parcels()
    await expect(runTool(summaryStatisticsTool, [layer], { target: layer.id, statistics: 'POP MEDIANISH' })).rejects.toThrow(/FIELD STATISTIC/)
    await expect(runTool(summaryStatisticsTool, [layer], { target: layer.id, statistics: 'AREA SUM' })).rejects.toThrow(/AREA/)
  })

  it('Frequency counts unique combinations and sums summary fields', async () => {
    const layer = parcels()
    const result = await runTool(frequencyTool, [layer], { target: layer.id, fields: 'TYPE', summaryFields: 'POP' })
    expect(props(result)).toEqual([{ FREQUENCY: 3, TYPE: 'A', POP: 40 }, { FREQUENCY: 1, TYPE: 'B', POP: 5 }])
    await expect(runTool(frequencyTool, [layer], { target: layer.id, fields: '' })).rejects.toThrow(/frequency field/)
  })

  it('Tabulate Intersection reports class area, length and counts with percentages', async () => {
    const zones = testLayer('zones', [square(X, Y, 0.02, { ZONE: 'Z1' }), square(X + 0.05, Y, 0.02, { ZONE: 'Z2' })])
    const landuse = testLayer('landuse', [
      rect(X - 0.01, Y, X + 0.01, Y + 0.02, { LU: 'farm' }),
      rect(X + 0.01, Y, X + 0.02, Y + 0.01, { LU: 'urban' }),
    ])
    const result = await runTool(tabulateIntersectionTool, [zones, landuse], { zones: zones.id, zoneField: 'ZONE', classes: landuse.id, classField: 'LU' })
    const rows = props(result)
    expect(rows.map((row) => [row.ZONE, row.LU])).toEqual([['Z1', 'farm'], ['Z1', 'urban']])
    expectClose(rows[0].AREA as number, area(rect(X, Y, X + 0.01, Y + 0.02)))
    expectClose(rows[0].PERCENTAGE as number, 50, 0.005)
    expectClose(rows[1].PERCENTAGE as number, 25, 0.005)

    const roads = testLayer('roads', [line([[X - 0.01, Y + 0.01], [X + 0.03, Y + 0.01]], { R: 'main' }), line([[X + 0.06, Y - 0.01], [X + 0.06, Y + 0.03]], { R: 'side' })])
    const lineResult = await runTool(tabulateIntersectionTool, [zones, roads], { zones: zones.id, zoneField: 'ZONE', classes: roads.id, classField: 'R' })
    const lineRows = props(lineResult)
    expect(lineRows.map((row) => [row.ZONE, row.R, row.PERCENTAGE])).toEqual([['Z1', 'main', 100], ['Z2', 'side', 100]])
    expectClose(lineRows[0].LENGTH as number, length(line([[X, Y + 0.01], [X + 0.02, Y + 0.01]])) * 1000, 0.001)

    const wells = testLayer('wells', [pt(X + 0.005, Y + 0.005), pt(X + 0.006, Y + 0.005), pt(X + 0.055, Y + 0.005), pt(X + 1, Y)])
    const pointRows = props(await runTool(tabulateIntersectionTool, [zones, wells], { zones: zones.id, zoneField: 'ZONE', classes: wells.id }))
    expect(pointRows).toEqual([{ ZONE: 'Z1', PNT_COUNT: 2, PERCENTAGE: 100 }, { ZONE: 'Z2', PNT_COUNT: 1, PERCENTAGE: 100 }])
  })
})
