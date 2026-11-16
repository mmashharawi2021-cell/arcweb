import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { createMapLayer } from '../geo'
import type { MapLayer } from '../store'
import type { ToolboxContext, ToolboxParameters, ToolboxTool, ToolExecutionResult } from './types'

/**
 * Builds a WGS84 MapLayer from features for unit tests. Features may have a null geometry, as rows
 * of a standalone table (e.g. a CSV without coordinates) do at runtime; MapLayer's GeoJSON typing
 * does not model that, so the widening happens once here rather than in every test.
 */
export function testLayer(name: string, features: Feature<Geometry | null>[] | FeatureCollection, sourceCrs?: string): MapLayer {
  const data = (Array.isArray(features) ? { type: 'FeatureCollection', features } : features) as FeatureCollection
  return createMapLayer(name, structuredClone(data), sourceCrs)
}

/** Runs a tool against the given layers, mirroring how the Geoprocessing pane calls it. */
export async function runTool(tool: ToolboxTool, layers: MapLayer[], parameters: ToolboxParameters): Promise<ToolExecutionResult> {
  const context: ToolboxContext = { layers, selectedLayerId: layers[0]?.id ?? null }
  return tool.execute(context, parameters)
}
