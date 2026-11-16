/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { call } from './api.js';
import { icon } from './icons.js';
import { assetCategoryIds, assetMode, categoryDescendantIds, escapeHtml as e, gridColumns, isLiked, selectAsset } from './model.js';
import { categoryOptions, previewDialog, renderGrid, renderInspector as renderInspectorView, renderSelection, renderSidebar, renderStatus, renderSubcategories } from './render.js';
import { categoryBrowser, favoriteCategoryGroups } from './category-browser.mjs';
import { mountPreviewViewer } from './preview-viewer.mjs';
import { createPreviewDetailsPreferences, mountPreviewDetails } from './preview-details.mjs';
import { createAudioController, formatTime } from './audio-controller.mjs';
import { mountStageDrag } from './stage-drag.mjs';
import { mountSkin } from './skin.mjs';
import { planRemoval } from './removal.mjs';
import { createConfirmation } from './confirmation.mjs';
import { mountPluginControls } from './plugin-controls.mjs';
import { mountUpdateDownloadControls } from './update-download-controls.mjs';
import { createUpdatePromptPreferences, createStartupUpdatePrompt } from './update-prompt.mjs';
import { mountCategorySelects } from './category-select.mjs';
import { createImportPreferences } from './import-preferences.mjs';
import { mountFileDrop } from './import-workspace.mjs';
import { mountUnifiedImport, openSupportAuthor } from './import-dialog-workspace.mjs';
import { openAuthorFeedback, copyAuthorEmail } from './author-feedback.mjs';
import { THEMES, createAppearancePreferences, mountAppearance } from './appearance.mjs';
import { mountTopNavigation } from './top-navigation.mjs';
import { createRootNavigationPreferences, mountRootNavigation } from './root-navigation.mjs';
import { categoryScope, libraryNavigation } from './library-navigation.mjs';
import { renderAssetDetails } from './asset-details.mjs';
import { categoryAccepts, createCategoryCompatibility } from './category-compatibility.mjs';
import { loadBrowsePreferences, saveBrowsePreferences } from './browse-preferences.mjs';
import { duplicateCategoryOptions } from './category-assignment-navigation.mjs';
import { mountSceneGroups } from './scene-groups.mjs';
import { createOnboardingPreferences, mountOnboarding } from './onboarding.mjs';

const state = { snapshot: { assets: [], categories: [], queue: {}, bridge: {} }, category: 'all', favoriteCategory: 'all', typeScope: 'all', query: '', categoryQuery: '', collapsedCategories: new Set(), sort: 'newest', density: 'auto', browsePreferences: loadBrowsePreferences(), browseViewport: {}, browseLayout: null, browseTotal: 0, page: 0, pageView: null, hideChildCategories: false, importMode: 'ordinary', importCategoryId: undefined, selected: new Set(), anchor: null, detail: null, inspectorOpen: false, quickCategories: false, busy: false, visible: [], receivedSnapshot: false };
let toastTimer, disposeViewer, seekingAudio = false, syncVersion, refreshPromise, refreshTimer, refreshStopped = false;
let updateTimer, updatePromise, updateResult = { currentVersion: '0.3.19', status: 'idle' }, checkUpdatesOnStart = true;
let browseResizeFrame = null;
const $ = selector => document.querySelector(selector);
const categorySelects = mountCategorySelects({ document });
const importPreferences = createImportPreferences();
const previewDetailsPreferences = createPreviewDetailsPreferences();
let previewDetailsController = null;
const appearancePreferences = createAppearancePreferences();
const topNavigation = mountTopNavigation({ document, getLayout: () => document.documentElement.dataset.layout });
const rootNavigationPreferences = createRootNavigationPreferences();
state.rootNavigationPreferences = rootNavigationPreferences.get();
const rootNavigationControls = mountRootNavigation({ document, preferences: rootNavigationPreferences,
  getRoots: () => libraryNavigation(state.snapshot.categories, state.category).roots,
  getSelected: () => libraryNavigation(state.snapshot.categories, state.category).root?.id,
  canOpen: () => !state.busy && !document.querySelector('dialog[open]'),
  onOpen: () => topNavigation.close(),
  onChange: preferences => { state.rootNavigationPreferences = preferences; renderSidebar(state); },
  onSelect: selectCategory });
window.addEventListener('beforeunload', () => rootNavigationControls.dispose(), { once: true });
window.addEventListener('beforeunload', () => categorySelects.dispose(), { once: true });
window.addEventListener('beforeunload', disposePreviewDetails, { once: true });
function renderInspector(value) {
  const inspector = $('#inspector');
  if (value.inspectorOpen && inspector.dataset.asset === value.detail && categorySelects.isOpenWithin(inspector)) return;
  const focused = document.activeElement;
  const focusedSelect = value.inspectorOpen && inspector.dataset.asset === value.detail
    && inspector.contains(focused) && focused.matches('[data-select-trigger]') ? focused.dataset.selectTrigger : null;
  if (categorySelects.isOpenWithin(inspector)) categorySelects.close();
  renderInspectorView(value);
  categorySelects.enhance(inspector);
  if (focusedSelect) Array.from(inspector.querySelectorAll('[data-select-trigger]'))
    .find(trigger => trigger.dataset.selectTrigger === focusedSelect)?.focus({ preventScroll: true });
}
const audio = createAudioController({ onChange: updateAudioUI });
const skinControls = mountSkin({ api: window.shelf, document });
const appearanceControls = mountAppearance({ document, preferences: appearancePreferences, onChange: applyAppearance, onSkin: () => skinControls.open() });
const confirmation = createConfirmation({ document });
const onboardingControls = mountOnboarding({ document, preferences: createOnboardingPreferences(),
  canOpen: () => state.receivedSnapshot && !state.busy && !document.querySelector('dialog[open]') && document.visibilityState !== 'hidden',
  onAction: openOnboardingDestination,
  onClose: () => resumeStartupUpdate() });
const updatePromptPreferences = createUpdatePromptPreferences();
const startupUpdatePrompt = createStartupUpdatePrompt({ preferences: updatePromptPreferences,
  isEnabled: () => checkUpdatesOnStart,
  canOpen: () => !state.busy && (!state.receivedSnapshot || !onboardingControls.pending()) && !document.querySelector('dialog[open]') && document.visibilityState !== 'hidden',
  open: () => openUpdateDialog(false) });
const resumeStartupUpdate = () => queueMicrotask(() => { onboardingControls.resume(); startupUpdatePrompt.resume(); });
document.addEventListener('close', resumeStartupUpdate, true);
document.addEventListener('visibilitychange', resumeStartupUpdate);
window.addEventListener('beforeunload', () => {
  onboardingControls.dispose(); startupUpdatePrompt.dispose(); document.removeEventListener('close', resumeStartupUpdate, true);
  document.removeEventListener('visibilitychange', resumeStartupUpdate);
}, { once: true });
const pluginControls = mountPluginControls({ document, api: window.shelf, confirm: options => confirmation.ask(options) });
const downloadControls = mountUpdateDownloadControls({ document, api: window.shelf, confirm: options => confirmation.ask(options), getUpdate: () => updateResult });
const unifiedImport = mountUnifiedImport({ document, api: window.shelf, state, closeDialog, openLegacy: openImportDialog, icon, escapeHtml: e, categorySelects, preferences: importPreferences, importCategoryOptions, defaultImportCategory, run, refresh, busy, toast, onError: errorToast });
const fileDrop = mountFileDrop({ root: document, api: window.shelf, canAccept: () => !state.busy && !onboardingControls.isOpen() && !confirmation.isOpen(), onFiles: selection => unifiedImport.acceptSelection(selection), onError: errorToast, onHover: value => document.body.classList.toggle('is-file-dragging', value) });
const sceneGroups = mountSceneGroups({ document, getSnapshot: () => state.snapshot, getSelected: () => state.selected, run, refresh, closeDialog, toast, confirmation, onError: errorToast, onCreated: () => { state.selected.clear(); renderAll(); } });
const unsubscribeConfirm = window.shelf?.onConfirmRequest?.(async request => {
  let accepted = false;
  try { accepted = await confirmation.ask(request); }
  finally {
    try { await window.shelf.respondConfirm(request.requestId, accepted); } catch { /* closing the window cancels host confirmations */ }
  }
});

async function openOnboardingDestination(name) {
  if (name === 'bridge') return openBridgeDialog();
  if (name !== 'import') return;
  busy(true);
  try { await unifiedImport.open(); }
  catch (error) { errorToast(error); }
  finally { busy(false); }
}

function updateAudioUI() {
  const playback = audio.state(), player = $('#audio-player');
  player.hidden = !playback.id;
  player.dataset.id = playback.id || ''; player.dataset.playing = String(playback.playing); player.dataset.time = String(playback.currentTime);
  const playerVisibilityChanged = document.body.classList.contains('has-audio-player') !== !!playback.id;
  document.body.classList.toggle('has-audio-player', !!playback.id);
  if (playerVisibilityChanged) scheduleBrowseLayout();
  $('#audio-name').textContent = playback.name;
  $('#audio-time').textContent = `${formatTime(playback.currentTime)} / ${formatTime(playback.duration)}`;
  const seek = $('#audio-seek'); seek.max = String(playback.duration || 0); seek.disabled = !playback.duration;
  if (!seekingAudio) seek.value = String(playback.currentTime);
  $('#audio-error').hidden = !playback.error; $('#audio-error').textContent = playback.error;
  const toggle = player.querySelector('[data-action="audio-toggle"]');
  toggle.innerHTML = icon(playback.playing ? 'pause' : 'play', 19); toggle.setAttribute('aria-label', playback.playing ? '暂停试听' : '继续试听');
  document.querySelectorAll('[data-action="play-audio"]').forEach(button => {
    const playing = playback.id === button.dataset.id && playback.playing;
    button.setAttribute('aria-pressed', String(playing));
    if (button.classList.contains('audio-play')) button.innerHTML = `${icon(playing ? 'pause' : 'play', 13)}<span>${playing ? '暂停' : '试听'}</span>`;
    button.closest('.audio-card')?.classList.toggle('is-playing', playing);
  });
}

