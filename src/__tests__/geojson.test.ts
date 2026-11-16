import { describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import { tableRow, withoutGeometry } from '../geojson'

describe('null-geometry rows', () => {
  it('tableRow builds a feature with null geometry', () => {
    expect(tableRow({ a: 1 })).toEqual({ type: 'Feature', properties: { a: 1 }, geometry: null })
  })

  it('withoutGeometry keeps id and properties and nulls the geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      id: 'f1',
      properties: { name: 'kept' },
      geometry: { type: 'Point', coordinates: [1, 2] },
    }
    const row = withoutGeometry(feature)
    expect(row.id).toBe('f1')
    expect(row.properties).toEqual({ name: 'kept' })
    expect(row.geometry).toBeNull()
  })
})
