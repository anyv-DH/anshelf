/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { Bridge } = require('../core/bridge.cjs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HASH = 'a'.repeat(64);
test('stage drop binds a short-lived request to a ready receiver and never replaces pending on rejected targets', t => {
  const {root,asset,bridge}=fixture(t);
  const statusFile=path.join(root,'bridge/status.json');
  const heartbeat={version:1,updatedAt:Date.now(),app:'Animate',busy:false,documentId:42,pid:123,capabilities:{stageDrop:1}};
  const target={documentId:42,pid:123,hwnd:'456'};
  const manual=bridge.send(asset);
  assert.throws(()=>bridge.sendStageDrop(asset,target),/连接|就绪/);
  for(const patch of [{capabilities:null},{documentId:null},{documentId:43},{pid:124},{busy:true},{updatedAt:Date.now()-60000}]){
    fs.writeFileSync(statusFile,JSON.stringify({...heartbeat,...patch}));
    assert.throws(()=>bridge.sendStageDrop(asset,target));
    assert.equal(bridge.status().pending.requestId,manual.requestId);
  }
  fs.writeFileSync(statusFile,JSON.stringify(heartbeat));
  for(const bad of [{...target,documentId:null},{...target,pid:null},{...target,hwnd:'invalid'}])assert.throws(()=>bridge.sendStageDrop(asset,bad));
  const request=bridge.sendStageDrop(asset,target);
  assert.equal(request.delivery,'stage-drop');assert.equal(request.targetDocumentId,42);
  assert.equal(request.expiresAt-request.createdAt,5000);
  assert.equal(bridge.status().pending.requestId,request.requestId);
});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-bridge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.mkdirSync(path.join(root, 'previews'));
  fs.writeFileSync(path.join(root, 'assets', `${HASH}.fla`), 'fixture');
  fs.writeFileSync(path.join(root, 'previews', `${HASH}.png`), 'preview');
  const asset = { id: 'weapon', hash: HASH, name: '武器', managedPath: `assets/${HASH}.fla`, previewPath: `previews/${HASH}.png` };
  return { root, asset, bridge: new Bridge(root) };
}

test('send persists a versioned request with canonical paths and clears obsolete results', t => {
  const { root, asset, bridge } = fixture(t);
  fs.writeFileSync(path.join(root, 'bridge/result.json'), JSON.stringify({ version: 1, ok: true }));
  const request = bridge.send(asset);
  const stored = JSON.parse(fs.readFileSync(path.join(root, 'bridge/pending.json'), 'utf8'));
  assert.equal(stored.version, 1);
  assert.equal(stored.requestId, request.requestId);
  assert.equal(stored.asset.sourcePath, path.join(root, 'assets', `${HASH}.fla`));
  assert.equal(stored.managedRoot, root);
  assert.equal(bridge.status().pending.asset.name, '武器');
  assert.equal(bridge.status().result, null);
  assert.deepEqual(fs.readdirSync(path.join(root, 'bridge')), ['pending.json']);
});

test('send rejects traversal, outside roots, malformed hashes, and symbolic links', t => {
  const { root, asset, bridge } = fixture(t);
  assert.throws(() => bridge.send({ ...asset, managedPath: '../outside.fla' }), /path|路径/i);
  assert.throws(() => bridge.send({ ...asset, managedPath: path.join(root, '../outside.fla') }), /path|路径/i);
  assert.throws(() => bridge.send({ ...asset, hash: 'nope' }), /hash|哈希/i);
  assert.throws(() => bridge.send({ ...asset, previewPath: asset.managedPath }), /path|路径/i);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'outside.fla'), 'outside');
  fs.symlinkSync(outside, path.join(root, 'assets/link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => bridge.send({ ...asset, managedPath: 'assets/link/outside.fla' }), /link|链接|path|路径/i);
  assert.equal(bridge.status().pending, null);
});

test('connection expires with the heartbeat and clear preserves receiver heartbeat', t => {
  const { root, asset, bridge } = fixture(t);
  const statusFile = path.join(root, 'bridge/status.json');
  fs.writeFileSync(statusFile, JSON.stringify({ version: 1, updatedAt: Date.now(), app: 'Animate', busy: false }));
  assert.equal(bridge.status().connected, true);
  fs.writeFileSync(statusFile, JSON.stringify({ version: 1, updatedAt: Date.now() - 60000 }));
  assert.equal(bridge.status().connected, false);
  bridge.send(asset);
  bridge.clear();
  assert.equal(bridge.status().pending, null);
  assert.equal(fs.existsSync(statusFile), true);
  fs.writeFileSync(statusFile, '{bad json');
  assert.equal(bridge.status().connected, false);
});

