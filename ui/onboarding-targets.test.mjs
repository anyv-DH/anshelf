/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOnboardingTarget, fitOnboardingPopover, mountOnboardingPosition } from './onboarding-targets.mjs';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
function element(bounds, hidden = false) { return { style: {}, dataset: {}, hidden, getBoundingClientRect: () => bounds, getClientRects: () => hidden ? [] : [bounds] }; }
function documentFixture() {
  const nodes = new Map(), cards = [], listeners = new Map(), frames = new Map(), observers = []; let nextId = 0;
  const window = { innerWidth: 1000, innerHeight: 700,
    addEventListener(name, callback, capture) { listeners.set(name, { callback, capture }); }, removeEventListener: name => listeners.delete(name),
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: node => ({ visibility: node.visibility || 'visible', display: node.hidden ? 'none' : 'block' }),
    ResizeObserver: class { constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); } observe(node) { this.targets.push(node); } disconnect() { this.targets = []; } },
  };
  const document = { defaultView: window, documentElement: { dataset: { layout: 'modern' } },
    querySelector: selector => nodes.get(selector) || (selector === '#asset-grid .asset-card:first-child' ? cards[0] : null) || null,
    querySelectorAll: selector => selector === '#asset-grid .asset-card' ? cards.length ? cards : [nodes.get('#asset-grid .asset-card:first-child')].filter(Boolean) : [],
  };
  nodes.set('#search', element(rect(200, 80, 500, 40))); nodes.set('.main', element(rect(0, 70, 1000, 630)));
  return { document, window, nodes, cards, listeners, frames, observers, tick() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); } };
}

test('each guide step targets real controls and empty libraries use the existing empty state', () => {
  const f = documentFixture();
  const selectors = ['#navigation', '.import-entries', '#subcategories', '#asset-grid .asset-card:first-child', '#workspace-tools .workspace-tools-panel', '#browse'];
  for (const selector of selectors) f.nodes.set(selector, element(rect(100, 100, 350, 70)));
  selectors.forEach((selector, index) => { const resolved = resolveOnboardingTarget(f.document, index); assert.equal(resolved.selector, selector); assert.equal(resolved.element, f.nodes.get(selector)); });
  f.nodes.delete(selectors[3]); const empty = element(rect(200, 210, 500, 250)); f.nodes.set('#empty-state', empty);
  assert.equal(resolveOnboardingTarget(f.document, 3).element, empty); assert.equal(resolveOnboardingTarget(f.document, 3).selector, '#empty-state');
});

test('empty-library preview guidance prefers its compact action, then heading, before the full empty region', () => {
  const f = documentFixture(), empty = element(rect(200, 210, 500, 420));
  const action = element(rect(350, 490, 180, 36)), heading = element(rect(250, 380, 400, 32));
  f.nodes.set('#empty-state', empty); f.nodes.set('#empty-state .button', action); f.nodes.set('#empty-state h2', heading);
  assert.equal(resolveOnboardingTarget(f.document, 3).element, action);
  assert.equal(resolveOnboardingTarget(f.document, 3).selector, '#empty-state .button');
  f.nodes.set('#empty-state .button', element(rect(350, 750, 180, 36)));
  assert.equal(resolveOnboardingTarget(f.document, 3).element, heading);
  assert.equal(resolveOnboardingTarget(f.document, 3).selector, '#empty-state h2');
  f.nodes.delete('#empty-state h2');
  assert.equal(resolveOnboardingTarget(f.document, 3).element, empty);
  f.nodes.set('#asset-grid .asset-card:first-child', element(rect(200, 210, 160, 190)));
  assert.equal(resolveOnboardingTarget(f.document, 3).selector, '#asset-grid .asset-card:first-child');
});

