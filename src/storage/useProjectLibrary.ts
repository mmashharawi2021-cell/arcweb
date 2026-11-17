import { useCallback, useEffect, useRef, useState } from 'react'
import { useArcWebStore } from '../store'
import { useLayoutStore } from '../layout/layoutStore'
import { projectRepository, type WorkspaceSnapshot } from './projectRepository'
import { ProjectSession, type SaveState } from './projectSession'
import { readLegacyWorkspace } from './legacyMigration'

export function useProjectLibrary(capture: () => WorkspaceSnapshot, restore: (snapshot: WorkspaceSnapshot) => void) {
  const session = useRef<ProjectSession | null>(null)
  const [state, setState] = useState<SaveState>('loading')
  const [error, setError] = useState('')
  const [projectId, setProjectId] = useState('')
  useEffect(() => {
    let active = true
    const controller = new ProjectSession(projectRepository, capture, restore, (status, message) => {
      if (active) { setState(status); setError(message ?? ''); setProjectId(controller.id) }
    })
    session.current = controller
    // StrictMode cancels the first effect before starting any migration or write.
    queueMicrotask(() => {
      if (!active) return
      void controller.initialize(() => readLegacyWorkspace(capture())).catch((error: unknown) => {
        if (active) { setState('error'); setError(error instanceof Error ? error.message : 'Could not open project storage.') }
      })
    })
    const relevant = (state: ReturnType<typeof useArcWebStore.getState>) => [state.layers, state.editSnapshots, state.basemap, state.displayCrs, state.bookmarks, state.projectName, state.workspaceLayout, state.sceneSettings, state.analysisHistory, state.tableViews]
    const unsubscribe = useArcWebStore.subscribe((next, prior) => {
      const before = relevant(prior)
      if (relevant(next).some((value, index) => value !== before[index])) controller.schedule(next.layers !== prior.layers || next.editSnapshots !== prior.editSnapshots ? 0 : 300)
    })
    const unsubscribeLayout = useLayoutStore.subscribe((next, prior) => {
      if (next.paper !== prior.paper || next.orientation !== prior.orientation || next.elements !== prior.elements) controller.schedule()
    })
    const flush = () => { void controller.flush().catch(() => undefined) }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!controller.hasUnsavedChanges) return
      flush()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      unsubscribe(); unsubscribeLayout()
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('visibilitychange', onVisibility)
      if (controller.ready) flush()
      controller.stop()
    }
  }, [capture, restore])
  const schedule = useCallback(() => session.current?.schedule(), [])
  const flush = useCallback(() => session.current?.flush() ?? Promise.resolve(), [])
  const open = useCallback(async (id: string) => { await session.current?.open(id); setProjectId(session.current?.id ?? '') }, [])
  const create = useCallback(async (snapshot: WorkspaceSnapshot, preserveCurrent = true) => {
    await session.current?.create(snapshot, preserveCurrent); setProjectId(session.current?.id ?? '')
  }, [])
  const recover = useCallback(async (revision: number) => { await session.current?.recover(revision) }, [])
  return { state, error, projectId, schedule, flush, open, create, recover }
}
