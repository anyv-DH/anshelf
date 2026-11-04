/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { locateManagedFile } = require('../core/managed-file-recovery.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-locate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets', 'own-id'), { recursive: true });
  const hash = createHash('sha256').update('old-bytes').digest('hex');
  return { root, asset: { id: 'own-id', name: '中文人物', hash, managedPath: 'assets/' + hash + '.fla' } };
}

test('current managed files are returned directly without scanning other candidate versions', async t => {
  const { root, asset } = await fixture(t);
  const file = path.join(root, asset.managedPath);
  await fs.writeFile(file, 'current');
  await fs.writeFile(path.join(root, 'assets/own-id/other.fla'), 'different-version');
  const found = await locateManagedFile(root, asset);
  assert.equal(found.recovered, false);
  assert.equal(path.relative(file, found.file), '');
  assert.equal(found.relative.replaceAll('\\', '/'), asset.managedPath);
});

test('missing old hash paths locate the same asset ID latest saved file even when its hash changed', async t => {
  const { root, asset } = await fixture(t);
  const file = path.join(root, 'assets/own-id/中文人物.fla');
  await fs.writeFile(file, 'new-AN-save');
  const before = await fs.readFile(file);
  const found = await locateManagedFile(root, asset);
  assert.equal(found.recovered, true);
  assert.equal(path.relative(file, found.file), '');
  assert.equal(found.relative.replaceAll('\\', '/'), 'assets/own-id/中文人物.fla');
  assert.deepEqual(await fs.readFile(file), before);
  await assert.rejects(fs.access(path.join(root, asset.managedPath)), { code: 'ENOENT' });
});

test('missing named paths may recover within their own ID directory and prefer the display basename among identical bytes', async t => {
  const { root, asset } = await fixture(t);
  asset.managedPath = 'assets/own-id/missing-name.fla';
  await fs.writeFile(path.join(root, 'assets/own-id/RECOVER_中文人物.fla'), 'same');
  await fs.writeFile(path.join(root, 'assets/own-id/中文人物.fla'), 'same');
  const found = await locateManagedFile(root, asset);
  assert.equal(path.basename(found.file), '中文人物.fla');
  assert.deepEqual((await fs.readdir(path.join(root, 'assets/own-id'))).sort(), ['RECOVER_中文人物.fla', '中文人物.fla'].sort());
});

test('different saved candidate versions require manual confirmation even if one has the old hash', async t => {
  const { root, asset } = await fixture(t);
  await fs.writeFile(path.join(root, 'assets/own-id/old.fla'), 'old-bytes');
  await fs.writeFile(path.join(root, 'assets/own-id/new.fla'), 'new-bytes');
  await assert.rejects(locateManagedFile(root, asset), /多个不同版本.*手动确认/);
});

test('recovery never scans arbitrary missing names, another asset ID, or source paths', async t => {
  const { root, asset } = await fixture(t);
  await fs.mkdir(path.join(root, 'assets/other-id'));
  const external = path.join(root, 'external.fla');
  await fs.writeFile(external, 'external');
  await fs.writeFile(path.join(root, 'assets/other-id/中文人物.fla'), 'other');
  asset.sourcePaths = [external];
  await assert.rejects(locateManagedFile(root, asset), /不存在/);
  await fs.writeFile(path.join(root, 'assets/own-id/中文人物.fla'), 'own');
  await assert.rejects(locateManagedFile(root, { ...asset, managedPath: 'assets/missing.fla' }), /路径|恢复/);
  await assert.rejects(locateManagedFile(root, { ...asset, managedPath: 'assets/other-id/missing.fla' }), /路径|恢复/);
  await assert.rejects(locateManagedFile(root, { ...asset, managedPath: '../external.fla' }), /路径|目录/);
  await assert.rejects(locateManagedFile(root, { ...asset, id: '../other-id' }), /ID|路径/);
});

test('linked current paths and linked candidate directories are never followed', async t => {
  const { root, asset } = await fixture(t);
  const external = path.join(root, 'external');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, '中文人物.fla'), 'external');
  await fs.rmdir(path.join(root, 'assets/own-id'));
  await fs.symlink(external, path.join(root, 'assets/own-id'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(locateManagedFile(root, asset), /链接|路径/);
  const linked = { ...asset, managedPath: 'assets/own-id/中文人物.fla' };
  await assert.rejects(locateManagedFile(root, linked), /链接|路径/);
});

test('candidate scanning is bounded and does not accept a directory as an FLA', async t => {
  const { root, asset } = await fixture(t);
  await fs.mkdir(path.join(root, 'assets/own-id/not-a-file.fla'));
  await assert.rejects(locateManagedFile(root, asset), /不存在/);
  for (let n = 0; n < 65; n++) await fs.writeFile(path.join(root, 'assets/own-id/' + n + '.fla'), 'same');
  await assert.rejects(locateManagedFile(root, asset), /过多|64/);
});
