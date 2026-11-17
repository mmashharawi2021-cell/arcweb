// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { createMapLayer } from '../../geo'
import { useArcWebStore, type MapLayer } from '../../store'
import { renderHook } from '../../__tests__/helpers/renderHook'

const intersects = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@turf/boolean-intersects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@turf/boolean-intersects')>()
  return { ...actual, default: (...args: Parameters<typeof actual.default>) => { intersects.calls += 1; return actual.default(...args) } }
})

const { applyBoxSelection, featuresInBox } = await import('../boxSelect')
const { useBoxSelect } = await import('../useBoxSelect')

const feature = (id: string, geometry: Geometry): Feature => ({ type: 'Feature', id, properties: {}, geometry })
function layer(name: string, features: Feature[], visible = true): MapLayer {
  return { ...createMapLayer(name, { type: 'FeatureCollection', features } as FeatureCollection), visible }
}

const box: [number, number, number, number] = [0, 0, 10, 10]

describe('featuresInBox', () => {
  beforeEach(() => { intersects.calls = 0 })

  it('includes points inside and polygons that partly overlap', () => {
    const points = layer('Wells', [feature('in', { type: 'Point', coordinates: [5, 5] }), feature('out', { type: 'Point', coordinates: [20, 5] })])
    const zones = layer('Zones', [feature('overlap', { type: 'Polygon', coordinates: [[[8, 8], [15, 8], [15, 15], [8, 15], [8, 8]]] })])
    expect(featuresInBox([points, zones], box)).toEqual({ [points.id]: ['in'], [zones.id]: ['overlap'] })
  })

  it('includes a polygon that contains the whole box', () => {
    const zones = layer('Zones', [feature('around', { type: 'Polygon', coordinates: [[[-5, -5], [20, -5], [20, 20], [-5, 20], [-5, -5]]] })])
    expect(featuresInBox([zones], box)).toEqual({ [zones.id]: ['around'] })
  })

  it('excludes lines outside the box, even when their extent overlaps it', () => {
    // An L-shaped line around the box corner: its extent overlaps the box, the line itself does not.
    const roads = layer('Roads', [feature('around', { type: 'LineString', coordinates: [[-5, 12], [12, 12], [12, -5]] })])
    expect(featuresInBox([roads], box)).toEqual({})
  })

  it('skips hidden layers and features without geometry', () => {
    const hidden = layer('Hidden', [feature('in', { type: 'Point', coordinates: [5, 5] })], false)
    const table = layer('Table', [{ type: 'Feature', id: 'row', properties: {}, geometry: null as unknown as Geometry }])
    expect(featuresInBox([hidden, table], box)).toEqual({})
  })

  it('uses bbox prefilter', () => {
    const roads = layer('Roads', [
      feature('far', { type: 'LineString', coordinates: [[50, 50], [60, 60]] }),
      feature('inside', { type: 'LineString', coordinates: [[1, 1], [2, 2]] }),
    ])
    expect(featuresInBox([roads], box)).toEqual({ [roads.id]: ['inside'] })
    // Disjoint extents and extents fully inside the box need no exact test.
    expect(intersects.calls).toBe(0)
  })
})

describe('applyBoxSelection', () => {
  beforeEach(() => useArcWebStore.getState().clearSession())

  it('replaces the selection in every layer for a new selection', () => {
    useArcWebStore.getState().setSelection('a', ['1'])
    useArcWebStore.getState().setSelection('b', ['2'])
    applyBoxSelection({ a: ['3'] }, 'new')
    expect(useArcWebStore.getState().selections).toEqual({ a: ['3'] })
  })

  it('adds to and removes from the current selection', () => {
    useArcWebStore.getState().setSelection('a', ['1', '2'])
    applyBoxSelection({ a: ['3'] }, 'add')
    expect(useArcWebStore.getState().selections.a).toEqual(['1', '2', '3'])
    applyBoxSelection({ a: ['1'] }, 'remove')
    expect(useArcWebStore.getState().selections.a).toEqual(['2', '3'])
  })
})

function fakeMap() {
  const listeners: Record<string, ((event: unknown) => void)[]> = {}
  const container = document.createElement('div')
  document.body.appendChild(container)
  return {
    container,
    dragPan: { enable: vi.fn(), disable: vi.fn() },
    boxZoom: { enable: vi.fn(), disable: vi.fn() },
    getCanvasContainer: () => container,
    // Screen x → longitude x / 10, screen y → latitude -y / 10.
    unproject: ([x, y]: [number, number]) => ({ lng: x / 10, lat: -y / 10 }),
    on: (type: string, listener: (event: unknown) => void) => { (listeners[type] ??= []).push(listener) },
    off: (type: string, listener: (event: unknown) => void) => { listeners[type] = (listeners[type] ?? []).filter((item) => item !== listener) },
    emit(type: string, x: number, y: number, init: { shiftKey?: boolean; ctrlKey?: boolean; button?: number } = {}) {
      const originalEvent = { button: 0, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault: () => {}, ...init }
      for (const listener of listeners[type] ?? []) listener({ point: { x, y }, originalEvent, preventDefault: () => {} })
    },
    count: (type: string) => (listeners[type] ?? []).length,
  }
}

describe('useBoxSelect', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('turns a drag into a geographic box and a selection method', () => {
    const map = fakeMap()
    const onBox = vi.fn()
    renderHook(() => useBoxSelect(map as unknown as MapLibreMap, true, onBox), undefined)
    expect(map.dragPan.disable).toHaveBeenCalled()
    expect(map.boxZoom.disable).toHaveBeenCalled()
    act(() => { map.emit('mousedown', 10, 60); map.emit('mousemove', 60, 30) })
    expect(map.container.querySelector('.box-select-rectangle')).not.toBeNull()
    act(() => map.emit('mouseup', 110, 10))
    expect(onBox).toHaveBeenCalledWith([1, -6, 11, -1], 'new')
    expect(map.container.querySelector('.box-select-rectangle')).toBeNull()
    act(() => { map.emit('mousedown', 0, 0, { shiftKey: true }); map.emit('mouseup', 50, 50, { shiftKey: true }) })
    expect(onBox).toHaveBeenLastCalledWith(expect.any(Array), 'add')
    act(() => { map.emit('mousedown', 0, 0, { ctrlKey: true }); map.emit('mouseup', 50, 50, { ctrlKey: true }) })
    expect(onBox).toHaveBeenLastCalledWith(expect.any(Array), 'remove')
  })

  it('treats a click as a small box around the pointer', () => {
    const map = fakeMap()
    const onBox = vi.fn()
    renderHook(() => useBoxSelect(map as unknown as MapLibreMap, true, onBox), undefined)
    act(() => { map.emit('mousedown', 100, 100); map.emit('mouseup', 101, 100) })
    expect(onBox).toHaveBeenCalledWith([9.6, -10.4, 10.4, -9.6], 'new')
  })

  it('ignores right-button drags and restores panning when turned off', () => {
    const map = fakeMap()
    const onBox = vi.fn()
    const { rerender } = renderHook((props: { active: boolean }) => useBoxSelect(map as unknown as MapLibreMap, props.active, onBox), { active: true })
    act(() => { map.emit('mousedown', 0, 0, { button: 2 }); map.emit('mouseup', 50, 50, { button: 2 }) })
    expect(onBox).not.toHaveBeenCalled()
    rerender({ active: false })
    expect(map.dragPan.enable).toHaveBeenCalled()
    expect(map.boxZoom.enable).toHaveBeenCalled()
    expect(map.count('mousedown')).toBe(0)
  })
})
