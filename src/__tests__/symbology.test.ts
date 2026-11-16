import { describe, expect, it } from 'vitest'
import { createMapLayer } from '../geo'
import { buildProject, parseProject } from '../project'
import { buildGraduatedRenderer, buildUniqueRenderer, calculateClassBreaks, getGraduatedClasses, getGraduatedClassCounts, getUniqueValueClasses, labelTextExpression } from '../symbology'
import { defaultWorkspaceLayout } from '../workspaceLayout'
import type { LayoutDocument } from '../layout/layoutStore'

const collection = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature' as const, id: 'a', properties: { kind: 'Park', value: 1, NAME: 'حديقة', POP: 12 }, geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] } },
    { type: 'Feature' as const, id: 'b', properties: { kind: 'Park', value: 2, NAME: 'حديقة ثانية', POP: 20 }, geometry: { type: 'Point' as const, coordinates: [1, 1] as [number, number] } },
    { type: 'Feature' as const, id: 'c', properties: { kind: 'Water', value: 3, NAME: 'ماء', POP: 30 }, geometry: { type: 'Point' as const, coordinates: [2, 2] as [number, number] } },
    { type: 'Feature' as const, id: 'd', properties: { kind: 'Water', value: 4, NAME: 'بحيرة', POP: 40 }, geometry: { type: 'Point' as const, coordinates: [3, 3] as [number, number] } },
  ],
}

describe('shared symbology classification', () => {
  it('calculates equal-interval, quantile, and Jenks breaks', () => {
    expect(calculateClassBreaks([0, 10], 'equal-interval', 5)).toEqual([2, 4, 6, 8])
    expect(calculateClassBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9], 'quantile', 3)).toEqual([3.6666666666666665, 6.333333333333333])
    expect(calculateClassBreaks([1, 2, 3, 100, 101, 102], 'natural-breaks', 3)).toEqual([100, 102])
  })

  it('rejects invalid class counts and fields without enough distinct values', () => {
    expect(() => calculateClassBreaks([1, 2], 'quantile', 9)).toThrow('Class count')
    expect(() => calculateClassBreaks([5, 5, Number.NaN], 'equal-interval', 3)).toThrow('two distinct numeric values')
  })

  it('generates categorized values and preserves overrides when adding values', () => {
    const layer = createMapLayer('Places', collection)
    const initial = buildUniqueRenderer(layer, 'kind', 'pastel')
    const overridden = { ...initial, colors: { ...initial.colors, Park: '#123456' }, overrides: ['Park'] }
    const expanded = buildUniqueRenderer(layer, 'kind', 'urban', overridden)

    expect(getUniqueValueClasses(layer, 'kind', expanded).map(({ label, count, color }) => ({ label, count, color }))).toEqual([
      { label: 'Park', count: 2, color: '#123456' },
      { label: 'Water', count: 2, color: expect.any(String) },
    ])
  })

  it('builds graduated legend labels and counts from current features', () => {
    const layer = createMapLayer('Places', collection)
    const renderer = buildGraduatedRenderer(layer, 'value', 'equal-interval', 3, 'viridis')
    expect(renderer.breaks).toEqual([2, 3])
    expect(renderer.classCount).toBe(3)
    expect(getGraduatedClassCounts(layer, renderer)).toEqual([1, 1, 2])
    expect(getGraduatedClasses(renderer).map((item) => item.label)).toEqual(['< 2', '2 – 3', '≥ 3'])
  })

  it('compiles field templates into MapLibre expressions without losing Arabic literals', () => {
    expect(labelTextExpression('{NAME} ({POP})', '')).toEqual([
      'concat',
      ['to-string', ['coalesce', ['get', 'NAME'], '']],
      ' (',
      ['to-string', ['coalesce', ['get', 'POP'], '']],
      ')',
    ])
    expect(labelTextExpression('', 'NAME')).toEqual(['to-string', ['coalesce', ['get', 'NAME'], '']])
  })
})

describe('symbology project persistence', () => {
  const layout: LayoutDocument = { paper: 'A4', orientation: 'landscape', elements: [] }

  it('round-trips renderer classes, editable labels, symbol details, and label styling', () => {
    const layer = createMapLayer('Places', collection)
    layer.strokeDash = 'dotted'
    layer.fillOpacity = 0.62
    layer.pointShape = 'diamond'
    layer.labelField = 'NAME'
    layer.labelStyle = {
      enabled: true,
      expression: '{NAME} ({POP})',
      fontSize: 14,
      color: '#f0f0f0',
      haloColor: '#171a20',
      haloWidth: 2.2,
      placement: 'point',
      offset: 0.8,
    }
    layer.renderer = {
      type: 'graduated',
      field: 'value',
      method: 'equal-interval',
      breaks: [2, 3],
      colors: ['#440154', '#21918c', '#fde725'],
      ramp: 'viridis',
      labels: ['Small', 'Medium', 'Large'],
      classCount: 3,
    }
    const project = buildProject({
      name: 'Symbology round trip',
      basemap: 'osm',
      displayCrs: 'EPSG:4326',
      camera: null,
      bookmarks: [],
      layers: [layer],
      layout,
      workspaceLayout: defaultWorkspaceLayout(),
    })
    const restored = parseProject(JSON.stringify(project), layout).layers[0]

    expect(restored).toMatchObject({
      strokeDash: 'dotted',
      fillOpacity: 0.62,
      pointShape: 'diamond',
      labelField: 'NAME',
      labelStyle: layer.labelStyle,
      renderer: layer.renderer,
    })
  })

  it('applies safe defaults when opening legacy layers without symbology extensions', () => {
    const layer = createMapLayer('Legacy', collection)
    const project = buildProject({
      name: 'Legacy',
      basemap: 'osm',
      displayCrs: 'EPSG:4326',
      camera: null,
      bookmarks: [],
      layers: [layer],
      layout,
      workspaceLayout: defaultWorkspaceLayout(),
    })
    const legacy = { ...project, layers: [{ ...layer, strokeDash: undefined, fillOpacity: undefined, pointShape: undefined, labelStyle: undefined }] }
    const restored = parseProject(JSON.stringify(legacy), layout).layers[0]

    expect(restored.strokeDash).toBe('solid')
    expect(restored.fillOpacity).toBe(1)
    expect(restored.pointShape).toBe('circle')
    expect(restored.labelStyle.enabled).toBe(false)
  })

  it('round-trips categorized color ramps and explicit class overrides', () => {
    const layer = createMapLayer('Places', collection)
    const generated = buildUniqueRenderer(layer, 'kind', 'earth')
    layer.renderer = { ...generated, colors: { ...generated.colors, Park: '#abcdef' }, overrides: ['Park'] }
    const project = buildProject({
      name: 'Unique values',
      basemap: 'osm',
      displayCrs: 'EPSG:4326',
      camera: null,
      bookmarks: [],
      layers: [layer],
      layout,
      workspaceLayout: defaultWorkspaceLayout(),
    })

    expect(parseProject(JSON.stringify(project), layout).layers[0].renderer).toEqual(layer.renderer)
  })
})
