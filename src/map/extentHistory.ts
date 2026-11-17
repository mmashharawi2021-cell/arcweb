/** A map camera position, as recorded by the Previous / Next extent commands. */
export interface Extent {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

function sameExtent(a: Extent, b: Extent): boolean {
  return Math.abs(a.center[0] - b.center[0]) < 1e-6 && Math.abs(a.center[1] - b.center[1]) < 1e-6 &&
    Math.abs(a.zoom - b.zoom) < 1e-3 && Math.abs(a.bearing - b.bearing) < 0.01 && Math.abs(a.pitch - b.pitch) < 0.01
}

/**
 * Browser-style history of map extents (ArcGIS Pro's Previous / Next Extent). Going back or
 * forward marks the next recorded extent as the result of that navigation, so it is not
 * added as a new entry.
 */
export class ExtentHistory {
  private entries: Extent[] = []
  private index = -1
  private navigating = false
  private readonly limit: number

  constructor(limit = 50) {
    this.limit = limit
  }

  get canBack(): boolean {
    return this.index > 0
  }

  get canForward(): boolean {
    return this.index < this.entries.length - 1
  }

  /** Records where the map came to rest (call on `moveend`). */
  record(extent: Extent): void {
    if (this.navigating) {
      this.navigating = false
      return
    }
    const current = this.entries[this.index]
    if (current && sameExtent(current, extent)) return
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push(extent)
    if (this.entries.length > this.limit) this.entries.shift()
    this.index = this.entries.length - 1
  }

  back(): Extent | null {
    if (!this.canBack) return null
    this.index -= 1
    this.navigating = true
    return this.entries[this.index]
  }

  forward(): Extent | null {
    if (!this.canForward) return null
    this.index += 1
    this.navigating = true
    return this.entries[this.index]
  }
}
