/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { call } from './api.js';
import { icon } from './icons.js';
import { assetCategoryIds, assetMode, categoryDescendantIds, escapeHtml as e, gridColumns, isLiked, selectAsset } from './model.js';
import { categoryOptions, previewDialog, renderGrid, renderInspector, renderSelection, renderSidebar, renderStatus, renderSubcategories } from './render.js';
import { categoryBrowser, favoriteCategoryGroups } from './category-browser.mjs';
import { mountPreviewViewer } from './preview-viewer.mjs';
import { createAudioController, formatTime } from './audio-controller.mjs';
import { mountStageDrag } from './stage-drag.mjs';

const state = { snapshot: { assets: [], categories: [], queue: {}, bridge: {} }, category: 'all', favoriteCategory: 'all', typeScope: 'all', query: '', categoryQuery: '', collapsedCategories: new Set(), sort: 'newest', density: 'auto', hideChildCategories: false, importMode: 'ordinary', importCategoryId: undefined, selected: new Set(), anchor: null, detail: null, inspectorOpen: false, quickCategories: false, busy: false, visible: [], receivedSnapshot: false };
let toastTimer, disposeViewer, seekingAudio = false, syncVersion, refreshPromise, refreshTimer, refreshStopped = false;
const $ = selector => document.querySelector(selector);
const audio = createAudioController({ onChange: updateAudioUI });

