import type { FeatureCollection } from 'geojson'
import type { CollectionRef } from './projectRepository'
import type { CachedMapRender } from './mapRenderCache'
import { seedMapSourceBlob } from '../mapSourceData'
import { seedFieldCatalog } from '../symbology'
import { runInWorker, type WorkerLike } from '../workers/runInWorker'

function createPreparationWorker(): WorkerLike {
  const native = new Worker(new URL('../workers/mapPrepare.worker.ts', import.meta.url), { type: 'module' })
  const worker: WorkerLike = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage: value => native.postMessage(value),
    terminate: () => { native.onmessage = null; native.onerror = null; native.onmessageerror = null; native.terminate() },
  }
  native.onmessage = event => worker.onmessage?.({ data: event.data })
  native.onerror = event => worker.onerror?.({ message: event.message })
  native.onmessageerror = event => worker.onmessageerror?.(event)
  return worker
}

/** Warm committed descriptors only; never post render Blobs back to the UI. */
export async function warmStoredMapSources(database: string, refs: CollectionRef[], signal: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) return
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 30_000)
  try {
    await runInWorker(createPreparationWorker, { database, refs, mode: 'warm' }, { signal: controller.signal })
  } catch { /* Background derivatives cannot affect a committed save. */ }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', abort) }
}

/** Only descriptors cross to the worker; it reads immutable chunks locally.
 * Timeout/unsupported storage/cache failures fall back to the existing renderer. */
export async function prepareStoredMapSources(database: string, layers: { data: FeatureCollection; ref: CollectionRef }[]) {
  if (!layers.length) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const values = await runInWorker<{ database: string; refs: CollectionRef[] }, CachedMapRender[]>(
      createPreparationWorker,
      { database, refs: layers.map(layer => layer.ref) }, { signal: controller.signal })
    if (values.length !== layers.length) return
    values.forEach((value, i) => {
      seedMapSourceBlob(layers[i].data, value.blob)
      seedFieldCatalog(layers[i].data, value.catalog)
    })
  } catch { /* Optional render preparation must never block recovery of valid data. */ }
  finally { clearTimeout(timeout) }
}
