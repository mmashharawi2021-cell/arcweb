import { describe, expect, it, vi } from 'vitest'
import { saveProjectNow } from '../shell/saveProjectNow'

describe('saveProjectNow (Quick Access Save / Ctrl+S)', () => {
  it('commits pending changes and confirms', async () => {
    const flush = vi.fn(async () => undefined)
    const notify = vi.fn()
    await saveProjectNow({ state: 'saved', error: '', flush }, notify)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Project saved on this device.')
  })

  it('does not claim success while the project is still loading', async () => {
    const flush = vi.fn(async () => undefined)
    const notify = vi.fn()
    await saveProjectNow({ state: 'loading', error: '', flush }, notify)
    expect(flush).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('The project is still loading. Nothing to save yet.', 'warning')
  })

  it('reports that saving is unavailable after a storage failure', async () => {
    const flush = vi.fn(async () => undefined)
    const notify = vi.fn()
    await saveProjectNow({ state: 'error', error: 'The active project is missing.', flush }, notify)
    expect(flush).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('Saving is unavailable: The active project is missing. Export a backup from Project › Projects & offline.', 'error')
  })

  it('reports a failed save', async () => {
    const notify = vi.fn()
    await saveProjectNow({ state: 'saved', error: '', flush: async () => { throw new Error('Quota exceeded') } }, notify)
    expect(notify).toHaveBeenCalledWith('Could not save: Quota exceeded', 'error')
  })
})
