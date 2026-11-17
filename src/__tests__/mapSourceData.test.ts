import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { prepareMapSourceData, renderCollection, seedMapSourceBlob } from '../mapSourceData'
import { tableRow } from '../geojson'

describe('map source transport', () => {
  it('consumes a worker-prepared Blob once and disposes each independently owned URL', async () => {
    const data: FeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'original', properties: { nested: { value: 7 } }, geometry: { type: 'Point', coordinates: [35, 31] } },
      tableRow({ name: 'table only' }),
    ] }
    const blob = new Blob([JSON.stringify(renderCollection(data))], { type: 'application/geo+json' })
    seedMapSourceBlob(data, blob)
    const first = prepareMapSourceData(data)
    expect(typeof first.data).toBe('string')
    const rendered = await (await fetch(first.data as string)).json()
    expect(rendered.features).toHaveLength(1)
    expect(rendered.features[0]).toMatchObject({ id: 'original', properties: { nested: { value: 7 }, __arcweb_feature_id: 'original' } })
    expect(data.features).toHaveLength(2)
    // A seed is not retained by data/undo history after its resource takes ownership.
    expect(typeof prepareMapSourceData(data).data).toBe('object')
    seedMapSourceBlob(data, blob)
    const second = prepareMapSourceData(data)
    first.dispose()
    await expect(fetch(first.data as string)).rejects.toThrow()
    expect((await fetch(second.data as string)).ok).toBe(true)
    second.dispose()
  })
  it('sends large collections by local Blob URL and releases the URL without changing input IDs or attributes', async () => {
    const collection: FeatureCollection = { type: 'FeatureCollection', features: Array.from({ length: 60_000 }, (_, i) => ({
      type: 'Feature', id: i === 0 ? 'user-id' : i, properties: { name: 'محطة', __arcweb_feature_id: 'user value' },
      geometry: { type: 'Point', coordinates: [35, 31] },
    })) }
    const prepared = prepareMapSourceData(collection)
    expect(typeof prepared.data).toBe('string')
    const url = prepared.data as string
    const restored = await (await fetch(url)).json() as FeatureCollection
    expect(restored.features).toHaveLength(60_000)
    expect(restored.features[0].properties?.__arcweb_feature_id).toBe('user-id')
    expect(restored.features[1].properties?.__arcweb_feature_id).toBe(1)
    expect(collection.features[0].properties?.__arcweb_feature_id).toBe('user value')
    prepared.dispose()
    prepared.dispose()
    await expect(fetch(url)).rejects.toThrow()
  })

  it('keeps small sources as objects and omits null-geometry table rows', () => {
    const prepared = prepareMapSourceData({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'a', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
      tableRow({}),
    ] })
    expect(prepared.data).toMatchObject({ features: [{ id: 'a', properties: { __arcweb_feature_id: 'a' } }] })
    prepared.dispose()
  })
})
