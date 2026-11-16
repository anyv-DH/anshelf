/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { THEMES, createAppearancePreferences, mountAppearance } from './appearance.mjs';

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('appearance defaults to the new layout and preserves existing theme storage independently', () => {
  const empty = createAppearancePreferences({ getStorage: () => storage() });
  assert.deepEqual(empty.get(), { layout: 'modern', theme: 'dark', previewBackground: 'checker' });
  const old = storage({ 'anshelf-theme': 'warm' });
  assert.deepEqual(createAppearancePreferences({ getStorage: () => old }).get(), { layout: 'modern', theme: 'warm', previewBackground: 'checker' });
  const mixed = storage({ 'anshelf-theme': 'sage', 'anshelf-layout': 'classic' });
  assert.deepEqual(createAppearancePreferences({ getStorage: () => mixed }).get(), { layout: 'classic', theme: 'sage', previewBackground: 'checker' });
});

test('layout and theme save separately, survive reopening, and return isolated snapshots', () => {
  const saved = storage();
  const preferences = createAppearancePreferences({ getStorage: () => saved });
  const first = preferences.setLayout('classic');
  assert.deepEqual(first, { layout: 'classic', theme: 'dark', previewBackground: 'checker' });
  assert.deepEqual(preferences.setTheme('paper'), { layout: 'classic', theme: 'paper', previewBackground: 'checker' });
  assert.deepEqual(Object.fromEntries(saved.values), { 'anshelf-layout': 'classic', 'anshelf-theme': 'paper' });
  first.layout = 'modern';
  const snapshot = preferences.get(); snapshot.theme = 'dark';
  assert.deepEqual(preferences.get(), { layout: 'classic', theme: 'paper', previewBackground: 'checker' });
  assert.deepEqual(createAppearancePreferences({ getStorage: () => saved }).get(), preferences.get());
});

test('invalid stored or requested choices cannot introduce an unsupported appearance', () => {
  const saved = storage({ 'anshelf-theme': '{broken', 'anshelf-layout': 'unknown' });
  const preferences = createAppearancePreferences({ getStorage: () => saved });
  for (const invalid of ['', null, {}, 'light', '__proto__']) {
    assert.deepEqual(preferences.setTheme(invalid), { layout: 'modern', theme: 'dark', previewBackground: 'checker' });
    assert.deepEqual(preferences.setLayout(invalid), { layout: 'modern', theme: 'dark', previewBackground: 'checker' });
  }
  assert.deepEqual(Object.fromEntries(saved.values), { 'anshelf-theme': '{broken', 'anshelf-layout': 'unknown' });
});

test('unavailable storage retains session choices and one unreadable key does not hide the other', () => {
  const preferences = createAppearancePreferences({ getStorage: () => { throw new Error('blocked'); } });
  assert.deepEqual(preferences.setTheme('slate'), { layout: 'modern', theme: 'slate', previewBackground: 'checker' });
  assert.deepEqual(preferences.setLayout('classic'), { layout: 'classic', theme: 'slate', previewBackground: 'checker' });
  const partlyBroken = {
    getItem(key) { if (key === 'anshelf-layout') throw new Error('broken key'); return 'warm'; },
    setItem() { throw new Error('full'); },
  };
  const recovered = createAppearancePreferences({ getStorage: () => partlyBroken });
  assert.deepEqual(recovered.get(), { layout: 'modern', theme: 'warm', previewBackground: 'checker' });
  assert.deepEqual(recovered.setTheme('sage'), { layout: 'modern', theme: 'sage', previewBackground: 'checker' });
});

test('renderer palettes have the same fixed IDs and window background as the desktop contract', () => {
  const require = createRequire(import.meta.url);
  const { THEME_BACKGROUNDS } = require('../desktop/themes.cjs');
  assert.deepEqual(THEMES.map(theme => theme.id), ['dark', 'warm', 'paper', 'slate', 'sage', 'bluewhite']);
  assert.deepEqual(Object.fromEntries(THEMES.map(({ id, background }) => [id, background])), THEME_BACKGROUNDS);
  for (const theme of THEMES) {
    assert.ok(theme.label && theme.description);
    assert.ok(['dark', 'light'].includes(theme.scheme));
  }
});

