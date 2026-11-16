/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnboardingPreferences, mountOnboarding, ONBOARDING_STORAGE_KEY, ONBOARDING_STEPS } from './onboarding.mjs';

function storage(value) {
  const values = new Map(value === undefined ? [] : [[ONBOARDING_STORAGE_KEY, value]]);
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}
class Element {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.listeners = new Map(); this.parentNode = null; this.open = false; this.hidden = false; this.textContent = ''; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  getBoundingClientRect() { return { left: 20, top: 20, right: 380, bottom: 400, width: 360, height: 380 }; }
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { this.ownerDocument.activeElement = this; }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener); }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  fire(name, extra = {}) { const event = { target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; for (const listener of this.listeners.get(name) || []) listener(event); return event; }
  showModal() { if (this.ownerDocument.failOpen) throw new Error('window unavailable'); this.open = true; }
  close() { this.open = false; this.fire('close'); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const data = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (data) { const name = data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return Object.hasOwn(this.dataset, name) && (data[2] === undefined || this.dataset[name] === data[2]); }
    return this.tagName.toLowerCase() === selector;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { const all = []; for (const child of this.children) { if (child.matches(selector)) all.push(child); all.push(...child.querySelectorAll(selector)); } return all; }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
}
function fixture({ saved, available = true } = {}) {
  const savedStorage = storage(saved), preferences = createOnboardingPreferences({ getStorage: () => savedStorage });
  const document = { createElement(tag) { return new Element(tag, document); }, querySelector(selector) { return this.body.querySelector(selector); }, querySelectorAll(selector) { return this.body.querySelectorAll(selector); } };
  document.body = document.createElement('body');
  const search = document.createElement('input'); search.id = 'search'; document.body.append(search); search.focus();
  const calls = [];
  const control = mountOnboarding({ document, preferences, canOpen: () => available, onClose: () => calls.push(['close', control.isOpen()]), onAction: action => calls.push([action, control.isOpen()]) });
  const dialog = document.querySelector('#onboarding-dialog');
  return { document, preferences, savedStorage, control, dialog, search, calls, available(value) { available = value; }, click(action) { const target = dialog.querySelector(`[data-onboarding-action="${action}"]`); assert.ok(target, action); dialog.fire('click', { target }); }, step(index) { dialog.fire('click', { target: dialog.querySelector(`[data-onboarding-step="${index}"]`) }); } };
}

test('first use defaults to new, validates persisted status and keeps session choices without storage', () => {
  for (const value of [undefined, '{bad', 'null', '[]', '"completed"', '{"status":"unknown"}']) assert.deepEqual(createOnboardingPreferences({ getStorage: () => storage(value) }).get(), { status: 'new' });
  const saved = storage(); const first = createOnboardingPreferences({ getStorage: () => saved });
  assert.equal(first.shouldShow(), true); assert.equal(first.setStatus('completed'), true);
  assert.deepEqual(createOnboardingPreferences({ getStorage: () => saved }).get(), { status: 'completed' });
  assert.equal(first.setStatus('broken'), false); assert.equal(first.shouldShow(), false);
  const fallback = createOnboardingPreferences({ getStorage() { throw new Error('denied'); } }); fallback.setStatus('skipped'); assert.deepEqual(fallback.get(), { status: 'skipped' }); assert.equal(fallback.shouldShow(), false);
});

test('six ordered lessons describe real offline features and use respectful copy', () => {
  assert.deepEqual(ONBOARDING_STEPS.map(step => step.title), ['欢迎', '导入素材', '分类与项目', '预览与整理', '放进 AN', '按习惯浏览']);
  const text = JSON.stringify(ONBOARDING_STEPS);
  for (const phrase of ['普通 FLA', '静态', '特效', '动态', '音频', '图片', '小文件夹', '顶层', '多个', '封面', '名称', '折叠', '记忆', '工具', '检查更新', '一键安装', '文档', '粘贴', '固定', '滚动', '分页', '六', '预览底色']) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, /你/);
});

test('automatic onboarding defers without timers and opens only once when available', () => {
  const f = fixture({ available: false }); f.control.consider(); assert.equal(f.control.pending(), true); assert.equal(f.control.isPending(), true); assert.equal(f.control.isOpen(), false);
  f.control.resume(); assert.equal(f.control.isOpen(), false);
  f.available(true); f.control.resume(); assert.equal(f.control.isOpen(), true); assert.equal(f.control.pending(), false); assert.equal(f.dialog.dataset.onboardingIndex, '0');
  f.click('skip'); f.control.consider(); f.control.resume(); assert.equal(f.control.isOpen(), false); assert.deepEqual(f.preferences.get(), { status: 'skipped' });
  for (const status of ['completed', 'skipped']) { const existing = fixture({ saved: JSON.stringify({ status }) }); existing.control.consider(); assert.equal(existing.control.isOpen(), false); assert.equal(existing.control.pending(), false); }
});

