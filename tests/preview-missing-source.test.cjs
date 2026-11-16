/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHost } = require('../desktop/host.cjs');
const { resolveManagedPath } = require('../core/bridge.cjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-preview-missing-'));
  const source = path.join(base, '手忙脚乱.fla'), root = path.join(base, 'library');
  const original = Buffer.from('isolated-effect-original');
  await fs.writeFile(source, original);
  let renders = 0;
  const host = await createHost({ root, render: async asset => {
    renders++;
    resolveManagedPath(root, asset.managedPath, 'assets');
    return { previewPath: null, previewFormat: 'png' };
  } });
  const asset = (await host.api.importPaths([source], { mode: 'effect' })).assets[0];
  await host.queue.idle();
  const managed = path.join(root, asset.managedPath);
  t.after(async () => { host.close(); await host.queue.idle(); await fs.rm(base, { recursive: true, force: true }); });
  await fs.unlink(managed);
  await host.library.setPreview(asset.id, { previewStatus: 'failed', previewError: '素材路径对应的文件不存在' });
  return { base, root, source, original, host, asset, managed, renders: () => renders };
}

test('explicit preview retry restores a missing managed effect from identical original bytes and preserves metadata', async t => {
  const f = await fixture(t);
  const before = f.host.library.getAsset(f.asset.id);
  assert.equal(await f.host.api.retryPreview(f.asset.id), true);
  await f.host.queue.idle();
  assert.equal(f.host.library.getAsset(f.asset.id).previewStatus, 'ready');
  assert.deepEqual(await fs.readFile(f.managed), f.original);
  assert.deepEqual(await fs.readFile(f.source), f.original);
  const after = f.host.library.getAsset(f.asset.id);
  for (const key of ['id', 'hash', 'name', 'assetType', 'managedPath', 'sourcePaths', 'categoryIds', 'tags']) assert.deepEqual(after[key], before[key], key);
  assert.equal(f.renders(), 2);
  assert.equal((await fs.readdir(path.join(f.root, 'assets'))).some(name => name.endsWith('.tmp')), false);
});

test('retry refuses changed originals without queuing, replacing metadata or fabricating a preview', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.source, 'different-version');
  const before = f.host.library.getAsset(f.asset.id);
  await assert.rejects(f.host.api.retryPreview(f.asset.id), /未找到.*一致/);
  assert.deepEqual(f.host.library.getAsset(f.asset.id), before);
  assert.equal(f.renders(), 1);
  await assert.rejects(fs.access(f.managed), { code: 'ENOENT' });
  assert.equal(await fs.readFile(f.source, 'utf8'), 'different-version');
});

test('retry reports unavailable originals and removal still works with undo for a missing managed file', async t => {
  const f = await fixture(t);
  await fs.unlink(f.source);
  await assert.rejects(f.host.api.retryPreview(f.asset.id), /原.*文件|找不到.*文件/);
  assert.equal(await f.host.api.removeAssets([f.asset.id]), 1);
  assert.equal(f.host.library.getAsset(f.asset.id), null);
  await f.host.api.undo();
  assert.equal(f.host.library.getAsset(f.asset.id).id, f.asset.id);
});

test('existing managed files are never replaced by an older recorded original on retry', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.managed, 'new-edited-managed-version');
  await f.host.api.retryPreview(f.asset.id);
  await f.host.queue.idle();
  assert.equal(await fs.readFile(f.managed, 'utf8'), 'new-edited-managed-version');
  assert.deepEqual(await fs.readFile(f.source), f.original);
  assert.equal(f.host.library.getAsset(f.asset.id).previewStatus, 'ready');
});

test('background preview processing never restores or scans the recorded original', async t => {
  const f = await fixture(t);
  await f.host.queue.add([f.asset], true);
  await f.host.queue.idle();
  assert.equal(f.host.library.getAsset(f.asset.id).previewStatus, 'failed');
  await assert.rejects(fs.access(f.managed), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(f.source), f.original);
});

