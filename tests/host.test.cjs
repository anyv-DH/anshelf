/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createHost } = require('../desktop/host.cjs');

test('rebuilding a preview changes its URL while preserving the managed file path', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-host-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'weapon.fla');
  await fs.writeFile(source, 'synthetic-fla');
  const host = await createHost({ root: path.join(base, 'library'), render: async asset => ({ previewPath: `previews/${asset.id}.png`, width: 100, height: 100, frames: 1 }) });
  await host.api.importPaths([source]);
  await host.queue.idle();
  const first = (await host.api.snapshot()).assets[0];
  await host.api.retryPreview(first.id);
  await host.queue.idle();
  const second = (await host.api.snapshot()).assets[0];
  assert.equal(second.previewPath, first.previewPath);
  assert.notEqual(second.previewUrl, first.previewUrl);
  assert.equal(second.previewStatus, 'ready');
});

test('an invalid same-name image falls back to automatic rendering', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-host-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'weapon.fla');
  await fs.writeFile(source, 'synthetic-fla');
  await fs.writeFile(path.join(base, 'weapon.png'), 'broken-image');
  let renders = 0;
  const host = await createHost({ root: path.join(base, 'library'), validateImage: async () => false,
    render: async asset => { renders++; return { previewPath: `previews/${asset.id}.png` }; } });
  await host.api.importPaths([source], { preferExistingPreview: true });
  await host.queue.idle();
  assert.equal(renders, 1);
  assert.equal((await host.api.snapshot()).assets[0].previewOrigin, 'rendered');
});

test('a sidecar validation exception does not stop the import preview queue', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-host-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'weapon.fla');
  await fs.writeFile(source, 'synthetic-fla');
  await fs.writeFile(path.join(base, 'weapon.png'), 'broken-image');
  let renders = 0;
  const host = await createHost({ root: path.join(base, 'library'), validateImage: async () => { throw new Error('image decode failed'); },
    render: async asset => { renders++; return { previewPath: `previews/${asset.id}.png` }; } });
  await host.api.importPaths([source], { preferExistingPreview: true });
  await host.queue.idle();
  assert.equal(renders, 1);
  assert.equal((await host.api.snapshot()).assets[0].previewOrigin, 'rendered');
});

test('opening an asset in Animate uses a separate editable copy and rejects invalid managed sources', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-open-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'original.fla');
  await fs.writeFile(source, 'original-data');
  const opened = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), openInAnimate: async file => { opened.push(file); return true; } });
  await host.api.importPaths([source]);
  await host.queue.idle();
  const asset = host.library.snapshot().assets[0];
  assert.equal(await host.api.openInAnimate(asset.id), true);
  assert.notEqual(opened[0], host.library.assetPath(asset.id));
  assert.equal(path.dirname(path.dirname(opened[0])), path.join(host.root, 'opened'));
  assert.equal(path.extname(opened[0]), '.fla');
  assert.equal(await fs.readFile(opened[0], 'utf8'), 'original-data');
  assert.notEqual(opened[0], source);
  assert.equal(await fs.readFile(source, 'utf8'), 'original-data');
  await assert.rejects(host.api.openInAnimate(source), /素材/);
  const record = host.library.state.assets[0];
  record.managedPath = '../original.fla';
  await assert.rejects(host.api.openInAnimate(asset.id), /目录|路径/);
  record.managedPath = 'assets/unsafe.txt';
  await fs.writeFile(path.join(host.root, record.managedPath), 'plain-text');
  await assert.rejects(host.api.openInAnimate(asset.id), /FLA/);
  record.managedPath = 'assets/missing.fla';
  await assert.rejects(host.api.openInAnimate(asset.id), /不存在/);
  await fs.symlink(base, path.join(host.root, 'assets/link'), process.platform === 'win32' ? 'junction' : 'dir');
  record.managedPath = 'assets/link/original.fla';
  await assert.rejects(host.api.openInAnimate(asset.id), /链接|路径/);
  assert.equal(opened.length, 1);
});

