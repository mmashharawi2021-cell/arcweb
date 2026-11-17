# Saved-project render preparation — 17 November 2026

Focused continuation of the import performance work. This does not close the
remaining comprehensive audit or the unresolved nullable-geometry typing issue.

## Implementation

Normal project opens now send immutable IndexedDB chunk descriptors to a small
dedicated worker. It reads those chunks locally, prepares the complete render
Blob and field catalog, and seeds them against the exact restored collection.
Large feature arrays do not cross from the UI to that worker. Existing project
reads, transaction guarantees, editing data and save format remain authoritative.
Backup-only reads do not start preparation workers.

Derived render Blobs/catalogs are cached in the existing `meta` store under a
versioned SHA-256 key covering both collection header and ordered immutable chunk
IDs. Edits create different chunk IDs and invalidate the entry. Nothing is
simplified or projected to a reduced attribute set. Null-geometry table rows stay
in the original data/catalog and are omitted only from the render copy, as before.

Cache writes are optional. Quota failures do not prevent opening, and storage
estimates reserve at least 64 MiB after the proposed cache write. Worker failures
or a 30-second timeout fall back to existing source preparation. Terminated workers
release their handlers. Compaction removes derived entries whose chunks are no
longer retained by any project or recovery revision. Backups exclude these caches.

`restoreLayers` previously always replaced the collection object even when every
feature ID was valid. It now preserves identity in that case, retaining prepared
resources and field catalogs. Missing/duplicate IDs still produce a repaired copy
without mutating the stored input. Existing source resource ownership continues
to reuse URLs for unchanged data and revoke them on replacement/removal/disposal.

## Verification method

The pre-change production bundle is preserved at
`tmp/performance/reopen-baseline-dist`. Chrome runs use isolated QA profiles with
the same saved real Natural Earth roads/countries and exact persisted-data hashes
from the preceding phase. Each measured session starts a new Chrome process with
networking disabled before navigation. The service worker is primed online to the
selected bundle before each variant, then the browser closes. Application cache
version priming is distinct from the derived render cache.

The browser harness records long tasks from initial navigation until Saved plus
5 seconds. It then performs a real pointer drag and wheel zoom, recording another
2-second task window and requestAnimationFrame intervals. Full extent is restored
through the UI between sessions so the camera is consistent. Three baseline
sessions are compared with the first uncached optimized open and three cached
optimized opens. CPU sampling and other test/build workloads are disabled during
the measured samples. Headless frame intervals are diagnostic, not hardware FPS.

Only QA-derived `map-render-v1:` entries are cleared for the uncached measurement;
project/chunk/recovery/source assets are preserved. Early diagnostic runs before
fixing collection identity and the harness's tooltip-aware button selector are
excluded from final results.

## Measured results

Milliseconds; medians of three baseline sessions versus three cached optimized
sessions (optimized runs 2–4). The first uncached optimized session is separate.

| Metric | Roads baseline | Roads cached | Countries baseline | Countries cached |
| --- | ---: | ---: | ---: | ---: |
| Saved/UI ready | 1,487 | 1,211 | 1,019 | 1,085 |
| Startup summed blocking time above 50 ms per task | 1,762 | 853 | 644 | 538 |
| Startup longest task | 703 | 647 | 364 | 254 |
| Pointer drag / wheel tasks above 50 ms | 0 | 0 | 0 | 0 |

Roads cached opens reduced aggregate blocking by 52% and readiness time by 19%,
with only an 8% reduction in the longest task. Countries reduced aggregate
blocking by 16% and longest task by 30%, while readiness was 6% slower. The sample
size is small and the results vary; no across-the-board speedup is claimed.

The first uncached optimized open took 2,827 ms for roads and 1,806 ms for
countries, slower than baseline. It performs duplicate worker-side database reads
and builds/writes the optional cache to spare the UI thread. Once built, cached
Blobs measured 69,568,922 bytes (roads) and 22,494,306 bytes (countries). A final
run and all optimized samples on the final production build confirmed the caches,
exact bundle, zero captured errors and no long main-thread stringify in roads.
The final optimized entry is `assets/index-p70jNB1w.js`; its preparation worker is
`assets/mapPrepare.worker-Ddod4ntL.js`. Earlier diagnostics on intermediate builds
are not included in the results table.

All fourteen primary cold sessions retained exact persisted feature-array hashes
(56,600 roads / 258 countries), including IDs, names, counts and local basemap.
The additional final-build roads cold session also matched. Main-thread large
`JSON.stringify` calls measured 197–241 ms in the roads baseline and disappeared
from all optimized startup measurements. Countries' previous small-feature-count
path serialized its large geometry object through MapLibre instead of stringify.

