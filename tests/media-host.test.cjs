/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHost } = require('../desktop/host.cjs');
async function fixture(t, extra = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-media-host-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, '声音.wav'); await fs.writeFile(source, 'audio-bytes');
  const fla = path.join(base, '人物.fla'); await fs.writeFile(fla, 'fla-bytes');
  const renders = [], revealed = [], picks = [];
  const host = await createHost({ root: path.join(base, 'library'),
    render: async a => { renders.push(a.id); return { previewPath: null }; },
    revealFile: async file => revealed.push(file), pickFiles: async options => { picks.push(options); return [source]; }, ...extra });
  return { base, source, fla, host, renders, revealed, picks };
}
test('audio picker forwards mode, skips preview work and provides only local media URL', async t => {
  const { host, renders, picks } = await fixture(t);
  await host.api.importFiles({ mode: 'audio' }); await host.queue.idle();
  const snapshot = await host.api.snapshot(); const audio = snapshot.assets[0];
  assert.equal(picks[0].mode, 'audio'); assert.equal(audio.kind, 'audio');
  assert.equal(audio.mediaUrl, `anshelf://media/${audio.id}`); assert.equal(audio.previewUrl, null);
  assert.deepEqual(renders, []);
  await assert.rejects(host.api.retryPreview(audio.id), /音频/);
  await assert.rejects(host.api.send(audio.id), /FLA|音频/);
  await assert.rejects(host.api.openInAnimate(audio.id), /FLA|音频/);
});
test('audio reveal and drag validate known IDs, extension and byte hash', async t => {
  const { host, source, revealed } = await fixture(t);
  await host.api.importPaths([source], { mode: 'audio' });
  const audio = host.library.snapshot().assets[0];
  assert.deepEqual(await host.api.revealInFolder(audio.id), { location: 'original' });
  assert.deepEqual(revealed, [source]);
  const descriptor = await host.api.prepareDrag(audio.id);
  assert.equal(descriptor.kind, 'audio'); assert.equal(descriptor.file, host.library.assetPath(audio.id));
  assert.equal((await host.api.snapshot()).bridge.pending, null);
  for (const id of [source, null, [], {}, 'missing']) await assert.rejects(host.api.prepareDrag(id), /素材/);
  await fs.writeFile(descriptor.file, 'changed');
  await assert.rejects(host.api.prepareDrag(audio.id), /校验|完整/);
});
test('FLA never creates a native file drag or a pending transfer', async t => {
  const { host, fla } = await fixture(t);
  await host.api.importPaths([fla]); await host.queue.idle();
  const asset = host.library.snapshot().assets[0];
  await assert.rejects(host.api.prepareDrag(asset.id), /舞台拖动|FLA/);
  assert.equal((await host.api.snapshot()).bridge.pending, null);
  await assert.rejects(fs.stat(path.join(host.root,'bridge/drag')), /ENOENT/);
});

for (const [firstMode, nextMode] of [['ordinary', 'effect'], ['effect', 'ordinary']]) test(`reimport ${firstMode} as ${nextMode} during rendering discards old output and renders the selected type`, async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const modes = [];
  const { host, fla } = await fixture(t, { render: async asset => {
    modes.push(asset.assetType);
    if (modes.length === 1) { entered(); await gate; }
    return { previewPath: `previews/${asset.id}.${asset.assetType === 'effect' ? 'gif' : 'png'}`, previewFormat: asset.assetType === 'effect' ? 'gif' : 'png', previewAnimated: asset.assetType === 'effect' };
  } });
  await host.api.importPaths([fla], { mode: firstMode }); await started;
  await host.api.importPaths([fla], { mode: nextMode }); release(); await host.queue.idle();
  assert.deepEqual(modes, [firstMode, nextMode]);
  const asset = host.library.snapshot().assets[0];
  assert.equal(asset.assetType, nextMode); assert.equal(asset.previewAnimated, nextMode === 'effect');
});
