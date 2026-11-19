/** Units for the Measure tool. */
export type LengthUnit = 'metric' | 'imperial' | 'nautical'
/** Coordinate notation in the status bar. */
export type CoordinateFormat = 'dd' | 'dms' | 'ddm' | 'utm'

/** Per-browser interface preferences (Backstage › Options). Not part of a project. */
export interface UiSettings {
  snapping?: { enabled: boolean; tolerancePx: number }
  theme: 'dark' | 'light'
  measureUnits: LengthUnit
  coordinateFormat: CoordinateFormat
}

const STORAGE_KEY = 'arcweb-ui-settings-v1'
const THEMES: readonly UiSettings['theme'][] = ['dark', 'light']
const UNITS: readonly LengthUnit[] = ['metric', 'imperial', 'nautical']
const FORMATS: readonly CoordinateFormat[] = ['dd', 'dms', 'ddm', 'utm']

export const DEFAULT_UI_SETTINGS: UiSettings = { theme: 'light', measureUnits: 'metric', coordinateFormat: 'dd' }

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

/** Reads saved preferences; unknown or unreadable values fall back to the defaults field by field. */
export function loadUiSettings(): UiSettings {
  let saved: Record<string, unknown> = {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>
  } catch {
    // Private mode, blocked storage or corrupt JSON: use defaults.
  }
  const snapping = saved.snapping as Record<string, unknown> | undefined
  return {
    snapping: {
      enabled: typeof snapping?.enabled === 'boolean' ? snapping.enabled : true,
      tolerancePx: typeof snapping?.tolerancePx === 'number' && Number.isFinite(snapping.tolerancePx) && snapping.tolerancePx > 0 && snapping.tolerancePx <= 100 ? snapping.tolerancePx : 10,
    },
    theme: pick(saved.theme, THEMES, DEFAULT_UI_SETTINGS.theme),
    measureUnits: pick(saved.measureUnits, UNITS, DEFAULT_UI_SETTINGS.measureUnits),
    coordinateFormat: pick(saved.coordinateFormat, FORMATS, DEFAULT_UI_SETTINGS.coordinateFormat),
  }
}

export function saveUiSettings(settings: UiSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Preferences are a convenience; failing to store them must not break the app.
  }
}
