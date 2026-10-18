# Architecture

## 0.3.6 portable runtime isolation

Set `build.portable.unpackDirName` to boolean `true`, so electron-builder's NSIS portable launcher uses a per-launch `$PLUGINSDIR/app` rather than a build-wide fixed temporary directory. The default launcher removes its extraction directory both before extraction and after exit; a second launch could therefore delete the first instance's worker/runtime files even though Electron's single-instance lock keeps its main window alive. Runtime extraction is isolated from the unchanged persistent library location. `scripts/portable-relaunch-e2e.cjs` exercises the packaged executable, second launch, preview retry and image decoding with an isolated library/profile.

## 0.3.4 contracts

Version-one records retain `categoryId` as the primary category and gain ordered unique `categoryIds`. Reading old records derives their membership in memory without rewriting the index. `assignCategory` and explicit import destinations replace memberships; `addToCategory` preserves them and validates the destination scope. `removeFromCategory` and category deletion remove only that link, promoting the next surviving category when necessary. Atomic history stores both fields; legacy undo entries mentioning only `categoryId` restore the matching single membership. Whole-library counts, category browsing, favorite groups and child-folder hiding match all memberships, while cards and the complete asset count remain unique.

AN-open working copies use `opened/<unique directory>/<safe material name>.fla`. The directory is validated inside the canonical library root; COPYFILE_EXCL and a fresh directory isolate simultaneous opens and saved user work. Names retain Unicode, with Windows reserved characters/names and trailing dots normalized.

Since 0.3.5, imports and preview retries never probe or launch Animate. The host queues the local worker and returns after metadata/sidecar validation; process discovery is not on that path, even after a failed preview. Main no longer wires an automatic launcher into the host. Explicit `openInAnimate` still creates a named isolated working copy and opens it through the configured executable or file association. Stage insertion continues to require a running receiver. This supersedes 0.3.4's unconditional background startup behavior.

Classic tween matrix interpolation preserves the symbol-local transformation point in parent space: interpolate its authored endpoint positions, then solve translation after rotation/scale interpolation. All classic consumers (visible symbols, masks, camera sampling and rig-parent matrices) use the same correction. The GIF worker retains its fixed union crop, so authored movement is preserved rather than recentered per frame.

## 0.3.2 contracts

The compact CEP panel uses a 48×48 default content viewport (40×40 minimum) and a single stateful action button. CSS switches from the button icon to readable status text as width permits; this does not assume that Animate will honor a requested outer window size. Desktop window mode owns the always-on-top lifecycle: mini mode records/restores bounds, while blur, maximize, fullscreen, and minimize immediately remove topmost state.

Category navigation is type-scoped. `category-browser` receives the selected sidebar root and current asset type, returns direct children plus a parent path, and never flattens all category roots into the top bar. Creation resolves a child scope from its parent and rejects cross-scope parents. Legacy `all` categories remain visible only when their descendants contain assets in the current type.

The import dialog keeps an optional `importCategoryId`. New top-level and child categories are created through the same validated category mutation, then the new ID is selected before the import resumes. `desktop/host.cjs` forwards the ID to `core/library.cjs`; the core checks that the category exists and its inherited scope matches the import mode. An omitted ID leaves new assets unclassified and does not reclassify duplicates, while an explicit ID applies to both new and duplicate records in the import transaction.

Favorite navigation is derived from the same category metadata: `favoriteCategoryGroups` groups only favorited assets by their direct `categoryId` and displays each existing path (for example, `都市人物 / 女`). The UI does not persist a second favorite taxonomy. A private sentinel represents missing or stale category IDs, and liked assets never render this favorite category bar.

Preview import options carry `previewResolution: null|256|512|1024|2048`. A numeric value is a longest-edge ceiling for newly generated PNG/GIF previews; `null` preserves the default renderer behavior. Existing same-stem sidecars are reused before rendering when the preference is enabled. Effect animation workers enforce frame, pixel, and time budgets and retain a static cover on timeout or oversize input.

