/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { escapeHtml as e } from './model.js';
import { SYSTEM_LABELS } from './library-navigation.mjs';

const KEY = 'anshelf-root-navigation-v1';
const uniqueIds = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.length > 0 && value.length <= 200))];
const normalize = value => ({ hidden: uniqueIds(value?.hidden), order: uniqueIds(value?.order) });

export function createRootNavigationPreferences(storage) {
  let value = normalize();
  try { storage ??= globalThis.localStorage; value = normalize(JSON.parse(storage?.getItem(KEY) || 'null')); }
  catch { /* Keep this session usable when storage is missing or corrupt. */ }
  return {
    get: () => normalize(value),
    set(next) {
      value = normalize(next);
      try { if (!storage?.setItem) return false; storage.setItem(KEY, JSON.stringify(value)); return true; }
      catch { return false; }
    },
  };
}

export function rootNavigationView(roots, selectedId, preferences) {
  const prefs = normalize(preferences), byId = new Map(roots.map(item => [item.id, item]));
  const orderedIds = [...prefs.order.filter(id => byId.has(id)), ...roots.map(item => item.id).filter(id => !prefs.order.includes(id))];
  const ordered = orderedIds.map(id => byId.get(id)), hidden = new Set(prefs.hidden);
  return { ordered, visible: ordered.filter(item => !hidden.has(item.id) || item.id === selectedId), temporaryId: hidden.has(selectedId) ? selectedId : null };
}

export function updateRootNavigation(roots, preferences, id, operation) {
  const prefs = normalize(preferences);
  if (!roots.some(item => item.id === id)) return prefs;
  if (operation === 'hide') prefs.hidden = uniqueIds([...prefs.hidden, id]);
  else if (operation === 'show') prefs.hidden = prefs.hidden.filter(value => value !== id);
  else if (['up', 'down', 'first'].includes(operation)) {
    const order = rootNavigationView(roots, '', prefs).ordered.map(item => item.id), index = order.indexOf(id);
    const destination = operation === 'first' ? 0 : Math.max(0, Math.min(order.length - 1, index + (operation === 'up' ? -1 : 1)));
    order.splice(index, 1); order.splice(destination, 0, id); prefs.order = order;
  }
  return prefs;
}

