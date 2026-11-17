# Post-save render warming and retained memory — 17 November 2026

This focused follow-up reduces retained project data and moves render-cache
creation ahead of the next open. The broader GIS/codebase audit and complete
nullable-geometry typing remain unresolved.

## Changes

- After a successful active-project commit, queue one descriptor-only warming job
  with a one-second delay. Committed save success never waits for this job. Identical
  descriptor sets are coalesced/skipped; newer versions cancel old workers. A reader
  requesting the same version starts/joins the job instead of allocating a second
  preparation worker. Closing the repository or compacting cancels the job.
- Warm workers write optional derivatives locally and reply with `null`, so no
  complete render Blob/feature array is posted back to the UI during warming.
- Stored-source preparation reads one immutable chunk at a time, builds native
  Blob parts and merges field catalogs. It no longer flattens all chunks into a
  second complete JS collection or creates one giant JSON string. Feature order,
  IDs, geometry including Z, nested attributes, header and nonspatial field catalogs
  are preserved. Existing cache keys/semantics stay compatible.
- Repository reuse records hold `WeakRef`s instead of owning complete collections.
  Missing/collected references cause safe fresh writes, never data loss. Successful
  active saves prune obsolete project/layer bookkeeping; close clears it. Retired
  map callbacks capture only their URL resource, not the previous original data.
- Background housekeeping removes derived caches of expired/deleted revisions
  using current/recovery references. It never deletes project records, revisions,
  original assets or authoritative feature chunks. Quota/headroom/failure fallbacks
  from the preceding phase remain in place.

## Measurement boundaries

The pre-change production bundle is preserved at
`tmp/performance/save-warmup-baseline-dist`. Fixtures are the same Natural Earth
roads GeoJSON (62,968,942 bytes / 56,600 features) and original countries Shapefile
ZIP (4,930,492 bytes / 258 features). Provenance/hashes are in the real-data report.

Memory QA imports the actual file through the browser, edits/restores the first
feature's string `featurecla` property, switches to a new empty project, then reopens
the original through the library. Exact persisted feature-array hashes must match
before/after restoring the edit and after reopening. Each sample waits 1.5 seconds
after the UI transition, forces main-target GC, then reads CDP `Runtime.getHeapUsage`.
These are point samples, not peak or guaranteed steady-state measurements.

The reliable metric is **main-target JavaScript used heap after explicit GC**.
It excludes native Blob storage, MapLibre worker heaps, GPU memory and total process
RAM. Anonymous worker targets could be enumerated but their heap RPC timed out;
those samples are explicitly marked unavailable, not treated as zero. No total-RAM
or worker-peak reduction is claimed. Main-thread/worker allocation code was reviewed
separately. Build/test activity may overlap early memory diagnostics; those import
timings are not used as controlled latency comparisons.

First-open verification uses fresh isolated profiles, real import/save and a locally
generated XYZ package installed through the UI, then closes Chrome. It records
derived entries **before any repository reopen**, distinguishing post-save warming
from a cache created by a previous load. A new Chrome process starts offline and
must match the selected production module and exact saved project hashes. Both
variants have the same approximately five-second post-save observation opportunity.
No build/test workload overlaps the measured cold-readiness/startup window.
These are single paired samples, not a three-run benchmark or a universal speedup.

Earlier diagnostics without a local basemap produced expected offline OSM tile
network errors. They are excluded from the final offline comparison; they were not
silently recategorized as successful error-free runs. The local package avoids that
external dependency without downloading provider tiles.

## Results

Main-target JavaScript **used heap after GC**, MiB. Optimized values are final
production-build samples; earlier diagnostic optimized files are excluded.

| Stage | Roads before | Roads final | Countries before | Countries final |
| --- | ---: | ---: | ---: | ---: |
| Loaded | 142.82 | 143.21 | 65.54 | 65.62 |
| Edited and saved | 220.22 | 82.89 | 44.28 | 44.55 |
| Attribute restored | 83.22 | 83.26 | 44.63 | 44.67 |
| Switched to empty project | 80.90 | 9.39 | 41.73 | 9.36 |
| Reopened original project | 152.38 | 81.08 | 98.59 | 66.27 |

The strongest retention result is switching to an empty project: approximately
88% lower main JS heap for roads and 78% for countries. Intermediate editing and
reopen samples can include different stages of asynchronous MapLibre source
processing; they are reported for transparency, not claimed as steady-state or
peak-memory reductions. Active loaded data remains approximately unchanged.
Both datasets matched their exact persistent feature arrays after restoring the
edit and reopening. All four final/baseline memory sessions captured zero errors.

First-ever **offline Chrome restart after real save**, one paired sample:

| Dataset | Cache entries before first reopen: baseline / final | Ready baseline | Ready final |
| --- | --- | ---: | ---: |
| Roads | 0 / 1 (69,568,922 bytes) | 2,537 ms | 1,334 ms |
| Countries | 0 / 1 (22,494,306 bytes) | 1,543 ms | 1,462 ms |

