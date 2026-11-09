/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { icon } from './icons.js';

const categorySelectors = '#import-category, #category-parent, select[data-field="category"]';
const triggerSelector = '[data-select-trigger]';
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
let sequence = 0;

/** Native options remain the source of truth for category scope and selection. */
export function categoryPickerItems(options, query = '') {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return Array.from(options).filter(option => !option.disabled).map(option => {
    const label = String(option.label ?? option.textContent ?? '');
    const parts = label.split(' / ');
    return { value: String(option.value), label, name: parts.at(-1), parentLabel: parts.slice(0, -1).join(' / '), depth: parts.length - 1, parts };
  }).filter(item => words.every(word => item.label.toLocaleLowerCase().includes(word)))
    .sort((first, second) => {
      if (!first.value || !second.value) return Number(!!first.value) - Number(!!second.value);
      for (let index = 0; index < Math.min(first.parts.length, second.parts.length); index++) {
        const order = collator.compare(first.parts[index], second.parts[index]);
        if (order) return order;
      }
      return first.parts.length - second.parts.length;
    });
}

export function selectPickerItems(options) {
  return Array.from(options).filter(option => !option.disabled).map(option => {
    const label = String(option.label ?? option.textContent ?? '');
    return { value: String(option.value), label, name: label, parentLabel: '', depth: 0 };
  });
}

function synchronize(select) {
  const wrapper = select.closest('[data-category-picker]');
  const trigger = wrapper?.querySelector(triggerSelector);
  if (!trigger) return;
  const label = select.selectedOptions[0]?.label || '选择分类';
  trigger.querySelector('[data-category-value]').textContent = label;
  trigger.title = label;
  trigger.disabled = select.disabled;
}

export function enhanceCategorySelects(root) {
  const document = root.ownerDocument || root;
  root.querySelectorAll('select').forEach(select => {
    if (!select.closest('[data-category-picker]')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'category-picker';
      wrapper.dataset.categoryPicker = '';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'category-picker-trigger';
      const category = select.matches(categorySelectors);
      trigger.dataset.selectTrigger = select.id || 'asset-category';
      if (category) trigger.dataset.categoryTrigger = trigger.dataset.selectTrigger;
      trigger.setAttribute('aria-label', select.id === 'import-category' ? '导入到文件夹' : select.id === 'category-parent' ? '上级分类' : select.id === 'preview-resolution' ? '预览最长边' : select.id === 'category-scope' ? '所属素材类型' : category ? '移动到分类' : '选择选项');
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.innerHTML = `${icon(category ? 'folder' : select.id === 'preview-resolution' ? 'grid' : 'layers', 16)}<span data-category-value></span><span class="category-picker-chevron">${icon('down', 15)}</span>`;
      select.before(wrapper);
      wrapper.append(select, trigger);
      select.hidden = true;
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');
    }
    synchronize(select);
  });
}

