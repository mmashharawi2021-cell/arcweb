import type { FeatureCollection } from 'geojson'
import type { CollectionRef } from './projectRepository'
import { renderCollection } from '../mapSourceData'
import { buildFieldCatalog } from '../symbology'

export const RENDER_CACHE_PREFIX = 'map-render-v1:'
export interface CachedMapRender {
  chunks: string[]
  blob: Blob
  catalog: { fields: string[]; numericFields: string[] }
}
const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onabort = () => reject(tx.error)
})

/** Background warming must not accumulate derivatives of pruned revisions. */
async function pruneExpiredRenders(db: IDBDatabase) {
  if (!db.objectStoreNames.contains('projects') || !db.objectStoreNames.contains('revisions')) return
  const tx = db.transaction(['projects', 'revisions', 'meta'], 'readwrite')
  const done = complete(tx).catch(() => undefined)
  const records = await Promise.all(['projects', 'revisions'].map(store =>
    read<{ snapshot: { project: { layers: { data: CollectionRef }[] } } }[]>(tx.objectStore(store).getAll())))
  const live = new Set(records.flatMap(rows => rows.flatMap(row => row.snapshot.project.layers.flatMap(layer => layer.data.chunks))))
  const cursor = tx.objectStore('meta').openCursor()
  cursor.onsuccess = () => {
    const entry = cursor.result
    if (!entry) return
    if (String(entry.key).startsWith(RENDER_CACHE_PREFIX)) {
      const value: unknown = entry.value
      if (!isCachedMapRender(value) || !value.chunks.every(key => live.has(key))) entry.delete()
    }
    entry.continue()
  }
  await done
}

/** Optional derived cache, keyed by immutable chunk identities AND collection header.
 * Nothing from this cache is used for project data, editing or saving. */
export async function loadStoredMapRenders(database: string, refs: CollectionRef[]): Promise<CachedMapRender[]> {
  const opening = indexedDB.open(database)
  opening.onupgradeneeded = () => opening.transaction?.abort() // Never create/upgrade a project DB here.
  const db = await read(opening)
  try {
    const results: CachedMapRender[] = []
    for (const ref of refs) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ header: ref.header, chunks: ref.chunks })))
      const key = RENDER_CACHE_PREFIX + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const cached = await read<unknown>(db.transaction('meta').objectStore('meta').get(key))
      if (isCachedMapRender(cached) && cached.chunks.length === ref.chunks.length && cached.chunks.every((chunk, i) => chunk === ref.chunks[i])) {
        results.push(cached)
        continue
      }
      // Hold only one immutable feature chunk and its JSON string at a time.
      // Blob parts retain native bytes, not another complete JS feature collection.
      const header = JSON.stringify({ ...ref.header, features: [] })
      const parts: BlobPart[] = [header.slice(0, -3), '[']
      const fields = new Set<string>(), numeric = new Set<string>()
      let populated = false
      for (const key of ref.chunks) {
        const features = await read<FeatureCollection['features'] | undefined>(db.transaction('chunks').objectStore('chunks').get(key))
        if (!features) throw new Error('Map preparation source is no longer available.')
        const data: FeatureCollection = { type: 'FeatureCollection', features }
        const catalog = buildFieldCatalog(data)
        catalog.fields.forEach(field => fields.add(field))
        catalog.numericFields.forEach(field => numeric.add(field))
        const rendered = renderCollection(data).features
        if (rendered.length) {
          parts.push(new Blob([populated ? ',' : '', JSON.stringify(rendered).slice(1, -1)]))
          populated = true
        }
      }
      parts.push(']}')
      const ordered = [...fields].sort((a, b) => a.localeCompare(b))
      const value: CachedMapRender = { chunks: [...ref.chunks], blob: new Blob(parts, { type: 'application/geo+json' }),
        catalog: { fields: ordered, numericFields: ordered.filter(field => numeric.has(field)) } }
      results.push(value)
      // Quota/cache-write failures must not prevent a valid project from opening.
      try {
        const space = await globalThis.navigator?.storage?.estimate()
        if (space?.quota !== undefined && space.usage !== undefined &&
          space.quota - space.usage < value.blob.size + 64 * 1024 * 1024) continue
        const write = db.transaction('meta', 'readwrite')
        const done = complete(write).catch(() => undefined)
        write.objectStore('meta').put(value, key)
        await done
      } catch { /* Disposable optimization; original project remains authoritative. */ }
    }
    try { await pruneExpiredRenders(db) } catch { /* Cache housekeeping cannot invalidate loaded data. */ }
    return results
  } finally { db.close() }
}

function isCachedMapRender(value: unknown): value is CachedMapRender {
  if (!value || typeof value !== 'object' || !('blob' in value) || !(value.blob instanceof Blob) ||
    !('chunks' in value) || !Array.isArray(value.chunks) || !value.chunks.every(chunk => typeof chunk === 'string') ||
    !('catalog' in value) || !value.catalog || typeof value.catalog !== 'object') return false
  const catalog = value.catalog
  return 'fields' in catalog && Array.isArray(catalog.fields) && catalog.fields.every(field => typeof field === 'string') &&
    'numericFields' in catalog && Array.isArray(catalog.numericFields) && catalog.numericFields.every(field => typeof field === 'string')
}
