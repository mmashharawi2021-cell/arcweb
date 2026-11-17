import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureCollection } from 'geojson'
import type { CollectionRef } from './projectRepository'
import { loadStoredMapRenders, RENDER_CACHE_PREFIX } from './mapRenderCache'
import { tableRow } from '../geojson'

const databases: IDBDatabase[] = []
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result)
  value.onerror = () => reject(value.error)
})
const source: FeatureCollection = { type: 'FeatureCollection', bbox: [0, 0, 35, 31], features: [
  { type: 'Feature', id: 'user', geometry: { type: 'Point', coordinates: [35, 31, 7] }, properties: { name: 'محطة', amount: 7, nested: { keep: true }, __arcweb_feature_id: 'user attribute' } },
  tableRow({ description: 'nonspatial row' }),
] }
async function setup() {
  const open = indexedDB.open(crypto.randomUUID(), 1)
  open.onupgradeneeded = () => { open.result.createObjectStore('chunks'); open.result.createObjectStore('meta') }
  const db = await request(open)
  databases.push(db)
  await request(db.transaction('chunks', 'readwrite').objectStore('chunks').put(source.features, 'first'))
  const ref: CollectionRef = { header: { type: 'FeatureCollection', bbox: source.bbox }, chunks: ['first'] }
  return { db, ref }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); databases.splice(0).forEach(db => db.close()) })

describe('optional immutable render cache', () => {
  it('assembles multiple chunks with null-only gaps into valid JSON and a complete field catalog', async () => {
    const { db, ref } = await setup()
    await request(db.transaction('chunks', 'readwrite').objectStore('chunks').put([tableRow({ gap: 3 })], 'gap'))
    await request(db.transaction('chunks', 'readwrite').objectStore('chunks').put([
      { ...source.features[0], id: 'second', properties: { other: '8', text: 'quotes " and backslash \\ preserved' } },
    ], 'second'))
    const [result, empty] = await loadStoredMapRenders(db.name, [
      { ...ref, chunks: ['first', 'gap', 'second'] }, { ...ref, chunks: ['gap'] },
    ])
    const json = JSON.parse(await result.blob.text())
    expect(json.features.map((feature: { id: string }) => feature.id)).toEqual(['user', 'second'])
    expect(json.features[1].properties.text).toBe('quotes " and backslash \\ preserved')
    expect(result.catalog.numericFields).toEqual(['amount', 'gap', 'other'])
    expect(result.catalog.fields).toContain('description')
    expect(JSON.parse(await empty.blob.text()).features).toEqual([])
    expect(empty.catalog.fields).toEqual(['gap'])
  })
  it('prepares exact render geometry/attributes and catalogs without altering original table rows or IDs', async () => {
    const { db, ref } = await setup()
    const [result] = await loadStoredMapRenders(db.name, [ref])
    const rendered = JSON.parse(await result.blob.text())
    expect(rendered.features).toHaveLength(1)
    expect(rendered.features[0]).toEqual({ ...source.features[0], properties: { ...source.features[0].properties, __arcweb_feature_id: 'user' } })
    expect(rendered.bbox).toEqual(source.bbox)
    expect(result.catalog.numericFields).toEqual(['amount'])
    expect(result.catalog.fields).toContain('description')
    expect(await request(db.transaction('chunks').objectStore('chunks').get('first'))).toEqual(source.features)
  })

  it('reuses a native cached Blob without reading feature chunks again', async () => {
    const { db, ref } = await setup()
    const [first] = await loadStoredMapRenders(db.name, [ref])
    const get = vi.spyOn(IDBObjectStore.prototype, 'get')
    const [second] = await loadStoredMapRenders(db.name, [ref])
    expect(await second.blob.text()).toBe(await first.blob.text())
    expect(get.mock.calls).toHaveLength(1)
    expect(String(get.mock.calls[0][0])).toMatch(/^map-render-v1:/)
  })

  it('invalidates both modified immutable chunks and collection header changes', async () => {
    const { db, ref } = await setup()
    await loadStoredMapRenders(db.name, [ref])
    const changed = source.features.map(feature => ({ ...feature, properties: { changed: 42 } }))
    await request(db.transaction('chunks', 'readwrite').objectStore('chunks').put(changed, 'edited'))
    const [next, header] = await loadStoredMapRenders(db.name, [
      { ...ref, chunks: ['edited'] }, { ...ref, header: { type: 'FeatureCollection', bbox: [1, 2, 3, 4] } },
    ])
    expect(JSON.parse(await next.blob.text()).features[0].properties.changed).toBe(42)
    expect(next.catalog.fields).toEqual(['changed'])
    expect(JSON.parse(await header.blob.text()).bbox).toEqual([1, 2, 3, 4])
  })

  it('rebuilds malformed derivative entries and tolerates quota failures without touching project data', async () => {
    const { db, ref } = await setup()
    await loadStoredMapRenders(db.name, [ref])
    const key = (await request(db.transaction('meta').objectStore('meta').getAllKeys()))[0]
    await request(db.transaction('meta', 'readwrite').objectStore('meta').put({ blob: 'invalid' }, key))
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'meta' && String(key).startsWith(RENDER_CACHE_PREFIX)) throw new DOMException('QA quota', 'QuotaExceededError')
      return put.call(this, value, key)
    })
    expect((await loadStoredMapRenders(db.name, [ref]))[0].catalog.fields).toContain('name')
    expect(await request(db.transaction('chunks').objectStore('chunks').get('first'))).toEqual(source.features)
  })

  it('rejects missing immutable chunks rather than producing an incomplete render', async () => {
    const { db, ref } = await setup()
    await expect(loadStoredMapRenders(db.name, [{ ...ref, chunks: ['missing'] }])).rejects.toThrow('no longer available')
  })

  it('keeps storage headroom for authoritative saves instead of filling it with derived data', async () => {
    const { db, ref } = await setup()
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 10_000_000, usage: 1_000_000 }) } })
    const [prepared] = await loadStoredMapRenders(db.name, [ref])
    expect(prepared.blob.size).toBeGreaterThan(0)
    expect(await request(db.transaction('meta').objectStore('meta').count())).toBe(0)
    expect(await request(db.transaction('chunks').objectStore('chunks').get('first'))).toEqual(source.features)
  })
})
