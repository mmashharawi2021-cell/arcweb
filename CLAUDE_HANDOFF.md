# Claude Code handoff — ArcWeb

**Updated:** 2026-11-19 — post code-review fixes (Asia/Hebron). هذا ملف تسليم لكلود كود لمتابعة المشروع دون إعادة تنفيذ العمل المنجز.

## Start here

1. Read this file and `CLAUDE.md` before changing code.
2. Run `git status --short` and `git log -5 --oneline`; do not assume this snapshot is still the newest revision.
3. Implementation and its acceptance fix are already merged and pushed to **main**. Do not merge the old `ui/c-ribbon` branch again or restore older files from it.
4. Latest application fix at handoff: **`5c7134f`**. The commit containing this handoff is documentation only.
5. No feature implementation is currently in progress. The last requested work was completed acceptance testing. A numbered release has **not** been prepared or published.

Repository: https://github.com/mmashharawi2021-cell/arcweb
Local workspace: `C:\Users\mozar\Desktop\VS\arcweb`
Current branch: `main`, tracking `origin/main`. Working tree was clean before adding this file.

## What the user asked for

Claude originally delivered Phase B review fixes and Phase C of the ArcGIS Pro-style interface plan. The user asked Codex to continue, implement Tasks 11–13 and pictures, review the full plan, then implement the remaining plan without repeatedly stopping for confirmation. The user subsequently explicitly requested merging/pushing and acceptance testing.

The user prefers Arabic updates, direct execution, concise explanations, and no repeated approval questions for already-authorized work. Do not call a browser task complete based only on unit tests. Be precise about what was actually inspected.

## Source documents and their authority

- `CLAUDE.md`: architecture, storage/performance constraints, validation and module inventory.
- `docs/superpowers/plans/2026-11-17-arcgis-pro-interface.md`: original 30-task A–J plan, with a current implementation-status note.
- `docs/superpowers/2026-11-18-interface-plan-audit.md`: **historical partial audit**, superseded by the completion report; its pending items describe an earlier state.
- `docs/superpowers/2026-11-19-interface-completion.md`: task-by-task implementation coverage and validation limits.
- `docs/superpowers/2026-11-19-acceptance-review.md`: independent production workflow, actual bug found/fixed and reproduction instructions.

The original plan's test-first workflow checkboxes were deliberately not retroactively checked. They are not the current feature status. The code and completion/acceptance evidence are the source of truth.

## Delivery history

| Commit | Change |
| --- | --- |
| `940369f` | Claude's Phase B review fixes; starting baseline for this continuation |
| `849ad3a` through `6624a30` | Claude's Phase C: grouped core ribbons, extent history, Go To XY, rectangle selection, Insert/Analysis/Share and Edit/snapping |
| `60762e9` | Follow-up fixes: outside-map selection cancellation, stale project hint, modal Ctrl+O guard, Project section arrow/Home/End navigation, clearer copy labels, removal of unused project-library dialog, persisted snapping |
| `4e24097` | Task 11: contextual groups, legacy tab-id migration and Layout contextual tabs |
| `e2ef5e3` | Task 12: Feature Appearance/Labeling/Data and persisted scale visibility limits |
| `2e017cb` | Task 13: Raster Data and Layout Insert/Export, paper/orientation, 150/200/300 DPI and Close Layout |
| `c276e4e` | Picture insertion, embedding, persistence and layout export support |
| `9870f51` | Remaining plan Tasks 14–30: independent panes, Catalog/edit panes, views/tables, Contents, measurement/construction, icons and shell extras |
| `8f525b0` | Recorded completed fast-forward merge/push to main |
| `5c7134f` | Acceptance fix: View > Attribute Table opens the selected layer's table instead of hiding the table dock; added reproducible browser acceptance script |
| `d7d648f` | Code-review fixes: memoize tableSelectedIds, remove selectedLayerId side-effect from openTable, move editable guard before resets, remove dead onTogglePane branches, fix measurePoints double-call, align activeTable fallback strategy |

