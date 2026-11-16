import { describe, expect, it } from 'vitest'
import { handleImportRequest, needsMainThread } from '../importHandler'

describe('importHandler', () => {
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
