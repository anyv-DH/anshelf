/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSkinController } = require('../desktop/skin.cjs');

async function fixture(t, extension = '.png') {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-skin-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, '我的底图' + extension);
  await fs.writeFile(source, '0123456789');
  const root = path.join(base, 'data');
  const skin = await createSkinController({ root, pickFile: async () => [source] });
  return { base, source, root, skin };
}

test('skin selection references the original file, hides its path and persists tiny settings', async t => {
  const { skin, root, source } = await fixture(t);
  assert.equal((await skin.get()).enabled, false);
  const selected = await skin.select();
  assert.equal(selected.enabled, true);
  assert.equal(selected.type, 'image');
  assert.match(selected.url, /^anshelf:\/\/skin\/background\?rev=/);
  assert.ok(!JSON.stringify(selected).includes(source));
  assert.deepEqual(await fs.readdir(root), ['skin.json']);
  assert.equal((await fs.stat(path.join(root, 'skin.json'))).size < 1024, true);
  const reloaded = await createSkinController({ root });
  assert.deepEqual(await reloaded.get(), selected);
});

test('cancelling skin selection preserves existing choice', async t => {
  const { skin, root } = await fixture(t);
  const before = await skin.select();
  const other = await createSkinController({ root, pickFile: async () => [] });
  assert.deepEqual(await other.select(), before);
});

test('skin settings validate opacity and animation while reset leaves original bytes', async t => {
  const { skin, source, root } = await fixture(t, '.gif');
  await skin.select();
  const changed = await skin.update({ opacity: 0.7, animated: false });
  assert.equal(changed.type, 'gif');
  assert.equal(changed.opacity, 0.7);
  assert.equal(changed.animated, false);
  await assert.rejects(skin.update({ opacity: 10 }), /遮罩|深浅/);
  await assert.rejects(skin.update({ animated: 'yes' }), /播放/);
  await assert.rejects(skin.update({ file: source }), /设置/);
  assert.equal((await skin.reset()).enabled, false);
  assert.equal(await fs.readFile(source, 'utf8'), '0123456789');
  assert.deepEqual(await fs.readdir(root), ['skin.json']);
});

test('skin protocol streams only selected media with MIME, range and HEAD support', async t => {
  const { skin } = await fixture(t, '.mp4');
  const state = await skin.select();
  const all = await skin.respond(new Request(state.url));
  assert.equal(all.status, 200);
  assert.equal(all.headers.get('content-type'), 'video/mp4');
  assert.equal(await all.text(), '0123456789');
  const range = await skin.respond(new Request(state.url, { headers: { Range: 'bytes=2-5' } }));
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await range.text(), '2345');
  const suffix = await skin.respond(new Request(state.url, { headers: { Range: 'bytes=-3' } }));
  assert.equal(await suffix.text(), '789');
  const head = await skin.respond(new Request(state.url, { method: 'HEAD' }));
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  assert.equal((await skin.respond(new Request(state.url, { headers: { Range: 'bytes=50-' } }))).status, 416);
});

test('skin protocol refuses arbitrary paths, stale revisions and mutation methods', async t => {
  const { skin } = await fixture(t);
  const state = await skin.select();
  assert.equal((await skin.respond(new Request('anshelf://skin/elsewhere'))).status, 404);
  assert.equal((await skin.respond(new Request('anshelf://skin/background?rev=bad'))).status, 404);
  assert.equal((await skin.respond(new Request(state.url, { method: 'POST' }))).status, 405);
  await skin.reset();
  assert.equal((await skin.respond(new Request(state.url))).status, 404);
});

test('unsupported and oversized skin files are rejected before altering choice', async t => {
  const { skin, root, base } = await fixture(t);
  const before = await skin.select();
  const bad = path.join(base, 'script.html');
  await fs.writeFile(bad, 'not-a-skin');
  const invalid = await createSkinController({ root, pickFile: async () => bad });
  await assert.rejects(invalid.select(), /PNG|格式/);
  const large = path.join(base, 'huge.webp');
  const handle = await fs.open(large, 'w');
  await handle.truncate(40 * 1024 * 1024 + 1); await handle.close();
  const oversized = await createSkinController({ root, pickFile: async () => large });
  await assert.rejects(oversized.select(), /40/);
  assert.deepEqual(await invalid.get(), before);
});

test('links are refused during selection and after selected files are replaced', async t => {
  const { skin, source, root, base } = await fixture(t);
  const alias = path.join(base, 'alias');
  await fs.symlink(base, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const linked = await createSkinController({ root, pickFile: async () => path.join(alias, path.basename(source)) });
  await assert.rejects(linked.select(), /链接/);
  const selected = await skin.select();
  await fs.unlink(source);
  const missing = await skin.get();
  assert.equal(missing.enabled, false);
  assert.match(missing.error, /文件|失效|不存在/);
  assert.equal((await skin.respond(new Request(selected.url))).status, 404);
});

test('damaged or excessive settings load defaults without exposing saved paths', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'skin.json'), '{broken');
  assert.equal((await (await createSkinController({ root })).get()).enabled, false);
  await fs.writeFile(path.join(root, 'skin.json'), 'x'.repeat(17000));
  assert.equal((await (await createSkinController({ root })).get()).enabled, false);
});
