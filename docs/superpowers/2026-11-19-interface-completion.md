# ArcWeb Pro shell completion - 2026-11-19

Implementation of the 30 tasks in [the interface plan](plans/2026-11-17-arcgis-pro-interface.md) is complete on the existing `ui/c-ribbon` branch. This supersedes the earlier [partial audit](2026-11-18-interface-plan-audit.md).

## Implementation coverage

| Tasks | Delivered | Evidence |
| --- | --- | --- |
| 1-4 | Ribbon primitives/collapse, neutral blue themes, persisted preferences, Project backstage, Quick Access and global shortcuts | Existing ribbon, theme, backstage, save and shortcut tests |
| 5-10 | Core ribbon tabs, extent history, Go To XY, box selection, analysis gallery, edit and persistent snapping | Existing map/core/edit tests and browser checks |
| 11-13 | Contextual groups, Feature/Raster tabs, scale limits, Layout Insert/Export and embedded pictures | Contextual/layer/layout ribbon tests, scale/persistence/picture tests; picture reload and generated PNG inspection |
| 14 | Immutable pane state, normalization, open/close/activate/move/auto hide, presets and legacy migration | `src/panes/paneLayout.ts`, paneLayout tests, project workspace round-trip tests |
| 15 | Independent left/right docks, bottom pane tabs, floating and auto hide; View Windows and Reset Panes | DockArea tests confirm ribbon changes do not replace the active pane; integrated-browser checks |
| 16 | Catalog: maps/layouts, searchable toolbox categories, original source assets and offline basemap management | CatalogPane tests cover reimported original filenames and missing assets |
| 17 | Create Features templates and New Layer form, Modify Features and selected-feature Attributes navigator | editPanes tests cover editable templates, polygon construction choices, attribute editing and navigation |
| 18 | Map/Scene/Layout document tabs; Map cannot close; one existing map instance | viewState tests; browser view switching and Close Layout |
| 19 | Multiple attribute table tabs and active table; layer removal cleans up its table; existing per-layer views retained | Store tests and real browser test with a temporary layer and two open tables, followed by cleanup |
| 20 | Optional selectable/editable/snappable and source metadata; query, snapping and edit guards | Map-click boundary tests, box filtering, source/flag persistence tests; older fields default to true |
| 21 | Contents List By modes and geometry-aware symbol patches | contentsModes tests prove selection counts do not access feature arrays; symbol component test |
| 22 | Drag reorder, Alt+Up/Down, Pro-ordered layer menu with Selection/Data submenus and Layer Properties | Layer menu tests; properties component test covers name and alias updates |
| 23-24 | Geodesic segments, distance/area/feature measurement, metric/imperial/nautical conversion | Measurement math and component tests, direct feature-click routing test |
| 25-26 | Polygon/rectangle/circle construction, automatic two-click shapes, F2/Esc/sketch Ctrl+Z and sketch toolbar | Construction and hook keyboard tests; toolbar minimum-vertex/Undo/announcement test |
| 27 | Shared command icon renderer, command role registry and semantic colours | Static command coverage and 3:1 role contrast tests in both themes |
| 28 | Editable scale, DD/DMS/DDM/UTM, selected/feature counts and snapping in the status bar | Scale/coordinate tests; old application footer removed |
| 29 | Title-bar command search and geoprocessing tool search; Alt+Q, ranking and disabled guards | Search and component tests; Alt+Q focus verified in VS Code integrated browser |
| 30 | Newest-50 notification history/read state, Help and keyboard reference, shell documentation | Notification tests, keyboard-reference component test, updated CLAUDE.md sections 4 and 11 |

## Validation

- TypeScript build, production build and lint pass.
- Complete automated suite passes: 613 tests across 89 files; the machine-readable final result is in `tmp/pro-final-tests.json`.
- Integrated browser matrix: dark/light at **1366 x 768** and **1920 x 1080**, seven core tabs plus both Layout contextual tabs: **36 checks, no horizontal document overflow**. Representative screenshots and `final-matrix.json` are in `tmp/phase-c-qa/`.
- A fresh browser navigation has **no runtime error/exception entries**; recorded in `tmp/phase-c-qa/final-fresh-load.json`.
- The temporary two-table QA layer was removed through the application, leaving the original layer. The original theme, default download handling and normal viewport were restored.
- The original `arcweb-workspace-layout-v1` key is a read-only migration source. Pane state uses `arcweb-workspace-layout-v2`; the compatible workspace shell settings use `arcweb-workspace-shell-v2`. Original project/source databases were not cleared.

## Delivery notes

- The feature implementation stayed on the previously authorized `ui/c-ribbon` branch rather than creating a separate branch per phase. **It has not been merged to main.** Review/merge is a separate release step.
- Historical failing-test/commit checkboxes in the plan were not retroactively marked as proof of an execution history. The coverage table above records the final implementation and validation.
- Raster Data exports the existing raster-cell feature representation as GeoJSON/CSV; no new GeoTIFF exporter is claimed.
- Picture exports generate embedded image content. The earlier integrated-browser PNG download event was canceled by the IDE, so its generated payload was saved and visually checked separately; ordinary browser download delivery is distinct from layout image generation.
- Core-tab order follows explicit Task 11 (`Edit` before `View`); the conflicting Decisions sentence was aligned with it.
