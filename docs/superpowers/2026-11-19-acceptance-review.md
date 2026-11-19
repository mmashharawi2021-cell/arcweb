# Production acceptance review - 2026-11-19

Baseline: `main` at `8f525b0`. Reviewed the production bundle in an isolated Chrome profile and a separate loopback origin, without changing the user's current browser projects.

## Finding and fix

**Important: View > Attribute Table closed the existing table instead of opening the selected layer's table.**

Trigger: keep the imported input table open, run Buffer, select its output, then choose View > Attribute Table. The old handler toggled the global table visibility off. It now opens the current layer's table and restores a minimized table dock, retaining the original table tab.

The acceptance script exercises this exact transition and requires two table tabs to remain open.

## Passed workflow

1. Open a real version-1 project file with optional modern fields absent.
2. Import a real GeoJSON file alongside its legacy layer.
3. Select matching records through Select By Attributes.
4. Run Buffer through the worker; add its output layer.
5. Open the output's attribute table while retaining the input's table.
6. Edit an attribute, save edits and wait for a committed local save.
7. Create the Classic layout through Insert > New Layout.
8. Download nonempty PNG and PDF files using the browser's normal download mechanism.
9. Verify all three layers are committed to IndexedDB.
10. Check for uncaught runtime exceptions.
11. Close the entire browser process and launch a fresh process with the same isolated profile and origin.
12. Compare the reopened layer hashes, project identity, edited value and layout to the committed snapshot; check again for runtime exceptions.

**Result: 15 assertions passed across the workflow and cold restart.** The automated suite remains **613 tests passed**, with production build, TypeScript and lint passing. The exported PNG was visually inspected; a PDF was generated and downloaded (its page rendering was not separately inspected).

Artifacts, fixtures, profiles, downloads and machine-readable results are local under `tmp/acceptance/` and are ignored by Git. Reproduction uses `scripts/qa/acceptance-browser.mjs`:

```powershell
npm.cmd run build
$env:ARCWEB_QA_PROFILE = "$pwd/tmp/acceptance/fresh-profile"
$env:ARCWEB_QA_PORT = '5198'
node scripts/qa/acceptance-browser.mjs dist tmp/acceptance/run.json
node scripts/qa/acceptance-browser.mjs dist tmp/acceptance/reopen.json --verify
```

Use a fresh profile directory for the first command, then the same profile and port for `--verify`. The script starts and stops its own static production server and headless browser. It does not clear any existing browser database. This acceptance flow supplements the earlier both-theme viewport matrix; it is not a security or exhaustive performance audit.
