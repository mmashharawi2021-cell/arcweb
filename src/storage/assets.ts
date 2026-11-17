import { projectRepository } from './projectRepository'

export interface AssetInfo { id: string; name: string; size: number; type: string; location: 'opfs' | 'indexeddb'; createdAt?: number; blob?: Blob }
const finish = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Asset storage aborted.')) })
export async function putAsset(blob: Blob, name: string): Promise<string> {
  const id = crypto.randomUUID()
  let directory: FileSystemDirectoryHandle | undefined
  if (typeof navigator.storage?.getDirectory === 'function') {
    try { directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('arcweb-assets', { create: true }) }
    catch (error) { if (error instanceof DOMException && error.name === 'QuotaExceededError') throw error }
  }
  const info: AssetInfo = { id, name, size: blob.size, type: blob.type, location: directory ? 'opfs' : 'indexeddb', createdAt: Date.now() }
  try {
    if (directory) {
      const file = await directory.getFileHandle(id, { create: true })
      const writer = await file.createWritable()
      try { await writer.write(blob); await writer.close() } catch (error) { await writer.abort().catch(() => undefined); throw error }
    } else info.blob = blob
    const db = await projectRepository.database(), tx = db.transaction('assets', 'readwrite'), done = finish(tx)
    tx.objectStore('assets').put(info, id)
    await done
    return id
  } catch (error) { if (directory) await directory.removeEntry(id).catch(() => undefined); throw error }
}
export async function assetInfo(id: string): Promise<AssetInfo | undefined> {
  const db = await projectRepository.database()
  return new Promise((resolve, reject) => { const query = db.transaction('assets').objectStore('assets').get(id); query.onsuccess = () => resolve(query.result as AssetInfo | undefined); query.onerror = () => reject(query.error) })
}
export async function getAsset(id: string): Promise<Blob> {
  const info = await assetInfo(id)
  if (!info) throw new Error('A saved source file is missing. Restore a backup.')
  if (info.location === 'indexeddb' && info.blob) return info.blob
  const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('arcweb-assets')
  const blob = await (await directory.getFileHandle(id)).getFile()
  if (blob.size !== info.size) throw new Error('A saved source file is incomplete.')
  return blob
}

/** Keep a one-day grace period for source imports that have not committed a project yet. */
export async function collectUnusedAssets(): Promise<number> {
  const db = await projectRepository.database()
  const tx = db.transaction(['projects', 'revisions', 'assets'], 'readwrite'), done = finish(tx)
  const read = (name: string) => new Promise<unknown[]>((resolve, reject) => { const query = tx.objectStore(name).getAll(); query.onsuccess = () => resolve(query.result); query.onerror = () => reject(query.error) })
  const [projects, revisions, assets] = await Promise.all(['projects', 'revisions', 'assets'].map(read))
  const live = new Set<string>()
  for (const value of [...projects, ...revisions]) {
    if (value && typeof value === 'object' && 'snapshot' in value && value.snapshot && typeof value.snapshot === 'object' && 'assetIds' in value.snapshot && Array.isArray(value.snapshot.assetIds)) {
      for (const id of value.snapshot.assetIds) if (typeof id === 'string') live.add(id)
    }
  }
  const removed: AssetInfo[] = []
  for (const value of assets) {
    const asset = value as AssetInfo
    if (!live.has(asset.id) && asset.createdAt && asset.createdAt < Date.now() - 86_400_000) {
      tx.objectStore('assets').delete(asset.id); removed.push(asset)
    }
  }
  await done
  if (removed.some(asset => asset.location === 'opfs')) {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('arcweb-assets')
    for (const asset of removed) if (asset.location === 'opfs') await directory.removeEntry(asset.id).catch(() => undefined)
  }
  return removed.length
}
