# ArcWeb - Client-Side Web GIS Development Guidelines

This file defines the strict rules, architectural patterns, and design principles for developing **ArcWeb**. Read this before making any code modifications.

## 1. Project Identity & Goal
**ArcWeb** is a 100% client-side Web GIS desktop application mimicking **ArcGIS Pro / ArcMap**. It is designed for university students to perform spatial analysis, data editing, and cartography entirely within the browser without any backend server.

## 2. Core Constraints
- **Zero Backend:** ALL operations (geoprocessing, rendering, storage, conversion) MUST run locally in the browser. Do not introduce any Node.js APIs or backend dependencies for core functionality.
- **Performance First:** The browser is the engine. Large GeoJSON files and Shapefiles can cause memory issues. Always optimize rendering and geospatial loops.

## 3. Tech Stack & Primary Libraries
- **UI Framework:** React (Vite) + TypeScript.
- **Styling:** Tailwind CSS + Lucide React (Icons).
- **State Management:** Zustand (for centralized state syncing across map, table, and panels).
- **Map Engine:** MapLibre GL JS (for vector tiles and GeoJSON rendering).
- **Geoprocessing:** Turf.js (Core engine for all spatial analysis tools).
- **Data Ingestion:** `shpjs` (Shapefiles), `@tmcw/togeojson` (KML), `papaparse` (CSV).
- **Local Storage:** IndexedDB (via `idb-keyval`) for session persistence.

## 4. UI/UX Design System (The "ArcGIS Pro" Look)
- **Theme:** Default to a professional Dark Mode (glassmorphism accents are acceptable for menus, but keep the core panels solid and readable).
- **Layout Structure:**
  - **Top Ribbon:** Tabbed interface (Map, Insert, Analysis, Edit, View, Share). No scrolling.
  - **Left Pane (Contents):** Dockable, draggable, z-index hierarchy list with visibility/symbology toggles.
  - **Right Pane (Geoprocessing / Catalog):** Searchable toolbox list, tool execution forms, and symbology settings.
  - **Bottom Pane (Attribute Table):** Resizable data grid synchronized with map selections.
- **Panels:** Must be collapsible and dockable to maximize map canvas space.

## 5. Architecture & Code Organization
The application must be highly modular to accommodate hundreds of GIS tools eventually.
- **`/src/toolboxes/`**: This is the heart of the system. Every spatial tool (e.g., Buffer, Clip) must be an independent, self-contained module exporting a standard interface (Input parameters, Execution logic, Output layer generation).
- **`/src/store/`**: Keep map state, layer state, and selection state separated logically but accessible globally.
- **Two-Way Binding:** Ensure that selections in the Attribute Table reflect instantly on the Map canvas, and vice versa.

## 6. Geospatial Rules
- **Projection:** Assume incoming data might be in various projections. Attempt to reproject or standardize to WGS84 (EPSG:4326) internally before handing it to MapLibre or Turf.js. Provide clear warnings if `.prj` files are missing.
- **Topology & Validity:** When generating new geometries via Turf.js, ensure topology is valid before attempting to render it.
- **Scale & Coordinates:** Always display current scale and live coordinate tracking (WGS84 and UTM equivalents where possible) in a bottom status bar.

## 7. Adding New Tools (Workflow)
When instructed to add a new tool from ArcMap (e.g., "Add Dissolve tool"):
1. Scaffold the UI form in the Geoprocessing pane.
2. Create the execution logic in `/src/toolboxes/analysis/dissolve.ts`.
3. Use Turf.js for the calculation.
4. Output the result as a new layer in the Zustand store.
5. Render it on the MapLibre canvas automatically

## 8. Windows Validation Commands

- Launch validation from the canonical uppercase drive path, e.g.
  `C:\Users\mozar\Desktop\VS\arcweb`. A lowercase `c:\` launch path can make
  Vitest/Vite load its runner twice under differently cased file URLs and fail
  with `Cannot read properties of undefined (reading 'config')`.
- In PowerShell, use `npm.cmd` and `node_modules\.bin\tsc.cmd` if execution
  policy blocks the corresponding `.ps1` shims. Do not change execution policy.
- Checks: `node_modules\.bin\tsc.cmd -b`, `npm.cmd run lint`,
  `npm.cmd test`, and `npm.cmd run build`.
- Treat the drive-case issue as a toolchain limitation; do not weaken tests or
  alter application logic to work around it.

## 9. Project Library and Offline Storage

- `src/storage/` owns the local project library. `arcweb-library-v1` is a versioned
  IndexedDB database with atomic project/chunk/recovery commits and optimistic
  revision checks. Original source files use OPFS with an IndexedDB fallback.
- Legacy `idb-keyval` session/settings keys are read-only migration inputs. Do not
  delete them or clear browser databases as a troubleshooting step. Confirm a
  new commit and export a backup before any intentional data removal.
- Metadata-only saves must not rewrite feature chunks. Preserve immutable feature
  references when normalizing already-valid IDs. Test transaction rollback,
  stale-tab rejection, edit-session recovery and backup round trips.
- Keep the launch origin stable: both `start.bat` (development) and
  `start-offline.bat` (production preview) use `http://127.0.0.1:5173` with strict
  port checks. `localhost`, another port or another browser profile has separate
  storage. Move projects between origins with exported project/backup files.