function toast(message, action, duration = 3600) {
  const box = $('#toast');
  box.hidden = false;
  box.innerHTML = `<span>${e(message)}</span>${action ? `<button class="text-button" data-action="${action.action}">${icon(action.icon || 'undo', 14)}${e(action.label)}</button>` : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, duration);
}
function errorToast(error) { toast(error?.message || '操作未完成，请重试'); }
function clearUndoToast() { if ($('#toast [data-action="undo-assign"]')) $('#toast').hidden = true; }
function busy(value) { state.busy = value; document.body.classList.toggle('is-busy', value); if (!value) resumeStartupUpdate(); }
function browseLabel(preferences = state.browsePreferences) {
  if (preferences.mode === 'scroll') return '滚动浏览';
  return preferences.pageSize === 'auto' ? '固定分页' : '固定 · ' + preferences.pageSize + ' 个';
}
function syncBrowseMenu() {
  const label = $('#browse-label');
  if (label) label.textContent = browseLabel();
  document.querySelectorAll('#browse-menu [data-browse-mode]').forEach(button => button.setAttribute('aria-checked', String(button.dataset.browseMode === state.browsePreferences.mode)));
  document.querySelectorAll('#browse-menu [data-browse-size]').forEach(button => button.setAttribute('aria-checked', String(String(button.dataset.browseSize) === String(state.browsePreferences.pageSize))));
  const input = $('#browse-size-input');
  if (input && state.browsePreferences.pageSize !== 'auto') input.value = String(state.browsePreferences.pageSize);
}
function setBrowsePreferences(change) {
  state.browsePreferences = saveBrowsePreferences({ ...state.browsePreferences, ...change });
  state.page = 0; state.pageView = null; state.selected.clear(); state.anchor = null; state.detail = null;
  syncBrowseMenu();
  $('.main').scrollTop = 0;
  renderAll({ preserveInspector: false });
}
function measureBrowseViewport() {
  const main = $('.main'), toolbar = $('.library-toolbar'), grid = $('#asset-grid');
  if (!main || !toolbar || !grid) return;
  const style = getComputedStyle(grid);
  const player = $('#audio-player');
  const playerClearance = player && !player.hidden ? Math.max(0, main.getBoundingClientRect().bottom - player.getBoundingClientRect().top + 10) : 0;
  main.style.setProperty('--audio-player-clearance', playerClearance + 'px');
  const mainStyle = getComputedStyle(main);
  const inset = (Number.parseFloat(mainStyle.paddingTop) || 0) + Math.max(Number.parseFloat(mainStyle.paddingBottom) || 0, playerClearance);
  const ignored = new Set(['asset-grid', 'asset-pagination', 'empty-state']);
  const occupied = Array.from(main.children).reduce((height, element) => {
    if (ignored.has(element.id) || element.classList.contains('library-footer') || !element.getClientRects().length) return height;
    const measured = getComputedStyle(element);
    return height + element.getBoundingClientRect().height + (Number.parseFloat(measured.marginTop) || 0) + (Number.parseFloat(measured.marginBottom) || 0);
  }, 0);
  state.browseViewport = {
    columns: Number(grid.dataset.columns) || 1,
    availableHeight: Math.max(0, main.clientHeight - occupied - inset - 58),
    cardMinHeight: Number.parseFloat(style.getPropertyValue('--browse-card-min-height')) || 220,
    rowGap: Number.parseFloat(style.rowGap) || 16,
    cardChromeHeight: Number.parseFloat(style.getPropertyValue('--browse-card-chrome')) || 92
  };
}
function scheduleBrowseLayout() {
  if (browseResizeFrame !== null || refreshStopped) return;
  browseResizeFrame = requestAnimationFrame(() => {
    browseResizeFrame = null;
    const previous = JSON.stringify(state.browseViewport);
    updateGridDensity(); measureBrowseViewport();
    if (previous !== JSON.stringify(state.browseViewport)) {
      renderGrid(state); updateAudioUI();
    }
  });
}
function commitCustomBrowseSize() {
  const input = $('#browse-size-input'), size = Number(input.value);
  const valid = input.value.trim() !== '' && Number.isInteger(size) && size > 0 && size <= 1000;
  input.setCustomValidity(valid ? '' : '请输入 1 到 1000 之间的整数');
  if (!input.reportValidity()) return false;
  setBrowsePreferences({ pageSize: size });
  closeMenu('browse'); $('#browse').focus();
  return true;
}
function renderAll({ preserveInspector = false } = {}) {
  const focused = document.activeElement?.closest('#navigation button, #subcategories button, #deepcategories button, #categories button');
  const containerId = focused?.closest('nav')?.id;
  const focusData = focused ? { ...focused.dataset } : null;
  renderStatus(state); renderSidebar(state); renderSubcategories(state); renderSelection(state); updateGridDensity(); measureBrowseViewport(); renderGrid(state);
  renderInspector(state); updateGridDensity();
  updateAudioUI();
  if (focusData && containerId && !focused.isConnected) {
    Array.from(document.getElementById(containerId)?.querySelectorAll('button') || [])
      .find(button => ['action', 'id', 'collection'].every(key => button.dataset[key] === focusData[key]))?.focus({ preventScroll: true });
  }
}
function applySnapshot(snapshot, preserveInspector = true) {
  if (!snapshot) return;
  const firstSnapshot = !state.receivedSnapshot;
  const previewId = $('#dialog').open && $('#dialog-content').dataset.previewAsset;
  const previousPreview = previewId && state.snapshot.assets.find(asset => asset.id === previewId);
  const oldResult = state.snapshot.bridge?.result;
  if (state.receivedSnapshot && snapshot.bridge?.result && JSON.stringify(snapshot.bridge.result) !== JSON.stringify(oldResult)) toast(snapshot.bridge.result.ok ? 'AN 面板已确认插入完成' : `AN 插入失败：${snapshot.bridge.result.error || '请在面板中检查'}`, null, 5000);
  state.receivedSnapshot = true;
  if (firstSnapshot) resumeStartupUpdate();
  const collectionsChanged = ['assets', 'categories', 'sceneGroups'].some(key => JSON.stringify(snapshot[key]) !== JSON.stringify(state.snapshot[key]));
  state.snapshot = { assets: [], categories: [], sceneGroups: [], queue: {}, bridge: {}, ...snapshot };
  audio.reconcile(state.snapshot.assets);
  if (!collectionsChanged) { renderStatus(state); return; }
  const ids = new Set(state.snapshot.assets.map(item => item.id));
  state.selected = new Set([...state.selected].filter(id => ids.has(id)));
  if (state.detail && !ids.has(state.detail)) state.detail = null;
  if (!['all', 'ordinary', 'effects', 'audio', 'favorites', 'liked', 'uncategorized'].includes(state.category) && !state.snapshot.categories.some(item => item.id === state.category)) state.category = 'all';
  if (state.favoriteCategory !== 'all') {
    const scoped = state.typeScope === 'all' ? state.snapshot.assets : state.snapshot.assets.filter(asset => assetMode(asset) === state.typeScope);
    const groups = favoriteCategoryGroups(state.snapshot.categories, scoped);
    if (!groups.some(group => group.id === state.favoriteCategory)) state.favoriteCategory = 'all';
  }
  renderAll({ preserveInspector });
  sceneGroups.sync();
  const currentPreview = previewId && state.snapshot.assets.find(asset => asset.id === previewId);
  if (currentPreview) {
    if (['previewRevision', 'previewUrl', 'animatedPreviewUrl', 'previewPosterUrl', 'previewStatus', 'previewUndoUntil']
      .some(key => previousPreview?.[key] !== currentPreview[key])) refreshPreviewMedia(currentPreview);
    else refreshPreviewDetails(currentPreview);
  } else if (previewId) closeDialog();
}
async function refresh({ preserveInspector = true } = {}) {
  // A user edit awaiting refresh must observe its own committed change even if
  // a background request was already running. Serialize, then request again.
  if (refreshPromise) { await refreshPromise; return refresh({ preserveInspector }); }
  refreshPromise = (async () => {
    try {
      // Lightweight fixture/browser hosts from older versions retain snapshot.
      const legacy = window.shelf && typeof window.shelf.sync !== 'function';
      const result = await call(legacy ? 'snapshot' : 'sync', ...(legacy ? [] : [syncVersion]));
      $('#host-error').hidden = true;
      if (legacy) {
        if (JSON.stringify(result) !== JSON.stringify(state.snapshot)) applySnapshot(result, preserveInspector);
      } else {
        syncVersion = result.version;
        if (result.snapshot) applySnapshot(result.snapshot, preserveInspector);
      }
    }
    catch (error) { $('#host-error').hidden = false; $('#host-error').textContent = error.message || '无法读取本地素材库'; }
  })();
  try { await refreshPromise; } finally { refreshPromise = null; }
}
async function pollRefresh() {
  if (refreshStopped) return;
  await refresh({ preserveInspector: true });
  if (refreshStopped) return;
  const queue = state.snapshot.queue || {}, transferring = state.snapshot.bridge?.connected && state.snapshot.bridge?.pending;
  const delay = document.hidden ? 6000 : queue.active || queue.pending || transferring ? 700 : 1500;
  clearTimeout(refreshTimer); refreshTimer = setTimeout(pollRefresh, delay);
}
async function run(method, ...args) {
  if (['assignCategory', 'addToCategory', 'removeFromCategory', 'removeFromCategories', 'createCategory', 'renameCategory', 'deleteCategory', 'updateAsset', 'removeAssets', 'setCategoryPinned'].includes(method)) clearUndoToast();
  busy(true);
  try { return await call(method, ...args); }
  catch (error) { errorToast(error); throw error; }
  finally { busy(false); }
}

function disposePreview() { disposeViewer?.(); disposeViewer = null; }
function disposePreviewDetails() { previewDetailsController?.dispose(); previewDetailsController = null; }
function closeDialog() { const dialog = $('#dialog'); categorySelects.close(); disposePreview(); disposePreviewDetails(); if (dialog.open) dialog.close(); dialog.classList.remove('preview-dialog', 'scene-group-dialog'); delete $('#dialog-content').dataset.sceneGroup; delete $('#dialog-content').dataset.importMode; delete $('#dialog-content').dataset.previewAsset; }
function renderOpenPreview(asset) {
  categorySelects.close();
  disposePreview();
  disposePreviewDetails();
  $('#dialog-content').innerHTML = previewDialog(asset, state.snapshot);
  $('#dialog-content').dataset.previewAsset = asset.id;
  previewDetailsController = mountPreviewDetails({
    dialog: $('#dialog'),
    preferences: previewDetailsPreferences,
    assetId: asset.id,
    initialName: asset.name || asset.originalName || '素材预览',
    isImage: asset.kind === 'image' || asset.assetType === 'image',
    onRename: async (name, id) => {
      clearUndoToast();
      await call('updateAsset', id, { name });
      await refresh();
    },
    onError: errorToast,
  });
  categorySelects.enhance($('#dialog-content'));
  disposeViewer = mountPreviewViewer($('#dialog-content')); updateAudioUI();
}
function refreshPreviewMedia(asset) {
  const media = $('#dialog .preview-media');
  if (!media) return;
  const template = document.createElement('template');
  template.innerHTML = previewDialog(asset, state.snapshot);
  disposePreview();
  media.replaceChildren(...template.content.querySelector('.preview-media').childNodes);
  disposeViewer = mountPreviewViewer(media);
  refreshPreviewDetails(asset); updateAudioUI();
}
function refreshPreviewDetails(asset) {
  const panel = $('#dialog .preview-details');
  previewDetailsController?.update(asset);
  if (!panel || panel.contains(document.activeElement) && document.activeElement.matches('input, select, textarea') || categorySelects.isOpenWithin(panel)) return;
  const focused = panel.contains(document.activeElement) ? document.activeElement.closest('[data-field], [data-select-trigger], [data-action]') : null;
  const key = focused && ['field', 'selectTrigger', 'action'].find(name => focused.dataset[name]);
  const value = key && focused.dataset[key];
  categorySelects.close();
  panel.innerHTML = renderAssetDetails(asset, state.snapshot);
  categorySelects.enhance(panel);
  if (key) Array.from(panel.querySelectorAll(`[data-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}]`))
    .find(element => element.dataset[key] === value)?.focus({ preventScroll: true });
}
function openPreview(id) {
  const asset = state.snapshot.assets.find(item => item.id === id); if (!asset) return;
  const groupId = $('#dialog-content').dataset.sceneGroup;
  closeDialog();
  renderOpenPreview(asset);
  if (groupId) { const back = document.createElement('button'); back.className = 'button secondary preview-return'; back.dataset.action = 'open-scene-group'; back.dataset.id = groupId; back.textContent = '返回组合'; $('#dialog .preview-heading-actions').prepend(back); }
  $('#dialog').classList.add('preview-dialog'); $('#dialog').showModal();
}
function openAuthorMessage() { return openSupportAuthor({ document, closeDialog, icon }); }
function openProjectDialog() {
  closeDialog();
  $('#dialog-content').innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">新建项目文件夹</h2><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close',18)}</button></div><p class="dialog-copy">把一部剧需要的人物、场景、道具、特效和音频放在一起。同一素材可以加入多个项目，不会复制原文件。</p><label class="dialog-label">项目名称<input id="project-name" maxlength="48" placeholder="例如：我的第一部剧" autocomplete="off"></label><div class="dialog-actions"><button class="button secondary" data-action="close-dialog">取消</button><button class="button primary" data-action="save-project">创建项目</button></div>`;
  $('#dialog').showModal(); $('#project-name').focus();
}
async function saveProject() {
  const name = $('#project-name')?.value.trim();
  if (!name) { $('#project-name')?.focus(); return; }
  try {
    const project = await run('createProject', name);
    closeDialog(); await refresh();
    state.category = project.id; state.typeScope = 'all'; state.collection = 'all';
    state.selected.clear(); state.detail = null; renderAll();
    toast('项目已创建 · 可将同一素材加入多个分类或项目');
  } catch { /* run reports the error */ }
}
function renderUpdateBadge() {
  const button = $('#app-update'), available = updateResult.status === 'available';
  button.dataset.state = available ? 'available' : updateResult.status;
  $('#app-update-label').textContent = available ? `新版本 ${updateResult.latestVersion || ''}` : '检查更新';
  button.title = available ? `有新版 ${updateResult.latestVersion}，点击查看下载和更新方法` : '检查安安素材管理器的新版本';
}
function renderUpdateDialog() {
  const panel = $('#update-panel');
  if (!panel) return;
  const status = updatePromise ? 'checking' : updateResult.status;
  const copy = status === 'checking' ? ['正在检查新版…', '只查看官方版本信息，请稍候。']
    : status === 'available' ? [`发现新版 ${updateResult.latestVersion}`, '点击“一键更新”，自动下载、校验并启动更新。']
    : status === 'current' ? ['已是最新版本', '可以继续安心整理素材啦。']
    : status === 'unsupported' ? ['当前运行方式不支持检查更新', '请使用正式发布的 Windows 软件；也可以前往官方页面查看。']
    : ['暂时无法检查新版', '网络暂不可用，稍后可重试；本地素材和日常使用不受影响。'];
  $('#update-status').dataset.state = status;
  $('#update-status').innerHTML = `<strong>${e(copy[0])}</strong><p>${e(copy[1])}</p>`;
  $('#update-current-version').textContent = `当前版本 v${updateResult.currentVersion || '0.3.19'}`;
  const reminder = $('#update-reminder-status');
  if (reminder) {
    const until = updatePromptPreferences.get().snoozedUntil;
    reminder.textContent = until > Date.now() ? `已暂停启动弹窗至 ${new Date(until).toLocaleString('zh-CN')}；仍可随时手动检查更新。` : '仅暂停启动弹窗，仍可随时从工具中检查更新。';
  }
  const retry = panel.querySelector('[data-action="retry-update-check"]');
  retry.disabled = status === 'checking';
  retry.textContent = status === 'checking' ? '检查中…' : '重新检查';
  downloadControls.refresh();
}
async function checkForUpdates(manual = false) {
  if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
  if (updatePromise) { renderUpdateDialog(); return updatePromise; }
  updatePromise = Promise.resolve().then(async () => {
    try {
      const result = typeof window.shelf?.checkUpdates === 'function'
        ? await window.shelf.checkUpdates({ manual })
        : { currentVersion: updateResult.currentVersion, status: 'unsupported' };
      if (!result || !['available', 'current', 'offline', 'unsupported'].includes(result.status)) throw new Error('版本信息暂时不可用');
      updateResult = { ...updateResult, ...result };
    } catch {
      updateResult = { currentVersion: updateResult.currentVersion, status: 'offline' };
    } finally {
      updatePromise = null;
      renderUpdateBadge();
      renderUpdateDialog();
    }
    if (!manual) startupUpdatePrompt.consider(updateResult);
    return updateResult;
  });
  renderUpdateDialog();
  return updatePromise;
}
function openUpdateDialog(manual = true) {
  if (manual) startupUpdatePrompt.cancel();
  closeDialog();
  $('#dialog-content').innerHTML = `<div id="update-panel"><div class="dialog-heading"><div><div class="eyebrow">安安素材管理器</div><h2 id="dialog-title">版本更新</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close', 18)}</button></div><div class="update-meta"><div class="update-version" id="update-current-version"></div><span>作者：安屿动画</span></div><div id="update-status" class="update-status" role="status" aria-live="polite"></div><div data-update-download-controls></div><details class="update-guide"><summary>其他更新方式与说明</summary><ol><li><b>安装版：</b>退出管理器，运行新版安装包，选择原来的安装位置；不用卸载旧版。</li><li><b>免安装版：</b>下载新版后直接打开；以后使用新版入口即可。</li><li>使用同一个 Windows 账号时，原有素材库和分类会保留。请不要删除素材库目录。</li><li>AN 插件可在下方直接安装或单独更新，完成后关闭并重新打开 AN 面板。</li></ol></details><section data-plugin-panel aria-label="AN 插件安装与更新"></section><label class="update-preference"><input id="update-auto-check" type="checkbox"${checkUpdatesOnStart ? ' checked' : ''}><span>启动时检查新版<small>仅启动时检查一次，可随时关闭。</small></span></label><div class="update-reminder"><div class="update-reminder-controls"><label for="update-reminder-days">暂不提醒 <input id="update-reminder-days" type="number" min="1" max="365" step="1" value="${updatePromptPreferences.get().days}" inputmode="numeric"> 天</label><button class="button secondary" data-action="snooze-update">暂不提醒并关闭</button></div><p id="update-reminder-status" class="field-hint"></p></div><div class="update-actions"><button class="button secondary" data-action="retry-update-check">重新检查</button><button class="button secondary" data-action="open-update-page">${icon('arrow', 15)}官方下载页</button></div><p class="update-footnote">仅在您确认后下载和启动更新；检查更新只读取官方版本信息，不上传素材。</p><div class="update-support"><button type="button" class="update-project-link" data-action="open-project-page" title="打开安安素材管理器的 GitHub 项目">https://github.com/anyv-DH/anshelf</button><p>如果安安素材管理器帮到了您，欢迎到 GitHub 点一颗 Star ⭐。愿您的灵感不断，视频条条爆火！谢谢您的支持。</p></div></div>`;
  $('#dialog').showModal();
  renderUpdateDialog();
  if (manual) checkForUpdates(true);
  pluginControls.refresh();
}
async function openUpdatePage() {
  try {
    if (typeof window.shelf?.openUpdatePage !== 'function') throw new Error('请在桌面软件中打开官方下载页面。');
    await window.shelf.openUpdatePage();
  } catch (error) { errorToast(error); }
}
async function openProjectPage() {
  try {
    if (typeof window.shelf?.openProjectPage !== 'function') throw new Error('请在桌面软件中打开 GitHub 项目。');
    await window.shelf.openProjectPage();
  } catch (error) { errorToast(error); }
}
function importCategoryScope(mode) {
  const compatibility = createCategoryCompatibility(state.snapshot.categories);
  return state.snapshot.categories.filter(category => compatibility.accepts(category.id, mode));
}
function defaultImportCategory(mode) {
  const current = state.snapshot.categories.find(category => category.id === state.category);
  if (current && categoryAccepts(state.snapshot.categories, current.id, mode)) return current.id;
  return ['effect', 'audio'].includes(mode) ? state.snapshot.categories.find(category => category.systemKey === mode)?.id : undefined;
}
function importCategoryOptions(mode, selected) {
  const categories = importCategoryScope(mode);
  return `<option value="">不指定文件夹（新素材为未分类）</option>${categoryOptions(categories, selected)}`;
}
function openImportDialog(mode = 'ordinary', { preserveTarget = false, settings = null } = {}) {
  closeDialog(); state.importMode = ['ordinary', 'effect', 'audio'].includes(mode) ? mode : 'ordinary';
  const isAudio = state.importMode === 'audio', effect = state.importMode === 'effect';
  if (!preserveTarget) state.importCategoryId = defaultImportCategory(state.importMode);
  $('#dialog-content').dataset.importMode = state.importMode;
  $('#dialog-content').innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">ADD TO YOUR LIBRARY</div><h2 id="dialog-title">导入${isAudio ? '音频' : effect ? '特效素材' : '普通素材'}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close', 18)}</button></div><p class="dialog-copy">${isAudio ? '支持 MP3、WAV、OGG 和 FLAC，导入后可试听并拖入剪映或 AN。' : effect ? '选择特效 .fla 文件，自动生成动图；已有同名 GIF 时可直接使用。' : '选择 .fla 文件，自动生成静态预览，方便随时寻找。'}原始文件不会被移动或修改。</p>${isAudio ? '' : `<label class="preview-option"><input id="prefer-preview" type="checkbox" checked><span class="fake-checkbox">${icon('check', 13)}</span><span><strong>优先使用同名${effect ? ' GIF 动图' : '预览图'}</strong><small>${effect ? '找到同名 GIF 时直接使用；没有动图则自动生成。' : '找到同名 PNG、JPG 或 WebP 时直接使用，节省生成时间。'}</small></span></label>`}<div class="import-destination"><label class="dialog-label">导入到文件夹<select id="import-category">${importCategoryOptions(state.importMode, state.importCategoryId)}</select></label><div class="import-destination-actions"><button class="text-button" data-action="import-create-category">${icon('plus', 14)}创建文件夹</button><button class="text-button" data-action="import-create-child-category">${icon('plus', 14)}创建子文件夹</button></div><small class="field-hint">选择后，本次导入的新素材会直接归入该文件夹；不指定则保留重复素材原分类。</small></div><div class="import-options"><button class="import-choice" data-action="import-files"><span class="choice-icon">${icon(isAudio ? 'music' : 'file', 23)}</span><strong>选择${isAudio ? '音频' : ' FLA'}文件</strong><small>可一次选择多个${isAudio ? '音频' : '素材'}</small><span class="choice-arrow">${icon('arrow', 17)}</span></button><button class="import-choice" data-action="import-folder"><span class="choice-icon">${icon('folder', 23)}</span><strong>选择${isAudio ? '音频' : '素材'}文件夹</strong><small>递归寻找${isAudio ? '支持的音频' : '文件夹里的 .fla'}</small><span class="choice-arrow">${icon('arrow', 17)}</span></button></div><p class="dialog-note">${icon('info', 14)} 素材和预览仅保存在本机。</p>`;
  if (!isAudio) $('#dialog-content .import-options').insertAdjacentHTML('beforebegin', `<div class="resolution-option"><label class="preview-option"><input id="custom-preview-resolution" type="checkbox"><span class="fake-checkbox">${icon('check', 13)}</span><span><strong>自定义预览分辨率</strong><small>自动生成预览的最长边；同名预览图继续使用原图。</small></span></label><label class="resolution-select" for="preview-resolution">最长边<select id="preview-resolution" disabled><option value="256">256 像素 · 轻量</option><option value="512" selected>512 像素</option><option value="1024">1024 像素</option><option value="2048">2048 像素 · 2K</option></select></label>${effect ? '<p class="resolution-note">高分辨率动图会自动控制帧数，处理超时保留静态预览。</p>' : ''}</div>`);
  if (!isAudio) {
    const previewSettings = settings || importPreferences.get(state.importMode);
    $('#prefer-preview').checked = previewSettings.preferExistingPreview;
    $('#custom-preview-resolution').checked = previewSettings.customPreview;
    $('#preview-resolution').value = String(previewSettings.previewResolution);
    $('#preview-resolution').disabled = !previewSettings.customPreview;
  }
  categorySelects.enhance($('#dialog-content'));
  $('#dialog').showModal();
}
function openImportFolderForm(parentId = null) {
  const host = $('.import-destination');
  if (!host) return;
  host.querySelector('.import-folder-form')?.remove();
  host.insertAdjacentHTML('beforeend', `<div class="import-folder-form" data-parent-id="${e(parentId || '')}"><label class="dialog-label">${parentId ? '子文件夹名称' : '文件夹名称'}<input id="import-folder-name" maxlength="48" placeholder="例如：男、女、室内、户外" autocomplete="off"></label><div class="import-destination-actions"><button class="text-button" data-action="cancel-import-folder">取消</button><button class="button primary" data-action="save-import-folder">创建并选中</button></div></div>`);
  $('#import-folder-name').focus();
}
async function saveImportFolder() {
  if (state.busy) return;
  const form = $('.import-folder-form'), name = $('#import-folder-name')?.value.trim();
  if (!form || !name) { $('#import-folder-name')?.focus(); return; }
  const parentId = form.dataset.parentId || null, mode = state.importMode;
  const settings = { preferExistingPreview: !!$('#prefer-preview')?.checked, customPreview: !!$('#custom-preview-resolution')?.checked, previewResolution: Number($('#preview-resolution')?.value || 512) };
  try {
    const category = await run('createCategory', name, parentId, mode === 'image' ? 'ordinary' : mode);
    // Keep import actions locked until the new option can actually be selected.
    busy(true);
    await refresh();
    // Creation already committed even if the subsequent snapshot read failed.
    if (!state.snapshot.categories.some(item => item.id === category.id)) state.snapshot.categories.push(category);
    if (!$('#dialog').open || !form.isConnected) return;
    state.importCategoryId = category.id;
    state.category = category.id; state.typeScope = mode === 'image' ? 'ordinary' : mode; state.favoriteCategory = 'all';
    state.query = ''; $('#search').value = ''; state.categoryQuery = ''; $('#category-filter').value = '';
    state.selected.clear(); state.anchor = null; state.detail = null; state.quickCategories = false;
    renderAll();
    if (typeof unifiedImport !== 'undefined' && unifiedImport.hasSelection()) unifiedImport.configure(mode, { preserveTarget: true, settings });
    else openImportDialog(mode, { preserveTarget: true, settings });
    toast(parentId ? '子文件夹已创建并选中' : '文件夹已创建并选中');
  } catch { /* run already reported */ }
  finally { busy(false); }
}
function openCategoryDialog(id = '', parentId = '', scope = state.typeScope) {
  const category = state.snapshot.categories.find(item => item.id === id);
  const exclude = category ? categoryDescendantIds(state.snapshot.categories, id) : new Set();
  $('#dialog-content').innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">ORGANIZE YOUR FRAMES</div><h2 id="dialog-title">${category ? '管理分类' : '新建分类'}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close', 18)}</button></div><label class="dialog-label">分类名称<input id="category-name" maxlength="48" value="${e(category?.name || '')}" placeholder="例如：人物、男、女、场景" autocomplete="off"></label><label class="dialog-label">上级分类<select id="category-parent"><option value="">无 · 顶级分类</option>${categoryOptions(state.snapshot.categories, category?.parentId || parentId, exclude)}</select></label>${category ? `<button class="text-button child-category" data-action="create-child-category" data-id="${e(id)}">${icon('plus', 14)}在这里新建子分类</button>` : ''}<div class="dialog-actions"><button class="button secondary" data-action="close-dialog">取消</button>${category ? `<button class="text-button danger" data-action="delete-category" data-id="${e(category.id)}">删除分类</button>` : ''}<button class="button primary" data-action="save-category" data-id="${e(id)}">${category ? '保存修改' : '创建分类'}</button></div>`;
  if (!category) {
    const currentScope = ['ordinary', 'effect', 'audio'].includes(scope) ? scope : 'all';
    $('#category-parent').closest('label').insertAdjacentHTML('afterend', `<label class="dialog-label">所属素材类型<select id="category-scope"><option value="all" ${currentScope === 'all' ? 'selected' : ''}>所有素材</option><option value="ordinary" ${currentScope === 'ordinary' ? 'selected' : ''}>普通素材</option><option value="effect" ${currentScope === 'effect' ? 'selected' : ''}>特效素材</option><option value="audio" ${currentScope === 'audio' ? 'selected' : ''}>音频素材</option></select><small>选择上级分类时，自动沿用上级的素材类型。</small></label>`);
    syncCategoryScope();
  }
  if (category?.systemKey) {
    $('#category-name').disabled = true; $('#category-parent').disabled = true;
    $('#dialog-content [data-action="delete-category"]').remove();
    $('#dialog-content [data-action="save-category"]').remove();
    $('#category-name').closest('label').insertAdjacentHTML('afterend', '<p class="field-hint">固定顶层分类。你可以在这里新建子分类来整理素材。</p>');
  } else if (category?.kind === 'project') $('#category-parent').disabled = true;
  categorySelects.enhance($('#dialog-content'));
  $('#dialog').showModal(); $('#category-name').focus();
}

