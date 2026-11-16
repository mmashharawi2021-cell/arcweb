export interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

export type WorkerReply<R> =
  | { kind: 'progress'; current: number; total: number; message: string }
  | { kind: 'result'; value: R }
  | { kind: 'error'; message: string }

export interface RunInWorkerOptions {
  signal?: AbortSignal
  onProgress?: (progress: { current: number; total: number; message: string }) => void
}

const cancelled = () => new DOMException('Cancelled by user.', 'AbortError')

/** Runs one request in a fresh worker; the worker is always terminated when the call settles. */
export function runInWorker<Q, R>(createWorker: () => WorkerLike, request: Q, options: RunInWorkerOptions = {}): Promise<R> {
  const { signal, onProgress } = options
  if (signal?.aborted) return Promise.reject(cancelled())
  return new Promise<R>((resolve, reject) => {
    const worker = createWorker()
    let settled = false
    const settle = (finish: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      finish()
    }
    function onAbort() {
      settle(() => reject(cancelled()))
    }
    signal?.addEventListener('abort', onAbort)
    worker.onmessage = (event) => {
      const reply = event.data as WorkerReply<R>
      if (reply.kind === 'progress') onProgress?.({ current: reply.current, total: reply.total, message: reply.message })
      else if (reply.kind === 'result') settle(() => resolve(reply.value))
      else if (reply.kind === 'error') settle(() => reject(new Error(reply.message)))
    }
    worker.onerror = (event) => settle(() => reject(new Error(event.message || 'The worker failed unexpectedly.')))
    try {
      worker.postMessage(request)
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
  })
}
