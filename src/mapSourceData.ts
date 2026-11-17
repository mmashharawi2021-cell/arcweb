import type { FeatureCollection } from 'geojson'

export interface MapSourceData {
  data: FeatureCollection | string
  dispose: () => void
}

const preparedBlobs = new WeakMap<FeatureCollection, Blob>()
export function seedMapSourceBlob(data: FeatureCollection, blob: Blob) { preparedBlobs.set(data, blob) }

export function renderCollection(data: FeatureCollection): FeatureCollection {
  return { ...data, features: data.features
    .filter((feature) => feature.geometry !== null)
    .map((feature) => ({ ...feature, properties: { ...(feature.properties ?? {}), __arcweb_feature_id: feature.id ?? '' } })) }
}

/** Large object sources are recursively serialized by MapLibre on the UI thread.
 * A local Blob URL lets its worker fetch/parse JSON instead; nothing leaves the browser. */
export function prepareMapSourceData(data: FeatureCollection): MapSourceData {
  let blob = preparedBlobs.get(data)
  preparedBlobs.delete(data)
  if (!blob) {
    const rendered = renderCollection(data)
    if (rendered.features.length < 10_000) return { data: rendered, dispose: () => undefined }
    blob = new Blob([JSON.stringify(rendered)], { type: 'application/geo+json' })
  }
  const url = URL.createObjectURL(blob)
  let disposed = false
  return { data: url, dispose: () => {
    if (!disposed) { disposed = true; URL.revokeObjectURL(url) }
  } }
}