test('manual replay starts at the first lesson, navigates all six steps, and restores focus', () => {
  const f = fixture({ saved: '{"status":"completed"}' }); assert.equal(f.control.open(f.search), true);
  assert.equal(f.dialog.attributes['aria-labelledby'], 'onboarding-title'); assert.equal(f.dialog.querySelectorAll('[data-onboarding-step]').length, 6);
  assert.equal(f.document.activeElement, f.dialog.querySelector('#onboarding-step-title'));
  for (let index = 1; index <= 5; index++) { f.click('next'); assert.equal(f.dialog.dataset.onboardingIndex, String(index)); }
  f.click('previous'); assert.equal(f.dialog.dataset.onboardingIndex, '4'); f.step(2); assert.equal(f.dialog.dataset.onboardingIndex, '2');
  assert.equal(f.document.activeElement, f.dialog.querySelector('#onboarding-step-title')); f.step(5); f.click('finish');
  assert.equal(f.control.isOpen(), false); assert.equal(f.document.activeElement, f.search); assert.deepEqual(f.calls, [['close', false]]);
  assert.deepEqual(f.preferences.get(), { status: 'completed' }); f.control.open(); assert.equal(f.dialog.dataset.onboardingIndex, '0'); f.click('close'); assert.deepEqual(f.preferences.get(), { status: 'completed' });
});

test('reopening the tutorial resets its own scroll and a removed trigger falls back to search', () => {
  const f = fixture(), trigger = f.document.createElement('button'); f.document.body.append(trigger); trigger.focus(); f.control.open(trigger);
  f.dialog.scrollTop = 350; f.step(3); assert.equal(f.dialog.scrollTop, 0);
  trigger.remove(); f.click('close'); assert.equal(f.document.activeElement, f.search);
});

test('page guide shows a compact card and a real-page highlight instead of demonstration cards', () => {
  const f = fixture(); f.control.open();
  assert.ok(f.dialog.querySelector('[data-onboarding-card]'));
  assert.ok(f.dialog.querySelector('[data-onboarding-target]'));
  assert.equal(f.dialog.querySelector('[data-onboarding-demo]'), null);
});

test('the AN lesson reveals tools temporarily and restores its original state on leave or disposal', () => {
  for (const initial of [false, true]) {
    const f = fixture(), tools = f.document.createElement('details'); tools.id = 'workspace-tools'; tools.open = initial; f.document.body.append(tools);
    f.control.open(); f.step(4); assert.equal(tools.open, true);
    f.step(5); assert.equal(tools.open, initial);
    f.step(4); f.click('close'); assert.equal(tools.open, initial);
    f.control.open(); f.step(4); f.control.dispose(); assert.equal(tools.open, initial);
  }
});

test('replaying from a tools button restores focus to its visible summary after the menu closes', () => {
  const f = fixture(), tools = f.document.createElement('details'), summary = f.document.createElement('summary'), trigger = f.document.createElement('button');
  tools.id = 'workspace-tools'; tools.open = true; tools.append(summary, trigger); f.document.body.append(tools);
  f.control.open(trigger); tools.open = false; f.click('close');
  assert.equal(f.document.activeElement, summary);
});

test('skip, X, native Escape and external close mark only unfinished onboarding skipped', () => {
  for (const action of ['skip', 'close', 'escape', 'native']) {
    const f = fixture(); f.control.open();
    if (action === 'escape') { const event = f.dialog.fire('cancel'); assert.equal(event.defaultPrevented, true); }
    else if (action === 'native') f.dialog.close(); else f.click(action);
    assert.equal(f.control.isOpen(), false); assert.deepEqual(f.preferences.get(), { status: 'skipped' }); assert.deepEqual(f.calls, [['close', false]]);
  }
});

test('optional finish actions close and persist before handing off, then notify close', () => {
  for (const action of ['import', 'bridge']) {
    const f = fixture(); f.control.open(); f.step(5); f.click(action);
    assert.deepEqual(f.preferences.get(), { status: 'completed' }); assert.deepEqual(f.calls, [[action, false], ['close', false]]);
  }
});

test('blocked manual open, failed native open and disposal never mark the tutorial skipped', () => {
  const f = fixture({ available: false }); assert.equal(f.control.open(), false); assert.deepEqual(f.preferences.get(), { status: 'new' });
  f.control.consider(); f.available(true); f.document.failOpen = true; f.control.resume(); assert.equal(f.control.pending(), true); assert.equal(f.control.isOpen(), false);
  f.document.failOpen = false; f.control.resume(); assert.equal(f.control.isOpen(), true); f.control.dispose(); f.control.dispose();
  assert.equal(f.control.isOpen(), false); assert.equal(f.control.pending(), false); assert.equal(f.dialog.isConnected, false); assert.deepEqual(f.preferences.get(), { status: 'new' }); assert.deepEqual(f.calls, []);
  f.dialog.fire('cancel'); f.control.consider(); f.control.resume(); assert.equal(f.control.open(), false); assert.deepEqual(f.calls, []);
});
