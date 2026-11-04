/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHost } = require('../desktop/host.cjs');

async function fixture(t, options = {}, name = '女主角.fla', mode = 'ordinary') {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-duplicate-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, name);
  await fs.writeFile(source, 'original');
  const revealed = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), revealFile: async file => { revealed.push(file); }, ...options });
  await host.api.importPaths([source], { mode });
  await host.queue.idle();
  return { base, source, host, revealed, asset: host.library.snapshot().assets[0] };
}

test('explicit duplication copies the latest managed bytes beside the original and reveals the Chinese filename', async t => {
  const { host, source, base, revealed, asset } = await fixture(t);
  await fs.writeFile(host.library.assetPath(asset.id), 'saved-in-Animate');
  const result = await host.api.duplicateInFolder(asset.id);
  await host.queue.idle();
  assert.equal(result.cancelled, false);
  assert.equal(result.file, path.join(base, '女主角 - 副本.fla'));
  assert.equal(await fs.readFile(result.file, 'utf8'), 'saved-in-Animate');
  assert.equal(await fs.readFile(source, 'utf8'), 'original');
  assert.deepEqual(revealed, [result.file]);
  assert.equal(host.library.snapshot().assets.length, 1);
});

test('simultaneous copies use unique suffixes without overwriting existing files', async t => {
  const { host, base, asset } = await fixture(t);
  const first = path.join(base, '女主角 - 副本.fla');
  await fs.writeFile(first, 'keep-existing');
  const results = await Promise.all([host.api.duplicateInFolder(asset.id), host.api.duplicateInFolder(asset.id)]);
  assert.deepEqual(results.map(result => path.basename(result.file)).sort(), ['女主角 - 副本 (2).fla', '女主角 - 副本 (3).fla']);
  assert.equal(await fs.readFile(first, 'utf8'), 'keep-existing');
  assert.ok((await fs.readdir(base)).every(name => !name.endsWith('.tmp')));
});

test('a missing original offers a destination folder and cancelling leaves no copy', async t => {
  let picks = 0;
  const { host, base, source, revealed, asset } = await fixture(t, { pickDuplicateFolder: async () => { picks++; return []; } });
  await fs.unlink(source);
  assert.deepEqual(await host.api.duplicateInFolder(asset.id), { cancelled: true });
  assert.equal(picks, 1);
  assert.deepEqual(revealed, []);
  assert.deepEqual(await fs.readdir(base), ['library']);
});

test('declining the second confirmation creates no file and never reveals Explorer', async t => {
  const confirmations = [];
  const { host, base, revealed, asset } = await fixture(t, { confirmDuplicate: async details => { confirmations.push(details); return false; } });
  const filesBefore = (await fs.readdir(base, { recursive: true })).sort();
  assert.deepEqual(await host.api.duplicateInFolder(asset.id), { cancelled: true });
  assert.deepEqual(confirmations, [{ name: '女主角', directory: base, extension: '.fla' }]);
  assert.deepEqual((await fs.readdir(base, { recursive: true })).sort(), filesBefore);
  assert.deepEqual(revealed, []);
});

test('declining copy after an AN save leaves the index, preview queue and managed filename untouched', async t => {
  let renderCount = 0;
  const { host, base, revealed, asset } = await fixture(t, {
    confirmDuplicate: async () => false,
    render: async () => { renderCount++; return { previewPath: null }; },
  });
  const managed = host.library.assetPath(asset.id);
  await fs.writeFile(managed, 'saved-in-Animate-after-import');
  const beforeIndex = await fs.readFile(path.join(host.root, 'library.json'), 'utf8');
  const beforeAsset = host.library.getAsset(asset.id);
  const beforeFiles = (await fs.readdir(base, { recursive: true })).sort();
  const beforeRenderCount = renderCount;
  assert.deepEqual(await host.api.duplicateInFolder(asset.id), { cancelled: true });
  await host.queue.idle();
  assert.equal(await fs.readFile(path.join(host.root, 'library.json'), 'utf8'), beforeIndex);
  assert.deepEqual(host.library.getAsset(asset.id), beforeAsset);
  assert.equal(host.library.assetPath(asset.id), managed);
  assert.equal(await fs.readFile(managed, 'utf8'), 'saved-in-Animate-after-import');
  assert.equal(renderCount, beforeRenderCount);
  assert.deepEqual((await fs.readdir(base, { recursive: true })).sort(), beforeFiles);
  assert.deepEqual(revealed, []);
});

test('a chosen fallback directory gets the copy and audio keeps its extension', async t => {
  let destination;
  const { host, base, source, asset } = await fixture(t, { pickDuplicateFolder: async () => [destination] }, '鼓点.wav', 'audio');
  destination = path.join(base, '导出');
  await fs.mkdir(destination);
  await fs.unlink(source);
  const result = await host.api.duplicateInFolder(asset.id);
  assert.equal(result.file, path.join(destination, '鼓点 - 副本.wav'));
  assert.equal(await fs.readFile(result.file, 'utf8'), 'original');
});

test('duplication rejects unknown IDs and never exports a copy into the managed library', async t => {
  let destination;
  const { host, source, asset } = await fixture(t, { pickDuplicateFolder: async () => [destination] });
  await assert.rejects(host.api.duplicateInFolder(source), /素材/);
  await fs.unlink(source);
  destination = path.join(host.root, 'assets');
  await assert.rejects(host.api.duplicateInFolder(asset.id), /素材库/);
});

