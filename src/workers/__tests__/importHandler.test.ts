import { describe, expect, it } from 'vitest'
import { handleImportRequest, needsMainThread } from '../importHandler'

describe('importHandler', () => {
  it('prepares stable feature IDs and geometry in the worker while retaining user IDs', async () => {
    const file = new File([JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'user-id', properties: { name: 'محطة' }, geometry: { type: 'Point', coordinates: [35, 31] } },
      { type: 'Feature', id: 'user-id', properties: {}, geometry: { type: 'Point', coordinates: [36, 32] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [37, 33] } },
    ] })], 'stations.geojson')
    const result = await handleImportRequest({ file })
    if (result.kind !== 'vector') throw new Error('expected vector')
    const prepared = result.layers[0].preparedLayer
    expect(prepared).toMatchObject({ name: 'stations', geometry: 'Point', sourceCrs: 'EPSG:4326', renderer: { type: 'single' } })
    expect(prepared!.data).toBe(result.layers[0].data)
    expect(prepared!.data.features[0].id).toBe('user-id')
    expect(new Set(prepared!.data.features.map((feature) => feature.id)).size).toBe(3)
    expect(prepared!.data.features.every((feature) => feature.id !== undefined)).toBe(true)
    expect(prepared!.data.features[0].properties).toEqual({ name: 'محطة' })
    expect(result.layers[0].fieldCatalog).toEqual({ fields: ['name'], numericFields: [] })
    const rendered = JSON.parse(await result.layers[0].renderBlob!.text())
    expect(rendered.features.map((feature: { id: string | number }) => feature.id)).toEqual(prepared!.data.features.map(feature => feature.id))
    expect(rendered.features[0].properties.__arcweb_feature_id).toBe('user-id')
  })

  it('imports a CSV through the worker handler with its skip warning', async () => {
    const file = new File(['name,lat,lon\na,10,20\nb,11,21\nc,,\n'], 'pts.csv', { type: 'text/csv' })
    const result = await handleImportRequest({ file })
    if (result.kind !== 'vector') throw new Error('expected vector')
    expect(result.layers[0].data.features).toHaveLength(2)
    expect(result.layers[0].warnings).toEqual(['Skipped 1 of 3 rows without valid WGS84 lat/lon values.'])
  })

  it('reports unsupported files with the existing message', async () => {
    await expect(handleImportRequest({ file: new File(['x'], 'notes.txt') })).rejects.toThrow('Unsupported file type: .txt')
  })

  it('needsMainThread is case-insensitive for .kml', () => {
    expect(needsMainThread('A.KML')).toBe(true)
    expect(needsMainThread('a.geojson')).toBe(false)
  })
})
