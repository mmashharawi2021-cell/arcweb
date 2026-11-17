import { describe, expect, it } from 'vitest'
import { collapseGroups, DEFAULT_COLLAPSED_GROUP_WIDTH } from '../ribbonLayout'

describe('collapseGroups', () => {
  it('keeps every group expanded when they fit', () => {
    expect(collapseGroups([200, 150, 120], 600)).toEqual([false, false, false])
  })
  it('collapses rightmost groups first', () => {
    expect(collapseGroups([200, 150, 120], 420, 56)).toEqual([false, false, true])
    expect(collapseGroups([200, 150, 120], 320, 56)).toEqual([false, true, true])
  })
  it('never collapses the first group', () => {
    expect(collapseGroups([200, 150], 10)).toEqual([false, true])
  })
  it('does not count a group as saving space when it is narrower than its collapsed button', () => {
    // Collapsing the 40px group would widen it to 56px, so the 300px group must collapse instead.
    expect(collapseGroups([100, 300, 40], 260)).toEqual([false, true, false])
  })
})

describe('collapseGroups with measured collapsed widths', () => {
  it('uses the given collapsed width rather than assuming 56px', () => {
    // 200 + 150 + 56 = 406 fits in 410, but a real collapsed group of 80px does not (430).
    expect(collapseGroups([200, 150, 120], 410, 56)).toEqual([false, false, true])
    expect(collapseGroups([200, 150, 120], 410, 80)).toEqual([false, true, true])
  })
  it('accepts a collapsed width per group', () => {
    expect(collapseGroups([200, 150, 120], 410, [56, 56, 90])).toEqual([false, true, true])
  })
  it('defaults to the CSS collapsed group width', () => {
    expect(DEFAULT_COLLAPSED_GROUP_WIDTH).toBe(77)
  })
})
