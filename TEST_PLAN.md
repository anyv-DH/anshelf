# Test plan

## 0.3.10 acceptance — pending final verification

Use isolated temporary libraries and public/synthetic AN documents. Do not mutate the private live library or copy its assets into test evidence. The requirements below are checks to run; they are not claims of final success.

### Independent managed copies

- Reproduce the reported 1-card-after-copy failure before repair; after confirmation expect 2 independent IDs, exactly 2 managed payloads total, inherited categories/type/tags/preview settings and no external copy. Favorite and like state reset.
- Cancel after an AN edit: index bytes, paths, payloads, render count and Explorer calls remain unchanged.
- Edit/open/AN re-add/reopen the copy and confirm original bytes/hash/preview/categories are unchanged. Remove and restore either record without hash-based merging.
- Ordinary external reimports still deduplicate; known managed paths retain their independent identity. Unknown same-byte external files must not randomly reuse a copy.
- Exercise concurrent readable names, audio/effect/2K inheritance, preview cache isolation, index-write rollback and Explorer failure after successful registration.
- Electron journey: card/preview/inspector entry points, themed confirmation/cancel, automatic selection in current or fallback category, pagination/sort visibility, file bridge and reopen with zero page errors.

### Themed selection menus and searchable categories

- Verify all five manager selects (import category/resolution, category parent/type and inspector category) in dark/warm themes. Three category menus cover long/same-leaf paths, many categories, empty results and special characters; resolution/type use compact non-search lists preserving option order.
- Search by leaf and parent path; select by mouse and keyboard; Escape/outside click closes cleanly and restores focus. Compatible type scopes remain enforced.
- Synchronize optional-resolution and inherited-type disabled state/value. Reopening dialogs and refreshing the inspector must not duplicate listeners, lose an active popup or discard the trigger focus after commit. Tab/Shift+Tab, Escape, outside click, scroll, resize and dialog close must leave no orphan menu. No picker idle polling, observers or persistent DOM growth.

### AN current-document import settings

- Before save, expose ordinary/effect, searchable compatible categories, default/256/512/1024/2048 preview and same-stem reuse. CEP category and resolution menus must both use panel-themed buttons/options, support keyboard and avoid native select lists. Test new external FLA, registered managed FLA, independent copies and duplicate external bytes.
- Cancel, Escape, native save cancellation and document switching must not submit an import or save a different document. Existing memberships survive; no-option legacy requests preserve defaults and prior settings.
- Reject extra option fields, wrong types, unsupported resolutions, missing/cross-scope categories, stale descriptors and malformed requests with bounded Chinese errors; do not leave a half-configured record.
- Verify narrow floating resize/restore and docked resize refusal/no-op fallback. The fallback uses legacy native confirmation without new options. VM/browser acceptance is separate from actual CEP-in-AN behavior.
- Re-sign after the final plugin edit; verify the manifest and runtime as 0.3.10, in-app installer status, signed-byte equality and installed Adobe verification. Reopen the panel to load the new code.

Final full-suite counts, build, packaged journeys, source-byte/signature audits, exact portable smoke, desktop shortcut and GitHub publication remain **pending**. Record results only after the final source change. Real updated AN 2023/2024 full-flow and taskbar handoff acceptance remain independent host gates.

## 0.3.9 reliability, scoped removal and explicit update acceptance

Use isolated temporary libraries throughout. `tests/managed-file-alias.test.cjs` first reproduced two ENOENT failures on Windows: slash/backslash metadata and case aliases removed the single FLA after reconciliation. Require no payload rename/removal for aliases, continued readability after reopen, latest saved hash/preview refresh, real two-file same-content convergence and differing-content refusal. `tests/managed-category-repro.test.cjs` covers legacy whole-record undo, shared-category opens, remove/reimport/undo identity merging and preserved saved bytes/previews/history. `tests/managed-file-recovery.test.cjs` and `tests/managed-recovery-host.test.cjs` cover bounded same-ID recovery, changed saved content, conflicting candidates, links and original preservation. No private-library repair is an automated test fixture.

