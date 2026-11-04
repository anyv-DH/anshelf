/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../core/library.cjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-managed-alias-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'Weapon.fla');
  await fs.writeFile(source, 'original-weapon');
  const library = await Library.open(path.join(base, 'library'));
  const asset = (await library.importPaths([source])).assets[0];
  await library.reconcileManagedFile(asset.id, 'Weapon.fla');
  return { library, asset, file: library.assetPath(asset.id) };
}

function observePayloadMoves(t, directory) {
  const changes = [], rename = fs.rename, remove = fs.rm;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (path.dirname(from) === directory || path.dirname(to) === directory) changes.push(['rename', from, to]);
    return rename(from, to);
  });
  t.mock.method(fs, 'rm', async (file, options) => {
    if (path.dirname(file) === directory) changes.push(['rm', file]);
    return remove(file, options);
  });
  return changes;
}

test('reconciling forward-slash metadata never deletes or renames the same managed FLA', async t => {
  const { library, asset, file } = await fixture(t);
  const relative = path.relative(library.root, file);
  // Windows imports historically used either separator; repeated separators
  // exercise the same equivalent-path branch on POSIX test hosts.
  const alias = relative.split(path.sep).join(process.platform === 'win32' ? '/' : '//');
  await library.change(state => { state.assets[0].managedPath = alias; }, false);
  const changes = observePayloadMoves(t, path.dirname(file));
  const result = await library.reconcileManagedFile(asset.id, 'Weapon.fla');
  assert.equal(await fs.readFile(file, 'utf8'), 'original-weapon');
  assert.deepEqual(changes, []);
  assert.equal(result.asset.managedPath, relative);
  assert.equal(result.contentChanged, false);
  assert.equal(result.pathChanged, true);
  const reopened = await Library.open(library.root);
  assert.equal(await fs.readFile(reopened.assetPath(asset.id), 'utf8'), 'original-weapon');
});

test('Windows casing aliases preserve the one physical FLA and still refresh newly saved content', { skip: process.platform !== 'win32' }, async t => {
  const { library, asset, file } = await fixture(t);
  const relative = path.relative(library.root, file);
  await library.change(state => { state.assets[0].managedPath = relative.toUpperCase(); }, false);
  await fs.writeFile(file, 'latest-saved-weapon');
  const changes = observePayloadMoves(t, path.dirname(file));
  const result = await library.reconcileManagedFile(asset.id, 'weapon.fla');
  assert.equal(await fs.readFile(file, 'utf8'), 'latest-saved-weapon');
  assert.deepEqual(changes, []);
  assert.equal(result.asset.managedPath, path.join('assets', asset.id, 'weapon.fla'));
  assert.equal(result.contentChanged, true);
  assert.equal(result.asset.previewStatus, 'pending');
  assert.notEqual(result.asset.hash, asset.hash);
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['Weapon.fla']);
  await library.reconcileManagedFile(asset.id, 'weapon.fla');
  assert.equal(await fs.readFile(library.assetPath(asset.id), 'utf8'), 'latest-saved-weapon');
});

test('a genuinely separate same-content target still converges on the existing file', async t => {
  const { library, asset, file } = await fixture(t);
  const target = path.join(path.dirname(file), 'Other.fla');
  await fs.copyFile(file, target);
  const result = await library.reconcileManagedFile(asset.id, 'Other.fla');
  assert.equal(await fs.readFile(target, 'utf8'), 'original-weapon');
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
  assert.equal(result.asset.managedPath, path.relative(library.root, target));
  assert.equal(result.contentChanged, false);
});

test('a genuinely separate different-content target refuses to replace either file', async t => {
  const { library, asset, file } = await fixture(t);
  const target = path.join(path.dirname(file), 'Other.fla');
  await fs.writeFile(target, 'a-different-weapon');
  await assert.rejects(library.reconcileManagedFile(asset.id, 'Other.fla'), /内容不一致/);
  assert.equal(await fs.readFile(file, 'utf8'), 'original-weapon');
  assert.equal(await fs.readFile(target, 'utf8'), 'a-different-weapon');
  assert.equal(library.assetPath(asset.id), file);
});
