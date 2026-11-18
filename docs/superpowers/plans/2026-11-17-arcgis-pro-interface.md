# ArcGIS Pro–Style Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring ArcWeb's shell to ArcGIS Pro's interaction model — appearance, Project backstage, ribbon, contextual tab groups, view tabs, dockable panes, Contents "List By" modes, measure/sketch tools, icon system and Pro's status/extra elements — while staying 100% client-side.

**Architecture:** Ten phases (A–J), each shippable on its own branch. Shared primitives come first (ribbon components, theme tokens); the pane model (Phase E) replaces "right pane follows the active tab" with independent panes, and later phases build on it. All new layer properties are optional fields parsed in `src/project.ts` so existing projects keep opening.

**Tech Stack:** React 19 + TypeScript, Zustand, MapLibre GL, Turf (`@turf/turf` is installed: `area`, `length`, `circle`, `bboxPolygon`, `booleanIntersects`), Lucide icons, Vitest + happy-dom (per-file `// @vitest-environment happy-dom`).

**Spec:** No separate spec document. This plan argues from (1) the user's request on 2026-11-17 to adopt ArcGIS Pro's appearance, Project page, ribbon, contextual tabs, views, panes, Contents, measure/sketch, icons and extra elements, (2) the Pro-vs-ArcWeb comparison given in that conversation, and (3) `CLAUDE.md`. Decisions taken where the request was open are listed under **Decisions**.

## Implementation status - 2026-11-19

Tasks 1-30 now have implementations on the existing `ui/c-ribbon` branch. See [completion and validation report](../2026-11-19-interface-completion.md). Historical test-first workflow checkboxes below have deliberately not been retroactively checked. They describe execution steps, not the current feature status. Delivery stayed on the existing branch instead of creating a separate branch for every phase; review/merge to main remains a separate release action.

## Decisions

- **Dark stays the default theme** (`CLAUDE.md` §4). Both themes are re-tokenised to Pro's neutral grey + blue scheme; Light/Dark is chosen in Backstage → Options, as in Pro.
- **No Esri assets.** Icons stay Lucide; Pro's *system* (32 px large / 16 px small, colour-coded) is reproduced, not its artwork. No Esri logos, fonts or the "ArcGIS" name in UI text.
- **Core tabs become** `Map, Insert, Analysis, Edit, View, Share, Help` (Pro order). `Layout` becomes a contextual tab group shown in layout view. No `Imagery` tab (raster tools stay in Geoprocessing).
- **One MapLibre instance.** "Map" and "Scene" view tabs share it (`sceneView` toggle); views never create a second map.
- **Panes are independent of ribbon tabs.** Ribbon commands open panes; switching tabs no longer swaps the right pane.
- `Ctrl+N` is not used (browsers reserve it). Shortcuts: `Ctrl+S` save, `Ctrl+O` open, `Alt+Q` command search, `F2` finish sketch, `Esc` cancel sketch/close, `Ctrl+Z`/`Ctrl+Y` undo/redo (existing).

## Global Constraints

- Zero backend: no server, no new network dependency at runtime (`CLAUDE.md` §2).
- Launch validation from `C:\Users\mozar\Desktop\VS\arcweb` (uppercase drive); checks: `node_modules\.bin\tsc.cmd -b`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build` (`CLAUDE.md` §8). All four pass at the end of every task.
- Hook identity rules in `CLAUDE.md` §11 hold: library `capture`/`restore` stable; map handlers only via `mapEventsRef`; pointer-rate state stays in `StatusBar`.
- New `MapLayer` fields are optional; `parseLayer` in `src/project.ts` supplies defaults; a project saved before this plan opens unchanged.
- UI copy is English; user-supplied names are wrapped with `isolate()` from `src/bidi.ts` in messages and `<bdi>` in markup.
- Text contrast ≥ 4.5:1 in both themes (enforced by Task 2's test). Every new control is keyboard reachable with a visible focus ring.
- Component tests use `// @vitest-environment happy-dom` and the helpers in `src/__tests__/helpers/`.
- One branch per phase (`ui/a-foundations`, `ui/b-project`, …); merge to `main` after the phase's tasks pass review.

## Review Focus

1. **Projects and layouts saved before this plan** — a stored `arcweb-workspace-layout-v1` (old `rightPaneOpen`/`contentsMinimized`/`panels`) must open with Contents, Symbology/Geoprocessing and the table where they were. Test: Task 14 `migrates a legacy workspace layout`.
2. **Arabic/RTL layer and project names** in new surfaces (Backstage, Contents sections, Catalog, view tabs, Layer Properties) must render isolated and not reorder neighbouring text. Test: Task 21 `isolates RTL layer names in section rows`; Task 3 `renders the project name inside bdi`.
3. **Narrow windows (≤ 1100 px)** — ribbon groups must collapse to group buttons instead of overflowing or scrolling (`CLAUDE.md` §4 "No scrolling"). Test: Task 1 `collapses rightmost groups first`.
4. **Escape key conflicts** — Escape in an open menu, Backstage or dialog must not also cancel an in-progress sketch or measurement. Test: Task 3 `Escape closes Backstage without reaching the window`; Task 25 `ignores Escape already handled by an overlay`.
5. **Large layers** — Contents "List By Selection", status-bar selection count and box select must not scan every feature per render. Test: Task 21 `counts selection from selection sets only`; Task 8 `uses bbox prefilter`.

---

## File Structure

| Area | New files | Responsibility |
|---|---|---|
| Ribbon | `src/ribbon/RibbonParts.tsx`, `src/ribbon/ribbonLayout.ts` | Group/button/menu/gallery primitives; group collapse logic |
| Theme | `src/ui/uiSettings.ts` | Persisted UI settings (theme, units, coordinate format) |
| Project | `src/project/Backstage.tsx`, `src/storage/ProjectLibraryContent.tsx` | Pro "Project" page; library UI reused inside it |
| Title bar | `src/shell/TitleBar.tsx`, `src/shell/useAppShortcuts.ts` | Quick Access Toolbar, project name, global shortcuts |
| Map tab tools | `src/map/extentHistory.ts`, `src/map/GoToXY.tsx`, `src/map/coordinateInput.ts`, `src/map/boxSelect.ts` | Previous/next extent, Go To XY, rectangle selection |
| Contextual | `src/ribbon/LayerRibbons.tsx`, `src/ribbon/LayoutRibbon.tsx` | Feature/Raster/Layout contextual tab contents |
| Panes | `src/panes/paneLayout.ts`, `src/panes/DockArea.tsx`, `src/panes/CatalogPane.tsx`, `src/panes/CreateFeaturesPane.tsx`, `src/panes/ModifyFeaturesPane.tsx`, `src/panes/AttributesPane.tsx` | Pane state model and dock UI; Pro panes |
| Views | `src/views/ViewTabs.tsx`, `src/views/viewState.ts`, `src/views/TableDock.tsx` | Document-style view tabs; tabbed attribute tables |
| Contents | `src/contents/contentsModes.ts`, `src/contents/SymbolPatch.tsx`, `src/contents/LayerPropertiesDialog.tsx` | List By modes, symbol patches, layer properties |
| Measure/sketch | `src/measure/measure.ts`, `src/measure/MeasureWindow.tsx`, `src/editing/constructionTools.ts`, `src/editing/SketchToolbar.tsx` | Measurement math/UI; construction tools and sketch toolbar |
| Icons | `src/ui/commandIcons.tsx` | Command → icon + colour role |
| Extras | `src/shell/ScaleBox.tsx`, `src/shell/commands.ts`, `src/shell/CommandSearch.tsx`, `src/shell/NotificationsMenu.tsx`, `src/ribbon/HelpRibbon.tsx`, `src/coordinateFormat.ts` | Pro status bar, command search, notifications, Help tab |