`ui/removal.test.mjs` and `tests/category-removal.test.cjs` verify category-subtree removal preserves memberships outside the tree, uncategorized fallback, explicit global removal, stale selection and atomic undo. Run `scripts/category-removal-e2e.cjs` on the final executable to check actual button wording, scoped/global confirmation, cancellation, undo and reopen. `ui/confirmation.test.mjs` and `tests/confirmation-broker.test.cjs` cover safe text, focus/Escape behavior, request/sender binding, concurrent prompts and window close. `scripts/confirmation-ui-e2e.cjs` verifies themed copy/deletion confirmations with real Electron; cancellation must leave file/index/preview counts unchanged.

`tests/panel.test.cjs` and `tests/document-import.test.cjs` cover themed confirmation, temporary resize/restore, resize rejection/no-op native fallback and a fixed JSFL Document.id check before saving. `scripts/panel-e2e.cjs` exercises 40×80, 48×88, 180×120 and 320×160, two vertical actions, tooltip/accessibility, no clipping/scrolling, manual/stage insertion states, native save cancellation, readable theme confirmation at 280×200 and 340×230, cancel/Escape/acceptance and clean browser errors. Current directed results are 22 unit/integration cases plus 13 browser groups, not a live AN claim.

`tests/plugin-update.test.cjs` exercises software-bundled versus installed version status, fixed local signed source, failures and safe existing-install replacement. Existing PowerShell signed-install regressions remain required after re-signing. Run `scripts/plugin-update-ui-e2e.cjs` to check cancellation in both connection/update dialogs, version states, errors and completion/reopen guidance. Reject other webContents and never close/save/restart Animate automatically. Verify the installed runtime with Adobe's signing tool separately from the source wrapper.

`tests/update-download.test.cjs` covers the fixed release/tag/asset relationship, bounded HTTPS hosts/redirects, identity encoding, exact length and digest, streaming/partial writes, timeout/cancellation, links and partial-file cleanup. `tests/update-service.test.cjs` covers detected installed/portable mode, higher-version guard, launch/reveal only after verified download, launch-time hash recheck and exit cancellation. Run `scripts/update-download-ui-e2e.cjs` with controlled official-shape metadata and inert launch callbacks to check download/launch confirmations, progress across dialog reopen, cancellation, retry, both launch labels and no renderer-provided paths; do not install a fake public version. Startup checks alone must never download or launch. The installer helper and portable handoff require final packaged tests; keep previous EXE/shortcut and use persistent `%APPDATA%\AnShelfUpdates`, retaining the same library.

Do not replace native acceptance with VM/browser halves: 0.3.9's complete updated CEP-to-manager/stage flow, taskbar hover and Animate 2024 remain manual boundaries. Use independent public/synthetic test documents, never an active user work document. Record final full-suite counts, package hashes and signature evidence only after the last source change.

## 0.3.8 confirmations, current-document import, updates and skins

`tests/duplicate-file.test.cjs` uses real temporary files to check latest saved content, readable collision-safe names, audio extensions, invalid directories, links and confirmation cancellation. The cancellation regression edits the managed FLA first, then checks the entire index, preview count, files and Explorer callback remain unchanged. `tests/document-import.test.cjs` exercises event-driven inbox processing, duplicate-content settings preservation, registered managed-file updates, invalid requests, missing sources/dependencies, receipts and close behavior.

`tests/update-check.test.cjs` checks numeric stable version comparison, fixed official release URLs, concurrent request sharing/cache, offline handling, shutdown cancellation and sender-checked official links. `tests/skin.test.cjs` checks original-file references, tiny persisted settings, cancellation/reset, allowed formats/sizes, links, missing files and streaming Range/HEAD responses.

Run `scripts/new-actions-e2e.cjs`, `scripts/update-ui-e2e.cjs` and `scripts/skin-ui-e2e.cjs` against the final unpacked executable via `ANSHELF_UI_EXECUTABLE`. The skin journey decodes real PNG, GIF and WebM fixtures and actually minimizes/restores the window and changes focus to prove dynamic playback stops. The update journey supplies release metadata through a test-only IPC replacement and verifies the Chinese guide, author/project link, automatic-check preference and offline search. It does not create a fake public release. Normal GitHub checking is also verified separately against the fixed public endpoint.

Actual Animate 2023 verification covers the fixed JSFL current-document confirmation/save: cancel leaves the saved file unchanged; confirm persists the new element. Browser CEP and Electron inbox journeys cover their respective halves. These are not an assertion that the entire new CEP-button-to-manager chain has been verified in one live AN session, nor an Animate 2024 verification. Existing stage insertion remains a separate host acceptance boundary.

