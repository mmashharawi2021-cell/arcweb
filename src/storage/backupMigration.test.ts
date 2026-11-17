import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { clear, get, set } from 'idb-keyval'
import JSZip from 'jszip'
import { buildProject } from '../project'
import { createMapLayer } from '../geo'
import { defaultWorkspaceLayout } from '../workspaceLayout'
import { readLegacyWorkspace } from './legacyMigration'
import { projectRepository, type WorkspaceSnapshot } from './projectRepository'
import { assetInfo, getAsset, putAsset } from './assets'
import { exportLibraryBackup, restoreLibraryBackup } from './backup'
import { parseOfflineMetadata } from './offlineBasemap'

const sample = (): WorkspaceSnapshot => ({ project: buildProject({
  name: 'مشروع', basemap: 'osm', displayCrs: 'EPSG:4326', camera: null, bookmarks: [],
  layers: [createMapLayer('محطات', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'المحطة' }, geometry: { type: 'Point', coordinates: [35, 31] } }] })],
  layout: { paper: 'A4', orientation: 'landscape', elements: [] }, workspaceLayout: defaultWorkspaceLayout(),
}), editSnapshots: {} })
beforeEach(async () => { await clear(); for (const project of await projectRepository.list()) await projectRepository.delete(project.id) })
afterEach(async () => { await projectRepository.close() })
it('migrates legacy layers, settings and edit recovery without deleting old keys', async () => {
  const old = sample(), layer = old.project.layers[0]
  await set('arcweb-session-v1', old.project.layers)
  await set('arcweb-settings-v1', { projectName: 'العمل القديم', displayCrs: 'EPSG:3857', layout: old.project.layout })
  await set('arcweb-edit-session-v1', { [layer.id]: layer.data })
  const migrated = await readLegacyWorkspace(sample())
  expect(migrated.project.name).toBe('العمل القديم')
  expect(migrated.project.map.displayCrs).toBe('EPSG:3857')
  expect(migrated.project.layers[0].data).toEqual(layer.data)
  expect(migrated.editSnapshots[layer.id]).toEqual(layer.data)
  expect(await get('arcweb-session-v1')).toEqual(old.project.layers)
})
it('refuses corrupt legacy data without replacing it', async () => {
  await set('arcweb-session-v1', 'corrupt')
  await expect(readLegacyWorkspace(sample())).rejects.toThrow('has not been modified')
  expect(await get('arcweb-session-v1')).toBe('corrupt')
})
it('backs up and restores recovery history and exact source bytes as separate projects', async () => {
  const snapshot = sample(), original = await putAsset(new Blob(['original source bytes'], { type: 'text/plain' }), 'مصدر.csv')
  snapshot.assetIds = [original]
  await projectRepository.save('original', snapshot, 0)
  await projectRepository.save('original', { ...snapshot, project: { ...snapshot.project, name: 'Latest' } }, 1)
  const beforeActive = await projectRepository.activeId()
  const backup = await exportLibraryBackup()
  expect(await restoreLibraryBackup(backup)).toBe(1)
  const projects = await projectRepository.list()
  expect(projects.length).toBe(2)
  expect(await projectRepository.activeId()).toBe(beforeActive)
  const copy = projects.find(project => project.id !== 'original')!
  expect((await projectRepository.revisions(copy.id)).length).toBe(2)
  expect((await projectRepository.load(copy.id, 1))?.snapshot.project.name).toBe('مشروع')
  const restored = (await projectRepository.load(copy.id))!.snapshot
  expect(restored.project.name).toBe('Latest')
  const asset = restored.assetIds![0]
  expect(asset).not.toBe(original)
  expect(await (await getAsset(asset)).text()).toBe('original source bytes')
  expect((await assetInfo(asset))?.type).toBe('text/plain')
})
it('rejects an incomplete backup before importing projects', async () => {
  await projectRepository.save('existing', sample(), 0)
  const snapshot = { ...sample(), assetIds: ['missing'] }, zip = new JSZip()
  zip.file('library.json', JSON.stringify({ format: 'arcweb-library-backup', version: 1, projects: [{ snapshot }] }))
  await expect(restoreLibraryBackup(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow('incomplete')
  expect((await projectRepository.list()).map(project => project.id)).toEqual(['existing'])
})
it('validates offline XYZ bounds and zooms before storage', () => {
  const valid = { name: 'Local', attribution: 'QA', minZoom: 0, maxZoom: 3, tileSize: 256, bounds: [-180, -85, 180, 85], format: 'png' }
  expect(parseOfflineMetadata(valid).maxZoom).toBe(3)
  expect(() => parseOfflineMetadata({ ...valid, maxZoom: 25 })).toThrow()
  expect(() => parseOfflineMetadata({ ...valid, bounds: [40, 30, 35, 31] })).toThrow()
})