test('retry can use a second explicitly recorded identical source after an unavailable or changed one', async t => {
  const f = await fixture(t);
  const second = path.join(f.base, '第二份原始特效.fla');
  await fs.copyFile(f.source, second);
  await fs.writeFile(f.source, 'different-version');
  f.host.library.state.assets[0].sourcePaths.push(second);
  await f.host.api.retryPreview(f.asset.id);
  await f.host.queue.idle();
  assert.deepEqual(await fs.readFile(f.managed), f.original);
  assert.equal(await fs.readFile(f.source, 'utf8'), 'different-version');
  assert.deepEqual(await fs.readFile(second), f.original);
});

test('recorded source directory links cannot be used for missing-file restoration', async t => {
  const f = await fixture(t);
  const external = path.join(f.base, 'external'), linked = path.join(f.base, 'linked');
  await fs.mkdir(external);
  await fs.copyFile(f.source, path.join(external, 'effect.fla'));
  await fs.symlink(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
  f.host.library.state.assets[0].sourcePaths = [path.join(linked, 'effect.fla')];
  await assert.rejects(f.host.api.retryPreview(f.asset.id), /未找到.*一致/);
  await assert.rejects(fs.access(f.managed), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(external, 'effect.fla')), f.original);
});

test('restoration refuses linked managed ancestors without writing outside the library', async t => {
  const f = await fixture(t);
  const external = path.join(f.base, 'external'), linked = path.join(f.root, 'assets', f.asset.id);
  await fs.mkdir(external);
  await fs.symlink(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
  f.host.library.state.assets[0].managedPath = path.join('assets', f.asset.id, 'effect.fla');
  await assert.rejects(f.host.api.retryPreview(f.asset.id), /链接/);
  assert.deepEqual(await fs.readdir(external), []);
  assert.deepEqual(await fs.readFile(f.source), f.original);
});

test('unsupported hard links use an exclusive verified copy without requiring NTFS', async t => {
  const f = await fixture(t), link = fs.link;
  fs.link = async () => { throw Object.assign(new Error('hard links unsupported'), { code: 'ENOTSUP' }); };
  try {
    await f.host.api.retryPreview(f.asset.id);
    await f.host.queue.idle();
  } finally { fs.link = link; }
  assert.equal(f.host.library.getAsset(f.asset.id).previewStatus, 'ready');
  assert.deepEqual(await fs.readFile(f.managed), f.original);
  assert.deepEqual(await fs.readFile(f.source), f.original);
});

test('exclusive-copy fallback never replaces a file that appears during recovery', async t => {
  const f = await fixture(t), link = fs.link;
  fs.link = async () => {
    await fs.writeFile(f.managed, 'new-concurrent-managed-version');
    throw Object.assign(new Error('hard links unsupported'), { code: 'ENOTSUP' });
  };
  try {
    await f.host.api.retryPreview(f.asset.id);
    await f.host.queue.idle();
  } finally { fs.link = link; }
  assert.equal(await fs.readFile(f.managed, 'utf8'), 'new-concurrent-managed-version');
  assert.deepEqual(await fs.readFile(f.source), f.original);
  assert.equal((await fs.readdir(path.join(f.root, 'assets'))).some(name => name.endsWith('.tmp')), false);
});

test('unexpected publication errors remain explicit without retrying an unsafe overwrite', async t => {
  const f = await fixture(t), link = fs.link;
  fs.link = async () => { throw Object.assign(new Error('publication denied'), { code: 'EACCES' }); };
  try { await assert.rejects(f.host.api.retryPreview(f.asset.id), /publication denied/); }
  finally { fs.link = link; }
  await assert.rejects(fs.access(f.managed), { code: 'ENOENT' });
  assert.equal(f.host.library.getAsset(f.asset.id).previewStatus, 'failed');
  assert.equal((await fs.readdir(path.join(f.root, 'assets'))).some(name => name.endsWith('.tmp')), false);
  assert.deepEqual(await fs.readFile(f.source), f.original);
});
