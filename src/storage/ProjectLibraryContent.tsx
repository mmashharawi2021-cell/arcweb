import { useEffect, useRef, useState } from 'react'
import { projectRepository, type ProjectSummary, type WorkspaceSnapshot } from './projectRepository'
import { downloadBlob, exportLibraryBackup, restoreLibraryBackup } from './backup'
import { importOfflineBasemap, type OfflineBasemap } from './offlineBasemap'
import { collectUnusedAssets } from './assets'
import OfflineAreaDownload from './OfflineAreaDownload'
import type { AreaBounds } from './areaDownload'
import { isolate } from '../bidi'

export type LibrarySection = 'projects' | 'recovery' | 'backup' | 'offline'
const ALL_SECTIONS: LibrarySection[] = ['projects', 'recovery', 'backup', 'offline']

export interface ProjectLibraryContentProps {
  projectId: string
  capture: () => WorkspaceSnapshot
  onOpen: (id: string) => Promise<void>
  onCreate: (snapshot: WorkspaceSnapshot, preserveCurrent?: boolean) => Promise<void>
  onFlush: () => Promise<void>
  onRecover: (revision: number) => Promise<void>
  onOffline: (basemap: OfflineBasemap | undefined) => void
  getBounds: () => AreaBounds | null
  /** Which parts to show; all by default. */
  sections?: LibrarySection[]
  /** Called after an action that replaces the workspace (new or opened project). */
  onDone?: () => void
  /** Reports whether a storage operation is running, so a host can block closing. */
  onBusyChange?: (busy: boolean) => void
  /** Focus "New project" on mount (the modal dialog does; the backstage manages its own focus). */
  autoFocusFirst?: boolean
}

