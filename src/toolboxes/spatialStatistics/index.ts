import type { ToolboxTool } from '../types'
import { averageNearestNeighborTool } from './averageNearestNeighbor'
import { centralFeatureTool } from './centralFeature'
import { clusterOutlierAnalysisTool } from './clusterOutlierAnalysis'
import { directionalDistributionTool } from './directionalDistribution'
import { hotSpotAnalysisTool } from './hotSpotAnalysis'
import { meanCenterTool } from './meanCenter'
import { medianCenterTool } from './medianCenter'
import { spatialAutocorrelationTool } from './spatialAutocorrelation'
import { standardDistanceTool } from './standardDistance'

/** Spatial Statistics toolbox, ordered by ArcGIS Pro toolset and then by tool name. */
export const spatialStatisticsTools: ToolboxTool[] = [
  // Analyzing Patterns
  averageNearestNeighborTool,
  spatialAutocorrelationTool,
  // Mapping Clusters
  clusterOutlierAnalysisTool,
  hotSpotAnalysisTool,
  // Measuring Geographic Distributions
  centralFeatureTool,
  directionalDistributionTool,
  meanCenterTool,
  medianCenterTool,
  standardDistanceTool,
]