## 0.3.7 single-file editing and no-copy stage delivery

`tests/host.test.cjs` verifies open, save, reopen, restart, preview refresh and subsequent send all use the same managed FLA path; no per-open file is created. `tests/bridge.test.cjs` verifies version-2 requests hash the source in 1 MiB chunks, never read the FLA as a single Buffer, create no `bridge/temp` file, and reject an older connected CEP panel. The receiver removes stale version-1 requests. JSFL contract tests verify direct managed-source opening, reject a source already open in Animate before document mutation, close an opened source with `save=false`, and preserve target frame/layers. These automated tests do not replace a manual Animate 2023/2024 insertion check with the re-signed 0.3.7 panel.

## 0.3.5 regressions

`tests/import-startup-responsiveness.test.cjs` and `tests/host.test.cjs` require small imports, ordinary/effect preview queues, slow external startup, failed render and retry to complete without any automatic Animate startup. Four assertions first failed against 0.3.4. A gated renderer verifies import returns while preview work remains pending; explicit named managed-file open still invokes the native callback. Startup is now removed from the import path rather than moved to another background task.

`tests/preview-pivot.test.cjs` exercises the real bundled renderer with a nonzero transformation point and three-turn classic spin. It checks stable center, rotation, preserved movement/scale, mask/camera/rig parity and origin-pivot behavior. Synthetic fixtures are public; the user's source FLA is only read in private test output. Real Electron worker/GIF decode checks supplement affine geometry; no claim of universal parity for scripts, fonts or every FLA.

## 0.3.4 regressions

Before 0.3.7, `tests/host.test.cjs` caught the original UUID basename and checked meaningful Windows-safe names in unique working directories. Those working copies are superseded by 0.3.7's direct managed-file open and persistence checks above. The old pending-FLA startup requirement is superseded by 0.3.5 above. `tests/animate-launcher.test.cjs` retains tests for the standalone helper; it is no longer connected to imports. The user's open Animate is never closed to simulate a missing host.

`tests/library.test.cjs` and `ui/multi-category.test.mjs` cover shared memberships, idempotent addition, scope validation, invalid-batch rollback, remove-one-link, category deletion/promotion, undo, reimport semantics, legacy v1 history, restart, unique counts, favorite groups and child-folder filtering.

0.3.4 originally used a background startup task to avoid waiting for process discovery. User reports showed that task could still launch AN after a small import had finished; 0.3.5 removes it altogether.

`scripts/multi-category-ui-e2e.cjs` runs real Electron/main/preload/worker in an isolated library/profile, imports a real AN-saved demo, decodes its preview, clicks the new add action, checks both category trees and favorites, removes one link and undoes it, verifies AN receives the single named managed FLA rather than a per-open copy, then restarts. The actual previous 0.3.3 binary fails its new-button assertion (`test-output/multi-before/result.json`). AN file-open is intercepted, so this is callback/path evidence rather than a claim about the visible native AN tab. Repeat on the final packaged binary with `ANSHELF_UI_EXECUTABLE`.
0.3.3 packaging regression: `scripts/portable-import-destination-e2e.cjs` launches the exact delivered portable executable with isolated data/profile directories. It asserts that ordinary, effect and audio imports visibly offer a destination, then creates a root folder, reselects it and creates a child. The original desktop 0.3.2 artifact fails on the missing ordinary destination selector. Run this against the delivered copy after packaging, in addition to `verify-release.cjs` and the packaged category import journey; source-only tests cannot prove delivered functionality.

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

`scripts/ui-e2e.cjs` uses ANSHELF_UI_EXECUTABLE for the packaged UI journey and isolated library/profile directories. It checks compact header placement, exact 4/5/6 columns, reduced columns in small windows/inspector, saved density, themed original logo, and file-location callbacks including missing-original fallback. Explorer selection and AN file-open callbacks are replaced during UI tests; real path resolution and original preservation are separately checked in host tests. The current `scripts/panel-e2e.cjs` checks two vertical CEP actions at 40×80/48×88 and widened viewports; its 0.3.2 predecessor checked one-button 40×40/48×48 geometry. It does not restart the open Animate application.

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
