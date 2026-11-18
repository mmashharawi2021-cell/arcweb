# ArcGIS Pro interface plan audit

> Superseded by the [2026-11-19 completion report](2026-11-19-interface-completion.md). This document records the earlier partial implementation.

Reviewed: 2026-11-18. Implementation baseline: `c276e4e` on `ui/c-ribbon`.
Plan: [2026-11-17-arcgis-pro-interface.md](plans/2026-11-17-arcgis-pro-interface.md).

## Result

The full A–J plan is **not complete**. Tasks 1–13 have implementations and automated coverage. Tasks 14–30 still need their planned implementation and acceptance checks. Existing legacy functionality must not be counted as completion of those tasks.

This is an implementation audit, not proof that every historical test-first/commit checkbox was followed. The original plan checkboxes remain unchecked; they are not a reliable progress indicator.

| Task | Implementation status | Evidence / remaining requirement |
| --- | --- | --- |
| 1 | Implemented | RibbonParts, RibbonGroupBar, useRibbonCollapse and primitive/collapse tests. ViewRibbon still uses the older toolbar; replace it under Task 15. |
| 2 | Implemented | Theme tokens, uiSettings, uiSettingsSync, theme/settings tests. Final both-theme visual acceptance is still outstanding. |
| 3 | Implemented | project/Backstage, library content, keyboard containment and busy guards; backstage tests. |
| 4 | Implemented | shell/TitleBar, useAppShortcuts, saveProjectNow and tests. |
| 5 | Implemented with planned follow-up | Five Map groups in CoreRibbons; feature measurement awaits Task 24. |
| 6 | Implemented | map/extentHistory and tests. |
| 7 | Implemented | map/coordinateInput, GoToXY and input tests. |
| 8 | Implemented | map/boxSelect, useBoxSelect and tests, including outside-release cancellation. |
| 9 | Implemented | Insert/Analysis/Share groups, gallery and initial-tool routing tests. |
| 10 | Implemented | Edit ribbon, snapping setting and map click coverage; snapping now persists in browser preferences. |
| 11 | Implemented | Contextual groups, legacy tab-id migration and contextualTabs tests. |
| 12 | Implemented | Feature Appearance/Labeling/Data, scale range persistence and style zoom bounds, label expression and calculator routing; layerRibbons and project persistence tests. |
| 13 | Implemented | Raster Appearance/Data and Layout Insert/Export, page setup, DPI and close-layout tests. Picture support added separately, including embedded project data and export image decoding. |
| 14 | Pending | No panes/paneLayout model, v2 layout persistence or v1 migration. workspaceLayout is still the legacy model. |
| 15 | Pending | No DockArea; App still switches the right pane by activeTab. ViewRibbon still exposes the legacy side pane/theme controls. |
| 16 | Pending | No CatalogPane with maps/layouts/toolboxes/source assets/offline basemaps. |
| 17 | Pending | Legacy EditPanel exists; no independent CreateFeaturesPane, ModifyFeaturesPane or AttributesPane. |
| 18 | Pending | Existing view-switch overlay is not the planned document tabs/openViews model. |
| 19 | Pending | One selected-layer AttributeTable exists; no openTables/activeTable model or TableDock. |
| 20 | Pending | No selectable/editable/snappable flags or structured source metadata on MapLayer. |
| 21 | Pending | Contents has drawing order/search; no List By mode model or SymbolPatch component. |
| 22 | Pending | Existing context menu and layer movement are partial precursors; no planned drag reorder, moveLayerTo or LayerPropertiesDialog. |
| 23 | Pending | Legacy measurement exists; no planned measure/measure module and acceptance tests. |
| 24 | Pending | No MeasureWindow, measure-feature mode or segment/unit interaction required by plan. |
| 25 | Pending | No rectangle/circle construction tools, F2 workflow or sketch-specific Ctrl+Z implementation. |
| 26 | Pending | Existing SketchCard is not the planned SketchToolbar with finish/undo/cancel. |
| 27 | Pending | Icons are passed directly; no command icon registry or semantic colour coverage. |
| 28 | Pending | StatusBar still uses the legacy readout; no editable ScaleBox, requested coordinate-format wiring, selection/snapping controls; app-footer remains. |
| 29 | Pending | Shortcut hook supports an optional command-search callback, but CommandSearch, command registry and Alt+Q UI are absent. |
| 30 | Pending | No HelpRibbon, notification history/menu or final Pro shell documentation. |

## Release and validation gaps

- Work through Phase D was pushed to `ui/c-ribbon`. The plan's per-phase branch/review/merge-to-main workflow has not been completed by these commits. Do not describe this branch as merged or released.
- Final acceptance requires both themes at 1366×768 and 1920×1080, including RTL names, keyboard focus, old project migration and all new panes/views. Recent browser checks at widths 1000 and 1366 do not replace that matrix.
- Picture insertion, reload and PNG appearance were checked in the integrated browser. PDF generation reported success. The integrated browser canceled native PNG download events, so the generated PNG payload was saved separately for visual inspection; successful file delivery in that browser remains a separate check.
- Task 13 Raster Data deliberately exports the current raster-cell feature representation as GeoJSON/CSV, not a new raster file format.
- The plan's Decisions lists View before Edit, whereas its explicit Task 11 CoreTab order and current implementation put Edit before View. Resolve this documentation inconsistency before final acceptance.

## Next task

Start Task 14: implement the independent pane layout model and non-destructive v1-to-v2 migration, then Task 15 DockArea. Tasks 16–30 follow their dependencies. Do not add Catalog or view tabs on top of the old right-pane routing model.