function syncCategoryScope() {
  const input = $('#category-scope'); if (!input) return;
  const parent = state.snapshot.categories.find(item => item.id === $('#category-parent')?.value);
  input.disabled = !!parent;
  if (parent) input.value = parent.scope || 'all';
  categorySelects.enhance($('#dialog-content'));
}
function openBridgeDialog() {
  const bridge = state.snapshot.bridge || {};
  const latest = bridge.pending ? `待处理：${bridge.pending.asset?.name || '素材'} · 等待在 AN 面板确认插入` : bridge.result ? bridge.result.ok ? '上次操作：已粘贴到舞台' : `上次操作：${bridge.result.error || '插入未完成'}` : '';
  $('#dialog-content').innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">SEND A FRAME TO ANIMATE</div><h2 id="dialog-title">连接 Adobe Animate</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close', 18)}</button></div><p class="dialog-copy">素材会从安安发送到 AN 接收面板，再由你确认粘贴到正在编辑的舞台。</p>${latest ? `<p class="bridge-latest">${e(latest)}</p>` : ''}<div class="bridge-steps"><div><span>1</span><p>安装软件随附的 AN 面板。<small>打开安装文件夹，按其中的说明完成安装。</small></p></div><div><span>2</span><p>在 Adobe Animate 中打开素材接收面板。<small>保持目标文档打开，将播放头放到想要的位置。</small></p></div><div><span>3</span><p>在素材卡片点击「粘贴到舞台」。<small>回到 AN 面板，点击「粘贴到舞台」。</small></p></div></div><p class="dialog-note">${icon('info', 14)} AN 未连接时，已发送素材会保留为待处理。</p><section data-plugin-panel aria-label="AN 插件安装与更新"></section><div class="dialog-actions"><button class="button secondary" data-action="close-dialog">知道了</button><button class="button primary" data-action="open-plugin-folder">${icon('folder', 16)}打开 AN 面板文件夹</button></div>`;
  $('#dialog').showModal();
  pluginControls.refresh();
}

