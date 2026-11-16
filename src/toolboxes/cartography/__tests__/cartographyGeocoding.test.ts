import type { Feature, Point, Polygon } from 'geojson'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testLayer } from '../../testUtils'
import type { ToolboxContext } from '../../types'
import { aggregatePolygonsTool } from '../aggregatePolygons'
import { detectGraphicConflictTool } from '../detectGraphicConflict'
import { gridIndexFeaturesTool } from '../gridIndexFeatures'
import { geocodeAddressesTool } from '../../geocoding/geocodeAddresses'
import { reverseGeocodeTool } from '../../geocoding/reverseGeocode'

const square = (west: number, south: number, size: number, properties: Record<string, unknown> = {}): Feature<Polygon> => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Polygon', coordinates: [[[west, south], [west + size, south], [west + size, south + size], [west, south + size], [west, south]]] },
})
const point = (longitude: number, latitude: number, properties: Record<string, unknown> = {}): Feature<Point> => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates: [longitude, latitude] },
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Cartography tools', () => {
  it('aggregates nearby polygons while retaining their source count', async () => {
    const layer = testLayer('blocks', [square(35, 31, 0.01), square(35.0105, 31, 0.01)])
    const result = await aggregatePolygonsTool.execute(
      { layers: [layer], selectedLayerId: layer.id },
      { target: layer.id, distance: 100 },
    )
    expect(result.layers?.[0].data.features).toHaveLength(1)
    expect(result.layers?.[0].data.features[0].properties?.SOURCE_COUNT).toBe(2)
    expect(result.layers?.[0].data.features[0].geometry?.type).toBe('Polygon')
  })

  it('creates grid-index cells over the template bounds', async () => {
    const layer = testLayer('extent', [square(35, 31, 0.02)])
    const result = await gridIndexFeaturesTool.execute(
      { layers: [layer], selectedLayerId: layer.id },
      { template: layer.id, rows: 2, columns: 3 },
    )
    const cells = result.layers?.[0].data.features ?? []
    expect(cells).toHaveLength(6)
    expect(cells[0].properties).toMatchObject({ GRID_ID: '1-1', ROW: 1, COL: 1, INDEX: 1 })
  })

  it('reports nearby feature pairs as a table', async () => {
    const layer = testLayer('markers', [point(35, 31), point(35.001, 31), point(35.1, 31)])
    const result = await detectGraphicConflictTool.execute(
      { layers: [layer], selectedLayerId: layer.id },
      { target: layer.id, distance: 120 },
    )
    const conflicts = result.layers?.[0].data.features ?? []
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].geometry).toBeNull()
    expect(conflicts[0].properties?.CONFLICT).toBe('Below clearance')
  })
})

describe('Nominatim geocoding tools', () => {
  it('sends only selected address text on execution and emits typed batch progress', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '31.78', lon: '35.22', display_name: 'Example address', address: { city: 'Jerusalem' } }],
    })
    vi.stubGlobal('fetch', fetchMock)
    const layer = testLayer('addresses', [
      { type: 'Feature', properties: { street: '1 Example Road', privateNote: 'must not be sent' }, geometry: null },
    ])
    const progress: { current: number; total: number; message: string }[] = []
    const context = { layers: [layer], selectedLayerId: layer.id, onProgress: (item: (typeof progress)[number]) => progress.push(item) }
    const result = await geocodeAddressesTool.execute(
      context as ToolboxContext,
      { target: layer.id, field: 'street' },
    )
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('q')).toBe('1 Example Road')
    expect(url.searchParams.get('q')).not.toContain('must not be sent')
    expect(result.layers?.[0].data.features[0].geometry).toEqual({ type: 'Point', coordinates: [35.22, 31.78] })
    expect(progress).toEqual([
      { current: 0, total: 1, message: 'Starting geocoding of 1 address records with public Nominatim.' },
      { current: 1, total: 1, message: 'Processed 1 of 1 address records.' },
    ])
    expect(result.message).toContain('Address text was sent to the public Nominatim service')
  })

  it('reverse geocodes points with mocked fetch only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: 'Example place', address: { road: 'Example Road' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const layer = testLayer('places', [point(35.22, 31.78, { ref: 'a' })])
    const result = await reverseGeocodeTool.execute(
      { layers: [layer], selectedLayerId: layer.id },
      { target: layer.id },
    )
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/reverse')
    expect(url.searchParams.get('lat')).toBe('31.78')
    expect(url.searchParams.get('lon')).toBe('35.22')
    expect(result.layers?.[0].data.features[0].properties).toMatchObject({ ref: 'a', display_name: 'Example place' })
  })

  it('surfaces HTTP failures instead of returning an empty layer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' }))
    const layer = testLayer('addresses', [
      { type: 'Feature', properties: { address: 'Example' }, geometry: null },
    ])
    await expect(geocodeAddressesTool.execute(
      { layers: [layer], selectedLayerId: layer.id },
      { target: layer.id, field: 'address' },
    )).rejects.toThrow('Nominatim returned HTTP 429 Too Many Requests')
  })
})
