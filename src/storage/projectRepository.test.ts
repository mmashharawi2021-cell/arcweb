import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectConflictError, ProjectRepository, type WorkspaceSnapshot } from './projectRepository'
import { buildProject } from '../project'
import { createMapLayer } from '../geo'
import { useLayoutStore } from '../layout/layoutStore'
import { defaultWorkspaceLayout } from '../workspaceLayout'
import { loadStoredMapRenders, RENDER_CACHE_PREFIX } from './mapRenderCache'
import type { CollectionRef } from './projectRepository'

const repositories: ProjectRepository[] = []
const repository = (name = crypto.randomUUID()) => { const repo = new ProjectRepository(name); repositories.push(repo); return repo }
const snapshot = (): WorkspaceSnapshot => ({
  project: buildProject({ name: 'مشروع QA', basemap: 'osm', displayCrs: 'EPSG:4326', camera: { center: [35, 31], zoom: 8, bearing: 3, pitch: 20 },
    bookmarks: [], layout: { paper: useLayoutStore.getState().paper, orientation: useLayoutStore.getState().orientation, elements: useLayoutStore.getState().elements }, workspaceLayout: defaultWorkspaceLayout(),
    layers: [createMapLayer('محطات', { type: 'FeatureCollection', features: Array.from({ length: 2100 }, (_, index) => ({ type: 'Feature', properties: { category: index % 3, name: `محطة ${index}` }, geometry: { type: 'Point', coordinates: [35, 31] } })) })],
  }), editSnapshots: {},
})
const chunkCount = async (repo: ProjectRepository) => {
  const db = await repo.database()
  return new Promise<number>((resolve) => { const req = db.transaction('chunks').objectStore('chunks').count(); req.onsuccess = () => resolve(req.result) })
}
afterEach(async () => { await Promise.all(repositories.splice(0).map(repo => repo.close())) })
describe('project library transactions', () => {
  it('prunes derivative caches of expired revisions without removing authoritative or recovery chunks', async () => {
    const repo = repository(), first = snapshot()
    await repo.save('one', first, 0)
    const db = await repo.database()
    const refs = async () => new Promise<CollectionRef[]>(resolve => {
      const get = db.transaction('projects').objectStore('projects').get('one')
      get.onsuccess = () => resolve(get.result.snapshot.project.layers.map((layer: { data: CollectionRef }) => layer.data))
    })
    const cacheKeys = async () => new Promise<IDBValidKey[]>(resolve => {
      const get = db.transaction('meta').objectStore('meta').getAllKeys()
      get.onsuccess = () => resolve(get.result.filter(key => String(key).startsWith(RENDER_CACHE_PREFIX)))
    })
    await loadStoredMapRenders(db.name, await refs())
    const [obsolete] = await cacheKeys()
    let latest = first
    for (let revision = 1; revision < 7; revision++) { latest = snapshot(); await repo.save('one', latest, revision) }
    const originalChunks = await chunkCount(repo)
    await loadStoredMapRenders(db.name, await refs())
    expect(await cacheKeys()).toHaveLength(1)
    expect(await cacheKeys()).not.toContain(obsolete)
    expect(await chunkCount(repo)).toBe(originalChunks)
    expect((await repo.load('one'))?.snapshot).toEqual(latest)
    expect((await repo.load('one', 3))?.snapshot.project.layers[0].data.features).toHaveLength(2100)
  })
  it('saves exact data when a weak reuse reference has already been collected', async () => {
    const repo = repository(), input = snapshot()
    await repo.save('one', input, 0)
    const deref = vi.spyOn(WeakRef.prototype, 'deref').mockReturnValue(undefined)
    try { await repo.save('one', input, 1) } finally { deref.mockRestore() }
    expect((await repo.load('one'))?.snapshot).toEqual(input)
  })
  it('collects orphaned derived renders while preserving caches for live/recovery chunks and active metadata', async () => {
    const repo = repository(), input = snapshot()
    await repo.save('keep', input, 0)
    const db = await repo.database()
    const record = await new Promise<{ snapshot: { project: { layers: { data: CollectionRef }[] } } }>(resolve => {
      const get = db.transaction('projects').objectStore('projects').get('keep')
      get.onsuccess = () => resolve(get.result)
    })
    await loadStoredMapRenders(db.name, record.snapshot.project.layers.map(layer => layer.data))
    await new Promise<void>(resolve => {
      const write = db.transaction('meta', 'readwrite')
      write.objectStore('meta').put({ chunks: ['orphan'], blob: new Blob(['obsolete']) }, RENDER_CACHE_PREFIX + 'orphan')
      write.oncomplete = () => resolve()
    })
    await repo.collectUnused()
    const keys = await new Promise<IDBValidKey[]>(resolve => {
      const get = db.transaction('meta').objectStore('meta').getAllKeys()
      get.onsuccess = () => resolve(get.result)
    })
    expect(keys.filter(key => String(key).startsWith(RENDER_CACHE_PREFIX))).toHaveLength(1)
    expect(keys).not.toContain(RENDER_CACHE_PREFIX + 'orphan')
    expect(await repo.activeId()).toBe('keep')
    expect((await repo.load('keep'))?.snapshot).toEqual(input)
  })
  it('uses smaller line/polygon chunks while reusing unchanged coordinate data', async () => {
    const repo = repository(), input = snapshot()
    input.project.layers[0].data = { type: 'FeatureCollection', features: Array.from({ length: 201 }, (_, index) => ({ type: 'Feature', properties: { index }, geometry: { type: 'LineString', coordinates: [[35, 31], [35.1, 31.1]] } })) }
    await repo.save('lines', input, 0)
    expect(await chunkCount(repo)).toBe(3)
    const features = [...input.project.layers[0].data.features]
    features[150] = { ...features[150], properties: { index: 'changed' } }
    const next = { ...input, project: { ...input.project, layers: [{ ...input.project.layers[0], data: { ...input.project.layers[0].data, features } }] } }
    await repo.save('lines', next, 1)
    expect(await chunkCount(repo)).toBe(4)
    expect((await repo.load('lines'))?.snapshot).toEqual(next)
  })
  it('rolls back all chunks and manifest pointers when a write cannot be cloned', async () => {
    const repo = repository(), input = snapshot()
    await repo.save('one', input, 0)
    const broken = snapshot()
    broken.project.layers[0].data.features[0].properties = { invalid: () => 'not structured-cloneable' }
    await expect(repo.save('one', broken, 1)).rejects.toThrow()
    expect((await repo.load('one'))?.summary.revision).toBe(1)
    expect(await chunkCount(repo)).toBe(3)
    expect((await repo.revisions('one')).length).toBe(1)
  })
  it('reopens full workspace and unsaved edit recovery, then saves metadata without rewriting data', async () => {
    const repo = repository()
    const input = snapshot()
    input.editSnapshots[input.project.layers[0].id] = input.project.layers[0].data
    await repo.save('one', input, 0)
    expect(await chunkCount(repo)).toBe(3)
    const reopened = await repo.load('one')
    expect(reopened?.snapshot).toEqual(input)
    expect(await repo.activeId()).toBe('one')
    const changed = reopened!.snapshot
    changed.project.layers[0].opacity = 0.4
    changed.project.layers[0].renderer = { type: 'unique', field: 'category', colors: { '0': '#ff0000', '1': '#00ff00', '2': '#0000ff' }, ramp: 'vivid' }
    await repo.save('one', changed, 1)
    expect(await chunkCount(repo)).toBe(3)
    expect((await repo.load('one'))?.snapshot.project.layers[0].renderer).toEqual(changed.project.layers[0].renderer)
  })
  it('writes only the changed feature chunk and retains a recoverable prior version', async () => {
    const repo = repository()
    const input = snapshot()
    await repo.save('one', input, 0)
    const features = [...input.project.layers[0].data.features]
    features[1100] = { ...features[1100], properties: { name: 'edited' } }
    const next = { ...input, project: { ...input.project, layers: [{ ...input.project.layers[0], data: { ...input.project.layers[0].data, features } }] } }
    await repo.save('one', next, 1)
    expect(await chunkCount(repo)).toBe(4)
    expect((await repo.load('one', 1))?.snapshot.project.layers[0].data.features[1100].properties?.name).toBe('محطة 1100')
    expect((await repo.load('one'))?.snapshot.project.layers[0].data.features[1100].properties?.name).toBe('edited')
  })
  it('rejects stale writers atomically and never overwrites another tab', async () => {
    const name = crypto.randomUUID()
    const first = repository(name), second = repository(name)
    const input = snapshot()
    await first.save('one', input, 0)
    const stale = (await second.load('one'))!.snapshot
    await first.save('one', { ...input, project: { ...input.project, name: 'newer' } }, 1)
    await expect(second.save('one', { ...stale, project: { ...stale.project, name: 'stale' } }, 1)).rejects.toBeInstanceOf(ProjectConflictError)
    expect((await second.load('one'))?.snapshot.project.name).toBe('newer')
    expect(await chunkCount(first)).toBe(3)
  })
  it('prunes recovery history, collects unreachable chunks and preserves other projects', async () => {
    const repo = repository(), input = snapshot()
    await repo.save('keep', input, 0)
    for (let revision = 0; revision < 8; revision++) await repo.save('remove', snapshot(), revision)
    expect((await repo.revisions('remove')).map(row => row.revision)).toEqual([8, 7, 6, 5, 4])
    expect(await repo.collectUnused()).toBeGreaterThan(0)
    await repo.delete('remove')
    await repo.collectUnused()
    expect(await chunkCount(repo)).toBe(3)
    expect((await repo.load('keep'))?.snapshot).toEqual(input)
    expect(await repo.load('remove')).toBeNull()
  })
})
