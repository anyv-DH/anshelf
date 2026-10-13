/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountStageDrag, DISTANCE } from './stage-drag.mjs';

const settled = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, { begin = () => Promise.resolve({ token: 'token-1', expiresAt: Date.now() + 30000 }) } = {}) {
  const listeners = new Map(), calls = [], states = [], errors = [], captures = [];
  const root = { addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  const handle = { dataset: { stageDragId: 'fla' }, setPointerCapture(id) { captures.push(['set', id]); }, releasePointerCapture(id) { captures.push(['release', id]); }, closest(selector) { return selector === '[data-stage-drag-id]' ? this : null; } };
  const shelf = { beginStageDrag: id => { calls.push(['begin', id]); return begin(id); }, endStageDrag: token => { calls.push(['end', token]); return Promise.resolve({ ok: true, waiting: true }); }, cancelStageDrag: token => { calls.push(['cancel', token]); return Promise.resolve({ cancelled: true }); }, confirmStageHandoff:token=>{calls.push(['confirm-handoff',token]);return Promise.resolve({activated:true});}, onStageDragResult: fn => { shelf.result = fn; return () => { shelf.unsubscribed = true; }; }, startDrag() { calls.push(['native-file']); } };
  const assets = { fla: { id: 'fla', kind: 'fla' }, audio: { id: 'audio', kind: 'audio' } };
  const controller = mountStageDrag({ root, shelf, getAsset: id => assets[id], onError: e => errors.push(String(e.message || e)), onState: value => states.push(value) });
  t.after(() => controller.dispose());
  const event = (type, x, y, target = handle) => ({ type, button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y, target, preventDefault() {} });
  const start = () => { controller.pointerdown(event('pointerdown', 0, 0)); controller.pointermove(event('pointermove', DISTANCE, 0)); };
  return { listeners, calls, states, errors, captures, handle, shelf, controller, event, start };
}

test('clicks, small movement, audio, right clicks and nonprimary pointers never start a FLA stage drag', t => {
  const f = fixture(t);
  assert.equal(f.controller.pointerdown(f.event('pointerdown', 10, 10)), true);
  f.controller.pointermove(f.event('pointermove', 10 + DISTANCE - 1, 10));
  f.controller.pointerup(f.event('pointerup', 10 + DISTANCE - 1, 10));
  assert.deepEqual(f.calls, []);
  const audio = { dataset: { stageDragId: 'audio' }, closest: () => audio };
  assert.equal(f.controller.pointerdown(f.event('pointerdown', 10, 10, audio)), false);
  assert.equal(f.controller.pointerdown({ ...f.event('pointerdown', 10, 10), button: 2 }), false);
  assert.equal(f.controller.pointerdown({ ...f.event('pointerdown', 10, 10), isPrimary: false }), false);
  assert.deepEqual(f.calls, []);
});

test('threshold starts a single FLA gesture synchronously; release after start only ends and never exports a file', async t => {
  const f = fixture(t);
  f.start();
  assert.deepEqual(f.calls, [['begin', 'fla']]);
  f.controller.pointermove(f.event('pointermove', 30, 0));
  await settled();
  assert.deepEqual(f.captures.filter(x => x[0] === 'set'), [['set', 1]]);
  f.controller.pointerup(f.event('pointerup', 30, 0));
  f.controller.pointerup(f.event('pointerup', 30, 0));
  await settled();
  assert.deepEqual(f.calls, [['begin', 'fla'], ['end', 'token-1']]);
  assert.ok(f.states.includes('dragging'));
  f.shelf.result({ token: 'token-1', ok: true, requestId: 'request-1' });
  assert.equal(f.controller.active, null);
});

test('release during helper startup cancels the resolved token once and never ends or sends it', async t => {
  let resolveBegin;
  const f = fixture(t, { begin: () => new Promise(resolve => { resolveBegin = resolve; }) });
  f.start();
  f.controller.pointerup(f.event('pointerup', 8, 0));
  resolveBegin({ token: 'late-token' });
  await settled();
  assert.deepEqual(f.calls, [['begin', 'fla'], ['cancel', 'late-token']]);
  assert.equal(f.controller.active, null);
});

test('Escape during setup or after setup cancels once, and repeated Escape cannot launch another action', async t => {
  let resolveBegin;
  const f = fixture(t, { begin: () => new Promise(resolve => { resolveBegin = resolve; }) });
  f.start();
  f.controller.keydown({ key: 'Escape', preventDefault() {} });
  f.controller.keydown({ key: 'Escape', preventDefault() {} });
  resolveBegin({ token: 'late-token' });
  await settled();
  assert.deepEqual(f.calls, [['begin', 'fla'], ['cancel', 'late-token']]);
  const g = fixture(t); g.start(); await settled();
  g.controller.keydown({ key: 'Escape', preventDefault() {} });
  await settled();
  assert.deepEqual(g.calls, [['begin', 'fla'], ['cancel', 'token-1']]);
  assert.equal(g.controller.active, null);
});

test('unload disposes listeners and cancels a token even when begin resolves later', async t => {
  let resolveBegin;
  const f = fixture(t, { begin: () => new Promise(resolve => { resolveBegin = resolve; }) });
  f.start(); f.controller.dispose(); resolveBegin({ token: 'late-token' });
  await settled();
  assert.deepEqual(f.calls, [['begin', 'fla'], ['cancel', 'late-token']]);
  assert.equal(f.shelf.unsubscribed, true);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.controller.active, null);
});