const size = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB`

/** The local project library: projects, recovery points, backups and offline basemaps. */
export default function ProjectLibraryContent({
  projectId, capture, onOpen, onCreate, onFlush, onRecover, onOffline, getBounds, sections = ALL_SECTIONS, onDone, onBusyChange, autoFocusFirst = false,
}: ProjectLibraryContentProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [revisions, setRevisions] = useState<ProjectSummary[]>([])
  const [busy, setBusyState] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState('')
  const [storage, setStorage] = useState({ usage: 0, quota: 0, persistent: false })
  const backupInput = useRef<HTMLInputElement>(null), tilesInput = useRef<HTMLInputElement>(null)
  const show = (section: LibrarySection) => sections.includes(section)
  const setBusy = (value: boolean) => { setBusyState(value); onBusyChange?.(value) }
  const done = () => onDone?.()

  const refresh = async () => {
    const [rows, versions, estimate, persistent] = await Promise.all([
      projectRepository.list(), projectId ? projectRepository.revisions(projectId) : Promise.resolve([]),
      navigator.storage?.estimate?.() ?? Promise.resolve({ usage: 0, quota: 0 }), navigator.storage?.persisted?.() ?? Promise.resolve(false),
    ])
    setProjects(rows); setRevisions(versions)
    setStorage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persistent })
  }
  useEffect(() => {
    let active = true
    void Promise.all([projectRepository.list(), projectId ? projectRepository.revisions(projectId) : Promise.resolve([])]).then(([rows, versions]) => {
      if (active) { setProjects(rows); setRevisions(versions) }
    }).catch(error => { if (active) setError(String(error)) })
    void navigator.storage?.estimate?.().then(estimate => { if (active) setStorage(prior => ({ ...prior, usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 })) })
    void navigator.storage?.persisted?.().then(persistent => { if (active) setStorage(prior => ({ ...prior, persistent })) })
    return () => { active = false }
  }, [projectId])
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await action(); await refresh() }
    catch (error) { setError(error instanceof Error ? error.message : 'Local storage operation failed.') }
    finally { setBusy(false) }
  }

  return <div className="project-library-content" aria-busy={busy}>
    {show('projects') && <>
      <p className="modal-note">Projects save automatically. Browser storage belongs to this address and browser profile. Export a backup to protect against cleared browser data.</p>
      <div className="library-actions">
        <button autoFocus={autoFocusFirst} className="phase-primary-button" disabled={busy} onClick={() => void run(async () => {
          const current = capture()
          await onCreate({ project: { ...current.project, name: 'Untitled map', layers: [], map: { ...current.project.map, bookmarks: [] }, analysisHistory: [], tableViews: {}, layout: { ...current.project.layout, elements: [] } }, editSnapshots: {} })
          done()
        })}>New project</button>
        <button className="phase-secondary-button" disabled={busy} onClick={() => void run(async () => { const current = capture(); await onCreate({ ...current, project: { ...current.project, name: `${current.project.name} — copy` } }, false); setMessage('Saved as a separate project.') })}>Save as new copy</button>
        <button className="phase-secondary-button" disabled={busy} onClick={() => void run(async () => { await onFlush(); setMessage('Project saved.'); })}>Save now</button>
      </div>
      <div className="library-projects">
        {projects.map(project => <article key={project.id} className="library-project-card">
          <div><strong dir="auto">{project.name}</strong><small>{project.layerCount} layers · {project.featureCount.toLocaleString('en-US')} features · {new Date(project.modifiedAt).toLocaleString()}</small></div>
          {project.id === projectId ? <span>Current</span> : <button disabled={busy} className="phase-secondary-button" onClick={() => void run(async () => { await onOpen(project.id); done() })}>Open</button>}
          {project.id !== projectId && <button disabled={busy} className="phase-danger-button" onClick={() => {
            if (confirmDelete !== project.id) { setConfirmDelete(project.id); return }
            void run(async () => { await projectRepository.delete(project.id); await projectRepository.collectUnused(); setConfirmDelete('') })
          }}>{confirmDelete === project.id ? 'Confirm delete' : 'Delete'}</button>}
        </article>)}
      </div>
    </>}
    {show('recovery') && <>
      <h3>Recovery points</h3>
      <p className="modal-note">The last five committed versions are kept. Restoring creates a new version.</p>
      <div className="library-actions">{revisions.map((revision, index) => <button key={revision.revision} disabled={busy || index === 0} className="phase-secondary-button" onClick={() => void run(async () => { await onRecover(revision.revision); setMessage('Recovery point restored.') })}>v{revision.revision} · {new Date(revision.modifiedAt).toLocaleTimeString()}</button>)}</div>
    </>}
    {show('backup') && <>
      <h3>Backup and storage</h3>
      <p>{size(storage.usage)} used / {size(storage.quota)} available quota · {storage.persistent ? 'Persistent storage granted' : 'Persistence not granted'}</p>
      <div className="library-actions">
        <button disabled={busy} className="phase-secondary-button" onClick={() => void run(async () => { await onFlush(); downloadBlob(await exportLibraryBackup(), 'arcweb-library-backup.zip'); setMessage('Backup downloaded: saved projects, edit recovery and original source files.') })}>Export full backup</button>
        <button disabled={busy} className="phase-secondary-button" onClick={() => backupInput.current?.click()}>Restore backup</button>
        <button disabled={busy || storage.persistent} className="phase-secondary-button" onClick={() => void run(async () => { const granted = await navigator.storage?.persist?.(); setMessage(granted ? 'Persistent storage granted. Keep external backups too.' : 'The browser did not grant persistence. Keep external backups.'); })}>Protect local storage</button>
        <button disabled={busy} className="phase-secondary-button" onClick={() => void run(async () => { const count = await projectRepository.collectUnused(); const assets = await collectUnusedAssets(); setMessage(`Removed ${count} unused data chunks and ${assets} old unreferenced files. Projects and recovery points are preserved.`) })}>Clean unused data</button>
      </div>
      <input ref={backupInput} className="visually-hidden" type="file" accept=".zip" tabIndex={-1} aria-label="Choose library backup" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void run(async () => { const count = await restoreLibraryBackup(file); setMessage(`Restored ${count} projects as separate copies.`) }) }} />
    </>}
    {show('offline') && <>
      <h3>Offline basemap</h3>
      <p className="modal-note">Import a local XYZ tile ZIP with metadata.json and tiles/z/x/y.png (or jpg/webp), or download NASA regional imagery below. Local package limit: 250 MB.</p>
      <div className="library-actions">
        <button disabled={busy} className="phase-secondary-button" onClick={() => tilesInput.current?.click()}>Import offline basemap</button>
        <button disabled={busy} className="phase-secondary-button" onClick={() => { onOffline(undefined); setMessage('Online basemap enabled.') }}>Use online basemap</button>
      </div>
      <input ref={tilesInput} className="visually-hidden" type="file" accept=".zip" tabIndex={-1} aria-label="Choose offline tile package" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void run(async () => { const basemap = await importOfflineBasemap(file); onOffline(basemap); await onFlush(); setMessage(`Offline basemap ready: ${isolate(basemap.name)}.`) }) }} />
      <OfflineAreaDownload busy={busy} getBounds={getBounds} onRun={run} onDownloaded={async basemap => { onOffline(basemap); await onFlush(); setMessage(`Downloaded and saved: ${isolate(basemap.name)}.`) }} />
    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="library-error">{error}</p>}
  </div>
}
