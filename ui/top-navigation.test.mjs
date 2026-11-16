/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountTopNavigation } from './top-navigation.mjs';

class Element {
  constructor(tag, document, options = {}) {
    Object.assign(this, { tagName: tag.toUpperCase(), ownerDocument: document, children: [], attributes: {}, dataset: {} }, options);
    const classes = new Set();
    this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
  }
  append(...children) { for (const child of children) { if (child.parentNode) child.remove(); child.parentNode = this; this.children.push(child); } }
  remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  focus() { this.ownerDocument.activeElement = this; }
  matches(selector) {
    return selector.split(',').some(value => {
      const part = value.trim();
      if (part.includes(':disabled') && this.disabled) return false;
      if (part.includes('[hidden]') && this.hidden) return false;
      if (part.includes('[type="hidden"]') && this.type === 'hidden') return false;
      const base = part.replace(/:not\([^)]*\)/g, '');
      if (base.startsWith('#')) return this.id === base.slice(1);
      if (base.startsWith('.')) return this.classList.contains(base.slice(1));
      const attribute = base.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
      if (attribute) {
        const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return Object.hasOwn(this.dataset, key) && (attribute[2] === undefined || this.dataset[key] === attribute[2]);
      }
      return this.tagName.toLowerCase() === base;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelector(selector) { for (const child of this.children) { if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found; } return null; }
}
function fixture({ more = true } = {}) {
  const listeners = [];
  const document = {
    addEventListener(type, callback, capture = false) { listeners.push({ type, callback, capture: capture === true }); },
    removeEventListener(type, callback, capture = false) { const index = listeners.findIndex(item => item.type === type && item.callback === callback && item.capture === (capture === true)); if (index >= 0) listeners.splice(index, 1); },
    querySelector(selector) { return this.body.matches(selector) ? this.body : this.body.querySelector(selector); },
    fire(type, target, key) {
      const event = { type, target, key, defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
      for (const capture of [true, false]) {
        for (const listener of listeners.filter(item => item.type === type && item.capture === capture)) listener.callback(event);
        if (event.propagationStopped) break;
      }
      return event;
    },
  };
  const node = (tag, options) => new Element(tag, document, options);
  const body = document.body = node('body');
  const sidebar = node('aside'); sidebar.classList.add('sidebar');
  const categoryTrigger = node('button', { dataset: { topCategories: '' } }), triggerIcon = node('span'); categoryTrigger.append(triggerIcon);
  const categoryPanel = node('div', { id: 'category-panel' });
  const create = node('button'), search = node('input'), category = node('button', { dataset: { action: 'category', id: 'one' } }); categoryPanel.append(create, search, category);
  const moreTrigger = node('button', { dataset: { topMore: '' } }), morePanel = node('div', { id: 'top-more-panel' }), skin = node('button', { dataset: { action: 'skin-settings' } }); morePanel.append(skin);
  const navigation = node('button', { dataset: { action: 'category', id: 'all' } }), outside = node('input');
  const actions = node('div', { id: 'navigation-actions' }), topbar = node('header'); topbar.classList.add('topbar');
  const imports = node('div'); imports.classList.add('import-entries'); const tools = node('div'); tools.classList.add('window-actions');
  topbar.append(imports, tools);
  sidebar.append(navigation, categoryTrigger, categoryPanel, moreTrigger, morePanel, actions); body.append(sidebar, topbar, outside); outside.focus();
  if (!more) moreTrigger.remove();
  let layout = 'modern';
  const control = mountTopNavigation({ document, getLayout: () => layout });
  return { document, sidebar, categoryTrigger, triggerIcon, categoryPanel, search, category, moreTrigger, morePanel, skin, navigation, outside, actions, topbar, imports, tools, control, listeners, setLayout: value => { layout = value; } };
}

test('workspace omits the redundant more button and exposes skin settings in tools', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<button\b[^>]*data-top-more/);
  assert.match(html, /id="workspace-tools"[\s\S]*?data-action="skin-settings"/);
});

test('removed more trigger does not close category search or swallow outside clicks', () => {
  const { document, sidebar, categoryTrigger, search, outside } = fixture({ more: false });
  document.fire('click', categoryTrigger);
  document.fire('click', search);
  assert.equal(sidebar.classList.contains('categories-open'), true);
  const event = document.fire('click', outside);
  assert.equal(sidebar.classList.contains('categories-open'), false);
  assert.equal(event.defaultPrevented, false);
});

test('modern navigation holds the existing import and tools controls; classic switching restores their toolbar', () => {
  const { actions, topbar, imports, tools, control, setLayout } = fixture();
  assert.deepEqual(actions.children, [imports, tools]);
  assert.equal(topbar.children.length, 0);
  setLayout('classic'); control.close();
  assert.deepEqual(topbar.children, [imports, tools]);
  assert.equal(actions.children.length, 0);
  control.close('modern');
  assert.deepEqual(actions.children, [imports, tools]);
  control.close('modern');
  assert.deepEqual(actions.children, [imports, tools], 'repeated updates retain a single instance and order');
});

test('modern top navigation exposes related panels, focuses category search and keeps panels mutually exclusive', () => {
  const { document, sidebar, categoryTrigger, triggerIcon, search, moreTrigger, skin } = fixture();
  assert.equal(categoryTrigger.attributes['aria-controls'], 'category-panel');
  assert.equal(moreTrigger.attributes['aria-controls'], 'top-more-panel');
  assert.equal(categoryTrigger.attributes['aria-expanded'], 'false');
  const click = document.fire('click', triggerIcon);
  assert.equal(click.defaultPrevented, false); assert.equal(click.propagationStopped, false);
  assert.equal(sidebar.classList.contains('categories-open'), true); assert.equal(document.activeElement, search);
  assert.equal(categoryTrigger.attributes['aria-expanded'], 'true');
  document.fire('click', moreTrigger);
  assert.equal(sidebar.classList.contains('categories-open'), false); assert.equal(sidebar.classList.contains('more-open'), true);
  assert.equal(categoryTrigger.attributes['aria-expanded'], 'false'); assert.equal(moreTrigger.attributes['aria-expanded'], 'true');
  assert.equal(document.activeElement, skin);
  document.fire('click', moreTrigger);
  assert.equal(sidebar.classList.contains('more-open'), false); assert.equal(moreTrigger.attributes['aria-expanded'], 'false');
});

test('inside clicks leave a panel open and outside clicks close it without moving focus', () => {
  const { document, sidebar, categoryTrigger, search, outside } = fixture();
  document.fire('click', categoryTrigger); document.fire('click', search);
  assert.equal(sidebar.classList.contains('categories-open'), true);
  outside.focus(); document.fire('click', outside);
  assert.equal(sidebar.classList.contains('categories-open'), false); assert.equal(document.activeElement, outside);
});

test('Escape closes a modern panel before the global keyboard shortcut can clear selection and restores trigger focus', () => {
  const { document, sidebar, categoryTrigger, search } = fixture();
  let cleared = 0; document.addEventListener('keydown', () => { cleared++; });
  document.fire('click', categoryTrigger);
  const event = document.fire('keydown', search, 'Escape');
  assert.equal(event.defaultPrevented, true); assert.equal(cleared, 0);
  assert.equal(sidebar.classList.contains('categories-open'), false); assert.equal(document.activeElement, categoryTrigger);
  document.fire('keydown', categoryTrigger, 'Escape'); assert.equal(cleared, 1, 'a closed navigation must not swallow the application Escape shortcut');
});

test('choosing a category closes the panel and keeps focus valid when the application replaces category buttons', () => {
  const { document, sidebar, categoryTrigger, category } = fixture();
  document.addEventListener('click', event => { if (event.target === category) category.remove(); });
  document.fire('click', categoryTrigger); category.focus();
  const event = document.fire('click', category);
  assert.equal(event.defaultPrevented, false); assert.equal(event.propagationStopped, false);
  assert.equal(sidebar.classList.contains('categories-open'), false);
  assert.equal(category.isConnected, false); assert.equal(document.activeElement, categoryTrigger);
});

test('category navigation outside the panel closes it without taking focus from the clicked navigation', () => {
  const { document, sidebar, categoryTrigger, navigation } = fixture();
  document.fire('click', categoryTrigger); navigation.focus(); document.fire('click', navigation);
  assert.equal(sidebar.classList.contains('categories-open'), false); assert.equal(document.activeElement, navigation);
});

test('classic layout leaves navigation and application shortcuts untouched', () => {
  const { document, sidebar, categoryTrigger, outside, setLayout } = fixture();
  setLayout('classic');
  const click = document.fire('click', categoryTrigger), keyboard = document.fire('keydown', outside, 'Escape');
  assert.equal(sidebar.classList.contains('categories-open'), false); assert.equal(document.activeElement, outside);
  assert.equal(click.defaultPrevented, false); assert.equal(keyboard.defaultPrevented, false);
});

test('an open dialog keeps its native Escape behavior even while a top panel is expanded', () => {
  const { document, sidebar, moreTrigger } = fixture();
  document.fire('click', moreTrigger);
  const dialog = new Element('dialog', document, { open: true });
  const closeButton = new Element('button', document); dialog.append(closeButton); document.body.append(dialog); closeButton.focus();
  const event = document.fire('keydown', closeButton, 'Escape');
  assert.equal(event.defaultPrevented, false); assert.equal(event.propagationStopped, false);
  assert.equal(sidebar.classList.contains('more-open'), true); assert.equal(document.activeElement, closeButton);
});

test('closing and disposing reset expansion, remove listeners and cannot reopen a panel', () => {
  const { document, sidebar, categoryTrigger, control, listeners } = fixture();
  document.fire('click', categoryTrigger); control.close();
  assert.equal(sidebar.classList.contains('categories-open'), false); assert.equal(categoryTrigger.attributes['aria-expanded'], 'false');
  document.fire('click', categoryTrigger); control.dispose(); control.dispose();
  assert.equal(sidebar.classList.contains('categories-open'), false); assert.equal(listeners.length, 0);
  document.fire('click', categoryTrigger); assert.equal(sidebar.classList.contains('categories-open'), false);
});
