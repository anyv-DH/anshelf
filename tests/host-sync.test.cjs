/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHost } = require('../desktop/host.cjs');
const { atomicWrite } = require('../core/bridge.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-sync-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return createHost({ root, render: async () => ({ previewPath: null }) });
}
test('an unchanged poll returns only a token and never clones the full library', async t => {
  const host = await fixture(t), first = await host.api.sync();
  assert.ok(first.snapshot); assert.equal(typeof first.version, 'string');
  host.library.snapshot = () => { throw new Error('idle cloned the full library'); };
  for (let i = 0; i < 10; i++) assert.deepEqual(await host.api.sync(first.version), { version: first.version });
});
test('sync includes committed changes, preview completion and undo while no-op preserves its token', async t => {
  const host = await fixture(t), first = await host.api.sync();
  const category = await host.api.createCategory('新增');
  const second = await host.api.sync(first.version); assert.ok(second.snapshot.categories.some(c => c.id === category.id));
  await host.api.renameCategory(category.id, '新增'); assert.equal((await host.api.sync(second.version)).version, second.version);
  await host.api.undo(); const third = await host.api.sync(second.version); assert.ok(!third.snapshot.categories.some(c => c.id === category.id));
});
test('heartbeat timestamp-only updates do not transfer assets, while busy, connection expiry and results do', async t => {
  const host = await fixture(t), file = path.join(host.bridge.directory, 'status.json');
  let now = 1800000000000; const originalNow = Date.now; Date.now = () => now; t.after(() => { Date.now = originalNow; });
  atomicWrite(file, { version: 1, updatedAt: now, app: 'Animate', busy: false });
  const first = await host.api.sync(); assert.equal(first.snapshot.bridge.connected, true);
  now += 1000; atomicWrite(file, { version: 1, updatedAt: now, app: 'Animate', busy: false });
  assert.deepEqual(await host.api.sync(first.version), { version: first.version });
  atomicWrite(file, { version: 1, updatedAt: now, app: 'Animate', busy: true });
  const busy = await host.api.sync(first.version); assert.equal(busy.snapshot.bridge.heartbeat.busy, true);
  now += 15001; const expired = await host.api.sync(busy.version); assert.equal(expired.snapshot.bridge.connected, false);
  atomicWrite(path.join(host.bridge.directory, 'result.json'), { version: 1, requestId: 'request', ok: true });
  const done = await host.api.sync(expired.version); assert.equal(done.snapshot.bridge.result.ok, true);
});
test('likes expire during idle without a metadata mutation or continual library scans', async t => {
  const host = await fixture(t), file = path.join(path.dirname(host.root), path.basename(host.root) + '-sound.wav'); await fs.writeFile(file, 'fake-wav'); t.after(() => fs.rm(file, { force: true }));
  await host.api.importPaths([file], { mode: 'audio' });
  let now = 1800000000000; const originalNow = Date.now; Date.now = () => now; t.after(() => { Date.now = originalNow; });
  const id = host.library.snapshot().assets[0].id; await host.api.updateAsset(id, { liked: true });
  const first = await host.api.sync(); assert.equal(first.snapshot.assets[0].liked, true);
  now += 86400000 - 1; assert.deepEqual(await host.api.sync(first.version), { version: first.version });
  now++; const expired = await host.api.sync(first.version); assert.equal(expired.snapshot.assets[0].liked, false);
});
test('queued and active previews invalidate sync without mutating the metadata', async t => {
  const host = await fixture(t), first = await host.api.sync();
  host.queue.active = 'rendering'; const active = await host.api.sync(first.version); assert.equal(active.snapshot.queue.active, 'rendering');
  host.queue.active = null; const idle = await host.api.sync(active.version); assert.equal(idle.snapshot.queue.active, null);
});
