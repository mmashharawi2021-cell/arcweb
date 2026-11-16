import type { ToolboxTool } from '../types'
import { createThiessenPolygonsTool } from './createThiessenPolygons'
import { densifyTool } from './densify'
import { excelToTableTool } from './excelToTable'
import { dxfToFeaturesTool } from './dxfToFeatures'
import { exportDataTool } from './exportData'
import { featuresToCsvTool } from './featuresToCsv'
import { featuresToDxfTool } from './featuresToDxf'
import { featuresToGeoJsonTool } from './featuresToGeoJson'
import { featuresToKmlTool } from './featuresToKml'
import { featuresToShapefileTool } from './featuresToShapefile'
import { generalizeTool } from './generalize'
import { importDataTool } from './importData'
import { polygonNeighborsTool } from './polygonNeighbors'
import { xyTableToPointTool } from './xyTableToPoint'
import { tableToExcelTool } from './tableToExcel'

/** Conversion toolbox, ordered by toolset ('From/To Files', 'Cartography & Topology') then by name. */
export const conversionTools: ToolboxTool[] = [
  // From/To Files
  dxfToFeaturesTool,
  excelToTableTool,
  exportDataTool,
  featuresToCsvTool,
  featuresToDxfTool,
  featuresToGeoJsonTool,
  featuresToKmlTool,
  featuresToShapefileTool,
  importDataTool,
  tableToExcelTool,
  xyTableToPointTool,
  // Cartography & Topology
  createThiessenPolygonsTool,
  densifyTool,
  generalizeTool,
  polygonNeighborsTool,
]
