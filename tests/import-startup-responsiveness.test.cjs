/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHost } = require('../desktop/host.cjs');

test('a tiny FLA import completes without starting Animate later', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-responsive-import-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'a.fla'); await fs.writeFile(source, 'a');
  let starts = 0, committed = false;
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }),
    ensureAnimateRunning: async () => { starts++; } });
  const importing = host.api.importPaths([source]).then(result => { committed = true; return result; });
  await importing;
  await host.queue.idle();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(committed, true, 'the import IPC must complete promptly');
  assert.equal(starts, 0, 'a completed import must not launch Animate as a delayed side effect');
});

test('a slow Animate launcher cannot hold an offline preview queue hostage', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-no-animate-probe-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'small.fla'); await fs.writeFile(source, 'small');
  let release, starts = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }),
    ensureAnimateRunning: async () => { starts++; await gate; } });
  await host.api.importPaths([source]);
  await host.queue.idle();
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 0);
});

for (const mode of ['ordinary', 'effect']) test(`${mode} import returns while offline rendering is busy and never requests AN`, async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-offline-import-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'small.fla'); await fs.writeFile(source, 'small');
  let release, starts = 0, opened = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const host = await createHost({ root: path.join(base, 'library'), render: async () => { await gate; return { previewPath: null }; },
    ensureAnimateRunning: async () => { starts++; }, openInAnimate: async () => { opened++; } });
  try {
    const result = await host.api.importPaths([source], { mode });
    assert.equal(result.added, 1);
    assert.equal(host.queue.running, true);
    assert.equal(host.library.snapshot().assets[0].previewStatus, 'pending');
    assert.equal(starts, 0); assert.equal(opened, 0);
  } finally { release(); await host.queue.idle(); }
  const asset = host.library.snapshot().assets[0];
  assert.equal(asset.previewStatus, 'ready');
  assert.equal(starts, 0); assert.equal(opened, 0);
  await host.api.openInAnimate(asset.id);
  assert.equal(opened, 1, 'explicit open remains available after an offline import');
});

test('failed preview and retry stay offline without launching AN', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-offline-retry-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'bad.fla'); await fs.writeFile(source, 'bad');
  let starts = 0, attempts = 0;
  const host = await createHost({ root: path.join(base, 'library'), render: async () => { attempts++; throw new Error('unsupported FLA'); },
    ensureAnimateRunning: async () => { starts++; } });
  await host.api.importPaths([source]); await host.queue.idle();
  const asset = host.library.snapshot().assets[0];
  assert.equal(asset.previewStatus, 'failed');
  await host.api.retryPreview(asset.id); await host.queue.idle();
  assert.equal(attempts, 2);
  assert.equal(host.library.getAsset(asset.id).previewStatus, 'failed');
  assert.equal(starts, 0);
});