test('classic categorization uses visible sidebar controls without depending on modern subcategory rows', () => {
  const f = documentFixture(); f.document.documentElement.dataset.layout = 'classic';
  f.nodes.set('#category-panel', element(rect(10, 150, 190, 450))); f.nodes.set('#subcategories', element(rect(220, 150, 700, 30)));
  assert.equal(resolveOnboardingTarget(f.document, 2).selector, '#category-panel');
  f.nodes.set('#category-panel', element(rect(0, 0, 0, 0))); f.nodes.set('#categories', element(rect(10, 200, 180, 350)));
  assert.equal(resolveOnboardingTarget(f.document, 2).selector, '#categories');
});

test('classification guidance falls back to the real root navigation before unrelated search', () => {
  for (const layout of ['modern', 'classic']) {
    const f = documentFixture(); f.document.documentElement.dataset.layout = layout;
    const navigation = element(rect(10, 80, 600, 35)); f.nodes.set('#navigation', navigation);
    f.nodes.set('#subcategories', element(rect(0, 0, 0, 0)));
    assert.equal(resolveOnboardingTarget(f.document, 2).element, navigation);
    assert.equal(resolveOnboardingTarget(f.document, 2).selector, '#navigation');
  }
});

test('preview guidance uses a visible later card when the first rows are scrolled away', () => {
  const f = documentFixture(), main = f.nodes.get('.main'); main.scrollTop = 425;
  const visible = element(rect(200, 230, 170, 210));
  f.cards.push(element(rect(200, -400, 170, 210)), element(rect(200, -170, 170, 210)), visible);
  for (const card of f.cards) card.scrollIntoView = () => assert.fail('guidance must preserve library scrolling');
  let scans = 0; const queryAll = f.document.querySelectorAll;
  f.document.querySelectorAll = selector => { scans++; return queryAll(selector); };
  const target = resolveOnboardingTarget(f.document, 3);
  assert.equal(target.element, visible); assert.equal(target.selector, '#asset-grid .asset-card:nth-child(3)');
  assert.deepEqual(target.rect, rect(200, 230, 170, 210)); assert.equal(main.scrollTop, 425); assert.equal(scans, 1);
});

test('preview guidance avoids cards hidden by the sticky toolbar or outside the main region', () => {
  const f = documentFixture(), visible = element(rect(220, 235, 170, 210));
  f.nodes.set('.main', element(rect(200, 70, 750, 560)));
  f.nodes.set('.library-toolbar', element(rect(200, 70, 750, 140)));
  f.cards.push(element(rect(220, 35, 170, 170)), element(rect(5, 240, 170, 210)), element(rect(220, 190, 170, 210)), visible);
  const target = resolveOnboardingTarget(f.document, 3);
  assert.equal(target.element, visible); assert.equal(target.selector, '#asset-grid .asset-card:nth-child(4)');
  assert.deepEqual(target.rect, rect(220, 235, 170, 210));
});

test('when all cards are partial the preview highlight covers only the clearest visible portion', () => {
  const f = documentFixture();
  f.nodes.set('.main', element(rect(200, 70, 750, 360)));
  f.nodes.set('.library-toolbar', element(rect(200, 70, 750, 140)));
  const mostVisible = element(rect(170, 170, 200, 230));
  f.cards.push(mostVisible, element(rect(220, 410, 170, 210)));
  const target = resolveOnboardingTarget(f.document, 3);
  assert.equal(target.element, mostVisible); assert.equal(target.selector, '#asset-grid .asset-card:first-child');
  assert.deepEqual(target.rect, rect(200, 210, 170, 190));
});

test('targets clip to the viewport and hidden, zero-sized and offscreen nodes fall back visibly', () => {
  const f = documentFixture(); f.nodes.set('#navigation', element(rect(-30, 20, 400, 60)));
  assert.deepEqual(resolveOnboardingTarget(f.document, 0).rect, rect(0, 20, 370, 60));
  for (const target of [element(rect(10, 10, 0, 0)), element(rect(1200, 10, 300, 100)), element(rect(100, 100, 300, 80), true), Object.assign(element(rect(100, 100, 300, 80)), { visibility: 'hidden' })]) {
    f.nodes.set('#navigation', target); assert.equal(resolveOnboardingTarget(f.document, 0).selector, '#search');
  }
  f.nodes.delete('#search'); assert.equal(resolveOnboardingTarget(f.document, 0).selector, '.main');
  f.nodes.delete('.main'); assert.equal(resolveOnboardingTarget(f.document, 0), null);
});

