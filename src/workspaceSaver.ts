/** Schedule expensive structured-clone writes in their own task. Writes stay ordered;
 * newer snapshots replace only writes that have not started, never an active save. */
export function createWorkspaceSaver<T>(write: (value: T) => Promise<unknown>, onError: (error: unknown) => void) {
  let pending: { value: T } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let flushing = false
  const scheduleDrain = () => {
    if (!active && pending && timer === undefined) timer = setTimeout(drain, 0)
  }
  function drain() {
    timer = undefined
    if (active || !pending) return
    const { value } = pending
    pending = undefined
    active = true
    // Calling write here starts IndexedDB in this task, rather than React's commit task.
    let result: Promise<unknown>
    try { result = write(value) } catch (error) { result = Promise.reject(error) }
    void result.catch(onError).finally(() => {
      active = false
      if (flushing) { flushing = false; drain() } else scheduleDrain()
    })
  }
  return {
    schedule(value: T) { pending = { value }; scheduleDrain() },
    flush() {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      if (active) flushing = true
      else drain()
    },
    flushOnExit(value: T) {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      pending = undefined
      flushing = false
      // The production writer creates readwrite transactions on the same IndexedDB
      // store, which commit in submission order. Submit now: page dismissal may
      // prevent an earlier transaction's completion callback from ever executing.
      try { void write(value).catch(onError) } catch (error) { onError(error) }
    },
  }
}
