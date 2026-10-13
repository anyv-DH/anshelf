# Local processing and trust boundaries

This single-user application stores imported copies and metadata under the current user's AppData. It has no accounts, telemetry, cloud upload or product HTTP(S) requests. Original material may be confidential and is kept locally. Shipped demo material is synthetic; representative user-owned materials were tested only in local isolated work directories and the user's local library, never shipped.

The main window is sandboxed with context isolation and no Node integration. Preload exposes a fixed method set; IPC verifies the sender and excludes arbitrary import paths. The offline FLA parser runs in a separate sandboxed hidden renderer with a file-size ceiling and timeout; CSP restricts scripts and assets. Complex/malicious compressed files may still consume resources until the worker exits, so this is not a general untrusted-file scanning service.

0.2 IPC requires string method names before property lookup to prevent array coercion bypass. The open-in-AN API only accepts known asset IDs, validates managed paths/links, and copies to a separate UUID .fla in opened before opening it; saving in AN cannot modify the content-addressed library. Opened copies are retained for user work. Window actions and themes are allowlisted.

File-location IPC also accepts only a known asset ID. Original locations come from saved source metadata and must be existing absolute regular .fla files with no linked ancestors; managed fallbacks use the existing checked assets boundary. The UI receives only the location type, not a general native path-opening API. This operation does not mutate the file or library metadata.

The CEP panel intentionally uses Node because it exchanges local files. Its receiver checks a fixed root, version, path boundaries, links and content hash before opening a separate temporary FLA. It invokes one fixed JSFL receiver; requests cannot carry executable code. Target FLA contents are only changed by native Animate operations and are never automatically saved.

Atomic JSON writes avoid partial files. Metadata is not encrypted; backup copies inherit the original material's confidentiality. The optional development server binds only to localhost and is not started by the packaged application. Do not publish it or expose it to a LAN. The application is packaged without signing for this local delivery.

No secrets are needed to build or run. Build dependencies come from npm/GitHub and are pinned by pnpm-lock.yaml. Upstream provenance and declared licenses are recorded in THIRD_PARTY_NOTICES.md. Review and patch dependencies before public distribution.
