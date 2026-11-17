# Large import responsiveness — 17 November 2026

This is a focused performance follow-up, not completion of the comprehensive
codebase/GIS audit. Earlier library, offline and area-download work remains in
place. No features, attributes or geometry were removed to improve these results.

## Changes reviewed

- `importTransport.ts`, `import.worker.ts`, `runInWorker.ts`: acknowledged vector
  batches, one in flight at a time, complete-result assembly before publishing to
  application state, termination on cancellation/error. Points use 1,000-feature
  batches; other geometries use 100. Original feature ordering and IDs survive.
- `importHandler.ts`, `mapSourceData.ts`, `symbology.ts`, `App.tsx`: the import
  worker prepares the render JSON Blob and field catalog. The original full data
  remains authoritative for editing, tools, attributes and persistence. Worker
  field catalogs are copied defensively and invalidated by immutable data replacement.
  Blob seeds are consumed once; existing map resource ownership revokes URLs.
- `maplibre.worker.ts`, `mapBlobProtocol.ts`: fetch/parse local Blob URLs inside
  the MapLibre worker, avoiding its unknown-protocol round trip through the UI.
  Register `blob:http` and `blob:https` because MapLibre extracts protocol names
  before `://`. Retain the worker constructor so bundling does not remove its
  bootstrap. Production worker size is 519.49 kB, not an empty wrapper.
- QA harness: allow `ARCWEB_QA_BASELINE` to select an explicit preserved production
  bundle, and record import/durable-save timing plus summed long-task blocking time.

## Measurement method

The baseline is the production bundle copied immediately before this change to
`tmp/performance/import-baseline-dist`; it includes the preceding local-storage
and area-download work. This is a working-tree snapshot, not a historical commit.
Each comparison alternates baseline/optimized three times with fresh isolated
Chrome profiles, identical fixtures and viewport, and CPU sampling disabled.
No unit tests/builds were run concurrently with these benchmark samples.

The observation window starts before the native file-input upload and ends after
the Saved state plus 3.5 seconds. Blocking time here means
`sum(max(0, longTask.duration - 50))` within that window; it is not a Lighthouse
navigation score. UI-layer availability is not proof that every map tile painted.
Diagnostic CPU profiles are separate from benchmark samples. Results are local,
small-sample measurements, not universal device/frame-rate guarantees.

Natural Earth source URLs, licensing and hashes are recorded by
`scripts/qa/fetch-real-data.mjs` in `tmp/real-data/sources.json`. Roads contains
56,600 features / 709,166 coordinate positions (62,968,942-byte GeoJSON).
Countries uses the original 4,930,492-byte Shapefile ZIP, producing 258 features /
548,471 coordinate positions. See the previous real-data report for provenance.

## Results

Medians of three alternating samples, in milliseconds:

| Dataset / metric | Baseline | Optimized | Change |
| --- | ---: | ---: | --- |
| Roads: summed blocking time | 2,743 | 567 | 79% lower |
| Roads: longest task | 770 | 617 | 20% lower |
| Roads: durable save | 4,531 | 3,687 | 19% faster |
| Roads: layer available | 2,629 | 2,729 | 4% slower |
| Countries: summed blocking time | 848 | 532 | 37% lower |
| Countries: longest task | 513 | 202 | 61% lower |
| Countries: durable save | 1,841 | 1,767 | 4% faster |
| Countries: layer available | 1,358 | 1,274 | 6% faster |

All twelve benchmark sessions captured zero browser errors. Roads optimized
longest tasks were 617, 558 and 698 ms; the remaining pause is material. Streaming
and worker preparation substantially reduce aggregate blocking, without a general
claim that import completion or first layer availability is always faster.

## Coverage and final verification

