/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { IMPORT_TYPES, createImportSession } from './import-workspace.mjs';

export function mountUnifiedImport({ document, api = {}, state, closeDialog, openLegacy, icon, escapeHtml: e, categorySelects, preferences, importCategoryOptions, defaultImportCategory, run, refresh, busy, toast, onError }) {
  const dialog = document.querySelector('#dialog'), content = document.querySelector('#dialog-content');
  const session = createImportSession({ api });
  let disposed = false, groupByFolder = false;
  const attempt = operation => { Promise.resolve(operation).catch(onError); };
  const heading = title => '<div class="dialog-heading"><div><div class="eyebrow">素材导入</div><h2 id="dialog-title">' + e(title) + '</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭">' + icon('close', 18) + '</button></div>';
  function render(html, mode) {
    closeDialog();
    content.innerHTML = html;
    content.dataset.importWorkspace = 'true';
    content.dataset.importMode = mode;
    categorySelects.enhance(content);
    dialog.showModal();
  }
  function typeButtons(action, onlyDetected = false) {
    const detected = session.snapshot();
    return '<div class="import-type-grid" role="group" aria-label="素材类型">' + IMPORT_TYPES.map(type => {
      const kind = ['ordinary', 'effect'].includes(type.mode) ? 'fla' : type.mode;
      const count = detected.counts[kind] || 0;
      const disabled = onlyDetected && !count;
      return '<button class="import-type-option" data-action="' + action + '" data-mode="' + type.mode + '" aria-pressed="' + String(state.importMode === type.mode) + '"' + (disabled ? ' disabled' : '') + '><span>' + icon(type.icon, 19) + '</span><strong>' + e(type.label) + '</strong><small>' + e(onlyDetected ? count + ' 份文件' : type.hint) + '</small></button>';
    }).join('') + '</div>';
  }
  function renderLauncher() {
    render(heading('导入素材') + '<p class="dialog-copy">选择素材类型，再选择文件或文件夹。识别文件后，可以设置分类和预览。也可以直接把文件拖入窗口。</p>' + typeButtons('import-select-type') + '<div class="import-options"><button class="import-choice" data-action="select-import-files"><span class="choice-icon">' + icon('file', 23) + '</span><strong>选择文件</strong><small>可一次选择多个素材</small></button><button class="import-choice" data-action="select-import-folder"><span class="choice-icon">' + icon('folder', 23) + '</span><strong>选择文件夹</strong><small>查找文件夹中的素材</small></button></div><p class="import-drop-hint">' + icon('plus', 16) + ' 拖入文件后再配置，不会立即导入</p>', 'launcher');
  }
  async function open(mode) {
    await session.cancel();
    if (disposed) return;
    groupByFolder = false;
    state.importMode = IMPORT_TYPES.some(type => type.mode === mode) ? mode : state.importMode || 'ordinary';
    renderLauncher();
  }
  function configure(mode = state.importMode, { preserveTarget = false, settings = null } = {}) {
    const detected = session.snapshot();
    if (!detected.selectionId || !detected.files.length) return;
    state.importMode = IMPORT_TYPES.some(type => type.mode === mode) ? mode : detected.mode;
    const categoryMode = state.importMode === 'image' ? 'ordinary' : state.importMode;
    if (!preserveTarget) state.importCategoryId = defaultImportCategory(categoryMode);
    const fla = ['ordinary', 'effect'].includes(state.importMode), effect = state.importMode === 'effect';
    const previewSettings = fla ? settings || preferences.get(state.importMode) : null;
    const label = IMPORT_TYPES.find(type => type.mode === state.importMode)?.label || '素材';
    const kind = fla ? 'fla' : state.importMode, count = detected.counts[kind] || 0;
    const names = detected.files.slice(0, 3).map(file => '<span title="' + e(file.name) + '">' + e(file.name) + '</span>').join('');
    const preview = fla ? '<label class="preview-option"><input id="prefer-preview" type="checkbox"' + (previewSettings.preferExistingPreview ? ' checked' : '') + '><span class="fake-checkbox">' + icon('check', 13) + '</span><span><strong>优先使用同名' + (effect ? ' GIF 动图' : '预览图') + '</strong><small>没有同名预览时自动生成。</small></span></label><div class="resolution-option"><label class="preview-option"><input id="custom-preview-resolution" type="checkbox"' + (previewSettings.customPreview ? ' checked' : '') + '><span class="fake-checkbox">' + icon('check', 13) + '</span><span><strong>自定义预览分辨率</strong><small>只调整预览，原始文件保持不变。</small></span></label><label class="resolution-select" for="preview-resolution">最长边<select id="preview-resolution"' + (previewSettings.customPreview ? '' : ' disabled') + '>' + [256, 512, 1024, 2048].map(size => '<option value="' + size + '"' + (size === previewSettings.previewResolution ? ' selected' : '') + '>' + size + (size === 2048 ? ' 像素 · 2K' : ' 像素') + '</option>').join('') + '</select></label></div>' : '<p class="dialog-note">' + icon('info', 14) + (state.importMode === 'image' ? ' 图片按原尺寸保存，直接显示预览。' : ' 音频导入后可以直接试听。') + '</p>';
    const grouping = state.importMode === 'image' ? '<label class="preview-option"><input id="import-group-by-folder" type="checkbox"' + (groupByFolder ? ' checked' : '') + '><span class="fake-checkbox">' + icon('check', 13) + '</span><span><strong>一个文件夹作为一个分组</strong><small>按图片直接所在的文件夹命名；含子文件夹时分别成组，不合并到父文件夹。</small></span></label>' : '';
    render(heading('配置本次导入') + '<div class="import-detected-summary"><strong>已识别 ' + detected.files.length + ' 份素材</strong><div class="import-chosen-files">' + names + (detected.files.length > 3 ? '<span>…</span>' : '') + '</div></div>' + typeButtons('configure-import-mode', true) + (detected.mixed ? '<p class="field-hint">本次先导入所选类型，其他类型会接着显示配置。</p>' : '') + (detected.unsupported.length ? '<p class="field-hint">另有 ' + detected.unsupported.length + ' 份不支持的文件，将跳过。</p>' : '') + '<div class="import-destination"><label class="dialog-label">导入到分类<select id="import-category">' + importCategoryOptions(categoryMode, state.importCategoryId) + '</select></label><div class="import-destination-actions"><button class="text-button" data-action="import-create-category">' + icon('plus', 14) + '创建分类</button><button class="text-button" data-action="import-create-child-category">' + icon('plus', 14) + '创建子分类</button></div></div>' + preview + grouping + '<div class="dialog-actions"><button class="button secondary" data-action="restart-import">重新选择</button><button class="button primary" data-action="confirm-import"' + (!count ? ' disabled' : '') + '>导入 ' + count + ' 份' + e(label) + '</button></div>', state.importMode);
  }
  async function choose(method) {
    if (typeof api[method] !== 'function') {
      if (state.importMode === 'image') throw new Error('图片导入需要使用新版桌面程序。');
      openLegacy(state.importMode); return;
    }
    busy(true);
    try {
      const detected = await session.select(method, { mode: state.importMode });
      if (!detected || disposed) return;
      if (!detected.files.length) { await session.cancel(); throw new Error('没有检测到支持的素材文件。'); }
      configure(state.importMode);
    } finally { busy(false); }
  }
  async function acceptSelection(result) {
    await session.cancel();
    if (disposed) {
      if (result?.selectionId) await api.cancelImportSelection?.(result.selectionId);
      return;
    }
    const detected = session.setSelection(result);
    if (!detected) return;
    groupByFolder = false;
    if (!detected.files.length) { await session.cancel(); throw new Error('没有检测到 FLA、音频或图片文件。'); }
    const recommended = detected.mode === 'ordinary' && state.typeScope === 'effect' ? 'effect' : detected.mode;
    configure(recommended);
  }
  async function confirmImport() {
    const mode = state.importMode, fla = ['ordinary', 'effect'].includes(mode);
    const options = {};
    const categoryId = document.querySelector('#import-category')?.value;
    if (categoryId) options.categoryId = categoryId;
    if (mode === 'image') options.groupByFolder = groupByFolder = !!document.querySelector('#import-group-by-folder')?.checked;
    if (fla) {
      options.preferExistingPreview = !!document.querySelector('#prefer-preview')?.checked;
      options.previewResolution = document.querySelector('#custom-preview-resolution')?.checked ? Number(document.querySelector('#preview-resolution')?.value) : null;
    }
    const previewSettings = fla ? {
      preferExistingPreview: options.preferExistingPreview,
      customPreview: !!document.querySelector('#custom-preview-resolution')?.checked,
      previewResolution: Number(document.querySelector('#preview-resolution')?.value),
    } : null;
    try {
      const result = await session.submit(mode, options, (selectionId, selectedOptions) => run('importSelectedPaths', selectionId, selectedOptions));
      if (result?.canceled || result?.cancelled) { toast('导入已取消，可以调整后重试'); return; }
      busy(true);
      await refresh();
      const failed = result?.failed?.length || 0;
      toast('已导入 ' + (result?.added || 0) + ' 份' + (result?.duplicates ? ' · 跳过重复 ' + result.duplicates + ' 份' : '') + (result?.grouping?.created ? ' · 新建 ' + result.grouping.created + ' 个分组' : '') + (result?.grouping?.updated ? ' · 更新 ' + result.grouping.updated + ' 个分组' : '') + (failed ? ' · ' + failed + ' 份失败' : ''));
      if (result?.grouping?.warnings?.length) toast(result.grouping.warnings.join('；'));
      const remaining = session.snapshot();
      if (remaining.files.length) {
        const kind = fla ? 'fla' : mode;
        if (remaining.counts[kind]) {
          state.importCategoryId = categoryId || undefined;
          configure(mode, { preserveTarget: true, settings: previewSettings });
        } else configure(remaining.mode);
      }
      else closeDialog();
    } finally { busy(false); }
  }
  function closed() { if (!dialog.open && content.dataset.importWorkspace) { delete content.dataset.importWorkspace; attempt(session.cancel()); } }
  function closeTools(event) {
    const tools = document.querySelector('#workspace-tools');
    if (tools && (!event.target.closest('#workspace-tools') || event.target.closest('[data-action]'))) tools.open = false;
  }
  function toolsKey(event) {
    const tools = document.querySelector('#workspace-tools');
    if (event.key === 'Escape' && tools?.open) { tools.open = false; tools.querySelector('summary')?.focus(); event.preventDefault(); event.stopImmediatePropagation(); }
  }
  function rememberFolderGrouping(event) { if (event.target?.id === 'import-group-by-folder') groupByFolder = !!event.target.checked; }
  dialog.addEventListener('close', closed);
  document.addEventListener('click', closeTools);
  document.addEventListener('keydown', toolsKey);
  document.addEventListener('change', rememberFolderGrouping);
  return {
    open, configure, acceptSelection,
    hasSelection: () => !!session.snapshot().selectionId,
    cancel() { attempt(session.cancel()); },
    handle(action, target) {
      if (action === 'import') attempt(open(target.dataset.mode));
      else if (action === 'import-select-type') { state.importMode = target.dataset.mode; renderLauncher(); }
      else if (action === 'select-import-files') attempt(choose('chooseImportFiles'));
      else if (action === 'select-import-folder') attempt(choose('chooseImportFolder'));
      else if (action === 'configure-import-mode') configure(target.dataset.mode);
      else if (action === 'confirm-import') attempt(confirmImport());
      else if (action === 'restart-import') attempt(open(state.importMode));
      else return false;
      return true;
    },
    dispose() { disposed = true; attempt(session.cancel()); dialog.removeEventListener('close', closed); document.removeEventListener('click', closeTools); document.removeEventListener('keydown', toolsKey); document.removeEventListener('change', rememberFolderGrouping); },
  };
}

export { openSupportAuthor } from './author-support.mjs';
