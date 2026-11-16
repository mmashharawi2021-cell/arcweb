import { describe, expect, it } from 'vitest'
import { buildToolboxTree, searchTools, toolboxTools } from '../registry'
import type { ToolboxCategory } from '../types'

/** The ArcGIS Pro toolsets each toolbox may use. Cartography (symbology) tools sit at the toolbox root. */
const expectedToolsets: Record<ToolboxCategory, string[]> = {
  Analysis: ['Extract', 'Overlay', 'Proximity', 'Statistics'],
  'Data Management': ['Features', 'Fields', 'General', 'Generalization', 'Projections', 'Sampling'],
  Conversion: ['Cartography & Topology', 'From/To Files'],
  'Spatial Statistics': ['Analyzing Patterns', 'Mapping Clusters', 'Measuring Geographic Distributions'],
  Cartography: ['Generalization', 'Map Series'],
  'Spatial Analyst': ['Density', 'Extraction', 'Hydrology', 'Interpolation', 'Raster', 'Surface', 'Zonal'],
  'Network Analyst': ['Network Analysis'],
  Geocoding: [],
  '3D Analyst': ['3D Features', 'Functional Surface', 'Visibility'],
  'Image Analyst': ['Classification', 'Conversion', 'Filtering', 'Spectral'],
}

const requiredIds = [
  // Analysis
  'clip', 'select', 'split', 'table-select', 'erase', 'identity', 'intersect', 'symmetrical-difference', 'union', 'update',
  'buffer', 'multiple-ring-buffer', 'near', 'point-distance', 'create-thiessen-polygons',
  'summary-statistics', 'frequency', 'tabulate-intersection', 'summarize-within',
  // Data Management
  'add-xy-coordinates', 'check-geometry', 'repair-geometry', 'feature-to-point', 'feature-to-line', 'feature-to-polygon',
  'multipart-to-singlepart', 'dissolve', 'eliminate-polygon-part', 'minimum-bounding-geometry',
  'add-field', 'delete-field', 'calculate-field', 'calculate-geometry',
  'append', 'merge', 'find-identical', 'delete-identical', 'sort',
  'simplify-line', 'simplify-polygon', 'smooth-line', 'smooth-polygon',
  'define-projection', 'project', 'create-fishnet', 'create-random-points', 'generate-points-along-lines',
  'copy-features', 'feature-vertices-to-points', 'alter-field', 'create-feature-class', 'add-join',
  // Conversion
  'features-to-geojson', 'features-to-csv', 'features-to-kml', 'features-to-shapefile', 'xy-table-to-point', 'excel-to-table',
  'densify', 'generalize', 'polygon-neighbors', 'conversion-create-thiessen-polygons',
  'features-to-dxf', 'dxf-to-features', 'table-to-excel',
  // Spatial Statistics
  'mean-center', 'median-center', 'central-feature', 'directional-distribution', 'standard-distance',
  'average-nearest-neighbor', 'spatial-autocorrelation', 'hot-spot-analysis', 'cluster-outlier-analysis',
  // Spatial Analyst
  'slope', 'aspect', 'hillshade', 'contour', 'idw', 'tin-interpolation', 'reclassify', 'fill', 'kernelDensity',
  'rasterCalculator', 'extractByMask', 'zonalStatisticsAsTable', 'flowDirection', 'flowAccumulation', 'importGeoTiff',
  // Network Analyst
  'network-route', 'network-closest-facility', 'network-service-area', 'network-od-cost-matrix',
  // Cartography and Geocoding
  'aggregate-polygons', 'grid-index-features', 'detect-graphic-conflict', 'geocode-addresses', 'reverse-geocode',
  // Image Analyst
  'spectralIndices', 'isoClusterUnsupervisedClassification', 'majorityFilter', 'rasterToPolygon', 'polygonToRaster',
  // 3D Analyst
  'createTin', 'featureTo3DByAttribute', 'interpolateShape', 'lineOfSight', 'viewshed',
]

describe('toolbox registry', () => {
  it('has unique tool IDs', () => {
    const ids = toolboxTools.map((tool) => tool.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('contains every requested ArcGIS Pro tool', () => {
    const ids = new Set(toolboxTools.map((tool) => tool.id))
    expect(requiredIds.filter((id) => !ids.has(id))).toEqual([])
  })

  it('places every tool in a valid toolset of its toolbox', () => {
    for (const tool of toolboxTools) {
      const allowed = expectedToolsets[tool.category]
      if (tool.subcategory) expect(allowed, `${tool.id} subcategory`).toContain(tool.subcategory)
      else expect(['Cartography', 'Geocoding'], `${tool.id} root toolbox`).toContain(tool.category)
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('builds the nested Toolbox › Toolset › Tool tree', () => {
    const tree = buildToolboxTree()
    expect(tree.map((node) => node.label)).toEqual([
      'Analysis Tools', 'Data Management Tools', 'Conversion Tools', 'Spatial Statistics Tools', 'Cartography Tools',
      'Spatial Analyst Tools', 'Network Analyst Tools', 'Geocoding Tools',
      '3D Analyst Tools', 'Image Analyst Tools',
    ])
    for (const node of tree) {
      expect(node.toolsets.map((set) => set.name)).toEqual(expectedToolsets[node.category])
      const names = node.toolsets.flatMap((set) => set.tools.map((tool) => tool.name))
      expect(node.count).toBe(names.length + node.tools.length)
    }
    const overlay = tree[0].toolsets.find((set) => set.name === 'Overlay')!
    expect(overlay.tools.map((tool) => tool.name)).toEqual([...overlay.tools.map((tool) => tool.name)].sort((a, b) => a.localeCompare(b)))
  })

  it('searches by name, keyword, and toolset', () => {
    expect(searchTools('thiessen').map((tool) => tool.id)).toEqual(
      expect.arrayContaining(['create-thiessen-polygons', 'conversion-create-thiessen-polygons']),
    )
    expect(searchTools('overlay').map((tool) => tool.id)).toEqual(expect.arrayContaining(['intersect', 'union', 'identity']))
    expect(searchTools('hot spot').map((tool) => tool.id)).toContain('hot-spot-analysis')
    expect(searchTools('FREQU').map((tool) => tool.id)).toContain('frequency')
  })
})
