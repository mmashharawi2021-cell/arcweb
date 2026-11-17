// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ExtentHistory, type Extent } from '../extentHistory'
import { useExtentHistory } from '../useExtentHistory'
import { renderHook } from '../../__tests__/helpers/renderHook'

const at = (x: number, zoom = 10): Extent => ({ center: [x, 31.5], zoom, bearing: 0, pitch: 0 })

describe('ExtentHistory', () => {
  it('records extents and steps back and forward', () => {
    const history = new ExtentHistory()
    history.record(at(1)); history.record(at(2)); history.record(at(3))
    expect(history.canBack).toBe(true)
    expect(history.canForward).toBe(false)
    expect(history.back()).toEqual(at(2))
    history.record(at(2)) // the moveend caused by that navigation
    expect(history.back()).toEqual(at(1))
    history.record(at(1))
    expect(history.canBack).toBe(false)
    expect(history.back()).toBeNull()
    expect(history.forward()).toEqual(at(2))
  })

  it('recording after going back drops the forward stack', () => {
    const history = new ExtentHistory()
    history.record(at(1)); history.record(at(2)); history.record(at(3))
    history.back(); history.record(at(2))
    history.record(at(9))
    expect(history.canForward).toBe(false)
    expect(history.back()).toEqual(at(2))
  })

  it('ignores the moveend caused by its own navigation', () => {
    const history = new ExtentHistory()
    history.record(at(1)); history.record(at(2))
    history.back()
    // The animation may land slightly off the stored extent; it must not become a new entry.
    history.record({ ...at(1), zoom: 10.0004 })
    expect(history.canForward).toBe(true)
    expect(history.forward()).toEqual(at(2))
  })

  it('keeps at most 50 entries', () => {
    const history = new ExtentHistory()
    for (let x = 0; x < 60; x += 1) history.record(at(x))
    let steps = 0
    while (history.canBack) { history.record(history.back()!); steps += 1 }
    expect(steps).toBe(49)
  })

  it('does not record an extent equal to the current one', () => {
    const history = new ExtentHistory()
    history.record(at(1)); history.record(at(1)); history.record({ ...at(1), zoom: 10.0000001 })
    expect(history.canBack).toBe(false)
  })
})

function fakeMap(initial: Extent) {
  let extent = initial
  const listeners: Record<string, (() => void)[]> = {}
  return {
    move(next: Extent) { extent = next; listeners.moveend?.forEach((listener) => listener()) },
    getCenter: () => ({ lng: extent.center[0], lat: extent.center[1] }),
    getZoom: () => extent.zoom,
    getBearing: () => extent.bearing,
    getPitch: () => extent.pitch,
    jumpTo: vi.fn((next: Partial<Extent>) => { extent = { ...extent, ...next } as Extent; listeners.moveend?.forEach((listener) => listener()) }),
    on: (type: string, listener: () => void) => { (listeners[type] ??= []).push(listener) },
    off: (type: string, listener: () => void) => { listeners[type] = (listeners[type] ?? []).filter((item) => item !== listener) },
  }
}

describe('useExtentHistory', () => {
  it('tracks map moves and navigates back and forward', () => {
    const map = fakeMap(at(1))
    const { result } = renderHook(() => useExtentHistory(map as unknown as MapLibreMap), undefined)
    expect(result.current.canGoBack).toBe(false)
    act(() => map.move(at(2)))
    act(() => map.move(at(3)))
    expect(result.current.canGoBack).toBe(true)
    act(() => result.current.goBack())
    expect(map.jumpTo).toHaveBeenLastCalledWith(at(2))
    expect(result.current.canGoForward).toBe(true)
    act(() => result.current.goForward())
    expect(map.jumpTo).toHaveBeenLastCalledWith(at(3))
    expect(result.current.canGoForward).toBe(false)
  })

  it('does nothing without a map', () => {
    const { result } = renderHook(() => useExtentHistory(null), undefined)
    expect(result.current.canGoBack).toBe(false)
    expect(() => result.current.goBack()).not.toThrow()
  })
})