class Node extends EventTarget {
  constructor(tag, document) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.dataset = {}; this.attributes = {}; this.open = false; }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 100, top: 100, right: 700, bottom: 600 }; }
}
function fixture() {
  const document = { createElement: tag => new Node(tag, document) };
  document.body = new Node('body', document);
  const find = predicate => {
    const nodes = [];
    const walk = item => { nodes.push(item); item.children.forEach(walk); };
    walk(document.body); return nodes.filter(predicate);
  };
  document.querySelector = selector => find(node => node.id === selector.slice(1))[0] || null;
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const preferences = createAppearancePreferences({ getStorage: () => storage() });
  const changes = [], skins = [];
  const appearance = mountAppearance({ document, preferences, onChange: value => changes.push(value), onSkin: () => skins.push(!document.querySelector('#appearance-dialog').open) });
  return { document, trigger, preferences, changes, skins, appearance, find };
}
function click(node, x = 150, y = 150) {
  const event = new Event('click', { cancelable: true });
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } });
  node.dispatchEvent(event);
}

test('appearance dialog applies complete choices immediately and closing preserves them', () => {
  const { document, trigger, appearance, preferences, changes, find } = fixture();
  assert.equal(appearance.open(), true);
  const dialog = document.querySelector('#appearance-dialog');
  assert.equal(dialog.open, true);
  assert.equal(dialog.attributes['aria-labelledby'], 'appearance-title');
  assert.equal(document.activeElement.dataset.appearanceLayout, 'modern');
  click(find(node => node.dataset.appearanceLayout === 'classic')[0]);
  click(find(node => node.dataset.appearanceTheme === 'sage')[0]);
  assert.deepEqual(changes, [{ layout: 'classic', theme: 'dark', previewBackground: 'checker' }, { layout: 'classic', theme: 'sage', previewBackground: 'checker' }]);
  assert.equal(find(node => node.dataset.appearanceLayout === 'classic')[0].attributes['aria-pressed'], 'true');
  assert.equal(find(node => node.dataset.appearanceTheme === 'dark')[0].attributes['aria-pressed'], 'false');
  assert.equal(find(node => node.dataset.action).length, 0, 'appearance must not trigger application delegated actions');
  const event = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, trigger);
  assert.deepEqual(preferences.get(), { layout: 'classic', theme: 'sage', previewBackground: 'checker' });
});

test('appearance uses an independent dialog, ignores padding clicks, and hands off to skin settings after closing', () => {
  const { document, trigger, appearance, skins, find } = fixture();
  const editor = document.createElement('dialog'); document.body.append(editor); editor.showModal();
  editor.append(trigger); trigger.focus();
  appearance.open(); const dialog = document.querySelector('#appearance-dialog');
  assert.equal(appearance.open(), false, 'one dialog instance is reused');
  click(dialog, 200, 200); assert.equal(dialog.open, true);
  click(dialog, 20, 20); assert.equal(dialog.open, false);
  assert.equal(editor.open, true); assert.equal(document.activeElement, trigger);
  appearance.open(); click(find(node => node.dataset.appearanceSkin)[0]);
  assert.deepEqual(skins, [true]); assert.equal(editor.open, true);
  appearance.dispose();
  assert.equal(document.querySelector('#appearance-dialog'), null);
  assert.equal(appearance.open(), false);
  appearance.dispose();
});

test('reopening appearance reflects the latest preferences without notifying an unchanged choice', () => {
  const { document, appearance, preferences, changes, find } = fixture();
  preferences.setLayout('classic'); preferences.setTheme('paper');
  appearance.open();
  assert.equal(document.activeElement.dataset.appearanceLayout, 'classic');
  click(find(node => node.dataset.appearanceTheme === 'paper')[0]);
  assert.deepEqual(changes, []);
  const keyboard = new Event('keydown', { bubbles: true });
  let stopped = false; keyboard.stopPropagation = () => { stopped = true; };
  document.querySelector('#appearance-dialog').dispatchEvent(keyboard);
  assert.equal(stopped, true);
});

