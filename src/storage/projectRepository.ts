import type { FeatureCollection } from 'geojson'
import type { ArcWebProject } from '../project'
import type { OfflineBasemap } from './offlineBasemap'
import { RENDER_CACHE_PREFIX } from './mapRenderCache'
import { RenderWarmup } from './renderWarmup'

export interface WorkspaceSnapshot {
  project: ArcWebProject
  editSnapshots: Record<string, FeatureCollection>
  assetIds?: string[]
  offlineBasemap?: OfflineBasemap
}
export interface CollectionRef { header: Omit<FeatureCollection, 'features'>; chunks: string[]; chunkSize?: number }
interface StoredSnapshot {
  offlineBasemap?: OfflineBasemap
  project: Omit<ArcWebProject, 'layers'> & { layers: (Omit<ArcWebProject['layers'][number], 'data'> & { data: CollectionRef })[] }
  editSnapshots: Record<string, CollectionRef>
  assetIds?: string[]
}
export interface ProjectSummary { id: string; name: string; revision: number; modifiedAt: string; layerCount: number; featureCount: number }
interface ProjectRecord extends ProjectSummary { snapshot: StoredSnapshot }
export class ProjectConflictError extends Error {
  constructor() { super('This project changed in another tab. Reopen it or save your workspace as a new project.'); this.name = 'ProjectConflictError' }
}
const CHUNK_SIZE = 1000
export const RECOVERY_VERSIONS = 5
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result)
  value.onerror = () => reject(value.error ?? new Error('Database request failed.'))
})
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onabort = () => reject(tx.error ?? new Error('Database transaction was aborted.'))
  tx.onerror = () => { /* onabort reports the final transaction failure. */ }
})

