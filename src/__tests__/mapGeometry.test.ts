import { describe, expect, it } from 'vitest'
import { createMapLayer } from '../geo'
import { createSketchFeature, distanceBetween, formatDistance, getPositions, polygonArea, replaceCoordinate } from '../mapGeometry'
import { styleRasterCells } from '../rasterStyle'

describe('measure helpers', () => {
  it('formats metres below 1 km and kilometres above', () => {
    expect(formatDistance(999.4)).toBe('999 m')
    expect(formatDistance(1234)).toBe('1.23 km')
  })

  it('measures great-circle distance', () => {
    // One degree of longitude on the equator is ~111.195 km on the mean-radius sphere.
    expect(distanceBetween([0, 0], [1, 0])).toBeCloseTo(111_195, -1)
    expect(distanceBetween([35, 31], [35, 31])).toBe(0)
  })

  it('measures spherical polygon area and ignores degenerate rings', () => {
    expect(polygonArea([[0, 0], [1, 0]])).toBe(0)
    // A 1°×1° cell at the equator is ~12,364 km².
    const area = polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]])
    expect(area / 1e6).toBeCloseTo(12_364, -1)
    // Winding order does not change the absolute area.
    expect(polygonArea([[0, 1], [1, 1], [1, 0], [0, 0]])).toBeCloseTo(area, 3)
  })
})

describe('vertex helpers', () => {
  const ring = [[[0, 0], [1, 0], [1, 1], [0, 0]]]

  it('lists every position with its coordinate path', () => {
    const positions = getPositions(ring)
    expect(positions).toHaveLength(4)
    expect(positions[2]).toEqual({ coordinate: [1, 1], path: [0, 2] })
  })

  it('replaces one vertex without mutating the original', () => {
    const moved = replaceCoordinate(ring, [0, 1], [5, 5]) as number[][][]
    expect(moved[0][1]).toEqual([5, 5])
    expect(ring[0][1]).toEqual([1, 0])
    expect(moved[0][0]).toBe(ring[0][0])
  })
})

describe('layer helpers', () => {
  it('creates sketch features with empty custom fields and a layer-scoped id', () => {
    const layer = { ...createMapLayer('Sketch', { type: 'FeatureCollection', features: [] }), customFields: ['name', 'type'] }
    const feature = createSketchFeature(layer, { type: 'Point', coordinates: [1, 2] })
    expect(feature.properties).toEqual({ name: '', type: '' })
    expect(String(feature.id).startsWith(`${layer.id}:`)).toBe(true)
  })

  it('styles raster cells with ascending quantile breaks', () => {
    const features = Array.from({ length: 80 }, (_, index) => ({
      type: 'Feature' as const,
      id: index,
      properties: { value: index % 20 },
      geometry: { type: 'Point' as const, coordinates: [index, 0] },
    }))
    const styled = styleRasterCells(createMapLayer('Raster', { type: 'FeatureCollection', features }))
    expect(styled.renderer.type).toBe('graduated')
    if (styled.renderer.type !== 'graduated') return
    expect(styled.renderer.breaks).toEqual([...styled.renderer.breaks].sort((a, b) => a - b))
    expect(new Set(styled.renderer.breaks).size).toBe(styled.renderer.breaks.length)
    expect(styled.renderer.colors).toHaveLength(styled.renderer.breaks.length + 1)
  })

  it('leaves layers without numeric values unchanged', () => {
    const layer = createMapLayer('Empty', { type: 'FeatureCollection', features: [] })
    expect(styleRasterCells(layer)).toBe(layer)
  })
})