Modified throughout: `src/App.tsx`, `src/App.css`, `src/index.css`, `src/store/types.ts`, `src/store/slices/workspace.ts`, `src/project.ts`, `src/ribbon/contextualTabs.ts`, `src/ribbon/CoreRibbons.tsx`, `src/map/useMapClick.ts`, `src/editing/useSketchTools.ts`, `src/StatusBar.tsx`, `src/contents/ContentsPanel.tsx`, `CLAUDE.md`.

---

## Phase A — Foundations & Appearance

### Task 1: Ribbon primitives and group collapse

**Files:**
- Create: `src/ribbon/RibbonParts.tsx`, `src/ribbon/ribbonLayout.ts`, `src/__tests__/helpers/renderComponent.ts`
- Test: `src/ribbon/__tests__/ribbonParts.test.ts`, `src/ribbon/__tests__/ribbonLayout.test.ts`

**Interfaces:**
- Produces:
  - `renderComponent(element: ReactElement): { container: HTMLElement; rerender(next: ReactElement): void; unmount(): void }` (appends container to `document.body`).
  - `RibbonGroup({ label, collapsed?, icon?, onLauncher?, children })` — renders `<div class="ribbon-group" role="group" aria-label={label}>`; when `collapsed`, renders a single large button that opens the children in a popover.
  - `RibbonButton({ id, label, icon, size: 'large' | 'small', tooltip?: { title: string; body?: string; shortcut?: string }, pressed?, disabled?, onClick })` — owns its tooltip (`data-ribbon-tooltip`), `aria-pressed` when `pressed` is defined.
  - `RibbonMenuButton({ …RibbonButton props, items: { id; label; icon?; onSelect; disabled? }[], split?: boolean })` — split = main action + arrow; menu uses `role="menu"`, closes on Escape/outside click and returns focus.
  - `RibbonGallery({ label, items: { id; label; preview: ReactNode; selected? }[], onSelect })` — dropdown grid (basemaps, tools).
  - `collapseGroups(groupWidths: number[], available: number, collapsedWidth = 56): boolean[]` in `ribbonLayout.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// ribbonLayout.test.ts
it('keeps every group expanded when they fit', () => {
  expect(collapseGroups([200, 150, 120], 600)).toEqual([false, false, false])
})
it('collapses rightmost groups first', () => {
  expect(collapseGroups([200, 150, 120], 420)).toEqual([false, false, true])
  expect(collapseGroups([200, 150, 120], 320)).toEqual([false, true, true])
})
it('never collapses the first group', () => {
  expect(collapseGroups([200, 150], 10)).toEqual([false, true])
})

// ribbonParts.test.ts (happy-dom)
it('renders large and small buttons with their own tooltip', () => {
  const { container } = renderComponent(<RibbonButton id="x" label="Explore" icon={MousePointer2} size="large" tooltip={{ title: 'Explore', shortcut: 'Esc' }} onClick={() => {}} />)
  const button = container.querySelector('button')!
  expect(button.classList.contains('ribbon-button-large')).toBe(true)
  expect(button.dataset.ribbonTooltip).toBe('Explore (Esc)')
})
it('menu button opens with Enter, closes with Escape and returns focus', () => { /* items rendered with role=menuitem; after Escape document.activeElement === trigger */ })
it('split menu button runs the main action without opening the menu', () => { /* click main part → onClick called once, no [role=menu] */ })
```

