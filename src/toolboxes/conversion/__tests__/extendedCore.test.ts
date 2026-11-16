import JSZip from 'jszip'
import type { Feature, Geometry, LineString, Point, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { runTool, testLayer } from '../../testUtils'
import { excelToTableTool } from '../excelToTable'
import { dxfToFeaturesTool, parseDxf } from '../dxfToFeatures'
import { featuresToDxfTool } from '../featuresToDxf'
import { tableToExcelTool } from '../tableToExcel'

const point = (x: number, properties: Record<string, unknown> = {}): Feature<Point> =>
  ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [x, 2] } })
const line = (): Feature<LineString> =>
  ({ type: 'Feature', properties: { road: 'Main' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] } })
const polygon = (): Feature<Polygon> => ({
  type: 'Feature', properties: { parcel: 7 },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
})

describe('Extended Conversion tools', () => {
  it('exports attributes to XLSX and imports the workbook through the existing Excel To Table tool', async () => {
    const source = testLayer('Survey', [
      { ...point(1, { name: 'Well A & B', depth: 12.5, active: true }), geometry: null as unknown as Geometry },
      { ...point(2, { name: 'بئر', depth: null, active: false }), geometry: null as unknown as Geometry },
    ])
    const result = await runTool(tableToExcelTool, [source], { target: source.id, fileName: 'survey' })
    expect(result.downloads![0].fileName).toBe('survey.xlsx')
    const blob = result.downloads![0].blob
    const archive = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(archive.files)).toEqual(expect.arrayContaining(['xl/workbook.xml', 'xl/worksheets/sheet1.xml']))
    const xml = await archive.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(xml).toContain('Well A &amp; B')
    const file = new File([await blob.arrayBuffer()], 'survey.xlsx')
    const imported = await runTool(excelToTableTool, [], { file })
    expect(imported.layers![0].data.features.map((feature) => feature.properties)).toEqual([
      { name: 'Well A & B', depth: 12.5, active: true },
      { name: 'بئر', depth: null, active: false },
    ])
    await expect(runTool(tableToExcelTool, [source], { target: source.id, fileName: 'bad/name' })).resolves.toBeTruthy()
  })

  it('exports and imports point, line and polygon DXF geometry and attributes', async () => {
    const source = testLayer('Drawing', [point(0.5, { id: 1 }), line(), polygon()] as Feature<Geometry>[])
    const result = await runTool(featuresToDxfTool, [source], { target: source.id })
    expect(result.downloads![0].fileName).toBe('Drawing.dxf')
    const text = await result.downloads![0].blob.text()
    expect(text).toContain('LWPOLYLINE')
    const parsed = parseDxf(text)
    expect(parsed.features.map((feature) => feature.geometry?.type)).toEqual(['Point', 'LineString', 'LineString', 'Polygon'])
    expect(parsed.features[0].properties).toMatchObject({ id: 1, ENTITY: 'POINT' })
    expect(parsed.features.at(-1)?.properties).toMatchObject({ parcel: 7, ENTITY: 'LWPOLYLINE' })
    const imported = await runTool(dxfToFeaturesTool, [], { file: new File([text], 'drawing.dxf') })
    expect(imported.kind).toBe('warning')
    expect(imported.layers![0].data.features).toHaveLength(4)
    expect(imported.layers![0].sourceCrs).toBe('EPSG:4326')
  })

  it('parses legacy POLYLINE vertices and reports malformed or unsupported input clearly', () => {
    const text = [
      '0', 'SECTION', '2', 'ENTITIES', '0', 'POLYLINE', '8', 'roads', '70', '0',
      '0', 'VERTEX', '10', '1', '20', '2', '0', 'VERTEX', '10', '3', '20', '4',
      '0', 'SEQEND', '0', 'ENDSEC', '0', 'EOF',
    ].join('\n')
    const parsed = parseDxf(text)
    expect(parsed.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[1, 2], [3, 4]] })
    const closed = parseDxf([
      '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '70', '1', '90', '4',
      '10', '0', '20', '0', '10', '1', '20', '0', '10', '1', '20', '1', '10', '0', '20', '1',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n'))
    expect(closed.features[0].geometry.type).toBe('Polygon')
    expect(() => parseDxf('0\nSECTION\n2')).toThrow(/incomplete|supported|malformed/i)
    expect(() => parseDxf('0\nSECTION\n2\nENTITIES\n0\nSPLINE\n0\nENDSEC\n0\nEOF')).toThrow(/no supported/)
  })

  it('exports polygon holes as closed CAD boundary polylines and rejects geometry-less exports', async () => {
    const donut: Feature<Polygon> = {
      type: 'Feature', properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
          [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]],
        ],
      },
    }
    const source = testLayer('Donut', [donut] as Feature<Geometry>[])
    const result = await runTool(featuresToDxfTool, [source], { target: source.id })
    const dxf = await result.downloads![0].blob.text()
    expect((dxf.match(/LWPOLYLINE/g) ?? [])).toHaveLength(2)
    const empty = testLayer('Empty', [{ type: 'Feature', properties: {}, geometry: null as unknown as Geometry }])
    await expect(runTool(featuresToDxfTool, [empty], { target: empty.id })).rejects.toThrow(/no supported features/i)
  })
})
