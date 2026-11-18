import { useArcWebStore } from '../store'
import { saveUiSettings } from './uiSettings'

/**
 * Saves interface preferences whenever the theme, measure units or coordinate format change.
 * Returns the unsubscribe function.
 */
export function startUiSettingsSync(): () => void {
  return useArcWebStore.subscribe((next, prior) => {
    if (next.theme === prior.theme && next.measureUnits === prior.measureUnits && next.coordinateFormat === prior.coordinateFormat && next.snapping === prior.snapping) return
    saveUiSettings({ snapping: next.snapping, theme: next.theme, measureUnits: next.measureUnits, coordinateFormat: next.coordinateFormat })
  })
}
