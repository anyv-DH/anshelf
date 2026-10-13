# Test plan
0.3.2 addendum: the following checks are required after the compact panel and typed category changes land.

- Category UI: with the ordinary, effect and audio sidebar roots selected, assert that the top bar contains only direct children of the selected root; click a child, assert the next level and breadcrumb, return to the parent, create a scoped child, restart, and verify scope/pinned order persists. A root with no children shows the empty state and add-child action.
- Import destinations: in an isolated library, create a top-level folder from the import dialog, create a child under the selected folder, select an existing compatible folder, import a real fixture into it, and verify duplicate imports preserve their old category when no destination is chosen. Reject missing, cross-scope and malformed category IDs atomically.
- Child-category filter: in a direct category view, hide descendant-assigned assets while retaining direct assets; in typed roots retain only unclassified assets; disable the option for all, favorites and daily likes. Toggling the option must clear stale selection and not create an undo record.
- Preview resolution: import isolated static fixtures at 256, 512, 1024 and 2048 and inspect the generated longest edge. Confirm the option is opt-in, existing same-stem sidecars are reused when enabled, and audio imports do not enqueue preview work. Exercise a large effect GIF and confirm bounded frames/pixels/time with a static fallback.
- Compact panel/window: run the browser panel at 40×40, 48×48 and a widened viewport, checking icon/status transition, no scrollbars, tooltip, and accessibility label. In Electron, assert mini-mode topmost clears on blur/maximize/fullscreen/minimize and prior bounds restore on exit.
- Native drag: unit and helper tests must cover exact Animate taskbar AutomationId/PID, renderer handoff confirmation, stale pointer/document/capability rejection, cancellation and no idle watcher. A separate manual empty-AN test is required for taskbar hover; the user's ordinary cross-window stage drag is recorded as passed evidence.
0.3.1 final addendum: final full regression is **193/193** with no skipped tests. Packaged acceptance completed with portable5/5, import8/8 and panel6/6. Release verification covers 63 ASAR files and 10 external plugin files; the CEP runtime was re-signed and verified in the installed runtime directory.

Performance checks use isolated temporary libraries and never touch the user's live library. `scripts/sync-benchmark.cjs` compares real host `snapshot` and unchanged `sync` calls: at 10,000 synthetic records, full snapshots serialize about 5.317 MB per call while unchanged sync returns about 115 bytes. `scripts/idle-profile.cjs` samples the app's process group after warm-up; its CPU and memory values are diagnostic comparisons, not a promise about Task Manager's private working-set column. Pagination acceptance mounts 60 cards per page while searching the full result set and covers 183 records across ordinary, effect and audio views.

Native stage-drop guards are tested for stale/expired tokens, wrong window or document, client-area exit, missing document, changed process and unavailable receiver capability. These tests prove fail-closed behavior and pending preservation. They do not prove that a real drag enters another application. The remaining manual gate is an independent empty Animate document with a managed FLA dragged to the signed CEP panel; audio drag into Jianying/AN also remains a separate host check.

0.3 final baseline: `node --test tests/*.test.cjs ui/*.test.mjs` passes 150/150 with no skips. The final log is `test-output/v0.3-final-tests.log`.
node:test covers import, deduplication, preview preference, hierarchy/undo/persistence, 24h likes, favorites/search, bridge atomic state, managed-file opening and frameless IPC. UI verifies zoom, conditional inspector/classification, themes and menus as well as import/send. JSFL contract tests complement native AN2023 tests; AN2024 and complex media/rig/script behavior remain separate gates.

## Reproducible checks

```powershell
pnpm test
pnpm build
node scripts/e2e.cjs
node scripts/ui-e2e.cjs
node scripts/import-e2e.cjs
node scripts/preview-resolution-e2e.cjs
node scripts/category-ui-e2e.cjs
node scripts/panel-e2e.cjs
node scripts/portable-smoke.cjs
pnpm run package
node scripts/verify-release.cjs
pnpm audit --prod
```

