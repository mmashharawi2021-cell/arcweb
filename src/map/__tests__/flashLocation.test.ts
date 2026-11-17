// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'

const markers = vi.hoisted(() => [] as { element: HTMLElement; lngLat?: [number, number]; added: boolean; removed: boolean }[])
vi.mock('maplibre-gl', () => ({
  Marker: class {
    record: (typeof markers)[number]
    constructor(options: { element: HTMLElement }) { this.record = { element: options.element, added: false, removed: false }; markers.push(this.record) }
    setLngLat(lngLat: [number, number]) { this.record.lngLat = lngLat; return this }
    addTo() { this.record.added = true; return this }
    remove() { this.record.removed = true; return this }
  },
}))

const { flashLocation } = await import('../flashLocation')

describe('flashLocation', () => {
  afterEach(() => { vi.useRealTimers(); markers.length = 0 })

  it('shows a decorative pulse at the location and removes it afterwards', () => {
    vi.useFakeTimers()
    flashLocation({} as MapLibreMap, [34.45, 31.5])
    expect(markers).toHaveLength(1)
    expect(markers[0].lngLat).toEqual([34.45, 31.5])
    expect(markers[0].added).toBe(true)
    expect(markers[0].element.className).toBe('map-flash')
    expect(markers[0].element.getAttribute('aria-hidden')).toBe('true')
    vi.advanceTimersByTime(1599)
    expect(markers[0].removed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(markers[0].removed).toBe(true)
  })
})