test('opening an asset in Animate keeps a safe meaningful basename while isolating concurrent copies', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-open-name-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, '都市人物_女主角.fla');
  await fs.writeFile(source, 'original-data');
  const opened = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), openInAnimate: async file => { opened.push(file); return true; } });
  await host.api.importPaths([source]);
  const asset = host.library.snapshot().assets[0];
  await Promise.all([host.api.openInAnimate(asset.id), host.api.openInAnimate(asset.id)]);
  assert.equal(opened.length, 2);
  assert.match(path.basename(opened[0]), /^都市人物_女主角(?:-\d+)?\.fla$/);
  assert.match(path.basename(opened[1]), /^都市人物_女主角(?:-\d+)?\.fla$/);
  assert.notEqual(opened[0], opened[1]);
  assert.equal(path.dirname(path.dirname(opened[0])), path.join(host.root, 'opened'));
  assert.equal(path.dirname(path.dirname(opened[1])), path.join(host.root, 'opened'));
  assert.equal(await fs.readFile(source, 'utf8'), 'original-data');
  assert.equal(await fs.readFile(opened[0], 'utf8'), 'original-data');
  await host.library.updateAsset(asset.id, { name: '../CON:*?' });
  await host.api.openInAnimate(asset.id);
  assert.ok(!/[<>:"/\\|?*]/.test(path.basename(opened[2])));
  assert.equal(path.dirname(path.dirname(opened[2])), path.join(host.root, 'opened'));
  await host.queue.idle();
});

test('import asks for Animate once for pending FLA previews without blocking import', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-auto-animate-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'a.fla');
  await fs.writeFile(source, 'a');
  let starts = 0;
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), ensureAnimateRunning: async () => { starts++; } });
  const result = await host.api.importPaths([source]);
  assert.equal(result.added, 1);
  assert.equal(starts, 1);
  await host.api.importPaths([source], { preferExistingPreview: false });
  assert.equal(starts, 2);
  await host.queue.idle();
});

test('Animate startup failure does not block offline preview queue', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-auto-animate-failure-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'a.fla');
  await fs.writeFile(source, 'a');
  const notices = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), ensureAnimateRunning: async () => { throw new Error('AN unavailable'); }, onImportNotice: message => notices.push(message) });
  const result = await host.api.importPaths([source]);
  assert.equal(result.added, 1);
  assert.equal(host.library.snapshot().assets.length, 1);
  await host.animateIdle();
  assert.match(notices[0], /AN unavailable/);
  await host.queue.idle();
});

test('sidecar-only and audio imports never request Animate startup', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-auto-skip-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const fla = path.join(base, '已有预览.fla'), audio = path.join(base, '声音.wav');
  await fs.writeFile(fla, 'fla'); await fs.writeFile(path.join(base, '已有预览.png'), 'preview'); await fs.writeFile(audio, 'audio');
  let starts = 0;
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), ensureAnimateRunning: async () => starts++ });
  await host.api.importPaths([fla]); await host.api.importPaths([audio], { mode: 'audio' });
  assert.equal(starts, 0); assert.equal(host.library.snapshot().assets.length, 2);
  await host.queue.idle();
});

test('Animate saves only the opened copy while source and content-addressed bytes remain immutable', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-editable-open-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'original.fla');
  await fs.writeFile(source, 'original-bytes');
  const opened = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), openInAnimate: async file => { opened.push(file); await fs.writeFile(file, 'saved-in-animate'); return true; } });
  await host.api.importPaths([source]);
  await host.queue.idle();
  const asset = host.library.snapshot().assets[0];
  await host.api.openInAnimate(asset.id);
  await host.api.openInAnimate(asset.id);
  assert.notEqual(opened[0], opened[1]);
  assert.equal(await fs.readFile(opened[0], 'utf8'), 'saved-in-animate');
  assert.equal(await fs.readFile(opened[1], 'utf8'), 'saved-in-animate');
  assert.equal(await fs.readFile(source, 'utf8'), 'original-bytes');
  assert.equal(await fs.readFile(host.library.assetPath(asset.id), 'utf8'), 'original-bytes');
  assert.equal(host.library.getAsset(asset.id).hash, asset.hash);
  assert.equal((await host.api.send(asset.id)).asset.hash, asset.hash);
});

test('reveals an existing original FLA before falling back to the managed copy', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-reveal-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const first = path.join(base, 'first.fla'), second = path.join(base, 'second.fla');
  await fs.writeFile(first, 'same-bytes');
  await fs.writeFile(second, 'same-bytes');
  const revealed = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), revealFile: async file => { revealed.push(file); return true; } });
  await host.api.importPaths([first, second]);
  await host.queue.idle();
  const asset = host.library.snapshot().assets[0];
  assert.deepEqual(await host.api.revealInFolder(asset.id), { location: 'original' });
  assert.equal(revealed.at(-1), first);
  await fs.rm(first);
  assert.deepEqual(await host.api.revealInFolder(asset.id), { location: 'original' });
  assert.equal(revealed.at(-1), second);
  await fs.rm(second);
  assert.deepEqual(await host.api.revealInFolder(asset.id), { location: 'managed' });
  assert.equal(revealed.at(-1), host.library.assetPath(asset.id));
  assert.equal(await fs.readFile(host.library.assetPath(asset.id), 'utf8'), 'same-bytes');
});

