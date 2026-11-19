// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUiSettings, saveUiSettings } from '../ui/uiSettings'

const KEY = 'arcweb-ui-settings-v1'

/** Node 26 defines its own (undefined) global localStorage, which shadows happy-dom's; use a memory store. */
function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() { return items.size },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key) },
    setItem: (key, value) => { items.set(key, String(value)) },
  }
}

describe('UI settings', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('returns defaults (light, metric, dd) when storage is empty', () => {
    expect(loadUiSettings()).toEqual({ snapping: { enabled: true, tolerancePx: 10 }, theme: 'light', measureUnits: 'metric', coordinateFormat: 'dd' })
  })

  it('returns defaults when the stored value is corrupt', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(loadUiSettings()).toEqual({ snapping: { enabled: true, tolerancePx: 10 }, theme: 'light', measureUnits: 'metric', coordinateFormat: 'dd' })
  })

  it('round-trips saved settings', () => {
    saveUiSettings({ theme: 'light', measureUnits: 'nautical', coordinateFormat: 'dms' })
    expect(loadUiSettings()).toEqual({ snapping: { enabled: true, tolerancePx: 10 }, theme: 'light', measureUnits: 'nautical', coordinateFormat: 'dms' })
  })

  it('ignores unknown values field by field', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ theme: 'neon', measureUnits: 'imperial', coordinateFormat: 42 }))
    expect(loadUiSettings()).toEqual({ snapping: { enabled: true, tolerancePx: 10 }, theme: 'light', measureUnits: 'imperial', coordinateFormat: 'dd' })
  })

  it('keeps working when storage throws', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(loadUiSettings().theme).toBe('light')
    expect(() => saveUiSettings({ theme: 'light', measureUnits: 'metric', coordinateFormat: 'dd' })).not.toThrow()
  })
})