async function importItems(method) {
  const preferExistingPreview = !!$('#prefer-preview')?.checked;
  const mode = state.importMode;
  const previewResolution = $('#custom-preview-resolution')?.checked ? Number($('#preview-resolution').value) : null;
  const targetCategory = $('#import-category')?.value;
  const options = { mode, preferExistingPreview, previewResolution };
  if (targetCategory) options.categoryId = targetCategory;
  closeDialog();
  try {
    const result = await run(method, options);
    if (!result || (!result.added && !result.duplicates && !(result.failed || []).length)) { toast('没有导入新的素材'); await refresh(); return; }
    const failed = result.failed?.length || 0;
    toast(`已导入 ${result.added || 0} 份${result.duplicates ? ` · 跳过重复 ${result.duplicates} 份` : ''}${failed ? ` · ${failed} 份失败` : ''}`);
    await refresh();
    if (state.importNotice) { toast(state.importNotice, null, 7000); state.importNotice = null; }
  }
  catch { /* run already reported */ }
}
async function saveCategory(id) {
  const name = $('#category-name')?.value.trim();
  if (!name) { $('#category-name')?.focus(); return; }
  const parentId = $('#category-parent')?.value || null;
  try {
    const category = await run(id ? 'renameCategory' : 'createCategory', ...(id ? [id, name, parentId] : [name, parentId, $('#category-scope')?.value || 'all']));
    closeDialog(); await refresh();
    if (!id && !parentId) {
      // Creation has committed even when the next snapshot is unavailable.
      if (!state.snapshot.categories.some(item => item.id === category.id)) state.snapshot.categories.push(category);
      state.category = category.id; state.typeScope = categoryScope(state.snapshot.categories, category.id, 'all'); state.collection = 'all';
      state.selected.clear(); state.detail = null; renderAll();
    }
    toast(id ? '分类已更新' : '分类已创建');
  }
  catch { /* run already reported */ }
}
async function deleteCategory(id) {
  const item = state.snapshot.categories.find(category => category.id === id);
  if (!item || !await confirmation.ask({ title: '删除分类', message: `您确定要删除“${item.name}”吗？\n该分类中的素材会保留，子分类会提升到上一级。\n原始文件不会被删除。`, confirmLabel: '确认删除分类', tone: 'danger' })) return;
  try { await run('deleteCategory', id); closeDialog(); if (state.category === id) state.category = 'all'; await refresh(); toast('分类已删除'); }
  catch { /* run already reported */ }
}
async function assignCategory(id) {
  const selected = [...state.selected]; if (!selected.length) return;
  if (!state.snapshot.assets.some(asset => state.selected.has(asset.id) && (assetCategoryIds(asset).length !== (id ? 1 : 0) || (asset.categoryId || null) !== (id || null)))) { toast('这些素材已经在这个分类里'); return; }
  try { await run('assignCategory', selected, id || null); state.quickCategories = false; toast(`已将 ${selected.length} 项归入${id ? `“${state.snapshot.categories.find(item => item.id === id)?.name || ''}”` : '未分类'}`, { action: 'undo-assign', label: '撤销' }, 5000); await refresh(); }
  catch { /* run already reported */ }
}
async function addToCategory(id) {
  const selected = [...state.selected]; if (!selected.length || !id) return;
  if (state.snapshot.assets.filter(asset => state.selected.has(asset.id)).every(asset => assetCategoryIds(asset).includes(id))) { toast('这些素材已加入这个分类'); return; }
  try { await run('addToCategory', selected, id); state.quickCategories = false; await refresh(); toast(`已加入“${state.snapshot.categories.find(item => item.id === id)?.name || ''}” · 原分类保留`, { action: 'undo-assign', label: '撤销' }, 5000); }
  catch { /* run already reported */ }
}
async function removeFromCategory(id, categoryId) {
  try { await run('removeFromCategory', [id], categoryId); await refresh(); toast('已从这个分类移除 · 素材仍保留', { action: 'undo-assign', label: '撤销' }, 5000); }
  catch { /* run already reported */ }
}
async function undoAssign() {
  try { await run('undo'); await refresh(); toast('已撤销上次操作'); }
  catch { /* run already reported */ }
}
async function removeSelected(fromLibrary = false) {
  const plan = planRemoval(state, fromLibrary); if (!plan) return;
  if (!await confirmation.ask({ title: plan.buttonLabel, message: plan.confirmation, confirmLabel: plan.scope === 'category' ? '确认移出分类' : '确认从素材库移除', tone: 'danger' })) return;
  try {
    await run(plan.method, ...plan.args);
    state.selected.clear(); state.detail = null; state.quickCategories = false;
    await refresh(); renderAll();
    toast(plan.success, { action: 'undo-assign', label: '撤销' }, 5000);
  }
  catch { /* run already reported */ }
}
async function updateField(input) {
  clearUndoToast();
  const id = input.dataset.id, field = input.dataset.field;
  let value = input.value;
  if (field === 'tags') value = value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
  if (field === 'category') value = value || null;
  try {
    if (field === 'add-category') { if (!value) return; await call('addToCategory', [id], value); }
    else await call('updateAsset', id, { [field === 'category' ? 'categoryId' : field]: value });
    await refresh();
    const asset = state.snapshot.assets.find(item => item.id === id);
    if (asset) refreshPreviewDetails(asset);
  } catch (error) {
    errorToast(error);
    const asset = state.snapshot.assets.find(item => item.id === id);
    if (asset) refreshPreviewDetails(asset);
  }
}
async function sendAsset(id) {
  if (!id) return;
  try { const result = await run('send', id); await refresh(); toast(result?.message || (result?.delivery === 'image-import' ? '图片已发送，正在等待 AN 确认导入' : state.snapshot.bridge?.connected ? '已发送到 AN 面板，请点击「粘贴到舞台」' : 'AN 未连接，已保留为待发送')); }
  catch { /* run already reported */ }
}
async function toggleFavorite(id) {
  const asset = state.snapshot.assets.find(item => item.id === id); if (!asset) return;
  try { await run('updateAsset', id, { favorite: !asset.favorite }); await refresh(); }
  catch { /* run already reported */ }
}
async function toggleLike(id) {
  const asset = state.snapshot.assets.find(item => item.id === id); if (!asset) return;
  try { const liked = !isLiked(asset); await run('updateAsset', id, { liked }); await refresh(); if (liked) toast('已放入今日点赞 · 保留 24 小时'); }
  catch { /* run already reported */ }
}
function toggleCategory(id) {
  if (state.collapsedCategories.has(id)) state.collapsedCategories.delete(id); else state.collapsedCategories.add(id);
  try { localStorage.setItem('anshelf-category-folds', JSON.stringify([...state.collapsedCategories])); } catch { /* current fold remains usable */ }
  renderSidebar(state);
  $(`[data-action="toggle-category"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}
async function pinCategory(id) {
  const category = state.snapshot.categories.find(item => item.id === id); if (!category) return;
  try { await run('setCategoryPinned', id, !category.pinned); await refresh(); toast(category.pinned ? '已取消分类置顶' : '分类已置顶', { action: 'undo-assign', label: '撤销' }, 5000); }
  catch { /* run already reported */ }
}
async function playAudio(id) {
  const asset = state.snapshot.assets.find(item => item.id === id);
  if (asset && assetMode(asset) === 'audio') await audio.toggle(asset);
}
async function openInAnimate(id) {
  try { await run('openInAnimate', id); toast('已交给 AN 打开'); }
  catch { /* run already reported */ }
}
async function revealFile(id) {
  const asset = state.snapshot.assets.find(item => item.id === id); if (!asset) return;
  try {
    const result = await call('revealInFolder', asset.id);
    if (result?.independentCopy) toast('已定位这份独立素材文件');
    else if (result?.location === 'managed') toast('原文件已不在原位置，已定位素材库副本');
  } catch (error) { errorToast(error); }
}
async function updatePreviewImage(id, restore = false) {
  const asset = state.snapshot.assets.find(item => item.id === id);
  if (!asset || assetMode(asset) === 'audio') return;
  try {
    const result = await run(restore ? 'restorePreview' : 'replacePreview', id);
    if (result?.cancelled) return;
    await refresh();
    const current = state.snapshot.assets.find(item => item.id === id);
    if (current && $('#dialog').open && $('#dialog-content').dataset.previewAsset === id) {
      $('#dialog [data-action="replace-preview"]')?.focus({ preventScroll: true });
    }
    toast(restore ? '已撤回预览更换' : '预览图已更换 · 48 小时内可在详情或预览窗口撤回', null, 5000);
  } catch { /* run already reported */ }
}
async function duplicateFile(id) {
  try {
    const source = state.snapshot.assets.find(asset => asset.id === id);
    if (!source) return;
    const options = await chooseDuplicateCategory(source);
    if (options === null) return;
    const result = await run('duplicateInFolder', id, options);
    if (result?.cancelled) return;
    await refresh();
    const asset = state.snapshot.assets.find(item => item.id === result?.assetId);
    if (!asset) { toast('复制已完成，请您刷新素材库查看'); return; }
    closeDialog();
    state.query = ''; $('#search').value = ''; state.hideChildCategories = false;
    const mode = assetMode(asset), memberships = assetCategoryIds(asset);
    const currentCategory = state.snapshot.categories.find(item => item.id === state.category);
    const inCurrentCategory = currentCategory && memberships.some(categoryId => categoryDescendantIds(state.snapshot.categories, currentCategory.id).has(categoryId));
    const typedView = { ordinary: 'ordinary', effects: 'effect', audio: 'audio' }[state.category];
    if (!(state.category === 'all' || inCurrentCategory || typedView === mode || (state.category === 'uncategorized' && !memberships.length))) {
      state.category = memberships[0] || ({ ordinary: 'ordinary', effect: 'effects', audio: 'audio' })[mode];
    }
    if (state.typeScope !== 'all' && state.typeScope !== mode) state.typeScope = mode;
    state.collection = 'all'; state.favoriteCategory = 'all'; state.quickCategories = false;
    state.selected = new Set([asset.id]); state.anchor = asset.id; state.detail = asset.id; state.revealAssetId = asset.id;
    renderAll();
    const card = $(`[data-asset="${CSS.escape(asset.id)}"]`);
    card?.scrollIntoView({ block: 'nearest' }); card?.focus({ preventScroll: true });
    toast(`已复制“${asset.name}”并加入素材库 · 可独立编辑`);
  } catch { /* run already reported */ }
}
function chooseDuplicateCategory(asset) {
  if (document.querySelector('#duplicate-category-dialog')) return Promise.resolve(null);
  const mode = assetMode(asset), compatible = createCategoryCompatibility(state.snapshot.categories);
  const categories = state.snapshot.categories.filter(category => compatible.accepts(category.id, mode));
  const dialog = document.createElement('dialog');
  dialog.id = 'duplicate-category-dialog'; dialog.className = 'duplicate-category-dialog';
  dialog.setAttribute('aria-labelledby', 'duplicate-category-title');
  dialog.innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">复制素材</div><h2 id="duplicate-category-title">复制到哪个分类？</h2></div><button class="icon-button" data-copy-cancel aria-label="取消复制">${icon('close', 18)}</button></div><p class="dialog-copy">${e(asset.name)} · 副本可单独编辑。</p><label class="dialog-label">副本分类<select id="duplicate-category" data-copy-category><option value="inherit">沿用原分类</option><option value="uncategorized">未分类</option>${categoryOptions(categories).replace(/value="([^"]*)"/g, 'value="category:$1"')}</select></label><div class="dialog-actions"><button class="button secondary" data-copy-cancel>取消</button><button class="button primary" data-copy-confirm>下一步</button></div>`;
  document.body.append(dialog); categorySelects.enhance(dialog);
  const trigger = document.activeElement;
  return new Promise(resolve => {
    let done = false;
    const finish = result => {
      if (done) return; done = true; categorySelects.close();
      if (dialog.open) dialog.close(); dialog.remove();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      resolve(result);
    };
    dialog.querySelectorAll('[data-copy-cancel]').forEach(button => button.addEventListener('click', () => finish(null)));
    dialog.querySelector('[data-copy-confirm]').addEventListener('click', () => {
      const value = dialog.querySelector('[data-copy-category]').value;
      const choice = value.startsWith('category:') ? { kind: 'category', categoryId: value.slice(9) } : { kind: value };
      try { finish(duplicateCategoryOptions(state.snapshot.categories, mode, choice)); }
      catch (error) { errorToast(error); }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    dialog.addEventListener('close', () => finish(null));
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.showModal(); dialog.querySelector('[data-copy-cancel]').focus();
  });
}
function applyAppearance({ layout, theme, previewBackground = 'checker' }) {
  topNavigation.close(layout);
  const changedTheme = document.documentElement.dataset.theme !== theme;
  document.documentElement.dataset.layout = layout;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.previewBackground = previewBackground;
  document.querySelector('meta[name="color-scheme"]').content = THEMES.find(item => item.id === theme).scheme;
  document.querySelectorAll('[data-action="theme"]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
  updateGridDensity();
  if (changedTheme) call('setTheme', theme).catch(errorToast);
}
function setTheme(theme) { applyAppearance(appearancePreferences.setTheme(theme)); }
function updateGridDensity() {
  const grid = $('#asset-grid');
  const columns = gridColumns(grid.getBoundingClientRect().width, state.density, parseFloat(getComputedStyle(grid).columnGap) || 12,
    document.documentElement.dataset.layout === 'modern' ? 235 : 190);
  grid.style.setProperty('--grid-columns', columns);
  grid.dataset.columns = String(columns);
}
function setDensity(preference) {
  state.density = ['auto', '4', '5', '6', '7', '8'].includes(preference) ? preference : 'auto';
  $('#density-label').textContent = state.density === 'auto' ? '自动' : `每行 ${state.density} 个`;
  document.querySelectorAll('#density-menu button').forEach(button => button.setAttribute('aria-checked', String(button.dataset.density === state.density)));
  try { localStorage.setItem('anshelf-density', state.density); } catch { /* current choice remains usable */ }
  updateGridDensity();
  renderAll();
}
function closeMenu(name) { $(`#${name}-menu`).hidden = true; $(`#${name}`).setAttribute('aria-expanded', 'false'); }
function closeSort() { closeMenu('sort'); }
function toggleMenu(name) {
  const hidden = $(`#${name}-menu`).hidden;
  ['sort', 'density', 'filter', 'browse'].forEach(closeMenu);
  $(`#${name}-menu`).hidden = !hidden; $(`#${name}`).setAttribute('aria-expanded', String(hidden));
}
function handleMenuKey(event) {
  const name = ['sort', 'density', 'filter', 'browse'].find(value => event.target.closest(`.${value}`));
  if (!name) return false;
  if (event.target.matches('input')) {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(name); $('#' + name).focus(); return true; }
    if (name === 'browse' && event.key === 'Enter') { event.preventDefault(); commitCustomBrowseSize(); return true; }
    return false;
  }
  const menu = $(`#${name}-menu`);
  const items = [...menu.querySelectorAll('button')];
  if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(name); $(`#${name}`).focus(); return true; }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); ['sort', 'density', 'filter', 'browse'].filter(value => value !== name).forEach(closeMenu);
    menu.hidden = false; $(`#${name}`).setAttribute('aria-expanded', 'true');
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
      current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    return true;
  }
  return false;
}

