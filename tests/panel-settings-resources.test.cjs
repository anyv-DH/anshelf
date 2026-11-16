/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../plugin/panel.js'), 'utf8');
const requestEvent = 'com.anshelf.receiver.import-settings.request';

function settingsView(categories = []) {
  const listeners = new Map(), windowEvents = {}, counters = { timers: 0, indexReads: 0, jsfl: 0, heartbeat: 0, closed: 0 };
  const element = () => ({ hidden: true, value: '', checked: true, style: {}, scrollHeight: 100,
    setAttribute() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener(name, fn) { this[name] = fn; }, focus() {},
    getBoundingClientRect() { return { left: 12, top: 140, bottom: 170, width: 300 }; } });
  const controls = Object.fromEntries(['settings-window', 'add-confirm', 'confirm-save', 'confirm-cancel', 'current-file',
    'category-search', 'import-category', 'import-ordinary', 'import-effect', 'preview-resolution',
    'prefer-existing-preview', 'settings-error', 'category-options', 'resolution-options', 'settings-loading'].map(id => [id, element()]));
  const queue = {
    documentImportSettings() { counters.indexReads++; return { categories, defaults: { mode: 'ordinary', categoryId: null, previewResolution: null, preferExistingPreview: true } }; },
    heartbeat() { counters.heartbeat++; },
  };
  const api = { getSystemPath: () => '/extension', evalScript() { counters.jsfl++; },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
    dispatchEvent() {}, closeExtension() { counters.closed++; },
  };
  const window = { innerHeight: 440, __adobe_cep__: api, addEventListener(name, fn) { windowEvents[name] = fn; },
    cep_node: { require(name) {
      if (name === 'path') return path;
      if (name === 'crypto') return require('node:crypto');
      if (name === 'process') return { env: { APPDATA: '/appdata' } };
      return { Queue: function () { return queue; }, documentImportOptions: value => value, localURI: value => value };
    } },
  };
  vm.runInNewContext(source, { window, document: { getElementById: id => controls[id] || null, addEventListener() {} },
    JSON, decodeURI, setInterval() { counters.timers++; }, setTimeout() { counters.timers++; }, clearInterval() {} });
  return { controls, counters, listeners,
    show() { listeners.get(requestEvent)({ extensionId: 'com.anshelf.receiver.panel', data: { action: 'show', requestId: 'a'.repeat(32), documentId: 42, info: { documentId: 42, name: '合成文档', file: null } } }); },
    unload() { windowEvents.beforeunload(); windowEvents.unload(); },
  };
}

test('repeated category searches reuse the opened snapshot without revisiting parent chains or rereading the index', () => {
  let parentReads = 0;
  const categories = Array.from({ length: 2000 }, (_, i) => ({ id: 'c' + i, name: '分类' + i, scope: 'ordinary',
    get parentId() { parentReads++; return i ? 'c0' : null; } }));
  const view = settingsView(categories); view.show();
  assert.equal(view.controls['add-confirm'].hidden, false);
  parentReads = 0;
  for (const query of ['1', '15', '150', '']) {
    view.controls['category-search'].value = query;
    view.controls['category-search'].input();
  }
  assert.equal(parentReads, 0, 'typing must filter cached paths/scopes rather than walk every category ancestor again');
  assert.equal(view.counters.indexReads, 1);
});

test('cached category paths preserve inherited scope, explicit child overrides and cycle protection', () => {
  const view = settingsView([
    { id: 'ordinary', name: '人物', scope: 'ordinary', parentId: null },
    { id: 'child', name: '角色', scope: 'all', parentId: 'ordinary' },
    { id: 'effect', name: '特效覆盖', scope: 'effect', parentId: 'ordinary' },
    { id: 'shared', name: '公共', scope: 'all', parentId: 'missing' },
    { id: 'null', name: '字面空值分类', scope: 'effect', parentId: null },
    { id: 'cycle-a', name: '甲', scope: 'all', parentId: 'cycle-b' },
    { id: 'cycle-b', name: '乙', scope: 'all', parentId: 'cycle-a' },
  ]);
  view.show();
  assert.match(view.controls['category-options'].innerHTML, /人物 \/ 角色/);
  assert.doesNotMatch(view.controls['category-options'].innerHTML, /特效覆盖/);
  assert.doesNotMatch(view.controls['category-options'].innerHTML, /字面空值分类/);
  assert.match(view.controls['category-options'].innerHTML, /公共|乙 \/ 甲|甲 \/ 乙/);
  view.controls['import-effect'].click();
  assert.match(view.controls['category-options'].innerHTML, /人物 \/ 特效覆盖/);
  assert.doesNotMatch(view.controls['category-options'].innerHTML, /人物 \/ 角色/);
});

test('thirty settings open/cancel/unload cycles create no polling work and release CEP listeners', () => {
  for (let i = 0; i < 30; i++) {
    const view = settingsView();
    assert.equal(view.listeners.size, 1);
    view.show(); view.controls['confirm-cancel'].click(); view.unload();
    assert.equal(view.listeners.size, 0);
    assert.deepEqual(view.counters, { timers: 0, indexReads: 1, jsfl: 0, heartbeat: 0, closed: 1 });
  }
});

test('the main panel keeps one context timer across repeated confirmations and clears it on unload', () => {
  const listeners = new Map(), timers = new Map(), windowEvents = {}, sent = [];
  const button = () => ({ setAttribute() {}, addEventListener(name, fn) { this[name] = fn; } });
  const insert = button(), add = button();
  const queue = { heartbeat() {}, pending() { return null; } };
  const api = { getSystemPath: () => '/extension',
    evalScript(code, callback) { callback(code.includes('AnShelfCurrentDocumentInfoForLibrary')
      ? JSON.stringify({ version: 1, ok: true, documentId: 42, name: '合成文档', file: null }) : '42'); },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
    requestOpenExtension() {}, dispatchEvent(event) { sent.push(JSON.parse(event.data)); },
  };
  const window = { __adobe_cep__: api, addEventListener(name, fn) { windowEvents[name] = fn; },
    cep_node: { require(name) {
      if (name === 'path') return path;
      if (name === 'crypto') return require('node:crypto');
      if (name === 'process') return { env: { APPDATA: '/appdata' } };
      return { Queue: function () { return queue; }, documentImportOptions: value => value, localURI: value => value };
    } },
  };
  vm.runInNewContext(source, { window, document: { getElementById: id => id === 'insert' ? insert : id === 'add-current' ? add : null, addEventListener() {} }, JSON, decodeURI,
    setInterval(fn, ms) { const id = timers.size + 1; timers.set(id, { fn, ms }); return id; }, clearInterval(id) { timers.delete(id); } });
  const reply = data => listeners.get('com.anshelf.receiver.import-settings.response')({ extensionId: 'com.anshelf.receiver.import-settings', data });
  for (let i = 0; i < 30; i++) {
    add.click(); reply({ action: 'ready' });
    const requestId = sent.findLast(event => event.action === 'show').requestId;
    reply({ action: 'opened', requestId }); reply({ action: 'cancel', requestId });
    assert.equal(timers.size, 1);
    assert.equal(listeners.size, 1);
  }
  assert.equal([...timers.values()][0].ms, 1000);
  windowEvents.unload();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
});