test('CEP receiver verifies bytes, stages a separate copy and only clears the completed request', t => {
  const { Queue } = require('../plugin/queue.cjs');
  const { root, asset, bridge } = fixture(t);
  const receiver = new Queue(root);
  const hash = crypto.createHash('sha256').update('fixture').digest('hex');
  const request = bridge.send({ ...asset, hash });
  receiver.heartbeat(false);
  assert.equal(bridge.status().connected, true);
  assert.equal(receiver.pending().requestId, request.requestId);
  const prepared = receiver.prepare(request);
  assert.notEqual(prepared.temporaryURI, prepared.asset.sourceURI);
  assert.equal(fs.readFileSync(prepared.temporaryPath, 'utf8'), 'fixture');
  const newer = bridge.send({ ...asset, hash });
  receiver.complete(request, { ok: true });
  assert.equal(bridge.status().pending.requestId, newer.requestId);
  receiver.cleanup(prepared.temporaryPath);
  assert.equal(fs.existsSync(prepared.temporaryPath), false);
  assert.equal(fs.readFileSync(path.join(root, asset.managedPath), 'utf8'), 'fixture');
});

test('CEP receiver refuses tampered bytes and symbolic-link paths', t => {
  const { Queue } = require('../plugin/queue.cjs');
  const { root, asset, bridge } = fixture(t);
  const receiver = new Queue(root);
  const request = bridge.send(asset);
  assert.throws(() => receiver.prepare(request), /哈希|hash/i);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-panel-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'weapon.fla'), 'fixture');
  fs.symlinkSync(outside, path.join(root, 'assets/link'), process.platform === 'win32' ? 'junction' : 'dir');
  request.asset.sourcePath = path.join(root, 'assets/link/weapon.fla');
  fs.writeFileSync(path.join(root, 'bridge/pending.json'), JSON.stringify(request));
  assert.throws(() => receiver.pending(), /路径|链接|path/i);
});

test('CEP receiver stops oversized FLA before reading bytes into memory', t => {
  const { Queue, MAX_FLA_BYTES } = require('../plugin/queue.cjs');
  const { root, asset, bridge } = fixture(t);
  const request = bridge.send(asset);
  const handle = fs.openSync(request.asset.sourcePath, 'r+');
  fs.ftruncateSync(handle, MAX_FLA_BYTES + 1);
  fs.closeSync(handle);
  assert.throws(() => new Queue(root).prepare(request), /过大|size|512/i);
  assert.equal(fs.existsSync(path.join(root, 'bridge/temp')), false);
});

