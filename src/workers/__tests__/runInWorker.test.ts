import { describe, expect, it } from 'vitest'
import { runInWorker, type WorkerLike } from '../runInWorker'

class FakeWorker implements WorkerLike {
  posted: unknown[] = []
  terminated = 0
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message?: string }) => void) | null = null
  onmessageerror: ((event: unknown) => void) | null = null
  postMessage(message: unknown) { this.posted.push(message) }
  terminate() { this.terminated += 1 }
  emit(data: unknown) { this.onmessage?.({ data }) }
}

describe('runInWorker', () => {
  it('resolves with the result and terminates the worker', async () => {
    const worker = new FakeWorker()
    const promise = runInWorker<string, number>(() => worker, 'req')
    worker.emit({ kind: 'result', value: 42 })
    await expect(promise).resolves.toBe(42)
    expect(worker.posted).toEqual(['req'])
    expect(worker.terminated).toBe(1)
  })

  it('forwards progress replies to onProgress', async () => {
    const worker = new FakeWorker()
    const seen: unknown[] = []
    const promise = runInWorker<string, number>(() => worker, 'req', { onProgress: (p) => seen.push(p) })
    worker.emit({ kind: 'progress', current: 1, total: 2, message: 'Reading' })
    worker.emit({ kind: 'result', value: 1 })
    await promise
    expect(seen).toEqual([{ current: 1, total: 2, message: 'Reading' }])
  })

  it('rejects with the worker error message', async () => {
    const worker = new FakeWorker()
    const promise = runInWorker(() => worker, 'req')
    worker.emit({ kind: 'error', message: 'The CSV file is empty.' })
    await expect(promise).rejects.toThrow('The CSV file is empty.')
    expect(worker.terminated).toBe(1)
  })

  it('abort terminates and the next call uses a new worker', async () => {
    const workers: FakeWorker[] = []
    const factory = () => { const w = new FakeWorker(); workers.push(w); return w }
    const controller = new AbortController()
    const first = runInWorker(factory, 'a', { signal: controller.signal })
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = runInWorker<string, string>(factory, 'b')
    workers[1].emit({ kind: 'result', value: 'ok' })
    await expect(second).resolves.toBe('ok')
    expect(workers).toHaveLength(2)
    expect(workers[0].terminated).toBe(1)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    let calls = 0
    const controller = new AbortController()
    controller.abort()
    await expect(runInWorker(() => { calls += 1; return new FakeWorker() }, 'x', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(0)
  })

  it('rejects a malformed reply and terminates the worker', async () => {
    for (const reply of [null, 'text', 7, {}, { kind: 'bogus' }]) {
      const worker = new FakeWorker()
      const promise = runInWorker(() => worker, 'req')
      worker.emit(reply)
      await expect(promise).rejects.toThrow('Malformed worker reply.')
      expect(worker.terminated).toBe(1)
    }
  })

  it('rejects when the reply cannot be deserialized', async () => {
    const worker = new FakeWorker()
    const promise = runInWorker(() => worker, 'req')
    worker.onmessageerror?.({})
    await expect(promise).rejects.toThrow('The worker reply could not be read.')
    expect(worker.terminated).toBe(1)
  })

  it('ignores replies posted after an abort', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const seen: unknown[] = []
    const promise = runInWorker(() => worker, 'req', { signal: controller.signal, onProgress: (p) => seen.push(p) })
    const late = worker.onmessage
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    late?.({ data: { kind: 'progress', current: 1, total: 2, message: 'late' } })
    late?.({ data: { kind: 'result', value: 1 } })
    late?.({ data: { kind: 'error', message: 'late' } })
    expect(seen).toEqual([])
    expect(worker.terminated).toBe(1)
  })
})
