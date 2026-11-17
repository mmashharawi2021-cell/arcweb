import type { SaveState } from '../storage/projectSession'

type Notify = (message: string, kind?: 'success' | 'error' | 'warning') => void

interface SavableLibrary {
  state: SaveState
  error: string
  flush: () => Promise<void>
}

/**
 * Quick Access Save / Ctrl+S. Projects save automatically; this commits pending changes now.
 * It only reports success when the library session can actually write: while loading, or
 * after the session failed, flush resolves without saving anything.
 */
export async function saveProjectNow(library: SavableLibrary, notify: Notify): Promise<void> {
  if (library.state === 'loading') {
    notify('The project is still loading. Nothing to save yet.', 'warning')
    return
  }
  if (library.state === 'error') {
    notify(`Saving is unavailable: ${library.error || 'project storage failed.'} Export a backup from Project › Projects & offline.`, 'error')
    return
  }
  try {
    await library.flush()
    notify('Project saved on this device.')
  } catch (error) {
    notify(`Could not save: ${error instanceof Error ? error.message : 'IndexedDB error'}`, 'error')
  }
}
