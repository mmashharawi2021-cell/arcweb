import { ProjectRepository, type WorkspaceSnapshot } from './projectRepository'

export type SaveState = 'loading' | 'saving' | 'saved' | 'error'
export class ProjectSession {
  id = ''
  revision = 0
  ready = false
  busy = false
  private timer?: ReturnType<typeof setTimeout>
  private dirty = false
  private pendingWrites = 0
  get hasUnsavedChanges() { return this.ready && (this.dirty || this.pendingWrites > 0) }
  private stopped = false
  private queue: Promise<unknown> = Promise.resolve()
  private capture: () => WorkspaceSnapshot
  private restore: (snapshot: WorkspaceSnapshot) => void
  private status: (state: SaveState, message?: string) => void
  readonly repository: ProjectRepository
  constructor(repository: ProjectRepository, capture: () => WorkspaceSnapshot, restore: (snapshot: WorkspaceSnapshot) => void, status: (state: SaveState, message?: string) => void) {
    this.repository = repository; this.capture = capture; this.restore = restore; this.status = status
  }
  async initialize(legacy: () => Promise<WorkspaceSnapshot>) {
    const active = await this.repository.activeId()
    const selected = active ?? (await this.repository.list())[0]?.id
    const saved = selected ? await this.repository.load(selected) : null
    if (this.stopped) return
    if (active && !saved) throw new Error('The active project is missing. Open another project from the library; existing data was not replaced.')
    if (saved) { this.id = saved.summary.id; this.revision = saved.summary.revision; if (!active) await this.repository.activate(this.id); if (this.stopped) return; this.restore(saved.snapshot) }
    else {
      const snapshot = await this.repository.initialized() ? this.capture() : await legacy()
      if (this.stopped) return
      this.id = crypto.randomUUID()
      const summary = await this.repository.save(this.id, snapshot, 0)
      if (this.stopped) return
      this.revision = summary.revision
      this.restore(snapshot)
    }
    this.ready = true
    this.status('saved')
  }
  schedule(delay = 300) {
    if (!this.ready || this.busy) return
    this.dirty = true
    this.status('saving')
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined) }, delay)
  }
  flush(): Promise<void> {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    if (!this.ready || this.busy) return Promise.resolve()
    if (!this.dirty) return this.queue.then(() => undefined)
    const snapshot = this.capture(), id = this.id
    this.dirty = false
    this.pendingWrites++
    this.status('saving')
    const save = this.queue.catch(() => undefined).then(async () => {
      const summary = await this.repository.save(id, snapshot, this.revision)
      this.revision = summary.revision
      if (!this.dirty && this.pendingWrites === 1) this.status('saved')
    }).catch((error: unknown) => { this.dirty = true; this.status('error', error instanceof Error ? error.message : 'Local storage failed.'); throw error })
    const tracked = save.finally(() => { this.pendingWrites-- })
    this.queue = tracked
    return tracked
  }
  async open(id: string) {
    await this.flush()
    this.busy = true
    try {
      const saved = await this.repository.load(id)
      if (!saved) throw new Error('This project no longer exists.')
      await this.repository.activate(id)
      this.id = id; this.revision = saved.summary.revision
      this.ready = true
      this.restore(saved.snapshot)
      this.status('saved')
    } finally { this.busy = false }
  }
  async create(snapshot: WorkspaceSnapshot, preserveCurrent = true) {
    if (preserveCurrent) await this.flush()
    else { if (this.timer !== undefined) clearTimeout(this.timer); await this.queue.catch(() => undefined) }
    this.busy = true
    try {
      const id = crypto.randomUUID()
      const saved = await this.repository.save(id, snapshot, 0)
      this.id = id; this.revision = saved.revision; this.ready = true
      this.restore(snapshot)
      this.dirty = false
      this.queue = Promise.resolve()
      this.status('saved')
    } finally { this.busy = false }
  }
  async recover(revision: number) {
    await this.flush()
    const saved = await this.repository.load(this.id, revision)
    if (!saved) throw new Error('That recovery point is no longer available.')
    this.busy = true
    try { this.restore(saved.snapshot) } finally { this.busy = false }
    this.dirty = true
    await this.flush()
  }
  stop() { if (this.timer !== undefined) clearTimeout(this.timer); this.stopped = true; this.ready = false }
}