## Review and validation coverage

| Category | Evidence |
| --- | --- |
| Manual source review | Repository load/compaction, restore identity/ID repair, render-cache key/read/write/validation/ownership, worker lifecycle, pure field-catalog builder, installed MapLibre URL-load return path. This is not manual UI coverage. |
| Meaningful runtime exercise | Production Chrome offline cold opens, actual drag/wheel input, exact persistent hashes, explicit loaded-module URL matching and cache byte/count inspection. Service-worker app cache was updated before selected-build offline runs. |
| Regression tests | Exact render geometry/properties including Z and nested attributes, preserved null-geometry table data, native cache hit without chunk reads, chunk/header invalidation, malformed-cache rebuild, quota tolerance and headroom, missing chunks, GC keeping live cache/metadata, descriptor-only messages, worker termination/failure/timeout, valid-ID identity reuse and missing/duplicate-ID repair. |
| Validation-only | Complete TypeScript/lint/unit suite/build. These checks do not establish complete GIS correctness or exercise every tool. |
| Excluded/unresolved | Comprehensive remaining GIS/UI audit, complete nullable-geometry typing, all device/format/CRS/topology combinations, first-open latency optimization, remaining MapLibre clone/deserialization pause, KML/raster redesign and every edit-render path. |

Exact final validation from the uppercase canonical Windows drive path:

| Command | Result |
| --- | --- |
| `node_modules\.bin\tsc.cmd -b` | Exit 0 |
| `npm.cmd run lint` | Exit 0; zero warnings/errors |
| `npm.cmd test` | Exit 0; 51 files / 392 tests passed |
| `npm.cmd run build` | Exit 0; 3,053 modules; preparation worker 2.41 kB |
| `node scripts/qa/profile-browser.mjs dist tmp/performance/reopen-final-smoke.json --qa --library --download-area --no-cpu` | Exit 0; 13 QA checks plus 6 library/offline checks passed; zero captured errors |

The final browser regression exercised modal keyboard/focus, 60,000-point session
reload and exported-project reopen, Arabic filename feedback, edit Save/reload/
Discard, import and Buffer cancellation, successful next Buffer, PNG/PDF exports,
library copy/ZIP backup/restore, NASA download/cancel, and offline reload. Runtime
success does not close unrelated audit findings or prove complete type safety.

## Reproduction

Retain the pre-change production directory before building the optimized version.
Use only isolated QA browser profiles already populated with test data and a
matching `.persisted.json`. The following profile names are existing test profiles,
not fresh import profiles. The regular user browser profile is never used.

```powershell
$env:ARCWEB_QA_PROFILE='tmp/performance/chrome-import-final-roads'
$env:ARCWEB_QA_PORT='6197'
$env:ARCWEB_QA_EXPECTED='tmp/performance/import-final-roads.persisted.json'
node scripts/qa/profile-browser.mjs tmp/performance/reopen-baseline-dist tmp/performance/reopen-roads-baseline-prime.json --prime --no-cpu
1..3 | ForEach-Object { node scripts/qa/profile-browser.mjs tmp/performance/reopen-baseline-dist "tmp/performance/reopen-roads-final-before-$_.json" --reopen --no-cpu }
node scripts/qa/profile-browser.mjs dist tmp/performance/reopen-roads-final-prime.json --prime --clear-render-cache --no-cpu
1..4 | ForEach-Object { node scripts/qa/profile-browser.mjs dist "tmp/performance/reopen-roads-final-after-$_.json" --reopen --no-cpu }
```

Countries use `chrome-import-final-countries`, port 6196, the corresponding
`import-final-countries.persisted.json`, and `reopen-countries-final-*` output names.
Clear the profile/port/expected variables before a default fresh-profile regression
run. Portable samples and runtime summaries are in the adjacent
`2026-11-17-project-reopen-performance-evidence.json`.

## Remaining limitations

MapLibre's GeoJSON URL loader still returns complete data to the main thread.
Its native clone/deserialization pause is not removed by the derived cache.
Avoiding that return through private actor/source patches would risk rendering,
`getData`, updates and library compatibility, so this pass retains public behavior.
Large-source worst-case pauses and arbitrary device/format/frame-time guarantees
remain unresolved. This pass does not redesign KML/raster import or every edit/tool
render path. GIS geometry and property preservation is verified for the sampled
datasets, not all possible CRS/topology cases.
