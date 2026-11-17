import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** App version for Backstage › About, injected at build time so the app does not bundle the whole package.json. */
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

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
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  plugins: [react(), tailwindcss(), {
    name: 'arcweb-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = [...new Set(['index.html', ...Object.keys(bundle).filter(name => /\.(?:html|js|mjs|css|svg|woff2?)$/.test(name))])]
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 16)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = 'arcweb-app-${version}';
const FILES = ${JSON.stringify([...files, 'favicon.svg'])};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new URL(file, self.registration.scope).href))).then(() => self.skipWaiting())));
// Drop superseded application shells; only caches this worker created are touched.
self.addEventListener('activate', event => event.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(key => key.startsWith('arcweb-app-') && key !== CACHE).map(key => caches.delete(key))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const relative = event.request.url.slice(self.registration.scope.length).split('?')[0];
  if (event.request.mode !== 'navigate' && !FILES.includes(relative)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(new URL('index.html', self.registration.scope).href))));
  } else event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
` })
    },
  }],
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
