import { useCallback, useEffect, useMemo } from 'react'
import type { FeatureCollection, Geometry } from 'geojson'
import { isolate } from '../bidi'
import { calculateField } from '../fieldCalculator'
import { createMapLayer } from '../geo'
import { createSketchFeature } from '../mapGeometry'
import { useArcWebStore, type FeatureId, type MapLayer } from '../store'
import { setFeatureAttribute } from '../table/tableQuery'

type Notify = (message: string, kind?: 'success' | 'error' | 'warning') => void

/**
 * Feature and field edits that change layer data: add/delete features, schema changes,
 * field calculation, cell edits and edit-session undo/redo (including Ctrl+Z / Ctrl+Y).
 * Every callback keeps a stable identity while `notify` does.
 */
export function useFeatureEdits(notify: Notify) {
  const selectedLayerId = useArcWebStore((state) => state.selectedLayerId)
  const selections = useArcWebStore((state) => state.selections)
  const selectedFeature = useArcWebStore((state) => state.selectedFeature)

  const appendFeature = useCallback((layer: MapLayer, geometry: Geometry) => {
    const feature = createSketchFeature(layer, geometry)
    const data: FeatureCollection = { ...layer.data, features: [...layer.data.features, feature] }
    useArcWebStore.getState().commitEdit(layer.id, data, `Add ${geometry.type.toLowerCase()} feature`)
    useArcWebStore.getState().setSelectedFeature({ layerId: layer.id, featureId: feature.id })
    useArcWebStore.getState().setTableOpen(true)
    notify(`Added a ${geometry.type} feature to ${isolate(layer.name)}.`)
  }, [notify])

  const deleteFeature = useCallback((layer: MapLayer, featureId: string | number) => {
    const data: FeatureCollection = {
      ...layer.data,
      features: layer.data.features.filter((feature) => feature.id !== featureId),
    }
    useArcWebStore.getState().commitEdit(layer.id, data, 'Delete feature')
    if (useArcWebStore.getState().selectedFeature?.featureId === featureId) {
      useArcWebStore.getState().setSelectedFeature(null)
    }
    notify('Feature deleted.')
  }, [notify])

  const addCustomField = useCallback((layer: MapLayer, name: string) => {
    const field = name.trim()
    if (!field) {
      notify('Enter a field name.', 'warning')
      return
    }
    if (layer.data.features.some((feature) => Object.hasOwn(feature.properties ?? {}, field))) {
      notify(`A field named "${isolate(field)}" already exists.`, 'warning')
      return
    }
    const data: FeatureCollection = {
      ...layer.data,
      features: layer.data.features.map((feature) => ({
        ...feature,
        properties: { ...(feature.properties ?? {}), [field]: '' },
      })),
    }
    useArcWebStore.getState().updateLayer(layer.id, { data, customFields: [...(layer.customFields ?? []), field] })
    notify(`Added field "${isolate(field)}".`)
  }, [notify])

  const removeCustomField = useCallback((layer: MapLayer, field: string) => {
    const data: FeatureCollection = {
      ...layer.data,
      features: layer.data.features.map((feature) => {
        const properties = { ...(feature.properties ?? {}) }
        delete properties[field]
        return { ...feature, properties }
      }),
    }
    const fieldAliases = { ...(layer.fieldAliases ?? {}) }
    delete fieldAliases[field]
    useArcWebStore.getState().updateLayer(layer.id, {
      data,
      customFields: (layer.customFields ?? []).filter((name) => name !== field),
      fieldAliases,
      labelField: layer.labelField === field ? '' : layer.labelField,
    })
    notify(`Deleted field "${isolate(field)}".`)
  }, [notify])

  const calculateLayerField = useCallback((layer: MapLayer, name: string, expression: string) => {
    try {
      const data = calculateField(layer.data, name, expression)
      const field = name.trim()
      const existing = layer.data.features.some((feature) => Object.hasOwn(feature.properties ?? {}, field))
      useArcWebStore.getState().updateLayer(layer.id, {
        data,
        customFields: existing ? layer.customFields ?? [] : [...(layer.customFields ?? []), field],
      })
      notify(`Calculated "${isolate(field)}" for ${data.features.length.toLocaleString()} features.`)
    } catch (error) {
      notify(`Field calculation failed: ${error instanceof Error ? error.message : 'Invalid expression.'}`, 'error')
    }
  }, [notify])

  const createEditableLayer = useCallback((name: string, geometry: 'Point' | 'Line' | 'Polygon', fields: string[]) => {
    const layerName = name.trim()
    if (!layerName) {
      notify('Enter a name for the new layer.', 'warning')
      return
    }
    const layer = createMapLayer(layerName, { type: 'FeatureCollection', features: [] })
    layer.geometry = geometry
    layer.customFields = fields
    useArcWebStore.getState().addLayer(layer)
    useArcWebStore.getState().setTableOpen(true)
    notify(`Created editable ${geometry.toLowerCase()} layer "${isolate(name)}".`)
  }, [notify])

  const deleteSelectedFeature = useCallback(() => {
    const state = useArcWebStore.getState()
    const selection = state.selectedFeature
    const layer = selection && state.layers.find((item) => item.id === selection.layerId)
    if (layer && selection) deleteFeature(layer, selection.featureId)
    useArcWebStore.getState().setSelectedFeature(null)
  }, [deleteFeature])

  /** Feature IDs the Delete command acts on: the layer's selection set plus the identified feature. */
  const editTargetIds = useMemo(() => {
    if (!selectedLayerId) return []
    const ids = new Set<FeatureId>(selections[selectedLayerId] ?? [])
    if (selectedFeature?.layerId === selectedLayerId) ids.add(selectedFeature.featureId)
    return [...ids]
  }, [selectedLayerId, selections, selectedFeature])

  const deleteSelectedFeatures = useCallback(() => {
    const state = useArcWebStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    if (!layer || !editTargetIds.length) return
    const doomed = new Set<FeatureId>(editTargetIds)
    const features = layer.data.features.filter((feature) => feature.id === undefined || !doomed.has(feature.id))
    const removed = layer.data.features.length - features.length
    state.commitEdit(layer.id, { ...layer.data, features }, `Delete ${removed} feature${removed === 1 ? '' : 's'}`)
    state.setSelection(layer.id, [])
    state.setSelectedFeature(null)
    notify(`Deleted ${removed} feature${removed === 1 ? '' : 's'} from ${isolate(layer.name)}. Save or discard from the Edit Tools tab.`)
  }, [editTargetIds, notify])

  const undoEdit = useCallback(() => {
    const label = useArcWebStore.getState().undo()
    if (label) notify(`Undid: ${label}.`)
    else notify('Nothing to undo — the layer changed outside the edit session since the last edit.', 'warning')
  }, [notify])

  const redoEdit = useCallback(() => {
    const label = useArcWebStore.getState().redo()
    if (label) notify(`Redid: ${label}.`)
    else notify('Nothing to redo.', 'warning')
  }, [notify])

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) for the edit session, except while typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      const key = event.key.toLowerCase()
      const state = useArcWebStore.getState()
      if (key === 'z' && !event.shiftKey && state.undoStack.length) {
        event.preventDefault()
        undoEdit()
      } else if ((key === 'y' || (key === 'z' && event.shiftKey)) && state.redoStack.length) {
        event.preventDefault()
        redoEdit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoEdit, redoEdit])

  const editCell = useCallback((layerId: string, featureId: FeatureId, field: string, value: unknown) => {
    const layer = useArcWebStore.getState().layers.find((item) => item.id === layerId)
    if (!layer) return
    useArcWebStore.getState().commitEdit(layerId, { ...layer.data, features: setFeatureAttribute(layer.data.features, featureId, field, value) }, `Edit ${field}`)
  }, [])

  return {
    appendFeature, deleteFeature, addCustomField, removeCustomField, calculateLayerField, createEditableLayer,
    deleteSelectedFeature, editTargetIds, deleteSelectedFeatures, undoEdit, redoEdit, editCell,
  }
}
