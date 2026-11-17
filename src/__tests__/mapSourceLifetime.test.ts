import { describe, expect, it } from 'vitest'
import type { Map as MapLibreMap, LayerSpecification } from 'maplibre-gl'
import { createMapLayer } from '../geo'
import { syncMapLayers } from '../mapRendering'

describe('large map source lifetime', () => {
  it('keeps URLs through queued loads, releases replaced/removed sources, and cleans up on map disposal', async () => {
    const styleLayers = new Map<string, LayerSpecification>()
    const sources = new Map<string, { data: unknown; setData: (data: unknown) => void }>()
    const events = new Map<string, (() => void)[]>()
    const stub = {
      isStyleLoaded: () => true,
      once: (event: string, callback: () => void) => { events.set(event, [...(events.get(event) ?? []), callback]) },
      getStyle: () => ({ layers: [...styleLayers.values()], sources: Object.fromEntries(sources) }),
      getLayer: (id: string) => styleLayers.get(id),
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, specification: { data: unknown }) => {
        const source = { data: specification.data, setData: (data: unknown) => { source.data = data } }
        sources.set(id, source)
      },
      removeSource: (id: string) => sources.delete(id),
      addLayer: (layer: LayerSpecification) => styleLayers.set(layer.id, layer),
      removeLayer: (id: string) => styleLayers.delete(id),
      hasImage: () => true,
      setLayoutProperty: () => undefined, setPaintProperty: () => undefined,
      setFilter: () => undefined, moveLayer: () => undefined,
    }
    // Only MapLibre's source/style/event boundary is faked; payloads and Blob fetches are real.
    const map = stub as unknown as MapLibreMap
    const layer = createMapLayer('Stations', { type: 'FeatureCollection', features: Array.from({ length: 10_000 }, (_, id) => ({
      type: 'Feature', id, properties: {}, geometry: { type: 'Point', coordinates: [35, 31] },
    })) })
    const fire = (event: string) => { const listeners = events.get(event) ?? []; events.delete(event); listeners.forEach((callback) => callback()) }
    syncMapLayers(map, [layer])
    const first = [...sources.values()][0].data as string
    const changed = { ...layer, data: { ...layer.data, features: [...layer.data.features] } }
    syncMapLayers(map, [changed])
    const second = [...sources.values()][0].data as string
    expect(second).not.toBe(first)
    expect((await fetch(first)).ok).toBe(true)
    fire('idle')
    await expect(fetch(first)).rejects.toThrow()
    expect((await fetch(second)).ok).toBe(true)
    // A basemap switch can remove all old style sources before workspace cleanup runs.
    styleLayers.clear()
    sources.clear()
    syncMapLayers(map, [])
    await expect(fetch(second)).rejects.toThrow()
    syncMapLayers(map, [layer])
    const third = [...sources.values()][0].data as string
    fire('remove')
    await expect(fetch(third)).rejects.toThrow()
  })
})
