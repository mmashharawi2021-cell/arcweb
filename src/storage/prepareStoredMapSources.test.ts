import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { prepareStoredMapSources, warmStoredMapSources } from './prepareStoredMapSources'
import { prepareMapSourceData } from '../mapSourceData'
import { createMapLayer } from '../geo'
import { getFeatureFields } from '../symbology'

const data = (): FeatureCollection => ({ type: 'FeatureCollection', features: [
  { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [35, 31] }, properties: { retained: 7 } },
] })
class NativeWorkerStub {
  static instances: NativeWorkerStub[] = []
  static mode: 'success' | 'throw' | 'timeout' = 'success'
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: ((event: unknown) => void) | null = null
  posted: unknown[] = []
  terminated = 0
  constructor() { NativeWorkerStub.instances.push(this) }
  terminate() { this.terminated++ }
  postMessage(value: unknown) {
    this.posted.push(value)
    if (NativeWorkerStub.mode === 'throw') throw new Error('QA worker failure')
    if (NativeWorkerStub.mode === 'timeout') return
    queueMicrotask(() => this.onmessage?.({ data: { kind: 'result', value: [{
      blob: new Blob(['prepared']), chunks: ['immutable'], catalog: { fields: ['retained'], numericFields: ['retained'] },
    }] } }))
  }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); NativeWorkerStub.instances = []; NativeWorkerStub.mode = 'success' })
const prepare = (collection: FeatureCollection) => prepareStoredMapSources('qa-db', [{
  data: collection, ref: { header: { type: 'FeatureCollection' }, chunks: ['immutable'] },
}])

describe('stored source preparation lifecycle', () => {
  it('does not create a background worker for an already cancelled warmup', async () => {
    vi.stubGlobal('Worker', NativeWorkerStub)
    const controller = new AbortController()
    controller.abort()
    await warmStoredMapSources('qa-db', [], controller.signal)
    expect(NativeWorkerStub.instances).toHaveLength(0)
  })

  it('sends only committed descriptors in warm mode and terminates on superseding cancellation', async () => {
    vi.stubGlobal('Worker', NativeWorkerStub)
    NativeWorkerStub.mode = 'timeout'
    const controller = new AbortController()
    const pending = warmStoredMapSources('qa-db', [{ header: { type: 'FeatureCollection' }, chunks: ['committed'] }], controller.signal)
    expect(NativeWorkerStub.instances[0].posted).toEqual([{ database: 'qa-db', refs: [{ header: { type: 'FeatureCollection' }, chunks: ['committed'] }], mode: 'warm' }])
    controller.abort()
    await pending
    expect(NativeWorkerStub.instances[0].terminated).toBe(1)
    expect(NativeWorkerStub.instances[0].onmessage).toBeNull()
  })
  it('sends only descriptors and seeds the exact collection before terminating the worker', async () => {
    vi.stubGlobal('Worker', NativeWorkerStub)
    const original = data()
    await prepare(original)
    const worker = NativeWorkerStub.instances[0]
    expect(worker.posted).toEqual([{ database: 'qa-db', refs: [{ header: { type: 'FeatureCollection' }, chunks: ['immutable'] }] }])
    expect(worker.terminated).toBe(1)
    expect(worker.onmessage).toBeNull()
    const rendered = prepareMapSourceData(original)
    expect(await (await fetch(rendered.data as string)).text()).toBe('prepared')
    rendered.dispose()
    expect(getFeatureFields({ ...createMapLayer('Points', data()), data: original })).toEqual(['retained'])
    expect(original.features[0].properties).toEqual({ retained: 7 })
  })

  it('falls back to original rendering if worker creation/posting fails', async () => {
    vi.stubGlobal('Worker', NativeWorkerStub)
    NativeWorkerStub.mode = 'throw'
    const original = data()
    await expect(prepare(original)).resolves.toBeUndefined()
    expect(NativeWorkerStub.instances[0].terminated).toBe(1)
    expect(prepareMapSourceData(original).data).toMatchObject({ features: [{ id: 'a', properties: { retained: 7 } }] })
  })

  it('terminates a stalled worker after the bounded timeout and leaves valid data available', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', NativeWorkerStub)
    NativeWorkerStub.mode = 'timeout'
    const original = data(), pending = prepare(original)
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(pending).resolves.toBeUndefined()
    expect(NativeWorkerStub.instances[0].terminated).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(typeof prepareMapSourceData(original).data).toBe('object')
  })
})
