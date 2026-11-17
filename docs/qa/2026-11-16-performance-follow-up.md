# Phase 8 performance follow-up — partial audit

This pass addresses large imports and unnecessary worker payloads, and adds fresh production-browser QA after the user's explicit authorization to use isolated headless Chrome. It does not close the repository-wide audit or start Phase 9/Catalog.

## Changes reviewed manually

- Import worker prepares layer metadata and feature IDs before returning data. The UI yields before committing it and checks cancellation again.
- Field discovery uses a single-pass WeakMap cache keyed by immutable collection identity; returned lists cannot mutate the cache.
- Large MapLibre sources use local Blob URLs so MapLibre's worker fetches/parses the payload. Small sources retain object input. Original project data and feature IDs are preserved.
- Source ownership survives basemap style replacement. Superseded URLs remain valid until idle; removed layers and map disposal release their resources.
- Deferred workspace writes coalesce pending snapshots and remain ordered. Page dismissal submits the latest store snapshot immediately, even while a previous write is active, using IndexedDB transaction ordering on the same store.
- Geoprocessing workers receive only layers referenced by declared layer parameters. Main-thread tools retain their existing context. Existing stale-result checks remain in place.

Regression coverage includes prepared import IDs and properties, Blob content and lifetime, style replacement cleanup, metadata cache invalidation, deferred storage/error recovery/exit submission, and tool input scoping. Independent review identified the exit-save gap and style-replacement resource gap; both received reproducing tests and fixes.

## Same-metric performance comparison

Production baseline snapshot was captured before this pass, based on `3b5d83b`; optimized runs use this pass's working tree. Chrome 157.0.8103.78, Windows, 1366×860 viewport, isolated profiles, identical deterministic 60,000-point GeoJSON (14,303,621 bytes). Three alternating baseline/optimized runs, CPU sampling disabled. Metric: maximum main-thread Long Tasks duration during import and the following 3.5-second observation window, not total import latency or requestAnimationFrame delay.

| Run | Baseline maximum (ms) | Optimized maximum (ms) |
| --- | ---: | ---: |
| 1 | 426 | 278 |
| 2 | 558 | 217 |
| 3 | 595 | 201 |
| Median | 558 | 217 |

Median maximum task fell approximately 61%. All six runs recorded zero captured browser errors. The 250 ms target was **not met in every run**; a later full QA run measured 311 ms, while the final lifecycle-adjusted build's full QA run measured 173 ms and zero captured errors. These numbers do not establish equivalence to earlier Claude timing metrics or quantify tool execution speed. Concurrent UI animation edits appeared during final validation and are excluded from this implementation's source changes; this is not a tightly controlled attribution of every timing difference to a single optimization.

Raw local artifacts: `tmp/performance/comparison.json`, `baseline-run-*.json`, `optimized-run-*.json`, CPU profiles from exploratory runs, screenshots and isolated downloads. A compact evidence summary is retained alongside this report. Temporary bundles/profiles are excluded from version control.

Reproduce with an explicitly preserved pre-change production bundle in `tmp/performance/baseline-dist`:

```powershell
node scripts/qa/profile-browser.mjs dist tmp/performance/profile.json --compare
node scripts/qa/profile-browser.mjs dist tmp/performance/qa-final.json --qa --no-cpu
```

The baseline directory is an input artifact, not rebuilt automatically. Use the same generated fixture and environment for comparison. The default script run enables CPU sampling for diagnosis; do not compare sampled runs with the table above.

## Meaningful runtime coverage

Actual production Chrome exercised:

- 60k-point import and rendered map; session reload; exact downloaded project reopened with 60,000 features.
- Selection by attributes/location and Properties dialogs: initial focus, forward/backward Tab wrapping, Escape and opener restoration.
- Arabic CSV filename feedback contains directional isolation; screenshot inspected. This is sampled RTL coverage, not all UI strings or map-label shaping.
- Editing Save, subsequent unsaved changes, reload and Discard.
- Large import cancellation without added layers; large Buffer cancellation recorded in History; subsequent small Buffer succeeds while the unrelated 60k layer remains.
- Actual map PNG, layout PNG and complete PDF downloads; dimensions/header/trailer checked and final layout screenshot inspected. This does not establish pixel-perfect cartography at every export scale.

## Validation-only coverage

Commands run from canonical uppercase-drive project path; the Windows drive-case workaround is already documented in `CLAUDE.md` section 8.

| Command | Result |
| --- | --- |
| `node_modules\.bin\tsc.cmd -b` | Exit 0, no diagnostics after concurrent UI edits settled. |
| `npm.cmd run lint` | Exit 0, no diagnostics on final run. |
| `npm.cmd test` | Exit 0, 43 files / 351 tests passed. |
| `npm.cmd run build` | Exit 0, 3,039 modules transformed. |

These checks validate the project; they do not imply manual review or live exercise of every module. Earlier transient TypeScript failures were in concurrent `SceneNavigator`/`useInView` edits and disappeared when those edits settled. They were not fixed or included in this performance change.

## Explicit exclusions and remaining work

- Overall audit remains partial. Earlier numbered findings and coverage ledgers retain their scope; this report supplements rather than replaces them.
- R17: same-metric import A/B evidence now exists. R18: import stalls improved and worker payloads narrowed, but universal sub-250 ms responsiveness and matched heavy-tool timing remain unresolved.
- Application-wide nullable-geometry typing remains an explicit unresolved technical issue. Sampled crash-free runs do not prove complete type safety.
- Global map idle controls release of superseded sources. Continuous interaction can retain replaced versions until idle or disposal; memory behavior under repeated editing deserves a dedicated trace.
- Broad CRS/tool correctness, all themes/viewports, every workflow, and the remaining first-party audit inventory were not re-reviewed in this focused pass.
- Built-in browser connection was unavailable. Chrome automation used the user's explicitly authorized fallback and a separate temporary profile; it did not reuse the user's browser session.

Next: investigate the remaining renderer/clone long tasks, obtain matched heavy-tool timings and agree performance acceptance before expanding scope.