test('begin failures and malformed responses clear capture and show the real bridge error', async t => {
  for (const begin of [() => { throw new Error('面板未就绪'); }, () => Promise.reject(new Error('面板未就绪'))]) {
    const f = fixture(t, { begin }); f.start(); await settled();
    assert.match(f.errors.join(' '), /面板未就绪/);
    assert.equal(f.controller.active, null);
  }
  const f = fixture(t, { begin: () => Promise.resolve({}) }); f.start(); await settled();
  assert.equal(f.controller.active, null);
  assert.ok(f.errors.length);
});

test('native result during startup is matched only after token is known, and unrelated results are ignored', async t => {
  let resolveBegin;
  const f = fixture(t, { begin: () => new Promise(resolve => { resolveBegin = resolve; }) });
  f.start();
  f.shelf.result({ token: 'token-1', ok: false, error: '目标不是 AN 舞台' });
  assert.notEqual(f.controller.active, null);
  resolveBegin({ token: 'token-1' });
  await settled();
  assert.equal(f.controller.active, null);
  assert.match(f.errors.join(' '), /AN 舞台/);
  const g = fixture(t); g.start(); await settled();
  g.shelf.result({ token: 'old-token', ok: true });
  assert.notEqual(g.controller.active, null);
  g.shelf.result({ token: 'token-1', ok: false, cancelled: true });
  assert.equal(g.controller.active, null);
});

test('pointercancel never exports a file or finishes an unintended target', async t => {
  const f = fixture(t); f.start(); await settled();
  f.controller.pointercancel(f.event('pointercancel', 8, 0));
  await settled();
  assert.deepEqual(f.calls, [['begin', 'fla'], ['cancel', 'token-1']]);
  assert.equal(f.controller.active, null);
});

test('trusted AN taskbar handoff retains native release monitoring after host activation loses pointer capture',async t=>{
  const f=fixture(t);f.start();await settled();
  f.shelf.result({token:'token-1',phase:'host-handoff',pid:2});
  assert.notEqual(f.controller.active,null);assert.equal(f.errors.length,0);
  f.controller.pointercancel(f.event('pointercancel',8,0));await settled();
  assert.deepEqual(f.calls,[['begin','fla'],['confirm-handoff','token-1']]);assert.notEqual(f.controller.active,null);
  f.shelf.result({token:'token-1',ok:true,requestId:'request-1'});assert.equal(f.controller.active,null);
});

test('Escape still cancels a native taskbar handoff and mismatched notification cannot suppress cancellation',async t=>{
  const f=fixture(t);f.start();await settled();f.shelf.result({token:'token-1',phase:'host-handoff',pid:2});
  f.controller.keydown({key:'Escape',preventDefault(){}});await settled();assert.deepEqual(f.calls,[['begin','fla'],['confirm-handoff','token-1'],['cancel','token-1']]);
  const g=fixture(t);g.start();await settled();g.shelf.result({token:'other-token',phase:'host-handoff',pid:2});
  g.controller.pointercancel(g.event('pointercancel',8,0));await settled();assert.deepEqual(g.calls,[['begin','fla'],['cancel','token-1']]);
});
