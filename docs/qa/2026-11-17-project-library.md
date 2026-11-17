# Project library and offline storage — implementation and verification

Follow-up: `2026-11-17-real-data-and-area-download.md` records genuine geographic datasets, full browser restarts, live conflict/quota fault paths and the subsequent NASA area downloader. Read it for current coverage; the limits below describe this earlier implementation snapshot.

## Delivered

- Native IndexedDB repository with separate project manifests and immutable chunks of up to 1,000 features. Metadata saves reuse data references; a feature edit rewrites affected chunks. Project pointers, new chunks, recovery manifests and active-project metadata commit atomically.
- Five retained committed versions per project, with reachability-based chunk collection. Source metadata is validated in the same transaction as project references. Source files use OPFS with an IndexedDB fallback, with a one-day grace period before collecting unreferenced sources.
- Optimistic revision checks reject stale writers. Explicit new-copy creation preserves unsaved work after a conflict. Dirty/saving/error status reflects actual completion; pending saves trigger a beforeunload guard where supported.
- Read-only migration from old idb-keyval session/settings/edit snapshots. Legacy keys remain intact. Migration refuses malformed legacy data rather than replacing it.
- Projects dialog: create/open/copy/delete, save now, recovery, compressed backup/restore, quota estimates, persistence requests, data cleanup, local XYZ basemap import.
- ZIP backup includes current projects, retained recovery versions, edit recovery and source assets. Restores allocate new IDs, remap source references and leave existing projects/active selection untouched. Failed recovery-group imports remove their partial new project; earlier complete groups can remain and are reported.
- Production service worker precaches same-origin application bundles, workers and HTML. Local XYZ archives render through a custom MapLibre protocol; no external tiles are bulk-downloaded or cached by this service worker.
- Stable launcher origin: development `start.bat` and production `start-offline.bat` both use 127.0.0.1:5173 with strict port checks.

The runtime remains client-side. The only added dependency is development-only fake-indexeddb for transaction tests. Existing working-tree motion/performance changes were preserved.

## Validation

| Command | Result |
| --- | --- |
| `node_modules\.bin\tsc.cmd -b` | Exit 0 |
| `npm.cmd run lint` | Exit 0, zero warnings/errors |
| `npm.cmd test` | 46 files, 365 tests passed |
| `npm.cmd run build` | Exit 0; production sw.js and worker bundles generated |
| `node scripts/qa/profile-browser.mjs dist tmp/performance/library-final.json --qa --library --no-cpu` | Exit 0; zero captured browser errors |

Fourteen storage tests cover atomic rollback on uncloneable input, exact source bytes/MIME on backup restore, recovery history, corrupt/incomplete input refusal, legacy preservation, chunk reuse, one-chunk edits, stale writes, explicit conflict copies, cancellation during initialization, reachability cleanup and avoiding repeated legacy migration after another tab deletes the active project. Existing bidi-message assertions were made locale-aware for numeric counts after the Windows host switched its default numeral locale; Unicode isolation and downloaded-data assertions remain exact.

## Meaningful browser exercise

Chrome imported 60,000 points, saved/reloaded and reopened the exact downloaded project; exercised edit Save/unsaved-change/reload/Discard after the database reported Saved; checked dialog keyboard focus, cancelled a large import and Buffer, ran a subsequent Buffer and exported PNG/PDF.

The library pass copied an existing project, exported a compressed backup containing four projects (7,783,531 bytes in the recorded final run), restored eight total projects with original IDs retained, imported a generated 256-pixel XYZ package into local storage, disconnected networking and reloaded. It restored the app, three layers / 60,004 features, and the local basemap. Screenshots were generated for visual inspection. A prior run before compression produced a 66 MB backup and also round-tripped successfully.

Raw local evidence: `tmp/performance/library-final.json`, `.library.png`, isolated source fixtures/downloads and Chrome profiles. Compact evidence is stored alongside this report. Browser profiles are independent of the user's session; the user's explicitly authorized Chrome fallback was used.

A separate `--library --no-cpu` pass in `tmp/performance/library-offline-paint.json` verifies actual restored point painting over the local basemap after offline reload, rather than merely counting layer-list entries. It waits for map painting instead of assuming hydration completion means rendering completion. The generated raster is blue; the check detects the point symbol's orange fill (96 matching pixels in the recorded run), and the screenshot shows the dense restored point block. This confirms sampled visible rendering, not all-feature pixel coverage. The last active-pointer fallback change was subsequently covered by its focused integration test and the final full validation commands.

## Limits and remaining work

- This is a local library, not cloud sync, cross-device synchronization or a database server. Browser-origin/profile changes require explicit backup transfer. Clearing site data can remove all local records.
- Only completed database commits are durable. An immediate forced reload during a pending debounced save can lose the uncommitted edit; the save-state indicator and beforeunload guard make this visible. Sudden process/power failure cannot promise the latest unsaved edit.
- Offline application caching is production-only. Offline basemaps currently accept a documented local XYZ ZIP; area selection/download/size estimation from an online provider is not implemented. No provider credentials or compliant downloadable service was supplied. Online styles, remote label glyphs and global DEM terrain are outside this offline package format.
- Local source files from legacy sessions cannot be reconstructed if only their parsed features were stored. New imports preserve original files.
- Recovery is bounded to five committed versions, not an unlimited change/Undo history. Project cards show name/counts/time rather than generated thumbnails.
- Storage failure, stale-writer rejection and rollback are integration-tested with fake-indexeddb. The full live browser quota-exhaustion scenario and a separate-tab conflict UI scenario were not claimed.
- No matched performance A/B against the prior storage implementation is claimed. Unit evidence proves metadata/chunk-write behavior; the final full 60k import sampled a 329 ms maximum long task, so universal sub-250 ms responsiveness remains unresolved. Large backup JSON/compression work can still consume memory and should receive a later worker/streaming pass for larger libraries.
- Nullable-geometry typing and the earlier repository-wide audit remain explicitly unresolved. Passing sampled runtime flows is not proof of complete type safety or exhaustive review.

Usage and package format: `docs/PROJECT-LIBRARY.md`.