- [ ] **Step 2: Run tests to verify they fail** — `npx.cmd vitest run src/ribbon/__tests__` → FAIL (modules not found).
- [ ] **Step 3: Implement** `renderComponent`, `collapseGroups` (greedy from the right until the total ≤ available) and the four components. Measure group widths with a `useRibbonCollapse(ref): Record<string, boolean>` hook in `src/ribbon/useRibbonCollapse.ts` (state keyed by each group's `aria-label`; re-measures on toolbar/group resize and when the groups change). Every `RibbonGroup` in a toolbar needs a unique `label`; pass `collapsed={collapsed[label]}`. CSS in `App.css`: large button 64×66 px with 32 px icon over a two-line label; small buttons 22 px rows, 16 px icon, stacked three per column.
- [ ] **Step 4: Run tests to verify they pass.**
- [ ] **Step 5: Commit** — `feat(ribbon): add Pro-style ribbon primitives and group collapse`.

### Task 2: Pro neutral/blue theme tokens and persisted UI settings

**Files:**
- Modify: `src/index.css` (`:root` and `:root[data-theme="light"]` token blocks), `src/App.css` (radius/blur usages), `src/store/slices/workspace.ts`, `src/App.tsx` (theme effect)
- Create: `src/ui/uiSettings.ts`
- Test: `src/__tests__/themeContrast.test.ts`, `src/__tests__/uiSettings.test.ts`

**Interfaces:**
- Produces: `interface UiSettings { theme: 'dark' | 'light'; measureUnits: LengthUnit; coordinateFormat: CoordinateFormat }`; `loadUiSettings(): UiSettings`; `saveUiSettings(settings: UiSettings): void` (localStorage key `arcweb-ui-settings-v1`). `LengthUnit = 'metric' | 'imperial' | 'nautical'`, `CoordinateFormat = 'dd' | 'dms' | 'ddm' | 'utm'` (exported from `uiSettings.ts`; Tasks 23 and 28 consume them). Store gains `measureUnits`, `coordinateFormat`, setters `setMeasureUnits`, `setCoordinateFormat`.
- New CSS tokens: `--accent-text` (accent used as text), `--radius-sm: 2px`, `--radius: 3px`, `--ribbon-height: 94px`, `--tab-height: 26px`, `--font-ui: "Segoe UI", Inter, Arial, sans-serif`, `--font-size-ui: 12px`.

Token values (starting point; adjust lightness only — keep the hue — if the contrast test fails):

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#1e1e1e` | `#f0f0f0` |
| `--panel` | `#2b2b2b` | `#ffffff` |
| `--panel-raised` | `#333333` | `#f8f8f8` |
| `--panel-hover` | `#3d3d3d` | `#e8f1f8` |
| `--line` / `--line-soft` | `#4a4a4a` / `#3a3a3a` | `#d4d4d4` / `#e4e4e4` |
| `--text` / `--text-secondary` / `--muted` | `#f5f5f5` / `#c8c8c8` / `#a8a8a8` | `#1f1f1f` / `#4c4c4c` / `#6b6b6b` |
| `--accent` / `--accent-ink` | `#2a76b5` / `#ffffff` | `#006aa8` / `#ffffff` |
| `--accent-text` | `#6cb8f0` | `#005e95` |

- [ ] **Step 1: Write the failing tests**

```ts
// themeContrast.test.ts (node env): parse index.css custom properties per theme block
const pairs = [['--text', '--bg'], ['--text', '--panel'], ['--text', '--panel-raised'], ['--text-secondary', '--panel'],
  ['--muted', '--panel-raised'], ['--accent-ink', '--accent'], ['--accent-text', '--panel']]
it.each(['dark', 'light'])('%s theme meets 4.5:1 for text pairs', (theme) => {
  for (const [fg, bg] of pairs) expect(contrast(tokens[theme][fg], tokens[theme][bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
})
// uiSettings.test.ts (happy-dom)
it('returns defaults (dark, metric, dd) when storage is empty or corrupt', …)
it('round-trips saved settings and ignores unknown values', …) // theme: 'neon' → 'dark'
```

- [ ] **Step 2: Run to verify failure** (tokens missing `--accent-text`; module missing).
- [ ] **Step 3: Implement.** Replace the token blocks; replace `color: var(--accent)` (95 uses in `App.css`) with `color: var(--accent-text)`; drop `backdrop-filter` from core panels (keep on menus/popovers); set `font-family: var(--font-ui)` and `font-size: var(--font-size-ui)` on `.arc-app`. Store initialises `theme`, `measureUnits`, `coordinateFormat` from `loadUiSettings()`; a store subscription in `App.tsx` saves on change.
- [ ] **Step 4: Run tests, then open the app in both themes and check the ribbon, Contents, table and dialogs for unreadable text.**
- [ ] **Step 5: Commit** — `feat(theme): Pro neutral/blue tokens with persisted UI settings`.

---

## Phase B — Project Backstage & Title Bar

### Task 3: Project backstage

**Files:**
- Create: `src/project/Backstage.tsx`, `src/storage/ProjectLibraryContent.tsx`
- Modify: `src/storage/ProjectLibraryDialog.tsx` (becomes a thin wrapper around `ProjectLibraryContent`), `src/App.tsx` (blue "Project" tab before the ribbon tabs; render Backstage)
- Test: `src/__tests__/backstage.test.ts`

**Interfaces:**
- Consumes: `useProjectIO` return (`library`, `captureWorkspace`, `saveProject`, `loadProjectFile`, `startNewWorkspace`, `selectOfflineBasemap`, `getOfflineAreaBounds`), `UiSettings` (Task 2).
- Produces: `type BackstageSection = 'new' | 'open' | 'save-as' | 'library' | 'options' | 'about'`; `Backstage({ section, onSection, onClose, onNewBlank, onOpenFile, onSaveFile, onSaveCopy, library: ProjectLibraryContentProps, settings, onSettings })`. `ProjectLibraryContent(props: Omit<ProjectLibraryDialogProps, 'onClose'>)`.

Sections: **New** → "Blank map" (`startNewWorkspace`, the current one stays in Projects). **Open** → library project list + "Browse for a project file…" (`.arcweb.json`). **Save As** → "Download project file" (`saveProject`) and "Save a copy in Projects" (`library.create(captureWorkspace(), true)`). **Projects & offline** → `ProjectLibraryContent` (recovery, backups, offline basemaps). **Options** → Theme (Light/Dark), measure units, coordinate format. **About** → name, version (`version` from `package.json`), open-source libraries list.

- [ ] **Step 1: Write the failing tests**

```ts
it('opens on the requested section and lists the left navigation in Pro order', …) // ['New','Open','Save As','Projects & offline','Options','About']
it('Escape closes Backstage without reaching the window', () => { /* window keydown spy not called; onClose called once */ })
it('returns focus to the Project tab when closed', …)
it('renders the project name inside bdi', …) // name 'مشروع غزة'
it('Options changes theme through onSettings', …) // click Light → onSettings({ ...settings, theme: 'light' })
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Backstage is a full-window `role="dialog" aria-modal="true"` with a blue left rail and a back arrow; it stops propagation of handled keys. Remove the header "Projects / Open Project" buttons and the `ProjectLibraryDialog` launch from the header once Backstage covers them; "Clear session" becomes **New → Blank map**.
- [ ] **Step 4: Run tests; manually: open, save as file, save a copy, switch theme.**
- [ ] **Step 5: Commit** — `feat(project): add Project backstage replacing header project buttons`.

### Task 4: Title bar with Quick Access Toolbar and global shortcuts

**Files:**
- Create: `src/shell/TitleBar.tsx`, `src/shell/useAppShortcuts.ts`
- Modify: `src/App.tsx` (replace `<header className="app-header">`), `src/App.css`
- Test: `src/__tests__/titleBar.test.ts`, `src/__tests__/useAppShortcuts.test.ts`

**Interfaces:**
- Produces: `TitleBar({ projectName, onRename, saveState, saveError, quickAccess: { onSave; onUndo; onRedo; onOpen; canUndo; canRedo }, children? })` — `children` is the right-hand slot (Task 29 command search, Task 30 notifications). `useAppShortcuts(handlers: { save(): void; open(): void; commandSearch?(): void })` — `Ctrl/⌘+S`, `Ctrl/⌘+O`, `Alt+Q`; ignores events already `defaultPrevented`.
- QAT Save = `library.flush()` then `notify('Project saved on this device.')`.

- [ ] **Step 1: Failing tests** — `QAT buttons call their handlers and disable Undo/Redo by state`; `Ctrl+S calls save and prevents the browser dialog`; `shortcuts are ignored while typing in an input except Ctrl+S`; `empty project name falls back to "Untitled map" on blur`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Layout: app glyph + QAT (Save, Undo, Redo, Open) left; centred `‹project name› — ArcWeb`; save-state badge right. Remove the "AW" avatar, the header workspace select and the header Full-canvas/theme buttons (they live in View tab / Options already).
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit** — `feat(shell): title bar with Quick Access Toolbar and shortcuts`.

---

## Phase C — Ribbon (core tabs)

### Task 5: Map tab in Pro groups

**Files:**
- Modify: `src/ribbon/CoreRibbons.tsx` (`MapRibbon`), `src/App.tsx`
- Test: `src/ribbon/__tests__/mapRibbon.test.ts`

**Interfaces:**
- Consumes: Task 1 primitives.
- Produces: `MapRibbon` props add `canGoBack`, `canGoForward`, `onBack`, `onForward` (Task 6), `onGoToXY` (Task 7), `onSelectTool(mode: 'select-box')` (Task 8). Until those tasks land, pass `false`/no-ops.

Groups (left → right), Pro's Map tab without Clipboard, Labeling and Offline:
1. **Navigate** — Explore (large), Full Extent / Fixed Zoom In / Fixed Zoom Out / Previous / Next (small), Bookmarks (large menu: saved list + "New Bookmark…" + "Manage Bookmarks").
2. **Layer** — Basemap (large gallery, replaces inline thumbnails), Add Data (large split: "Data…" / "Project file…").
3. **Selection** — Select (large split: Rectangle), Select By Attributes, Select By Location (large), Clear, Zoom To (small); caption shows selected count.
4. **Inquiry** — Measure (large split: Distance / Area / Feature), Go To XY (small), Locate is out of scope.
5. **View** — Properties (Map properties/coordinate systems).

- [ ] **Step 1: Failing tests** — `renders the five groups in order`; `Basemap gallery marks the active basemap and selects another`; `Measure split runs Distance by default and lists Area and Feature`; `Selection caption shows "1,234 selected"`.
- [ ] **Step 2–4:** run → implement → run.
- [ ] **Step 5: Commit** — `feat(ribbon): Map tab in Pro groups`.

### Task 6: Previous / Next extent

**Files:** Create `src/map/extentHistory.ts`; Modify `src/App.tsx` (subscribe on `moveend`, wire Map ribbon); Test `src/map/__tests__/extentHistory.test.ts`

**Interfaces:**
- Produces: `class ExtentHistory { constructor(limit = 50); record(extent: Extent): void; back(): Extent | null; forward(): Extent | null; get canBack(): boolean; get canForward(): boolean }`, `type Extent = { center: [number, number]; zoom: number; bearing: number; pitch: number }`. Navigation via back/forward sets an internal flag so the resulting `moveend` is not recorded.

- [ ] **Step 1: Failing tests** — `records extents and steps back and forward`; `recording after going back drops the forward stack`; `ignores the moveend caused by its own navigation`; `keeps at most 50 entries`; `does not record an extent equal to the current one`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(map): previous and next extent`.

### Task 7: Go To XY

**Files:** Create `src/map/coordinateInput.ts`, `src/map/GoToXY.tsx`; Modify `src/App.tsx`; Test `src/map/__tests__/coordinateInput.test.ts`

**Interfaces:**
- Produces: `parseAngle(input: string, axis: 'lat' | 'lon'): number | null` (DD, DMS `31°30'00"N`, space-separated `34 27 0 E`, signed decimals; hemisphere letters override sign; out-of-range → `null`). `GoToXY({ onGo(lngLat: [number, number], action: 'pan' | 'flash' | 'marker'): void; onClose })` — Longitude and Latitude fields.

- [ ] **Step 1: Failing tests**

```ts
expect(parseAngle('31.5', 'lat')).toBe(31.5)
expect(parseAngle(`31°30'00"N`, 'lat')).toBeCloseTo(31.5)
expect(parseAngle('34 27 0 E', 'lon')).toBeCloseTo(34.45)
expect(parseAngle('12.5 S', 'lat')).toBe(-12.5)
expect(parseAngle('95', 'lat')).toBeNull()
expect(parseAngle('abc', 'lon')).toBeNull()
```

- [ ] **Steps 2–5:** run → implement (marker action reuses `addQuickMarker`) → run → commit `feat(map): Go To XY`.

### Task 8: Rectangle selection tool

**Files:** Create `src/map/boxSelect.ts`; Modify `src/store/types.ts` (`ToolMode` adds `'select-box'`), `src/map/useMapInstance.ts` (box drag events through `mapEventsRef`: add `onBox?(bounds: [number, number, number, number], modifier: 'new' | 'add' | 'remove')`), `src/App.tsx`; Test `src/map/__tests__/boxSelect.test.ts`

**Interfaces:**
- Produces: `featuresInBox(layers: MapLayer[], bbox: [number, number, number, number]): Record<string, FeatureId[]>` — only visible, selectable (Task 20 adds the flag; until then all) layers; bbox prefilter on feature extents before `booleanIntersects`.
- Selection applied with existing `applySelection(layerId, ids, method)` — Shift adds (`'add'`), Ctrl removes (`'remove'`), plain = `'new'`.

- [ ] **Step 1: Failing tests** — `includes points inside and polygons that partly overlap`; `excludes lines outside the box`; `skips hidden layers`; `uses bbox prefilter` (spy on `booleanIntersects` — not called for a feature whose extent is disjoint).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement; while `tool === 'select-box'`, disable `dragPan`, draw a rectangle overlay div during drag. **Step 4:** run. **Step 5:** commit `feat(map): rectangle selection tool`.

### Task 9: Insert, Analysis and Share tabs in Pro groups

**Files:** Modify `src/ribbon/CoreRibbons.tsx`, `src/toolboxes/ToolboxPanel.tsx` (prop `initialToolId?: string` opens that tool's form), `src/App.tsx`; Test `src/ribbon/__tests__/coreTabs.test.ts`

Groups:
- **Insert** — Project: New Layout (large menu of `src/layout/templates.ts` templates; switches to layout view), New Layer (large: opens Create Layer form from the Edit pane) · Layer: Add Data (large).
- **Analysis** — Geoprocessing: Tools (large, opens Geoprocessing pane), History (opens pane on history) · Tools gallery: Buffer, Clip, Intersect, Union, Dissolve, Spatial Join (ids looked up in `toolboxTools`; a missing id is skipped, never rendered disabled) — selecting opens the pane with `initialToolId`.
- **Share** — Output: Export Map (PNG), Export Layout (menu PNG/PDF), Export Layer (menu GeoJSON/CSV) · Project: Download Project File, Back Up Projects (opens Backstage → Projects & offline).

- [ ] **Step 1: Failing tests** — `Analysis gallery opens the geoprocessing pane on the chosen tool`; `gallery skips tool ids missing from the registry`; `Insert New Layout lists every template`; `Share export menus call the right exporter`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(ribbon): Insert, Analysis and Share tabs in Pro groups`.

### Task 10: Edit tab and snapping control

**Files:** Modify `src/ribbon/CoreRibbons.tsx` (`EditRibbon`), `src/store/slices/workspace.ts` (`snapping: { enabled: boolean; tolerancePx: number }`, default `{ enabled: true, tolerancePx: 10 }`, `setSnapping`), `src/mapGeometry.ts` (`snapCoordinate(map, event, layers, exclude?, tolerancePx = 10)`), `src/map/useMapClick.ts`; Test `src/__tests__/useMapClick.test.ts` (extend), `src/ribbon/__tests__/editRibbon.test.ts`

Groups: **Manage Edits** (Save, Discard, Undo, Redo — moved from the Edit Tools contextual tab, which is removed in Task 11) · **Snapping** (toggle large + tolerance menu 5/10/15/20 px) · **Features** (Create → Create Features pane, Modify → Modify Features pane, Delete) · **Selection** (Select, Clear) · **Tools** (Move Vertex, Attributes pane).

- [ ] **Step 1: Failing tests** — `useMapClick > does not snap when snapping is off` (mocked `snapCoordinate` not called; raw lngLat used); `passes the tolerance to snapCoordinate`; `Edit ribbon disables Save/Discard without pending edits`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(edit): Pro Edit tab with snapping control`.

---

## Phase D — Contextual Tab Groups

### Task 11: Contextual groups model (multi-tab groups, Layout as contextual)

**Files:** Modify `src/store/types.ts`, `src/ribbon/contextualTabs.ts`, `src/App.tsx` (tab strip renders one coloured group header spanning its tabs); Test `src/ribbon/__tests__/contextualTabs.test.ts` (rewrite expectations)

**Interfaces:**
- Produces: `CoreTab = 'Map' | 'Insert' | 'Analysis' | 'View' | 'Edit' | 'Share'` (Task 30 adds `'Help'`); `migrateTabId(id: string): AppTab`; `ContextualTab = 'FeatureAppearance' | 'FeatureLabeling' | 'FeatureData' | 'RasterAppearance' | 'RasterData' | 'LayoutInsert' | 'LayoutExport'`; `CONTEXTUAL_GROUPS: { id: 'feature' | 'raster' | 'layout'; label: 'Feature Layer' | 'Raster Layer' | 'Layout'; tabs: ContextualTab[] }[]`; `getVisibleContextualTabs({ selectedLayer, viewMode })` (no longer takes `tool`/`pendingEdits`; Edit Tools moved to the Edit tab in Task 10). `reconcileRibbonTabs` keeps its signature; a newly visible group activates its **first** tab under the existing neutral-tab rule.
- `migrateTabId`: `'FeatureLayer'` maps to `'FeatureAppearance'`, `'RasterLayer'` to `'RasterAppearance'`, `'EditSession'` and `'Layout'` to `'Edit'`/`'Map'` (layout view re-shows the Layout group).

- [ ] **Step 1: Failing tests** — `feature layer shows Appearance, Labeling and Data under one group and activates Appearance from Map`; `switching from a feature to a raster layer swaps the group and keeps the same tab kind when available` (FeatureData → RasterData); `layout view shows the Layout group; leaving it returns to the previous tab`; `a newly visible group does not steal focus from Analysis`; `legacy tab ids map to their replacements`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(ribbon): Pro contextual tab groups`.

### Task 12: Feature Layer tabs — Appearance, Labeling, Data (+ visibility range)

**Files:** Create `src/ribbon/LayerRibbons.tsx` (replaces `FeatureLayerRibbon`/`RasterLayerRibbon` in `ContextualRibbons.tsx`); Modify `src/store/types.ts` (`MapLayer.minScale?: number; maxScale?: number` — scale denominators, `undefined` = no limit), `src/project.ts` (`parseLayer` clamps to 1…1e9, drops `minScale <= maxScale` contradictions), `src/crs.ts` (`zoomForScale(latitude: number, scale: number): number` — inverse of `scaleDenominator`), `src/mapRendering.ts` (layer `minzoom`/`maxzoom` from scales at the map centre latitude via `zoomForScale`, recomputed on `moveend` when latitude changes > 5°); Test `src/ribbon/__tests__/layerRibbons.test.ts`, `src/__tests__/projectPersistence.test.ts` (extend), `src/__tests__/crs.test.ts`

Tabs:
- **Appearance** — Visibility Range (Out Beyond / In Beyond scale menus 1:1,000…1:50,000,000 + "Current"), Effects (Transparency slider → `opacity`), Drawing (Symbology menu: Single / Unique Values / Graduated Colors → opens Symbology pane on that renderer), Extrusion (existing 3D settings).
- **Labeling** — Layer (Label toggle), Label Class (Field menu, Expression… opens Symbology pane label section), Text Symbol (size, colour, halo colour/width), Placement (point/line, offset).
- **Data** — Table (Attribute Table), Selection (Select By Attributes, Zoom To Selection, Clear), Export (Export Features GeoJSON/CSV), Calculate (Calculate Field → opens table calculator).

- [ ] **Step 1: Failing tests** — `persists and round-trips minScale/maxScale`; `drops contradictory ranges on load`; `zoomForScale inverts scaleDenominator: scaleDenominator(31.5, zoomForScale(31.5, 50000)) ≈ 50000 (±1)`; `Labeling tab toggles labelStyle.enabled`; `Appearance transparency 30% sets opacity 0.7`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(ribbon): Feature Layer Appearance, Labeling and Data tabs`.

### Task 13: Raster Layer and Layout contextual tabs

**Files:** Create `src/ribbon/LayoutRibbon.tsx` (moves Layout content out of `CoreRibbons.tsx`); Modify `src/ribbon/LayerRibbons.tsx` (Raster Appearance = existing raster controls; Raster Data = Table, Export), `src/App.tsx`; Test `src/ribbon/__tests__/layoutRibbon.test.ts`

- **Layout › Insert** — Map Frame/Legend/North Arrow/Scale Bar/Text/Picture from `insertableElements`, Page Setup (paper/orientation menu).
- **Layout › Export** — Export Layout PNG/PDF (DPI menu 150/200/300), Close Layout (returns to map view).

- [ ] **Step 1: Failing tests** — `Layout Insert lists every insertable element`; `Export menu passes the chosen DPI`; `Close Layout switches to map view`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(ribbon): Raster and Layout contextual tabs`.

---

## Phase E — Panes

### Task 14: Pane layout model with legacy migration

**Files:** Create `src/panes/paneLayout.ts`; Modify `src/workspaceLayout.ts` (presets produce pane layouts), `src/store/slices/workspace.ts`; Test `src/panes/__tests__/paneLayout.test.ts`

**Interfaces:**
- Produces:
  - `type PaneId = 'contents' | 'catalog' | 'geoprocessing' | 'symbology' | 'createFeatures' | 'modifyFeatures' | 'attributes'`
  - `type DockSide = 'left' | 'right' | 'float'`
  - `interface PaneState { open: boolean; side: DockSide; autoHide: boolean; frame: PanelFrame; order: number }`
  - `interface PaneLayout { panes: Record<PaneId, PaneState>; active: { left: PaneId | null; right: PaneId | null }; dockWidth: { left: number; right: number } }`
  - Pure functions: `openPane(layout, id, options?: { side?: DockSide }): PaneLayout` (opens and activates), `closePane(layout, id)` (activates the next open pane on that side by `order`), `activatePane`, `movePane(layout, id, side)`, `toggleAutoHide(layout, id)`, `normalizePaneLayout(value: unknown): PaneLayout`, `migrateWorkspaceLayout(old: WorkspaceLayoutConfig): PaneLayout`, `applyPanePreset(layout, preset: WorkspacePreset): PaneLayout`.
- Defaults: left = Contents (open); right = Symbology, Geoprocessing, Catalog (Catalog open, active); edit panes closed.
- Persistence: `arcweb-workspace-layout-v2`; v1 is read once through `migrateWorkspaceLayout` and never deleted (`CLAUDE.md` §9 spirit).

- [ ] **Step 1: Failing tests** — `opens a pane on its default side and activates it`; `closing the active pane activates the next by order`; `moving a pane to float keeps its frame`; `migrates a legacy workspace layout` (contentsMinimized → contents autoHide; rightPaneOpen false → right side with no active pane; floating geoprocessing → side 'float' with the saved frame); `normalizes garbage to defaults`; `analysis preset opens Geoprocessing on the right and auto-hides Contents`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(panes): pane layout model with v1 migration`.

### Task 15: Dock areas, pane chrome and View › Windows group

**Files:** Create `src/panes/DockArea.tsx`; Modify `src/App.tsx` (left/right `DockArea`s replace the Contents aside and the `activeTab`-switched right pane; remove `rightPaneOpen` rail), `src/ribbon/ViewRibbon.tsx` (Windows group: Contents, Catalog, Geoprocessing, Symbology, Attribute Table; Reset Panes menu with the three presets; Full Canvas; theme buttons removed), `src/App.css`; Test `src/panes/__tests__/dockArea.test.ts`

**Interfaces:**
- Produces: `DockArea({ side, layout, panes: Partial<Record<PaneId, { title: string; render(): ReactNode }>>, onChange(layout: PaneLayout): void })` — Pro chrome: pane title bar with Auto Hide (pin), Options menu (Dock left/right, Float) and Close; pane tabs at the **bottom** of the dock when ≥ 2 panes share it; auto-hidden panes collapse to a vertical tab on the window edge that slides out on hover/focus.
- Ribbon commands now call `openPane(...)`: Analysis › Tools → `geoprocessing`, Appearance › Symbology → `symbology`, Edit › Create → `createFeatures`.

- [ ] **Step 1: Failing tests** — `shows pane tabs at the bottom when two panes share a side`; `Close removes the pane and activates its neighbour`; `Auto Hide collapses to an edge tab that opens on focus`; `switching ribbon tabs leaves the right pane unchanged` (render the right `DockArea` with Symbology active, set the store's `activeTab` to `'Analysis'`, assert Symbology is still the rendered pane); `Escape inside a pane does not close it`.
- [ ] **Step 2–4:** run → implement → run; manually test each preset and floating a pane.
- [ ] **Step 5: Commit** — `feat(panes): dockable pane areas independent of ribbon tabs`.

### Task 16: Catalog pane

**Files:** Create `src/panes/CatalogPane.tsx`; Modify `src/App.tsx`; Test `src/panes/__tests__/catalogPane.test.ts`

Tree (Pro "Project" view): **Maps** (current map → activates Map view), **Layouts** (current layout → layout view), **Toolboxes** (categories from `buildToolboxTree()`; a tool opens Geoprocessing with `initialToolId`), **Project files** (imported source assets via `assetInfo(id)` for each `captureWorkspace().assetIds`; "Add To Current Map" re-imports through `getAsset(id)` → `addFiles([new File([blob], name)])`), **Offline basemaps** (current offline basemap; "Manage…" → Backstage). Search box filters all nodes.

- [ ] **Step 1: Failing tests** — `lists toolbox categories and opens a tool`; `search filters across sections`; `Add To Current Map re-imports the stored asset with its original name`; `missing asset shows "Source file is no longer stored" and disables Add`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(panes): Catalog pane`.

### Task 17: Create Features, Modify Features and Attributes panes

**Files:** Create `src/panes/CreateFeaturesPane.tsx`, `src/panes/ModifyFeaturesPane.tsx`, `src/panes/AttributesPane.tsx`; Modify `src/PhasePanels.tsx` (delete `EditPanel`; its "create layer" form moves into Create Features), `src/App.tsx`; Test `src/panes/__tests__/editPanes.test.ts`

- **Create Features** — one template per editable layer (symbol patch + name + geometry); choosing a template selects the layer and shows its construction tools (Point; Line; Polygon — Task 25 adds Rectangle and Circle) → `setEditingTool`. Footer: "New Layer…" form (name, geometry, fields) → `createEditableLayer`.
- **Modify Features** — Move Vertex, Delete, Attributes (opens Attributes pane).
- **Attributes** — selected feature's fields as an editable grid (`editCell`); navigator when several features are selected; read-only for raster layers.

- [ ] **Step 1: Failing tests** — `lists only editable layers as templates` (raster and `editable: false` excluded once Task 20 lands; until then raster only); `polygon template offers the Polygon construction tool`; `Attributes pane edits a value through editCell`; `Attributes pane steps through a multi-feature selection`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(panes): Create Features, Modify Features and Attributes panes`.

---

## Phase F — Views

### Task 18: View tabs (Map, Scene, Layout)

**Files:** Create `src/views/viewState.ts`, `src/views/ViewTabs.tsx`; Modify `src/App.tsx` (remove the `.view-switch` overlay; tab strip above the canvas), `src/store/slices/workspace.ts`; Test `src/views/__tests__/viewState.test.ts`

**Interfaces:**
- Produces: `type ViewRef = { kind: 'map' } | { kind: 'scene' } | { kind: 'layout' }`; store `openViews: ViewRef[]` (default `[{ kind: 'map' }]`), `activeView: ViewRef['kind']`; pure `openView(views, kind)`, `closeView(views, kind): { views; next: ViewRef['kind'] }` (the Map view cannot close). `activeView` drives the existing `showView('2d' | '3d' | 'layout')`.
- Insert › New Layout and View › Convert to Scene (`View` group: "Map ↔ Scene") open views.

- [ ] **Step 1: Failing tests** — `opening a view adds one tab and activates it`; `closing the active view activates its left neighbour`; `the Map view has no close button`; `keyboard: Ctrl+Tab cycles views`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(views): document-style view tabs`.

### Task 19: Tabbed attribute tables

**Files:** Create `src/views/TableDock.tsx`; Modify `src/App.tsx` (bottom dock hosts one tab per open table), `src/store/slices/workspace.ts` (`openTables: string[]`, `activeTable: string | null`; `tableOpen` becomes derived), `src/contextMenu/menuModel.ts`; Test `src/views/__tests__/tableDock.test.ts`

- [ ] **Step 1: Failing tests** — `opening a second layer's table adds a tab without closing the first`; `removing a layer closes its table tab`; `closing the last tab hides the dock`; `table views (sort/filter) are kept per layer when switching tabs`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(views): tabbed attribute tables`.

---

## Phase G — Contents

### Task 20: Layer selectable / editable / snappable flags and source

**Files:** Modify `src/store/types.ts` (`MapLayer.selectable?`, `editable?`, `snappable?` — default `true`; `source?: { kind: 'file' | 'tool' | 'sketch' | 'project'; name: string }`), `src/project.ts`, `src/useFileImport.ts` (`source: { kind: 'file', name: file.name }`), tool output creation in `App.tsx` `executeTool` (`kind: 'tool'`, tool name), `src/editing/useFeatureEdits.ts` `createEditableLayer` (`kind: 'sketch'`), `src/map/useMapClick.ts` (identify only selectable layers; snap only snappable; editing tools refuse non-editable with a warning), `src/map/boxSelect.ts`; Test `src/__tests__/useMapClick.test.ts`, `src/__tests__/projectPersistence.test.ts`, `src/map/__tests__/boxSelect.test.ts`

- [ ] **Step 1: Failing tests** — `identify ignores non-selectable layers` (assert layers passed to mocked `queryFeaturesAt`); `snapping ignores non-snappable layers`; `drawing into a non-editable layer warns "<name> is not editable."`; `flags and source round-trip through a saved project; missing flags load as true`; `box select skips non-selectable layers`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(contents): layer selectable/editable/snappable flags and source`.

### Task 21: Contents "List By" modes and symbol patches

**Files:** Create `src/contents/contentsModes.ts`, `src/contents/SymbolPatch.tsx`; Modify `src/contents/ContentsPanel.tsx` (toolbar row of mode buttons, search filter kept; replaces `LayerIcon` with `SymbolPatch`), `src/contents/ContentsLegend.tsx`; Test `src/contents/__tests__/contentsModes.test.ts`, `src/contents/__tests__/symbolPatch.test.ts`

**Interfaces:**
- Produces: `type ContentsMode = 'drawingOrder' | 'dataSource' | 'selection' | 'editing' | 'snapping' | 'labeling'`; `contentsSections(mode, layers, ctx: { selections: Record<string, FeatureId[]>; editSnapshots: Record<string, unknown> }): { id: string; title: string; rows: { layer: MapLayer; detail?: string; toggle?: { kind: 'selectable' | 'editable' | 'snappable' | 'labels'; checked: boolean } }[] }[]`.
  - dataSource → sections by `source.kind` ("Imported files", "Analysis outputs", "Created in ArcWeb", "From project"), row detail = source name + `sourceCrs`.
  - selection → "Selectable" / "Not selectable", detail "n selected" from `selections[layer.id].length`.
  - editing → "Editable" / "Not editable", detail "Unsaved edits" when snapshot differs.
  - snapping → snappable toggle; labeling → labels toggle + label field.
- `SymbolPatch({ layer, size = 16 })` — SVG: point = layer `pointShape` filled `fillColor` stroked `strokeColor`; line = stroke with `strokeDash`; polygon = square fill + outline; uses the first class colour for unique/graduated renderers.

- [ ] **Step 1: Failing tests** — `drawing order keeps layer order`; `data source groups by origin`; `counts selection from selection sets only` (layer with 100k features: `contentsSections` runs without touching `data.features` — wrap features in a Proxy that throws on access); `editing marks layers with unsaved edits`; `isolates RTL layer names in section rows`; `SymbolPatch draws a dashed line for strokeDash "dashed"`; `SymbolPatch uses the layer's point shape`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(contents): List By modes and symbol patches`.

### Task 22: Drag reorder, Pro layer context menu and Layer Properties

**Files:** Create `src/contents/LayerPropertiesDialog.tsx`; Modify `src/contents/ContentsPanel.tsx` (HTML5 drag-and-drop in Drawing Order; `Alt+↑/↓` keyboard reorder; inline per-row action buttons removed except visibility), `src/contextMenu/menuModel.ts` (`buildLayerMenu` → Pro order: Zoom To Layer, Zoom To Make Visible, Attribute Table, Selection ▸ (Select All, Clear, Zoom To), Label, Labeling Properties…, Symbology…, Data ▸ (Export Features GeoJSON/CSV), Move Up/Down, Remove, Properties…), `src/store/slices/layers.ts` (`moveLayerTo(id, index)`); Test `src/contents/__tests__/layerReorder.test.ts`, `src/contextMenu/__tests__/menuModel.test.ts` (extend), `src/contents/__tests__/layerProperties.test.ts`

- Layer Properties tabs: **General** (name), **Source** (origin, CRS, feature count, geometry), **Display** (transparency, visibility range — Task 12 fields, selectable/editable/snappable — Task 20 flags), **Fields** (aliases → `fieldAliases`).
- Zoom To Make Visible: zooms to the nearest zoom inside the visibility range.

- [ ] **Step 1: Failing tests** — `moveLayerTo moves a layer to an index and keeps others in order`; `Alt+ArrowUp moves the focused layer up`; `menu lists items in Pro order and disables Zoom To Make Visible without a range`; `Properties renames a layer and edits a field alias`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(contents): drag reorder, Pro layer menu and Layer Properties`.

---

## Phase H — Measure & Sketch

### Task 23: Measurement math

**Files:** Create `src/measure/measure.ts`; Test `src/measure/__tests__/measure.test.ts`

**Interfaces:**
- Consumes: `LengthUnit` (Task 2).
- Produces: `measureDistance(points: [number, number][], units: LengthUnit): { segments: number[]; total: number; unitLabel: string }` (geodesic via `@turf/length`); `measureArea(points, units): { area: number; perimeter: number; areaLabel: string; lengthLabel: string }` (`@turf/area`); `measureFeature(feature: Feature, units)` → length for lines, area+perimeter for polygons, coordinates for points; `formatMeasure(value: number, label: string): string`. Units: metric → m/km (≥ 1000 m) and m²/km² (≥ 1e6); imperial → ft/mi (≥ 5280 ft) and ft²/mi²; nautical → NM and NM².

- [ ] **Step 1: Failing tests**

```ts
const { total, segments } = measureDistance([[0, 0], [1, 0], [1, 1]], 'metric')
expect(segments).toHaveLength(2)
expect(segments[0]).toBeCloseTo(111.195, 2) // km, turf R = 6,371,008.8 m
expect(measureDistance([[0, 0], [1, 0]], 'imperial').total).toBeCloseTo(69.093, 2) // mi
const square = measureArea([[0, 0], [1, 0], [1, 1], [0, 1]], 'metric')
expect(square.area / 12391).toBeCloseTo(1, 2) // km², @turf/area R = 6,378,137 m, within 0.5%
expect(measureArea([[0, 0], [1, 0]], 'metric').area).toBe(0)
expect(formatMeasure(1234.5678, 'km')).toBe('1,234.57 km')
```

- [ ] **Steps 2–5:** run → implement → run → commit `feat(measure): geodesic measurement with units`.

### Task 24: Measure window (Distance, Area, Feature)

**Files:** Create `src/measure/MeasureWindow.tsx`; Modify `src/store/types.ts` (`ToolMode` adds `'measure-feature'`), `src/map/useMapClick.ts` (measure-feature click → `onMeasureFeature(hit)` option), `src/MapOverlays.tsx` (remove `MeasurementCard`), `src/App.tsx`; Test `src/measure/__tests__/measureWindow.test.ts`, `src/__tests__/useMapClick.test.ts` (extend)

- Pro-style floating window (draggable, top-right of the map): mode buttons Distance / Area / Feature, units select (bound to `measureUnits`), segment list + total (distance), area + perimeter (area), feature result; Clear; close (= tool back to Explore).

- [ ] **Step 1: Failing tests** — `lists each segment and the total`; `changing units re-renders results without new clicks`; `Feature mode shows the clicked polygon's area and perimeter`; `useMapClick > measure-feature routes the first hit to onMeasureFeature`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(measure): Pro-style measure window`.

### Task 25: Construction tools, undo vertex and sketch keys

**Files:** Create `src/editing/constructionTools.ts`; Modify `src/store/types.ts` (`ToolMode` adds `'draw-rectangle' | 'draw-circle'`), `src/ribbon/contextualTabs.ts` (`EDITING_TOOLS` includes them), `src/editing/useSketchTools.ts` (`undoLastVertex()`, auto-finish after 2 clicks for rectangle/circle, `F2` finish, `Escape` cancel, `Ctrl+Z` removes the last vertex while sketching before falling back to edit undo), `src/map/useMapClick.ts` (rectangle/circle require Polygon/Mixed/Unknown layers); Test `src/editing/__tests__/constructionTools.test.ts`, `src/__tests__/useSketchTools.test.ts` (extend); Modify `src/panes/CreateFeaturesPane.tsx`

**Interfaces:**
- Produces: `rectangleFromCorners(a: [number, number], b: [number, number]): Polygon` (axis-aligned, closed ring, counter-clockwise), `circleFromPoints(center, edge, steps = 64): Polygon` (`@turf/circle`, geodesic radius = distance center→edge), `undoLastVertex(): void` on `useSketchTools`.

- [ ] **Step 1: Failing tests** — `rectangle ring has 5 positions and is closed`; `circle radius equals the clicked distance (±0.5%)`; `degenerate rectangle (same corner twice) returns null and warns`; `F2 finishes a line`; `Escape cancels the sketch`; `ignores Escape already handled by an overlay` (dispatch a keydown with `defaultPrevented` → sketch kept); `Ctrl+Z during a sketch removes the last vertex, not an edit`; `Create Features polygon template now offers Polygon, Rectangle and Circle` (extend `src/panes/__tests__/editPanes.test.ts`); callback identity test extended with `undoLastVertex`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(edit): rectangle and circle construction tools with sketch keys`.

### Task 26: Sketch toolbar

**Files:** Create `src/editing/SketchToolbar.tsx`; Modify `src/MapOverlays.tsx` (remove `SketchCard`), `src/App.tsx`; Test `src/editing/__tests__/sketchToolbar.test.ts`

- Pro-style floating toolbar centred at the bottom of the map while sketching: Finish (F2), Undo Vertex, Delete Sketch (Esc), vertex count, current construction tool name.

- [ ] **Step 1: Failing tests** — `buttons call finish/undo/cancel`; `Finish is disabled below the minimum vertex count for the tool` (line 2, polygon 3); `announces the vertex count politely (aria-live)`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(edit): floating sketch toolbar`.

---

## Phase I — Icons

### Task 27: Command icon registry with Pro colour roles

**Files:** Create `src/ui/commandIcons.tsx`; Modify every ribbon/QAT/pane file that passes Lucide icons directly, `src/index.css` (icon tokens); Test `src/ui/__tests__/commandIcons.test.ts`

**Interfaces:**
- Produces: `type IconRole = 'neutral' | 'navigate' | 'select' | 'add' | 'edit' | 'remove' | 'analysis' | 'output'`; `COMMAND_ICONS: Record<string, { icon: LucideIcon; role: IconRole }>` keyed by the `RibbonButton` `id`s; `CommandIcon({ id, size: 16 | 32 })`. Tokens per theme: `--icon-navigate` (blue), `--icon-select` (cyan), `--icon-add` (green), `--icon-edit` (amber), `--icon-remove` (red), `--icon-analysis` (purple), `--icon-output` (teal) — each ≥ 3:1 against `--panel` (non-text contrast).
- Large buttons render 32 px icons, small 16 px (Pro sizes). No Esri artwork.

- [ ] **Step 1: Failing tests** — `every RibbonButton id used in src/ribbon has a registry entry` (static scan of `id="…"` in `src/ribbon/*.tsx`); `icon role tokens meet 3:1 against --panel in both themes`; `CommandIcon renders 32px for large`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(icons): command icon registry with Pro colour roles`.

---

## Phase J — Pro Extras

### Task 28: Pro status bar — editable scale, coordinate format, selection count, snapping

**Files:** Create `src/shell/ScaleBox.tsx`, `src/coordinateFormat.ts`; Modify `src/StatusBar.tsx`, `src/App.tsx` (remove `.app-footer` "CLIENT-SIDE GIS" footer; feature count moves into the status bar), `src/App.css`; Test `src/__tests__/coordinateFormat.test.ts`, `src/__tests__/scaleBox.test.ts`

**Interfaces:**
- Consumes: `zoomForScale` (Task 12), `CoordinateFormat` (Task 2).
- Produces: `formatCoordinate(lng: number, lat: number, format: CoordinateFormat): string`; `ScaleBox({ scale: number; onScale(scale: number): void })` — combobox with 1:1,000 · 1:5,000 · 1:10,000 · 1:24,000 · 1:50,000 · 1:100,000 · 1:250,000 · 1:500,000 · 1:1,000,000 · 1:10,000,000 and free entry (`1:12500`, `12,500`, `12500`).
- Status bar (left → right): ScaleBox · coordinate readout in the chosen format (format menu) · selected features count · snapping toggle · CRS button.

- [ ] **Step 1: Failing tests**

```ts
expect(formatCoordinate(35.2043, 31.9038, 'dd')).toBe('31.90380° N  35.20430° E')
expect(formatCoordinate(35.2043, 31.9038, 'dms')).toBe(`31°54'13.7" N  35°12'15.5" E`)
expect(formatCoordinate(35.2043, 31.9038, 'ddm')).toBe(`31°54.228' N  35°12.258' E`)
expect(formatCoordinate(35.2043, 31.9038, 'utm')).toMatch(/^36N \d{6} E \d{7} N$/)
// ScaleBox: typing "1:12500" + Enter calls onScale(12500); "abc" restores the previous value
```

- [ ] **Steps 2–5:** run → implement → run → commit `feat(shell): Pro status bar with editable scale and coordinate formats`.

### Task 29: Command search (Alt+Q)

**Files:** Create `src/shell/commands.ts`, `src/shell/CommandSearch.tsx`; Modify `src/shell/TitleBar.tsx` (search box in the right slot), `src/App.tsx` (builds the command list from existing callbacks), `src/shell/useAppShortcuts.ts`; Test `src/shell/__tests__/commands.test.ts`

**Interfaces:**
- Produces: `interface Command { id: string; label: string; location: string /* e.g. "Map › Selection" */; keywords: string[]; run(): void; enabled?: boolean }`; `searchCommands(commands: Command[], query: string, limit = 8): Command[]` — rank: label prefix > word prefix in label > keyword match > location match; case/diacritic-insensitive; disabled commands listed last and not runnable. Toolbox tools are included as commands (`location: "Geoprocessing"`).

- [ ] **Step 1: Failing tests** — `ranks label prefix above keyword matches`; `matches "select loc" to Select By Location`; `includes geoprocessing tools`; `disabled commands sort last and do not run`; `Alt+Q focuses the search box; Enter runs the highlighted command; Escape restores focus`.
- [ ] **Steps 2–5:** run → implement → run → commit `feat(shell): command search`.

### Task 30: Notifications, Help tab and documentation

**Files:** Create `src/shell/NotificationsMenu.tsx`, `src/ribbon/HelpRibbon.tsx`; Modify `src/App.tsx` (`notify` also records history), `src/store/types.ts` + `src/ribbon/contextualTabs.ts` (`CoreTab` and `CORE_TABS` gain `'Help'` last), `src/store/slices/workspace.ts` (`notifications: { id: string; message: string; kind: 'success' | 'warning' | 'error'; at: number; read: boolean }[]`, cap 50, `markNotificationsRead()`), `CLAUDE.md` (§4 rewritten for the Pro shell: core tabs, contextual groups, panes, views, theme default; §11 lists the new modules); Test `src/shell/__tests__/notifications.test.ts`, `src/ribbon/__tests__/helpRibbon.test.ts`

- Title bar bell with unread badge; menu lists newest first with time; "Clear all".
- **Help** tab: Keyboard Shortcuts (dialog listing the shortcut table from Decisions), Getting Started (local page: add data → symbolise → analyse → layout), About (opens Backstage › About).

- [ ] **Step 1: Failing tests** — `keeps the newest 50 notifications`; `unread count resets when the menu opens`; `Help › Keyboard Shortcuts lists Ctrl+S, Ctrl+O, Alt+Q, F2, Esc, Ctrl+Z, Ctrl+Y`.
- [ ] **Step 2–4:** run → implement → run; final full manual pass of every phase in both themes at 1366×768 and 1920×1080.
- [ ] **Step 5: Commit** — `feat(shell): notifications, Help tab and Pro shell documentation`.

---

## Phase Order and Dependencies

```
A (1,2) ─┬─ B (3,4) ─── J29 (needs TitleBar)
         ├─ C (5–10) ── D (11–13)
         └─ E (14–17) ─ F (18,19) ─ G (20–22) ─ H (23–26) ─ I (27) ─ J (28,30)
```

Tasks inside a phase run in order. Phase C can run in parallel with E only if both branches rebase on A; otherwise run phases alphabetically.
