import type { ToolboxTool } from '../types'
import { aggregatePolygonsTool } from './aggregatePolygons'
import { detectGraphicConflictTool } from './detectGraphicConflict'
import { gridIndexFeaturesTool } from './gridIndexFeatures'

/** Cartography tools not already provided by the Data Management toolbox. */
export const cartographyTools: ToolboxTool[] = [
  aggregatePolygonsTool,
  detectGraphicConflictTool,
  gridIndexFeaturesTool,
]

export { aggregatePolygonsTool, detectGraphicConflictTool, gridIndexFeaturesTool }

// Smooth Line already exists in Data Management; re-export the same implementation
// rather than creating a duplicate tool ID.
export { smoothLineTool } from '../dataManagement/smoothLine'
