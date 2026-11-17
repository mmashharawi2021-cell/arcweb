import { describe, expect, it } from 'vitest'
import { collapseGroups } from '../ribbonLayout'

describe('collapseGroups', () => {
  it('keeps every group expanded when they fit', () => {
    expect(collapseGroups([200, 150, 120], 600)).toEqual([false, false, false])
  })
  it('collapses rightmost groups first', () => {
    expect(collapseGroups([200, 150, 120], 420)).toEqual([false, false, true])
    expect(collapseGroups([200, 150, 120], 320)).toEqual([false, true, true])
  })
  it('never collapses the first group', () => {
    expect(collapseGroups([200, 150], 10)).toEqual([false, true])
  })
  it('does not count a group as saving space when it is narrower than its collapsed button', () => {
    // Collapsing the 40px group would widen it to 56px, so the 300px group must collapse instead.
    expect(collapseGroups([100, 300, 40], 260)).toEqual([false, true, false])
  })
})