test('duplication refuses linked destination folders without writing through them', async t => {
  let destination;
  const { host, base, source, asset } = await fixture(t, { pickDuplicateFolder: async () => [destination] });
  await fs.unlink(source);
  destination = path.join(base, 'linked');
  await fs.symlink(base, destination, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(host.api.duplicateInFolder(asset.id), /链接/);
  assert.ok(!(await fs.readdir(base)).some(name => name.includes('副本')));
});

test('duplicate filenames sanitize reserved characters and cannot escape the source folder', async t => {
  const { host, base, asset } = await fixture(t);
  await host.api.updateAsset(asset.id, { name: '../CON:*?' });
  const result = await host.api.duplicateInFolder(asset.id);
  assert.equal(path.dirname(result.file), base);
  assert.ok(!/[<>:"/\\|?*]/.test(path.basename(result.file)));
  assert.equal(await fs.readFile(result.file, 'utf8'), 'original');
});

test('AN current-document imports are deduplicated and exposed only as a host-side method', async t => {
  const { host, base } = await fixture(t);
  const file = path.join(base, '新武器.fla');
  await fs.writeFile(file, 'new-weapon');
  const first = await host.importCurrentDocument(file);
  const second = await host.importCurrentDocument(file);
  await host.queue.idle();
  assert.equal(first.name, '新武器');
  assert.equal(second.assetId, first.assetId);
  assert.equal(host.library.snapshot().assets.length, 2);
  assert.equal(host.api.importCurrentDocument, undefined);
  assert.equal(await fs.readFile(file, 'utf8'), 'new-weapon');
});

test('adding an already managed AN document reconciles saved bytes without copying or reclassifying it', async t => {
  const { host, asset } = await fixture(t, {}, '旋转特效.fla', 'effect');
  const file = host.library.assetPath(asset.id);
  await fs.writeFile(file, 'updated-effect');
  const first = await host.importCurrentDocument(file);
  await host.queue.idle();
  assert.equal(first.assetId, asset.id);
  assert.equal(first.updated, true);
  assert.equal(host.library.snapshot().assets.length, 1);
  assert.equal(host.library.getAsset(asset.id).assetType, 'effect');
  assert.equal(host.library.assetPath(asset.id), file);
  assert.deepEqual(await fs.readdir(path.join(host.root, 'assets')), [path.basename(file)]);
});

test('adding an external file already in the effect library preserves its type and categories', async t => {
  const { host, source, asset } = await fixture(t, {}, '旋转特效.fla', 'effect');
  const category = await host.api.createCategory('战斗特效', null, 'effect');
  await host.api.assignCategory([asset.id], category.id);
  const result = await host.importCurrentDocument(source);
  await host.queue.idle();
  assert.equal(result.assetId, asset.id);
  assert.equal(result.duplicate, true);
  assert.equal(host.library.getAsset(asset.id).assetType, 'effect');
  assert.equal(host.library.getAsset(asset.id).categoryId, category.id);
  assert.equal(host.library.snapshot().assets.length, 1);
});

test('adding duplicate external 2K effects only records the source without touching previews or generating files', async t => {
  let renders = 0;
  const { host, base, source, asset } = await fixture(t, { render: async () => { renders++; return { previewPath: null }; } }, '旋转特效.fla', 'effect');
  const category = await host.api.createCategory('战斗特效', null, 'effect');
  await host.api.assignCategory([asset.id], category.id);
  await host.api.importPaths([source], { mode: 'effect', previewResolution: 2048 });
  await host.queue.idle();
  const otherDirectory = path.join(base, '另一个来源');
  await fs.mkdir(otherDirectory);
  const otherSource = path.join(otherDirectory, '同一特效.fla');
  await fs.copyFile(source, otherSource);
  await fs.writeFile(path.join(otherDirectory, '同一特效.png'), 'new-sidecar-must-not-replace-current-preview');
  const before = host.library.getAsset(asset.id);
  const filesBefore = (await fs.readdir(host.root, { recursive: true })).sort();
  const rendersBefore = renders;
  const result = await host.importCurrentDocument(otherSource);
  await host.queue.idle();
  const after = host.library.getAsset(asset.id);
  assert.equal(result.assetId, asset.id);
  assert.equal(result.duplicate, true);
  assert.equal(after.previewResolution, 2048);
  assert.equal(after.previewRevision, before.previewRevision);
  assert.equal(after.previewPath, before.previewPath);
  assert.equal(after.previewOrigin, before.previewOrigin);
  assert.equal(after.assetType, before.assetType);
  assert.deepEqual(after.categoryIds, before.categoryIds);
  assert.equal(renders, rendersBefore);
  assert.deepEqual((await fs.readdir(host.root, { recursive: true })).sort(), filesBefore);
  assert.ok(after.sourcePaths.includes(await fs.realpath(otherSource)));
  await host.importCurrentDocument(otherSource);
  assert.equal(host.library.getAsset(asset.id).sourcePaths.length, after.sourcePaths.length);
});

test('current-document import rejects missing, non-FLA, linked and unregistered managed paths', async t => {
  const { host, base, source } = await fixture(t);
  await assert.rejects(host.importCurrentDocument('relative.fla'), /FLA|路径/);
  await assert.rejects(host.importCurrentDocument(path.join(base, 'missing.fla')), /FLA|路径/);
  const textFile = path.join(base, 'not-fla.txt');
  await fs.writeFile(textFile, 'no');
  await assert.rejects(host.importCurrentDocument(textFile), /FLA|路径/);
  const unregistered = path.join(host.root, 'assets', 'unregistered.fla');
  await fs.writeFile(unregistered, 'not-registered');
  await assert.rejects(host.importCurrentDocument(unregistered), /登记|素材库/);
  const linkDirectory = path.join(base, 'alias');
  await fs.symlink(base, linkDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(host.importCurrentDocument(path.join(linkDirectory, path.basename(source))), /FLA|路径|链接/);
  assert.equal(host.library.snapshot().assets.length, 1);
});
