/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHost } = require('../desktop/host.cjs');

test('an earlier preview snapshot keeps its cached sidecar bytes while reimport validation is pending', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-review-sidecar-bytes-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const first = path.join(base, 'first'), second = path.join(base, 'second');
  await fs.mkdir(first); await fs.mkdir(second);
  for (const dir of [first, second]) await fs.writeFile(path.join(dir, 'weapon.fla'), 'same-fla-bytes');
  await fs.writeFile(path.join(first, 'weapon.png'), 'accepted-image-a');
  await fs.writeFile(path.join(second, 'weapon.png'), 'new-image-b');
  let started, release, calls = 0;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const host = await createHost({ root: path.join(base, 'library'),
    validateImage: async () => {
      if (++calls === 2) { started(); await gate; }
      return true;
    },
    render: async () => { throw new Error('valid sidecars should not render FLA'); },
  });
  await host.api.importPaths([first]);
  const older = (await host.api.snapshot()).assets[0];
  const oldFile = path.join(host.library.root, older.previewPath);
  assert.equal(await fs.readFile(oldFile, 'utf8'), 'accepted-image-a');
  const newerImport = host.api.importPaths([second]); await entered;
  const bytesWhileValidating = await fs.readFile(oldFile, 'utf8');
  release(); await newerImport;
  assert.equal(bytesWhileValidating, 'accepted-image-a');
  assert.equal(await fs.readFile(oldFile, 'utf8'), 'accepted-image-a');
  const newer = (await host.api.snapshot()).assets[0];
  assert.notEqual(newer.previewPath, older.previewPath);
  assert.notEqual(newer.previewUrl, older.previewUrl);
  assert.equal(await fs.readFile(path.join(host.library.root, newer.previewPath), 'utf8'), 'new-image-b');
});