test('revealInFolder rejects invalid IDs, linked originals and missing managed files', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-reveal-invalid-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'source.fla'), linkedDirectory = path.join(base, 'linked'), linked = path.join(linkedDirectory, 'source.fla');
  await fs.writeFile(source, 'immutable');
  await fs.symlink(base, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  const revealed = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), revealFile: async file => { revealed.push(file); return true; } });
  await host.api.importPaths([source]);
  await host.queue.idle();
  const asset = host.library.state.assets[0];
  asset.sourcePaths = [linked];
  for (const id of [null, '', '../outside', 'unknown-id', source, [asset.id], { id: asset.id }]) await assert.rejects(host.api.revealInFolder(id), /素材|ID/);
  assert.deepEqual(await host.api.revealInFolder(asset.id), { location: 'managed' });
  assert.equal(revealed.length, 1);
  await fs.rm(host.library.assetPath(asset.id));
  await assert.rejects(host.api.revealInFolder(asset.id), /不存在|受管理/);
  assert.deepEqual(await fs.readFile(source, 'utf8'), 'immutable');
});

test('revealInFolder ignores malformed, relative and non-file original paths', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-reveal-types-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'original.FLA'), text = path.join(base, 'document.txt'), directory = path.join(base, 'directory.fla');
  await fs.writeFile(source, 'original-bytes');
  await fs.writeFile(text, 'not-an-asset');
  await fs.mkdir(directory);
  const revealed = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), revealFile: async file => { revealed.push(file); } });
  await host.api.importPaths([source]);
  await host.queue.idle();
  const asset = host.library.state.assets[0];
  asset.sourcePaths = [null, {}, 123, 'relative.fla', source + '\0', text, directory, source];
  assert.deepEqual(await host.api.revealInFolder(asset.id), { location: 'original' });
  assert.deepEqual(revealed, [source]);
});

test('revealInFolder uses native filesystem visibility instead of Electron virtual ASAR files', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-reveal-asar-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'original.fla');
  await fs.writeFile(source, 'immutable-original');
  const archive = path.join(base, 'app.asar'), virtual = path.join(archive, 'demo', 'virtual.fla');
  await fs.writeFile(archive, 'regular-archive-file');
  const revealed = [], nativeQueries = [];
  const electronFs = { ...fs, lstat: async file => {
    if (file === virtual) return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    if (file === path.dirname(virtual) || file === archive) return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
    return fs.lstat(file);
  } };
  const nativeFs = { promises: { lstat: async file => { nativeQueries.push(file); return fs.lstat(file); } } };
  const module = { exports: {} };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../desktop/host.cjs'), 'utf8'), {
    module, __dirname: path.join(__dirname, '../desktop'), process: { versions: { electron: '44.7.0' } },
    require: name => name === 'node:fs/promises' ? electronFs : name === 'original-fs' ? nativeFs : name === './host-sync.cjs' ? require('../desktop/host-sync.cjs') : require(name),
  });
  const host = await module.exports.createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), revealFile: async file => { revealed.push(file); } });
  await host.api.importPaths([source]);
  await host.queue.idle();
  const asset = host.library.state.assets[0];
  asset.sourcePaths = [virtual];
  assert.equal((await host.api.revealInFolder(asset.id)).location, 'managed');
  assert.ok(nativeQueries.includes(virtual));
  assert.deepEqual(revealed, [host.library.assetPath(asset.id)]);
  const actualDirectory = path.join(base, 'real.asar'), actualSource = path.join(actualDirectory, 'original.fla');
  await fs.mkdir(actualDirectory);
  await fs.writeFile(actualSource, 'real-directory-original');
  asset.sourcePaths = [actualSource];
  assert.equal((await host.api.revealInFolder(asset.id)).location, 'original');
  assert.equal(revealed.at(-1), actualSource);
  assert.ok(nativeQueries.includes(actualDirectory));
});