Delivery stayed on the existing `ui/c-ribbon` branch during implementation instead of creating a branch per phase. It was then fast-forward merged into main and pushed. Existing feature branches were not deleted. No deployment or release tag was created.

## What is implemented now

### Foundations, Project and core ribbons (Tasks 1–10)

- Shared ribbon controls and width-based group collapse; dark/light neutral surfaces with blue accents.
- Project backstage and Quick Access; Ctrl+S/Ctrl+O, busy guards and keyboard containment.
- Map groups; previous/next extent history (50); decimal/DMS Go To XY with pan/flash/marker; rectangle selection with Shift add and Ctrl/Cmd remove.
- Outside-map release, Escape and loss of focus cancel rectangle drags.
- Insert/Analysis/Share and Edit tools, undo/redo, snapping on/off and tolerance. Snapping is stored as a browser preference.

### Contextual groups and layout (Tasks 11–13 + Picture)

- Feature Layer: Appearance, Labeling, Data. Raster Layer: Appearance, Data. Layout: Insert, Export, only in layout view.
- Switching layer type retains the tab kind when available; contextual groups do not steal Analysis focus; old tab IDs migrate.
- Feature ribbon: scale visibility range, transparency, renderers, extrusion, label text/field/expression/placement, table/selection/export/calculation.
- Optional `minScale`/`maxScale` denominators round-trip in projects. Contradictions are dropped on load; numeric values are bounded. MapLibre zoom limits are updated without rewriting feature sources, including after latitude changes >5 degrees.
- Layout page setup and PNG/PDF at selectable DPI; supported elements include Picture.
- Pictures accept local PNG/JPEG/WebP up to 20 MB, decode before insertion/export, embed as data URLs in projects, and support contain/cover, description, move/resize/delete. Saved pictures cannot be remote URLs or SVG.

### Independent panes (Tasks 14–17)

- `src/panes/paneLayout.ts`: immutable open/close/activate/move/auto-hide, normalization, presets and legacy migration.
- `DockArea.tsx`: left/right dock tabs, active pane, float, auto-hide and close; changing ribbon tabs no longer chooses the right pane.
- `CatalogPane.tsx`: maps/layouts, searchable toolbox categories/tools, stored project source assets with reimport and missing-asset handling, offline basemap management.
- `CreateFeaturesPane.tsx`: editable layer templates, geometry-specific construction tools, New Layer form.
- `ModifyFeaturesPane.tsx`: move vertex/delete/attributes.
- `AttributesPane.tsx`: editable selected-feature fields and multi-selection navigator; raster/read-only layers are protected.
- Old `PhasePanels.tsx` and its EditPanel were removed. Shared old workflows were replaced, not left as a second active interface.

### Views and tables (Tasks 18–19)

- `src/views/viewState.ts`, `ViewTabs.tsx`: Map/Scene/Layout document tabs; Map cannot close. Still one MapLibre instance.
- `TableDock.tsx` plus store openTables/activeTable: multiple tables with per-layer sort/filter state; layer removal closes its table.
- **Acceptance regression:** opening another layer's table through View must add/activate it and show the dock, never toggle the entire dock off.

### Contents (Tasks 20–22)

- Optional layer selectable/editable/snappable flags and structured source metadata; old projects default flags to true.
- Identify, box selection, snapping and edit routes respect flags; raster edits are protected.
- Drawing/source/visibility/selection/editing/snapping List By modes; selection counts do not scan the feature array.
- Geometry-specific symbol patches, drag reorder, Alt+Up/Down reorder; Shift+F10/ContextMenu key opens the layer menu.
- Pro-ordered context menu with Selection and Data submenus, labeling, scale visibility zoom and Layer Properties.
- Properties can rename, edit field aliases and interaction flags.

### Measure and construction (Tasks 23–26)

- `src/measure/`: geodesic segments/total/area and feature perimeter; metric/imperial/nautical conversion.
- `src/editing/constructionTools.ts`: rectangle and circle from two points; automatic completion and degenerate checks.
- F2 finishes, Esc cancels, sketch Ctrl+Z removes the last vertex before edit undo; typing and overlay-handled keys are respected.
- `SketchToolbar.tsx`: finish/undo/cancel, minimum-vertex disable and polite vertex-count announcement.
- Old MeasurementCard/SketchCard implementations were removed from MapOverlays.

