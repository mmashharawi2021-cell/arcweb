import type { MapLayer } from '../store'
import type { ToolboxParameters, ToolboxTool } from '../toolboxes/types'

/** Avoid cloning unrelated workspace datasets into every geoprocessing worker. */
export function selectToolInputLayers(tool: Pick<ToolboxTool, 'parameters'>, layers: MapLayer[], values: ToolboxParameters): MapLayer[] {
  const ids = new Set<string>()
  for (const parameter of tool.parameters) {
    const value = values[parameter.id]
    if (typeof value !== 'string') continue
    if (parameter.kind === 'layer') ids.add(value)
    else if (parameter.kind === 'layers') value.split(',').filter(Boolean).forEach((id) => ids.add(id))
  }
  return layers.filter((layer) => ids.has(layer.id))
}
