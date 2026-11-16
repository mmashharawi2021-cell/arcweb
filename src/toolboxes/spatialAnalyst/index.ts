import type { ToolboxTool } from '../types'
import { aspectTool, contourTool, hillshadeTool, slopeTool } from './terrain'
import { flowAccumulationTool, flowDirectionTool, fillTool } from './hydrology'
import { idwTool, importGeoTiffTool, kernelDensityTool } from './interpolation'
import { extractByMaskTool, rasterCalculatorTool, reclassifyTool, zonalStatisticsTool } from './rasterOperations'
import { tinInterpolationTool } from './tinInterpolation'

/** Spatial Analyst tools are ready for inclusion in the parent toolbox registry. */
export const spatialAnalystTools: ToolboxTool[] = [
  aspectTool, contourTool, extractByMaskTool, fillTool, flowAccumulationTool, flowDirectionTool,
  hillshadeTool, idwTool, importGeoTiffTool, kernelDensityTool, rasterCalculatorTool, tinInterpolationTool,
  reclassifyTool, slopeTool, zonalStatisticsTool,
]

export {
  aspectTool, contourTool, extractByMaskTool, fillTool, flowAccumulationTool, flowDirectionTool,
  hillshadeTool, idwTool, importGeoTiffTool, kernelDensityTool, rasterCalculatorTool, tinInterpolationTool,
  reclassifyTool, slopeTool, zonalStatisticsTool,
}
export { accumulateFlow, fillSinks } from './hydrology'
export { createRasterGrid, rasterFromFeatureCollection, rasterToFeatureCollection, readGeoTiff } from '../../rasterEngine'
export type { RasterGrid } from '../../rasterEngine'
