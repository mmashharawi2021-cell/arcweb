import { describe, expect, it } from 'vitest'
import { createMapLayer } from '../../geo'
import { createRasterGrid, rasterToFeatureCollection } from '../../rasterEngine'
import { buildDemSampler, decodeTerrarium, encodeTerrarium, renderDemTile, tilePixelToLngLat } from '../terrain'

/** A 2×2 DEM covering lon 10–12, lat 40–42 (EPSG:4326, north-up). */
function dem(values = [100, 200, 300, 400]) {
  const grid = createRasterGrid(2, 2, values, { origin: [10, 42], resolution: [1, -1], crs: 'EPSG:4326' })
  return createMapLayer('DEM', rasterToFeatureCollection(grid))
}

describe('Terrarium elevation encoding', () => {
  it.each([0, 1, -1, 8848.86, -430.5, 1234.25])('round-trips %s m within 1/256 m', (elevation) => {
    const [r, g, b] = encodeTerrarium(elevation)
    expect([r, g, b].every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)).toBe(true)
    expect(Math.abs(decodeTerrarium(r, g, b) - elevation)).toBeLessThan(1 / 256)
  })

  it('clamps elevations outside the encodable range', () => {
    expect(decodeTerrarium(...encodeTerrarium(-50_000))).toBe(-32768)
  })
})

describe('DEM sampler from a raster layer', () => {
  it('finds the WGS84 bounds and elevation range', () => {
    const sampler = buildDemSampler(dem())!
    expect(sampler.bounds).toEqual([10, 40, 12, 42])
    expect([sampler.min, sampler.max]).toEqual([100, 400])
  })

  it('samples the right cell for a position (row 0 is the north edge)', () => {
    const sampler = buildDemSampler(dem())!
    expect(sampler.sample(10.5, 41.5)).toBe(100)
    expect(sampler.sample(11.5, 41.5)).toBe(200)
    expect(sampler.sample(10.5, 40.5)).toBe(300)
    expect(sampler.sample(11.5, 40.5)).toBe(400)
    expect(sampler.sample(9, 41)).toBeNull()
  })

  it('returns null for layers that are not rasters', () => {
    const points = createMapLayer('Pts', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { value: 3 }, geometry: { type: 'Point', coordinates: [0, 0] } }] })
    expect(buildDemSampler(points)).toBeNull()
  })
})

describe('terrain tile generation', () => {
  it('maps tile pixels to WGS84 (tile 0/0/0 spans the world)', () => {
    const [lng, lat] = tilePixelToLngLat(0, 0, 0, 0, 0, 2)
    expect(lng).toBeCloseTo(-90)
    expect(lat).toBeGreaterThan(60)
  })

  it('encodes DEM elevations into a tile and floors outside pixels to the DEM minimum', () => {
    const sampler = buildDemSampler(dem())!
    // Zoom-2 tile x=2, y=1 spans lon 0–90° / lat 0–66.5°, so it holds the whole 10–12° × 40–42° DEM.
    const size = 256
    const pixels = renderDemTile(sampler, 2, 2, 1, size)
    expect(pixels).toHaveLength(size * size * 4)
    const elevations = new Set<number>()
    for (let index = 0; index < pixels.length; index += 4) {
      expect(pixels[index + 3]).toBe(255)
      elevations.add(Math.round(decodeTerrarium(pixels[index], pixels[index + 1], pixels[index + 2])))
    }
    expect([...elevations].sort((a, b) => a - b)).toEqual([100, 200, 300, 400])
  })
})
