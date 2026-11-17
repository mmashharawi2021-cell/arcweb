import JSZip from 'jszip'
import { parseProject } from '../project'
import { projectRepository, type WorkspaceSnapshot } from './projectRepository'
import { assetInfo, getAsset, putAsset } from './assets'
import type { FeatureCollection } from 'geojson'
import { parseOfflineMetadata } from './offlineBasemap'

export async function exportLibraryBackup(): Promise<Blob> {
  const zip = new JSZip()
  const projects: { snapshot: WorkspaceSnapshot; recovery: WorkspaceSnapshot[] }[] = [], assets = new Set<string>()
  for (const summary of await projectRepository.list()) {
    const saved = await projectRepository.load(summary.id, undefined, false)
    if (!saved) throw new Error('A project changed during backup. Retry the backup.')
    const recovery: WorkspaceSnapshot[] = []
    for (const revision of (await projectRepository.revisions(summary.id)).filter(row => row.revision < saved.summary.revision).reverse()) {
      const version = await projectRepository.load(summary.id, revision.revision, false)
      if (!version) throw new Error('Recovery history changed during backup. Retry the backup.')
      recovery.push(version.snapshot)
    }
    projects.push({ snapshot: saved.snapshot, recovery })
    for (const snapshot of [...recovery, saved.snapshot]) snapshot.assetIds?.forEach(id => assets.add(id))
  }
  zip.file('library.json', JSON.stringify({ format: 'arcweb-library-backup', version: 1, projects }))
  for (const id of assets) {
    const info = await assetInfo(id)
    if (!info) throw new Error('A source file is missing; backup was not completed.')
    zip.file(`assets/${id}.json`, JSON.stringify({ name: info.name, type: info.type }))
    zip.file(`assets/${id}`, await (await getAsset(id)).arrayBuffer())
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } })
}
export async function restoreLibraryBackup(file: Blob): Promise<number> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true })
  const manifest = zip.file('library.json')
  if (!manifest) throw new Error('This is not an ArcWeb library backup.')
  const value: unknown = JSON.parse(await manifest.async('string'))
  if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 'arcweb-library-backup' || !('version' in value) || value.version !== 1 || !('projects' in value) || !Array.isArray(value.projects)) throw new Error('Unsupported library backup format.')
  const parseSnapshot = (row: unknown): WorkspaceSnapshot => {
    if (!row || typeof row !== 'object' || !('snapshot' in row) || !row.snapshot || typeof row.snapshot !== 'object' || !('project' in row.snapshot)) throw new Error('Invalid project entry in backup.')
    const project = parseProject(JSON.stringify(row.snapshot.project), { paper: 'A4', orientation: 'landscape', elements: [] })
    const edits: Record<string, FeatureCollection> = {}
    if ('editSnapshots' in row.snapshot && row.snapshot.editSnapshots && typeof row.snapshot.editSnapshots === 'object') {
      for (const [id, data] of Object.entries(row.snapshot.editSnapshots)) {
        const layer = project.layers.find(layer => layer.id === id)
        if (!layer) throw new Error('Invalid edit recovery reference in backup.')
        const checked = parseProject(JSON.stringify({ ...project, layers: [{ ...layer, data }] }), project.layout)
        edits[id] = checked.layers[0].data
      }
    }
    const ids = 'assetIds' in row.snapshot ? row.snapshot.assetIds : []
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && /^[a-zA-Z0-9-]+$/.test(id))) throw new Error('Invalid asset references in backup.')
    let offlineBasemap
    if ('offlineBasemap' in row.snapshot && row.snapshot.offlineBasemap) {
      const base = row.snapshot.offlineBasemap
      if (typeof base !== 'object' || !('assetId' in base) || typeof base.assetId !== 'string' || !ids.includes(base.assetId)) throw new Error('Invalid offline basemap reference.')
      offlineBasemap = { ...parseOfflineMetadata(base), assetId: base.assetId }
    }
    return { project, editSnapshots: edits, assetIds: ids, offlineBasemap }
  }
  const groups = value.projects.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('snapshot' in row)) throw new Error('Invalid project entry.')
    const recovery = 'recovery' in row ? row.recovery : []
    if (!Array.isArray(recovery) || recovery.length > 4) throw new Error('Invalid recovery history.')
    return [...recovery.map(snapshot => parseSnapshot({ snapshot })), parseSnapshot(row)]
  })
  const projects = groups.flat()
  // Validate every referenced source file before importing any project.
  const imported = new Map<string, string>()
  for (const id of new Set(projects.flatMap(snapshot => snapshot.assetIds ?? []))) {
    const entry = zip.file(`assets/${id}`), meta = zip.file(`assets/${id}.json`)
    if (!entry || !meta) throw new Error('Backup source files are incomplete.')
  }
  for (const id of new Set(projects.flatMap(snapshot => snapshot.assetIds ?? []))) {
    const meta: unknown = JSON.parse(await zip.file(`assets/${id}.json`)!.async('string'))
    if (!meta || typeof meta !== 'object' || !('name' in meta) || typeof meta.name !== 'string') throw new Error('Invalid source metadata.')
    const type = 'type' in meta && typeof meta.type === 'string' ? meta.type : ''
    const blob = new Blob([await zip.file(`assets/${id}`)!.async('arraybuffer')], { type })
    imported.set(id, await putAsset(blob, meta.name))
  }
  let count = 0
  try {
    for (const group of groups) {
      const id = crypto.randomUUID()
      let revision = 0
      try {
        for (const snapshot of group) await projectRepository.save(id, { ...snapshot, assetIds: snapshot.assetIds?.map(id => imported.get(id)!), offlineBasemap: snapshot.offlineBasemap ? { ...snapshot.offlineBasemap, assetId: imported.get(snapshot.offlineBasemap.assetId)! } : undefined }, revision++, false)
      } catch (error) { await projectRepository.delete(id); throw error }
      count++
    }
  } catch (error) { throw new Error(`Restored ${count} projects before storage failed. Existing projects are unchanged. ${error instanceof Error ? error.message : ''}`) }
  return count
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
