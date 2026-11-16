import { analysisTools } from './analysis/index'
import { cartographyTools as legacyCartographyTools } from './cartography'
import { cartographyTools as mapCartographyTools } from './cartography/index'
import { conversionTools } from './conversion/index'
import { dataManagementTools } from './dataManagement/index'
import { geocodingTools } from './geocoding/index'
import { imageAnalystTools } from './imageAnalyst/index'
import { networkAnalystTools } from './networkAnalyst/index'
import { spatialAnalystTools } from './spatialAnalyst/index'
import { spatialStatisticsTools } from './spatialStatistics/index'
import { threeDAnalystTools } from './threeDAnalyst/index'
import type { ToolboxCategory, ToolboxTool } from './types'

/**
 * The Geoprocessing catalog. Each toolbox lives in its own isolated folder
 * (`analysis/`, `dataManagement/`, `conversion/`, `spatialStatistics/`,
 * `spatialAnalyst/`, `networkAnalyst/`, `cartography/`, `geocoding/`,
 * `imageAnalyst/`, `threeDAnalyst/`) whose
 * `index.ts` exports the tools; this file only aggregates them.
 */
export const toolboxTools: ToolboxTool[] = [
  ...analysisTools,
  ...dataManagementTools,
  ...conversionTools,
  ...spatialStatisticsTools,
  ...legacyCartographyTools,
  ...mapCartographyTools,
  ...spatialAnalystTools,
  ...networkAnalystTools,
  ...geocodingTools,
  ...threeDAnalystTools,
  ...imageAnalystTools,
]

const toolIds = new Set<string>()
for (const tool of toolboxTools) {
  if (toolIds.has(tool.id)) throw new Error(`Duplicate toolbox tool ID: ${tool.id}`)
  toolIds.add(tool.id)
}

export const toolboxCategories: ToolboxCategory[] = [
  'Analysis', 'Data Management', 'Conversion', 'Spatial Statistics', 'Cartography',
  'Spatial Analyst', 'Network Analyst', 'Geocoding',
  '3D Analyst', 'Image Analyst',
]

/** Display names matching ArcGIS Pro's Toolboxes tab. */
export const toolboxLabels: Record<ToolboxCategory, string> = {
  Analysis: 'Analysis Tools',
  'Data Management': 'Data Management Tools',
  Conversion: 'Conversion Tools',
  'Spatial Statistics': 'Spatial Statistics Tools',
  Cartography: 'Cartography Tools',
  'Spatial Analyst': 'Spatial Analyst Tools',
  'Network Analyst': 'Network Analyst Tools',
  Geocoding: 'Geocoding Tools',
  '3D Analyst': '3D Analyst Tools',
  'Image Analyst': 'Image Analyst Tools',
}

export interface ToolsetNode {
  name: string
  tools: ToolboxTool[]
}

export interface ToolboxNode {
  category: ToolboxCategory
  label: string
  /** Toolsets in alphabetical order, as in ArcGIS Pro. */
  toolsets: ToolsetNode[]
  /** Tools that sit directly in the toolbox (no toolset). */
  tools: ToolboxTool[]
  count: number
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** Groups tools into the Toolbox › Toolset › Tool hierarchy, skipping empty toolboxes. */
export function buildToolboxTree(tools: ToolboxTool[] = toolboxTools): ToolboxNode[] {
  return toolboxCategories.flatMap((category) => {
    const members = tools.filter((tool) => tool.category === category)
    if (!members.length) return []
    const sets = new Map<string, ToolboxTool[]>()
    const loose: ToolboxTool[] = []
    for (const tool of members) {
      if (!tool.subcategory) loose.push(tool)
      else sets.set(tool.subcategory, [...(sets.get(tool.subcategory) ?? []), tool])
    }
    return [{
      category,
      label: toolboxLabels[category],
      toolsets: [...sets].map(([name, items]) => ({ name, tools: items.sort(byName) })).sort(byName),
      tools: loose.sort(byName),
      count: members.length,
    }]
  })
}

export function searchTools(query: string, category?: ToolboxCategory): ToolboxTool[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return toolboxTools.filter((tool) =>
    (!category || tool.category === category) &&
    terms.every((term) => [tool.name, tool.description, tool.category, tool.subcategory ?? '', ...tool.keywords].some((value) =>
      value.toLocaleLowerCase().includes(term),
    )),
  )
}
