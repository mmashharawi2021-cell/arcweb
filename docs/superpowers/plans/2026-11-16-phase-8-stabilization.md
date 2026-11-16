# Phase 8 — Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the codebase under version control, close the CLAUDE.md gaps (View tab, `/src/store/`, off-main-thread work with Cancel) and the open audit follow-ups, without changing saved-project compatibility.

**Architecture:** Behaviour-preserving refactor first (store split), then additive features behind existing seams: a generic `runInWorker` client used by two module workers (import, geoprocessing); small pure helpers (`isolate`, `finiteNumber`, `tableRow`) applied at the confirmed defect sites; one new presentational ribbon component.

**Tech Stack:** React 19 + TypeScript (Vite 8, module workers via `new Worker(new URL(..., import.meta.url), { type: 'module' })`), Zustand 5, MapLibre GL 6.18, Turf 7, Vitest 4 (node environment — **no DOM test environment**).

**Spec:** `docs/superpowers/specs/2026-11-16-phase-8-stabilization-design.md`. Background: `docs/audit-2026-11-15.md` (finding IDs and follow-ups referenced below).

## Global Constraints

- Zero backend: everything runs in the browser; no new runtime dependencies, no dependency upgrades.
- Saved projects must still open: do not change `PROJECT_VERSION` (1) or the project JSON shape; `parseProject` behaviour for existing files is unchanged.
- Run every check from the **uppercase** path `C:\Users\mozar\Desktop\VS\arcweb` (CLAUDE.md §8). In PowerShell use `node_modules\.bin\tsc.cmd -b`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build`. Never weaken tests or app logic to work around the lowercase-drive Vitest issue.
- Baseline before Task 1: `tsc -b` exit 0, lint exit 0, **30 test files / 297 tests** pass, build exit 0. Every task must end with all four green and the test count ≥ the previous task's.
- No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`/`oxlint-disable`. Unavoidable casts get a one-line comment saying why.
- Preserve each file's existing line endings (many `src/*.tsx` files are CRLF, `src/layout/*` and tests are LF). Do not mass-reformat.
- User-visible strings are English; any user-supplied text (layer, field, file names) may be Arabic/mixed — render with `dir="auto"` or isolate per Task 6.
- Commit after each task with a conventional message ending in the attribution lines from the session's system reminder.

## Review Focus

1. **Cancel mid-run** (import or tool): no partial layer is added, the progress overlay clears, History gets a `failed` entry `Cancelled by user.`, and the *next* run works (a fresh worker is created). → Task 4 test `abort terminates and the next call uses a new worker`; Task 5 History assertion.
2. **Large data through a worker** (60k points, ~11 MB): the page stays responsive during import. → Task 9 measures the longest frame gap during import (expect < 250 ms; baseline ~970 ms).
3. **DOM-dependent paths still work**: KML import, Excel to Table and Import Data run on the main thread. → Task 4 test `needsMainThread is case-insensitive for .kml`; Task 5 test `worker rejects main-thread-only tools`.
4. **Existing sessions and projects after the store split** load identically (IndexedDB session, `.arcweb.json`). → Task 2 store-API test + existing `projectPersistence`/`editSessionResume` suites; Task 9 reload check.
5. **Network tools inside the worker** (geocoding uses `fetch`) keep working and report HTTP errors. → Task 5 test runs `geocode-addresses` through the worker handler with a stubbed `fetch`.

---

### Task 1: Baseline commit and working branch

**Files:**
- Modify: `.gitignore` (append `tmp/` and `coverage/`)

- [ ] **Step 1:** Run the four checks from `C:\Users\mozar\Desktop\VS\arcweb`. Expected: all exit 0, `30 passed (30)` files, `297 passed (297)` tests. If not, stop and report — do not commit a red tree.
- [ ] **Step 2:** Append `tmp/` and `coverage/` lines to `.gitignore`. Run `git status --short`; confirm `node_modules/`, `dist/` and `tmp/` are absent and nothing over 5 MB is listed (`git ls-files --others --exclude-standard -z | xargs -0 du -k | sort -n | tail`).
- [ ] **Step 3:** Commit everything on `main`: `git add -A && git commit -m "chore: baseline ArcWeb through phase 7 and audits"`.
- [ ] **Step 4:** `git switch -c phase-8-stabilization`. Expected: `git log --oneline` shows exactly one commit.