| Evidence category | Scope / outcome |
| --- | --- |
| Manual source review | Import protocol/worker/transport, worker lifecycle, App import integration, render-Blob/cache ownership, field catalogs, MapLibre worker bootstrap and installed MapLibre protocol/source implementation. This is source inspection, not manual UI exercise. |
| Meaningful browser runtime exercise | Production Chrome file input for both real datasets; twelve benchmark sessions; 60,000-point regression session with modal focus/keyboard, exact exported-project reopen, Arabic filename, edit Save/reload/Discard, import/Buffer cancellation and subsequent Buffer, map/layout PNG and layout PDF. All checks passed, zero captured errors. |
| Meaningful persistence/offline exercise | Both real datasets: library copy, ZIP backup/restore, offline app/project/basemap reload. Countries additionally downloaded/cancelled the bounded NASA area package. Roads additionally exercised quota fault injection, retry, two real tabs with stale-write rejection and Save as copy, and verified painted features offline. Quota failure was injected, not actual disk exhaustion. |
| Independent content verification | Exported backup geometry and every property matched original GeoJSON by SHA-256 for all 56,600 roads and 258 countries, excluding generated IDs from this source comparison. Full persisted feature arrays, including IDs, matched after separate Chrome-process restart offline. Countries UI/database ready: 1,336 ms; roads: 1,246 ms. These are functional reopen checks, not a cold-paint benchmark. |
| Regression unit tests | Backpressure, exact structured-clone reconstruction/identity/order/IDs/Blob survival, invalid/truncated batches, cancellation/late messages, callback error/abort acknowledgments, native Blob fetch/abort/revocation, worker-prepared catalog/render output, seed consumption and URL ownership, defensive field catalogs and data-replacement invalidation. |
| Validation-only runs | TypeScript, lint, complete unit suite and production build below. These do not constitute runtime exercise of every GIS tool or UI component. |
| Exclusions / unresolved | Full remaining audit/tool/layout/scene/export/CRS review; arbitrary datasets/devices; all symbology/label/3D runtime permutations; complete null-geometry typing; KML and raster performance redesign; actual full disk. Earlier unresolved audit findings are not closed by this performance pass. |

Exact final commands, from the canonical project directory:

| Command | Result |
| --- | --- |
| `node_modules\.bin\tsc.cmd -b` | Exit 0 |
| `npm.cmd run lint` | Exit 0; no warnings/errors |
| `npm.cmd test` | Exit 0; 49 files / 380 tests passed |
| `npm.cmd run build` | Exit 0; 3,051 modules; production map worker 519.49 kB |
| `node scripts/qa/profile-browser.mjs dist tmp/performance/import-final-smoke.json --qa --library --download-area --no-cpu` | Exit 0; all runtime checks passed, zero captured errors |

Additional browser outputs under `tmp/performance/`: `import-final-countries.json`,
`import-final-countries-cold.json`, `import-final-roads.json`,
`import-final-roads-cold.json`. Their commands use the fixture/profile/port variables
below, with `--library --download-area --no-cpu` for countries and
`--library --storage-faults --no-cpu` for roads; second invocations use `--reopen --no-cpu`.
Portable measured samples and verification summaries are retained in
`2026-11-17-import-performance-evidence.json` alongside this report.

## Remaining limits

MapLibre still returns the fully loaded GeoJSON source from its worker, producing
a substantial main-thread deserialization task on large data. The change does
not claim a 16 ms/60 fps or 250 ms ceiling. A single extremely large feature can
also exceed the batch budget because feature geometry is not split or simplified.

Cold reopen and edits can use the existing main-thread render-Blob fallback;
their performance is not covered by the import improvement claim. KML still uses
the DOM-dependent main-thread reader. Raster transfer and GIS algorithms were not
redesigned. Nullable-geometry typing remains explicitly unresolved; passing sampled
runtime tests does not establish complete type safety or correctness for all GIS
formats, projections, tools or user datasets.

## Reproduction

Run from the canonical uppercase Windows drive path described in `CLAUDE.md`.
Preserve the pre-change bundle before rebuilding; do not substitute a different
baseline silently. The scripts use separate QA profiles, never the user's profile.

```powershell
$env:ARCWEB_QA_BASELINE='tmp/performance/import-baseline-dist'
$env:ARCWEB_QA_FIXTURE='tmp/real-data/roads.geojson'
node scripts/qa/profile-browser.mjs dist tmp/performance/import-comparison/run.json --compare
$env:ARCWEB_QA_FIXTURE='tmp/real-data/countries.zip'
node scripts/qa/profile-browser.mjs dist tmp/performance/import-countries-comparison/run.json --compare

$env:ARCWEB_QA_FIXTURE='tmp/real-data/countries.zip'
$env:ARCWEB_QA_PROFILE='tmp/performance/chrome-import-final-countries'
$env:ARCWEB_QA_PORT='6196'
node scripts/qa/profile-browser.mjs dist tmp/performance/import-final-countries.json --library --download-area --no-cpu
$env:ARCWEB_QA_EXPECTED='tmp/performance/import-final-countries.persisted.json'
node scripts/qa/profile-browser.mjs dist tmp/performance/import-final-countries-cold.json --reopen --no-cpu
```

For a new import run, choose a fresh isolated QA profile; existing profile names
above already contain saved projects. Roads used `chrome-import-final-roads`, port
6197, `roads.geojson`, `--library --storage-faults --no-cpu`, then the corresponding
`import-final-roads.persisted.json` with `--reopen --no-cpu`. Clear the fixture,
profile, port and expected variables before the default regression command.
