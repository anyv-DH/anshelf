# Architecture

## 0.3.7 edit managed FLA in place

`openInAnimate` no longer creates `opened/<uuid>` copies. Before the first open, `Library.reconcileManagedFile` renames the existing content-addressed managed file to `assets/<asset-id>/<safe asset name>.fla` on the same volume, so no second FLA payload is written and Animate receives a readable filename. Repeated or concurrent opens target that one file. The external source path recorded at import remains untouched.

AN saves mutate the single managed file. On the next AN open, stage send, or drag preparation, the host recalculates its SHA-256 and persists a changed hash. A changed hash clears stale preview fields and queues a new local preview; stage delivery then uses the new managed bytes. Path moves are same-volume renames and metadata updates are non-undoable because the old bytes are intentionally not retained. Audio remains separate. Existing per-open files created by older releases are left untouched.

Stage paste uses bridge request version 2. The CEP receiver verifies the managed FLA using a 1 MiB streaming SHA-256 buffer and opens `asset.sourceURI` directly; it does not read the full FLA into one Node buffer or create `bridge/temp/*.fla`. It closes the source document with `save=false` after transfer. If that managed source is already open in Animate, insertion stops with an instruction to close it first, preventing changes to a user's active source document. A connected older CEP panel is rejected until its updated, signed package is installed.

## 0.3.6 portable runtime isolation

Set `build.portable.unpackDirName` to boolean `true`, so electron-builder's NSIS portable launcher uses a per-launch `$PLUGINSDIR/app` rather than a build-wide fixed temporary directory. The default launcher removes its extraction directory both before extraction and after exit; a second launch could therefore delete the first instance's worker/runtime files even though Electron's single-instance lock keeps its main window alive. Runtime extraction is isolated from the unchanged persistent library location. `scripts/portable-relaunch-e2e.cjs` exercises the packaged executable, second launch, preview retry and image decoding with an isolated library/profile.

## 0.3.4 contracts

Version-one records retain `categoryId` as the primary category and gain ordered unique `categoryIds`. Reading old records derives their membership in memory without rewriting the index. `assignCategory` and explicit import destinations replace memberships; `addToCategory` preserves them and validates the destination scope. `removeFromCategory` and category deletion remove only that link, promoting the next surviving category when necessary. Atomic history stores both fields; legacy undo entries mentioning only `categoryId` restore the matching single membership. Whole-library counts, category browsing, favorite groups and child-folder hiding match all memberships, while cards and the complete asset count remain unique.

Before 0.3.7, AN-open copies used `opened/<unique directory>/<safe material name>.fla`; 0.3.7 replaces that behavior with direct edits to the single managed FLA described above.

Since 0.3.5, imports and preview retries never probe or launch Animate. The host queues the local worker and returns after metadata/sidecar validation; process discovery is not on that path, even after a failed preview. Main no longer wires an automatic launcher into the host. Explicit `openInAnimate` opens the single named managed FLA through the configured executable or file association. Stage insertion continues to require a running receiver. This supersedes 0.3.4's unconditional background startup behavior.

Classic tween matrix interpolation preserves the symbol-local transformation point in parent space: interpolate its authored endpoint positions, then solve translation after rotation/scale interpolation. All classic consumers (visible symbols, masks, camera sampling and rig-parent matrices) use the same correction. The GIF worker retains its fixed union crop, so authored movement is preserved rather than recentered per frame.

## 0.3.2 contracts

The compact CEP panel uses a 48×48 default content viewport (40×40 minimum) and a single stateful action button. CSS switches from the button icon to readable status text as width permits; this does not assume that Animate will honor a requested outer window size. Desktop window mode owns the always-on-top lifecycle: mini mode records/restores bounds, while blur, maximize, fullscreen, and minimize immediately remove topmost state.

Category navigation is type-scoped. `category-browser` receives the selected sidebar root and current asset type, returns direct children plus a parent path, and never flattens all category roots into the top bar. Creation resolves a child scope from its parent and rejects cross-scope parents. Legacy `all` categories remain visible only when their descendants contain assets in the current type.

The import dialog keeps an optional `importCategoryId`. New top-level and child categories are created through the same validated category mutation, then the new ID is selected before the import resumes. `desktop/host.cjs` forwards the ID to `core/library.cjs`; the core checks that the category exists and its inherited scope matches the import mode. An omitted ID leaves new assets unclassified and does not reclassify duplicates, while an explicit ID applies to both new and duplicate records in the import transaction.

Favorite navigation is derived from the same category metadata: `favoriteCategoryGroups` groups only favorited assets by their direct `categoryId` and displays each existing path (for example, `都市人物 / 女`). The UI does not persist a second favorite taxonomy. A private sentinel represents missing or stale category IDs, and liked assets never render this favorite category bar.