export function mountRootNavigation({ document, preferences, getRoots, getSelected, onChange, onSelect, canOpen = () => true, onOpen = () => {} }) {
  const navigation = document.querySelector('#navigation'), trigger = document.querySelector('[data-root-navigation-open]');
  const previous = document.querySelector('[data-root-navigation-scroll="previous"]'), next = document.querySelector('[data-root-navigation-scroll="next"]');
  if (!navigation || !trigger) return { dispose() {} };
  const window = document.defaultView;
  const dialog = document.createElement('dialog');
  dialog.id = 'root-navigation-dialog'; dialog.className = 'root-navigation-dialog';
  dialog.setAttribute('aria-labelledby', 'root-navigation-title');
  dialog.innerHTML = `<div class="dialog-heading"><div><h2 id="root-navigation-title">顶部分类</h2><p>点击名称直接打开分类；勾选常驻，将常用分类移到前面。</p></div><button class="icon-button" data-root-navigation-close aria-label="关闭顶部分类">×</button></div><label class="root-navigation-search">查找顶层分类<input type="search" data-root-navigation-search placeholder="输入分类名称" autocomplete="off"></label><div class="root-navigation-list" data-root-navigation-list></div><p class="root-navigation-status" data-root-navigation-status role="status">取消常驻只收起顶部入口，分类和素材仍保留。</p>`;
  document.body.append(dialog);
  trigger.setAttribute('aria-controls', dialog.id); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
  const list = dialog.querySelector('[data-root-navigation-list]'), search = dialog.querySelector('[data-root-navigation-search]');
  let disposed = false, frame = null, rendered = '';
  const label = item => SYSTEM_LABELS[item.systemKey] || item.name;

  function render() {
    if (!dialog.open || disposed) return;
    const prefs = preferences.get(), roots = rootNavigationView(getRoots(), getSelected(), prefs).ordered;
    const signature = JSON.stringify([search.value, getSelected(), prefs, roots.map(item => [item.id, label(item)])]);
    if (rendered === signature) return;
    rendered = signature;
    const active = document.activeElement, activeRow = active?.closest('[data-root-navigation-row]');
    const focus = activeRow ? { id: activeRow.dataset.rootNavigationRow, operation: active.dataset.rootNavigationOperation, choose: active.hasAttribute('data-root-navigation-choose') } : null;
    const scroll = list.scrollTop, hidden = new Set(prefs.hidden), query = search.value.trim().toLocaleLowerCase();
    list.innerHTML = roots.map((item, index) => ({ item, index })).filter(({ item }) => label(item).toLocaleLowerCase().includes(query)).map(({ item, index }) => `<div class="root-navigation-row" data-root-navigation-row="${e(item.id)}"><button class="root-navigation-name ${getSelected() === item.id ? 'is-current' : ''}" data-root-navigation-choose="${e(item.id)}" title="打开${e(label(item))}" ${getSelected() === item.id ? 'aria-current="page"' : ''}>${e(label(item))}</button><label class="root-navigation-pin"><input type="checkbox" data-root-navigation-operation="toggle" ${hidden.has(item.id) ? '' : 'checked'} aria-label="${e(label(item))}常驻顶部"><span>常驻</span></label><div class="root-navigation-order"><button class="icon-button" data-root-navigation-operation="first" ${index === 0 ? 'disabled' : ''} aria-label="将${e(label(item))}移到最前" title="移到最前">置前</button><button class="icon-button" data-root-navigation-operation="up" ${index === 0 ? 'disabled' : ''} aria-label="将${e(label(item))}前移" title="前移">↑</button><button class="icon-button" data-root-navigation-operation="down" ${index === roots.length - 1 ? 'disabled' : ''} aria-label="将${e(label(item))}后移" title="后移">↓</button></div></div>`).join('') || '<p class="category-empty">没有匹配的顶层分类</p>';
    list.scrollTop = scroll;
    if (focus) {
      const row = Array.from(list.querySelectorAll('[data-root-navigation-row]')).find(item => item.dataset.rootNavigationRow === focus.id);
      const target = focus.choose ? row?.querySelector('[data-root-navigation-choose]') : Array.from(row?.querySelectorAll('[data-root-navigation-operation]') || []).find(item => item.dataset.rootNavigationOperation === focus.operation);
      (target && !target.disabled ? target : row?.querySelector('[data-root-navigation-choose]'))?.focus({ preventScroll: true });
    }
  }
  function close() {
    if (!dialog.open) return;
    dialog.close(); trigger.setAttribute('aria-expanded', 'false');
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function open() {
    if (disposed || dialog.open || !canOpen()) return;
    onOpen(); search.value = ''; dialog.showModal(); trigger.setAttribute('aria-expanded', 'true'); render(); search.focus({ preventScroll: true });
  }
  function click(event) {
    if (event.target.closest?.('[data-root-navigation-open]') === trigger) { open(); return; }
    const scroll = event.target.closest?.('[data-root-navigation-scroll]');
    if (scroll && (scroll === previous || scroll === next)) {
      navigation.scrollBy({ left: Math.max(100, navigation.clientWidth * .7) * (scroll === previous ? -1 : 1), behavior: 'smooth' }); return;
    }
    if (!dialog.open || !dialog.contains(event.target)) return;
    if (event.target.closest('[data-root-navigation-close]')) { close(); return; }
    const choice = event.target.closest('[data-root-navigation-choose]');
    if (choice) {
      const id = choice.dataset.rootNavigationChoose; close(); onSelect(id);
      Array.from(navigation.querySelectorAll('[data-action="category"]')).find(button => button.dataset.id === id)?.focus({ preventScroll: true }); return;
    }
    const control = event.target.closest('[data-root-navigation-operation]');
    if (!control || control.tagName === 'INPUT') return;
    change(control);
  }
  function change(control) {
    const row = control.closest('[data-root-navigation-row]');
    if (!row) return;
    const operation = control.dataset.rootNavigationOperation === 'toggle' ? (control.checked ? 'show' : 'hide') : control.dataset.rootNavigationOperation;
    const saved = preferences.set(updateRootNavigation(getRoots(), preferences.get(), row.dataset.rootNavigationRow, operation));
    onChange(preferences.get()); render();
    dialog.querySelector('[data-root-navigation-status]').textContent = saved ? '已保存。取消常驻只收起顶部入口；当前分类离开后收起。' : '本次设置已生效；本机偏好暂时无法保存，重启后可能恢复。';
  }
  function changed(event) { if (event.target.matches?.('input[data-root-navigation-operation]')) change(event.target); }
  function cancel(event) { event.preventDefault(); close(); }
  function backdrop(event) { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }
  function updateOverflow() {
    frame = null; if (disposed) return;
    const modern = document.documentElement.dataset.layout === 'modern';
    const overflow = modern && navigation.scrollWidth > navigation.clientWidth + 1;
    if (previous) { previous.hidden = !overflow; previous.disabled = navigation.scrollLeft <= 1; }
    if (next) { next.hidden = !overflow; next.disabled = navigation.scrollLeft >= navigation.scrollWidth - navigation.clientWidth - 1; }
  }
  function schedule() { if (frame === null && !disposed) frame = window.requestAnimationFrame(updateOverflow); }
  const resize = new window.ResizeObserver(schedule), mutation = new window.MutationObserver(() => { schedule(); render(); });
  const layout = new window.MutationObserver(schedule);
  resize.observe(navigation); mutation.observe(navigation, { childList: true });
  layout.observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout'] });
  document.addEventListener('click', click); dialog.addEventListener('change', changed); search.addEventListener('input', render);
  dialog.addEventListener('cancel', cancel); dialog.addEventListener('click', backdrop); navigation.addEventListener('scroll', schedule, { passive: true });
  schedule();
  return { dispose() {
    if (disposed) return; disposed = true; resize.disconnect(); mutation.disconnect(); layout.disconnect(); if (frame !== null) window.cancelAnimationFrame(frame);
    document.removeEventListener('click', click); dialog.removeEventListener('change', changed); search.removeEventListener('input', render);
    dialog.removeEventListener('cancel', cancel); dialog.removeEventListener('click', backdrop); navigation.removeEventListener('scroll', schedule); dialog.remove();
  } };
}
