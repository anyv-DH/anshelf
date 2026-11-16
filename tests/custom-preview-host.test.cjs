/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createHost } = require('../desktop/host.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64');

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-custom-host-'));
  const source = path.join(directory, '人物.fla');
  const oldImage = path.join(directory, '人物.png');
  const replacement = path.join(directory, '新封面.png');
  await fs.writeFile(source, 'private-original-fla');
  await fs.writeFile(oldImage, png);
  await fs.writeFile(replacement, png);
  const host = await createHost({ root: path.join(directory, 'library'), render: async () => ({}),
    pickPreviewFile: async () => [replacement], ...options });
  t.after(async () => { host.close?.(); await host.queue.idle(); await fs.rm(directory, { recursive: true, force: true }); });
  const asset = (await host.api.importPaths([source])).assets[0];
  await host.queue.idle();
  return { directory, source, oldImage, replacement, host, asset };
}

test('choosing a preview replaces only the cached image and refreshes its URL', async t => {
  const { host, asset, source, replacement } = await fixture(t);
  const category = await host.api.createCategory('新封面专用分类');
  await host.api.assignCategory([asset.id], category.id);
  await host.api.updateAsset(asset.id, { favorite: true, tags: ['新封面测试'] });
  const before = (await host.api.snapshot()).assets[0];
  const oldPath = host.library.previewPath(asset.id);
  const result = await host.api.replacePreview(asset.id);
  const after = (await host.api.snapshot()).assets[0];
  assert.equal(result.cancelled, false);
  assert.equal(result.assetId, asset.id);
  assert.equal(after.previewOrigin, 'custom');
  assert.equal(after.previewStatus, 'ready');
  assert.notEqual(after.previewUrl, before.previewUrl);
  assert.notEqual(after.previewPath, before.previewPath);
  for (const key of ['hash', 'managedPath', 'categoryIds', 'favorite', 'tags']) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(await fs.readFile(host.library.previewPath(asset.id)), png);
  assert.deepEqual(await fs.readFile(oldPath), png);
  assert.deepEqual(await fs.readFile(replacement), png);
  assert.equal(await fs.readFile(source, 'utf8'), 'private-original-fla');
});

test('cancelled preview selection writes no index, image or queue changes', async t => {
  const { host, asset } = await fixture(t, { pickPreviewFile: async () => [] });
  const before = await fs.readFile(path.join(host.root, 'library.json'));
  const files = await fs.readdir(path.join(host.root, 'previews'));
  const state = host.library.snapshot();
  assert.deepEqual(await host.api.replacePreview(asset.id), { cancelled: true });
  assert.deepEqual(await fs.readFile(path.join(host.root, 'library.json')), before);
  assert.deepEqual(await fs.readdir(path.join(host.root, 'previews')), files);
  assert.deepEqual(host.library.snapshot(), state);
});

test('failed regeneration keeps the previous usable preview visible and never removes its bytes', async t => {
  const { host, asset } = await fixture(t);
  const before=host.library.getAsset(asset.id);
  const bytes=await fs.readFile(host.library.previewPath(asset.id));
  host.queue.render=async()=>{throw new Error('无法解析此素材');};
  await host.api.retryPreview(asset.id);await host.queue.idle();
  const after=(await host.api.snapshot()).assets.find(item=>item.id===asset.id);
  assert.equal(after.previewStatus,'ready');
  assert.equal(after.previewPath,before.previewPath);
  assert.ok(after.previewUrl);
  assert.match(after.previewWarning,/失败.*保留/);
  assert.deepEqual(await fs.readFile(host.library.previewPath(asset.id)),bytes);
});

test('restoring a preview swaps back the previous image without opening another picker', async t => {
  const { host, asset } = await fixture(t);
  const before = host.library.getAsset(asset.id);
  await host.api.replacePreview(asset.id);
  const replacement = host.library.getAsset(asset.id);
  assert.ok(replacement.previewUndoUntil > Date.now());
  const result = await host.api.restorePreview(asset.id);
  const restored = host.library.getAsset(asset.id);
  assert.equal(result.cancelled, false);
  assert.equal(result.assetId, asset.id);
  assert.equal(restored.previewPath, before.previewPath);
  assert.notEqual(restored.previewRevision, replacement.previewRevision);
  assert.equal(restored.managedPath, before.managedPath);
  assert.equal(restored.hash, before.hash);
});