Preview import options carry `previewResolution: null|256|512|1024|2048`. A numeric value is a longest-edge ceiling for newly generated PNG/GIF previews; `null` preserves the default renderer behavior. Existing same-stem sidecars are reused before rendering when the preference is enabled. Effect animation workers enforce frame, pixel, and time budgets and retain a static cover on timeout or oversize input.

The taskbar handoff is a gesture-scoped native helper. It waits for the verified Animate taskbar button, confirms the expected executable/PID, and then requires a renderer handshake before foregrounding Animate. The renderer performs a second mouse, capability, and document check; only then is a five-second stage-drop request created. No idle watcher runs, no arbitrary process is foregrounded, and FLA bytes never enter the native importer.

## 0.3 incremental contracts

Existing version-1 metadata remains readable. Assets gain kind ('fla' or 'audio'), assetType ('ordinary', 'effect', 'audio'), extension and preview metadata. Import takes mode ('ordinary' by default, 'effect', 'audio'); categories do not change assetType. Core validates modes and filters paths, initially stores content-addressed FLA/audio data, and never modifies the external imported source. After a user opens and saves a FLA in AN, its single managed library file becomes editable and its content hash is reconciled on the next open/send/drag. Categories gain pinned:false by default; setCategoryPinned(id, bool) uses the existing undoable atomic mutation.

Host snapshots expose mediaUrl for known audio IDs. Only FLA enters the preview queue and AN send/open APIs. Audio uses a validated internal file descriptor and native startDrag. FLA uses beginStageDrag/endStageDrag/cancelStageDrag: no OS file is exported. Main verifies source window and mouse, CEP capability/current document, then a read-only native subprocess observes release for at most30s. Release to an Animate work area creates a five-second stage-drop request; CEP auto-consumes it once and JSFL verifies the document ID again before touching a timeline. Multiple Animate instances without a bound PID reject. Manual button sends retain confirmation. Legacy CEP marker reception remains for old clients, but new FLA drags never create markers.

Library revision advances only after a successful atomic mutation. host-sync combines revision, next like expiry, preview queue and semantic bridge state, excluding heartbeat timestamps. Unchanged polls return only a version token; UI serializes requests and adapts delays to visible idle(1500ms), hidden(6000ms), or active work(700ms). Pagination mounts at most60 cards after whole-library filtering/sorting, keeping search complete and image/DOM allocations bounded.

Main-process media protocol accepts only known audio IDs and allowed managed paths, supports byte ranges and local streaming. Preview worker returns png plus optional gif and bounded animation metadata. desktop/previews chooses GIF only for effect imports, retains PNG fallback, and caps large/slow animation work. UI has independent preview-viewer and audio-controller lifecycles; closing dialogs disposes listeners, snapshot rendering does not replace a playing audio element. Sidebar layout keeps navigation/footer fixed while category tree scrolls independently.

Ownership for this slice: root owns core/library and desktop/host plus shared documentation; GIF agent owns preview/ and desktop/previews; bridge agent owns desktop/main/preload, native drag/media helpers and plugin; UI agent owns ui/. Final signature regeneration and packaging happen after all signed runtime edits and tests.
Electron-style local desktop app with a vanilla web UI and Node host. JSON metadata + immutable content-addressed assets and cached previews avoid native database dependencies. An upstream local FLA parser/renderer is integrated for offline thumbnails. CEP/JSFL is a separate bridge that receives managed asset requests and inserts full source content into the active Animate document.

## Modules
- core/library.cjs: import, SHA256 deduplication, categories, search, undo, atomic metadata.
- core/bridge.cjs: atomic pending transfer and status under a local app data bridge directory.
- core/preview.cjs: preview queue adapter; sidecar reuse and renderer invocation are isolated.
- desktop/server.cjs: local API and static UI host; never exposes remote binding.
- ui/: Chinese visual library interface.
- plugin/: CEP manifest, panel and guarded JSFL receiver. Whole-file import is implemented as scene/timeline grouping; duplicate symbols use source hash namespace.

Original FLA paths are never modified or moved. Metadata stores managed relative paths. Parser rendering is best-effort for legacy FLA, fonts and complex effects. The app remains useful when Animate is unavailable; send then reports pending.

## 0.2 data/UI slice

Product name is 安安素材管理器; appId and AppData/AnShelf remain stable. Version-1 JSON categories gain optional parentId, normalized to null for roots. Likes store likedAt and derive their visible 24-hour state at read time. Tree validation lives in core; UI mirrors descendant filtering. Theme preference is localStorage, with native background updates via fixed IPC. Frameless titlebar uses three allowlisted window actions. Opening AN resolves known asset IDs to managed FLAs, never renderer-supplied paths/executables. Inspector, classification tools and transfer details are conditional; preview zoom is modal.

