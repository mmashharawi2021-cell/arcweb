# Phase 8 — Stabilization and CLAUDE.md gaps (design)

Status: approved direction (chat, 2026-11-16). Implementation plan: `docs/superpowers/plans/2026-11-16-phase-8-stabilization.md`.

## Why
Phases 3–7 shipped and two audits passed (`docs/audit-2026-11-15.md`), but:
- the repository has **no commits** — all work is one bad command away from loss;
- CLAUDE.md requirements are unmet: a **View** ribbon tab, a **`/src/store/`** module split, and
  "Performance First" (import and geoprocessing block the UI thread; a 60k-point import freezes ~1 s);
- audit follow-ups remain open (IDs 17, and follow-ups 4–7 in the audit doc).

## Requirements
1. **Baseline safety** — first commit of the current tree, then a working branch for Phase 8.
2. **View tab** — a core ribbon tab between Edit and Layout grouping existing window/view controls:
   pane toggles (Contents, side pane, Attribute table), workspace presets (Standard / Analysis /
   Cartography), map view (2D / 3D / Layout), Full canvas and theme. No new application state.
3. **Store split** — `src/store.ts` becomes `src/store/` (types + slices + index). Behaviour-preserving:
   the import path `./store`, every exported name and every state key/action stay identical.
4. **Off-main-thread import** — file import (GeoJSON, CSV, Shapefile ZIP, GeoTIFF) runs in a Web Worker
   with a **Cancel** button. KML stays on the main thread (workers have no `DOMParser`).
5. **Off-main-thread geoprocessing** — tools run in a Web Worker with **Cancel**; tools that need DOM APIs
   are flagged and keep running on the main thread. A cancelled run is recorded in History as `failed`
   with the message `Cancelled by user.` (no project-format change).
6. **Bidi-safe toasts** — user-supplied names inside toast messages are wrapped in Unicode isolates
   (U+2068 … U+2069) so Arabic names don't reorder the surrounding English sentence.
7. **Audit follow-ups** — release DEM samplers of removed layers; treat blank/null/boolean values as missing
   (not 0) in raster reconstruction and Graduated Colors; keep label expressions and extrusion settings
   consistent when Alter Field renames a field; give Map Properties and the Selection dialogs the same
   focus trap and focus restoration as the Remove/Open Project dialogs.
8. **Null-geometry casts (ID 17, incremental)** — replace the five scattered `null as unknown as …` casts
   with one documented helper. The application-wide nullable type change is a separate future plan.
9. **Browser regression pass** — repeat the critical workflows with real fixtures after the changes.

## Out of scope
Phase 9 (Catalog pane) — needs its own brainstorm/spec. Persistent undo/redo across reloads.
Dependency upgrades. Changing `PROJECT_VERSION` or the project JSON shape.
