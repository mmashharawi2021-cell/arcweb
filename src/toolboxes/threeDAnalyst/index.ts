import type { ToolboxTool } from '../types'
import { createTinTool } from './createTin'
import { featureTo3DByAttributeTool } from './featureTo3DByAttribute'
import { interpolateShapeTool } from './interpolateShape'
import { lineOfSightTool } from './lineOfSight'
import { viewshedTool } from './viewshed'

/** 3D Analyst tools ready for inclusion in the parent toolbox registry. */
export const threeDAnalystTools: ToolboxTool[] = [
  createTinTool, featureTo3DByAttributeTool, interpolateShapeTool, lineOfSightTool, viewshedTool,
]

export {
  createTinTool, featureTo3DByAttributeTool, interpolateShapeTool, lineOfSightTool, viewshedTool,
}
export { calculateLineOfSight } from './_visibility'
export { sampleRaster } from './_shared'
