import { createMapLayer } from '../geo'
import type { MapLayer } from '../store'
import type { ToolboxContext, ToolboxParameters } from './types'

export function getLayer(context: ToolboxContext, parameters: ToolboxParameters, parameterId: string): MapLayer {
  const layerId = parameters[parameterId]
  if (typeof layerId !== 'string' || !layerId) throw new Error('Choose an input layer.')
  const layer = context.layers.find((item) => item.id === layerId)
  if (!layer) throw new Error('The selected input layer is no longer available.')
  return layer
}

export function getText(parameters: ToolboxParameters, parameterId: string, label: string): string {
  const value = parameters[parameterId]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Enter ${label}.`)
  return value.trim()
}

export function getOptionalText(parameters: ToolboxParameters, parameterId: string): string {
  const value = parameters[parameterId]
  return typeof value === 'string' ? value.trim() : ''
}

export function getNumber(parameters: ToolboxParameters, parameterId: string, label: string): number {
  const value = parameters[parameterId]
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) throw new Error(`Enter a valid ${label}.`)
  return number
}

export function getFile(parameters: ToolboxParameters, parameterId: string, label: string): File {
  const value = parameters[parameterId]
  if (!(value instanceof File)) throw new Error(`Select a ${label} file.`)
  return value
}

export function outputLayer(name: string, data: MapLayer['data'], sourceCrs?: string) {
  return createMapLayer(name, data, sourceCrs)
}

const fieldNameCache = new WeakMap<MapLayer['data'], string[]>()

export function fieldNames(layer: MapLayer): string[] {
  let properties = fieldNameCache.get(layer.data)
  if (!properties) {
    const names = new Set<string>()
    for (const feature of layer.data.features) {
      Object.keys(feature.properties ?? {}).forEach((name) => names.add(name))
    }
    properties = [...names]
    fieldNameCache.set(layer.data, properties)
  }
  return [...new Set([...(layer.customFields ?? []), ...properties])]
}

/** Resolves a multi-layer parameter (stored as comma-separated layer IDs) in the chosen order. */
export function getLayers(context: ToolboxContext, parameters: ToolboxParameters, parameterId: string): MapLayer[] {
  const value = parameters[parameterId]
  const ids = typeof value === 'string' ? value.split(',').filter(Boolean) : []
  return ids.flatMap((id) => {
    const layer = context.layers.find((item) => item.id === id)
    return layer ? [layer] : []
  })
}
