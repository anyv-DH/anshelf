/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function panel({ connected = true } = {}) {
  const button = { disabled: true, textContent: '', title: '', attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(event, handler) { this.click = handler; } };
  const addButton = { disabled: false, textContent: '', title: '', attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(event, handler) { this.click = handler; } };
  let pending = null, response, tick, heartbeatError = false, addResponse, importResult = null, importRequest = null, timeOffset = 0;
  const calls = [], completed = [], cleaned = [];
  const request = id => ({ version: 2, requestId: id, managedRoot: 'managed', asset: { id, name: '一个名字很长的武器素材', hash: 'a'.repeat(64), sourcePath: 'managed/assets/test.fla' } });
  const queue = {
    heartbeat(busy) { calls.push(['heartbeat', busy]); if (heartbeatError) throw new Error('写入失败'); },
    pending() { return pending; },
    prepare(value) { calls.push(['prepare', value.requestId]); return { ...value, managedRoot: 'file:///managed' }; },
    complete(value, result) { completed.push([value.requestId, result]); if (pending && pending.requestId === value.requestId) pending = null; },
    requestDocumentImport(file) { calls.push(['import', file]); return importRequest = { requestId: 'add-current', createdAt: Date.now() }; },
    documentImportResult() { return importResult; },
    clearDocumentImport(id) { cleaned.push(id); },
  };
  const receiver = { Queue: function () { return queue; }, localURI: value => 'file:///' + value };
  const cep = { getSystemPath: () => '/extension', evalScript(code, callback) {
    if (code.includes('AnShelfCurrentDocumentForLibrary')) { calls.push(['saveCurrent', code]); addResponse = callback; return; }
    if (!code.includes('AnShelfInsertWhole')) { callback('42'); return; }
    calls.push(['evalScript', code]); response = callback;
  } };
  const window = { __adobe_cep__: connected ? cep : null, cep_node: { require(name) { if (name === 'process') return { env: { APPDATA: '/appdata' } }; if (name === 'path') return path; return receiver; } }, addEventListener() {} };
  const PanelDate = class extends Date { constructor(...args) { super(...(args.length ? args : [Date.now() + timeOffset])); } };
  const context = vm.createContext({ window, document: { getElementById: id => id === 'insert' ? button : id === 'add-current' ? addButton : null }, Date: PanelDate, JSON, decodeURI, setInterval: callback => { tick = callback; return 1; }, clearInterval() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../plugin/panel.js'), 'utf8'), context);
  return { button, addButton, calls, completed, cleaned, send(id) { pending = request(id); tick(); }, tick() { tick(); }, advance(ms) { timeOffset += ms; tick(); }, saved(result) { addResponse(JSON.stringify(result)); }, imported(result) { importResult = result; tick(); }, failHeartbeat(value) { heartbeatError = value; tick(); }, captureResponse() { return response; }, respond(result) { response(JSON.stringify(result)); } };
}

test('compact CEP markup contains paste and add-current buttons within an 88x48 default geometry', () => {
  const html = fs.readFileSync(path.join(__dirname, '../plugin/index.html'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, '../plugin/CSXS/manifest.xml'), 'utf8');
  assert.equal((html.match(/<button\b/g) || []).length, 2);
  assert.match(html, /id="add-current"/);
  assert.doesNotMatch(html, /id="(?:state|name|path|asset|dot|detail)"/);
  assert.match(html, /<title>安安素材管理器<\/title>/);
  assert.match(manifest, /<Menu>安安素材管理器<\/Menu>/);
  assert.match(manifest, /<Size><Height>48<\/Height><Width>88<\/Width><\/Size>/);
  assert.match(manifest, /<MinSize><Height>40<\/Height><Width>80<\/Width><\/MinSize>/);
  assert.match(manifest, /<Icon Type="Normal">\.\/icon\.png<\/Icon>/);
  assert.match(manifest, /<Icon Type="DarkNormal">\.\/icon\.png<\/Icon>/);
  const png = fs.readFileSync(path.join(__dirname, '../plugin/icon.png'));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(png.readUInt32BE(20), 64);
});

test('add-current saves once, queues only a saved FLA, and shows the bounded import receipt', () => {
  const view = panel();
  view.addButton.click(); view.addButton.click();
  assert.equal(view.calls.filter(call => call[0] === 'saveCurrent').length, 1);
  assert.equal(view.addButton.disabled, true);
  view.saved({ version: 1, ok: true, file: 'C:\\works\\当前作品.fla' });
  assert.equal(view.calls.filter(call => call[0] === 'import').length, 1);
  view.imported({ version: 1, requestId: 'add-current', ok: true, name: '当前作品', assetId: 'new' });
  assert.equal(view.addButton.textContent, '已加入 ✓');
  assert.equal(view.addButton.disabled, false);
  assert.match(view.addButton.title, /当前作品/);
  assert.deepEqual(view.cleaned, ['add-current']);
});

test('add-current cancellation and errors never submit an unsaved document', () => {
  const view = panel();
  view.addButton.click();
  view.saved({ version: 1, ok: false, cancelled: true });
  assert.equal(view.addButton.textContent, '已取消');
  assert.match(view.addButton.title, /已取消加入/);
  assert.doesNotMatch(view.addButton.title, /取消保存/);
  assert.equal(view.addButton.disabled, false);
  view.addButton.click();
  view.saved({ version: 1, ok: false, error: '请先打开 AN 文档' });
  assert.match(view.addButton.title, /请先打开/);
  assert.equal(view.calls.filter(call => call[0] === 'import').length, 0);
});

test('waiting for the manager times out and clears only this request, while native Save can wait for the user', () => {
  const view = panel();
  view.addButton.click();
  view.advance(120000);
  assert.equal(view.addButton.disabled, true, 'the native Save dialog may stay open without timing out');
  view.saved({ version: 1, ok: true, file: 'C:\\works\\当前作品.fla' });
  view.advance(61000);
  assert.equal(view.addButton.disabled, false);
  assert.equal(view.addButton.textContent, '加入失败');
  assert.match(view.addButton.title, /打开最新版管理器/);
  assert.deepEqual(view.cleaned, ['add-current']);
});

test('one CEP button carries waiting, request, busy, completion and next request states', () => {
  const view = panel();
  assert.equal(view.button.disabled, true);
  assert.equal(view.button.textContent, '等待素材');
  view.send('first');
  assert.equal(view.button.disabled, false);
  assert.equal(view.button.textContent, '粘贴到舞台');
  assert.match(view.button.title, /一个名字很长的武器素材/);
  view.button.click();
  assert.equal(view.button.disabled, true);
  assert.equal(view.button.textContent, '正在粘贴…');
  assert.match(view.calls.find(call => call[0] === 'evalScript')[1], /AnShelfInsertWhole/);
  view.button.click();
  assert.equal(view.calls.filter(call => call[0] === 'prepare').length, 1);
  view.respond({ version: 1, ok: true, warning: '保留提示' });
  assert.equal(view.button.disabled, true);
  assert.equal(view.button.textContent, '已粘贴 ✓');
  assert.match(view.button.title, /保留提示/);
  assert.equal(view.completed.length, 1);
  assert.equal(view.cleaned.length, 0);
  view.tick();
  assert.equal(view.button.textContent, '已粘贴 ✓');
  view.send('second');
  assert.equal(view.button.textContent, '粘贴到舞台');
  assert.equal(view.button.disabled, false);
  assert.equal(view.button.attrs['data-state'], 'ready');
});

test('CEP failures remain readable in tooltip and connection failures disable the button', () => {
  const view = panel();
  view.send('failed'); view.button.click();
  view.respond({ version: 1, ok: false, error: '当前图层锁定，请先解锁' });
  assert.equal(view.button.textContent, '粘贴失败');
  assert.match(view.button.title, /当前图层锁定，请先解锁/);
  assert.match(view.button.attrs['aria-label'], /当前图层锁定/);
  view.send('next');
  view.failHeartbeat(true);
  assert.equal(view.button.disabled, true);
  assert.equal(view.button.textContent, '连接失败');
  view.failHeartbeat(false);
  assert.equal(view.button.disabled, false);
  assert.equal(view.button.textContent, '粘贴到舞台');
  const unavailable = panel({ connected: false });
  assert.equal(unavailable.button.disabled, true);
  assert.equal(unavailable.button.textContent, '连接失败');
  assert.match(unavailable.button.title, /CEP 环境不可用/);
});

test('late callbacks cannot complete a newer request and busy state recovers after a connection outage', () => {
  const view = panel();
  view.send('first'); view.button.click();
  const firstResponse = view.captureResponse();
  view.respond({ version: 1, ok: true });
  view.send('second'); view.button.click();
  firstResponse(JSON.stringify({ version: 1, ok: true }));
  assert.equal(view.completed.length, 1);
  assert.equal(view.button.textContent, '正在粘贴…');
  view.failHeartbeat(true);
  assert.equal(view.button.textContent, '连接失败');
  view.failHeartbeat(false);
  assert.equal(view.button.textContent, '正在粘贴…');
  view.respond(null);
  assert.equal(view.completed.length, 2);
  assert.equal(view.button.textContent, '粘贴失败');
  assert.match(view.button.title, /AN 返回了无效结果/);
});