test('Windows CEP installer copies known files and rejects linked installation ancestors', { skip: process.platform !== 'win32' }, t => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-install-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-install-outside-'));
  t.after(() => { fs.rmSync(appData, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const installer = path.join(__dirname, '../plugin/install.ps1');
  const install = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, ...args], { encoding: 'utf8', env: { ...process.env, APPDATA: appData } });
  let result = install();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /registry settings were not changed/);
  const base = path.join(appData, 'Adobe/CEP/extensions');
  const target = path.join(base, 'com.anshelf.receiver');
  const expected = ['index.html', 'style.css', 'icon.png', 'panel.js', 'queue.cjs', 'insert-whole.jsfl', 'README.md', 'CSXS/manifest.xml'];
  for (const file of expected) assert.deepEqual(fs.readFileSync(path.join(target, file)), fs.readFileSync(path.join(__dirname, '../plugin', file)));
  result = install('-CepMajor', '12');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /registry settings were not changed/);
  result = install('-CepMajor', '13');
  assert.notEqual(result.status, 0);
  fs.rmSync(path.join(target, 'CSXS'), { recursive: true });
  fs.symlinkSync(outside, path.join(target, 'CSXS'), 'junction');
  result = install();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reparse-point/);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.rmSync(path.join(appData, 'Adobe'), { recursive: true });
  fs.symlinkSync(outside, path.join(appData, 'Adobe'), 'junction');
  result = install();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reparse-point/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('Windows CEP debug option targets only the selected major using registry-free test doubles', { skip: process.platform !== 'win32' }, t => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-cep-major-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const installer = path.join(__dirname, '../plugin/install.ps1');
  const harness = path.join(appData, 'debug-harness.ps1');
  fs.writeFileSync(harness, `param([string]$Installer, [int]$RequestedCep = 0)
$script:RegistryWrites = @()
function New-Item {
  param([string]$Path, [string]$ItemType, [switch]$Force)
  if ($Path.StartsWith('HKCU:')) { $script:RegistryWrites += @{ operation='key'; path=$Path }; return }
  Microsoft.PowerShell.Management\\New-Item -Path $Path -ItemType $ItemType -Force:$Force
}
function New-ItemProperty {
  param([string]$Path, [string]$Name, [string]$Value, [string]$PropertyType, [switch]$Force)
  if (-not $Path.StartsWith('HKCU:')) { throw 'Unexpected test property path' }
  $script:RegistryWrites += @{ operation='property'; path=$Path; name=$Name; value=$Value; type=$PropertyType }
}
$parameters = @{ EnableDebug=$true }
if ($RequestedCep -ne 0) { $parameters.CepMajor=$RequestedCep }
. $Installer @parameters | Out-Null
ConvertTo-Json -InputObject @($script:RegistryWrites) -Compress
`);
  const run = major => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, '-Installer', installer, '-RequestedCep', String(major)], { encoding: 'utf8', env: { ...process.env, APPDATA: appData } });
  for (const [input, expected] of [[0, 11], [11, 11], [12, 12]]) {
    const result = run(input);
    assert.equal(result.status, 0, result.stderr);
    const writes = JSON.parse(result.stdout.trim());
    assert.equal(writes.length, 2);
    assert.ok(writes.every(write => write.path === `HKCU:\\Software\\Adobe\\CSXS.${expected}`));
    assert.deepEqual(writes[1], { operation: 'property', path: `HKCU:\\Software\\Adobe\\CSXS.${expected}`, name: 'PlayerDebugMode', value: '1', type: 'String' });
  }
});

