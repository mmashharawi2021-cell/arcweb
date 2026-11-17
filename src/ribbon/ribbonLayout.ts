/**
 * Width of a collapsed `.ribbon-group` before it has been measured: a 64px large button plus
 * 6px padding each side and a 1px divider (see `.ribbon-group.is-collapsed` in App.css).
 */
export const DEFAULT_COLLAPSED_GROUP_WIDTH = 77

/**
 * Decides which ribbon groups collapse to a single button so the ribbon fits without
 * scrolling. Like ArcGIS Pro, groups collapse from the right; the first group never does.
 * A group already narrower than its collapsed button is left expanded, since collapsing
 * it would not save space. `collapsedWidths` is one width for all groups, or one per group.
 */
export function collapseGroups(
  groupWidths: number[],
  available: number,
  collapsedWidths: number | readonly number[] = DEFAULT_COLLAPSED_GROUP_WIDTH,
): boolean[] {
  const collapsedWidth = (index: number) => typeof collapsedWidths === 'number' ? collapsedWidths : collapsedWidths[index] ?? DEFAULT_COLLAPSED_GROUP_WIDTH
  const collapsed = groupWidths.map(() => false)
  let total = groupWidths.reduce((sum, width) => sum + width, 0)
  for (let index = groupWidths.length - 1; index > 0 && total > available; index -= 1) {
    if (groupWidths[index] <= collapsedWidth(index)) continue
    collapsed[index] = true
    total += collapsedWidth(index) - groupWidths[index]
  }
  return collapsed
}
