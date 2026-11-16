import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

/**
 * Vendor chunks. Vite 8 bundles with Rolldown, where `output.codeSplitting.groups`
 * replaces Rollup's `manualChunks` (still accepted, but deprecated). Splitting the heavy
 * libraries out of the app chunk lets the browser cache them across deployments.
 * Higher priority wins when a module matches several groups.
 */
const vendorChunks = [
  { name: 'maplibre', test: /node_modules[\\/](maplibre-gl|@maplibre|@mapbox[\\/](?!shp-write))/, priority: 40 },
  // Turf and the geometry engines it pulls in (JSTS, polyclip, rbush, …).
  { name: 'turf', test: /node_modules[\\/](@turf|jsts|polyclip-ts|rbush|quickselect|splaytree-ts|bignumber\.js|concaveman|robust-predicates|point-in-polygon-hao|tinyqueue|sweepline-intersections|geojson-polygon-self-intersections)/, priority: 30 },
  { name: 'proj4', test: /node_modules[\\/](proj4|mgrs|wkt-parser)/, priority: 30 },
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/, priority: 30 },
  // File readers and writers: Shapefile, KML, CSV, ZIP.
  { name: 'formats', test: /node_modules[\\/](shpjs|@mapbox[\\/]shp-write|jszip|papaparse|@tmcw|pako|but-unzip|parsedbf|dbf)/, priority: 20 },
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // MapLibre GL is a single ~1 MB library that cannot be split further; every other
    // chunk stays well below Vite's default 500 kB advisory limit.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: vendorChunks },
      },
    },
  },
})