- Production builds generate `sw.js` for same-origin application assets only.
  Development mode does not install a service worker. External provider tiles
  must not be prefetched or bulk-downloaded without a compatible provider policy.
  Offline basemaps use user-supplied local XYZ ZIP packages or the bounded NASA
  Blue Marble area downloader. Do not redirect that downloader to a different
  provider without verifying its access, caching and offline-download policy.
- Points use chunks of up to 1,000 features; lines/polygons use up to 100.
  Await each chunk request inside the same active IndexedDB transaction rather
  than enqueueing every expensive structured clone in a single main-thread task.
- `fake-indexeddb` is a development-only test dependency. Runtime storage remains
  entirely client-side with no database server or new backend.

## 10. Import and Map Worker Transport

- Vector imports use acknowledged batches (1,000 points / 100 other features).
  Do not send the entire feature array in the final worker reply or commit partial
  batches to application state. Cancellation must terminate the worker.
- Import workers prepare the render Blob and field catalog without dropping any
  original attributes or changing geometry. Keep prepared-layer/data identity shared.
  The map resource owner revokes Blob URLs; consuming a seed must release its cache entry.
- Keep the MapLibre worker bootstrap in `src/workers/maplibre.worker.ts`. Register
  local Blob loading there: MapLibre's protocol lookup uses the prefix before
  `://`, so browser Blob URLs require `blob:http` and `blob:https`, as well as `blob`.
  A bare side-effect import of the worker can be removed by the bundler; retain
  its constructor reference. Verify the production map worker and offline reopen.
- Large-source MapLibre replies can still cause long main-thread tasks. A successful
  sampled run is not proof of universal frame-time budgets or complete GIS type safety.
- Normal library opens prepare large/nonpoint sources in `mapPrepare.worker.ts`
  from immutable chunk descriptors, without posting full feature arrays to it.
  Preserve collection identity when restore does not need to repair feature IDs;
  otherwise prepared resources and field catalogs are lost.
- `map-render-v1:` entries in `meta` are disposable render Blobs/catalogs, keyed
  by the collection header and ordered immutable chunk IDs. They are not project
  data, must not be exported as authoritative backups, and must not prevent opening
  on cache/quota/worker failure. Keep save headroom and remove orphan caches during
  compaction. Changing render-copy semantics requires a cache-prefix version bump.
- After a successful active-project commit, warm eligible render descriptors in
  the background. Keep one deferred job, cancel superseded versions/close, skip
  unchanged descriptors, and let a reader join the same job. Never retain captured
  feature arrays in the job or make authoritative save success depend on it.
- Repository reuse references are weak: losing them may require writing fresh
  immutable chunks but must never change saved data. Prune obsolete bookkeeping
  and clear it on repository close. Retired map callbacks must retain only the
  URL resource, not the previous original collection.
- Build stored render Blobs one source chunk at a time. Do not flatten all chunks
  into a second full collection or stringify the entire collection at once. Preserve
  header, IDs, order, all attributes, and catalogs of null-geometry rows. Clean
  derivative caches of expired revisions without deleting authoritative chunks.

## 11. App Shell Structure

`src/App.tsx` composes the workspace; keep logic out of it and in focused modules:

- **Map:** `src/map/useMapInstance.ts` (single MapLibre instance, resize, layout-frame
  moves), `useMapSync.ts` (basemap, layers, selection, 3D, terrain), `useMapClick.ts`
  (tool routing and Identify). Pure geometry helpers live in `src/mapGeometry.ts`.
- **Editing:** `src/editing/useFeatureEdits.ts` (data edits, undo/redo shortcuts) and
  `useSketchTools.ts` (measure/sketch/move-vertex state and overlays).
- **Project I/O:** `src/useProjectIO.ts` (library session, project files, assets,
  offline basemap) and `src/useFileImport.ts` (import loop and cancellation).
- **UI pieces:** `src/contents/`, `src/ribbon/CoreRibbons.tsx`, `src/StatusBar.tsx`,
  `src/MapOverlays.tsx`, `src/ui/ConfirmDialog.tsx`.

Identity rules (breaking them causes silent, expensive restarts):
- `capture`/`restore` passed to `useProjectLibrary` must keep a stable identity; a new
  identity restarts the library session. `useProjectIO` reads App callbacks via a ref.
- The map is created once. Map event handlers are read through `mapEventsRef`; never
  add handler functions to the map-creation effect's dependencies.
- Pointer-rate state (cursor, zoom) belongs in the component that displays it
  (`StatusBar`), not in App, so pointer moves do not re-render the shell.
- Ribbon tooltips: `addRibbonTooltips` only decorates buttons written inline, so each
  ribbon component applies it to its own output.
