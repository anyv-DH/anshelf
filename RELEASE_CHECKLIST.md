# Local release checklist

## 0.3.5 流畅导入与旋转预览发布门禁

- [x] `package.json` 版本为 0.3.5；普通/特效导入与失败重试不再调用或启动 AN，显式“用 AN 打开”保持可用。
- [x] 经典旋转补间保留 transformation point；偏心旋转、平移缩放、mask/camera/rig 回归通过。旧预览需手动重新生成。
- [x] 全量回归 256/256，打包版导入 9/9，动画预览 10/10，便携三类导入分类 3/3 与冒烟 5/5，页面错误为 0；`verify-release.cjs` 通过，74 个 ASAR 源文件、6 个演示文件、11 个插件文件与源码一致。
- [x] 安装版、便携版与中文分享包已生成，分享包内含置顶的 `00-请先阅读安装说明`、中文 TXT/HTML 说明、插件和 SHA256 清单；插件签名文件 9 项 digest 保持一致。
- [x] 桌面正常关闭旧管理器并切换到交付的 0.3.5；运行 ASAR 哈希匹配最终构建，261 素材、7 分类、195 都市人物及原库哈希保持不变，最新索引和旧快捷方式已备份，AN 保持运行。
- [x] 源码提交 `b8ca158` 已推送 `main`，`v0.3.5` 标签指向该提交；GitHub 发布已公开并再次确认 latest 为 `v0.3.5`。安装版、便携版、插件、使用说明与校验清单五个附件的大小及 SHA256 digest 与本地一致。
- 发布地址：`https://github.com/anyv-DH/anshelf/releases/tag/v0.3.5`。发布验证和桌面更新记录保存在本地 `outputs/安安素材管理器-0.3.5`，真实素材与私有备份未上传。

## 0.3.4 repair and publication gates

- [x] Failing regression reproduces the UUID name and missing additive category operation; old packaged UI fails the new-action assertion.
- [x] Full 248/248 regressions, isolated new UI 7/7, prior UI 21/21, import 8/8 and category journey 11/11 pass. Deferred process probing cannot keep completed imports busy.
- [x] Live library is backed up; read-only new-version loading preserves all 261 records, 7 categories, 195 urban characters and old undo history.
- [x] Native installation discovery resolves this PC's Animate.exe and correctly detects the existing process. Startup from an absent host is tested with process doubles; the user's Animate remains open.
- [x] Packaged shared-category workflow 7/7, category journey 11/11 and portable ordinary/effect/audio destination checks 3/3 pass without page errors.
- [x] Final source-to-ASAR audit matches 74 files, 6 demos and 11 external plugin files. Exact delivered portable passes destination checks 3/3 and startup/preview/density/theme smoke 5/5. Delivered installer/portable hashes match the build.
- [x] Desktop target points to the exact delivered 0.3.4 portable. A normal launch confirms running version 0.3.4 and both category controls; the live library hash remains unchanged, including all 261 assets and 195 urban characters. The prior shortcut and latest index are backed up; Animate remains running.
- [x] Reviewed source commit 66a6727 and tag v0.3.4 are pushed to anyv-DH/anshelf. The release is public and marked latest; all five uploaded assets match local sizes and SHA256 digests, with installer, portable, plugin, usage guide and checksum file available.
- GitHub publication is explicitly user-authorized on 2026-10-15. Preserve appId/AppData identity, prior packages and independent editable working copies. Exclude user assets and private recovery data from the repository.

## 0.3.3 desktop artifact correction

- The actual 0.3.2 desktop portable was reproduced missing `#import-category`; its ASAR differs from the current source. Historical 0.3.2 source checks do not certify that desktop artifact.
- Rebuild as 0.3.3 and run the packaged category journey plus `scripts/portable-import-destination-e2e.cjs` against the exact delivered copy, using isolated data.
- Verify source-to-ASAR and release-to-delivery byte equality before rewriting the shortcut. Keep appId and the user's existing library unchanged. No remote publication in this update.
- Completed locally: 234/234 unit regressions, packaged category 11/11, packaged filter 6/6, exact delivered portable imports 3/3 with no page errors. Source-byte audit 72 files and copied EXE hashes pass. Desktop shortcut now points to 0.3.3; previous shortcut is backed up.

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