function selectCategory(id) {
  state.typeScope = categoryScope(state.snapshot.categories, id, state.typeScope); state.category = id;
  state.collection = 'all'; state.favoriteCategory = 'all'; state.selected.clear(); state.detail = null; state.quickCategories = false;
  return renderAll({ preserveInspector: false });
}

async function action(event) {
  const target = event.target.closest('[data-action]');
  if (!target || state.busy) return;
  const actionName = target.dataset.action, id = target.dataset.id;
  if (unifiedImport.handle(actionName, target)) return;
  if (sceneGroups.handle(actionName, target)) return;
  if (actionName === 'onboarding') return onboardingControls.open(target);
  if (actionName === 'skin-settings') return skinControls.open();
  if (actionName === 'appearance-settings') return appearanceControls.open();
  if (actionName === 'author-message') return openAuthorMessage();
  if (actionName === 'author-feedback') return openAuthorFeedback({ document, closeDialog, icon });
  if (actionName === 'copy-author-email') return copyAuthorEmail({ document });
  if (actionName === 'create-project') return openProjectDialog();
  if (actionName === 'save-project') return saveProject();
  if (actionName === 'toggle-browse') return toggleMenu('browse');
  if (actionName === 'browse-mode') { setBrowsePreferences({ mode: target.dataset.browseMode }); return; }
  if (actionName === 'browse-size') { setBrowsePreferences({ pageSize: target.dataset.browseSize }); return; }
  if (actionName === 'browse-custom-size') {
    commitCustomBrowseSize(); return;
  }
  if (actionName === 'collection') { state.collection = target.dataset.collection; state.selected.clear(); state.detail = null; return renderAll(); }
  if (actionName === 'add-root-subcategory') return openCategoryDialog('', id || '', categoryScope(state.snapshot.categories, id || 'all'));
  if (['previous-page', 'next-page'].includes(actionName)) {
    state.page = Math.max(0, Math.min((state.pages || 1) - 1, (state.page || 0) + (actionName === 'next-page' ? 1 : -1)));
    state.selected.clear(); state.anchor = null; state.detail = null;
    renderAll(); $('.main').scrollTop = 0; $('#asset-grid').querySelector('.asset-card')?.focus({ preventScroll: true });
    return;
  }
  if (actionName.startsWith('window-')) { try { await call('windowAction', actionName.slice(7)); } catch (error) { errorToast(error); } return; }
  if (actionName === 'check-updates') return openUpdateDialog();
  if (actionName === 'retry-update-check') return checkForUpdates(true);
  if (actionName === 'snooze-update') {
    const input = $('#update-reminder-days');
    if (!input?.reportValidity() || !updatePromptPreferences.snooze(Number(input.value))) return;
    startupUpdatePrompt.cancel(); closeDialog(); toast(`已设置 ${input.value} 天内不弹出更新提醒`); return;
  }
  if (actionName === 'open-update-page') return openUpdatePage();
  if (actionName === 'open-project-page') return openProjectPage();
  if (actionName === 'theme') return setTheme(target.dataset.theme);
  if (actionName === 'toggle-sort') return toggleMenu('sort');
  if (actionName === 'toggle-density') return toggleMenu('density');
  if (actionName === 'toggle-filter') return toggleMenu('filter');
  if (actionName === 'density') { setDensity(target.dataset.density); closeMenu('density'); $('#density').focus(); return; }
  if (actionName === 'sort') { state.sort = target.dataset.sort; $('#sort > span:first-child').textContent = target.textContent.trim(); document.querySelectorAll('#sort-menu button').forEach(button => button.setAttribute('aria-checked', String(button.dataset.sort === state.sort))); closeSort(); return renderAll(); }
  if (actionName === 'filter') {
    const folderView = ['ordinary', 'effects', 'audio'].includes(state.category) || state.snapshot.categories.some(item => item.id === state.category);
    if (!folderView) { closeMenu('filter'); return; }
    if (target.dataset.filter === 'hide-child-categories') state.hideChildCategories = !state.hideChildCategories;
    state.selected.clear(); state.anchor = null; state.detail = null;
    target.setAttribute('aria-checked', String(state.hideChildCategories));
    closeMenu('filter');
    return renderAll({ preserveInspector: false });
  }
  if (actionName === 'toggle-quick-categories' || actionName === 'toggle-add-categories') { const mode = actionName === 'toggle-add-categories' ? 'add' : 'move'; state.quickCategories = state.quickCategoryMode !== mode || !state.quickCategories; state.quickCategoryMode = mode; return renderSelection(state); }
  if (actionName === 'quick-browse-category' || actionName === 'quick-browse-back') { state.quickCategoryParentId = id || null; return renderSelection(state); }
  if (actionName === 'quick-select-current') return state.quickCategoryMode === 'add' ? addToCategory(id) : assignCategory(id);
  if (actionName === 'create-quick-category') return openCategoryDialog('', id || '', state.typeScope);
  if (actionName === 'zoom-preview') { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) openPreview(id); return; }
  if (actionName === 'play-audio') return playAudio(id);
  if (actionName === 'audio-toggle') return playAudio(audio.state().id);
  if (actionName === 'audio-stop') { audio.reconcile([]); return; }
  if (actionName === 'toggle-category') return toggleCategory(id);
  if (actionName === 'pin-category') return pinCategory(id);
  if (actionName === 'open-animate') return openInAnimate(id);
  if (actionName === 'reveal-file') return revealFile(id);
  if (actionName === 'duplicate-file') return duplicateFile(id);
  if (actionName === 'close-dialog') return closeDialog();
  if (actionName === 'import') return openImportDialog(target.dataset.mode);
  if (actionName === 'import-files') return importItems('importFiles');
  if (actionName === 'import-folder') return importItems('importFolder');
  if (actionName === 'import-create-category') return openImportFolderForm();
  if (actionName === 'import-create-child-category') {
    const parentId = $('#import-category')?.value;
    if (!parentId) { toast('请先选择一个父文件夹'); return; }
    return openImportFolderForm(parentId);
  }
  if (actionName === 'cancel-import-folder') { $('.import-folder-form')?.remove(); return; }
  if (actionName === 'save-import-folder') return saveImportFolder();
  if (actionName === 'create-category') return openCategoryDialog();
  if (actionName === 'add-subcategory') { const view = categoryBrowser(state.snapshot.categories, state.snapshot.assets, state.category, state.typeScope); return openCategoryDialog('', view.creationParent || '', view.creationScope); }
  if (actionName === 'create-child-category') { closeDialog(); return openCategoryDialog('', id); }
  if (actionName === 'edit-category') return openCategoryDialog(id);
  if (actionName === 'save-category') return saveCategory(id);
  if (actionName === 'delete-category') return deleteCategory(id);
  if (actionName === 'assign') return assignCategory(id);
  if (actionName === 'add-to-category') return addToCategory(id);
  if (actionName === 'remove-from-category') return removeFromCategory(id, target.dataset.categoryId);
  if (actionName === 'undo-assign') return undoAssign();
  if (actionName === 'remove') return removeSelected();
  if (actionName === 'remove-library') return removeSelected(true);
  if (actionName === 'favorite') { event.stopPropagation(); return toggleFavorite(id); }
  if (actionName === 'like') { event.stopPropagation(); return toggleLike(id); }
  if (actionName === 'retry') return run('retryPreview', id).then(() => refresh()).catch(() => {});
  if (actionName === 'replace-preview') return updatePreviewImage(id);
  if (actionName === 'restore-preview') return updatePreviewImage(id, true);
  if (actionName === 'send') return sendAsset(id);
  if (actionName === 'deselect') { state.selected.clear(); state.detail = null; state.quickCategories = false; return renderAll({ preserveInspector: false }); }
  if (actionName === 'favorite-category') { state.favoriteCategory = id || 'all'; state.selected.clear(); state.detail = null; return renderAll({ preserveInspector: false }); }
  if (actionName === 'clear-search') { $('#search').value = ''; state.query = ''; return renderAll(); }
  if (actionName === 'home') { state.category = 'all'; state.collection = 'all'; state.favoriteCategory = 'all'; state.typeScope = 'all'; state.query = ''; $('#search').value = ''; return renderAll(); }
  if (actionName === 'category') return selectCategory(id);
  if (actionName === 'demo') { try { await run('demo'); await refresh(false); toast('示例素材已加载'); } catch { /* run already reported */ } return; }
  if (actionName === 'compact') { try { await run('compact'); } catch { /* run already reported */ } return; }
  if (actionName === 'bridge-help') return openBridgeDialog();
  if (actionName === 'open-plugin-folder') { try { await run('openPluginFolder'); } catch { /* run already reported */ } return; }
  if (actionName === 'search-tag') { state.query = target.dataset.tag || ''; $('#search').value = state.query; return renderAll(); }
}