test('revealing an original file does not modify its bytes or metadata', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-reveal-preserve-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'original.fla');
  await fs.writeFile(source, 'immutable-original');
  const before = await fs.stat(source);
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), revealFile: async () => true });
  await host.api.importPaths([source]);
  await host.queue.idle();
  const snapshot = host.library.snapshot();
  await host.api.revealInFolder(snapshot.assets[0].id);
  assert.deepEqual(host.library.snapshot(), snapshot);
  assert.equal(await fs.readFile(source, 'utf8'), 'immutable-original');
  const after = await fs.stat(source);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(await fs.readFile(host.library.assetPath(snapshot.assets[0].id), 'utf8'), 'immutable-original');
});

test('revealInFolder rejects unsafe managed fallbacks instead of opening arbitrary paths', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-reveal-fallback-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'original.fla');
  await fs.writeFile(source, 'immutable-original');
  let reveals = 0;
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), revealFile: async () => { reveals++; } });
  await host.api.importPaths([source]);
  await host.queue.idle();
  const asset = host.library.state.assets[0];
  asset.sourcePaths = [];
  asset.managedPath = '../original.fla';
  await assert.rejects(host.api.revealInFolder(asset.id), /路径|受管理/);
  await fs.symlink(base, path.join(host.root, 'assets/link'), process.platform === 'win32' ? 'junction' : 'dir');
  asset.managedPath = 'assets/link/original.fla';
  await assert.rejects(host.api.revealInFolder(asset.id), /链接|路径|受管理/);
  asset.managedPath = 'assets/document.txt';
  await fs.writeFile(path.join(host.root, asset.managedPath), 'text');
  await assert.rejects(host.api.revealInFolder(asset.id), /FLA|受管理/);
  assert.equal(reveals, 0);
});

test('revealInFolder reports unavailable native capability and propagates native failures', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-reveal-native-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'original.fla');
  await fs.writeFile(source, 'immutable-original');
  const unavailable = await createHost({ root: path.join(base, 'first-library'), render: async () => ({ previewPath: null }) });
  const failing = await createHost({ root: path.join(base, 'second-library'), render: async () => ({ previewPath: null }), revealFile: async () => { throw new Error('Explorer failed'); } });
  for (const host of [unavailable, failing]) { await host.api.importPaths([source]); await host.queue.idle(); }
  await assert.rejects(unavailable.api.revealInFolder(unavailable.library.snapshot().assets[0].id), /无法|不可用/);
  await assert.rejects(failing.api.revealInFolder(failing.library.snapshot().assets[0].id), /Explorer failed/);
});

test('an opened-copy directory link cannot redirect Animate copies outside the library', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-open-link-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'original.fla'), outside = path.join(base, 'outside');
  await fs.writeFile(source, 'original-bytes');
  await fs.mkdir(outside);
  let opens = 0;
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), openInAnimate: async () => { opens++; return true; } });
  await host.api.importPaths([source]);
  await host.queue.idle();
  await fs.symlink(outside, path.join(host.root, 'opened'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(host.api.openInAnimate(host.library.snapshot().assets[0].id), /链接|路径/);
  assert.equal(opens, 0);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('concurrent first opens each keep a distinct editable copy', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-open-concurrent-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'original.fla');
  await fs.writeFile(source, 'original-bytes');
  const opened = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), openInAnimate: async file => { opened.push(file); return true; } });
  await host.api.importPaths([source]);
  await host.queue.idle();
  const asset = host.library.snapshot().assets[0];
  await Promise.all(Array.from({ length: 8 }, () => host.api.openInAnimate(asset.id)));
  assert.equal(new Set(opened).size, 8);
  for (const file of opened) assert.equal(await fs.readFile(file, 'utf8'), 'original-bytes');
  assert.equal(await fs.readFile(host.library.assetPath(asset.id), 'utf8'), 'original-bytes');
});

test('desktop control API accepts only fixed themes and window actions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-controls-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const themes = [], actions = [];
  const host = await createHost({ root, render: async () => ({}), setTheme: async theme => { themes.push(theme); return theme; }, windowAction: async action => { actions.push(action); return { maximized: action === 'maximize' }; } });
  assert.equal(await host.api.setTheme('warm'), 'warm');
  assert.equal(await host.api.setTheme('dark'), 'dark');
  assert.deepEqual(await host.api.windowAction('maximize'), { maximized: true });
  await host.api.windowAction('minimize');
  await host.api.windowAction('close');
  for (const invalid of ['light', '', {}, null]) await assert.rejects(host.api.setTheme(invalid), /主题/);
  for (const invalid of ['restore', '', {}, null]) await assert.rejects(host.api.windowAction(invalid), /窗口/);
  assert.deepEqual(themes, ['warm', 'dark']);
  assert.deepEqual(actions, ['maximize', 'minimize', 'close']);
});

