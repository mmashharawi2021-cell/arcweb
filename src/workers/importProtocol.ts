import type { ImportedLayerData } from '../geo'
import type { RasterGrid } from '../rasterEngine'

export type ImportRequest = { file: File }

export type ImportResult =
  | { kind: 'vector'; layers: ImportedLayerData[] }
  | { kind: 'raster'; name: string; grid: RasterGrid }
