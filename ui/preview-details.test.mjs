/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewDetailsPreferences, mountPreviewDetails, PREVIEW_DETAILS_STORAGE_KEY } from './preview-details.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const dataKey = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
class Element {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.dataset = {}; this.attributes = new Map(); this.children = []; this.listeners = new Map(); this.hidden = false; this.className = ''; this.value = ''; this._text = ''; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentElement = null; }); this.children = []; this._text = ''; this.append(...nodes); }
  remove() { if (this.parentElement) { const parent = this.parentElement; parent.children = parent.children.filter(node => node !== this); this.parentElement = null; } }
  matches(selector) { return selector.split(',').some(part => { const value = part.trim(); if (value.startsWith('.')) return this.className.split(' ').includes(value.slice(1)); if (value.startsWith('#')) return this.id === value.slice(1); const attribute = value.match(/^\[([^=\]]+)(?:=['"]?([^'"\]]*)['"]?)?\]$/); if (attribute) { const [, name, expected] = attribute; const actual = name.startsWith('data-') ? this.dataset[dataKey(name.slice(5))] : this.getAttribute(name); return actual != null && (expected == null || actual === expected); } return this.tagName.toLowerCase() === value; }); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== callback)); }
  dispatch(type, extra = {}) { const event = { type, target: this, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; for (const listener of [...(this.listeners.get(type) || [])]) listener(event); return event; }
  focus() { this.ownerDocument.activeElement = this; }
  select() { this.selected = true; }
}
function fixture() {
  const document = { activeElement: null, createElement(tag) { return new Element(tag, this); } };
  const make = (tag, className = '') => { const element = document.createElement(tag); element.className = className; return element; };
  const dialog = make('dialog'), heading = make('div', 'dialog-heading'), label = make('div'), title = make('h2');
  title.id = 'dialog-title'; title.textContent = '旧名称';
  const close = make('button'); close.dataset.action = 'close-dialog';
  label.append(title); heading.append(label, close);
  const workspace = make('div', 'preview-workspace'), media = make('div', 'preview-media'), panel = make('aside', 'preview-details');
  const field = make('input'); field.dataset.field = 'name'; panel.append(field); workspace.append(media, panel); dialog.append(heading, workspace);
  return { document, dialog, heading, title, panel, media };
}
function storage(initial) { const values = new Map(initial == null ? [] : [[PREVIEW_DETAILS_STORAGE_KEY, initial]]), writes = []; return { values, writes, getItem: key => values.get(key), setItem(key, value) { values.set(key, value); writes.push([key, value]); } }; }
function mount(options = {}) { const ui = fixture(), cache = options.storage || storage(), preferences = createPreviewDetailsPreferences({ getStorage: () => cache }); const controller = mountPreviewDetails({ ...ui, preferences, assetId: 'asset-a', initialName: '旧名称', ...options }); return { ...ui, controller, cache, preferences }; }

