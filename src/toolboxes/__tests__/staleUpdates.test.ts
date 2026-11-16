import { describe, expect, it } from 'vitest'
import { changedLayerIds } from '../staleUpdates'

describe('changedLayerIds', () => {
  const dataA = { type: 'FeatureCollection', features: [] }
  const dataB = { type: 'FeatureCollection', features: [] }
  const start = new Map<string, unknown>([['a', dataA], ['b', dataB]])

  it('returns nothing when the data is unchanged', () => {
    expect(changedLayerIds(start, [{ id: 'a', data: dataA }, { id: 'b', data: dataB }], ['a', 'b'])).toEqual([])
  })
  it('reports a layer whose data was replaced', () => {
    expect(changedLayerIds(start, [{ id: 'a', data: { ...dataA } }, { id: 'b', data: dataB }], ['a'])).toEqual(['a'])
  })
  it('reports a layer removed mid-run', () => {
    expect(changedLayerIds(start, [{ id: 'b', data: dataB }], ['a'])).toEqual(['a'])
  })
  it('only checks the updated layer ids', () => {
    expect(changedLayerIds(start, [{ id: 'a', data: { ...dataA } }, { id: 'b', data: dataB }], ['b'])).toEqual([])
  })
})
