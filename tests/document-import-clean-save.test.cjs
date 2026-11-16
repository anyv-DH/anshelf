/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const receiverModule = require('../plugin/queue.cjs');
const { createDocumentImportReceiver } = require('../desktop/document-import.cjs');
const script = fsSync.readFileSync(path.join(__dirname, '../plugin/insert-whole.jsfl'), 'utf8');

function nativeDocument(current, saveResult = false) {
  const calls = { saves: 0, modified: 0 };
  const context = vm.createContext({
    fl: {
      getDocumentDOM: () => current,
      saveDocument(document) {
        assert.equal(document, current);
        calls.saves++;
        if (saveResult instanceof Error) throw saveResult;
        return saveResult;
      },
    },
    confirm: () => true, JSON,
  });
  vm.runInContext(script, context);
  return { context, calls, run: id => JSON.parse(context.AnShelfCurrentDocumentForLibrary(id)) };
}

test('an already saved unmodified FLA remains importable when native save would return false', () => {
  let modifiedChecks = 0;
  const current = { id: 42, name: 'clean.fla', path: 'C:/work/clean.fla', pathURI: 'file:///C|/work/clean.fla',
    isModified() { assert.equal(this, current); modifiedChecks++; return false; } };
  const native = nativeDocument(current);
  assert.deepEqual(native.run('42'), { version: 1, ok: true, file: current.path, name: current.name });
  assert.equal(modifiedChecks, 1, 'Animate exposes isModified as a method');
  assert.equal(native.calls.saves, 0, 'a clean saved document has no changes to save');
});

test('dirty, untitled and unknown modification states still require a successful native save', () => {
  const saved = { id: 42, name: 'current.fla', path: 'C:/work/current.fla', pathURI: 'file:///C|/work/current.fla' };
  const cases = [
    { label: 'modified', document: { ...saved, isModified: () => true } },
    { label: 'untitled', document: { id: 42, name: 'Untitled-1', path: null, pathURI: null, isModified: () => false } },
    { label: 'missing file path', document: { ...saved, path: null, isModified: () => false } },
    { label: 'missing file URI', document: { ...saved, pathURI: null, isModified: () => false } },
    { label: 'missing method', document: saved },
    { label: 'boolean property is not the native method', document: { ...saved, isModified: false } },
    { label: 'nonboolean method result', document: { ...saved, isModified: () => null } },
    { label: 'state query throws', document: { ...saved, isModified() { throw new Error('state unavailable'); } } },
  ];
  for (const { label, document } of cases) {
    const native = nativeDocument(document);
    const result = native.run('42');
    assert.equal(result.ok, false, label);
    assert.equal(result.cancelled, true, label);
    assert.equal(result.file, undefined, label);
    assert.equal(native.calls.saves, 1, label);
  }
  const unknown = nativeDocument(saved, true);
  assert.equal(unknown.run('42').ok, true);
  assert.equal(unknown.calls.saves, 1);
  const failed = nativeDocument({ ...saved, isModified: () => true }, new Error('save failed'));
  assert.match(failed.run('42').error, /save failed/);
  assert.equal(failed.calls.saves, 1);
});

test('clean-document optimization cannot bypass the confirmed document identity', () => {
  let checks = 0;
  const current = { id: 43, name: 'other.fla', path: 'C:/work/other.fla', pathURI: 'file:///C|/work/other.fla',
    isModified() { checks++; return false; } };
  const native = nativeDocument(current);
  const result = native.run('42');
  assert.equal(result.ok, false);
  assert.match(result.error, /文档已切换/);
  assert.equal(checks, 0);
  assert.equal(native.calls.saves, 0);
});

test('confirmed panel entry queues a clean saved FLA and consumes the real import receipt', async t => {
  const appData = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-clean-import-'));
  const root = path.join(appData, 'AnShelf');
  const file = path.join(appData, 'clean.fla');
  const original = Buffer.from('unchanged saved FLA fixture');
  await fs.writeFile(file, original);
  const options = { mode: 'effect', categoryId: null, previewResolution: 2048, preferExistingPreview: false };
  const imports = [];
  const receiver = await createDocumentImportReceiver({ root, importDocument: async (source, selected) => {
    imports.push({ source, selected }); return { assetId: 'clean', name: 'clean' };
  } });
  t.after(async () => { await receiver.close(); await fs.rm(appData, { recursive: true, force: true }); });
  const current = { id: 42, name: 'clean.fla', path: file, pathURI: pathToFileURL(file).href, isModified: () => false };
  const native = nativeDocument(current);
  native.context.fl.runScript = (uri, entry, ...args) => {
    assert.ok(uri.endsWith('insert-whole.jsfl'));
    return native.context[entry](...args);
  };
  const listeners = {}, events = [];
  const element = () => ({ disabled: false, textContent: '', title: '',
    setAttribute() {}, addEventListener(name, handler) { this[name] = handler; }, focus() {} });
  const add = element(), insert = element();
  const api = { getSystemPath: () => path.join(__dirname, '../plugin'),
    evalScript(code, callback) { callback(vm.runInContext(code, native.context)); },
    addEventListener(name, handler) { listeners[name] = handler; },
    removeEventListener(name) { delete listeners[name]; },
    dispatchEvent(event) { events.push(event); }, requestOpenExtension() {},
  };
  let tick;
  const window = { __adobe_cep__: api, addEventListener() {}, cep_node: { require(name) {
    if (name === 'process') return { env: { APPDATA: appData } };
    if (name === 'path') return path;
    if (name === 'crypto') return require('node:crypto');
    return receiverModule;
  } } };
  vm.runInNewContext(fsSync.readFileSync(path.join(__dirname, '../plugin/panel.js'), 'utf8'), {
    window, document: { getElementById: id => id === 'add-current' ? add : id === 'insert' ? insert : null, addEventListener() {} },
    JSON, Date, decodeURI, setInterval(handler) { tick = handler; return 1; }, clearInterval() {},
  });
  const emit = data => listeners['com.anshelf.receiver.import-settings.response']({
    extensionId: 'com.anshelf.receiver.import-settings', data,
  });
  add.click(); emit({ action: 'ready' });
  const show = events.map(event => JSON.parse(event.data)).find(event => event.action === 'show');
  assert.equal(show.documentId, current.id);
  emit({ action: 'opened', requestId: show.requestId });
  emit({ action: 'confirm', requestId: show.requestId, options });
  assert.equal(add.textContent, '正在加入…');
  assert.equal(native.calls.saves, 0);
  await receiver.drain();
  tick();
  assert.equal(add.textContent, '已加入 ✓');
  assert.deepEqual(imports, [{ source: file, selected: options }]);
  assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await fs.readdir(path.join(root, 'bridge/document-import/inbox')), []);
  assert.deepEqual(await fs.readdir(path.join(root, 'bridge/document-import/results')), []);
});

test('the updated plugin manifest and heartbeat identify the same 0.3.20 runtime', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-plugin-version-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const xml = await fs.readFile(path.join(__dirname, '../plugin/CSXS/manifest.xml'), 'utf8');
  assert.ok(xml.includes('ExtensionBundleVersion="0.3.20"'));
  assert.equal(xml.split('Version="0.3.20"').length - 1, 3);
  new receiverModule.Queue(root).heartbeat(false, 42);
  const status = JSON.parse(await fs.readFile(path.join(root, 'bridge/status.json'), 'utf8'));
  assert.equal(status.pluginVersion, '0.3.20');
});
