import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenderWarmup } from './renderWarmup'
import type { CollectionRef } from './projectRepository'

const refs = (key: string): CollectionRef[] => [{ header: { type: 'FeatureCollection' }, chunks: [key] }]
afterEach(() => vi.useRealTimers())

describe('descriptor-only post-commit warmup', () => {
  it('defers work, coalesces identical saves and skips already completed descriptors', async () => {
    vi.useFakeTimers()
    const prepare = vi.fn(async () => {})
    const queue = new RenderWarmup(prepare)
    queue.schedule(refs('one')); queue.schedule(refs('one'))
    expect(prepare).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(prepare).toHaveBeenCalledTimes(1)
    queue.schedule(refs('one'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(prepare).toHaveBeenCalledTimes(1)
    queue.stop()
  })

  it('cancels superseded pending and running versions without letting old completion clear the new job', async () => {
    vi.useFakeTimers()
    const pending: (() => void)[] = [], signals: AbortSignal[] = []
    const prepare = vi.fn((_refs: CollectionRef[], signal: AbortSignal) => {
      signals.push(signal); return new Promise<void>(resolve => pending.push(resolve))
    })
    const queue = new RenderWarmup(prepare)
    queue.schedule(refs('obsolete')); queue.schedule(refs('one'))
    await vi.advanceTimersByTimeAsync(1000)
    queue.schedule(refs('two'))
    expect(signals[0].aborted).toBe(true)
    pending[0]()
    await vi.advanceTimersByTimeAsync(1000)
    expect(prepare.mock.calls.map(call => call[0][0].chunks[0])).toEqual(['one', 'two'])
    expect(signals[1].aborted).toBe(false)
    pending[1](); queue.stop()
  })

  it('lets a reader start and join a scheduled version instead of starting duplicate work', async () => {
    vi.useFakeTimers()
    let finish = () => {}
    const prepare = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const queue = new RenderWarmup(prepare)
    queue.schedule(refs('one'))
    const reader = queue.wait(refs('one'))
    await vi.advanceTimersByTimeAsync(0)
    expect(prepare).toHaveBeenCalledTimes(1)
    finish(); await reader
    await vi.advanceTimersByTimeAsync(2000)
    expect(prepare).toHaveBeenCalledTimes(1)
    queue.stop()
  })

  it('settles readers and aborts active work on close, and tolerates preparation failure', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const queue = new RenderWarmup(async (_refs, current) => {
      signal = current
      await new Promise<void>(resolve => current.addEventListener('abort', () => resolve(), { once: true }))
    })
    queue.schedule(refs('one'))
    const reader = queue.wait(refs('one'))
    await vi.advanceTimersByTimeAsync(0)
    queue.stop()
    await reader
    expect(signal?.aborted).toBe(true)
    const failing = new RenderWarmup(async () => { throw new Error('optional cache failed') })
    failing.schedule(refs('bad'))
    await failing.wait(refs('bad'))
    failing.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
