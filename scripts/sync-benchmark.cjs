/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createHost } = require('../desktop/host.cjs');
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-sync-benchmark-'));
  try {
    const host = await createHost({ root, render: async () => ({ previewPath: null }) }), cases = [];
    for (const count of [200, 2000, 10000]) {
      host.library.state.assets = Array.from({ length: count }, (_, i) => ({ id: 'asset-' + i, name: '合成素材 ' + i, hash: 'a'.repeat(64), sourcePaths: ['C:\\diagnostic\\合成素材.fla'], managedPath: 'assets/diagnostic.fla', previewPath: 'previews/diagnostic.png', previewStatus: 'ready', tags: [], favorite: false, likedAt: null, kind: 'fla', assetType: 'ordinary', extension: '.fla', createdAt: '2026-10-13T00:00:00Z' }));
      host.library.revision++;
      const first = await host.api.sync(), rounds = 100;
      const full = { start: performance.now(), cpu: process.cpuUsage(), bytes: 0 };
      for (let n = 0; n < rounds; n++) full.bytes += Buffer.byteLength(JSON.stringify(await host.api.snapshot()));
      const fullTime = performance.now() - full.start, fullCpu = process.cpuUsage(full.cpu);
      const lite = { start: performance.now(), cpu: process.cpuUsage(), bytes: 0 };
      for (let n = 0; n < rounds; n++) lite.bytes += Buffer.byteLength(JSON.stringify(await host.api.sync(first.version)));
      const liteTime = performance.now() - lite.start, liteCpu = process.cpuUsage(lite.cpu);
      cases.push({ count, rounds, full: { elapsedMs: fullTime, cpuMs: (fullCpu.user + fullCpu.system) / 1000, bytesPerPoll: full.bytes / rounds }, unchangedSync: { elapsedMs: liteTime, cpuMs: (liteCpu.user + liteCpu.system) / 1000, bytesPerPoll: lite.bytes / rounds } });
    }
    const result = { method: 'Real host.snapshot and host.sync plus JSON serialization, 100 calls per case; synthetic in-memory metadata, no UI/IPC/profile overhead. This measures copying work, not overall application CPU.', cases };
    const output = path.join(__dirname, '../test-output/sync-benchmark.json'); await fs.writeFile(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