### Task 2: Split `src/store.ts` into `src/store/`

**Files:**
- Create: `src/store/types.ts`, `src/store/slices/layers.ts`, `src/store/slices/selection.ts`, `src/store/slices/editSession.ts`, `src/store/slices/workspace.ts`, `src/store/slices/projectData.ts`, `src/store/index.ts`
- Delete: `src/store.ts` (it would shadow `src/store/index.ts` for the `./store` specifier)
- Test: `src/store/__tests__/storeApi.test.ts`

**Interfaces:**
- Produces: `src/store/index.ts` exports **exactly** the names `src/store.ts` exports today (`useArcWebStore`, every type, `DEFAULT_SCENE_SETTINGS`, `MAX_ANALYSIS_HISTORY`, `MAX_UNDO_STEPS`, …) plus `export type { ArcWebState }`. All 60 importers keep `from './store'` / `'../store'` unchanged.
- Slice ownership: `layers` (layers, selectedLayerId, add/remove/update/move/restoreLayers, clearSession), `selection` (selectedFeature, selections, setSelection, toggleSelected, clearSelection), `editSession` (editSnapshots, undoStack, redoStack, beginEdit, commitEdit, undo, redo, saveEdits, discardEdits, restoreEditSnapshots — `applyHistoryStep` moves here and uses the slice's `get`/`set`), `workspace` (activeTab, ribbonReturnTab, tool, viewMode, theme, basemap, displayCrs, tableOpen, mapPropertiesOpen, workspaceLayout, projectName, bookmarks and their setters), `projectData` (analysisHistory, tableViews, sceneSettings and their setters).
- Cross-slice actions (`removeLayer`, `clearSession`, `restoreLayers`) stay single `set` calls that update all affected keys atomically, exactly as today.
- Each slice: `export const createXSlice: StateCreator<ArcWebState, [], [], XSlice>`.

- [ ] **Step 1: Write the API-contract test against the current store (must pass before refactoring)**

```ts
import { describe, expect, it } from 'vitest'
import * as store from '../index' // resolves to src/store.ts before the move, src/store/index.ts after
const EXPECTED_STATE_KEYS = [/* paste Object.keys(useArcWebStore.getState()).sort() captured in Step 2 */]
describe('store public API is unchanged by the split', () => {
  it('keeps every state key and action', () => {
    expect(Object.keys(store.useArcWebStore.getState()).sort()).toEqual(EXPECTED_STATE_KEYS)
  })
  it('keeps every runtime export', () => {
    expect(Object.keys(store).sort()).toEqual(['DEFAULT_SCENE_SETTINGS', 'MAX_ANALYSIS_HISTORY', 'MAX_UNDO_STEPS', 'useArcWebStore'])
  })
  it('removeLayer still clears the layer from every slice in one update', () => { /* add layer, select a feature, set table view, beginEdit; removeLayer; assert selections/editSnapshots/tableViews/undoStack have no entry and exactly one subscriber notification fired */ })
})
```
Place it temporarily at `src/__tests__/storeApi.test.ts` importing `'../store'`; move it in Step 5.
- [ ] **Step 2:** Capture the key list: run the test once with an empty array, copy the received list from the failure diff into `EXPECTED_STATE_KEYS`. Run again — Expected: PASS (3 tests).
- [ ] **Step 3:** Create `src/store/types.ts` (all exported types/consts verbatim), the five slices and `src/store/index.ts` composing them with `create<ArcWebState>()((...a) => ({ ...createLayersSlice(...a), ... }))`. Delete `src/store.ts`.
- [ ] **Step 4:** Run `node_modules\.bin\tsc.cmd -b` (expect 0 errors without touching any importer) and `npm.cmd test` (expect 31 files / 300 tests).
- [ ] **Step 5:** Move the test to `src/store/__tests__/storeApi.test.ts`, import `'../index'`, rerun. Expected: PASS.
- [ ] **Step 6:** Commit `refactor(store): split store into slices under src/store/`.

### Task 3: View ribbon tab

**Files:**
- Modify: `src/store/types.ts` (`CoreTab` gains `'View'`), `src/ribbon/contextualTabs.ts` (`CORE_TABS`, `NEUTRAL_TABS`), `src/App.tsx` (render branch + handlers), `src/App.css`
- Create: `src/ribbon/ViewRibbon.tsx`
- Test: `src/ribbon/__tests__/contextualTabs.test.ts` (extend)

**Interfaces:**
- `CORE_TABS = ['Map', 'Insert', 'Analysis', 'Edit', 'View', 'Layout', 'Share']`; `'View'` is a neutral tab (layer selection may auto-switch to Feature/Raster Layer from it).
- `ViewRibbon(props: { contentsOpen: boolean; sidePaneOpen: boolean; tableOpen: boolean; tableAvailable: boolean; preset: WorkspacePreset; mode: '2d' | '3d' | 'layout'; fullCanvas: boolean; theme: 'dark' | 'light'; onTogglePane(pane: 'contents' | 'side' | 'table'): void; onPreset(preset: WorkspacePreset): void; onMode(mode: '2d' | '3d' | 'layout'): void; onToggleFullCanvas(): void; onToggleTheme(): void })` — groups captioned **Windows**, **Workspace**, **View**, **Display**; buttons use `ribbon-action` + `tool-selected` for active state. App wires props to the existing handlers (`selectWorkspacePreset`, `toggleFullCanvas`, `setSceneView`/`setViewMode`, `contentsMinimized`, `rightPaneOpen`, `setTableOpen`, `setTheme`). No new store state.

- [ ] **Step 1: Failing tests** in the contextual-tabs suite:

```ts
it('orders core tabs with View between Edit and Layout', () => {
  expect(CORE_TABS).toEqual(['Map', 'Insert', 'Analysis', 'Edit', 'View', 'Layout', 'Share'])
})
it('treats View as neutral: a newly selected vector layer takes over the ribbon', () => {
  expect(reconcileRibbonTabs({ activeTab: 'View', returnTab: 'Map' }, [], ['FeatureLayer'])).toEqual({ activeTab: 'FeatureLayer', returnTab: 'View' })
})
```
- [ ] **Step 2:** Run `npm.cmd test -- src/ribbon` → Expected: 2 FAIL.
- [ ] **Step 3:** Implement the type/constant changes, `ViewRibbon.tsx`, and the `activeTab === 'View'` branch in the ribbon toolbar of `App.tsx` (the right pane falls through to Symbology like Map/Insert).
- [ ] **Step 4:** Run all four checks → green.
- [ ] **Step 5:** Commit `feat(ribbon): add View tab with window, workspace and display controls`.

### Task 4: Import in a Web Worker with Cancel

**Files:**
- Create: `src/workers/runInWorker.ts`, `src/workers/importProtocol.ts`, `src/workers/import.worker.ts`, `src/workers/importHandler.ts`
- Modify: `src/App.tsx` (import loop + progress overlay Cancel button), `src/App.css`
- Test: `src/workers/__tests__/runInWorker.test.ts`, `src/workers/__tests__/importHandler.test.ts`

**Interfaces:**
- `interface WorkerLike { postMessage(message: unknown): void; terminate(): void; onmessage: ((event: { data: unknown }) => void) | null; onerror: ((event: { message?: string }) => void) | null }`
- `type WorkerReply<R> = { kind: 'progress'; current: number; total: number; message: string } | { kind: 'result'; value: R } | { kind: 'error'; message: string }`
- `runInWorker<Q, R>(createWorker: () => WorkerLike, request: Q, options?: { signal?: AbortSignal; onProgress?: (p: { current: number; total: number; message: string }) => void }): Promise<R>` — one worker per call, always terminated on settle; on abort terminates and rejects with `new DOMException('Cancelled by user.', 'AbortError')`.
- `type ImportRequest = { file: File }`; `type ImportResult = { kind: 'vector'; layers: ImportedLayerData[] } | { kind: 'raster'; name: string; grid: RasterGrid }`.
- `handleImportRequest(request: ImportRequest): Promise<ImportResult>` (pure; vector via `readGeospatialFile`, `.tif/.tiff` via `readGeoTiff`).
- `needsMainThread(fileName: string): boolean` — true for `.kml` (any case); App calls the existing main-thread path for those.
- `import.worker.ts` only wires `self.onmessage` → `handleImportRequest` → `postMessage(WorkerReply)`; the `self` typing cast gets a one-line comment.
- App keeps an `AbortController` per import; the overlay shows **Cancel**; a cancelled import notifies `Import of ⁨name⁩ cancelled.` (warning, isolated name per Task 6 helper once it exists — plain name before) and adds nothing.

- [ ] **Step 1: Failing client tests** with a `FakeWorker` implementing `WorkerLike` (records `postMessage`/`terminate`, lets the test emit replies):

```ts
it('resolves with the result and terminates the worker', ...)            // expect value, terminate called once
it('forwards progress replies to onProgress', ...)                         // expect [{ current: 1, total: 2, message: 'Reading' }]
it('rejects with the worker error message', ...)                           // rejects.toThrow('The CSV file is empty.')
it('abort terminates and the next call uses a new worker', ...)            // rejects name 'AbortError'; factory called twice; first.terminated
it('rejects immediately when the signal is already aborted', ...)          // factory never called
```
- [ ] **Step 2: Failing handler tests** (node has `File`):

```ts
it('imports a CSV through the worker handler with its skip warning', ...)   // kind 'vector', 2 features, warnings ['Skipped 1 of 3 rows without valid WGS84 lat/lon values.']
it('reports unsupported files with the existing message', ...)             // rejects 'Unsupported file type: .txt'
it('needsMainThread is case-insensitive for .kml', () => { expect(needsMainThread('A.KML')).toBe(true); expect(needsMainThread('a.geojson')).toBe(false) })
```
- [ ] **Step 3:** Run `npm.cmd test -- src/workers` → Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement the four modules; wire `App.tsx` `addFiles` to call `runInWorker(() => new Worker(new URL('./workers/import.worker.ts', import.meta.url), { type: 'module' }), { file }, { signal, onProgress })` unless `needsMainThread`; raster results go through the existing `rasterToFeatureCollection`/`styleRasterCells` path on the main thread.
- [ ] **Step 5:** Run all four checks; `npm.cmd run build` must emit a separate worker chunk (`dist/assets/import.worker-*.js`).
- [ ] **Step 6:** Commit `feat(import): run file import in a web worker with cancel`.

### Task 5: Geoprocessing in a Web Worker with Cancel

**Files:**
- Create: `src/workers/toolProtocol.ts`, `src/workers/tool.worker.ts`, `src/workers/toolHandler.ts`
- Modify: `src/toolboxes/types.ts` (`ToolboxTool.runsOnMainThread?: true`), `src/toolboxes/conversion/excelToTable.ts` and `src/toolboxes/conversion/importData.ts` (set the flag), `src/App.tsx` (`executeTool`), `src/toolboxes/ToolboxPanel.tsx` (Cancel button while running)
- Test: `src/workers/__tests__/toolHandler.test.ts`

**Interfaces:**
- Consumes: `runInWorker`, `WorkerLike`, `WorkerReply` (Task 4).
- `type ToolRequest = { toolId: string; layers: MapLayer[]; selectedLayerId: string | null; parameters: ToolboxParameters }` (layers are already selection-scoped by App; merge-back stays in App).
- `handleToolRequest(request: ToolRequest, onProgress: (p) => void): Promise<ToolExecutionResult>` — looks up `toolboxTools` by id; throws `Unknown tool: <id>.` or `<Tool name> must run on the main thread.` for flagged tools.
- `ToolboxPanel` gains prop `onCancel: () => void`; while `running`, the Run button is replaced by **Cancel** (`phase-secondary-button`).
- App: flagged tools use the existing direct `execute` path; others use `runInWorker`. On `AbortError` → History record `status: 'failed'`, `message: 'Cancelled by user.'`, warning toast; nothing else applied.

- [ ] **Step 1: Failing tests**

```ts
it('runs Buffer by id and returns its output layer', ...)                  // result.layers[0].geometry === 'Polygon'
it('forwards tool progress', ...)                                           // a tool that calls onProgress (e.g. geocode-addresses) → progress received
it('runs a network tool with fetch stubbed and surfaces HTTP errors', ...) // vi.stubGlobal('fetch', … 429) → rejects /429/
it('rejects unknown tool ids', ...)                                         // 'Unknown tool: nope.'
it('worker rejects main-thread-only tools', ...)                            // excel-to-table → /must run on the main thread/
it('every tool that imports read-excel-file or readGeospatialFile is flagged', ...) // assert the flag on excelToTableTool and importDataTool
```
- [ ] **Step 2:** Run `npm.cmd test -- src/workers` → Expected: new tests FAIL.
- [ ] **Step 3:** Implement protocol, handler, worker entry, flag, App/ToolboxPanel wiring.
- [ ] **Step 4:** Run all four checks; build emits `tool.worker-*.js`.
- [ ] **Step 5:** Commit `feat(geoprocessing): run tools in a web worker with cancel`.

### Task 6: Bidi isolation for names in toasts

**Files:**
- Create: `src/bidi.ts`
- Modify: `src/App.tsx` (the 13 `notify(\`…${…name}…\`)` templates — find them with `rg "notify\(\`[^\`]*\$\{[^}]*name" src/App.tsx`), Task 4's cancel message
- Test: `src/__tests__/bidi.test.ts`

**Interfaces:** `isolate(text: string): string` → `'\u2068' + text + '\u2069'` (first-strong isolate … pop directional isolate). Apply to interpolated user names only, never to whole messages.

- [ ] **Step 1: Failing test**

```ts
it('wraps text in first-strong isolates', () => { expect(isolate('طبقة QA')).toBe('\u2068طبقة QA\u2069') })
it('keeps surrounding text unchanged', () => { expect(`Removed ${isolate('طبقة')} from the map.`).toMatch(/^Removed \u2068طبقة\u2069 from the map\.$/) })
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and apply. **Step 4:** Four checks green. **Step 5:** Commit `fix(a11y): isolate user names inside toast messages`.

### Task 7: Audit follow-ups (four independent fixes, one commit each)

**7a — DEM sampler release** (follow-up 4). Modify `src/scene/terrain.ts`: in `applySceneTerrain`, delete `samplers` entries whose id is not in `layers`; export `demSamplerCount(): number` for tests. Test in `src/scene/__tests__/terrain.test.ts`: register via a stub map (object with the `isStyleLoaded/getSource/addSource/removeSource/getLayer/removeLayer/addLayer/getStyle/getTerrain/setTerrain` methods used) for layer A, then call with `layers: []` → `demSamplerCount()` goes 1 → 0. Commit `fix(scene): release DEM samplers of removed layers`.

**7b — Missing values are not zero** (follow-up 6). Create `src/numbers.ts`: `finiteNumber(value: unknown): number | null` (finite numbers; non-blank numeric strings; everything else `null`). Use it in `rasterFromFeatureCollection` (`src/rasterEngine.ts:118`, a null value cell becomes NoData) and in `getGraduatedClassCounts` / `buildGraduatedRenderer` (`src/symbology.ts:203,237`). Tests first:
```ts
it('treats a null raster value as NoData, not 0', ...)        // cell with value null → isNoData(grid.values[i], grid.noData)
it('graduated breaks and counts ignore null and blank values', ...) // values [null, '', 10, 20, 30] → counts sum to 3
it('finiteNumber', () => { expect([0, '5', ' ', null, true, NaN, '1e3'].map(finiteNumber)).toEqual([0, 5, null, null, null, null, 1000]) })
```
Do not touch the other existing coercers. Commit `fix(data): treat blank and null numeric values as missing`.

**7c — Alter Field keeps references consistent** (follow-up 5). Modify `src/toolboxes/dataManagement/alterField.ts`: on rename also rewrite `{OLD}` tokens in `labelStyle.expression` (token regex as in `labelTextExpression`: `/\{([^{}]+)\}/g`) and `extrusion.field`. Test in `src/toolboxes/dataManagement/__tests__/dataManagement.test.ts`: layer with `labelStyle.expression = '{name} ({pop})'` and `extrusion = { field: 'pop', multiplier: 2 }`; rename `pop`→`population` → expression `'{name} ({population})'`, extrusion field `'population'`, multiplier unchanged; renaming an unrelated field leaves both untouched. Commit `fix(tools): Alter Field updates label expressions and extrusion`.

**7d — Modal focus lifecycle** (follow-up 7). Create `src/a11y/modalFocus.ts` exporting `trapTabKey(event: ReactKeyboardEvent<HTMLElement>): void` (moved from `App.tsx`) and `useRestoreFocus(): void` (captures `document.activeElement` on mount; on unmount refocuses it if focus is on `body` or inside the dialog). Apply to `MapProperties.tsx` and both dialogs in `selection/SelectionDialogs.tsx`; App's two alert dialogs import the moved `trapTabKey`. No DOM test environment: verification is Task 9 (Tab wraps, Escape closes, focus returns to the opener). Commit `fix(a11y): trap focus and restore it in all modal dialogs`.

- [ ] For each of 7a–7c: failing test → run (FAIL) → implement → four checks green → commit. For 7d: implement → four checks green → commit; browser proof in Task 9.

### Task 8: One helper for null-geometry table rows (ID 17, incremental)

**Files:**
- Create: `src/geojson.ts`
- Modify: the five producers found by `rg "null as unknown as|as unknown as Feature" src --glob "!**/__tests__/**"` (`toolboxes/analysis/_utils.ts`, `conversion/_utils.ts`, `dataManagement/repairGeometry.ts`, `dataManagement/_utils.ts`, `networkAnalyst/_shared.ts`)
- Test: `src/__tests__/geojson.test.ts`

**Interfaces:** `tableRow(properties: Record<string, unknown>): Feature` — returns `{ type: 'Feature', properties, geometry: null }`; contains the single documented cast (MapLayer typing does not model null geometry; see audit ID 17). `hasGeometry(feature: Feature): boolean` is **not** added (YAGNI).

- [ ] **Step 1:** Failing test: `expect(tableRow({ a: 1 })).toEqual({ type: 'Feature', properties: { a: 1 }, geometry: null })`. **Step 2:** Run → FAIL. **Step 3:** Implement; replace the five casts (repairGeometry keeps its other fields: `{ ...feature, geometry: null }` via a second exported `withoutGeometry(feature: Feature): Feature` in the same file, also tested). **Step 4:** `rg "null as unknown as|as unknown as Feature" src --glob "!**/__tests__/**"` returns only `src/geojson.ts`; four checks green; the existing `nullGeometry.test.ts` still passes. **Step 5:** Commit `refactor(geojson): centralise null-geometry table rows`.

### Task 9: Browser regression pass

Requires browser tooling (VS Code integrated browser MCP or equivalent). If it is unavailable, report that and stop — do not mark this task done.

**Files:**
- Create: `scripts/qa/make-fixtures.mjs` (dev-only Node script; writes to `tmp/qa-fixtures/`: `dem_wgs84.tif`, `dem_utm36.tif` (40×30 Float32, EPSG:4326 and EPSG:32636), `parcels_wgs84.zip` and `parcels_noprj.zip` with a hand-written UTF-8 DBF + `.cpg` (`@mapbox/shp-write` truncates non-ASCII text) and Arabic/mixed names `حي الرمال`, `Market 7 سوق`, `Park`, `الشاطئ 2`)
- Create: `docs/qa/2026-11-16-phase-8-qa.md` (evidence log)

- [ ] **Step 1:** `node scripts/qa/make-fixtures.mjs`; validate each fixture with an independent reader (geotiff/shpjs) before use.
- [ ] **Step 2:** Run and record, with console checked for errors after each:
  - imports of all four fixtures + KML (main thread) + 60k-point GeoJSON with the **longest frame gap** (Review Focus 2) and a mid-import **Cancel**;
  - a tool run in the worker (Buffer), a main-thread tool (Excel to Table), and a mid-run **Cancel** → History entry `Cancelled by user.`, next run succeeds;
  - View tab: every control toggles its target; auto-switch to Feature Layer from View;
  - toasts with Arabic layer names render in logical order;
  - Map Properties and both Selection dialogs: Tab wraps, Escape closes, focus returns to the opener;
  - edit → Save / Discard / reload resume; project download → Clear session → reopen the downloaded file;
  - layout PNG/PDF export with content.
- [ ] **Step 3:** Delete `tmp/`; restore the workspace (Clear session, Classic template, project name `Untitled map`).
- [ ] **Step 4:** Commit `test(qa): phase 8 browser regression evidence` (script + QA doc only).

---

## Execution order and parallelism

`1 → 2 →` { `3`, `4 → 5`, `6`, `7a`, `7b`, `7c`, `7d`, `8` } `→ 9`.
Tasks 3, 4, 5, 6 and 7d all edit `src/App.tsx`; run them sequentially (or in separate worktrees merged in that order) to avoid conflicts. 7a, 7b, 7c and 8 touch disjoint files and can run in parallel after Task 2.

## Next plan (not in this one)

Phase 9 — **Catalog pane** (CLAUDE.md §4 right pane): brainstorm → spec → plan. Separately: application-wide nullable-geometry typing (ID 17 completion; measured at 190 errors across 49 files).
