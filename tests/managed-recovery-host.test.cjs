/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHost } = require('../desktop/host.cjs');

test('opening a shared asset repairs a stale path using its latest saved managed content without copying', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-recover-host-'));
  const source = path.join(base, '共享人物.fla');
  await fs.writeFile(source, 'old-external-source');
  const opened = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), openInAnimate: async file => { opened.push(file); return true; } });
  t.after(async () => { await host.queue.idle(); await fs.rm(base, { recursive: true, force: true }); });
  const asset = (await host.api.importPaths([source])).assets[0];
  await host.queue.idle();
  const first = await host.api.createCategory('第一部');
  const second = await host.api.createCategory('第二部');
  await host.api.assignCategory([asset.id], first.id);
  await host.api.addToCategory([asset.id], second.id);
  await host.api.openInAnimate(asset.id);
  const namedPath = host.library.getAsset(asset.id).managedPath;
  await fs.writeFile(host.library.assetPath(asset.id), 'newest-AN-saved-content');
  await host.library.change(state => { state.assets[0].managedPath = asset.managedPath; }, false);
  assert.equal(await host.api.openInAnimate(asset.id), true);
  await host.queue.idle();
  assert.equal(host.library.getAsset(asset.id).managedPath, namedPath);
  assert.deepEqual(host.library.getAsset(asset.id).categoryIds, [first.id, second.id]);
  assert.equal(await fs.readFile(opened.at(-1), 'utf8'), 'newest-AN-saved-content');
  assert.equal(await fs.readFile(source, 'utf8'), 'old-external-source');
  assert.equal((await fs.readdir(path.join(host.root, 'assets', asset.id))).length, 1);
  await assert.rejects(fs.access(path.join(host.root, asset.managedPath)), { code: 'ENOENT' });
});