function selectCard(event) {
  const card = event.target.closest('.asset-card');
  if (!card || event.target.closest('button, [data-drag-id]') || (event.target.closest('.card-preview') && !event.ctrlKey && !event.metaKey && !event.shiftKey)) return;
  const id = card.dataset.asset;
  selectVisibleCard(id, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey });
  renderGrid(state); renderSelection(state); renderInspector(state);
  $(`[data-asset="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); updateAudioUI();
}
function selectVisibleCard(id, modifiers) {
  if (!state.visible.includes(id)) return;
  // Apply range/toggle rules to cards, then expand only their visible matches.
  const grouped = new Map();
  for (const ids of state.visibleGroups?.values() || []) for (const member of ids) grouped.set(member, ids);
  const members = card => grouped.get(card) || [card];
  const selectedCards = new Set(state.visible.filter(card => members(card).every(member => state.selected.has(member))));
  const result = selectAsset(selectedCards, state.anchor, id, state.visible, modifiers);
  const selected = modifiers.ctrl ? new Set(state.selected) : new Set();
  if (modifiers.ctrl) for (const card of selectedCards) {
    if (!result.selected.has(card)) for (const member of members(card)) selected.delete(member);
  }
  for (const card of result.selected) for (const member of members(card)) selected.add(member);
  state.selected = selected; state.anchor = result.anchor; state.detail = id;
}
function handleKey(event) {
  if (confirmation.isOpen()) return;
  if (document.querySelector('dialog[open]:not(#dialog)')) return;
  if (handleMenuKey(event)) return;
  if ($('#dialog').open) {
    if (event.key === 'Escape') return closeDialog();
    if (event.key === 'Enter' && $('#project-name')) { event.preventDefault(); saveProject(); return; }
    if (event.key === 'Enter' && $('#import-folder-name')) { event.preventDefault(); saveImportFolder(); return; }
    if (event.key === 'Enter' && $('#category-name') && !$('#category-name').disabled) { event.preventDefault(); const button = $('[data-action="save-category"]'); if (button) saveCategory(button.dataset.id); }
    return;
  }
  if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { event.preventDefault(); $('#search').focus(); }
  if (/input|textarea|select/i.test(document.activeElement.tagName)) return;
  const previewButton = event.target.closest('[data-action="zoom-preview"]');
  if (previewButton && !event.target.closest('button') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openPreview(previewButton.dataset.id); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); state.selected = new Set(state.visibleSelection || state.visible); state.anchor = state.visible.at(-1) || null; state.detail = state.anchor; renderGrid(state); renderSelection(state); renderInspector(state); }
  if (event.key === 'Escape') { state.selected.clear(); state.detail = null; state.quickCategories = false; ['sort', 'density', 'filter', 'browse'].forEach(closeMenu); renderAll(); }
  const card = event.target.matches('.asset-card') ? event.target : null;
  if (card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectCard(event); $(`[data-asset="${CSS.escape(card.dataset.asset)}"]`)?.focus(); }
  if (card && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const columns = getComputedStyle($('#asset-grid')).gridTemplateColumns.split(' ').length;
    const offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns })[event.key];
    const next = state.visible[Math.min(state.visible.length - 1, Math.max(0, state.visible.indexOf(card.dataset.asset) + offset))];
    selectVisibleCard(next, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey });
    renderGrid(state); renderSelection(state); renderInspector(state); updateAudioUI(); $(`[data-asset="${CSS.escape(next)}"]`)?.focus();
  }
}

document.addEventListener('click', event => { ['sort', 'density', 'filter', 'browse'].forEach(name => { if (!event.target.closest(`.${name}`)) closeMenu(name); }); action(event); });
document.addEventListener('focusin', event => { ['sort', 'density', 'filter', 'browse'].forEach(name => { if (!event.target.closest(`.${name}`)) closeMenu(name); }); });
document.addEventListener('click', selectCard);
document.addEventListener('keydown', handleKey);
$('#search').addEventListener('input', event => { state.query = event.target.value; renderGrid(state); renderSelection(state); renderInspector(state); updateAudioUI(); });
$('#category-filter').addEventListener('input', event => { state.categoryQuery = event.target.value; renderSidebar(state); });
document.addEventListener('input', event => {
  if (event.target.id !== 'quick-category-filter') return;
  state.quickCategoryQuery = event.target.value.trim();
  renderSelection(state);
});
document.addEventListener('change', event => {
  if (event.target.id === 'update-auto-check') {
    checkUpdatesOnStart = event.target.checked;
    try { localStorage.setItem('anshelf-check-updates-on-start', String(checkUpdatesOnStart)); } catch { /* current-session preference still applies */ }
    if (!checkUpdatesOnStart) { clearTimeout(updateTimer); updateTimer = null; startupUpdatePrompt.cancel(); }
  }
  if (event.target.id === 'update-reminder-days' && event.target.checkValidity()) updatePromptPreferences.setDays(Number(event.target.value));
  if (event.target.id === 'import-category') state.importCategoryId = event.target.value || undefined;
});
$('#audio-seek').addEventListener('input', event => audio.seek(Number(event.target.value)));
$('#audio-seek').addEventListener('pointerdown', () => { seekingAudio = true; });
document.addEventListener('pointerup', () => { if (seekingAudio) { seekingAudio = false; updateAudioUI(); } });
document.addEventListener('pointercancel', () => { seekingAudio = false; });
document.addEventListener('dragstart', event => {
  const handle = event.target.closest('[data-drag-id]');
  if (!handle) return;
  event.preventDefault();
  const asset = state.snapshot.assets.find(item => item.id === handle.dataset.dragId);
  if (!asset) return;
  if (!['audio', 'image'].includes(asset.kind)) return;
  if (typeof window.shelf?.startDrag !== 'function') return toast('请在桌面应用中拖出素材。');
  try { window.shelf.startDrag(asset.id); }
  catch (error) { errorToast(error); }
});
const stageDrag = mountStageDrag({
  root: document,
  shelf: window.shelf,
  getAsset: id => state.snapshot.assets.find(item => item.id === id),
  onError: errorToast,
  onState: value => {
    document.body.classList.toggle('is-stage-dragging', value === 'starting' || value === 'dragging');
    if (value === 'starting') toast('正在等待 AN 舞台释放…', null, 5000);
    if (value === 'success') toast('已送到 AN，正在粘贴到当前舞台…', null, 5000);
  },
});
function hoverAnimation(event, playing) {
  const trigger = event.target.closest('.card-preview');
  if (!trigger || trigger.contains(event.relatedTarget)) return;
  const image = trigger.querySelector('[data-hover-animation]'), cover = trigger.querySelector('.animation-cover');
  if (!image) return;
  if (playing) { image.src = image.dataset.hoverAnimation; image.hidden = false; if (cover) cover.hidden = true; }
  else { image.hidden = true; image.removeAttribute('src'); if (cover) cover.hidden = false; }
}
document.addEventListener('pointerover', event => hoverAnimation(event, true));
document.addEventListener('pointerout', event => hoverAnimation(event, false));
document.addEventListener('focusin', event => hoverAnimation(event, true));
document.addEventListener('focusout', event => hoverAnimation(event, false));
document.addEventListener('change', event => {
  if (event.target.matches('[data-field]')) updateField(event.target);
  if (event.target.id === 'custom-preview-resolution') { $('#preview-resolution').disabled = !event.target.checked; categorySelects.enhance($('#dialog-content')); }
  if (['prefer-preview', 'custom-preview-resolution', 'preview-resolution'].includes(event.target.id)
    && $('#dialog').open && $('#dialog-content').dataset.importMode === state.importMode && ['ordinary', 'effect'].includes(state.importMode)) {
    importPreferences.set(state.importMode, { preferExistingPreview: $('#prefer-preview').checked, customPreview: $('#custom-preview-resolution').checked, previewResolution: Number($('#preview-resolution').value) });
  }
  if (event.target.id === 'category-parent') syncCategoryScope();
});
$('#dialog').addEventListener('click', event => { if (event.target === $('#dialog')) closeDialog(); });
$('#dialog').addEventListener('close', () => {
  // A queued close event may belong to the previous dialog content. Reusing
  // the modal synchronously must not dispose the newly mounted preview.
  if ($('#dialog').open) return;
  disposePreview(); disposePreviewDetails(); $('#dialog').classList.remove('preview-dialog', 'scene-group-dialog');
});

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
let savedDensity = 'auto';
try { savedDensity = localStorage.getItem('anshelf-density') || 'auto'; checkUpdatesOnStart = localStorage.getItem('anshelf-check-updates-on-start') !== 'false'; const folds = JSON.parse(localStorage.getItem('anshelf-category-folds') || '[]'); if (Array.isArray(folds)) state.collapsedCategories = new Set(folds.filter(id => typeof id === 'string')); } catch { /* use default */ }
const unsubscribeDragError = window.shelf?.onDragError?.(message => toast(typeof message === 'string' ? message : message?.message || '未能开始拖拽，请重试。'));
const unsubscribeImportNotice = window.shelf?.onImportNotice?.(message => { state.importNotice = String(message); if (!state.busy) { toast(state.importNotice, null, 7000); state.importNotice = null; } refresh(); });
window.addEventListener('beforeunload', () => { refreshStopped = true; clearTimeout(refreshTimer); clearTimeout(updateTimer); gridObserver.disconnect(); unifiedImport.dispose(); fileDrop.dispose(); disposePreview(); audio.dispose(); stageDrag.dispose(); skinControls.dispose(); appearanceControls.dispose(); topNavigation.dispose(); confirmation.dispose(); pluginControls.dispose(); downloadControls.dispose(); unsubscribeConfirm?.(); unsubscribeDragError?.(); unsubscribeImportNotice?.(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !refreshStopped) { clearTimeout(refreshTimer); pollRefresh(); } });
applyAppearance(appearancePreferences.get());
setDensity(savedDensity);
syncBrowseMenu();
$('#browse-size-input').addEventListener('input', event => event.target.setCustomValidity(''));
const gridObserver = new ResizeObserver(scheduleBrowseLayout);
for (const selector of ['.main', '.library-toolbar', '#asset-grid', '#selection-bar', '#deepcategories', '#queue-status', '#bridge-status', '#host-error', '#audio-player']) gridObserver.observe($(selector));
window.addEventListener('beforeunload', () => { if (browseResizeFrame !== null) cancelAnimationFrame(browseResizeFrame); }, { once: true });
renderAll({ preserveInspector: false });
onboardingControls.consider();
pollRefresh();
renderUpdateBadge();
if (checkUpdatesOnStart && typeof window.shelf?.checkUpdates === 'function') updateTimer = setTimeout(() => { updateTimer = null; checkForUpdates(false); }, 3000);