test('sandbox preload exposes fixed desktop controls through the existing IPC channel', async () => {
  let shelf;
  const calls = [];
  const electron = { contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'shelf'); shelf = value; } }, ipcRenderer: { invoke: async (...args) => { calls.push(args); return true; } } };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../desktop/preload.cjs'), 'utf8'), { require: name => { assert.equal(name, 'electron'); return electron; } });
  assert.ok(Object.isFrozen(shelf));
  await shelf.openInAnimate('asset-id');
  await shelf.revealInFolder('asset-id');
  await shelf.setTheme('warm');
  await shelf.windowAction('maximize');
  assert.deepEqual(calls.map(([channel, method, args]) => [channel, method, Array.from(args)]), [['shelf:call', 'openInAnimate', ['asset-id']], ['shelf:call', 'revealInFolder', ['asset-id']], ['shelf:call', 'setTheme', ['warm']], ['shelf:call', 'windowAction', ['maximize']]]);
  assert.equal(shelf.importPaths, undefined);
  assert.equal(shelf.revealFile, undefined);
});

test('desktop IPC rejects non-string method names before property-key coercion', async () => {
  const app = new EventEmitter();
  Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), getPath: () => 'C:\\AppData', getAppPath: () => path.join(__dirname, '..'), isPackaged: false, quit() {} });
  let window, handler;
  class FakeWindow {
    constructor() { window = this; this.webContents = { setWindowOpenHandler() {}, on() {} }; }
    loadFile() { return Promise.resolve(); }
  }
  let imports = 0;
  const api = { snapshot: async () => 'snapshot-ok', revealInFolder: async id => ({ location: 'original', id }), importPaths: async () => { imports++; return true; } };
  const electron = { app, BrowserWindow: FakeWindow, dialog: { showErrorBox: (title, error) => { throw new Error(title + error); } }, ipcMain: { on() {}, handle: (channel, callback) => { assert.equal(channel, 'shelf:call'); handler = callback; } }, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, session: { defaultSession: { webRequest: { onBeforeRequest() {} } } }, shell: {}, nativeImage: {}, net: {} };
  const context = { require: name => name === 'electron' ? electron : name === './host.cjs' ? { createHost: async () => ({ api, library: {} }) } : name === './previews.cjs' ? { createRenderer: () => async () => ({}) } : name === './gif-poster.cjs' ? { createGifPoster: () => async () => true } : name.startsWith('./') ? require('../desktop/' + name.slice(2)) : require(name), __dirname: path.join(__dirname, '../desktop'), process: { env: {}, resourcesPath: 'C:\\resources' }, URL, Response };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const event = { sender: window.webContents };
  assert.equal(await handler(event, 'snapshot', []), 'snapshot-ok');
  assert.deepEqual(await handler(event, 'revealInFolder', ['known-asset']), { location: 'original', id: 'known-asset' });
  for (const method of ['importPaths', ['importPaths'], { toString: () => 'importPaths' }, ['snapshot'], null]) await assert.rejects(handler(event, method, []), /不允许/);
  await assert.rejects(handler({ sender: {} }, 'snapshot', []), /不允许/);
  await assert.rejects(handler(event, 'revealFile', ['C:\\outside.fla']), /不允许/);
  assert.equal(imports, 0);
});

test('category APIs forward parent IDs and preserve omitted rename parent', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-category-host-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const host = await createHost({ root, render: async () => ({}) });
  const calls = [];
  host.library.createCategory = (...args) => { calls.push(['create', ...args]); return {}; };
  host.library.renameCategory = (...args) => { calls.push(['rename', ...args]); return {}; };
  await host.api.createCategory('人物', 'parent-id');
  await host.api.createCategory('环境音', null, 'audio');
  await host.api.createCategory('爆炸', null, 'effect');
  await host.api.renameCategory('child-id', '主角', 'next-parent');
  await host.api.renameCategory('child-id', '配角');
  assert.deepEqual(calls, [['create', '人物', 'parent-id', 'all'], ['create', '环境音', null, 'audio'], ['create', '爆炸', null, 'effect'], ['rename', 'child-id', '主角', 'next-parent'], ['rename', 'child-id', '配角', undefined]]);
});