/** All project pointers, immutable data chunks and recovery records commit atomically. */
export class ProjectRepository {
  private opening?: Promise<IDBDatabase>
  private previous = new Map<string, { data: WeakRef<FeatureCollection>; ref: CollectionRef }>()
  private warmup = new RenderWarmup(async (refs, signal) => {
    const { warmStoredMapSources } = await import('./prepareStoredMapSources')
    await warmStoredMapSources(this.name, refs, signal)
  })
  private name: string
  constructor(name = 'arcweb-library-v1') { this.name = name }
  async database() {
    if (!this.opening) this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(this.name, 1)
      opening.onupgradeneeded = () => {
        for (const name of ['projects', 'revisions', 'chunks', 'meta', 'assets']) opening.result.createObjectStore(name)
      }
      opening.onblocked = () => reject(new Error('Close other ArcWeb tabs to upgrade local storage.'))
      opening.onerror = () => { this.opening = undefined; reject(opening.error) }
      opening.onsuccess = () => {
        opening.result.onversionchange = () => { opening.result.close(); this.opening = undefined }
        resolve(opening.result)
      }
    })
    return this.opening
  }
  async list(): Promise<ProjectSummary[]> {
    const db = await this.database()
    const records = await request<ProjectRecord[]>(db.transaction('projects').objectStore('projects').getAll())
    return records.map(({ snapshot: _snapshot, ...summary }) => summary).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  }
  async activeId(): Promise<string | undefined> {
    const db = await this.database()
    return request<string | undefined>(db.transaction('meta').objectStore('meta').get('active'))
  }
  async initialized(): Promise<boolean> {
    const db = await this.database()
    return (await request(db.transaction('meta').objectStore('meta').get('initialized'))) === true
  }
  async activate(id: string) {
    const db = await this.database()
    const tx = db.transaction(['projects', 'meta'], 'readwrite')
    const done = completed(tx)
    const record = await request(tx.objectStore('projects').get(id))
    if (!record) { tx.abort(); await done }
    tx.objectStore('meta').put(id, 'active')
    await done
  }
  async save(id: string, snapshot: WorkspaceSnapshot, expectedRevision: number, activate = true): Promise<ProjectSummary> {
    const writes = new Map<string, FeatureCollection['features']>()
    const prepared = new Map<FeatureCollection, CollectionRef>()
    const previousUpdates = new Map<string, { data: FeatureCollection; ref: CollectionRef }>()
    const encode = (data: FeatureCollection, key: string): CollectionRef => {
      const prior = this.previous.get(key)
      const previousData = prior?.data.deref()
      const cached = (previousData === data ? prior?.ref : undefined) ?? prepared.get(data)
      if (cached) { previousUpdates.set(key, { data, ref: cached }); return cached }
      // Polygon/line features contain many coordinates: smaller batches bound clone cost.
      const chunkSize = data.features.some(feature => feature.geometry && feature.geometry.type !== 'Point') ? 100 : CHUNK_SIZE
      const chunks: string[] = []
      for (let offset = 0; offset < data.features.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, data.features.length)
        const unchanged = prior && previousData && (prior.ref.chunkSize ?? CHUNK_SIZE) === chunkSize && end <= previousData.features.length &&
          Math.min(chunkSize, previousData.features.length - offset) === end - offset &&
          data.features.slice(offset, end).every((feature, index) => feature === previousData.features[offset + index])
        if (unchanged) chunks.push(prior.ref.chunks[offset / chunkSize])
        else { const key = crypto.randomUUID(); chunks.push(key); writes.set(key, data.features.slice(offset, end)) }
      }
      const { features: _features, ...header } = data
      const ref = { header, chunks, chunkSize }
      prepared.set(data, ref)
      previousUpdates.set(key, { data, ref })
      return ref
    }
    const stored: StoredSnapshot = {
      assetIds: snapshot.assetIds,
      offlineBasemap: snapshot.offlineBasemap,
      project: { ...snapshot.project, layers: snapshot.project.layers.map(({ data, ...layer }) => ({ ...layer, data: encode(data, `${id}:layer:${layer.id}`) })) },
      editSnapshots: Object.fromEntries(Object.entries(snapshot.editSnapshots).map(([layerId, data]) => [layerId, encode(data, `${id}:edit:${layerId}`)])),
    }
    const revision = expectedRevision + 1
    const record: ProjectRecord = {
      id, name: snapshot.project.name, revision, modifiedAt: new Date().toISOString(),
      layerCount: snapshot.project.layers.length,
      featureCount: snapshot.project.layers.reduce((sum, layer) => sum + layer.data.features.length, 0), snapshot: stored,
    }
    const db = await this.database()
    const tx = db.transaction(['projects', 'chunks', 'revisions', 'meta', 'assets'], 'readwrite')
    const done = completed(tx)
    try {
      const current = await request<ProjectRecord | undefined>(tx.objectStore('projects').get(id))
      if ((current?.revision ?? 0) !== expectedRevision) throw new ProjectConflictError()
      const assets = await Promise.all((snapshot.assetIds ?? []).map(id => request(tx.objectStore('assets').get(id))))
      if (assets.some(asset => !asset)) throw new Error('A source file is missing; the previous project version was preserved.')
      // Each request's success event yields back to the browser while keeping the
      // transaction alive. Queuing every expensive clone in one task causes stalls.
      for (const [key, chunk] of writes) await request(tx.objectStore('chunks').put(chunk, key))
      tx.objectStore('projects').put(record, id)
      tx.objectStore('revisions').put(record, `${id}:${revision}`)
      if (revision > RECOVERY_VERSIONS) tx.objectStore('revisions').delete(`${id}:${revision - RECOVERY_VERSIONS}`)
      if (activate) tx.objectStore('meta').put(id, 'active')
      tx.objectStore('meta').put(true, 'initialized')
      await done
    } catch (error) {
      try { tx.abort() } catch { /* Already completed/aborted. */ }
      await done.catch(() => undefined)
      throw error
    }
    for (const key of this.previous.keys()) {
      if ((activate || key.startsWith(`${id}:`)) && !previousUpdates.has(key)) this.previous.delete(key)
    }
    for (const [key, value] of previousUpdates) this.previous.set(key, { data: new WeakRef(value.data), ref: value.ref })
    if (activate && typeof Worker !== 'undefined') {
      this.warmup.schedule(stored.project.layers.flatMap((layer, index) =>
        snapshot.project.layers[index].data.features.length >= 1000 || (layer.geometry !== 'Point' && layer.geometry !== 'Unknown') ? [layer.data] : []))
    }
    const { snapshot: _snapshot, ...summary } = record
    return summary
  }
  async load(id: string, revision?: number, remember = true): Promise<{ snapshot: WorkspaceSnapshot; summary: ProjectSummary } | null> {
    const db = await this.database()
    const tx = db.transaction(['projects', 'revisions', 'chunks'])
    const record = await request<ProjectRecord | undefined>(revision === undefined
      ? tx.objectStore('projects').get(id) : tx.objectStore('revisions').get(`${id}:${revision}`))
    if (!record) return null
    const decode = async (ref: CollectionRef, key: string): Promise<FeatureCollection> => {
      const chunks = await Promise.all(ref.chunks.map((key) => request<FeatureCollection['features'] | undefined>(tx.objectStore('chunks').get(key))))
      if (chunks.some((chunk) => !chunk)) throw new Error('Project data is incomplete. Restore a backup before continuing.')
      const data: FeatureCollection = { ...ref.header, features: chunks.flatMap((chunk) => chunk ?? []) }
      if (remember) this.previous.set(key, { data: new WeakRef(data), ref })
      return data
    }
    // Queue all layer and recovery reads before awaiting; one readonly transaction
    // prevents concurrent deletion/GC from producing a mixed snapshot.
    const layersRead = Promise.all(record.snapshot.project.layers.map(async ({ data, ...layer }) => ({ ...layer, data: await decode(data, `${id}:layer:${layer.id}`) })))
    const editsRead = Promise.all(Object.entries(record.snapshot.editSnapshots).map(async ([layerId, ref]) => [layerId, await decode(ref, `${id}:edit:${layerId}`)] as const))
    const [layers, editEntries] = await Promise.all([layersRead, editsRead])
    if (remember && typeof Worker !== 'undefined') {
      // Derivative preparation is isolated from authoritative reads and commits.
      // Backup loads (remember=false) must not create workers or render caches.
      try {
        const { prepareStoredMapSources } = await import('./prepareStoredMapSources')
        const sources = layers.flatMap((layer, index) =>
          layer.data.features.length >= 1000 || (layer.geometry !== 'Point' && layer.geometry !== 'Unknown')
            ? [{ data: layer.data, ref: record.snapshot.project.layers[index].data }] : [])
        await this.warmup.wait(sources.map(source => source.ref))
        await prepareStoredMapSources(this.name, sources)
      } catch { /* Optional preparation cannot make authoritative data unavailable. */ }
    }
    const edits = Object.fromEntries(editEntries)
    const { snapshot: _snapshot, ...summary } = record
    return { snapshot: { project: { ...record.snapshot.project, layers }, editSnapshots: edits, ...(record.snapshot.assetIds ? { assetIds: record.snapshot.assetIds } : {}), ...(record.snapshot.offlineBasemap ? { offlineBasemap: record.snapshot.offlineBasemap } : {}) }, summary }
  }
  async revisions(id: string): Promise<ProjectSummary[]> {
    const db = await this.database()
    const rows = await request<ProjectRecord[]>(db.transaction('revisions').objectStore('revisions').getAll())
    return rows.filter(row => row.id === id).map(({ snapshot: _snapshot, ...row }) => row).sort((a, b) => b.revision - a.revision)
  }
  async delete(id: string) {
    const db = await this.database()
    const tx = db.transaction(['projects', 'revisions', 'meta'], 'readwrite')
    const done = completed(tx)
    tx.objectStore('projects').delete(id)
    const cursor = tx.objectStore('revisions').openCursor()
    cursor.onsuccess = () => { const item = cursor.result; if (item) { if ((item.value as ProjectRecord).id === id) item.delete(); item.continue() } }
    if (await request(tx.objectStore('meta').get('active')) === id) tx.objectStore('meta').delete('active')
    await done
    for (const key of this.previous.keys()) if (key.startsWith(`${id}:`)) this.previous.delete(key)
    // Invalidates cached references to chunks which collectUnused may subsequently remove.
  }
  async collectUnused(): Promise<number> {
    this.warmup.stop()
    const db = await this.database()
    const tx = db.transaction(['projects', 'revisions', 'chunks', 'meta'], 'readwrite')
    const done = completed(tx)
    const [projects, revisions] = await Promise.all(['projects', 'revisions'].map(name => request<ProjectRecord[]>(tx.objectStore(name).getAll())))
    const live = new Set<string>()
    for (const record of [...projects, ...revisions]) {
      for (const layer of record.snapshot.project.layers) layer.data.chunks.forEach(key => live.add(key))
      for (const data of Object.values(record.snapshot.editSnapshots)) data.chunks.forEach(key => live.add(key))
    }
    let removed = 0
    const cursor = tx.objectStore('chunks').openCursor()
    cursor.onsuccess = () => { const item = cursor.result; if (item) { if (!live.has(String(item.key))) { item.delete(); removed++ } item.continue() } }
    const cached = tx.objectStore('meta').openCursor()
    cached.onsuccess = () => {
      const item = cached.result
      if (!item) return
      if (String(item.key).startsWith(RENDER_CACHE_PREFIX)) {
        const value: unknown = item.value
        if (!value || typeof value !== 'object' || !('chunks' in value) || !Array.isArray(value.chunks) ||
          !value.chunks.every(key => typeof key === 'string' && live.has(key))) item.delete()
      }
      item.continue()
    }
    await done
    this.previous.clear()
    return removed
  }
  async close() { this.warmup.stop(); this.previous.clear(); (await this.opening)?.close(); this.opening = undefined }
}
export const projectRepository = new ProjectRepository()
