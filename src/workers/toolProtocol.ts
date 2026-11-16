import type { MapLayer } from '../store'
import type { ToolboxParameters } from '../toolboxes/types'

/** Layers are already selection-scoped by the caller; merging results back stays on the main thread. */
export type ToolRequest = {
  toolId: string
  layers: MapLayer[]
  selectedLayerId: string | null
  parameters: ToolboxParameters
}