function updateAudioUI() {
  const playback = audio.state(), player = $('#audio-player');
  player.hidden = !playback.id;
  player.dataset.id = playback.id || ''; player.dataset.playing = String(playback.playing); player.dataset.time = String(playback.currentTime);
  document.body.classList.toggle('has-audio-player', !!playback.id);
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
function busy(value) { state.busy = value; document.body.classList.toggle('is-busy', value); }
function renderAll({ preserveInspector = false } = {}) {
  renderStatus(state); renderSidebar(state); renderSubcategories(state); renderGrid(state); renderSelection(state);
  renderInspector(state); updateGridDensity();
  updateAudioUI();
}
function applySnapshot(snapshot, preserveInspector = true) {
  if (!snapshot) return;
  const oldResult = state.snapshot.bridge?.result;
  if (state.receivedSnapshot && snapshot.bridge?.result && JSON.stringify(snapshot.bridge.result) !== JSON.stringify(oldResult)) toast(snapshot.bridge.result.ok ? 'AN 面板已确认插入完成' : `AN 插入失败：${snapshot.bridge.result.error || '请在面板中检查'}`, null, 5000);
  state.receivedSnapshot = true;
  const collectionsChanged = ['assets', 'categories'].some(key => JSON.stringify(snapshot[key]) !== JSON.stringify(state.snapshot[key]));
  state.snapshot = { assets: [], categories: [], queue: {}, bridge: {}, ...snapshot };
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
  if (['assignCategory', 'addToCategory', 'removeFromCategory', 'createCategory', 'renameCategory', 'deleteCategory', 'updateAsset', 'removeAssets', 'setCategoryPinned'].includes(method)) clearUndoToast();
  busy(true);
  try { return await call(method, ...args); }
  catch (error) { errorToast(error); throw error; }
  finally { busy(false); }
}

function disposePreview() { disposeViewer?.(); disposeViewer = null; }
function closeDialog() { const dialog = $('#dialog'); disposePreview(); if (dialog.open) dialog.close(); dialog.classList.remove('preview-dialog'); delete $('#dialog-content').dataset.importMode; }
function openPreview(id) {
  const asset = state.snapshot.assets.find(item => item.id === id); if (!asset) return;
  closeDialog();
  $('#dialog-content').innerHTML = previewDialog(asset);
  $('#dialog').classList.add('preview-dialog'); $('#dialog').showModal();
  disposeViewer = mountPreviewViewer($('#dialog-content')); updateAudioUI();
}
function importCategoryScope(mode) {
  return state.snapshot.categories.filter(category => (category.scope || 'all') === 'all' || category.scope === mode);
}
function defaultImportCategory(mode) {
  const current = state.snapshot.categories.find(category => category.id === state.category);
  return current && ((current.scope || 'all') === 'all' || current.scope === mode) ? current.id : undefined;
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
  if (settings) {
    if ($('#prefer-preview')) $('#prefer-preview').checked = settings.preferExistingPreview;
    if ($('#custom-preview-resolution')) $('#custom-preview-resolution').checked = !!settings.customPreview;
    if ($('#preview-resolution')) { $('#preview-resolution').value = String(settings.previewResolution || 512); $('#preview-resolution').disabled = !settings.customPreview; }
  }
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
  const form = $('.import-folder-form'), name = $('#import-folder-name')?.value.trim();
  if (!form || !name) { $('#import-folder-name')?.focus(); return; }
  const parentId = form.dataset.parentId || null;
  const settings = { preferExistingPreview: !!$('#prefer-preview')?.checked, customPreview: !!$('#custom-preview-resolution')?.checked, previewResolution: Number($('#preview-resolution')?.value || 512) };
  try {
    const category = await run('createCategory', name, parentId, state.importMode);
    state.importCategoryId = category.id;
    await refresh();
    openImportDialog(state.importMode, { preserveTarget: true, settings });
    toast(parentId ? '子文件夹已创建并选中' : '文件夹已创建并选中');
  } catch { /* run already reported */ }
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
  $('#dialog').showModal(); $('#category-name').focus();
}

function syncCategoryScope() {
  const input = $('#category-scope'); if (!input) return;
  const parent = state.snapshot.categories.find(item => item.id === $('#category-parent')?.value);
  input.disabled = !!parent;
  if (parent) input.value = parent.scope || 'all';
}
function openBridgeDialog() {
  const bridge = state.snapshot.bridge || {};
  const latest = bridge.pending ? `待处理：${bridge.pending.asset?.name || '素材'} · 等待在 AN 面板确认插入` : bridge.result ? bridge.result.ok ? '上次操作：已粘贴到舞台' : `上次操作：${bridge.result.error || '插入未完成'}` : '';
  $('#dialog-content').innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">SEND A FRAME TO ANIMATE</div><h2 id="dialog-title">连接 Adobe Animate</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close', 18)}</button></div><p class="dialog-copy">素材会从安安发送到 AN 接收面板，再由你确认粘贴到正在编辑的舞台。</p>${latest ? `<p class="bridge-latest">${e(latest)}</p>` : ''}<div class="bridge-steps"><div><span>1</span><p>安装软件随附的 AN 面板。<small>打开安装文件夹，按其中的说明完成安装。</small></p></div><div><span>2</span><p>在 Adobe Animate 中打开素材接收面板。<small>保持目标文档打开，将播放头放到想要的位置。</small></p></div><div><span>3</span><p>在素材卡片点击「粘贴到舞台」。<small>回到 AN 面板，点击「粘贴到舞台」。</small></p></div></div><p class="dialog-note">${icon('info', 14)} AN 未连接时，已发送素材会保留为待处理。</p><div class="dialog-actions"><button class="button secondary" data-action="close-dialog">知道了</button><button class="button primary" data-action="open-plugin-folder">${icon('folder', 16)}打开 AN 面板文件夹</button></div>`;
  $('#dialog').showModal();
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
    await run(id ? 'renameCategory' : 'createCategory', ...(id ? [id, name, parentId] : [name, parentId, $('#category-scope')?.value || 'all']));
    closeDialog(); await refresh(); toast(id ? '分类已更新' : '分类已创建');
  }
  catch { /* run already reported */ }
}
async function deleteCategory(id) {
  const item = state.snapshot.categories.find(category => category.id === id);
  if (!item || !window.confirm(`删除“${item.name}”？该分类中的素材会保留，子分类会提升到上一级。`)) return;
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
  try { await run('undo'); await refresh(); toast('已撤销上次归类'); }
  catch { /* run already reported */ }
}
async function removeSelected() {
  const selected = [...state.selected]; if (!selected.length) return;
  if (!window.confirm(`从素材库移除 ${selected.length} 项？原始文件不会被删除。`)) return;
  try { await run('removeAssets', selected); state.selected.clear(); state.detail = null; await refresh(false); toast(`已移除 ${selected.length} 项`); }
  catch { /* run already reported */ }
}
async function updateField(input) {
  clearUndoToast();
  const id = input.dataset.id, field = input.dataset.field;
  let value = input.value;
  if (field === 'tags') value = value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
  if (field === 'category') value = value || null;
  try { await call('updateAsset', id, { [field === 'category' ? 'categoryId' : field]: value }); await refresh(); }
  catch (error) { errorToast(error); }
}
async function sendAsset(id) {
  if (!id) return;
  try { const result = await run('send', id); await refresh(); toast(result?.message || (state.snapshot.bridge?.connected ? '已发送到 AN 面板，请点击「粘贴到舞台」' : 'AN 未连接，已保留为待发送')); }
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
    if (result?.location === 'managed') toast('原文件已不在原位置，已定位素材库副本');
  } catch (error) { errorToast(error); }
}
function setTheme(theme) {
  if (!['dark', 'warm'].includes(theme)) theme = 'dark';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]').content = theme === 'warm' ? 'light' : 'dark';
  document.querySelectorAll('[data-action="theme"]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
  try { localStorage.setItem('anshelf-theme', theme); } catch { /* theme remains usable */ }
  call('setTheme', theme).catch(errorToast);
}
function updateGridDensity() {
  const grid = $('#asset-grid');
  const columns = gridColumns(grid.getBoundingClientRect().width, state.density, parseFloat(getComputedStyle(grid).columnGap) || 12);
  grid.style.setProperty('--grid-columns', columns);
  grid.dataset.columns = String(columns);
}
function setDensity(preference) {
  state.density = ['auto', '4', '5', '6'].includes(preference) ? preference : 'auto';
  $('#density-label').textContent = state.density === 'auto' ? '自动' : `每行 ${state.density} 个`;
  document.querySelectorAll('#density-menu button').forEach(button => button.setAttribute('aria-checked', String(button.dataset.density === state.density)));
  try { localStorage.setItem('anshelf-density', state.density); } catch { /* current choice remains usable */ }
  updateGridDensity();
}
function closeMenu(name) { $(`#${name}-menu`).hidden = true; $(`#${name}`).setAttribute('aria-expanded', 'false'); }
function closeSort() { closeMenu('sort'); }
function toggleMenu(name) {
  const hidden = $(`#${name}-menu`).hidden;
  ['sort', 'density', 'filter'].forEach(closeMenu);
  $(`#${name}-menu`).hidden = !hidden; $(`#${name}`).setAttribute('aria-expanded', String(hidden));
}
function handleMenuKey(event) {
  const name = ['sort', 'density', 'filter'].find(value => event.target.closest(`.${value}`));
  if (!name) return false;
  const menu = $(`#${name}-menu`);
  const items = [...menu.querySelectorAll('button')];
  if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(name); $(`#${name}`).focus(); return true; }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); ['sort', 'density', 'filter'].filter(value => value !== name).forEach(closeMenu);
    menu.hidden = false; $(`#${name}`).setAttribute('aria-expanded', 'true');
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
      current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    return true;
  }
  return false;
}

