import { beforeEach, describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { createMapLayer } from '../geo'
import { hasPendingEdits } from '../ribbon/contextualTabs'
import { useArcWebStore } from '../store'

const collection = (value: number): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id: 'f1', properties: { value }, geometry: { type: 'Point', coordinates: [0, 0] } }],
})

/** Simulates a reload: layers and snapshots come back from storage as fresh (structurally cloned) objects. */
function reloadWith(current: FeatureCollection, snapshots: Record<string, FeatureCollection>, id: string) {
  const layer = { ...createMapLayer('Wells', structuredClone(current)), id }
  useArcWebStore.getState().restoreLayers([layer])
  useArcWebStore.getState().restoreEditSnapshots(structuredClone(snapshots))
  return useArcWebStore.getState()
}

describe('resuming an edit session after a reload (audit regression)', () => {
  beforeEach(() => useArcWebStore.getState().clearSession())

  it('retains immutable collection identity when stored feature IDs are already valid', () => {
    const layer = createMapLayer('Wells', collection(1))
    useArcWebStore.getState().restoreLayers([layer])
    expect(useArcWebStore.getState().layers[0].data).toBe(layer.data)
  })

  it('replaces collection identity when repairing missing/duplicate IDs without changing input', () => {
    const layer = createMapLayer('Wells', collection(1))
    layer.data = { ...layer.data, features: [layer.data.features[0], { ...layer.data.features[0] }, { ...layer.data.features[0], id: undefined }] }
    const original = structuredClone(layer.data)
    useArcWebStore.getState().restoreLayers([layer])
    const restored = useArcWebStore.getState().layers[0].data
    expect(restored).not.toBe(layer.data)
    expect(new Set(restored.features.map(feature => feature.id)).size).toBe(3)
    expect(restored.features.every(feature => feature.id !== undefined)).toBe(true)
    expect(layer.data).toEqual(original)
  })

  it('keeps unsaved edits discardable instead of silently committing them', () => {
    const state = reloadWith(collection(2), { L1: collection(1) }, 'L1')
    expect(hasPendingEdits(state.layers, state.editSnapshots)).toBe(true)
    useArcWebStore.getState().discardEdits()
    expect(useArcWebStore.getState().layers[0].data.features[0].properties?.value).toBe(1)
  })

  it('drops snapshots of removed layers and of layers whose data equals the snapshot', () => {
    const state = reloadWith(collection(1), { L1: collection(1), gone: collection(5) }, 'L1')
    expect(state.editSnapshots).toEqual({})
  })

  it('ignores malformed stored snapshots', () => {
    const state = reloadWith(collection(2), { L1: { type: 'FeatureCollection' } as unknown as FeatureCollection }, 'L1')
    expect(state.editSnapshots).toEqual({})
  })
})
