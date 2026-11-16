import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import Papa from 'papaparse'
import shp from 'shpjs'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import booleanValid from '@turf/boolean-valid'
import kinks from '@turf/kinks'
import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from 'geojson'
import { runTool, testLayer } from '../../testUtils'
import { conversionTools } from '../index'
import { distanceMeters } from '../_utils'

const tool = (id: string) => {
  const found = conversionTools.find((item) => item.id === id)
  if (!found) throw new Error(`Missing tool ${id}`)
  return found
}

const feature = <G extends Geometry>(geometry: G, properties: Record<string, unknown> = {}): Feature<G> =>
  ({ type: 'Feature', properties, geometry })

const square = (x: number, y: number, size = 0.01): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
})

const donut: Polygon = {
  type: 'Polygon',
  coordinates: [
    [[35, 31], [35.02, 31], [35.02, 31.02], [35, 31.02], [35, 31]],
    [[35.005, 31.005], [35.005, 31.015], [35.015, 31.015], [35.015, 31.005], [35.005, 31.005]],
  ],
}

const points = () => testLayer('Wells', [
  feature<Point>({ type: 'Point', coordinates: [35.2, 31.7] }, { name: 'Well A & B', depth: 12.5, active: true }),
  feature<Point>({ type: 'Point', coordinates: [35.21, 31.71] }, { name: 'بئر', depth: 30, active: false }),
])

const polygons = () => testLayer('Parcels', [
  feature(donut, { name: 'Donut', code: 1 }),
  feature<Geometry>({ type: 'MultiPolygon', coordinates: [square(35.1, 31.1).coordinates, square(35.2, 31.1).coordinates] }, { name: 'Pair', code: 2 }),
])

const text = (blob: Blob) => blob.text()

describe('conversion toolbox registry', () => {
  it('has unique ids, the Conversion category and valid subcategories, sorted by toolset then name', () => {
    const ids = conversionTools.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining([
      'import-data', 'export-data', 'features-to-geojson', 'features-to-csv', 'features-to-kml', 'features-to-shapefile',
      'xy-table-to-point', 'excel-to-table', 'densify', 'generalize', 'polygon-neighbors', 'conversion-create-thiessen-polygons',
      'dxf-to-features', 'features-to-dxf', 'table-to-excel',
    ]))
    const order = ['From/To Files', 'Cartography & Topology']
    for (const item of conversionTools) {
      expect(item.category).toBe('Conversion')
      expect(order).toContain(item.subcategory)
    }
    const keys = conversionTools.map((item) => `${order.indexOf(item.subcategory ?? '')}|${item.name}`)
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)))
  })
})

