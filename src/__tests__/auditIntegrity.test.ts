import { describe, expect, it } from 'vitest'
import { calculateField } from '../fieldCalculator'
import { projectPosition } from '../crs'
import { buildUniqueRenderer, getUniqueValueClasses } from '../symbology'
import { buildProject, parseProject } from '../project'
import { defaultWorkspaceLayout } from '../workspaceLayout'
import { testLayer, runTool } from '../toolboxes/testUtils'
import { idwTool } from '../toolboxes/spatialAnalyst/interpolation'

describe('audit data-integrity regressions', () => {
  const layer = testLayer('Categories', ['Park', 'Water', 'Road'].map((kind, index) => ({
    type: 'Feature', properties: { kind, value: index + 1 },
    geometry: { type: 'Point', coordinates: [index, index] },
  })))

  it('generates distinct category colours and preserves them through project save/reopen', () => {
    const categorized = { ...layer, renderer: buildUniqueRenderer(layer, 'kind', 'vivid') }
    const before = getUniqueValueClasses(categorized, 'kind', categorized.renderer)
    expect(new Set(before.map((item) => item.color)).size).toBe(3)
    expect(before.every((item) => item.color !== layer.fillColor)).toBe(true)
    const layout = { paper: 'A4' as const, orientation: 'landscape' as const, elements: [] }
    const serialized = JSON.stringify(buildProject({
      name: 'Unique values regression', basemap: 'osm', displayCrs: 'EPSG:4326',
      camera: null, bookmarks: [], layers: [categorized], layout,
      workspaceLayout: defaultWorkspaceLayout(),
    }))
    const restored = parseProject(serialized, layout).layers[0]
    expect(restored.renderer).toEqual(categorized.renderer)
    expect(getUniqueValueClasses(restored, 'kind', restored.renderer)).toEqual(before)
  })

  it('rejects arithmetic overflow atomically instead of saving Infinity as null', () => {
    const before = structuredClone(layer.data)
    expect(() => calculateField(layer.data, 'result', '[value] * 1e308')).toThrow(/finite/i)
    expect(layer.data).toEqual(before)
    expect(() => calculateField(layer.data, 'result', '1e309')).toThrow(/finite/i)
    expect(calculateField(layer.data, 'result', '[value] * 2').features[2].properties?.result).toBe(6)
  })

  it('rejects non-finite coordinates even when no CRS transformation is needed', () => {
    expect(projectPosition('EPSG:4326', 'EPSG:4326', [Infinity, 0])).toBeNull()
    expect(projectPosition('EPSG:4326', 'EPSG:4326', [0, NaN])).toBeNull()
    expect(projectPosition('EPSG:4326', 'EPSG:4326', [0, 0])).toEqual([0, 0])
  })

  it('does not interpolate missing measurements as zero and retains genuine zero', async () => {
    const samples = testLayer('Measurements', [10, null, '', '  ', false, 0].map((value, index) => ({
      type: 'Feature', properties: { value }, geometry: { type: 'Point', coordinates: [index * 0.01, 0] },
    })))
    const result = await runTool(idwTool, [samples], { points: samples.id, valueField: 'value', cellSize: 0.01 })
    expect(result.message).toContain('interpolated 2 points')
    const missing = testLayer('Missing', samples.data.features.slice(1, 5))
    await expect(runTool(idwTool, [missing], { points: missing.id, valueField: 'value' })).rejects.toThrow(/no point features/)
  })
})
