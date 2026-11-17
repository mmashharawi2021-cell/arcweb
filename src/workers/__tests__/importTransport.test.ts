import { describe, expect, it, vi } from 'vitest'
import { createMapLayer } from '../../geo'
import type { FeatureCollection } from 'geojson'
import { importInWorker, streamImportResult } from '../importTransport'
import type { ImportChunk, ImportResult } from '../importProtocol'
import type { WorkerLike } from '../runInWorker'

class FakeWorker implements WorkerLike {
  posted: unknown[] = []
  terminated = 0
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  postMessage(value: unknown) { this.posted.push(value) }
  terminate() { this.terminated++ }
  emit(data: unknown) { this.onmessage?.({ data }) }
}
function result(): Extract<ImportResult, { kind: 'vector' }> {
  const data: FeatureCollection = { type: 'FeatureCollection', bbox: [35, 31, 36, 32], features: Array.from({ length: 1100 }, (_, index) => ({
    type: 'Feature', id: index === 0 ? 'user-id' : index, properties: { name: 'محطة', value: index, nested: { kept: true } }, geometry: { type: 'Point', coordinates: [35, 31] },
  })) }
  const layer = createMapLayer('Stations', data)
  return { kind: 'vector', layers: [{ name: layer.name, data, sourceCrs: layer.sourceCrs, warnings: [], preparedLayer: layer, renderBlob: new Blob(['prepared']) }] }
}
describe('backpressured import transport', () => {
  it('waits for acknowledgment before sending the next batch', async () => {
    const sent: ImportChunk[] = [], acknowledgments: (() => void)[] = []
    const pending = streamImportResult(result(), chunk => { sent.push(chunk); return new Promise(resolve => acknowledgments.push(resolve)) })
    expect(sent).toHaveLength(1)
    expect(sent[0].features).toHaveLength(1000)
    acknowledgments[0]()
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1].offset).toBe(1000)
    acknowledgments[1]()
    const manifest = await pending
    expect(manifest.kind).toBe('vector-stream')
    if (manifest.kind !== 'vector-stream') throw new Error('Expected streaming manifest')
    expect(manifest.counts).toEqual([1100])
    expect(manifest.layers[0].data.features).toEqual([])
    expect(manifest.layers[0].preparedLayer?.data).toBe(manifest.layers[0].data)
  })
  it('reassembles exact data and IDs, including shared prepared-layer identity and Blob lifetime', async () => {
    const original = result(), chunks: ImportChunk[] = []
    const wire = await streamImportResult(original, async chunk => { chunks.push(chunk) })
    const worker = new FakeWorker()
    const pending = importInWorker(() => worker, { file: new File([''], 'test.geojson') })
    for (const chunk of chunks) worker.emit({ kind: 'chunk', value: structuredClone(chunk) })
    worker.emit({ kind: 'result', value: structuredClone(wire) })
    const restored = await pending
    expect(restored).toEqual(original)
    if (restored.kind !== 'vector') throw new Error('Expected vector data')
    expect(restored.layers[0].preparedLayer?.data).toBe(restored.layers[0].data)
    expect(await restored.layers[0].renderBlob?.text()).toBe('prepared')
    expect(worker.posted.slice(1)).toEqual([{ kind: 'ack' }, { kind: 'ack' }])
    expect(worker.terminated).toBe(1)
  })
  it('rejects out-of-order and truncated batches rather than accepting partial data', async () => {
    const worker = new FakeWorker(), input = result()
    const pending = importInWorker(() => worker, { file: new File([''], 'test.geojson') })
    worker.emit({ kind: 'chunk', value: { layerIndex: 0, offset: 1, features: input.layers[0].data.features.slice(0, 1) } })
    await expect(pending).rejects.toThrow('out of order')
    expect(worker.terminated).toBe(1)
    const second = new FakeWorker()
    const truncated = importInWorker(() => second, { file: new File([''], 'test.geojson') })
    const wire = await streamImportResult(input, async () => undefined)
    second.emit({ kind: 'result', value: wire })
    await expect(truncated).rejects.toThrow('Incomplete')
  })
  it('cancels while streaming and ignores late batches', async () => {
    const worker = new FakeWorker(), controller = new AbortController()
    const pending = importInWorker(() => worker, { file: new File([''], 'test.geojson') }, controller.signal)
    worker.emit({ kind: 'chunk', value: { layerIndex: 0, offset: 0, features: result().layers[0].data.features.slice(0, 1000) } })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    worker.emit({ kind: 'chunk', value: { layerIndex: 0, offset: 1000, features: [] } })
    expect(worker.posted).toHaveLength(2)
    expect(worker.terminated).toBe(1)
  })
})