The taskbar handoff is a gesture-scoped native helper. It waits for the verified Animate taskbar button, confirms the expected executable/PID, and then requires a renderer handshake before foregrounding Animate. The renderer performs a second mouse, capability, and document check; only then is a five-second stage-drop request created. No idle watcher runs, no arbitrary process is foregrounded, and FLA bytes never enter the native importer.

## 0.3 incremental contracts

Existing version-1 metadata remains readable. Assets gain kind ('fla' or 'audio'), assetType ('ordinary', 'effect', 'audio'), extension and preview metadata. Import takes mode ('ordinary' by default, 'effect', 'audio'); categories do not change assetType. Core validates modes and filters paths, stores content-addressed audio with its allowed extension, and keeps immutable originals. Categories gain pinned:false by default; setCategoryPinned(id, bool) uses the existing undoable atomic mutation.

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

Opening validates the content-addressed source then copies it to root/opened/UUID/material-name.fla, retaining the editable working copy. User saves never mutate the hash library. Insertion uses the exact current playhead on the existing target layer: a hold frame becomes a normal keyframe, inheriting content, then complete source root is appended and visually centered. No blank target keyframe or new target layer.

Grid density is a local UI preference (automatic or 4/5/6 columns). The available content width limits the effective columns so narrow windows and the inspector cannot force card actions outside their bounds. Compact headings bring the first row upwards. The revealInFolder IPC takes an asset ID, resolves an existing absolute source FLA from library metadata, and falls back to a validated managed copy. The renderer never supplies the destination path; Explorer selection is the only side effect.

`visibleAssets` accepts the view-only `hideChildCategories` option. It keeps direct assignments when a real category is selected, keeps only unclassified records at a typed virtual root, and bypasses the option for all, favorites, and daily-like views. The renderer clears selection and pagination anchors when the option changes; no metadata mutation or undo entry is created.

Original-path visibility uses Electron's original-fs rather than its archive-aware fs, so packaged virtual demo files fall back to real library copies. Native paths and every ancestor must be regular files/directories without links; an actual directory named .asar remains a valid original location.

The AnAn wordmark is an original local SVG geometry asset styled through brand.css. It introduces no font dependency or remote request and adapts to the dark/warm theme through local color variables.

## Deployed boundaries

The packaged application uses no HTTP server. Its sandboxed UI calls a fixed IPC method list and reads thumbnails through an anshelf scheme that resolves known asset IDs. HTTP(S) requests are blocked. The optional localhost dev server is only a development helper.

The preview worker reads one managed file in an isolated renderer; 128 MB input ceiling and 45-second timeout limit resource use. A preview revision token changes every successful render/reuse so cached images update after retry. Vendor parser dependencies are bundled in worker.js. Source originals are only read/copied.

The CEP extension is also copied outside app.asar to resources/AnimatePlugin so users can install it. The panel reads the fixed AppData root, stages up to 512 MB of validated content, and invokes a guarded JSFL function with JSON input. Its default content area is compact (about 48×48, minimum 40×40) and exposes one paste button; connection, pending, busy, success and failure are represented by that button, with asset/error details available through its title. It exits nested edit mode into the existing scene, inserts the whole source MovieClip at the target frame, then restores the active target and closes the temporary source without saving. Hash namespaces prevent name collisions and reuse exact file duplicates; cross-file symbol content equivalence is not inferred from names.

The delivered CEP runtime is locally self-signed with Adobe ZXPSignCmd. Its mimetype and META-INF/signatures.xml travel with every plugin copy. install.ps1 is outside the signed runtime file set: it validates declared SHA256 payload digests before staging and replaces the whole extension with rollback, retaining backups outside CEP's extension discovery directory. Default installation does not change registry keys or certificate stores; unsigned source development requires explicit EnableDebug. Any signed runtime edit requires regenerating the signature. No signing private key or password is delivered. Signing works around this machine's observed refusal to load the unsigned extension despite correct CEP11 PlayerDebugMode; the reason that development bypass was not honored is not established.
