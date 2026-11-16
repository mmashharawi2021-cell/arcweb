import type { ToolboxTool } from '../types'
import { addFieldTool } from './addField'
import { addJoinTool } from './addJoin'
import { addXYCoordinatesTool } from './addXYCoordinates'
import { appendTool } from './append'
import { calculateFieldTool } from './calculateField'
import { alterFieldTool } from './alterField'
import { calculateGeometryTool } from './calculateGeometry'
import { checkGeometryTool } from './checkGeometry'
import { createFishnetTool } from './createFishnet'
import { createFeatureClassTool } from './createFeatureClass'
import { createRandomPointsTool } from './createRandomPoints'
import { defineProjectionTool } from './defineProjection'
import { deleteFieldTool } from './deleteField'
import { deleteIdenticalTool } from './deleteIdentical'
import { dissolveTool } from './dissolve'
import { eliminatePolygonPartTool } from './eliminatePolygonPart'
import { featureClassToFeatureClassTool } from './featureClassToFeatureClass'
import { featureToLineTool } from './featureToLine'
import { featureToPointTool } from './featureToPoint'
import { copyFeaturesTool } from './copyFeatures'
import { featureVerticesToPointsTool } from './featureVerticesToPoints'
import { featureToPolygonTool } from './featureToPolygon'
import { findIdenticalTool } from './findIdentical'
import { generatePointsAlongLinesTool } from './generatePointsAlongLines'
import { mergeTool } from './merge'
import { minimumBoundingGeometryTool } from './minimumBoundingGeometry'
import { multipartToSinglepartTool } from './multipartToSinglepart'
import { projectTool } from './project'
import { repairGeometryTool } from './repairGeometry'
import { simplifyLineTool } from './simplifyLine'
import { simplifyPolygonTool } from './simplifyPolygon'
import { smoothLineTool } from './smoothLine'
import { smoothPolygonTool } from './smoothPolygon'
import { sortTool } from './sort'

/** ArcGIS Pro toolset order inside the Data Management toolbox. */
export const dataManagementToolsets = ['Features', 'Fields', 'General', 'Generalization', 'Projections', 'Sampling'] as const

const tools: ToolboxTool[] = [
  addXYCoordinatesTool, checkGeometryTool, copyFeaturesTool, dissolveTool, eliminatePolygonPartTool, featureToLineTool, featureToPointTool, featureVerticesToPointsTool,
  featureToPolygonTool, minimumBoundingGeometryTool, multipartToSinglepartTool, repairGeometryTool,
  addFieldTool, alterFieldTool, calculateFieldTool, calculateGeometryTool, deleteFieldTool,
  addJoinTool, appendTool, createFeatureClassTool, deleteIdenticalTool, featureClassToFeatureClassTool, findIdenticalTool, mergeTool, sortTool,
  simplifyLineTool, simplifyPolygonTool, smoothLineTool, smoothPolygonTool,
  defineProjectionTool, projectTool,
  createFishnetTool, createRandomPointsTool, generatePointsAlongLinesTool,
]

/** Data Management toolbox, ordered by toolset and then alphabetically by tool name. */
export const dataManagementTools: ToolboxTool[] = [...tools].sort((a, b) =>
  dataManagementToolsets.indexOf(a.subcategory as typeof dataManagementToolsets[number]) - dataManagementToolsets.indexOf(b.subcategory as typeof dataManagementToolsets[number]) ||
  a.name.localeCompare(b.name))
