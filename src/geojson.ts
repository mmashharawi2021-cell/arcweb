import type { Feature } from 'geojson'

/**
 * Standalone table rows are GeoJSON features with `geometry: null`. The app's MapLayer typing
 * (`FeatureCollection` from `geojson`) does not model null geometry (audit ID 17), so every such
 * row is created here, and the single cast needed to satisfy `Feature` lives in this module only.
 */

/** A table row: a feature with properties and no geometry. */
export function tableRow(properties: Record<string, unknown>): Feature {
  // Audit ID 17: MapLayer typing does not model null geometry, so the null is cast here once.
  return { type: 'Feature', properties, geometry: null } as unknown as Feature
}

/** Copies a feature with its geometry removed, keeping its id, properties and other fields. */
export function withoutGeometry(feature: Feature): Feature {
  // Audit ID 17: MapLayer typing does not model null geometry, so the null is cast here once.
  return { ...feature, geometry: null } as unknown as Feature
}
