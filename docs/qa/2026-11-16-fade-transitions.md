# Lightweight fade transitions

Implemented on top of the existing motion pass, without additional dependencies or changes to component props, GIS actions, store state, or the existing interactive DOM hierarchy.

- All enabled application buttons receive 150 ms opacity feedback on hover/press/release. Existing focus outlines and disabled appearance remain.
- Tooltips fade in after a short hover/focus delay and fade out immediately on leaving.
- Newly mounted panels, ribbon tool groups and modal content fade in over 200 ms. Map canvases and virtualized table rows are excluded from content fades.
- Selection dialogs, Map Properties, project-replacement/removal confirmations, context menus, bookmarks, identify popups and toasts fade out over 180 ms when removed.

Exit behavior uses a short-lived decorative DOM copy, rather than delaying React unmounting. Original event listeners are cleaned up normally; commands and focus restoration happen immediately. The copy is inert, aria-hidden, pointer-transparent, stripped of IDs/live roles/autofocus, and removed on animation completion with a 240 ms fallback. At most four copies can coexist during rapid interaction. StrictMode detach/reattach is ignored after checking the committed node connection. Reduced motion and browsers without native Web Animations skip exit copies.

The original interactive structure stays intact; decorative exit copies temporarily exist under document.body. Exit motion uses native Web Animations with opacity only, and entry/interaction motion uses CSS. No new permanent will-change hints or scroll listeners are added.

Validation commands:

```powershell
node_modules\.bin\tsc.cmd -b
npm.cmd run lint
npm.cmd test
npm.cmd run build
node scripts/qa/profile-browser.mjs dist tmp/performance/fade-qa-final.json --motion --fade --qa --no-cpu
```

TypeScript, lint and production build pass; 43 test files / 351 tests pass. Production Chrome verifies exit copies for both Selection dialogs and Map Properties, cleanup, immediate focus restoration, reveal cleanup, reduced-motion rendering and the existing save/reopen/edit/cancel/export workflows. The final browser pass additionally exercises rapid reopen/close and the alternate theme with reduced motion. Local JSON/screenshot evidence is under ignored tmp/performance.

This is sampled runtime coverage, not a pixel-by-pixel verification of every button or a device-independent 60 fps guarantee. State changes inside an already-mounted component do not automatically replay its entry animation, which avoids fading continuously during typing, GIS updates or table scrolling.

## Follow-up: make navigation motion visible

User feedback found the initial effects too subtle. The original 6% hover opacity change was hard to notice, and mount-only CSS entry animation did not replay when React reused ribbon nodes between tabs. Added `useContentFade(activeTab)` to explicitly animate the existing ribbon and side-panel content on tab changes: opacity 0.3 to 1 with 5 px translation over 300 ms, without changing keys or remounting components. Typing, GIS updates and table scrolling do not trigger it. Enabled-button hover/press opacity is now 0.84/0.72 over 200 ms. Panel entry fades use 300 ms.

The navigation hook cancels superseded animations, cleans up on unmount and cancels immediately when reduced-motion preference is enabled. System reduced-motion remains respected, rather than silently overridden. The browser test temporarily emulates normal motion solely to verify animation replay on the same ribbon node through Analysis/Map/Layout/Map; it also checks cancellation under reduced motion. Evidence: `tmp/performance/navigation-motion.json`, produced with `--navigation-motion --motion --fade --qa --no-cpu`.
