/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { Queue } = require('../plugin/queue.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-stage-receiver-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  const bytes = Buffer.from('isolated managed source');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const sourcePath = path.join(root, 'assets', hash + '.fla');
  fs.writeFileSync(sourcePath, bytes);
  const queue = new Queue(root);
  const manual = { version: 1, requestId: crypto.randomUUID(), createdAt: Date.now(), managedRoot: root, asset: { id: 'known', name: '武器', hash, sourcePath } };
  function stage(patch = {}) { const createdAt = Date.now(); return { ...manual, requestId: crypto.randomUUID(), createdAt, delivery: 'stage-drop', expiresAt: createdAt + 5000, targetDocumentId: 42, ...patch }; }
  return { root, queue, manual, stage };
}

function panel(t, { documentId = 42, deferProbe = false } = {}) {
  const f = fixture(t), calls = [], probes = [], responses = [], heartbeats = [];
  let tick, unload, activeId = documentId;
  const queueHeartbeat = f.queue.heartbeat.bind(f.queue);
  f.queue.heartbeat = (...args) => { heartbeats.push(args); return queueHeartbeat(...args); };
  const button = { disabled: true, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(_name, fn) { this.click = fn; } };
  const cep = { getSystemPath: () => '/extension', evalScript(code, callback) {
    if (code.includes('AnShelfInsertWhole')) { calls.push(code); responses.push(callback); return; }
    probes.push(code);
    const value = vm.runInNewContext(code, { fl: { getDocumentDOM: () => activeId === null ? null : { id: activeId } } });
    if (deferProbe) responses.probe = (response = value) => callback(response);
    else callback(value);
  } };
  const window = { __adobe_cep__: cep, cep_node: { require(name) {
    if (name === 'path') return path;
    if (name === 'process') return { env: { APPDATA: f.root } };
    return { Queue: function () { return f.queue; }, localURI: value => 'file:///' + value };
  } }, addEventListener(_name, callback) { unload = callback; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/panel.js'), 'utf8'), { window, document: { getElementById: () => button }, JSON, decodeURI, setInterval(callback) { tick = callback; return 1; }, clearInterval() {} });
  t.after(() => unload());
  return { ...f, button, calls, probes, responses, heartbeats, unload: () => unload(), tick: () => tick(), setDocumentId(value) { activeId = value; }, send(request) { f.queue.atomic('pending.json', request); tick(); }, respond(result) { responses.at(-1)(JSON.stringify(result)); } };
}

test('receiver heartbeat advertises stage-drop capability and the current numeric document identity', t => {
  const f = fixture(t);
  f.queue.heartbeat(false, 42);
  const status = f.queue.read('status.json');
  assert.deepEqual(status.capabilities, { stageDrop: 1 });
  assert.equal(status.documentId, 42);
  f.queue.heartbeat(true, null);
  assert.equal(f.queue.read('status.json').documentId, null);
  for (const id of ['42', -1, NaN, Infinity, 1.5, undefined]) {
    f.queue.heartbeat(false, id);
    assert.equal(f.queue.read('status.json').documentId, null);
  }
});

test('manual request stays on the confirmation button without automatic insertion', t => {
  const f = panel(t);
  f.send(f.manual);
  assert.equal(f.calls.length, 0);
  assert.equal(f.button.textContent, '粘贴到舞台');
  f.button.click();
  assert.equal(f.calls.length, 1);
  f.respond({ version: 1, ok: true });
  assert.equal(f.queue.pending(), null);
});

test('fresh stage-drop is prepared and inserted once, and repeat ticks or late callbacks do not insert again', t => {
  const f = panel(t);
  const request = f.stage();
  f.send(request);
  assert.equal(f.calls.length, 1);
  assert.equal(f.button.textContent, '正在粘贴…');
  f.tick(); f.tick();
  assert.equal(f.calls.length, 1);
  f.respond({ version: 1, ok: true });
  f.tick();
  f.respond({ version: 1, ok: true });
  assert.equal(f.calls.length, 1);
  assert.equal(f.queue.pending(), null);
  assert.equal(f.queue.read('result.json').requestId, request.requestId);
});

test('expired automatic request is completed as failure without source staging or manual fallback', t => {
  const f = panel(t), createdAt = Date.now() - 6000;
  const request = f.stage({ createdAt, expiresAt: createdAt + 5000 });
  f.send(request);
  assert.equal(f.calls.length, 0);
  assert.equal(f.queue.pending(), null);
  const result = f.queue.read('result.json');
  assert.equal(result.ok, false);
  assert.match(result.error, /过期/);
  assert.equal(fs.existsSync(path.join(f.root, 'bridge/temp')), false);
  f.button.click(); f.tick();
  assert.equal(f.calls.length, 0);
});

test('automatic request refuses a changed or absent target document without changing the current document', t => {
  for (const documentId of [43, null]) {
    const f = panel(t, { documentId });
    f.send(f.stage());
    assert.equal(f.calls.length, 0);
    assert.equal(f.queue.pending(), null);
    assert.equal(f.queue.read('result.json').ok, false);
    assert.match(f.queue.read('result.json').error, /目标|文档/);
    assert.equal(fs.existsSync(path.join(f.root, 'bridge/temp')), false);
  }
});

test('asynchronous document probes do not overlap and auto-insert waits for the actual context response', t => {
  const f = panel(t, { deferProbe: true });
  assert.equal(f.probes.length, 1);
  f.send(f.stage()); f.tick();
  assert.equal(f.probes.length, 1);
  assert.equal(f.calls.length, 0);
  f.responses.probe();
  assert.equal(f.calls.length, 1);
});

test('a late document probe cannot replace the target identity while an insertion is busy', t => {
  const f = panel(t, { deferProbe: true });
  f.send(f.manual);
  f.responses.probe('42');
  f.tick();
  f.button.click();
  assert.equal(f.calls.length, 1);
  f.responses.probe('43');
  assert.equal(f.queue.read('status.json').documentId, 42);
  assert.equal(f.queue.read('status.json').busy, true);
  f.respond({ version: 1, ok: true });
});

test('invalid context responses cannot become document zero and callbacks after unload cannot insert', t => {
  for (const response of ['', ' ', 'null', 'EvalScript error.', '42.0', '-1', '9007199254740992']) {
    const f = panel(t, { deferProbe: true });
    f.send(f.stage({ targetDocumentId: 0 }));
    f.responses.probe(response);
    assert.equal(f.queue.read('status.json').documentId, null);
    assert.equal(f.calls.length, 0);
    assert.equal(f.queue.pending(), null);
  }
  const f = panel(t, { deferProbe: true });
  f.send(f.stage());
  f.unload(); f.responses.probe();
  assert.equal(f.calls.length, 0);
  assert.notEqual(f.queue.pending(), null);
});

test('queue carries the exact stage-drop document and time guards into the JSFL request', t => {
  const f = fixture(t), request = f.stage();
  const prepared = f.queue.prepare(request);
  assert.equal(prepared.delivery, 'stage-drop');
  assert.equal(prepared.createdAt, request.createdAt);
  assert.equal(prepared.expiresAt, request.expiresAt);
  assert.equal(prepared.targetDocumentId, 42);
  f.queue.cleanup(prepared.temporaryPath);
  assert.equal(f.queue.prepare(f.manual).delivery, undefined);
});

test('queue rejects malformed or expired stage guards instead of silently downgrading to manual delivery', t => {
  const f = fixture(t);
  for (const patch of [{ delivery: 'auto' }, { targetDocumentId: null }, { targetDocumentId: '42' }, { targetDocumentId: -1 }, { targetDocumentId: 0.5 }, { expiresAt: Infinity }, { expiresAt: Date.now() + 60000 }, { delivery: undefined, targetDocumentId: 42 }]) {
    assert.throws(() => f.queue.prepare(f.stage(patch)), /拖|目标|请求|文档/);
  }
  const createdAt = Date.now() - 6000;
  assert.throws(() => f.queue.prepare(f.stage({ createdAt, expiresAt: createdAt + 5000 })), /过期/);
  assert.equal(fs.existsSync(path.join(f.root, 'bridge/temp')), false);
});

function jsflTarget(request, documentId) {
  if (arguments.length < 2) documentId = 42;
  const events = [], layer = { locked: false, visible: true, layerType: 'normal', frames: [{ startFrame: 0, elements: [] }] };
  const timeline = { currentLayer: 0, currentFrame: 0, layers: [layer] };
  const rootItem = { name: 'AnShelf/' + request.asset.hash + '/whole', timeline: { frameCount: 5 } };
  const target = { id: documentId, width: 1000, height: 720, timelines: [timeline], library: { items: [rootItem] }, getTimeline() { events.push('timeline'); return timeline; }, selectNone() { this.selection = []; }, addItem(point) { events.push('insert'); this.selection = [{ left: point.x - 10, top: point.y - 10, width: 20, height: 20, x: point.x, y: point.y }]; return true; } };
  const context = vm.createContext({ fl: { getDocumentDOM: () => target, setActiveWindow() { events.push('restore'); }, openDocument() { events.push('open-source'); throw new Error('should reuse'); } }, FLfile: { exists: () => true }, JSON, decodeURIComponent, encodeURIComponent, Error, String, Math, RegExp, Date });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../plugin/insert-whole.jsfl'), 'utf8'), context);
  return { target, events, run: () => JSON.parse(context.AnShelfInsertWhole(JSON.stringify(request), request.managedRoot)) };
}

function jsflRequest(patch = {}) {
  const createdAt = Date.now();
  return { version: 1, requestId: 'stage-guard', createdAt, delivery: 'stage-drop', expiresAt: createdAt + 5000, targetDocumentId: 42, managedRoot: 'file:///C|/isolated/', temporaryURI: 'file:///C|/isolated/bridge/temp/test.fla', asset: { id: 'known', hash: 'a'.repeat(64), name: '武器', sourceURI: 'file:///C|/isolated/assets/test.fla' }, ...patch };
}

test('JSFL checks active document identity before any timeline access, source open or target mutation', () => {
  for (const documentId of [43, undefined, '42']) {
    const f = jsflTarget(jsflRequest(), documentId), result = f.run();
    assert.equal(result.ok, false);
    assert.match(result.error, /目标|文档/);
    assert.deepEqual(f.events, []);
  }
});

test('JSFL checks expiry and malformed auto guards before touching the target but accepts a matching target', () => {
  const createdAt = Date.now() - 6000;
  for (const request of [jsflRequest({ createdAt, expiresAt: createdAt + 5000 }), jsflRequest({ targetDocumentId: -1 }), jsflRequest({ expiresAt: Infinity })]) {
    const f = jsflTarget(request), result = f.run();
    assert.equal(result.ok, false);
    assert.deepEqual(f.events, []);
  }
  const f = jsflTarget(jsflRequest()), result = f.run();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.reused, true);
  assert.equal(f.events.filter(x => x === 'insert').length, 1);
});
