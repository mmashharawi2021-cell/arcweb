import type { CollectionRef } from './projectRepository'

/** At most one descriptor-only background job. New versions supersede old work;
 * readers of the same version join it instead of allocating a second worker. */
export class RenderWarmup {
  private job?: { key: string; refs: CollectionRef[]; controller: AbortController; done: Promise<void>; finish: () => void; started: boolean }
  private completedKey?: string
  private timer?: ReturnType<typeof setTimeout>
  private prepare: (refs: CollectionRef[], signal: AbortSignal) => Promise<void>
  constructor(prepare: (refs: CollectionRef[], signal: AbortSignal) => Promise<void>) { this.prepare = prepare }
  schedule(refs: CollectionRef[]) {
    const key = JSON.stringify(refs)
    if (key === this.job?.key || key === this.completedKey) return
    this.stop()
    if (!refs.length) return
    let finish = () => {}
    const done = new Promise<void>(resolve => { finish = resolve })
    this.job = { key, refs, controller: new AbortController(), done, finish, started: false }
    this.timer = setTimeout(() => this.start(), 1000)
  }
  private start() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    const job = this.job
    if (!job || job.started) return
    job.started = true
    void Promise.resolve().then(() => this.prepare(job.refs, job.controller.signal)).then(() => {
      if (!job.controller.signal.aborted && this.job === job) this.completedKey = job.key
    }).catch(() => undefined).finally(() => {
      if (this.job === job) this.job = undefined
      job.finish()
    })
  }
  async wait(refs: CollectionRef[]) {
    const job = this.job
    if (job?.key !== JSON.stringify(refs)) return
    this.start()
    await job.done
  }
  stop() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    this.job?.controller.abort()
    this.job?.finish()
    this.job = undefined
    this.completedKey = undefined
  }
}
