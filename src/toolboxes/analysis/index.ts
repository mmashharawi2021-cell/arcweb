import type { ToolboxTool } from '../types'
import { bufferTool } from './buffer'
import { clipTool } from './clip'
import { createThiessenPolygonsTool } from './createThiessenPolygons'
import { eraseTool } from './erase'
import { frequencyTool } from './frequency'
import { identityTool } from './identity'
import { intersectTool } from './intersect'
import { multipleRingBufferTool } from './multipleRingBuffer'
import { distanceMatrixTool, nearTool } from './near'
import { pointDistanceTool } from './pointDistance'
import { selectTool } from './select'
import { spatialJoinTool } from './spatialJoin'
import { splitTool } from './split'
import { summaryStatisticsTool } from './summaryStatistics'
import { summarizeWithinTool } from './summarizeWithin'
import { symmetricalDifferenceTool } from './symmetricalDifference'
import { tableSelectTool } from './tableSelect'
import { tabulateIntersectionTool } from './tabulateIntersection'
import { unionTool } from './union'
import { updateTool } from './update'

/** Analysis toolbox, ordered by ArcGIS Pro toolset (Extract, Overlay, Proximity, Statistics), then by name. */
export const analysisTools: ToolboxTool[] = [
  // Extract
  clipTool, selectTool, splitTool, tableSelectTool,
  // Overlay
  eraseTool, identityTool, intersectTool, spatialJoinTool, symmetricalDifferenceTool, unionTool, updateTool,
  // Proximity
  bufferTool, createThiessenPolygonsTool, distanceMatrixTool, multipleRingBufferTool, nearTool, pointDistanceTool,
  // Statistics
  frequencyTool, summarizeWithinTool, summaryStatisticsTool, tabulateIntersectionTool,
]