Before 0.3.7, opening validated the content-addressed source and copied it to root/opened/UUID/material-name.fla. Current opens rename and use the single managed file directly, and AN saves update the managed content. Insertion uses the exact current playhead on the existing target layer: a hold frame becomes a normal keyframe, inheriting content, then complete source root is appended and visually centered. No blank target keyframe or new target layer.

Grid density is a local UI preference (automatic or 4/5/6 columns). The available content width limits the effective columns so narrow windows and the inspector cannot force card actions outside their bounds. Compact headings bring the first row upwards. The revealInFolder IPC takes an asset ID, resolves an existing absolute source FLA from library metadata, and falls back to a validated managed copy. The renderer never supplies the destination path; Explorer selection is the only side effect.

`visibleAssets` accepts the view-only `hideChildCategories` option. It keeps direct assignments when a real category is selected, keeps only unclassified records at a typed virtual root, and bypasses the option for all, favorites, and daily-like views. The renderer clears selection and pagination anchors when the option changes; no metadata mutation or undo entry is created.

Original-path visibility uses Electron's original-fs rather than its archive-aware fs, so packaged virtual demo files fall back to real library copies. Native paths and every ancestor must be regular files/directories without links; an actual directory named .asar remains a valid original location.

The AnAn wordmark is an original local SVG geometry asset styled through brand.css. It introduces no font dependency or remote request and adapts to the dark/warm theme through local color variables.

## Deployed boundaries

The packaged application uses no HTTP server. Its sandboxed UI calls a fixed IPC method list and reads thumbnails through an anshelf scheme that resolves known asset IDs. HTTP(S) requests are blocked. The optional localhost dev server is only a development helper.

The preview worker reads one managed file in an isolated renderer; 128 MB input ceiling and 45-second timeout limit resource use. A preview revision token changes every successful render/reuse so cached images update after retry. Vendor parser dependencies are bundled in worker.js. Source originals are only read/copied.

The CEP extension is also copied outside app.asar to resources/AnimatePlugin so users can install it. The panel reads the fixed AppData root, validates files up to 512 MB with bounded memory, and invokes a guarded JSFL function with JSON input. Its default content area is compact (about 48×48, minimum 40×40) and exposes one paste button; connection, pending, busy, success and failure are represented by that button, with asset/error details available through its title. It opens the single managed FLA directly, exits nested edit mode into the existing scene, inserts the whole source MovieClip at the target frame, then restores the active target and closes the source without saving. Hash namespaces prevent name collisions and reuse exact file duplicates; cross-file symbol content equivalence is not inferred from names.

The delivered CEP runtime is locally self-signed with Adobe ZXPSignCmd. Its mimetype and META-INF/signatures.xml travel with every plugin copy. install.ps1 is outside the signed runtime file set: it validates declared SHA256 payload digests before staging and replaces the whole extension with rollback, retaining backups outside CEP's extension discovery directory. Default installation does not change registry keys or certificate stores; unsigned source development requires explicit EnableDebug. Any signed runtime edit requires regenerating the signature. No signing private key or password is delivered. Signing works around this machine's observed refusal to load the unsigned extension despite correct CEP11 PlayerDebugMode; the reason that development bypass was not honored is not established.

## 0.3.8 当前文档收件桥接与主动复制

`desktop/document-import.cjs`监听`bridge/document-import/inbox`，只消费固定版本的≤16KiB描述，校验本地FLA、大小、路径链接及有效期，串行调用host.importCurrentDocument，再原子写results回执。插件使用固定JSFL入口，二次确认后保存当前文档，仅等待该次回执期间检查结果。管理器退出关闭watcher。已登记managedPath原位reconcile；相同hash仅补充sourcePaths，保留预览设置，外部新内容走普通导入。

`duplicateInFolder`只接受素材ID，读取最新管理文件、选择原始文件夹或用户指定目标；注入的原生确认框同意后使用COPYFILE_EXCL创建中文递增副本并在Explorer选中。拒绝链接及库内目标，取消无文件写入。复制不改变分类或登记新素材。

`desktop/update-check.cjs`只通过Node HTTPS读取固定的GitHub官方latest-release API，8秒截止、256KiB响应上限；正式数字版本与官方发布URL双重验证。合并并发请求，成功缓存10分钟、失败缓存30秒，不使用轮询。三个受限IPC只允许当前窗口检查版本、打开核验过的官方发布页或固定项目主页。渲染器网络仍被阻断，启动检查开关仅存本机。更新提示不下载安装器，也不上传任何库数据。

`desktop/skin.cjs`只记录用户原生选择的本地文件路径与小型skin.json设置，独立于素材索引；不复制媒体。`anshelf://skin/background?rev=...`仅提供当前已选文件，验证格式、大小、链接、版本令牌及GET/HEAD，采用流式Range响应。`ui/skin.mjs`负责遮罩与动态可见性，视频静音；后台暂停、GIF卸载，卡片继续使用实色底。