describe('From/To Files', () => {
  it('Features To GeoJSON round-trips features and rounds coordinates', async () => {
    const layer = testLayer('Precise', [feature<Point>({ type: 'Point', coordinates: [35.123456789, 31.987654321] }, { a: 1 })])
    const result = await runTool(tool('features-to-geojson'), [layer], { target: layer.id, precision: 4 })
    const download = result.downloads![0]
    expect(download.fileName).toBe('Precise.geojson')
    const parsed = JSON.parse(await text(download.blob)) as FeatureCollection<Point>
    expect(parsed.type).toBe('FeatureCollection')
    expect(parsed.features).toHaveLength(1)
    expect(parsed.features[0].geometry.coordinates).toEqual([35.1235, 31.9877])
    expect(parsed.features[0].properties).toEqual({ a: 1 })
    expect(parsed.features[0].id).toBeUndefined()
  })

  it('Features To CSV writes WKT or X/Y columns', async () => {
    const layer = polygons()
    const wkt = await runTool(tool('features-to-csv'), [layer], { target: layer.id, geometry: 'wkt' })
    const parsed = Papa.parse<Record<string, string>>((await text(wkt.downloads![0].blob)).replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
    expect(parsed.meta.fields).toEqual(['name', 'code', 'WKT'])
    expect(parsed.data).toHaveLength(2)
    expect(parsed.data[0].WKT).toMatch(/^POLYGON \(\(35 31, 35\.02 31, .*\), \(35\.005 31\.005, /)
    expect(parsed.data[1].WKT).toMatch(/^MULTIPOLYGON \(\(\(/)

    const pts = points()
    const xy = await runTool(tool('features-to-csv'), [pts], { target: pts.id, geometry: 'xy' })
    const rows = Papa.parse<Record<string, string>>((await text(xy.downloads![0].blob)).replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
    expect(rows.meta.fields).toEqual(['name', 'depth', 'active', 'X', 'Y'])
    expect(Number(rows.data[0].X)).toBeCloseTo(35.2)
    expect(Number(rows.data[0].Y)).toBeCloseTo(31.7)
    expect(rows.data[1].name).toBe('بئر')
  })

  it('Features To KML writes KML 2.2 with ExtendedData, holes and multi-geometries', async () => {
    const layer = polygons()
    const pts = points()
    const line = testLayer('Roads', [feature<Geometry>({ type: 'MultiLineString', coordinates: [[[35, 31], [35.1, 31.1]], [[35.2, 31.2], [35.3, 31.3]]] }, { name: '<Main>' })])
    const kml = await text((await runTool(tool('features-to-kml'), [layer], { target: layer.id, nameField: 'name' })).downloads![0].blob)
    expect(kml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<kml xmlns="http:\/\/www\.opengis\.net\/kml\/2\.2">/)
    expect(kml.match(/<Placemark>/g)).toHaveLength(2)
    expect(kml).toContain('<innerBoundaryIs><LinearRing><coordinates>35.005,31.005 ')
    expect(kml).toMatch(/<Placemark><name>Pair<\/name>.*<MultiGeometry><Polygon>.*<\/Polygon><Polygon>.*<\/Polygon><\/MultiGeometry><\/Placemark>/)
    expect(kml).toContain('<Data name="code"><value>1</value></Data>')
    expect(kml.match(/<Placemark>/g)!.length).toBe(kml.match(/<\/Placemark>/g)!.length)

    const pointKml = await text((await runTool(tool('features-to-kml'), [pts], { target: pts.id })).downloads![0].blob)
    expect(pointKml).toContain('<name>Well A &amp; B</name>')
    expect(pointKml).toContain('<Point><coordinates>35.2,31.7</coordinates></Point>')
    expect(pointKml).toContain('<Data name="name"><value>بئر</value></Data>')

    const lineKml = await text((await runTool(tool('features-to-kml'), [line], { target: line.id })).downloads![0].blob)
    expect(lineKml).toContain('<name>&lt;Main&gt;</name>')
    expect(lineKml.match(/<LineString>/g)).toHaveLength(2)
  })

  it('Features To Shapefile ZIP contains .shp/.shx/.dbf/.prj and reads back with attributes', async () => {
    const layer = polygons()
    const result = await runTool(tool('features-to-shapefile'), [layer], { target: layer.id })
    const download = result.downloads![0]
    expect(download.fileName).toBe('Parcels.zip')
    const buffer = await download.blob.arrayBuffer()
    const zip = await JSZip.loadAsync(buffer)
    expect(Object.keys(zip.files).sort()).toEqual(['Parcels.cpg', 'Parcels.dbf', 'Parcels.prj', 'Parcels.shp', 'Parcels.shx'])
    expect(await zip.file('Parcels.prj')!.async('string')).toContain('GCS_WGS_1984')
    const back = await shp(buffer) as FeatureCollection
    expect(back.features).toHaveLength(2)
    expect(back.features[0].properties).toMatchObject({ name: 'Donut', code: 1 })
    expect(back.features[0].geometry.type).toBe('Polygon')
    expect((back.features[0].geometry as Polygon).coordinates).toHaveLength(2)
    expect(back.features[1].geometry.type).toBe('MultiPolygon')
  })

  it('Features To Shapefile ZIP keeps UTF-8 text, splits mixed geometry and projects to UTM', async () => {
    const pts = points()
    const utm = await runTool(tool('features-to-shapefile'), [pts], { target: pts.id, crs: 'EPSG:32636' })
    const zip = await JSZip.loadAsync(await utm.downloads![0].blob.arrayBuffer())
    expect(await zip.file('Wells.prj')!.async('string')).toContain('WGS_1984_UTM_Zone_36N')
    const shpBytes = new DataView(await zip.file('Wells.shp')!.async('arraybuffer'))
    const x = shpBytes.getFloat64(100 + 12, true)
    const y = shpBytes.getFloat64(100 + 20, true)
    expect(x).toBeGreaterThan(700000)
    expect(x).toBeLessThan(730000)
    expect(y).toBeGreaterThan(3500000)
    // shpjs reprojects back to WGS 84 using the .prj
    const back = await shp(await utm.downloads![0].blob.arrayBuffer()) as FeatureCollection<Point>
    expect(back.features[0].geometry.coordinates[0]).toBeCloseTo(35.2, 5)
    expect(back.features[0].geometry.coordinates[1]).toBeCloseTo(31.7, 5)
    expect(back.features[1].properties?.name).toBe('بئر')
    expect(back.features[0].properties?.depth).toBe(12.5)

    const mixed = testLayer('Mixed', [
      feature<Point>({ type: 'Point', coordinates: [35, 31] }, { id: 1 }),
      feature<LineString>({ type: 'LineString', coordinates: [[35, 31], [35.1, 31.1]] }, { id: 2 }),
    ])
    const split = await runTool(tool('features-to-shapefile'), [mixed], { target: mixed.id })
    expect(split.kind).toBe('warning')
    const files = Object.keys((await JSZip.loadAsync(await split.downloads![0].blob.arrayBuffer())).files)
    expect(files).toEqual(expect.arrayContaining(['Mixed_point.shp', 'Mixed_line.shp', 'Mixed_line.dbf', 'Mixed_point.prj']))
  })

  it('Export Data dispatches to each format', async () => {
    const layer = points()
    for (const [format, extension] of [['geojson', '.geojson'], ['shapefile', '.zip'], ['kml', '.kml'], ['csv', '.csv'], ['csv-xy', '_xy.csv']]) {
      const result = await runTool(tool('export-data'), [layer], { target: layer.id, format })
      expect(result.downloads![0].fileName).toBe(`Wells${extension}`)
      expect(result.downloads![0].blob.size).toBeGreaterThan(50)
    }
    await expect(runTool(tool('export-data'), [layer], { target: layer.id, format: 'dxf' })).rejects.toThrow(/Unsupported/)
  })

  it('Import Data reads GeoJSON and lat/lon CSV files', async () => {
    const geojson = JSON.stringify({ type: 'FeatureCollection', features: [feature(square(35, 31), { n: 1 })] })
    const fromJson = await runTool(tool('import-data'), [], { file: new File([geojson], 'parcels.geojson') })
    expect(fromJson.layers).toHaveLength(1)
    expect(fromJson.layers![0].name).toBe('parcels')
    expect(fromJson.layers![0].geometry).toBe('Polygon')
    const fromCsv = await runTool(tool('import-data'), [], { file: new File(['name,lat,lon\nA,31.5,35.1\nB,31.6,35.2\n'], 'sites.csv') })
    expect(fromCsv.layers![0].data.features).toHaveLength(2)
    expect((fromCsv.layers![0].data.features[1].geometry as Point).coordinates).toEqual([35.2, 31.6])
  })

  it('XY Table To Point builds points from a table layer and from a projected CSV', async () => {
    const table = testLayer('Stations', {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'S1', Longitude: 35.1, Latitude: 31.2 }, geometry: null as unknown as Geometry },
        { type: 'Feature', properties: { name: 'S2', Longitude: '35.3', Latitude: '31.4' }, geometry: null as unknown as Geometry },
        { type: 'Feature', properties: { name: 'bad', Longitude: '', Latitude: 31 }, geometry: null as unknown as Geometry },
      ],
    })
    const fromLayer = await runTool(tool('xy-table-to-point'), [table], { table: table.id })
    const layer = fromLayer.layers![0]
    expect(fromLayer.kind).toBe('warning')
    expect(layer.geometry).toBe('Point')
    expect(layer.data.features).toHaveLength(2)
    expect((layer.data.features[1].geometry as Point).coordinates).toEqual([35.3, 31.4])
    expect(layer.data.features[0].properties?.name).toBe('S1')

    // UTM 36N coordinates of (35.2, 31.7) are about E 708,700 / N 3,509,800.
    const csv = 'id,Easting,Northing,elev\n1,708700,3509800,800\n2,709700,3510800,810\n'
    const fromFile = await runTool(tool('xy-table-to-point'), [], {
      file: new File([csv], 'survey.csv'), xField: 'easting', yField: 'NORTHING', zField: 'elev', crs: 'EPSG:32636',
    })
    const out = fromFile.layers![0]
    expect(out.sourceCrs).toBe('EPSG:32636')
    expect(out.data.features).toHaveLength(2)
    const [lon, lat, z] = (out.data.features[0].geometry as Point).coordinates
    expect(lon).toBeCloseTo(35.2, 1)
    expect(lat).toBeCloseTo(31.7, 1)
    expect(z).toBe(800)

    await expect(runTool(tool('xy-table-to-point'), [], { file: new File([csv], 'survey.csv') })).rejects.toThrow(/projected coordinate system/)
    await expect(runTool(tool('xy-table-to-point'), [], { file: new File(['a,b\n1,2\n'], 't.csv') })).rejects.toThrow(/X field/)
  })

  it('Excel/CSV To Table imports CSV and XLSX files as geometry-less tables', async () => {
    const csv = await runTool(tool('excel-to-table'), [], { file: new File(['﻿name,pop,,name\nGaza,590000,x,dup\nJenin,49000,,\n'], 'cities.csv') })
    const table = csv.layers![0]
    expect(table.name).toBe('cities')
    expect(table.geometry).toBe('Unknown')
    expect(table.customFields).toEqual(['name', 'pop', 'Field3', 'name_1'])
    expect(table.data.features).toHaveLength(2)
    expect(table.data.features[0].geometry).toBeNull()
    expect(table.data.features[0].properties).toEqual({ name: 'Gaza', pop: 590000, Field3: 'x', name_1: 'dup' })
    expect(table.data.features[1].properties?.Field3).toBeNull()

    const xlsx = await runTool(tool('excel-to-table'), [], { file: new File([await buildXlsx()], 'book.xlsx'), sheet: 'Data' })
    const sheet = xlsx.layers![0]
    expect(sheet.name).toBe('book Data')
    expect(sheet.data.features).toHaveLength(2)
    expect(sheet.data.features[0].properties).toEqual({ City: 'Nablus', Population: 156000 })
    await expect(runTool(tool('excel-to-table'), [], { file: new File([await buildXlsx()], 'book.xlsx'), sheet: 'Nope' })).rejects.toThrow(/not found/)
  })
})

describe('Cartography & Topology', () => {
  it('Densify inserts vertices so no segment exceeds the maximum length', async () => {
    const line = feature<LineString>({ type: 'LineString', coordinates: [[35, 31], [35.01, 31]] }, { id: 'L' })
    const layer = testLayer('Line', [line, feature(square(35, 31), { id: 'P' }), feature<Point>({ type: 'Point', coordinates: [35, 31] })])
    const segmentLength = distanceMeters([35, 31], [35.01, 31]) // ≈ 953 m
    const result = await runTool(tool('densify'), [layer], { target: layer.id, distance: 100, method: 'geodesic' })
    const [denseLine, densePolygon, densePoint] = result.layers![0].data.features
    const coords = (denseLine.geometry as LineString).coordinates
    expect(coords).toHaveLength(Math.ceil(segmentLength / 100) + 1)
    expect(coords[0]).toEqual([35, 31])
    expect(coords[coords.length - 1]).toEqual([35.01, 31])
    for (let i = 1; i < coords.length; i += 1) expect(distanceMeters(coords[i - 1], coords[i])).toBeLessThanOrEqual(100)
    const ring = (densePolygon.geometry as Polygon).coordinates[0]
    expect(ring.length).toBeGreaterThan(40)
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(booleanValid(densePolygon)).toBe(true)
    expect(densePoint.geometry).toEqual({ type: 'Point', coordinates: [35, 31] })
    expect(denseLine.properties).toEqual({ id: 'L' })

    const linear = await runTool(tool('densify'), [layer], { target: layer.id, distance: 500, method: 'linear' })
    expect((linear.layers![0].data.features[0].geometry as LineString).coordinates).toHaveLength(3)
    expect((linear.layers![0].data.features[0].geometry as LineString).coordinates[1][0]).toBeCloseTo(35.005, 9)
  })

  it('Generalize removes vertices within tolerance and keeps polygons valid', async () => {
    // A zig-zag line with ±~5 m wiggles around a 1 km straight line.
    const wiggly = Array.from({ length: 101 }, (_, i) => [35 + i * 0.0001, 31 + (i % 2 ? 0.00004 : -0.00004)])
    // A polygon with many near-collinear vertices on its edges.
    const edge = Array.from({ length: 50 }, (_, i) => [35 + i * 0.0002, 31 + (i % 2) * 0.00001])
    const ring = [...edge, [35.01, 31.01], [35, 31.01], edge[0]]
    const layer = testLayer('Shapes', [feature<LineString>({ type: 'LineString', coordinates: wiggly }), feature<Polygon>({ type: 'Polygon', coordinates: [ring] }), feature(donut)])
    const result = await runTool(tool('generalize'), [layer], { target: layer.id, tolerance: 20 })
    const [line, polygon, holed] = result.layers![0].data.features
    expect((line.geometry as LineString).coordinates).toHaveLength(2)
    expect((polygon.geometry as Polygon).coordinates[0].length).toBeLessThan(10)
    expect(booleanValid(polygon)).toBe(true)
    expect(kinks(polygon as Feature<Polygon>).features).toHaveLength(0)
    expect((holed.geometry as Polygon).coordinates).toHaveLength(2)
    expect(result.message).toMatch(/fewer/)

    const tight = await runTool(tool('generalize'), [layer], { target: layer.id, tolerance: 1 })
    expect((tight.layers![0].data.features[0].geometry as LineString).coordinates).toHaveLength(101)
  })

  it('Polygon Neighbors reports shared lengths and node-only touches', async () => {
    // 2×2 grid of 0.01° squares plus an isolated square.
    const layer = testLayer('Grid', [
      feature(square(35, 31), { name: 'SW' }),
      feature(square(35.01, 31), { name: 'SE' }),
      feature(square(35, 31.01), { name: 'NW' }),
      feature(square(35.01, 31.01), { name: 'NE' }),
      feature(square(35.5, 31.5), { name: 'Lonely' }),
    ])
    const result = await runTool(tool('polygon-neighbors'), [layer], { target: layer.id, reportField: 'name' })
    const rows = result.layers![0].data.features.map((item) => item.properties as Record<string, string | number>)
    expect(rows).toHaveLength(12) // 6 pairs, both directions
    const find = (a: string, b: string) => rows.find((row) => row.src_name === a && row.nbr_name === b)
    const northSouth = distanceMeters([35, 31], [35, 31.01])
    const eastWestAt31 = distanceMeters([35, 31.01], [35.01, 31.01])
    expect(find('SW', 'SE')!.LENGTH).toBeCloseTo(northSouth, -1)
    expect(find('SW', 'NW')!.LENGTH).toBeCloseTo(eastWestAt31, -1)
    expect(find('SW', 'SE')!.NODE_COUNT).toBe(0)
    expect(find('SW', 'NE')).toMatchObject({ LENGTH: 0, NODE_COUNT: 1 })
    expect(find('NE', 'SW')).toMatchObject({ LENGTH: 0, NODE_COUNT: 1 })
    expect(find('SE', 'NW')).toMatchObject({ LENGTH: 0, NODE_COUNT: 1 })
    expect(rows.some((row) => row.src_name === 'Lonely' || row.nbr_name === 'Lonely')).toBe(false)
    expect(result.message).toMatch(/1 polygon\(s\) have no neighbours/)

    // A partially shared edge whose vertices do not coincide.
    const offset = testLayer('Offset', [
      feature(square(35, 31, 0.02)),
      feature<Polygon>({ type: 'Polygon', coordinates: [[[35.02, 31.005], [35.03, 31.005], [35.03, 31.03], [35.02, 31.03], [35.02, 31.005]]] }),
    ])
    const once = await runTool(tool('polygon-neighbors'), [offset], { target: offset.id, both: 'once' })
    const row = once.layers![0].data.features[0].properties as Record<string, number>
    expect(once.layers![0].data.features).toHaveLength(1)
    expect(row).toMatchObject({ src_OBJECTID: 1, nbr_OBJECTID: 2, NODE_COUNT: 0 })
    expect(row.LENGTH).toBeCloseTo(distanceMeters([35.02, 31.005], [35.02, 31.02]), -1)
  })

  it('Create Thiessen Polygons makes one valid cell per point containing that point', async () => {
    const sites = [[35.2, 31.7], [35.25, 31.72], [35.22, 31.78], [35.18, 31.75], [35.2, 31.7]]
    const layer = testLayer('Clinics', sites.map((coordinates, i) => feature<Point>({ type: 'Point', coordinates }, { clinic: `C${i}` })))
    const result = await runTool(tool('conversion-create-thiessen-polygons'), [layer], { target: layer.id })
    const cells = result.layers![0].data.features as Feature<Polygon>[]
    expect(result.kind).toBe('warning') // one coincident point merged
    expect(cells).toHaveLength(4)
    cells.forEach((cell, i) => {
      expect(cell.properties).toMatchObject({ clinic: `C${i}`, Input_FID: i + 1 })
      expect(booleanValid(cell)).toBe(true)
      expect(booleanPointInPolygon(sites[i], cell)).toBe(true)
      sites.slice(0, 4).forEach((other, j) => { if (j !== i) expect(booleanPointInPolygon(other, cell)).toBe(false) })
    })
    const fidOnly = await runTool(tool('conversion-create-thiessen-polygons'), [layer], { target: layer.id, fields: 'fid' })
    expect(fidOnly.layers![0].data.features[0].properties).toEqual({ Input_FID: 1 })
  })
})

/** Minimal two-sheet .xlsx (inline strings) built with JSZip. */
async function buildXlsx(): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Notes" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>')
  const cell = (ref: string, value: string | number) => typeof value === 'number'
    ? `<c r="${ref}"><v>${value}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
  const sheet = (rows: (string | number)[][]) => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cell(`${String.fromCharCode(65 + c)}${r + 1}`, value)).join('')}</row>`).join('')}</sheetData></worksheet>`
  zip.file('xl/worksheets/sheet1.xml', sheet([['ignore me']]))
  zip.file('xl/worksheets/sheet2.xml', sheet([['City', 'Population'], ['Nablus', 156000], ['Hebron', 215000]]))
  return zip.generateAsync({ type: 'arraybuffer' })
}
