/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHost } = require('../desktop/host.cjs');

test('later validated sidecar survives an earlier delayed validation failure', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-review-sidecar-race-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const first = path.join(base, 'first'), second = path.join(base, 'second');
  await fs.mkdir(first); await fs.mkdir(second);
  for (const dir of [first, second]) await fs.writeFile(path.join(dir, 'weapon.fla'), 'same-fla-bytes');
  await fs.writeFile(path.join(first, 'weapon.png'), 'bad-image-a');
  await fs.writeFile(path.join(second, 'weapon.png'), 'good-image-b');
  let started, release, validationCalls = 0;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const renders = [];
  const host = await createHost({ root: path.join(base, 'library'),
    validateImage: async () => {
      if (++validationCalls === 1) { started(); await gate; return false; }
      return true;
    },
    render: async a => { renders.push(a.id); return { previewPath: 'previews/rendered.png' }; },
  });
  const olderImport = host.api.importPaths([first]); await entered;
  await host.api.importPaths([second]);
  const newer = host.library.snapshot().assets[0];
  assert.equal(newer.previewOrigin, 'sidecar');
  release(); await olderImport; await host.queue.idle();
  const actual = host.library.getAsset(newer.id);
  assert.equal(actual.previewOrigin, 'sidecar');
  assert.equal(actual.previewPath, newer.previewPath);
  assert.deepEqual(renders, []);
});

test('later GIF sidecar poster survives an earlier delayed poster write', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-review-poster-race-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const first = path.join(base, 'first'), second = path.join(base, 'second');
  await fs.mkdir(first); await fs.mkdir(second);
  for (const dir of [first, second]) await fs.writeFile(path.join(dir, 'fire.fla'), 'same-fla-bytes');
  await fs.writeFile(path.join(first, 'fire.gif'), 'gif-a');
  await fs.writeFile(path.join(second, 'fire.gif'), 'gif-b');
  let started, release, posterCalls = 0;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const host = await createHost({ root: path.join(base, 'library'),
    createPoster: async (source, destination) => {
      const bytes = await fs.readFile(source, 'utf8');
      if (++posterCalls === 1) { started(); await gate; }
      await fs.writeFile(destination, 'poster:' + bytes); return true;
    },
    render: async () => { throw new Error('a valid GIF should not render FLA'); },
  });
  const olderImport = host.api.importPaths([first], { mode: 'effect' }); await entered;
  await host.api.importPaths([second], { mode: 'effect' });
  const newer = host.library.snapshot().assets[0];
  const newerPoster = path.join(host.library.root, newer.previewPosterPath);
  assert.equal(await fs.readFile(newerPoster, 'utf8'), 'poster:gif-b');
  release(); await olderImport;
  const actual = host.library.getAsset(newer.id);
  assert.equal(await fs.readFile(path.join(host.library.root, actual.previewPosterPath), 'utf8'), 'poster:gif-b');
});
