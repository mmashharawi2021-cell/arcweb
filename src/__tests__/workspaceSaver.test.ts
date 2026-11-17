import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceSaver } from '../workspaceSaver'

afterEach(() => vi.useRealTimers())

describe('scheduled workspace saving', () => {
  it('submits the latest live snapshot on page exit without waiting for an earlier save callback', () => {
    vi.useFakeTimers()
    const submitted: number[] = []
    const saver = createWorkspaceSaver((value: number) => {
      submitted.push(value)
      return new Promise<void>(() => undefined)
    }, () => undefined)
    saver.schedule(1)
    saver.flush()
    saver.schedule(2)
    saver.flushOnExit(3)
    expect(submitted).toEqual([1, 3])
  })

  it('yields before expensive writes and coalesces changes before the scheduled save', async () => {
    vi.useFakeTimers()
    const saved: number[] = []
    const saver = createWorkspaceSaver(async (value: number) => { saved.push(value) }, () => undefined)
    saver.schedule(1)
    saver.schedule(2)
    expect(saved).toEqual([])
    await vi.runAllTimersAsync()
    expect(saved).toEqual([2])
  })

  it('flushes the latest pending value and serializes writes so stale saves cannot finish last', async () => {
    vi.useFakeTimers()
    const saved: number[] = []
    let finishFirst: () => void = () => undefined
    const first = new Promise<void>((resolve) => { finishFirst = resolve })
    const saver = createWorkspaceSaver(async (value: number) => { if (value === 1) await first; saved.push(value) }, () => undefined)
    saver.schedule(1)
    saver.flush()
    saver.schedule(2)
    saver.schedule(3)
    saver.flush()
    expect(saved).toEqual([])
    finishFirst()
    await vi.runAllTimersAsync()
    expect(saved).toEqual([1, 3])
  })

  it('reports failed storage and still saves a subsequent workspace', async () => {
    vi.useFakeTimers()
    const failures: unknown[] = []
    const saved: number[] = []
    const saver = createWorkspaceSaver(async (value: number) => {
      if (value === 1) throw new Error('storage full')
      saved.push(value)
    }, (error) => failures.push(error))
    saver.schedule(1)
    await vi.runAllTimersAsync()
    saver.schedule(2)
    await vi.runAllTimersAsync()
    expect(failures).toHaveLength(1)
    expect(saved).toEqual([2])
  })
})