test('popover prefers below, then above, then a side that can fit', () => {
  const viewport = { width: 1000, height: 700 }, tooltip = { width: 320, height: 220 };
  const below = fitOnboardingPopover(rect(100, 70, 400, 80), viewport, tooltip); assert.equal(below.placement, 'bottom'); assert.ok(below.top >= 162);
  const above = fitOnboardingPopover(rect(100, 580, 400, 80), viewport, tooltip); assert.equal(above.placement, 'top'); assert.ok(above.top + tooltip.height <= 568);
  assert.equal(fitOnboardingPopover(rect(20, 210, 200, 300), viewport, tooltip).placement, 'right');
  assert.equal(fitOnboardingPopover(rect(780, 210, 200, 300), viewport, tooltip).placement, 'left');
});

test('popover stays within twelve-pixel viewport margins for edges and constrained windows', () => {
  for (const viewport of [{ width: 850, height: 600 }, { width: 400, height: 300 }]) {
    const tooltip = { width: Math.min(360, viewport.width - 24), height: Math.min(440, viewport.height - 32) };
    for (const target of [rect(-50, -50, 200, 120), rect(viewport.width - 100, viewport.height - 40, 300, 90), rect(0, 0, viewport.width, viewport.height), rect(200, 200, 0, 0)]) {
      const result = fitOnboardingPopover(target, viewport, tooltip);
      assert.ok(Number.isFinite(result.left) && Number.isFinite(result.top)); assert.ok(result.left >= 12); assert.ok(result.top >= 12);
      assert.ok(result.left + tooltip.width <= viewport.width - 12 + 0.001); assert.ok(result.top + tooltip.height <= viewport.height - 12 + 0.001);
    }
  }
});

test('position binding only listens while open, coalesces observations and does not scroll controls', () => {
  const f = documentFixture(), navigation = element(rect(30, 60, 500, 40)), highlight = element(rect(0, 0, 0, 0)), card = element(rect(0, 0, 320, 220)); let scrolled = 0;
  navigation.scrollIntoView = () => { scrolled++; }; f.nodes.set('#navigation', navigation);
  const closeListeners = new Map(), dialog = { open: false, addEventListener: (name, cb) => closeListeners.set(name, cb), removeEventListener: name => closeListeners.delete(name) };
  const position = mountOnboardingPosition({ document: f.document, dialog, highlight, card, getIndex: () => 0 });
  position.update(); assert.equal(f.listeners.size, 0); assert.equal(highlight.hidden, true);
  dialog.open = true; position.update(); assert.equal(f.listeners.size, 2); assert.equal(f.listeners.get('scroll').capture, true);
  assert.equal(highlight.dataset.targetSelector, '#navigation'); assert.equal(highlight.style.left, '30px'); assert.equal(highlight.style.width, '500px'); assert.equal(card.style.top, '112px');
  f.listeners.get('resize').callback(); f.listeners.get('scroll').callback(); f.observers[0].callback(); assert.equal(f.frames.size, 1); f.tick(); assert.equal(scrolled, 0);
  dialog.open = false; closeListeners.get('close')(); assert.equal(f.listeners.size, 0); assert.equal(f.frames.size, 0); assert.equal(f.observers[0].targets.length, 0);
  dialog.open = true; position.update(); f.listeners.get('resize').callback(); position.dispose(); position.dispose(); assert.equal(f.listeners.size, 0); assert.equal(f.frames.size, 0); assert.equal(closeListeners.size, 0);
  position.update(); assert.equal(f.listeners.size, 0);
});
