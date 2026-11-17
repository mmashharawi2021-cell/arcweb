import type { Feature } from 'geojson'
import type { ImportChunk, ImportRequest, ImportResult, ImportWireResult } from './importProtocol'
import { runInWorker, type WorkerLike } from './runInWorker'

/** One acknowledged batch at a time prevents a large result deserialization task. */
export async function streamImportResult(result: ImportResult, sendChunk: (chunk: ImportChunk) => Promise<void>): Promise<ImportWireResult> {
  if (result.kind !== 'vector') return result
  const counts = result.layers.map(layer => layer.data.features.length)
  for (const [layerIndex, layer] of result.layers.entries()) {
    const size = layer.preparedLayer?.geometry === 'Point' ? 1000 : 100
    for (let offset = 0; offset < layer.data.features.length; offset += size) {
      await sendChunk({ layerIndex, offset, features: layer.data.features.slice(offset, offset + size) })
    }
  }
  const layers = result.layers.map(layer => {
    const data = { ...layer.data, features: [] }
    return { ...layer, data, preparedLayer: layer.preparedLayer ? { ...layer.preparedLayer, data } : undefined }
  })
  return { kind: 'vector-stream', layers, counts }
}

export async function importInWorker(createWorker: () => WorkerLike, request: ImportRequest, signal?: AbortSignal): Promise<ImportResult> {
  const batches = new Map<number, Feature[]>()
  const wire = await runInWorker<ImportRequest, ImportWireResult>(createWorker, request, { signal, onChunk: value => {
    if (!value || typeof value !== 'object' || !('layerIndex' in value) || !('offset' in value) || !('features' in value) ||
      !Number.isInteger(value.layerIndex) || Number(value.layerIndex) < 0 || !Number.isInteger(value.offset) ||
      !Array.isArray(value.features) || value.features.length > 1000 || !value.features.every(feature => feature?.type === 'Feature')) throw new Error('Invalid import data batch.')
    const index = Number(value.layerIndex), features = batches.get(index) ?? []
    if (value.offset !== features.length) throw new Error('Import data batches are missing or out of order.')
    features.push(...value.features)
    batches.set(index, features)
  } })
  if (wire.kind !== 'vector-stream') {
    if (batches.size) throw new Error('Incomplete import data stream.')
    return wire
  }
  if (wire.counts.length !== wire.layers.length || [...batches.keys()].some(index => index >= wire.layers.length)) throw new Error('Invalid import data manifest.')
  return { kind: 'vector', layers: wire.layers.map((layer, index) => {
    const features = batches.get(index) ?? []
    if (features.length !== wire.counts[index]) throw new Error('Incomplete import data stream.')
    const data = { ...layer.data, features }
    return { ...layer, data, preparedLayer: layer.preparedLayer ? { ...layer.preparedLayer, data } : undefined }
  }) }
}