/** One delegated controller; no timers, observers or per-option listeners. */
export function mountCategorySelects({ document }) {
  let current = null;
  const window = document.defaultView;

  function close(restoreFocus = false) {
    if (!current) return;
    const { popup, trigger } = current;
    current = null;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    popup.remove();
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function highlight(index, scroll = true) {
    if (!current) return;
    const buttons = Array.from(current.list.querySelectorAll('[data-category-option]'));
    current.active = buttons.length ? (index + buttons.length) % buttons.length : -1;
    buttons.forEach((button, position) => button.classList.toggle('is-active', position === current.active));
    const active = buttons[current.active], control = current.search || current.list;
    if (active) {
      control.setAttribute('aria-activedescendant', active.id);
      if (scroll) active.scrollIntoView({ block: 'nearest' });
    } else control.removeAttribute('aria-activedescendant');
  }

  function renderOptions() {
    const { select, search, list, count, category } = current;
    const items = category ? categoryPickerItems(select.options, search.value) : selectPickerItems(select.options);
    list.replaceChildren();
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button'; button.tabIndex = -1;
      button.className = 'category-picker-option';
      button.dataset.categoryOption = item.value;
      button.id = `${list.id}-option-${list.children.length}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(select.value === item.value));
      button.style.setProperty('--category-depth', String(Math.min(item.depth, 5)));
      button.innerHTML = `${category ? icon(item.value ? 'folder' : 'grid', 15) : ''}<span class="category-picker-option-copy"><strong></strong><small></small></span><span class="category-picker-check">${icon('check', 15)}</span>`;
      button.querySelector('strong').textContent = item.name;
      const parent = button.querySelector('small');
      parent.textContent = item.parentLabel;
      parent.hidden = !item.parentLabel;
      button.title = item.label;
      list.append(button);
    }
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'category-picker-empty';
      empty.textContent = '没有找到分类，试试上级文件夹名称';
      list.append(empty);
    }
    count.textContent = category ? `${items.filter(item => item.value).length} 个分类` : `${items.length} 项可选`;
    highlight(Math.max(0, items.findIndex(item => item.value === select.value)), false);
  }

  function open(trigger) {
    if (trigger.disabled) return;
    if (current?.trigger === trigger) { close(); return; }
    close();
    const select = trigger.closest('[data-category-picker]').querySelector('select');
    const category = select.matches(categorySelectors);
    const popup = document.createElement('div');
    popup.className = `category-picker-popup${category ? '' : ' select-picker-compact'}`; popup.dataset.categoryPopup = '';
    popup.setAttribute('popover', 'manual');
    const listId = `category-picker-list-${++sequence}`;
    popup.innerHTML = `${category ? `<div class="category-picker-search">${icon('search', 16)}<input data-category-search type="search" placeholder="搜索分类或完整路径…" autocomplete="off" spellcheck="false" role="combobox" aria-label="搜索分类或完整路径" aria-expanded="true" aria-controls="${listId}"></div>` : ''}<div class="category-picker-results" role="listbox" id="${listId}" aria-label="${category ? '分类' : trigger.getAttribute('aria-label')}"></div><div class="category-picker-footer"><span data-category-count></span><span>↑↓ 选择 · Enter 确认 · Esc 取消</span></div>`;
    (select.closest('dialog') || document.body).append(popup);
    const search = popup.querySelector('[data-category-search]');
    current = { popup, trigger, select, search, category, list: popup.querySelector('[role="listbox"]'), count: popup.querySelector('[data-category-count]'), active: -1 };
    if (!category) current.list.tabIndex = 0;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', listId);
    popup.showPopover?.();
    const bounds = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(bounds.width, category ? 300 : 260), window.innerWidth - 24);
    const below = window.innerHeight - bounds.bottom - 12;
    const above = bounds.top - 12;
    const upwards = below < 230 && above > below;
    const maxHeight = Math.min(390, Math.max(150, upwards ? above : below));
    popup.style.width = `${width}px`;
    popup.style.maxHeight = `${maxHeight}px`;
    popup.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
    popup.style.top = upwards ? 'auto' : `${bounds.bottom + 5}px`;
    popup.style.bottom = upwards ? `${window.innerHeight - bounds.top + 5}px` : 'auto';
    renderOptions();
    (search || current.list).focus({ preventScroll: true });
    highlight(current.active);
  }

  function choose(value) {
    if (!current) return;
    const { select } = current;
    const changed = select.value !== value;
    select.value = value;
    synchronize(select);
    close(true);
    if (changed) select.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  function click(event) {
    const trigger = event.target.closest?.(triggerSelector);
    if (trigger) { event.preventDefault(); event.stopPropagation(); open(trigger); return; }
    if (!current) return;
    if (current.popup.contains(event.target)) {
      const option = event.target.closest('[data-category-option]');
      if (option) { event.preventDefault(); event.stopPropagation(); choose(option.dataset.categoryOption); }
      return;
    }
    close();
  }
  function keydown(event) {
    if (!current) {
      const trigger = event.target.closest?.(triggerSelector);
      if (trigger && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); open(trigger);
      }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); return; }
    if (!current.popup.contains(event.target) && event.target !== current.trigger) return;
    if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Enter') {
        const option = current.list.querySelector('.is-active');
        if (option) choose(option.dataset.categoryOption);
      } else highlight(current.active + (event.key === 'ArrowDown' ? 1 : -1));
    // Restore the control before the browser applies Tab's default navigation.
    // Removing a focused popup first otherwise leaves the start point at body.
    } else if (event.key === 'Tab') close(true);
  }
  function input(event) { if (current && event.target === current.search) renderOptions(); }
  function change(event) { if (event.target.matches?.('select')) synchronize(event.target); }
  function scroll(event) { if (current && !current.popup.contains(event.target)) close(); }
  function dialogClose(event) { if (current && event.target.contains(current.select)) close(); }
  const resize = () => close();
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('input', input);
  document.addEventListener('change', change);
  document.addEventListener('scroll', scroll, true);
  document.addEventListener('close', dialogClose, true);
  window.addEventListener('resize', resize);
  return {
    enhance: enhanceCategorySelects,
    close,
    isOpenWithin: root => !!(current && root.contains(current.select)),
    dispose() {
      close();
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('input', input);
      document.removeEventListener('change', change);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('close', dialogClose, true);
      window.removeEventListener('resize', resize);
    },
  };
}
