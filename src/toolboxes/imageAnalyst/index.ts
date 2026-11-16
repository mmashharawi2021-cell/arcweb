import type { ToolboxTool } from '../types'
import { isoClusterTool } from './isoCluster'
import { majorityFilterTool } from './majorityFilter'
import { polygonToRasterTool } from './polygonToRaster'
import { rasterToPolygonTool } from './rasterToPolygon'
import { spectralIndicesTool } from './spectralIndices'

/** Image Analyst tools, ready for inclusion in the parent toolbox registry. */
export const imageAnalystTools: ToolboxTool[] = [
  isoClusterTool,
  majorityFilterTool,
  polygonToRasterTool,
  rasterToPolygonTool,
  spectralIndicesTool,
]

export {
  isoClusterTool,
  majorityFilterTool,
  polygonToRasterTool,
  rasterToPolygonTool,
  spectralIndicesTool,
}
