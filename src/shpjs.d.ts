declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson'

  type ShapefileResult = FeatureCollection | FeatureCollection[] | Record<string, FeatureCollection>
  export default function shp(source: ArrayBuffer): Promise<ShapefileResult>
}
