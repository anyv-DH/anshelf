/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */

const STORAGE_KEY = 'anshelf-preview-details-expanded';

export function createPreviewDetailsPreferences({ getStorage = () => globalThis.localStorage } = {}) {
  let expanded = false;
  try { expanded = getStorage()?.getItem(STORAGE_KEY) === 'true'; } catch { /* retain the session default */ }
  return {
    get: () => ({ expanded }),
    setExpanded(value) {
      expanded = Boolean(value);
      try { getStorage()?.setItem(STORAGE_KEY, String(expanded)); } catch { /* retain the session choice */ }
      return { expanded };
    },
  };
}

/** Owns disclosure preferences and the title draft for one mounted asset. */
export function mountPreviewDetails({ dialog, preferences, assetId, initialName = '', isImage = false, onRename = async () => {}, onError = () => {} } = {}) {
  const noop = { apply() {}, update() {}, isEditing: () => false, dispose() {} };
  if (!dialog || !preferences) return noop;
  const panel = dialog.querySelector('[data-preview-details]') || dialog.querySelector('.preview-details');
  const title = dialog.querySelector('[data-preview-title]') || dialog.querySelector('#dialog-title');
  if (!panel || !title) return noop;
  const document = dialog.ownerDocument;
  let disposed = false, editing = false, commitToken = 0, activeInput = null;
  let currentName = String(initialName || title.textContent || '素材预览');
  panel.dataset.previewDetails = ''; panel.id = panel.id || 'preview-details';
  title.dataset.previewTitle = ''; title.setAttribute('role', 'button'); title.setAttribute('tabindex', '0'); title.setAttribute('title', '点击修改素材名称');

  let toggle = dialog.querySelector('[data-preview-details-toggle]');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'button secondary preview-details-toggle';
    toggle.dataset.previewDetailsToggle = '';
    const heading = dialog.querySelector('.dialog-heading');
    if (heading) {
      let actions = heading.querySelector('.preview-heading-actions');
      if (!actions) { actions = document.createElement('div'); actions.className = 'preview-heading-actions'; heading.append(actions); }
      const close = heading.querySelector('[data-action=close-dialog]');
      actions.append(toggle); if (close) actions.append(close);
    } else { panel.parentElement.prepend(toggle); }
  }
  toggle.setAttribute('aria-controls', panel.id);
  if (isImage) Array.from(dialog.querySelectorAll('[data-action]'))
    .filter(node => ['open-animate', 'replace-preview', 'retry', 'restore-preview'].includes(node.dataset.action))
    .forEach(node => node.remove());

  function apply() {
    if (disposed) return;
    const expanded = Boolean(preferences.get().expanded);
    panel.hidden = !expanded; panel.dataset.expanded = String(expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? '收起详情' : '展开详情';
    const workspace = panel.closest('.preview-workspace');
    if (workspace) workspace.dataset.detailsExpanded = String(expanded);
  }
  function renderName(name, message = '') {
    currentName = name; activeInput = null; editing = false; title.dataset.editing = 'false';
    const text = document.createElement('span'); text.dataset.previewTitleText = ''; text.textContent = name;
    const error = document.createElement('span'); error.dataset.previewNameError = ''; error.className = 'preview-name-error'; error.setAttribute('role', 'alert'); error.hidden = !message; error.textContent = message;
    title.replaceChildren(text, error); title.setAttribute('aria-label', '素材名称：' + name + '，点击修改');
  }
  function cancelEdit({ focus = false } = {}) {
    if (disposed || !editing || activeInput?.dataset.committing === 'true') return;
    ++commitToken; renderName(currentName); if (focus) title.focus();
  }
  async function commitEdit(input, focusAfter = false) {
    if (disposed || input !== activeInput || input.dataset.committing === 'true') return;
    const value = String(input.value || '').trim(), original = currentName;
    if (!value || value === original) { cancelEdit({ focus: focusAfter }); return; }
    input.dataset.committing = 'true'; input.readOnly = true; input.setAttribute('aria-busy', 'true');
    const token = ++commitToken;
    try {
      await onRename(value, assetId);
      if (disposed || token !== commitToken || input !== activeInput || !dialog.contains(title)) return;
      const restoreFocus = focusAfter && document.activeElement === input;
      renderName(value); if (restoreFocus) title.focus();
    } catch (error) {
      if (disposed || token !== commitToken || input !== activeInput || !dialog.contains(title)) return;
      const restoreFocus = focusAfter && document.activeElement === input;
      renderName(original, error?.message || '名称保存失败，请重试'); if (restoreFocus) title.focus();
      onError(error);
    }
  }
  function startEdit() {
    if (disposed || editing) return;
    const input = document.createElement('input');
    input.type = 'text'; input.value = currentName; input.className = 'preview-title-input'; input.dataset.previewTitleInput = '';
    input.maxLength = 180; input.setAttribute('aria-label', '素材名称'); input.setAttribute('autocomplete', 'off');
    activeInput = input; editing = true; title.dataset.editing = 'true'; title.replaceChildren(input);
    input.addEventListener('keydown', event => {
      if (event.isComposing || event.key !== 'Escape' && event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') cancelEdit({ focus: true });
      else void commitEdit(input, true);
    });
    input.addEventListener('blur', () => { void commitEdit(input); });
    input.focus(); input.select();
  }
  const onToggle = event => { event.preventDefault(); if (disposed) return; preferences.setExpanded(!preferences.get().expanded); apply(); };
  const onTitleClick = event => { if (event.target.closest('[data-preview-title-input]')) return; startEdit(); };
  const onTitleKey = event => {
    if (event.target.closest('[data-preview-title-input]') || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); startEdit();
  };
  toggle.addEventListener('click', onToggle); title.addEventListener('click', onTitleClick); title.addEventListener('keydown', onTitleKey);
  renderName(currentName); apply();
  return {
    apply,
    isEditing: () => editing,
    update(asset) { if (!disposed && !editing && asset?.id === assetId) renderName(String(asset.name || asset.originalName || '素材预览')); },
    dispose() { disposed = true; ++commitToken; toggle.removeEventListener('click', onToggle); title.removeEventListener('click', onTitleClick); title.removeEventListener('keydown', onTitleKey); },
  };
}

export { STORAGE_KEY as PREVIEW_DETAILS_STORAGE_KEY };

