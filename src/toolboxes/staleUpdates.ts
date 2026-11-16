/**
 * Ids of layers a tool is about to update whose data changed (or which were removed)
 * since the tool started. Used so a long-running tool never overwrites newer edits.
 */
export function changedLayerIds(
  startData: ReadonlyMap<string, unknown>,
  currentLayers: { id: string; data: unknown }[],
  updateLayerIds: string[],
): string[] {
  const current = new Map(currentLayers.map((layer) => [layer.id, layer.data]))
  return updateLayerIds.filter((id) => !current.has(id) || current.get(id) !== startData.get(id))
}
