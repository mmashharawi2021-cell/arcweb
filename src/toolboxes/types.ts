import type { MapLayer } from '../store'

export type ToolboxCategory =
  | 'Analysis'
  | 'Data Management'
  | 'Conversion'
  | 'Spatial Statistics'
  | 'Cartography'
  | 'Spatial Analyst'
  | 'Network Analyst'
  | 'Geocoding'
  | '3D Analyst'
  | 'Image Analyst'
export type ToolboxValue = string | number | File | undefined
export type ToolboxParameters = Record<string, ToolboxValue>

export type ToolParameter =
  | { id: string; label: string; kind: 'layer'; required?: boolean; defaultValue?: string }
  /** Multiple layers; the value is a comma-separated list of layer IDs. */
  | { id: string; label: string; kind: 'layers'; required?: boolean }
  | { id: string; label: string; kind: 'field'; layerParameter: string; required?: boolean; allowEmpty?: boolean }
  | { id: string; label: string; kind: 'text'; required?: boolean; defaultValue?: string; placeholder?: string }
  | { id: string; label: string; kind: 'number'; required?: boolean; defaultValue?: number; min?: number; max?: number; step?: number }
  | { id: string; label: string; kind: 'select'; required?: boolean; defaultValue?: string; options: { value: string; label: string }[] }
  | { id: string; label: string; kind: 'file'; required?: boolean; accept: string }
  | { id: string; label: string; kind: 'color'; required?: boolean; defaultValue?: string }

export interface ToolLayerUpdate {
  layerId: string
  updates: Partial<MapLayer>
}

export interface ToolDownload {
  fileName: string
  blob: Blob
}

export interface ToolExecutionResult {
  message: string
  kind?: 'success' | 'warning'
  layers?: MapLayer[]
  updates?: ToolLayerUpdate[]
  downloads?: ToolDownload[]
}

export interface ToolboxContext {
  layers: MapLayer[]
  selectedLayerId: string | null
  onProgress?: (progress: { current: number; total: number; message: string }) => void
}

export interface ToolboxTool {
  id: string
  name: string
  category: ToolboxCategory
  /** ArcGIS Pro toolset inside the toolbox, e.g. 'Extract', 'Overlay', 'Proximity'. */
  subcategory?: string
  description: string
  keywords: string[]
  parameters: ToolParameter[]
  execute: (context: ToolboxContext, parameters: ToolboxParameters) => ToolExecutionResult | Promise<ToolExecutionResult>
}
