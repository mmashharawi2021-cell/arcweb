import type { ToolboxTool } from '../types'
import { closestFacilityTool } from './closestFacility'
import { odCostMatrixTool } from './odCostMatrix'
import { routeTool } from './route'
import { serviceAreaTool } from './serviceArea'

/** Network Analyst tools exported together for parent toolbox registry integration. */
export const networkAnalystTools: ToolboxTool[] = [
  routeTool,
  closestFacilityTool,
  serviceAreaTool,
  odCostMatrixTool,
]

export { routeTool } from './route'
export { closestFacilityTool } from './closestFacility'
export { serviceAreaTool } from './serviceArea'
export { odCostMatrixTool } from './odCostMatrix'
