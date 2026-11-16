/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createBrowserRenderer } = require('../desktop/browser-render.cjs');

test('development regeneration preserves the bytes of earlier preview versions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-browser-preview-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets/source.fla'), 'fixture');
  let generations = 0, closed = 0;
  const browser = { newPage: async () => ({ goto: async () => {},
    evaluate: async () => ({ png: 'data:image/png;base64,' + Buffer.from('image-' + ++generations).toString('base64'), width: 1, height: 1, frames: 1 }),
    close: async () => { closed++; } }) };
  const render = createBrowserRenderer(root, async () => browser, () => 'http://127.0.0.1:4317');
  const asset = { id: 'fixture', managedPath: 'assets/source.fla' };
  const first = await render(asset), firstBytes = await fs.readFile(path.join(root, first.previewPath));
  const second = await render(asset);
  assert.notEqual(second.previewPath, first.previewPath);
  assert.notDeepEqual(await fs.readFile(path.join(root, second.previewPath)), firstBytes);
  assert.deepEqual(await fs.readFile(path.join(root, first.previewPath)), firstBytes);
  assert.equal(closed, 2);
});
