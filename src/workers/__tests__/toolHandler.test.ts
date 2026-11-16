import type { Point } from 'geojson'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testLayer } from '../../toolboxes/testUtils'
import { excelToTableTool } from '../../toolboxes/conversion/excelToTable'
import { importDataTool } from '../../toolboxes/conversion/importData'
import { handleToolRequest } from '../toolHandler'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const pointFeature = (longitude: number, latitude: number, properties: Record<string, unknown> = {}) => ({
  type: 'Feature' as const,
  properties,
  geometry: { type: 'Point', coordinates: [longitude, latitude] } as Point,
})

describe('handleToolRequest', () => {
  it('runs Buffer by id and returns its output layer', async () => {
    const layer = testLayer('points', [pointFeature(35.2, 31.7)])
    const result = await handleToolRequest(
      { toolId: 'buffer', layers: [layer], selectedLayerId: layer.id, parameters: { target: layer.id, distance: 100, units: 'meters', dissolve: 'NONE' } },
      () => undefined,
    )
    expect(result.layers?.[0].geometry).toBe('Polygon')
  })

  it('forwards tool progress', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '31.78', lon: '35.22', display_name: 'Example address', address: {} }],
    }))
    const layer = testLayer('addresses', [{ type: 'Feature', properties: { street: '1 Example Road' }, geometry: null }])
    const seen: { current: number; total: number; message: string }[] = []
    await handleToolRequest(
      { toolId: 'geocode-addresses', layers: [layer], selectedLayerId: layer.id, parameters: { target: layer.id, field: 'street' } },
      (progress) => seen.push(progress),
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toMatchObject({ current: 1, total: 1 })
  })

  it('runs a network tool with fetch stubbed and surfaces HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' }))
    const layer = testLayer('addresses', [{ type: 'Feature', properties: { address: 'Example' }, geometry: null }])
    await expect(handleToolRequest(
      { toolId: 'geocode-addresses', layers: [layer], selectedLayerId: layer.id, parameters: { target: layer.id, field: 'address' } },
      () => undefined,
    )).rejects.toThrow(/429/)
  })

  it('rejects unknown tool ids', async () => {
    await expect(handleToolRequest({ toolId: 'nope', layers: [], selectedLayerId: null, parameters: {} }, () => undefined))
      .rejects.toThrow('Unknown tool: nope.')
  })

  it('worker rejects main-thread-only tools', async () => {
    await expect(handleToolRequest({ toolId: 'excel-to-table', layers: [], selectedLayerId: null, parameters: {} }, () => undefined))
      .rejects.toThrow(/must run on the main thread/)
  })

  it('flags Excel to Table and Import Data as main-thread tools', () => {
    expect(excelToTableTool.runsOnMainThread).toBe(true)
    expect(importDataTool.runsOnMainThread).toBe(true)
  })
})