This verifies that a completed post-save warmup removes the next open's cache
creation cost in these scenarios. It is not evidence that cache misses are now
free or that every first open will be faster. Each cold run matched the complete
saved project summary and feature-array hashes, loaded the expected bundle, and
captured zero browser errors. The final entry is `assets/index-DE9QcLJv.js` and the
preparation worker is `assets/mapPrepare.worker-Cgm2yEM3.js` (3.38 kB).

## Validation and coverage

| Category | Scope / result |
| --- | --- |
| Manual code review | Commit boundary, descriptor queue and cancellation/join lifecycle, weak reuse/fallback, retired-resource closure, incremental Blob/catalog assembly, cache housekeeping and authoritative-data boundaries. |
| Meaningful browser exercise | Real roads/countries import, property edit/restore, empty-project switch/reopen, exact persistent data comparison, post-save cache inspection before any load, separate-process offline restart with expected bundle assertion. |
| Final production regression | Modal focus/keyboard, session reload, exported-project reopen, Arabic filename, Save/reload/Discard, import/Buffer cancellation and next successful Buffer, map/layout PNG and layout PDF, project copy, ZIP backup/restore, NASA package download/cancel and offline app/project/basemap reload. All 13 QA plus 6 library/offline checks passed; zero captured errors. |
| Meaningful unit regressions | Delayed/coalesced/completed warmups, superseded/closed workers and reader joins, failure tolerance, descriptor-only native bridge and abort, chunked JSON with null-only gaps/escaped text, merged catalogs, collected weak-reference safe save, expired-cache cleanup preserving current/recovery/chunk data. |
| Validation-only | Full TypeScript, lint, unit suite and production build below. This does not mean all GIS tools/components received manual/runtime review. |
| Tool limitation | Anonymous worker heap RPC unavailable; no worker peak, native memory or total RAM claim. |
| Still unresolved/excluded | Full audit and nullable-geometry typing; large MapLibre return task; all formats/CRS/topology/device budgets; complete export/backup memory redesign; immediate-close warmup completion. |

Exact final validation commands, canonical uppercase Windows drive path:

| Command | Result |
| --- | --- |
| `node_modules\.bin\tsc.cmd -b` | Exit 0 |
| `npm.cmd run lint` | Exit 0, zero warnings/errors |
| `npm.cmd test` | Exit 0, 52 files / 401 tests passed |
| `npm.cmd run build` | Exit 0, 3,054 modules |
| `node scripts/qa/profile-browser.mjs dist tmp/performance/save-warmup-final-smoke.json --qa --library --download-area --no-cpu` | Exit 0, all checks passed, zero captured errors |

## Reproduction

Use fresh isolated profiles for import/save scenarios; the names below already
contain test projects after this run. Never use the regular user's browser profile.
Memory before/after runs use the same harness and real fixture, with different
production directories. Main-heap measurement is intentionally separate from
controlled cold-readiness measurement.

```powershell
$env:ARCWEB_QA_FIXTURE='tmp/real-data/roads.geojson'
node scripts/qa/profile-browser.mjs tmp/performance/save-warmup-baseline-dist tmp/performance/memory-roads-before.json --memory --no-cpu
node scripts/qa/profile-browser.mjs dist tmp/performance/memory-roads-final.json --memory --no-cpu

$env:ARCWEB_QA_PROFILE='tmp/performance/chrome-first-save-v2-after-roads'
$env:ARCWEB_QA_PORT='6200'
node scripts/qa/profile-browser.mjs dist tmp/performance/first-save-v2-after-roads.json --saved-project --local-basemap --no-cpu
$env:ARCWEB_QA_EXPECTED='tmp/performance/first-save-v2-after-roads.persisted.json'
node scripts/qa/profile-browser.mjs dist tmp/performance/first-cold-v2-after-roads.json --reopen --no-cpu
```

Roads baseline uses `chrome-first-save-v2-before-roads`, port 6199 and the baseline
directory. Countries use `countries.zip`, profiles `chrome-first-save-before-countries`
and `chrome-first-save-after-countries`, ports 6201/6202, and matching
`first-save-*-countries` / `first-cold-*-countries` names. Clear fixture/profile/port/
expected variables before a default regression run. Raw outputs are in
`tmp/performance/`; portable evidence is in the adjacent
`2026-11-17-save-warmup-and-memory-evidence.json`.

## Remaining limits

The app must remain open long enough for optional warming to finish. Immediate
closure, quota restrictions, superseding edits or worker failure can leave a cache
miss, so the existing open-time fallback remains necessary. Retained recovery
versions may intentionally have separate render caches; expired ones are cleaned.

MapLibre still returns full GeoJSON to the main thread and can cause a substantial
clone/deserialization pause. Active editing/undo, exports and full-library backup
can legitimately retain large data. Complete GIS correctness, all formats/devices,
OS RAM peaks and complete nullable-geometry safety are not established by these
sampled runs.
