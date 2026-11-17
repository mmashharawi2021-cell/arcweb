/**
 * Parses one coordinate typed by a user: decimal degrees ("31.5", "-73.98"), degrees and
 * minutes ("35°12.258' E"), or degrees, minutes and seconds ("31°30'00\"N", "34 27 0 E").
 * A hemisphere letter (N/S for latitude, E/W for longitude) sets the sign and overrides a
 * minus sign. Returns null for malformed or out-of-range input.
 */
export function parseAngle(input: string, axis: 'lat' | 'lon'): number | null {
  let text = input.trim().toUpperCase()
  if (!text) return null

  const hemispheres = text.match(/[NSEW]/g) ?? []
  if (hemispheres.length > 1) return null
  const hemisphere = hemispheres[0]
  if (hemisphere) {
    const allowed = axis === 'lat' ? 'NS' : 'EW'
    if (!allowed.includes(hemisphere)) return null
    text = text.replace(hemisphere, ' ').trim()
  }

  const negative = text.startsWith('-')
  text = text.replace(/^[+-]/, '')
  const parts = text.replace(/[°º'′"″]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 3) return null
  if (!parts.every((part) => /^\d+(\.\d+)?$/.test(part))) return null

  const [degrees, minutes = 0, seconds = 0] = parts.map(Number)
  // Only the last component may carry a fraction; minutes and seconds stay below 60.
  if (parts.slice(0, -1).some((part) => part.includes('.'))) return null
  if (minutes >= 60 || seconds >= 60) return null

  const magnitude = degrees + minutes / 60 + seconds / 3600
  const value = hemisphere ? (hemisphere === 'S' || hemisphere === 'W' ? -magnitude : magnitude) : negative ? -magnitude : magnitude
  return Math.abs(value) <= (axis === 'lat' ? 90 : 180) ? value : null
}
