# Local release checklist

## 0.3.2 release gates

- [x] Package version, desktop shortcut and all displayed filenames are 0.3.2.
- [x] Compact CEP panel payload is re-signed after the 48×48/40×40 update; installed Adobe verification passes and the existing library hash is unchanged.
- [x] Type-scoped top category navigation passes ordinary/effect/audio root, child drill-down, parent return and scoped child creation. Existing legacy categories remain readable; favorites reuse original category paths and liked view has no category bar.
- [x] Import dialog can create a top-level folder, select an existing compatible folder, and create a child folder under the selected folder. The destination is validated by core and duplicate assets preserve their old category when no destination is chosen.
- [x] The filter menu hides assets already assigned to descendants of the current folder; typed roots keep only unclassified assets, while all/favorites/liked views disable the option. Selection is cleared when the filter changes.
- [x] Import UI passes optional 256/512/1024/2048 (2K) preview longest-edge selection, sidecar reuse, and audio omission of the FLA preview control. Effect GIF budget/static fallback remains bounded.
- [x] Window-mode tests pass blur, maximize, fullscreen and minimize topmost cancellation plus bounds restore. Real Animate taskbar hover is a manual gate; it must not be described as complete from helper tests alone.
- [x] User manually confirmed ordinary cross-window drag to the Animate stage can complete paste with the signed panel.
- [x] Final full regression, packaged UI/import/media, portable smoke, release byte audit, archive hashes and desktop shortcut target are rerun after the last signed build.

Final 0.3.2 evidence: static 234/234; source category-depth UI 11/11 and filter UI 6/6 (packaged checks rerun after final build); packaged UI 22/22, import 8/8, media 7/7, window mode 3/3, stage gesture 5/5; portable CDP smoke 5/5; page errors 0; current `verify-release.cjs` passed; production audit reports 0 known vulnerabilities. The delivery archive includes the favorite-category screenshot, filter screenshot and current source. Direct Playwright attachment to the portable launcher timed out, so the portable result uses its real EXE plus CDP path.

## 0.3.1 final gates

- [x] Final package rebuilt after performance/safety changes; release verification passed for 63 ASAR files and 10 external plugin files.
- [x] Full regression 193/193; packaged portable5/5, import8/8 and panel6/6.
- [x] Unchanged UI sync returns a version token without full snapshot cloning; hidden-window polling is slower and active work polling remains responsive.
- [x] Large-library grid mounts 60 cards per page; full-library search and three material types pass the isolated 183-item Electron acceptance.
- [x] Stage-drop fail-closed guards cover five-second expiry, document binding, clientArea, process/window changes and receiver capability; rejected gestures do not replace pending transfers.
- [ ] Real cross-application FLA drag into an independent Animate document and audio drag into Jianying/AN: user manual gate remains. Do not describe drag initiation tests as host import success.
- [x] Desktop shortcut `D:\Users\Administrator\Desktop\安安素材管理器.lnk` now targets the final 0.3.1 portable executable; the currently running old manager was left open.

Target: Windows x64, 安安素材管理器 0.3.2. GitHub publication is user-authorized but remains pending account connection and final repository details. Current results and host boundaries live in PROJECT_STATE.md.

- [x] Apache-2.0 base license, `NOTICE`, source attribution headers, and the separate 安屿动画 commercial attribution policy are present. The policy distinguishes free non-commercial use from commercial redistribution and is included in the packaged application.

- [x] Requirement and architecture baselines recorded.
- [x] Originals remain untouched; files and metadata have local backup instructions.
- [x] Core/library, preview queue, UI model and bridge contract tests pass.
- [x] Actual Electron UI journey verified with 1280×800 viewport and screenshots.
- [x] Six demo assets replaced with Animate23-native saved files; final colors, CRC and all six offline previews verified.
- [x] Product makes no HTTP(S) requests; parser fonts stay local.
- [x] Plugin path/hash checks and target restoration tested with simulated Animate DOM.
- [x] Final portable and NSIS outputs after all UI/host/panel updates built; packaged UI22/22, import8/8 and portable direct launch5/5 verified. Full OS installer execution is not covered.
- [x] Final delivery archive contents, both ZIP CRC32 checks, all 13 delivered file SHA256 checks, 43 packaged source files and 8 external plugin files verified.
- [x] Compact single-button AN panel state transitions and minimum-size layout verified; existing CEP installation updated with a backup. Running Animate was not restarted; its menu/name reload waits for the user to save and restart.
- [x] Actual Animate23 insertion, exact playhead normal keys, inherited content, unchanged target layers, center and duplicate reuse verified.
- [ ] Animate24 and complex sound/camera/rig/script compatibility: unverified host/content boundaries.

## 0.3 final gates

- [x] Ordinary/effect/audio import contracts recorded; audio never enters FLA preview processing, category changes do not generate GIF.
- [x] Final suite150/150, no failures or skips, includes old render success/failure commit races reproduced before repair.
- [x] Build and portable/NSIS package succeeded after final core repair. Production audit reports zero known vulnerabilities.
- [x] Packaged UI22 passed before final core-only repair; unchanged UI not redundantly retested. Final packaged import8/media7 passed again after repair, zero page errors.
- [x] Independent audio library plays/seeks real WAV via local streaming; refresh does not interrupt playback. Category pin survives restart, audio type filter remains in categories/favorites.
- [x] GIF/poster decode, visible lightbox frame changes, card hover start/stop, zoom and warm theme verified. Generated animation budget/fallback and independent decoding checked.
- [x] Sidebar scroll, category search/fold/parent paths and same-parent pin order verified in UI/model tests.
- [x] Panel5 and final 0.3 portable EXE5 passed; six decoded demo previews, six columns, warm theme.
- [x] Final55 ASAR files, six demo files, ten external plugin files and four license files match source. Delivery ZIP CRC32 and fifteen payload-file SHA256 verified.
- [x] CEP0.3 runtime re-signed and installed with backup; Adobe tool verifies both clean and installed runtime. No private key delivered, no open user document modified.
- [ ] Actual cross-application audio drag into Jianying/AN and FLA drop into CEP remains unverified; initiation/schema tests do not prove native insertion. Window replacement/minimization/user-input protection prevented this round's host check.
- [ ] Existing live library count differs from disk metadata; preserve its process and files, do not automatically replace or migrate. Source of discrepancy remains unknown, no speculative repair applied.

Delivery: outputs/安安素材管理器-0.3.2, separate from old versions. Reload an already-open AN panel to load the installed 0.3.2 runtime without force-closing Animate. Full installer OS flows and AN2024 remain separate gates.

Rollback: close both applications; restore the full `%APPDATA%\AnShelf` backup; replace the application with the previous build. Remove the CEP extension folder to uninstall the panel. Debug loading is separately reversible as described in plugin/README.md. No automatic target saves or data migration are performed.

Owner: this local project. Next validation environment: a Windows machine with Animate 24.x/CEP 12 and representative user-owned weapon/character files. Test full timeline, nested animation, masks, scene order, duplicates, locked target layers, frame rates and unsaved target before relying on the bridge in production work.
