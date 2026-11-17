# Real-data qualification and bounded area download

The user authorized public geographic data because no first-party GIS files were found in the workspace. This pass validates the local library with genuine datasets and implements a bounded online area downloader using an explicitly documented provider. It does not close the earlier repository-wide audit or its remaining performance/type issues.

## Data provenance

Natural Earth public-domain data, downloaded on 2026-11-17. Reproduction: `node scripts/qa/fetch-real-data.mjs`. Downloads, converted GeoJSON and SHA-256 provenance are kept in ignored `tmp/real-data`; compact provenance is retained in the evidence JSON alongside this report.

| Dataset | Source ZIP bytes | GeoJSON bytes | Features | Coordinate positions |
| --- | ---: | ---: | ---: | ---: |
| Admin 0 countries, 1:10m | 4,930,492 | 22,465,372 | 258 | 548,471 |
| Roads, 1:10m | 9,075,919 | 62,968,942 | 56,600 | 709,166 |

The countries test imports the original Shapefile ZIP through the application worker. Roads use the converted GeoJSON to exercise a larger uncompressed input. Terms: https://www.naturalearthdata.com/about/terms-of-use/. Exact download URLs and hashes are in the evidence file. This is data-preservation qualification, not certification of the source's geographic accuracy or political boundary choices.

## Meaningful live runtime results

Chrome runs use separate QA profiles, with explicit local origins and no access to the user's browser session.

- Both datasets imported, persisted, copied, backed up, restored as separate projects and rendered with networking disabled.
- Each browser was then fully closed. A new Chrome process and local server reopened the same isolated profile/origin with networking disabled from navigation onward. SHA-256 digests of every stored feature array, layer IDs/names/counts and the selected offline basemap matched the snapshot recorded before shutdown.
- Countries: app save-state ready after 953 ms on restart; roads: 1,425 ms. These are single-run UI/database readiness measurements, polled through CDP, not full-map-paint or cold-disk benchmarks. OS filesystem caches were not flushed.
- Roads live fault injection forced a QuotaExceededError during project writes. The committed record remained unchanged, the UI reported Save failed, and Save now succeeded after the injected fault was removed. This tests the browser error path without filling the user's disk.
- Two live tabs opened the same roads project. The first saved a rename; the second's stale write was rejected. Its unsaved workspace was successfully saved as a new project, without overwriting the first.
- The final regression smoke also passed dialog keyboard focus, project file round-trip, edit Save/unsaved edit/reload/Discard after Saved, cancellation, subsequent Buffer execution and PNG/PDF exports.
- All recorded successful runs captured zero browser errors.

Raw artifacts:

- `tmp/performance/real-countries.json`, `.persisted.json`, `.library.png`
- `tmp/performance/cold-countries.json`
- `tmp/performance/real-roads.json` (initial storage scheduling)
- `tmp/performance/real-roads-v2.json`, `.persisted.json`, `.library.png`
- `tmp/performance/cold-roads.json`
- `tmp/performance/area-final-smoke.json`

## Performance finding and focused fix

The 63 MB roads input exposed the cost of enqueueing every IndexedDB structured clone in one task. The repository now awaits each chunk's request-success event while retaining the same transaction, allowing input/rendering opportunities between requests. Point chunks remain up to 1,000 features; line/polygon chunks are up to 100. Older stored descriptors without chunkSize remain readable, with 1,000 as their legacy size.

The exploratory roads runs recorded maximum individual `put` call time of about 16.9 ms before and 3.9 ms after the change. The earlier run included a 407 ms task containing the queued writes. A regression test verifies smaller non-point chunks, unchanged-chunk reuse and exact reopening; rollback tests continue to pass.

These are not controlled alternating A/B runs and do not establish faster total import. The new roads run took 2,569 ms until layer-list availability and 4,681 ms until durable save-state completion; countries took 1,186 / 1,704 ms respectively. Large import/render tasks remain: maximum sampled long task was 903 ms in the new roads run, versus 767 ms in the earlier exploratory run. Serialization, worker message cloning, rendering and GC still need profiling. Universal sub-250 ms responsiveness is explicitly unresolved.

## Online area download

New `OfflineAreaDownload` UI in Projects supports current-map extent or numeric west/south/east/north bounds, zoom selection, tile count, approximate size, progress and cancellation. It downloads only NASA GIBS Blue Marble regional imagery, not the current OSM/Carto/Esri gallery provider.

Provider verification:

- Official GIBS documentation supports programmatic imagery downloads and defines its bulk-download coordination guidelines: https://nasa-gibs.github.io/gibs-api-docs/map-library-usage/#bulk-downloading.
- The live EPSG:3857 WMTS capabilities confirmed `BlueMarble_ShadedRelief_Bathymetry`, JPEG format and `GoogleMapsCompatible_Level8`.
- A live tile request returned HTTP 200, image/jpeg and Access-Control-Allow-Origin: `*`.

Application limits: zoom 0–8, 2,000 tiles / 50 MB tile payload per operation, two concurrent requests, timeouts and per-worker pacing targeting at most 2 MiB/s. The size estimate uses 25 KiB per tile and is explicitly approximate. Crossing the date line requires separate regions. Any tile/network/budget failure aborts the other requests; no partial package is activated. The completed ZIP uses the existing local-basemap format, preserving attribution and automatic backup inclusion.

The live test cancelled one area operation, then downloaded five actual NASA tiles for zooms 0–1, saved the package, disconnected networking, reloaded and displayed it under the countries layer. Screenshots were visually inspected. The final regression build repeated NASA cancellation/download/offline use successfully.

Blue Marble is coarse regional imagery, not a detailed street basemap. Remote label glyphs, other providers' styles and global elevation remain outside this package. Arbitrary provider URLs/API credentials are not accepted by the downloader.

## Reproduction

```powershell
node scripts/qa/fetch-real-data.mjs
$env:ARCWEB_QA_FIXTURE='tmp/real-data/countries.zip'
$env:ARCWEB_QA_PROFILE='tmp/performance/chrome-real-countries'
$env:ARCWEB_QA_PORT='6192'
node scripts/qa/profile-browser.mjs dist tmp/performance/real-countries.json --library --download-area --no-cpu
$env:ARCWEB_QA_EXPECTED='tmp/performance/real-countries.persisted.json'
node scripts/qa/profile-browser.mjs dist tmp/performance/cold-countries.json --reopen --no-cpu
```

Use a fresh isolated profile for a new import run; do not point this test at a user's profile. For roads, use roads.geojson and a separate profile/port; add `--storage-faults` for live quota injection and the second-tab scenario. For a clean default regression run, remove the four ARCWEB_QA_* variables first.

## Final validation

| Command | Result |
| --- | --- |
| `node_modules\.bin\tsc.cmd -b` | Exit 0 |
| `npm.cmd run lint` | Exit 0, no warnings/errors |
| `npm.cmd test` | 47 files / 371 tests passed |
| `npm.cmd run build` | Exit 0, 3,050 modules transformed |
| `node scripts/qa/profile-browser.mjs dist tmp/performance/area-final-smoke.json --qa --library --download-area --no-cpu` | Exit 0, zero captured browser errors |

The new area tests cover exact XYZ edge/quadrant coverage, invalid/budgeted bounds, approved URL construction and package structure, pre-cancellation, and failure-driven cancellation of other workers. This report supersedes the earlier local-library report's limitations concerning missing online area downloads and unexercised live conflict/quota-error UI paths. Actual disk quota exhaustion, arbitrary user datasets, high-detail street downloads, unlimited revision history and complete nullable-geometry type safety are not claimed.