test('CEP panel invokes only its fixed guarded receiver and reports completed insertion', t => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-cep-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const root = path.join(appData, 'AnShelf');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  const hash = crypto.createHash('sha256').update('fixture').digest('hex');
  fs.writeFileSync(path.join(root, 'assets', `${hash}.fla`), 'fixture');
  const bridge = new Bridge(root);
  bridge.send({ id: 'weapon', hash, name: '武器', managedPath: `assets/${hash}.fla` });
  const nodes = {};
  nodes.insert = { textContent: '', title: '', setAttribute() {}, addEventListener(event, handler) { this.handler = handler; } };
  let called = false;
  const cep = {
    getSystemPath: () => path.join(__dirname, '../plugin'),
    evalScript(code, callback) {
      if (!code.includes('AnShelfInsertWhole')) { callback('42'); return; }
      const response = vm.runInNewContext(code, { fl: { runScript(script, method, request, managedRoot) {
        assert.match(script, /insert-whole\.jsfl$/);
        assert.equal(method, 'AnShelfInsertWhole');
        const parsed = JSON.parse(request);
        assert.equal(parsed.asset.hash, hash);
        assert.equal(parsed.managedRoot, managedRoot);
        called = true;
        return JSON.stringify({ version: 1, ok: true, frameCount: 5 });
      } } });
      callback(response);
    }
  };
  const panel = vm.createContext({ window: { __adobe_cep__: cep, cep_node: { require: name => name === 'process' ? { env: { APPDATA: appData } } : require(name) }, addEventListener() {} }, document: { getElementById: id => nodes[id] }, JSON, decodeURI, setInterval: () => 1, clearInterval() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../plugin/panel.js'), 'utf8'), panel);
  assert.match(nodes.insert.title, /武器/);
  assert.equal(nodes.insert.textContent, '粘贴到舞台');
  nodes.insert.handler();
  assert.equal(called, true);
  assert.equal(bridge.status().result.ok, true);
  assert.equal(bridge.status().pending, null);
  assert.equal(fs.readFileSync(path.join(root, 'assets', `${hash}.fla`), 'utf8'), 'fixture');
});

function fakeAnimate() {
  const events = [];
  let active, clipboard;
  function instance(item, matrix) {
    const element = { elementType: 'instance', libraryItem: item, width: 809.5, height: 321.8 };
    Object.defineProperties(element, {
      matrix: { enumerable: true, get: () => matrix, set: value => { matrix = { ...value }; } },
      x: { enumerable: true, get: () => matrix.tx, set: value => { matrix.tx = value; } },
      y: { enumerable: true, get: () => matrix.ty, set: value => { matrix.ty = value; } },
      left: { enumerable: true, get: () => 9.25 + matrix.tx },
      top: { enumerable: true, get: () => 9.1 + matrix.ty }
    });
    return element;
  }
  function timeline(name, count, layers = [{ name: 'editable', locked: false, layerType: 'normal', frames: [] }]) {
    for (const layer of layers) for (let i = layer.frames.length; i < count; i++) layer.frames.push({ startFrame: 0, duration: count, elements: [{ elementType: 'shape', editable: true }] });
    return { name, layers, frameCount: count, currentLayer: 0, currentFrame: 0,
      selected: [],
      setSelectedLayers(index, replace) { if (replace) this.selected = []; if (!this.selected.includes(index)) this.selected.push(index); },
      copyLayers(start, end) { clipboard = { kind: 'layers', layers: structuredClone(this.layers.filter((layer, index) => start === undefined ? this.selected.includes(index) : index >= start && index <= end)), frameCount: this.frameCount }; },
      pasteLayers() { this.layers.unshift(...structuredClone(clipboard.layers)); this.frameCount = clipboard.frameCount; return 0; },
      deleteLayer(index) { this.layers.splice(index, 1); },
      insertFrames(n) { this.frameCount += n; for (const layer of this.layers) while (layer.frames.length < this.frameCount) layer.frames.push({ startFrame: 0, duration: this.frameCount, elements: [] }); },
      addNewLayer(name, type, above = true) { const index = this.currentLayer + (above ? 0 : 1); this.layers.splice(index, 0, { name, locked: false, layerType: type || 'normal', frames: Array.from({ length: this.frameCount }, () => ({ startFrame: 0, duration: this.frameCount, elements: [] })) }); this.currentLayer = index; return index; },
      insertBlankKeyframe(frame) { const cells = this.layers[this.currentLayer].frames; if (cells[frame].startFrame === frame && cells[frame + 1]) frame++; for (let i = frame; i < this.frameCount; i++) cells[i] = { startFrame: frame, duration: this.frameCount - frame, elements: [] }; },
      insertKeyframe(frame) { const cells = this.layers[this.currentLayer].frames, start = cells[frame].startFrame, inherited = cells[frame].elements.slice(); let end = frame + 1; while (end < cells.length && cells[end].startFrame === start) end++; for (let i = start; i < frame; i++) cells[i].duration = frame - start; for (let i = frame; i < end; i++) cells[i] = { startFrame: frame, duration: end - frame, elements: inherited.slice() }; }
    };
  }
  function document(name, scenes) {
    const d = { name, pathURI: `file:///C|/library/${name}.fla`, width: 800, height: 600, timelines: scenes, selection: [], closed: false, scene: 0, editing: null, addOffset: { x: 0, y: 0 }, pasteOffset: { x: 0, y: 0 } };
    d.library = { items: [{ name: 'Sword', itemType: 'movie clip', timeline: timeline('Sword', 2) }],
      itemExists(name) { return this.items.some(item => item.name === name); },
      addNewItem(type, name) { this.items.push({ name, itemType: type, timeline: timeline(name, 1, [{ name: 'Layer 1', frames: [{ startFrame: 0, duration: 1, elements: [] }], locked: false, layerType: 'normal' }]) }); return true; },
      newFolder(name) { if (!this.itemExists(name)) this.items.push({ name, itemType: 'folder' }); return true; },
      moveToFolder(folder, name) { const item = this.items.find(item => item.name === name); item.name = `${folder}/${name.split('/').pop()}`; return true; },
      editItem(name) { d.editing = this.items.find(item => item.name === name); return !!d.editing; },
      selectItem(name) { this.selected = name; return this.itemExists(name); }
    };
    d.getTimeline = () => d.editing ? d.editing.timeline : d.timelines[d.scene];
    d.editScene = index => { d.scene = index; d.editing = null; events.push(`scene:${index}`); };
    d.exitEditMode = () => { d.editing = d.editing && d.editing.parent ? d.editing.parent : null; events.push('exit-edit'); };
    d.selectNone = () => { d.selection = []; };
    d.addItem = (point, item) => { const t = d.getTimeline(); if (t.layers[t.currentLayer].locked) return false; const e = instance(item, { a: 1, b: 0, c: 0, d: 1, tx: point.x - 414 + d.addOffset.x, ty: point.y - 170 + d.addOffset.y }); d.selection = [e]; const cells = t.layers[t.currentLayer].frames, start = cells[t.currentFrame].startFrame; for (let i = t.currentFrame; i < cells.length && cells[i].startFrame === start; i++) cells[i].elements.push(e); return true; };
    d.clipCopy = () => { clipboard = { kind: 'elements', selection: d.selection, library: d.library.items }; };
    d.clipPaste = () => { for (const item of clipboard.library) if (!d.library.itemExists(item.name)) d.library.items.push(item); d.selection = clipboard.selection.map(element => instance(element.libraryItem, { ...element.matrix, tx: element.matrix.tx + d.pasteOffset.x, ty: element.matrix.ty + d.pasteOffset.y })); const t = d.getTimeline(), cells = t.layers[t.currentLayer].frames, start = cells[t.currentFrame].startFrame; for (let i = t.currentFrame; i < cells.length && cells[i].startFrame === start; i++) cells[i].elements.push(...d.selection); events.push('paste-target'); };
    d.close = save => { assert.equal(save, false); d.closed = true; events.push('close-source'); };
    return d;
  }
  const target = document('unsaved-target', [timeline('Target', 4)]);
  target.pathURI = undefined;
  target.getTimeline().currentFrame = 2;
  const source = document('source', [timeline('Scene One', 3, [{ name: 'shape', locked: false, layerType: 'normal', frames: [] }, { name: 'nested', locked: false, layerType: 'normal', frames: [] }]), timeline('Scene Two', 2)]);
  active = target;
  const fl = { getDocumentDOM: () => active, setActiveWindow: doc => { active = doc; }, openDocument: () => { events.push('open-source'); active = source; return source; } };
  const context = vm.createContext({ fl, FLfile: { exists: () => true }, JSON, decodeURIComponent, encodeURIComponent, Error, String, Math, RegExp });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../plugin/insert-whole.jsfl'), 'utf8'), context);
  const request = { version: 1, requestId: 'request-one', managedRoot: 'file:///C|/library/', asset: { id: 'weapon', hash: HASH, name: '武器', sourceURI: `file:///C|/library/assets/${HASH}.fla` }, temporaryURI: 'file:///C|/library/bridge/temp/request-one.fla' };
  source.pathURI = request.temporaryURI;
  return { target, source, events, request, context, active: () => active };
}

test('JSFL groups every scene and all frames under hash namespace, restores unsaved target, and reuses duplicates', () => {
  const f = fakeAnimate();
  f.source.timelines[0].layers[0].locked = true;
  const result = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(result.ok, true);
  assert.equal(result.sceneCount, 2);
  assert.equal(result.frameCount, 5);
  assert.equal(f.active(), f.target);
  assert.equal(f.target.getTimeline().currentFrame, 2);
  assert.equal(f.source.closed, true);
  const root = f.target.library.items.find(item => item.name === `AnShelf/${HASH}/whole`);
  assert.ok(root);
  assert.equal(root.timeline.frameCount, 5);
  const sceneSymbols = f.target.library.items.filter(item => item.name.startsWith(`AnShelf/${HASH}/scenes/`));
  assert.equal(sceneSymbols.length, 2);
  assert.equal(sceneSymbols[0].timeline.frameCount, 3);
  assert.equal(sceneSymbols[0].timeline.layers.length, 2);
  assert.equal(sceneSymbols[1].timeline.frameCount, 2);
  assert.equal(sceneSymbols[0].timeline.layers[0].frames[0].elements[0].editable, true);
  const firstSceneLayer = root.timeline.layers.find(layer => layer.name === 'Scene One');
  assert.equal(firstSceneLayer.frames[1].elements[0].libraryItem.name, `AnShelf/${HASH}/scenes/scene_1`);
  assert.equal(firstSceneLayer.frames[3].elements.length, 0);
  const before = f.target.library.items.length;
  const second = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(second.reused, true);
  assert.equal(f.target.library.items.length, before);
  assert.equal(f.events.filter(e => e === 'open-source').length, 1);
});

test('JSFL rejects malformed and out-of-root requests before opening files', () => {
  const f = fakeAnimate();
  assert.equal(JSON.parse(f.context.AnShelfInsertWhole('{bad', 'file:///C|/library/')).ok, false);
  f.request.asset.sourceURI = 'file:///C|/outside/weapon.fla';
  assert.equal(JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/')).ok, false);
  assert.deepEqual(f.events, []);
});

test('JSFL rejects Animate returning the target document after source-open failure without modifying or closing it', () => {
  const f = fakeAnimate();
  const before = JSON.stringify(f.target.library.items);
  f.context.fl.openDocument = () => f.target;
  const result = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(f.target.library.items), before);
  assert.equal(f.target.closed, false);
  assert.equal(f.source.closed, false);
  assert.equal(f.active(), f.target);
  assert.equal(f.target.getTimeline().currentFrame, 2);
  assert.equal(f.events.includes('paste-target'), false);
});

test('JSFL rejects a returned document whose path is not the requested temporary source', () => {
  const f = fakeAnimate();
  f.source.pathURI = 'file:///C|/library/unrelated.fla';
  const before = JSON.stringify(f.source.library.items);
  const result = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(f.source.library.items), before);
  assert.equal(f.source.closed, false);
  assert.equal(f.target.closed, false);
  assert.equal(f.active(), f.target);
  assert.equal(f.events.includes('paste-target'), false);
});

