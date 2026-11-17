import type { ImportedLayerData } from '../geo'
import type { RasterGrid } from '../rasterEngine'
import type { MapLayer } from '../store'
import type { Feature } from 'geojson'

/** Prepared off-thread; optional because DOM-dependent KML still uses the main-thread reader. */
export type PreparedImportedLayer = ImportedLayerData & {
  preparedLayer?: MapLayer
  renderBlob?: Blob
  fieldCatalog?: { fields: string[]; numericFields: string[] }
}

export type ImportRequest = { file: File }

export type ImportResult =
  | { kind: 'vector'; layers: PreparedImportedLayer[] }
  | { kind: 'raster'; name: string; grid: RasterGrid }

export interface ImportChunk { layerIndex: number; offset: number; features: Feature[] }
export type ImportWireResult = ImportResult | { kind: 'vector-stream'; layers: PreparedImportedLayer[]; counts: number[] }