test('preview replacement rejects unknown assets and audio before opening a picker', async t => {
  let picks = 0;
  const { host, directory } = await fixture(t, { pickPreviewFile: async () => { picks++; return []; } });
  const audio = path.join(directory, '音频.mp3');
  await fs.writeFile(audio, 'audio');
  const audioAsset = (await host.api.importPaths([audio], { mode: 'audio' })).assets[0];
  await assert.rejects(host.api.replacePreview('../outside.png'), /素材/);
  await assert.rejects(host.api.replacePreview(audioAsset.id), /音频/);
  assert.equal(picks, 0);
});

test('an unreadable chosen image preserves the previous preview', async t => {
  const { host, asset } = await fixture(t);
  // Import sidecar decoding has already completed. Reject only the manual choice.
  const before = await fs.readFile(path.join(host.root, 'library.json'));
  const bad = path.join(path.dirname(host.root), 'broken.png');
  await fs.writeFile(bad, 'not-an-image');
  const second = await createHost({ root: host.root, render: async () => ({}),
    pickPreviewFile: async () => [bad], validateImage: async () => false });
  t.after(() => second.close?.());
  await assert.rejects(second.api.replacePreview(asset.id), /预览|图片/);
  assert.deepEqual(await fs.readFile(path.join(host.root, 'library.json')), before);
});

test('an earlier pending render cannot restore its preview after a manual replacement', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const { host, asset } = await fixture(t);
  host.queue.render = async a => {
    started(); await gate;
    const relative = `previews/${a.id}-older.png`;
    await fs.writeFile(path.join(host.root, relative), png);
    return { previewPath: relative };
  };
  await host.api.retryPreview(asset.id);
  await began;
  try { await host.api.replacePreview(asset.id); }
  finally { release(); }
  await host.queue.idle();
  assert.equal(host.library.getAsset(asset.id).previewOrigin, 'custom');
  assert.ok(!host.library.getAsset(asset.id).previewPath.endsWith('-older.png'));
  const retired=host.library.state.retiredPreviews.find(item=>item.path.endsWith('-older.png'));
  assert.ok(retired,'discarded render is retained for bounded cleanup');
  await host.library.cleanupExpiredPreviews(retired.deleteAfter);
  await assert.rejects(fs.access(path.join(host.root,retired.path)),{code:'ENOENT'});
  await fs.access(host.library.previewPath(asset.id));
});

test('sandbox replacement bridge exposes an asset-ID action without a renderer file path capability', async () => {
  let shelf;
  const calls = [];
  const electron = { contextBridge: { exposeInMainWorld: (_name, value) => { shelf = value; } },
    ipcRenderer: { invoke: async (...args) => { calls.push(args); return { cancelled: true }; } } };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../desktop/preload.cjs'), 'utf8'), { require: () => electron });
  await shelf.replacePreview('known-asset');
  await shelf.restorePreview('known-asset');
  assert.equal(shelf.pickPreviewFile, undefined);
  assert.equal(shelf.replacePreviewPath, undefined);
  assert.deepEqual(calls.map(([channel, method, args]) => [channel, method, Array.from(args)]), [['shelf:call', 'replacePreview', ['known-asset']], ['shelf:call', 'restorePreview', ['known-asset']]]);
});

test('old previews expire while open and closing releases the only cleanup timer', async t => {
  let clock = Date.now();
  const scheduled = new Set();
  const timers = { setTimeout(callback, delay) { const timer = { callback, delay, unref() {} }; scheduled.add(timer); return timer; },
    clearTimeout(timer) { scheduled.delete(timer); } };
  const { host, asset } = await fixture(t, { now: () => clock, previewCleanupTimers: timers });
  assert.equal(scheduled.size, 0);
  const oldPath = host.library.previewPath(asset.id);
  await host.api.replacePreview(asset.id);
  assert.equal(scheduled.size, 1);
  let timer = [...scheduled][0];
  assert.ok(timer.delay > 47 * 60 * 60 * 1000 && timer.delay <= 48 * 60 * 60 * 1000 + 1000);
  clock = host.library.nextPreviewCleanupAt() - 1;
  scheduled.delete(timer); await timer.callback();
  await fs.access(oldPath);
  assert.equal(scheduled.size, 1);
  clock++;
  timer = [...scheduled][0]; scheduled.delete(timer); await timer.callback();
  await assert.rejects(fs.access(oldPath), { code: 'ENOENT' });
  await fs.access(host.library.previewPath(asset.id));
  assert.equal(scheduled.size, 0);
  await host.api.replacePreview(asset.id);
  assert.equal(scheduled.size, 1);
  host.close();
  assert.equal(scheduled.size, 0);
});