async function action(event) {
  const target = event.target.closest('[data-action]');
  if (!target || state.busy) return;
  const actionName = target.dataset.action, id = target.dataset.id;
  if (['previous-page', 'next-page'].includes(actionName)) {
    state.page = Math.max(0, Math.min((state.pages || 1) - 1, (state.page || 0) + (actionName === 'next-page' ? 1 : -1)));
    state.selected.clear(); state.anchor = null; state.detail = null;
    renderAll(); $('.main').scrollTop = 0; $('#asset-grid').querySelector('.asset-card')?.focus({ preventScroll: true });
    return;
  }
  if (actionName.startsWith('window-')) { try { await call('windowAction', actionName.slice(7)); } catch (error) { errorToast(error); } return; }
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
  if (actionName === 'toggle-inspector') { state.inspectorOpen = !state.inspectorOpen; renderInspector(state); return; }
  if (actionName === 'toggle-quick-categories' || actionName === 'toggle-add-categories') { const mode = actionName === 'toggle-add-categories' ? 'add' : 'move'; state.quickCategories = state.quickCategoryMode !== mode || !state.quickCategories; state.quickCategoryMode = mode; return renderSelection(state); }
  if (actionName === 'zoom-preview') { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) openPreview(id); return; }
  if (actionName === 'play-audio') return playAudio(id);
  if (actionName === 'audio-toggle') return playAudio(audio.state().id);
  if (actionName === 'audio-stop') { audio.reconcile([]); return; }
  if (actionName === 'toggle-category') return toggleCategory(id);
  if (actionName === 'pin-category') return pinCategory(id);
  if (actionName === 'open-animate') return openInAnimate(id);
  if (actionName === 'reveal-file') return revealFile(id);
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
  if (actionName === 'favorite') { event.stopPropagation(); return toggleFavorite(id); }
  if (actionName === 'like') { event.stopPropagation(); return toggleLike(id); }
  if (actionName === 'retry') return run('retryPreview', id).then(() => refresh()).catch(() => {});
  if (actionName === 'send') return sendAsset(id);
  if (actionName === 'deselect') { state.selected.clear(); state.detail = null; state.quickCategories = false; return renderAll({ preserveInspector: false }); }
  if (actionName === 'favorite-category') { state.favoriteCategory = id || 'all'; state.selected.clear(); state.detail = null; return renderAll({ preserveInspector: false }); }
  if (actionName === 'clear-search') { $('#search').value = ''; state.query = ''; return renderAll(); }
  if (actionName === 'home') { state.category = 'all'; state.favoriteCategory = 'all'; state.typeScope = 'all'; state.query = ''; $('#search').value = ''; return renderAll(); }
  if (actionName === 'category') { const modes = { ordinary: 'ordinary', effects: 'effect', audio: 'audio' }; const selectedCategory = state.snapshot.categories.find(item => item.id === id); if (modes[id]) state.typeScope = modes[id]; else if (id === 'all') state.typeScope = 'all'; else if (selectedCategory?.scope && selectedCategory.scope !== 'all') state.typeScope = selectedCategory.scope; state.category = id; state.favoriteCategory = 'all'; state.selected.clear(); state.detail = null; state.quickCategories = false; return renderAll({ preserveInspector: false }); }
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
  const result = selectAsset(state.selected, state.anchor, id, state.visible, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey });
  state.selected = result.selected; state.anchor = result.anchor; state.detail = id; renderGrid(state); renderSelection(state); renderInspector(state);
  $(`[data-asset="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); updateAudioUI();
}
function handleKey(event) {
  if (handleMenuKey(event)) return;
  if ($('#dialog').open) {
    if (event.key === 'Escape') return closeDialog();
    if (event.key === 'Enter' && $('#import-folder-name')) { event.preventDefault(); saveImportFolder(); return; }
    if (event.key === 'Enter' && $('#category-name')) { event.preventDefault(); const button = $('[data-action="save-category"]'); saveCategory(button.dataset.id); }
    return;
  }
  if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { event.preventDefault(); $('#search').focus(); }
  if (/input|textarea|select/i.test(document.activeElement.tagName)) return;
  const previewButton = event.target.closest('[data-action="zoom-preview"]');
  if (previewButton && !event.target.closest('button') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openPreview(previewButton.dataset.id); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); state.selected = new Set(state.visible); state.anchor = state.visible.at(-1) || null; state.detail = state.anchor; renderGrid(state); renderSelection(state); renderInspector(state); }
  if (event.key === 'Escape') { state.selected.clear(); state.detail = null; state.quickCategories = false; ['sort', 'density', 'filter'].forEach(closeMenu); renderAll(); }
  const card = event.target.matches('.asset-card') ? event.target : null;
  if (card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectCard(event); $(`[data-asset="${CSS.escape(card.dataset.asset)}"]`)?.focus(); }
  if (card && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const columns = getComputedStyle($('#asset-grid')).gridTemplateColumns.split(' ').length;
    const offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns })[event.key];
    const next = state.visible[Math.min(state.visible.length - 1, Math.max(0, state.visible.indexOf(card.dataset.asset) + offset))];
    const result = selectAsset(state.selected, state.anchor, next, state.visible, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey });
    state.selected = result.selected; state.anchor = result.anchor; state.detail = next; renderGrid(state); renderSelection(state); renderInspector(state); updateAudioUI(); $(`[data-asset="${CSS.escape(next)}"]`)?.focus();
  }
}

document.addEventListener('click', event => { ['sort', 'density', 'filter'].forEach(name => { if (!event.target.closest(`.${name}`)) closeMenu(name); }); action(event); });
document.addEventListener('focusin', event => { ['sort', 'density', 'filter'].forEach(name => { if (!event.target.closest(`.${name}`)) closeMenu(name); }); });
document.addEventListener('click', selectCard);
document.addEventListener('keydown', handleKey);
$('#search').addEventListener('input', event => { state.query = event.target.value; renderGrid(state); renderSelection(state); renderInspector(state); updateAudioUI(); });
$('#category-filter').addEventListener('input', event => { state.categoryQuery = event.target.value; renderSidebar(state); });
document.addEventListener('input', event => {
  if (event.target.id !== 'quick-category-filter') return;
  state.quickCategoryQuery = event.target.value.trim();
  const needle = state.quickCategoryQuery.toLocaleLowerCase();
  document.querySelectorAll('.quick-category-options [data-category-name]').forEach(button => { button.hidden = !button.dataset.categoryName.includes(needle); });
});
document.addEventListener('change', event => {
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
  if (asset.kind !== 'audio') return;
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
  if (event.target.id === 'custom-preview-resolution') $('#preview-resolution').disabled = !event.target.checked;
  if (event.target.id === 'category-parent') syncCategoryScope();
});
$('#dialog').addEventListener('click', event => { if (event.target === $('#dialog')) closeDialog(); });
$('#dialog').addEventListener('close', () => { disposePreview(); $('#dialog').classList.remove('preview-dialog'); });

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
let savedTheme = 'dark', savedDensity = 'auto';
try { savedTheme = localStorage.getItem('anshelf-theme') || 'dark'; savedDensity = localStorage.getItem('anshelf-density') || 'auto'; const folds = JSON.parse(localStorage.getItem('anshelf-category-folds') || '[]'); if (Array.isArray(folds)) state.collapsedCategories = new Set(folds.filter(id => typeof id === 'string')); } catch { /* use default */ }
const unsubscribeDragError = window.shelf?.onDragError?.(message => toast(typeof message === 'string' ? message : message?.message || '未能开始拖拽，请重试。'));
const unsubscribeImportNotice = window.shelf?.onImportNotice?.(message => { state.importNotice = String(message); if (!state.busy) { toast(state.importNotice, null, 7000); state.importNotice = null; } });
window.addEventListener('beforeunload', () => { refreshStopped = true; clearTimeout(refreshTimer); disposePreview(); audio.dispose(); stageDrag.dispose(); unsubscribeDragError?.(); unsubscribeImportNotice?.(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !refreshStopped) { clearTimeout(refreshTimer); pollRefresh(); } });
setTheme(savedTheme);
setDensity(savedDensity);
new ResizeObserver(updateGridDensity).observe($('#asset-grid'));
renderAll({ preserveInspector: false });
pollRefresh();