test('JSFL preserves scene coordinates and centers both new and reused root content on the target stage', () => {
  const f = fakeAnimate();
  f.target.width = 1000;
  f.target.height = 720;
  f.source.addOffset = { x: 75, y: -40 };
  f.target.addOffset = { x: 677.95, y: 305 };
  f.target.pasteOffset = { x: 80, y: -45 };
  f.source.pathURI = f.request.temporaryURI.toUpperCase();
  const first = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(first.ok, true, first.error);
  const root = f.target.library.items.find(item => item.name === `AnShelf/${HASH}/whole`);
  for (const layer of root.timeline.layers) {
    const instance = layer.frames.find(frame => frame.elements.length)?.elements[0];
    assert.deepEqual({ ...instance.matrix }, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  }
  const stage = f.target.getTimeline();
  const getInstances = () => stage.layers[stage.currentLayer].frames[stage.currentFrame].elements.filter(item => item.libraryItem?.name === root.name);
  assert.equal(getInstances().length, 1);
  assert.deepEqual({ ...getInstances()[0].matrix }, { a: 1, b: 0, c: 0, d: 1, tx: 86, ty: 190 });
  assert.equal(getInstances()[0].left + getInstances()[0].width / 2, 500);
  assert.equal(getInstances()[0].top + getInstances()[0].height / 2, 360);
  const transferred = f.source.timelines[0].layers.find(layer => layer.name === '__AnShelf_transfer').frames[0].elements[0];
  assert.equal(transferred.left + transferred.width / 2, 500);
  assert.equal(transferred.top + transferred.height / 2, 360);
  const second = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(second.ok, true, second.error);
  assert.equal(second.reused, true);
  assert.equal(getInstances().length, 2);
  assert.deepEqual({ ...getInstances()[1].matrix }, { a: 1, b: 0, c: 0, d: 1, tx: 86, ty: 190 });
  assert.equal(getInstances()[1].left + getInstances()[1].width / 2, 500);
  assert.equal(getInstances()[1].top + getInstances()[1].height / 2, 360);
});

test('JSFL inserts a normal keyframe at the current playhead and preserves its inherited content without adding layers or blank keys', () => {
  const f = fakeAnimate(), timeline = f.target.getTimeline();
  const original = { elementType: 'shape', id: 'existing-content', editable: true };
  const later = { elementType: 'shape', id: 'later-content', editable: true };
  const frames = Array.from({ length: 64 }, (_, index) => ({ startFrame: index < 60 ? 0 : 60, duration: index < 60 ? 60 : 4, elements: [index < 60 ? original : later] }));
  timeline.layers.push({ name: 'selected-existing-layer', locked: false, layerType: 'normal', frames });
  timeline.frameCount = 64;
  timeline.currentLayer = 1;
  const beforeOtherLayer = JSON.stringify(timeline.layers[0]);
  const mutations = [];
  for (const name of ['insertKeyframe', 'insertBlankKeyframe', 'addNewLayer']) {
    const native = timeline[name];
    timeline[name] = function(...args) { mutations.push(name); return native.apply(this, args); };
  }
  for (const [playhead, expectedInstances] of [[50, 1], [50, 2], [0, 1]]) {
    timeline.currentFrame = playhead;
    const result = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
    assert.equal(result.ok, true, result.error);
    assert.equal(timeline.layers.length, 2);
    assert.equal(timeline.currentLayer, 1);
    assert.equal(timeline.currentFrame, playhead);
    assert.deepEqual(frames.map((frame, index) => frame.startFrame === index ? index : null).filter(index => index !== null), [0, 50, 60]);
    assert.deepEqual(mutations, ['insertKeyframe']);
    const instances = frames[playhead].elements.filter(element => element.libraryItem?.name === `AnShelf/${HASH}/whole`);
    assert.equal(instances.length, expectedInstances);
    assert.equal(frames[0].elements[0], original);
    assert.equal(frames[50].elements[0], original);
    assert.equal(frames[60].elements.length, 1);
    assert.equal(frames[60].elements[0], later);
    assert.equal(JSON.stringify(timeline.layers[0]), beforeOtherLayer);
    const inserted = instances.at(-1);
    assert.equal(inserted.left + inserted.width / 2, f.target.width / 2);
    assert.equal(inserted.top + inserted.height / 2, f.target.height / 2);
  }
});

test('JSFL reports failed placement when native selection is empty or its bounds are not finite', () => {
  for (const value of ['empty', 'bad-bounds', 'bad-x', 'bad-y']) {
    const f = fakeAnimate();
    const nativeAdd = f.source.addItem;
    f.source.addItem = (point, item) => {
      const result = nativeAdd(point, item);
      if (item.name.endsWith('/whole')) {
        if (value === 'empty') f.source.selection = [];
        else if (value === 'bad-bounds') f.source.selection[0].width = NaN;
        else if (value === 'bad-x') f.source.selection[0].x = NaN;
        else f.source.selection[0].y = Infinity;
      }
      return result;
    };
    const result = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
    assert.equal(result.ok, false, value);
    assert.equal(f.events.includes('paste-target'), false);
    assert.equal(f.source.closed, true);
    assert.equal(f.active(), f.target);
  }
});

test('JSFL transfers through the new editable layer when source selection is below a locked first layer', () => {
  const f = fakeAnimate();
  f.source.timelines[0].currentLayer = 1;
  f.source.timelines[0].layers[0].locked = true;
  const result = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(result.ok, true, result.error);
  assert.ok(f.events.includes('paste-target'));
  assert.equal(f.source.closed, true);
});

test('JSFL JSON fallback handles URI Unicode without eval and rejects extra code', () => {
  const f = fakeAnimate();
  f.context.JSON = undefined;
  const parsed = f.context.AnShelfParseJSON(JSON.stringify(f.request));
  assert.equal(parsed.asset.name, '武器');
  assert.throws(() => f.context.AnShelfParseJSON('{"a":1};fl.quit()'), /JSON/);
  assert.throws(() => f.context.AnShelfParseJSON('{"__proto__":{}}'), /JSON/);
  f.target.getTimeline().layers[0].locked = true;
  const result = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(result.ok, false);
  assert.match(result.error, /锁定/);
  assert.equal(f.events.includes('open-source'), false);
});

test('JSFL exits nested editing into the existing scene and preserves its stage frame', () => {
  const f = fakeAnimate();
  const second = f.source.timelines[1];
  second.currentFrame = 1;
  f.target.timelines.push(second);
  f.target.scene = 1;
  f.target.editing = { timeline: { currentLayer: 0, currentFrame: 0 }, parent: { timeline: { currentLayer: 0, currentFrame: 0 } } };
  const result = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(result.ok, true);
  assert.equal(f.target.scene, 1);
  assert.equal(f.target.editing, null);
  assert.equal(f.target.getTimeline().currentFrame, 1);
  assert.ok(second.layers[0].frames[1].elements.some(item => item.libraryItem && item.libraryItem.name === `AnShelf/${HASH}/whole`));
});

test('JSFL restores target and closes temporary source on timeline-copy failure', () => {
  const f = fakeAnimate();
  f.source.timelines[1].copyLayers = () => { throw new Error('unsupported layer'); };
  const result = JSON.parse(f.context.AnShelfInsertWhole(JSON.stringify(f.request), 'file:///C|/library/'));
  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported layer/);
  assert.equal(f.active(), f.target);
  assert.equal(f.source.closed, true);
  assert.equal(f.events.includes('paste-target'), false);
});