test('startup removes expired retired previews before returning the first snapshot', async t => {
  const { host, asset } = await fixture(t);
  const oldPath = host.library.previewPath(asset.id);
  await host.api.replacePreview(asset.id);
  const due = host.library.nextPreviewCleanupAt();
  host.close();
  const reopened = await createHost({ root: host.root, render: async () => ({}), now: () => due });
  t.after(() => reopened.close());
  await assert.rejects(fs.access(oldPath), { code: 'ENOENT' });
  assert.equal((await reopened.api.snapshot()).assets[0].previewOrigin, 'custom');
  await fs.access(reopened.library.previewPath(asset.id));
});

test('a temporarily locked old preview is retried without a zero-delay cleanup loop', async t => {
  let clock = Date.now();
  const scheduled = new Set();
  const timers = { setTimeout(callback, delay) { const timer = { callback, delay, unref() {} }; scheduled.add(timer); return timer; },
    clearTimeout(timer) { scheduled.delete(timer); } };
  const { host, asset } = await fixture(t, { now: () => clock, previewCleanupTimers: timers });
  const oldPath = host.library.previewPath(asset.id);
  await host.api.replacePreview(asset.id);
  clock = host.library.nextPreviewCleanupAt();
  const realUnlink = fs.unlink;
  fs.unlink = async file => { if (file === oldPath) throw Object.assign(new Error('locked by image reader'), { code: 'EBUSY' }); return realUnlink(file); };
  let timer = [...scheduled][0]; scheduled.delete(timer);
  try { await timer.callback(); }
  finally { fs.unlink = realUnlink; }
  await fs.access(oldPath);
  assert.equal(scheduled.size, 1);
  timer = [...scheduled][0];
  assert.equal(timer.delay, 60000);
  clock += timer.delay; scheduled.delete(timer); await timer.callback();
  await assert.rejects(fs.access(oldPath), { code: 'ENOENT' });
  assert.equal(scheduled.size, 0);
});

test('desktop picker limits replacement to one local image and shutdown closes cleanup', async () => {
  const app = new EventEmitter();
  Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    getVersion: () => '0.3.10', getPath: () => 'C:\\AppData', getAppPath: () => path.join(__dirname, '..'), isPackaged: false, quit() {} });
  let callbacks, pickerOptions, closed = 0;
  class FakeWindow {
    constructor() { this.webContents = { setWindowOpenHandler() {}, on() {}, removeListener() {} }; }
    loadFile() { return Promise.resolve(); }
  }
  const electron = { app, BrowserWindow: FakeWindow,
    dialog: { showOpenDialog: async (_window, options) => { pickerOptions = options; return { canceled: true, filePaths: [] }; }, showErrorBox: (title, message) => { throw new Error(title + message); } },
    ipcMain: { on() {}, handle() {}, removeHandler() {}, removeListener() {} }, protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: { defaultSession: { webRequest: { onBeforeRequest() {} } } }, shell: {}, nativeImage: {}, net: {} };
  const context = { require: name => name === 'electron' ? electron : name === './host.cjs' ? { createHost: async value => { callbacks = value; return { api: {}, library: {}, close() { closed++; } }; } }
    : name === './skin.cjs' ? { createSkinController: async () => ({}) } : name === './document-import.cjs' ? { createDocumentImportReceiver: async () => ({ close() {} }) }
    : name === './previews.cjs' ? { createRenderer: () => async () => ({}) } : name === './gif-poster.cjs' ? { createGifPoster: () => async () => true }
    : name.startsWith('./') ? require('../desktop/' + name.slice(2)) : require(name),
    __dirname: path.join(__dirname, '../desktop'), process: { env: {}, resourcesPath: 'C:\\resources' }, URL, Response };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(await callbacks.pickPreviewFile({ name: '人物' })), []);
  assert.deepEqual(Array.from(pickerOptions.properties), ['openFile']);
  assert.deepEqual(Array.from(pickerOptions.filters[0].extensions), ['png', 'jpg', 'jpeg', 'webp', 'gif']);
  assert.match(pickerOptions.title, /更换.*人物.*预览图/);
  app.emit('before-quit');
  assert.equal(closed, 1);
});
