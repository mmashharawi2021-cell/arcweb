import type { MapLayer } from '../store'
import type { ToolboxParameters, ToolboxTool } from './types'

/**
 * Converts the values a tool ran with into JSON-safe values for the history (files keep only their
 * name, since the file itself cannot be stored) plus a readable one-line summary that resolves
 * layer IDs to the layer names they had at run time.
 */
export function describeToolRun(
  tool: Pick<ToolboxTool, 'parameters'>,
  values: ToolboxParameters,
  layers: Pick<MapLayer, 'id' | 'name'>[],
): { parameters: Record<string, string | number>; summary: string } {
  const layerName = (id: string) => layers.find((layer) => layer.id === id)?.name ?? id
  const parameters: Record<string, string | number> = {}
  const parts: string[] = []
  for (const parameter of tool.parameters) {
    const value = values[parameter.id]
    if (value === undefined || value === '') continue
    if (value instanceof File) {
      parameters[parameter.id] = value.name
      parts.push(`${parameter.label}: ${value.name}`)
      continue
    }
    parameters[parameter.id] = value
    const shown = parameter.kind === 'layer' ? layerName(String(value))
      : parameter.kind === 'layers' ? String(value).split(',').filter(Boolean).map(layerName).join(', ')
        : parameter.kind === 'select' ? parameter.options.find((option) => option.value === value)?.label ?? String(value)
          : String(value)
    parts.push(`${parameter.label}: ${shown}`)
  }
  return { parameters, summary: parts.join(' · ') }
}

/** Restores a recorded run as form values, skipping files and layers that no longer exist. */
export function restoreToolValues(
  tool: Pick<ToolboxTool, 'parameters'>,
  recorded: Record<string, string | number>,
  layers: Pick<MapLayer, 'id'>[],
): ToolboxParameters {
  const exists = (id: string) => layers.some((layer) => layer.id === id)
  const values: ToolboxParameters = {}
  for (const parameter of tool.parameters) {
    const value = recorded[parameter.id]
    if (value === undefined || parameter.kind === 'file') continue
    if (parameter.kind === 'layer') {
      if (exists(String(value))) values[parameter.id] = String(value)
    } else if (parameter.kind === 'layers') {
      const ids = String(value).split(',').filter(exists)
      if (ids.length) values[parameter.id] = ids.join(',')
    } else {
      values[parameter.id] = value
    }
  }
  return values
}