test('preview details default to collapsed and persist only deliberate choices', () => {
  const { dialog, panel, cache } = mount();
  const toggle = dialog.querySelector('[data-preview-details-toggle]');
  assert.ok(toggle); assert.equal(panel.hidden, true); assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(cache.writes.length, 0);
  toggle.dispatch('click'); assert.equal(panel.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true'); assert.equal(cache.values.get(PREVIEW_DETAILS_STORAGE_KEY), 'true');
  toggle.dispatch('click'); assert.equal(panel.hidden, true); assert.equal(cache.values.get(PREVIEW_DETAILS_STORAGE_KEY), 'false');
});
test('a recreated preview restores the expanded choice', () => {
  const cache = storage(); const first = mount({ storage: cache }); first.dialog.querySelector('[data-preview-details-toggle]').dispatch('click'); first.controller.dispose();
  assert.equal(mount({ storage: cache }).panel.hidden, false);
});
test('unavailable or malformed preference storage remains usable for this session', () => {
  assert.equal(createPreviewDetailsPreferences({ getStorage: () => storage('broken') }).get().expanded, false);
  const preferences = createPreviewDetailsPreferences({ getStorage() { throw new Error('denied'); } });
  assert.equal(preferences.get().expanded, false); preferences.setExpanded(true); assert.equal(preferences.get().expanded, true);
});
test('clicking the title edits it and Enter commits a trimmed name for its mounted asset', async () => {
  const saved = [], ui = mount({ onRename: async (...args) => saved.push(args) }); ui.title.dispatch('click');
  const input = ui.title.querySelector('[data-preview-title-input]'); assert.ok(input); assert.equal(input.value, '旧名称'); assert.equal(ui.document.activeElement, input);
  input.value = '  新名称  '; const event = input.dispatch('keydown', { key: 'Enter' }); await flush();
  assert.deepEqual(saved, [['新名称', 'asset-a']]); assert.equal(ui.title.querySelector('[data-preview-title-text]').textContent, '新名称'); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
});
test('title editing is keyboard accessible and blur saves once', async () => {
  const saved = [], ui = mount({ onRename: async value => saved.push(value) }); ui.title.dispatch('keydown', { key: 'Enter' });
  const input = ui.title.querySelector('[data-preview-title-input]'); assert.ok(input); input.value = '失焦名称'; input.dispatch('blur'); input.dispatch('blur'); await flush();
  assert.deepEqual(saved, ['失焦名称']); assert.equal(ui.title.querySelector('[data-preview-title-text]').textContent, '失焦名称');
});
test('Escape restores the original name without saving or closing the dialog', async () => {
  const saved = [], ui = mount({ onRename: async value => saved.push(value) }); ui.title.dispatch('click'); const input = ui.title.querySelector('[data-preview-title-input]'); input.value = '不保存';
  const event = input.dispatch('keydown', { key: 'Escape' }); input.dispatch('blur'); await flush();
  assert.equal(ui.title.querySelector('[data-preview-title-text]').textContent, '旧名称'); assert.deepEqual(saved, []); assert.equal(event.stopped, true);
});
test('empty and unchanged names leave the stored name intact', async () => {
  const saved = [], ui = mount({ onRename: async value => saved.push(value) });
  for (const value of ['   ', '旧名称']) { ui.title.dispatch('click'); const input = ui.title.querySelector('[data-preview-title-input]'); input.value = value; input.dispatch('keydown', { key: 'Enter' }); await flush(); }
  assert.deepEqual(saved, []); assert.equal(ui.title.querySelector('[data-preview-title-text]').textContent, '旧名称');
});
test('a failed save restores the original name and exposes an accessible error', async () => {
  const errors = [], failure = new Error('名称保存失败，请重试'), ui = mount({ onRename: async () => { throw failure; }, onError: error => errors.push(error) });
  ui.title.dispatch('click'); const input = ui.title.querySelector('[data-preview-title-input]'); input.value = '失败名称'; input.dispatch('keydown', { key: 'Enter' }); await flush();
  assert.equal(ui.title.querySelector('[data-preview-title-text]').textContent, '旧名称'); const error = ui.dialog.querySelector('[data-preview-name-error]'); assert.equal(error.hidden, false); assert.equal(error.textContent, failure.message); assert.equal(error.getAttribute('role'), 'alert'); assert.deepEqual(errors, [failure]);
});
test('background updates preserve an active title draft and update an idle title', () => {
  const ui = mount(); ui.controller.update({ id: 'asset-a', name: '外部修改' }); assert.equal(ui.title.querySelector('[data-preview-title-text]').textContent, '外部修改');
  ui.title.dispatch('click'); const input = ui.title.querySelector('[data-preview-title-input]'); input.value = '草稿'; ui.controller.update({ id: 'asset-a', name: '后台修改' });
  assert.equal(ui.title.querySelector('[data-preview-title-input]'), input); assert.equal(input.value, '草稿'); assert.equal(ui.controller.isEditing(), true);
  ui.controller.update({ id: 'asset-b', name: '其他素材' }); assert.equal(input.value, '草稿');
});
test('a late rename result cannot mutate a disposed preview', async () => {
  let resolve; const ui = mount({ onRename: () => new Promise(done => { resolve = done; }) }); ui.title.dispatch('click'); const input = ui.title.querySelector('[data-preview-title-input]'); input.value = '迟到结果'; input.dispatch('keydown', { key: 'Enter' });
  ui.controller.dispose(); resolve(); await flush(); assert.equal(ui.title.querySelector('[data-preview-title-input]'), input);
});
test('image previews retain copy and location actions while removing FLA-only actions', () => {
  const ui = fixture(); for (const action of ['open-animate', 'send', 'replace-preview', 'retry', 'restore-preview', 'duplicate-file', 'reveal-file']) { const button = ui.document.createElement('button'); button.dataset.action = action; ui.media.append(button); }
  mountPreviewDetails({ ...ui, preferences: createPreviewDetailsPreferences({ getStorage: () => storage() }), assetId: 'image', initialName: '图片', isImage: true });
  for (const action of ['open-animate', 'replace-preview', 'retry', 'restore-preview']) assert.equal(ui.dialog.querySelector(`[data-action='${action}']`), null);
  assert.ok(ui.dialog.querySelector('[data-action=send]'));
  assert.ok(ui.dialog.querySelector('[data-action=duplicate-file]')); assert.ok(ui.dialog.querySelector('[data-action=reveal-file]'));
});
