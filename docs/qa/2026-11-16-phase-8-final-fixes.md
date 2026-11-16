# Phase 8 — interrupted final fix wave resumed

Status: **final code fixes verified, with browser/performance limitations**.

## Exact handoff point

The nine implementation/QA tasks had already been completed and reviewed. The whole-branch review requested three final fixes. When Claude reached its usage limit, two had committed:

| Finding | Handoff status | Verification in this continuation |
| --- | --- | --- |
| F3: stale tool output overwrites newer edits | `396565a` | Reviewed the pure helper and App guard; existing four regression tests pass. Guard rejects all updates, output layers and downloads when an updated layer changed or disappeared. |
| F1: Selection dialogs leave initial focus behind the modal | `be1cdea` | Reviewed first-control autofocus and opener capture order; independent review confirms source fix. Fresh live-browser verification unavailable. |
| F2: tool success/error messages omit bidi isolation around user names | Not implemented at handoff | Completed here across 103 production toolbox files; eight new real-tool regression cases pass. |

The current branch remains `phase-8-stabilization`. No merge, push, dependency upgrade, project-format change or next-phase feature is part of this continuation.

## F2 implementation

Applied the existing `isolate` helper to user-derived layer, output, field, sheet and download names in messages and thrown errors. User field-name lists isolate each entry individually. Renamed DBF field warnings isolate the displayed source and destination names.

Only display text changes. Layer names passed to `outputLayer`, stored attribute keys/values, actual download filenames, GeoJSON and DBF contents retain their original values. Fixed English, numeric output, built-in CRS metadata and tool names remain unwrapped. `Shape` in identical-geometry comparisons and generated `AREA`/`LENGTH`/`PNT_COUNT` labels explicitly remain fixed, unwrapped text.

Eight new cases in `src/toolboxes/__tests__/bidiMessages.test.ts` cover:

- Buffer's Arabic output name and unchanged output data.
- Alter Field's feedback, raw renamed property keys and thrown missing-name errors.
- XY field names and independent field-list entries in errors, retaining fixed `X`.
- Export feedback versus actual raw filename and downloaded properties.
- Find/Delete Identical: isolate real field names and leave `Shape` unwrapped (two cases).
- Tabulate Intersection: leave its generated measurement label unwrapped.

The first five cases failed before implementation and passed afterward. Independent review found two fixed-token over-isolations in the initial sweep; three added cases reproduced them before correction and then passed. No pre-existing exact-message assertions were weakened or updated; they continued to pass unchanged.

## Sweep measurements

Using the same line filter on HEAD and the working tree, excluding tests:

- `message: ` template lines with interpolations and **no** `isolate` on that line: **110 → 5**.
- `throw new Error(` template lines with interpolations and **no** `isolate` on that line: **120 → 86**.

These are search counts, not counts of defects. The five remaining message lines contain registered CRS metadata or geocoding progress counts. Remaining error lines include fixed parameter labels, enums, numbers and raw invalid-value/parser diagnostics; the name-specific sites were reviewed separately using a parsed-template inventory. A line with one `isolate` can still contain another unisolated interpolation, so grep counts alone were not treated as proof of completeness.

Original working-tree line-ending styles were preserved across modified source files; no mixed line endings or unrelated reformatting were introduced. `git diff --check` passes.

## Final checks

From `C:\Users\mozar\Desktop\VS\arcweb`:

| Command | Result |
| --- | --- |
| `node_modules\.bin\tsc.cmd -b` | Exit 0, no diagnostics. |
| `npm.cmd run lint` | Exit 0, no diagnostics. |
| `npm.cmd test` | Exit 0, **39 test files / 341 tests passed**. |
| `npm.cmd run build` | Exit 0; 3,035 modules transformed, separate import/tool worker chunks produced. |

An independent read-only reviewer inspected F1/F3 and the F2 diff. No Critical/Important findings remained; the fixed-token corrections are covered by the final tests.

## Deliberately outstanding

- R17/R18 from Claude's controller ledger still stand: same-metric A/B profiling and the 60k-point import/tool main-thread stalls belong to the deferred performance phase. The recorded 1.56–2.24 s import tail and 290–334 ms worker-tool stalls have **not** been fixed or remeasured here.
- The application-wide nullable-geometry typing change remains separate; centralizing casts in `geojson.ts` does not complete it.
- Fresh browser RTL/focus checks are not claimed. The browser helper returned `Computer Use native pipe is unavailable ... os error 2`. Source/unit verification is not a substitute for live focus restoration, visual text ordering or performance measurement.
- Earlier deferred QA-document polish and other minor ledger observations were not expanded into additional feature work.

Implementation can be reviewed on the existing branch; Phase 9/Catalog has not started. The older audit coverage manifest describes the earlier snapshot and should not be read as current coverage of the new Phase 8 files.
