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
