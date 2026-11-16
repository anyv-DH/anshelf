import test from 'node:test';
import assert from 'node:assert/strict';
import { mountUpdateDownloadControls } from './update-download-controls.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function fixture({ accept = true, waitConfirm = false, failLaunch = false } = {}) {
  const nodes = new Map(), listeners = new Map(), calls = [], prompts = [], transfer = deferred(), confirmation = deferred();
  const node = () => ({ hidden: false, disabled: false, textContent: '', dataset: {}, removeAttribute() {} });
  const panel = { hidden: false, children: [], set innerHTML(value) { this.html = value; this.children = [1]; }, querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); } };
  const document = { querySelectorAll: () => [panel], querySelector: selector => panel.querySelector(selector), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const api = { async downloadUpdate(...args) { calls.push(['download', ...args]); return transfer.promise; }, async launchUpdate(...args) { calls.push(['launch', ...args]); if (failLaunch) throw new Error('校验失败'); }, async cancelUpdateDownload() { calls.push(['cancel']); }, onUpdateProgress() { return () => {}; } };
  const control = mountUpdateDownloadControls({ document, api, getUpdate: () => ({ status: 'available', latestVersion: '0.3.99' }), confirm: options => { prompts.push(options); return waitConfirm ? confirmation.promise : Promise.resolve(accept); } }); control.refresh();
  return { control, panel, calls, prompts, transfer, confirmation, setLaunchFailure(value) { failLaunch = value; }, click(action) { listeners.get('click')?.({ target: { closest: () => ({ dataset: { updateAction: action } }) } }); }, get: selector => panel.querySelector(selector) };
}
test('primary one-click update confirms once then downloads, verifies, and launches without a second click', async () => {
  for (const mode of ['installed', 'portable']) {
    const f = fixture(); assert.match(f.panel.html, /class="button primary" data-update-action="update">一键更新/);
    f.click('update'); await flush(); assert.equal(f.prompts.length, 1); assert.match(f.prompts[0].message, /保存 AN/); assert.match(f.prompts[0].message, /校验/); assert.match(f.prompts[0].message, /安装向导/);
    assert.deepEqual(f.calls, [['download']]);
    f.transfer.resolve({ ready: true, version: '0.3.99', mode }); await flush();
    assert.deepEqual(f.calls, [['download'], ['launch']]); assert.equal(f.prompts.length, 1);
  }
});
test('rejecting one-click confirmation makes no download or launch request', async () => {
  const f = fixture({ accept: false }); f.click('update'); await flush(); assert.deepEqual(f.calls, []);
});
test('duplicate clicks during confirmation, transfer and launching cannot start another update', async () => {
  const f = fixture({ waitConfirm: true }); f.click('update'); f.click('update'); f.click('download'); await flush(); assert.equal(f.prompts.length, 1);
  f.confirmation.resolve(true); await flush(); f.click('update'); f.click('download'); await flush(); assert.deepEqual(f.calls, [['download']]);
  f.transfer.resolve({ ready: true, version: '0.3.99', mode: 'installed' }); await flush(); f.click('update'); f.click('download'); f.click('launch'); await flush(); assert.deepEqual(f.calls, [['download'], ['launch']]);
});
test('cancel and disposal invalidate an in-flight one-click result before it can launch', async () => {
  for (const action of ['cancel', 'dispose']) {
    const f = fixture(); f.click('update'); await flush();
    if (action === 'dispose') f.control.dispose(); else { f.click('cancel'); await flush(); }
    f.transfer.resolve({ ready: true, version: '0.3.99', mode: 'installed' }); await flush();
    assert.equal(f.calls.filter(([method]) => method === 'launch').length, 0, action);
  }
});
test('download errors, cancellation and invalid verified results never launch', async () => {
  for (const result of [null, { ready: false }, { ready: true, mode: 'installed' }, { ready: true, mode: 'other', version: '0.3.99' }, { cancelled: true }]) {
    const f = fixture(); f.click('update'); await flush(); f.transfer.resolve(result); await flush(); assert.equal(f.calls.length, 1);
  }
  const f = fixture(); f.click('update'); await flush(); f.transfer.reject(new Error('下载失败')); await flush(); assert.deepEqual(f.calls, [['download']]); assert.equal(f.get('[data-update-action="update"]').disabled, false);
});
test('only-download preserves the separate manual launch confirmation', async () => {
  const f = fixture(); f.click('download'); await flush(); f.transfer.resolve({ ready: true, version: '0.3.99', mode: 'installed' }); await flush();
  assert.deepEqual(f.calls, [['download']]); f.click('launch'); await flush(); assert.deepEqual(f.calls, [['download'], ['launch']]); assert.equal(f.prompts.length, 2);
});
test('launch verification failure exposes a new download and a fresh verified update can launch successfully', async () => {
  const f = fixture({ failLaunch: true }); f.click('update'); await flush(); f.transfer.resolve({ ready: true, version: '0.3.99', mode: 'installed' }); await flush();
  assert.match(f.get('[data-update-download-status]').textContent, /校验失败/); assert.equal(f.get('[data-update-action="launch"]').hidden, true); assert.equal(f.get('[data-update-action="update"]').hidden, false); assert.equal(f.calls.length, 2);
  f.setLaunchFailure(false); f.click('update'); await flush();
  assert.deepEqual(f.calls, [['download'], ['launch'], ['download'], ['launch']]); assert.equal(f.prompts.length, 2);
});
