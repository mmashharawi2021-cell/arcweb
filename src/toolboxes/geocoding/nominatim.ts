import type { Feature, Point } from 'geojson'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const MIN_REQUEST_INTERVAL_MS = 1000
const MAX_REQUESTS_PER_EXECUTION = 100
let lastRequestStartedAt = 0
let requestQueue: Promise<void> = Promise.resolve()

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

async function startRateLimitedRequest(): Promise<void> {
  const previous = requestQueue
  let release = () => {}
  requestQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    const remaining = lastRequestStartedAt + MIN_REQUEST_INTERVAL_MS - Date.now()
    if (remaining > 0) await wait(remaining)
    lastRequestStartedAt = Date.now()
  } finally {
    release()
  }
}

async function requestNominatim<T>(url: URL): Promise<T> {
  await startRateLimitedRequest()
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new Error(`Nominatim request failed: ${error instanceof Error ? error.message : 'network error'}`)
  }
  if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`)
  try {
    return await response.json() as T
  } catch (error) {
    throw new Error(`Could not parse Nominatim response: ${error instanceof Error ? error.message : 'invalid JSON'}`)
  }
}

function validateCount(total: number): void {
  if (total > MAX_REQUESTS_PER_EXECUTION) {
    throw new Error(`Nominatim public service usage is limited here to ${MAX_REQUESTS_PER_EXECUTION} requests per execution.`)
  }
}

export async function geocodeAddress(address: string): Promise<Feature<Point> | null> {
  const url = new URL(`${NOMINATIM_URL}/search`)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '1')
  url.searchParams.set('q', address)
  const result = await requestNominatim<unknown>(url)
  if (!Array.isArray(result)) throw new Error('Could not parse Nominatim search response: expected an array.')
  if (result.length === 0) return null
  const item = result[0] as Record<string, unknown> | null
  if (!item || typeof item !== 'object') throw new Error('Could not parse Nominatim search response: result is not an object.')
  const latitude = Number(item?.lat)
  const longitude = Number(item?.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Could not parse Nominatim search response: result has invalid coordinates.')
  }
  return {
    type: 'Feature',
    properties: {
      display_name: typeof item.display_name === 'string' ? item.display_name : address,
      address: item.address && typeof item.address === 'object' ? item.address : {},
      osm_type: item.osm_type ?? null,
      osm_id: item.osm_id ?? null,
      place_id: item.place_id ?? null,
    },
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
  }
}

export async function reverseGeocodePosition(longitude: number, latitude: number): Promise<Record<string, unknown> | null> {
  const url = new URL(`${NOMINATIM_URL}/reverse`)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('lat', String(latitude))
  url.searchParams.set('lon', String(longitude))
  const result = await requestNominatim<unknown>(url)
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Could not parse Nominatim reverse response: expected an object.')
  }
  const item = result as Record<string, unknown>
  if (item.error) return null
  if (typeof item.display_name !== 'string') throw new Error('Could not parse Nominatim reverse response: missing display name.')
  return {
    display_name: item.display_name,
    address: item.address && typeof item.address === 'object' ? item.address : {},
    osm_type: item.osm_type ?? null,
    osm_id: item.osm_id ?? null,
    place_id: item.place_id ?? null,
  }
}

export const enforceNominatimRequestLimit = validateCount