### Icons and shell extras (Tasks 27–30)

- `src/ui/commandIconRegistry.ts` and `commandIcons.tsx`: shared renderer/semantic roles, static command coverage and both-theme 3:1 role contrast tests.
- Editable ScaleBox, DD/DMS/DDM/UTM display, selection/feature counts and snapping in StatusBar; old app-footer removed.
- `src/shell/commands.ts`, CommandSearch: command/tool search, ranking, disabled guards, Alt+Q and keyboard navigation.
- Global shortcuts use capture phase because the IDE host could prevent Alt+Q before a bubble-phase listener. Modal guards must remain intact.
- Notifications keep newest 50 messages/read state; Help and keyboard reference; updated CLAUDE.md sections 4 and 11.

## Storage and compatibility rules — do not violate

- Entire application remains client-side; no backend or new runtime service was added.
- **Never clear IndexedDB, OPFS or localStorage to troubleshoot.** Read CLAUDE.md section 9 first.
- `arcweb-workspace-layout-v1` is a read-only migration input; it was neither deleted nor overwritten.
- Pane state uses `arcweb-workspace-layout-v2`; compatible shell layout uses `arcweb-workspace-shell-v2`. Projects can also carry normalized pane layout.
- Real user work stays at `http://127.0.0.1:5173`. Different origins/profiles have different storage. The acceptance test's separate origin/profile is intentionally disposable QA, not the user's project library.
- Preserve immutable feature/data references; metadata-only UI changes must not rewrite feature chunks.
- Preserve stable library capture/restore and map-event callback identities. Pointer-rate state belongs in StatusBar, not App.

## Validation that actually ran

- **613 tests passed across 89 files**, TypeScript, production build and lint.
- Integrated VS Code browser matrix: dark/light at **1366×768** and **1920×1080**, seven core tabs and both Layout contextual tabs: **36 checks**, no horizontal document overflow. Earlier contextual-ribbon checks also covered 1000 px width.
- Alt+Q focus and Shift+F10 layer menu were exercised in the integrated browser.
- A temporary layer exercised two simultaneously open attribute tables and cleanup. It was removed; the original project layer remained.
- Fresh integrated-browser navigation had no runtime exceptions/errors after development HMR messages were excluded by timestamp.
- Picture insertion/reload and generated PNG were checked earlier. The integrated browser canceled its native PNG download, so its generated image payload was inspected separately. This limitation was subsequently bypassed by a normal isolated Chrome acceptance run, which downloaded actual files.

### Production acceptance on patched main

`scripts/qa/acceptance-browser.mjs` serves the production dist, launches isolated headless Chrome and operates actual file inputs/UI. It reads IndexedDB to compare committed data; it does not inject application store edits.

**10 workflow assertions + 5 cold-restart assertions passed:**

1. Open a real version-1 project with modern optional fields absent.
2. Import a real three-point GeoJSON beside the legacy layer.
3. Select by attributes and run Buffer through the worker.
4. Keep the input table open while opening the output table.
5. Edit an attribute, save edits and wait for local commit.
6. Fit extent and create a Classic layout through Insert > New Layout.
7. Download nonempty PNG and PDF files.
8. Verify three committed layers and absence of uncaught runtime exceptions.
9. Close the entire browser process, restart at the same QA origin/profile.
10. Confirm exact layer hashes, project identity, edited attribute and full layout, with no uncaught runtime exceptions.

The PNG was visually inspected. The PDF was generated/downloaded, but its pages were **not** separately rendered for visual inspection.

## Commands to reproduce

Use PowerShell from the canonical uppercase-drive workspace path. Use `.cmd` shims; do not change execution policy.

