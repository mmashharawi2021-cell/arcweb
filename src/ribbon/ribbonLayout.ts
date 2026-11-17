/**
 * Decides which ribbon groups collapse to a single button so the ribbon fits without
 * scrolling. Like ArcGIS Pro, groups collapse from the right; the first group never does.
 * A group already narrower than its collapsed button is left expanded, since collapsing
 * it would not save space.
 */
export function collapseGroups(groupWidths: number[], available: number, collapsedWidth = 56): boolean[] {
  const collapsed = groupWidths.map(() => false)
  let total = groupWidths.reduce((sum, width) => sum + width, 0)
  for (let index = groupWidths.length - 1; index > 0 && total > available; index -= 1) {
    if (groupWidths[index] <= collapsedWidth) continue
    collapsed[index] = true
    total += collapsedWidth - groupWidths[index]
  }
  return collapsed
}
