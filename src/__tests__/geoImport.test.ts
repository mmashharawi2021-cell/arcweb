import { describe, expect, it } from 'vitest'
import { readGeospatialFile } from '../geo'

const read = (name: string, body: string) => readGeospatialFile(new File([body], name))
const point = (x: number, y: number) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, y] } })

describe('data import warnings and errors (audit regressions)', () => {
  it('warns how many CSV rows were skipped for missing or invalid coordinates', async () => {
    const [layer] = await read('stations.csv', 'name,lat,lon\nA,31.5,34.4\nB,,\nC,abc,34\nD,95,34\nE,31.6,34.5\n')
    expect(layer.data.features).toHaveLength(2)
    expect(layer.warnings).toEqual(['Skipped 3 of 5 rows without valid WGS84 lat/lon values.'])
  })

  it('imports a clean CSV without warnings, including a UTF-8 BOM and Arabic headers', async () => {
    const [layer] = await read('places.csv', '﻿الاسم,lat,lon\nغزة,31.5,34.46\n')
    expect(layer.data.features[0].properties?.['الاسم']).toBe('غزة')
    expect(layer.warnings).toEqual([])
  })

  it('skips invalid entries in a GeoJSON feature list instead of rejecting the file', async () => {
    const [layer] = await read('mixed.geojson', JSON.stringify({ type: 'FeatureCollection', features: [null, 'x', point(1, 2)] }))
    expect(layer.data.features).toHaveLength(1)
    expect(layer.warnings).toEqual(['Skipped 2 invalid entries in the feature list.'])
  })

  it('reports an empty CSV plainly instead of a parser delimiter message', async () => {
    await expect(read('empty.csv', '﻿  \n')).rejects.toThrow('The CSV file is empty.')
  })

  it('explains a ZIP that is not a shapefile instead of an internal library code', async () => {
    await expect(read('fake.zip', 'not a zip')).rejects.toThrow(/^Could not read the ZIP as a shapefile/)
  })

  it('explains invalid JSON in plain words', async () => {
    await expect(read('broken.geojson', 'hello')).rejects.toThrow(/^The file is not valid JSON/)
  })

  it('names an unsupported coordinate system instead of reporting "unknown error"', async () => {
    const body = JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:99999' } }, features: [point(650000, 3490000)] })
    await expect(read('far.geojson', body)).rejects.toThrow('Unsupported coordinate reference system EPSG:99999')
  })

  it('still reprojects a supported projected system to WGS 84', async () => {
    const body = JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32636' } }, features: [point(650000, 3490000)] })
    const [layer] = await read('utm.geojson', body)
    expect(layer.sourceCrs).toBe('EPSG:32636')
    const [lng, lat] = (layer.data.features[0].geometry as { coordinates: number[] }).coordinates
    expect(lng).toBeGreaterThan(34)
    expect(lng).toBeLessThan(35)
    expect(lat).toBeGreaterThan(31)
    expect(lat).toBeLessThan(32)
  })
})