E2E requires Playwright (ANSHELF_PLAYWRIGHT or NODE_PATH). Tests use native AN-saved demo files in isolated temporary libraries. For compiled checks set ANSHELF_EXECUTABLE to release/win-unpacked/安安素材管理器.exe. Picker return values are stubbed, but controls, IPC, native image decoding and offline worker run.

`scripts/ui-e2e.cjs` uses ANSHELF_UI_EXECUTABLE for the packaged UI journey and isolated library/profile directories. It checks compact header placement, exact 4/5/6 columns, reduced columns in small windows/inspector, saved density, themed original logo, and file-location callbacks including missing-original fallback. Explorer selection and AN file-open callbacks are replaced during UI tests; real path resolution and original preservation are separately checked in host tests. `scripts/panel-e2e.cjs` checks the one-button CEP states at compact 40×40/48×48 and widened viewports without scrolling; it does not restart the open Animate application.

`scripts/portable-smoke.cjs` launches the final portable NSIS executable directly into an isolated library/profile. It attaches only to its test renderer via a temporary local CDP port, verifies startup, logo, demo previews, density and theme, and closes its own application. The normal product launch has no debugging port. Packaged virtual demo locations must fall back to real managed copies; host regression tests also verify an actual directory named .asar remains usable.

Native evidence: work/native-animate/current-frame-result.json reports exact frames 49/99 (UI50/100), unchanged two layers/current layer1, normal keyframe starts, inherited objects, duplicate reuse, centered selection, 47 editable shapes and saved:true with original target restored. Three representative real FLAs and one complete CEP chain also passed. AN24 remains untested.

CEP signed-install regressions: tests/plugin-install.test.cjs executes real Windows PowerShell in isolated APPDATA directories, verifies exact signed runtime bytes and recoverable backups outside extensions, rejects incomplete signatures/tampered payload/invalid digest references, injects copying and final-rename failures, and checks preserved installations/libraries and link rejection. Development-registry tests use doubles. Adobe ZXPSignCmd must separately verify the 9-file installed runtime directory; the source plugin directory additionally contains unsigned install.ps1, so verify the installed/staged runtime rather than that source wrapper. No private key enters the package. Live AN2023 loading now shows the compact paste button and the manager reports connected; native stage insertion success was also observed after the user's own paste.

## 0.3 media and category checks

- `scripts/media-ui-e2e.cjs`: isolated UI fixture checks independent import entries, audio controller lifecycle, category scrolling/filter/collapse/pin, type scope, GIF hover/poster and mouse-anchored zoom. 11/11 passed.
- `scripts/media-integration-e2e.cjs`: real main/preload/core/protocol, three import modes, decoded sidecar GIF and PNG poster, visible GIF frame changes, WAV playback/seek/reconcile, filtered classification and pin restart. Source and packaged each passed 7/7. Set `ANSHELF_EXECUTABLE` for the packaged run. GIF frame screenshots clip the page without scrolling the hovered card; static theme screenshots disable CSS transitions.
- `scripts/animated-preview-e2e.cjs`: real hidden Electron worker renders nested and timeline animation with bounded output. 10 checks passed; Pillow separately decoded three GIFs for frames/transparency/timing/motion.
- `scripts/native-media-probe.cjs` and `scripts/gif-poster-probe.cjs`: Electron local streaming and GIF decoder, 5 and 4 checks passed.
- Preview-race regressions cover ordinary/effect switches while active, delayed sidecar callbacks and immutable revision cache files. `tests/review-render-race.test.cjs` first reproduced two failures between stale checks and queued mutation commits; success/failure now both guard the actual atomic commit, including null legacy revisions. Audio imports never invoke the preview renderer.
- Final packaged UI22/import8/media7 and panel5/portable5 passed. All profiles and libraries are isolated. Pickers are stubbed; audio playback and GIF decoding are real. Drag initiation/validation tests are not evidence of successful insertion into another application.

Native drag acceptance remains separate: create independent empty AN and Jianying test documents, drag a synthetic WAV and managed FLA marker, inspect actual host media/stage result, and preserve user projects. This round could not complete the cross-window UI check because of window replacement/minimization/user-input protection. No claim of native drag success is made. Existing click-to-paste AN insertion retains its earlier native verification.