test('frameless desktop callbacks apply theme, window controls and propagate native open failures', async t => {
  const app = new EventEmitter();
  Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), getPath: () => 'C:\\AppData', getAppPath: () => path.join(__dirname, '..'), isPackaged: false, quit() {} });
  let options, callbacks, window;
  class FakeWindow {
    constructor(value) { options = value; window = this; this.maximized = false; this.webContents = { setWindowOpenHandler() {}, on() {} }; }
    setBackgroundColor(color) { this.color = color; }
    minimize() { this.minimized = true; }
    maximize() { this.maximized = true; }
    unmaximize() { this.maximized = false; }
    isMaximized() { return this.maximized; }
    isDestroyed() { return Boolean(this.closed); }
    close() { this.closed = true; }
    setAlwaysOnTop(value) { this.topmost = value; }
    setSize() {}
    loadFile() { return Promise.resolve(); }
  }
  let openError = '', revealError = false, openCalls = [], spawnCalls = [], revealed = [];
  const launchProcess = (executable, args, options) => { spawnCalls.push({ executable, args, options }); const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child; };
  const electron = { app, BrowserWindow: FakeWindow, dialog: { showErrorBox: (title, error) => { throw new Error(title + error); } }, ipcMain: { on() {}, handle() {} }, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, session: { defaultSession: { webRequest: { onBeforeRequest() {} } } }, shell: { openPath: async file => { openCalls.push(file); return openError; }, showItemInFolder: file => { if (revealError) throw new Error('Explorer failed'); revealed.push(file); } }, nativeImage: {}, net: {} };
  const context = { require: name => name === 'electron' ? electron : name === 'node:child_process' ? { spawn: launchProcess } : name === './host.cjs' ? { createHost: async value => { callbacks = value; return { api: {}, library: {} }; } } : name === './previews.cjs' ? { createRenderer: () => async () => ({}) } : name === './gif-poster.cjs' ? { createGifPoster: () => async () => true } : name.startsWith('./') ? require('../desktop/' + name.slice(2)) : require(name), __dirname: path.join(__dirname, '../desktop'), process: { env: {}, resourcesPath: 'C:\\resources', platform: process.platform }, URL, Response };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(options.frame, false);
  assert.equal(options.title, '安安素材管理器');
  assert.equal(await callbacks.setTheme('warm'), 'warm');
  assert.match(window.color, /^#[a-f0-9]{6}$/i);
  assert.equal(await callbacks.setTheme('dark'), 'dark');
  assert.notEqual(window.color, '#ffffff');
  assert.equal(await callbacks.compact(), true);
  assert.equal(window.topmost, true);
  assert.equal((await callbacks.windowAction('maximize')).maximized, true);
  assert.equal(window.topmost, false, 'maximum view must allow another app to cover the manager');
  assert.equal((await callbacks.windowAction('maximize')).maximized, false);
  await callbacks.windowAction('minimize');
  assert.equal(window.minimized, true);
  await callbacks.revealFile('C:\\AppData\\AnShelf\\assets\\valid.fla');
  assert.deepEqual(revealed, ['C:\\AppData\\AnShelf\\assets\\valid.fla']);
  assert.equal(openCalls.length, 0);
  revealError = true;
  await assert.rejects(callbacks.revealFile('C:\\AppData\\AnShelf\\assets\\valid.fla'), /Explorer failed/);
  assert.equal(await callbacks.openInAnimate('C:\\AppData\\AnShelf\\assets\\valid.fla'), true);
  openError = 'No application association';
  await assert.rejects(callbacks.openInAnimate('C:\\AppData\\AnShelf\\assets\\valid.fla'), /AN|Animate/);
  assert.equal(openCalls.length, 2);
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-animate-config-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const executable = path.join(folder, 'Animate.exe');
  await fs.writeFile(executable, 'test-process-placeholder');
  context.process.env.ANSHELF_ANIMATE_EXE = executable;
  assert.equal(await callbacks.openInAnimate('C:\\AppData\\AnShelf\\assets\\valid.fla'), true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].executable, executable);
  assert.deepEqual(Array.from(spawnCalls[0].args), ['C:\\AppData\\AnShelf\\assets\\valid.fla']);
  assert.equal(spawnCalls[0].options.shell, false);
  context.process.env.ANSHELF_ANIMATE_EXE = folder;
  await assert.rejects(callbacks.openInAnimate('C:\\AppData\\AnShelf\\assets\\valid.fla'), /无效/);
  assert.equal(spawnCalls.length, 1);
  await callbacks.windowAction('close');
  assert.equal(window.closed, true);
});