```powershell
node_modules/.bin/tsc.cmd -b
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Production acceptance (use a NEW QA profile directory for a new full run):

```powershell
$env:ARCWEB_QA_PROFILE = "$pwd/tmp/acceptance/new-profile"
$env:ARCWEB_QA_PORT = '5198'
node scripts/qa/acceptance-browser.mjs dist tmp/acceptance/run.json
node scripts/qa/acceptance-browser.mjs dist tmp/acceptance/reopen.json --verify
```

The second command MUST include `--verify`, use the same profile/port and output directory, and run only after the first succeeds. Reusing an existing profile for the first workflow hits the normal project-replacement confirmation and is not a fresh acceptance run. The script starts/stops its own server and Chrome.

Local ignored artifacts:
- `tmp/pro-final-tests.json`: earlier full automated suite result.
- `tmp/acceptance/unit-tests.json`, `run.json`, `reopen.json`, `expected.json`.
- `tmp/acceptance/downloads/arcweb-layout.png` and `.pdf`.
- `tmp/phase-c-qa/final-matrix.json`, `final-fresh-load.json` and screenshots.
- QA profiles are in `tmp/`; do not mistake them for the user's browser profile.

## VS Code integrated browser: important troubleshooting history

Do not repeatedly try `mcp__cua_repl` if it reports `native pipe is unavailable`. That was a different, disconnected Codex computer-use transport, even while VS Code's browser was visibly working.

The actual extension is `thimo.integrated-browser-mcp`. Its installed README documents an HTTP API over a Windows named pipe and MCP stdio bridge. Find the current endpoint dynamically:

```powershell
Get-ChildItem "$env:USERPROFILE/.integrated-browser-mcp/instances" |
  ForEach-Object { Get-Content $_.FullName }
```

Match the instance workspace to ArcWeb; pipe names and tab IDs change after restarts. Do not copy an old pipe name from tool logs.

The bridge originally reported degraded mode: browser proposal declared but not granted. We added `"enable-proposed-api": ["thimo.integrated-browser-mcp"]` to `C:\Users\mozar\.vscode\argv.json`, with backup `argv.json.browser-mcp-backup`. After a full VS Code restart the bridge reported `browserProposal:true`, `degraded:false`, `tabOpen:true`.

This setting is outside the repository and will not come from Git. The user already restarted and it worked. Do not alter it again without checking current status.

Prefer the extension's available MCP tools. If unavailable in the agent session, the documented local HTTP endpoints can be called with Node `http.request({socketPath, path, method, headers})`. Use a consistent `X-Bridge-Client`, explicit owned tab IDs and the correct workspace. Useful routes: `/status`, `/tab/open`, `/eval`, `/click`, `/press`, `/emulate`, `/screenshot`, `/console`. Read the installed README for exact payloads. This is not the same pipe/API as `@oai/sky`.

## Limits and next work

- This was acceptance testing of the implemented workflow, not an exhaustive security, accessibility, memory or large-dataset audit.
- The code's task coverage is documented; historical workflow checkboxes are not evidence that all original failing-test-first steps were followed.
- Raster export means existing raster-cell GeoJSON/CSV, not a new GeoTIFF exporter.
- One live map and one layout sheet remain architectural constraints. Applying a template replaces the sheet; only the existing one-step template undo is retained.
- Both-theme viewport checks do not prove every combination of floating panes, long RTL names and large datasets. Treat future reports as potentially valid even though the suite passes.
- Do not advertise a release version: package.json still says `0.0.0`; no release tag, release notes package or deployment was published.
- **Completed:** PDF inspected visually (matches PNG export — Map Title, basemap, three layers, Legend, Scale 1:4820, WGS 84 coordinate label, north arrow). Code review of E–J shell ran at high level; 2 important and 6 nit findings; all 8 addressed in `d7d648f`.
- **Suggested next step:** additional real-data/RTL workflow testing, then prepare a numbered release when requested. Remaining open item: `captureWorkspace()` called inline in render (CatalogPane `assetIds`); address by adding an `assetIds` state slice to `useProjectIO` if CatalogPane re-render overhead becomes a problem.

User data and previous projects were not cleared. All acceptance fixture edits were confined to isolated QA profiles, except the earlier integrated-browser temporary layer, which was explicitly removed after the check.
