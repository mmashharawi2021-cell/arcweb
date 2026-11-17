// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'arcweb-ui-settings-v1'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial))
  return {
    get length() { return items.size },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key) },
    setItem: (key, value) => { items.set(key, String(value)) },
  }
}

describe('UI settings in the store', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('starts from the saved preferences', async () => {
    vi.stubGlobal('localStorage', memoryStorage({ [KEY]: JSON.stringify({ theme: 'light', measureUnits: 'imperial', coordinateFormat: 'utm' }) }))
    const { useArcWebStore } = await import('../store')
    const state = useArcWebStore.getState()
    expect(state.theme).toBe('light')
    expect(state.measureUnits).toBe('imperial')
    expect(state.coordinateFormat).toBe('utm')
  })

  it('saves preference changes, ignores unrelated changes, and stops when asked', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const { useArcWebStore } = await import('../store')
    const { startUiSettingsSync } = await import('../ui/uiSettingsSync')
    const setItem = vi.spyOn(storage, 'setItem')
    const stop = startUiSettingsSync()

    useArcWebStore.getState().setMeasureUnits('nautical')
    useArcWebStore.getState().setCoordinateFormat('dms')
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ theme: 'dark', measureUnits: 'nautical', coordinateFormat: 'dms' })

    setItem.mockClear()
    useArcWebStore.getState().setProjectName('Unrelated')
    expect(setItem).not.toHaveBeenCalled()

    stop()
    useArcWebStore.getState().setTheme('light')
    expect(setItem).not.toHaveBeenCalled()
  })
})
