import type { ToolboxTool } from '../toolboxes/types'

/** Tools shown in the Analysis tab's gallery, in Pro's order. */
export const ANALYSIS_GALLERY = ['buffer', 'clip', 'intersect', 'union', 'dissolve', 'spatial-join'] as const

/** Gallery entries for the ids that exist in the registry, in the given order. */
export function galleryTools(ids: readonly string[], registry: readonly ToolboxTool[]): ToolboxTool[] {
  return ids.flatMap((id) => registry.filter((tool) => tool.id === id).slice(0, 1))
}