test('preview backgrounds persist independently from layout and theme and expose isolated snapshots', () => {
  const saved = storage({ 'anshelf-theme': 'warm', 'anshelf-layout': 'classic' });
  const preferences = createAppearancePreferences({ getStorage: () => saved });
  assert.equal(preferences.get().previewBackground, 'checker');
  for (const value of ['white', 'gray', 'dark', 'checker']) {
    const selected = preferences.setPreviewBackground(value);
    assert.deepEqual(selected, { layout: 'classic', theme: 'warm', previewBackground: value });
    assert.equal(saved.values.get('anshelf-preview-background'), value);
    assert.deepEqual(createAppearancePreferences({ getStorage: () => saved }).get(), selected);
    selected.previewBackground = 'bad';
    assert.equal(preferences.get().previewBackground, value);
  }
  assert.equal(saved.values.has('anshelf-layout'), true);
  assert.equal(saved.values.get('anshelf-theme'), 'warm');
});

test('invalid or unavailable preview storage remains usable without overwriting other choices', () => {
  const saved = storage({ 'anshelf-preview-background': 'transparent', 'anshelf-theme': 'sage' });
  const preferences = createAppearancePreferences({ getStorage: () => saved });
  assert.equal(preferences.get().previewBackground, 'checker');
  for (const value of ['', null, {}, '__proto__', 'url(file:///private)']) {
    assert.equal(preferences.setPreviewBackground(value).previewBackground, 'checker');
  }
  assert.equal(saved.values.get('anshelf-preview-background'), 'transparent');
  assert.equal(preferences.get().theme, 'sage');
  const blocked = createAppearancePreferences({ getStorage: () => { throw new Error('blocked'); } });
  assert.equal(blocked.setPreviewBackground('white').previewBackground, 'white');
  assert.equal(blocked.setTheme('paper').previewBackground, 'white');
  assert.equal(blocked.setLayout('classic').previewBackground, 'white');
});

test('background choices apply immediately in the existing appearance dialog', () => {
  const { document, appearance, preferences, changes, find } = fixture();
  appearance.open();
  const choices = find(node => node.dataset.appearancePreviewBackground);
  assert.deepEqual(choices.map(node => node.dataset.appearancePreviewBackground), ['checker', 'white', 'gray', 'dark']);
  assert.equal(choices[0].attributes['aria-pressed'], 'true');
  click(choices[1]);
  assert.deepEqual(changes, [{ layout: 'modern', theme: 'dark', previewBackground: 'white' }]);
  assert.equal(choices[0].attributes['aria-pressed'], 'false');
  assert.equal(choices[1].attributes['aria-pressed'], 'true');
  assert.equal(document.querySelector('#appearance-dialog').open, true);
  click(choices[1]);
  assert.equal(changes.length, 1);
  document.querySelector('#appearance-dialog').close();
  appearance.open();
  assert.equal(preferences.get().previewBackground, 'white');
  assert.equal(choices[1].attributes['aria-pressed'], 'true');
});

test('blue-white theme is selectable and persists without changing layout or preview background', () => {
  const saved = storage({ 'anshelf-layout': 'classic', 'anshelf-theme': 'warm', 'anshelf-preview-background': 'dark' });
  const preferences = createAppearancePreferences({ getStorage: () => saved });
  assert.deepEqual(preferences.setTheme('bluewhite'), { layout: 'classic', theme: 'bluewhite', previewBackground: 'dark' });
  assert.deepEqual(createAppearancePreferences({ getStorage: () => saved }).get(), preferences.get());
  const { appearance, changes, find } = fixture();
  appearance.open();
  const choice = find(node => node.dataset.appearanceTheme === 'bluewhite')[0];
  assert.ok(choice, 'appearance offers the reference blue-white palette');
  click(choice);
  assert.equal(choice.attributes['aria-pressed'], 'true');
  assert.deepEqual(changes, [{ layout: 'modern', theme: 'bluewhite', previewBackground: 'checker' }]);
  appearance.dispose();
});
