import { beforeEach, describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import { createMapLayer } from '../../geo'
import { useArcWebStore } from '../../store'
import { coerceCellInput, compareCellValues, parseColumnFilter, queryTableRows, setFeatureAttribute } from '../tableQuery'

const feature = (id: string, properties: Record<string, unknown>): Feature => ({
  type: 'Feature', id, properties, geometry: { type: 'Point', coordinates: [0, 0] },
})
const cities = [
  feature('a', { name: 'Gaza', pop: 590000, type: 'city' }),
  feature('b', { name: 'Rafah', pop: 275000, type: 'city' }),
  feature('c', { name: 'Beit Hanoun', pop: 52000, type: 'town' }),
  feature('d', { name: 'Abasan', pop: null, type: 'village' }),
]
const fields = ['name', 'pop', 'type']
const matches = (text: string, value: unknown) => parseColumnFilter(text)!.predicate(value)

describe('column filter expressions', () => {
  it('treats plain text as case-insensitive contains', () => {
    expect(matches('HAN', 'Beit Hanoun')).toBe(true)
    expect(matches('han', 'Rafah')).toBe(false)
  })

  it('supports numeric comparisons on numbers and numeric text', () => {
    expect(matches('>= 275000', 275000)).toBe(true)
    expect(matches('>275000', '275000')).toBe(false)
    expect(matches('<1e5', 52000)).toBe(true)
    expect(matches('>10', 'abc')).toBe(false)
    expect(matches('>10', null)).toBe(false)
  })

  it('supports equality, inequality and inclusive ranges', () => {
    expect(matches('=city', 'City')).toBe(true)
    expect(matches('=52000', '52000.0')).toBe(true)
    expect(matches('!=city', 'town')).toBe(true)
    expect(matches('<>city', 'city')).toBe(false)
    expect(matches('50000..300000', 275000)).toBe(true)
    expect(matches('300000..50000', 52000)).toBe(true)
    expect(matches('50000..300000', 590000)).toBe(false)
  })

  it('matches empty and non-empty cells', () => {
    expect(matches('null', null)).toBe(true)
    expect(matches('is null', '')).toBe(true)
    expect(matches('not null', 0)).toBe(true)
    expect(matches('!null', undefined)).toBe(false)
  })

  it('rejects a comparison without a number and ignores blank filters', () => {
    expect(parseColumnFilter('> abc')).toBeNull()
    expect(parseColumnFilter('   ')).toBeNull()
  })
})

describe('table row query', () => {
  it('combines column filters (AND), search and sorting', () => {
    const rows = queryTableRows(cities, {
      view: { sort: { field: 'pop', direction: -1 }, filters: { type: 'city', pop: '>100000' } },
      search: '', fields, onlyIds: null,
    })
    expect(rows.map((row) => row.feature.id)).toEqual(['a', 'b'])
  })

  it('sorts numbers numerically with empty values first, keeping ties stable', () => {
    const rows = queryTableRows(cities, { view: { sort: { field: 'pop', direction: 1 }, filters: {} }, search: '', fields, onlyIds: null })
    expect(rows.map((row) => row.feature.id)).toEqual(['d', 'c', 'b', 'a'])
    expect(compareCellValues('10', 9)).toBeGreaterThan(0)
  })

  it('limits rows to the selection when "show selected" is on', () => {
    const rows = queryTableRows(cities, { view: { sort: null, filters: {} }, search: 'a', fields, onlyIds: new Set(['b', 'd']) })
    expect(rows.map((row) => row.feature.id)).toEqual(['b', 'd'])
  })
})

describe('inline cell editing', () => {
  it('keeps numeric fields numeric and rejects text in them', () => {
    expect(coerceCellInput(' 42.5 ', [1, 2, null])).toEqual({ value: 42.5 })
    expect(coerceCellInput('lots', [1, 2])).toHaveProperty('error')
  })

  it('keeps booleans boolean, clears with an empty entry, and stores other input as text', () => {
    expect(coerceCellInput('yes', [true, false])).toEqual({ value: true })
    expect(coerceCellInput('', ['x'])).toEqual({ value: null })
    expect(coerceCellInput('007', ['a', 'b'])).toEqual({ value: '007' })
  })

  it('changes one attribute without mutating the original features', () => {
    const before = structuredClone(cities)
    const next = setFeatureAttribute(cities, 'b', 'pop', 300000)
    expect(next[1].properties?.pop).toBe(300000)
    expect(next[0]).toBe(cities[0])
    expect(cities).toEqual(before)
  })
})

describe('edit session undo / redo', () => {
  const load = () => {
    const layer = createMapLayer('Cities', { type: 'FeatureCollection', features: structuredClone(cities) })
    useArcWebStore.getState().addLayer(layer)
    return layer.id
  }
  const data = (id: string) => useArcWebStore.getState().layers.find((layer) => layer.id === id)!.data
  const edit = (id: string, value: number, label: string) =>
    useArcWebStore.getState().commitEdit(id, { ...data(id), features: setFeatureAttribute(data(id).features, 'a', 'pop', value) }, label)

  beforeEach(() => useArcWebStore.getState().clearSession())

  it('undoes and redoes edits in order and tracks the session snapshot', () => {
    const id = load()
    const original = data(id)
    edit(id, 1, 'Edit pop')
    edit(id, 2, 'Edit pop again')
    expect(useArcWebStore.getState().editSnapshots[id]).toBe(original)
    expect(useArcWebStore.getState().undo()).toBe('Edit pop again')
    expect(data(id).features[0].properties?.pop).toBe(1)
    expect(useArcWebStore.getState().undo()).toBe('Edit pop')
    expect(data(id)).toBe(original)
    expect(useArcWebStore.getState().undo()).toBeNull()
    expect(useArcWebStore.getState().redo()).toBe('Edit pop')
    expect(data(id).features[0].properties?.pop).toBe(1)
  })

  it('clears the redo stack when a new edit is made', () => {
    const id = load()
    edit(id, 1, 'one')
    useArcWebStore.getState().undo()
    edit(id, 5, 'five')
    expect(useArcWebStore.getState().redoStack).toEqual([])
    expect(useArcWebStore.getState().redo()).toBeNull()
  })

  it('refuses a stale undo instead of overwriting a change made outside the session', () => {
    const id = load()
    edit(id, 1, 'one')
    const external = { ...data(id), features: [] }
    useArcWebStore.getState().updateLayer(id, { data: external })
    expect(useArcWebStore.getState().undo()).toBeNull()
    expect(data(id)).toBe(external)
    expect(useArcWebStore.getState().undoStack).toEqual([])
  })

  it('save keeps the edits and clears history; discard restores the snapshot', () => {
    const id = load()
    const original = data(id)
    edit(id, 1, 'one')
    useArcWebStore.getState().saveEdits()
    expect(useArcWebStore.getState().undoStack).toEqual([])
    expect(data(id).features[0].properties?.pop).toBe(1)
    edit(id, 2, 'two')
    useArcWebStore.getState().discardEdits()
    expect(data(id).features[0].properties?.pop).toBe(1)
    expect(data(id)).not.toBe(original)
  })

  it('keeps the snapshot after undoing everything so a redo can still be discarded', () => {
    const id = load()
    const original = data(id)
    edit(id, 1, 'one')
    useArcWebStore.getState().undo()
    useArcWebStore.getState().setTool('pan')
    useArcWebStore.getState().redo()
    useArcWebStore.getState().discardEdits()
    expect(data(id)).toBe(original)
  })

  it('stores table sort and filters per layer and drops them with the layer', () => {
    const id = load()
    useArcWebStore.getState().setTableView(id, { filters: { pop: '>1000' } })
    useArcWebStore.getState().setTableView(id, { sort: { field: 'name', direction: -1 } })
    expect(useArcWebStore.getState().tableViews[id]).toEqual({ sort: { field: 'name', direction: -1 }, filters: { pop: '>1000' } })
    useArcWebStore.getState().removeLayer(id)
    expect(useArcWebStore.getState().tableViews[id]).toBeUndefined()
  })
})
