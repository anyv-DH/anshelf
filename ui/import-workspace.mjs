/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export const IMPORT_TYPES = [
  { mode: 'ordinary', label: '普通素材', icon: 'file', hint: 'FLA · 静态预览' },
  { mode: 'effect', label: '特效素材', icon: 'spark', hint: 'FLA · 动态预览' },
  { mode: 'audio', label: '音频素材', icon: 'music', hint: '音效、配乐' },
  { mode: 'image', label: '图片素材', icon: 'image', hint: 'PNG、JPG、WebP、GIF' },
];
const extensions = { fla: ['fla'], audio: ['mp3', 'wav', 'ogg', 'flac'], image: ['png', 'jpg', 'jpeg', 'webp', 'gif'] };
function fileName(file) {
  if (typeof file === 'string') return file.replaceAll(String.fromCharCode(92), '/').split('/').at(-1);
  return String(file?.name || '');
}
function fileExtension(file) {
  const explicit = typeof file === 'object' && file?.extension ? String(file.extension) : '';
  const name = fileName(file);
  return (explicit || (name.includes('.') ? name.split('.').at(-1) : '')).replace(/^\./, '').toLowerCase();
}
function fileKind(file) {
  const basename = fileName(file);
  if (!basename?.includes('.') && typeof file === 'string') return 'folder';
  const extension = fileExtension(file);
  return Object.keys(extensions).find(kind => extensions[kind].includes(extension)) || 'unsupported';
}
export function analyzeImportPaths(input) {
  const unique = [...new Set((Array.isArray(input) ? input : []).filter(value => typeof value === 'string' && value.trim()))];
  const paths = [], unsupported = [], counts = { fla: 0, audio: 0, image: 0, folder: 0 };
  for (const filePath of unique) {
    const kind = fileKind(filePath);
    if (kind === 'unsupported') unsupported.push(filePath);
    else { paths.push(filePath); counts[kind]++; }
  }
  const kinds = ['fla', 'audio', 'image'].filter(kind => counts[kind]);
  return { paths, unsupported, counts, mixed: kinds.length > 1, mode: kinds[0] === 'audio' ? 'audio' : kinds[0] === 'image' ? 'image' : 'ordinary' };
}
export function analyzeImportFiles(input) {
  const files = (Array.isArray(input) ? input : []).filter(file => file && typeof file === 'object');
  const valid = [], unsupported = [], counts = { fla: 0, audio: 0, image: 0, folder: 0 };
  for (const file of files) {
    const kind = fileKind(file);
    if (kind === 'unsupported') unsupported.push(file);
    else { valid.push(file); counts[kind]++; }
  }
  const kinds = ['fla', 'audio', 'image'].filter(kind => counts[kind]);
  return { files: valid, unsupported, counts, mixed: kinds.length > 1, mode: kinds[0] === 'audio' ? 'audio' : kinds[0] === 'image' ? 'image' : 'ordinary' };
}
export function pathsForImportMode(paths, mode) {
  if (!IMPORT_TYPES.some(type => type.mode === mode)) return [];
  const target = mode === 'ordinary' || mode === 'effect' ? 'fla' : mode;
  return analyzeImportPaths(paths).paths.filter(filePath => fileKind(filePath) === target || fileKind(filePath) === 'folder');
}
export function createImportSession({ api = {} } = {}) {
  let selectionId = null, files = [], rejected = [], generation = 0, submitting = false;
  function snapshot() {
    const detected = analyzeImportFiles(files);
    return { ...detected, selectionId, unsupported: [...rejected] };
  }
  function setSelection(result) {
    if (!result || result.canceled || result.cancelled) return null;
    const detected = analyzeImportFiles(result.files || []);
    generation++; selectionId = typeof result.selectionId === 'string' ? result.selectionId : null; files = detected.files; rejected = detected.unsupported;
    return snapshot();
  }
  function clearSelection() { selectionId = null; files = []; rejected = []; }
  async function cancelSelection() {
    const current = selectionId; generation++; clearSelection();
    if (current && typeof api.cancelImportSelection === 'function') await api.cancelImportSelection(current);
  }
  return {
    snapshot, setPaths(input) { return setSelection({ selectionId: null, files: input.map(path => ({ name: fileName(path), extension: fileExtension(path) })) }); },
    setSelection,
    async stageDroppedFiles(input) {
      if (typeof api.stageDroppedFiles !== 'function') throw new Error('当前环境不支持拖入导入，请使用新版桌面程序。');
      const request = ++generation;
      const result = await api.stageDroppedFiles(input);
      if (request !== generation) return null;
      return setSelection(result);
    },
    cancel: cancelSelection,
    async select(method, options) {
      if (typeof api[method] !== 'function') throw new Error('当前环境不支持文件选择，请使用桌面程序。');
      const request = ++generation;
      const result = await api[method](options);
      if (request !== generation) {
        if (result?.selectionId && typeof api.cancelImportSelection === 'function') await api.cancelImportSelection(result.selectionId);
        return null;
      }
      return setSelection(result);
    },
    async submit(mode, options = {}, importer = api.importSelectedPaths) {
      if (submitting) throw new Error('正在导入，请稍候。');
      if (typeof importer !== 'function') throw new Error('当前环境不支持拖入导入，请使用新版桌面程序。');
      const target = mode === 'ordinary' || mode === 'effect' ? 'fla' : mode;
      const selected = files.filter(file => fileKind(file) === target || fileKind(file) === 'folder');
      if (!selected.length) throw new Error('所选类型没有可导入的文件，请选择其他素材类型。');
      if (!selectionId) throw new Error('导入选择已失效，请重新选择文件。');
      const request = generation;
      submitting = true;
      try {
        const result = await importer(selectionId, { ...options, mode });
        if (request === generation && !result?.canceled && !result?.cancelled) {
          // The host knows exactly which files succeeded, including duplicate
          // basenames. Preserve its remainder so failed files can be retried.
          if (result?.selection && typeof result.selection === 'object') {
            setSelection(result.selection);
          } else if (!result?.failed?.length) {
            const consumed = new Set(selected);
            files = files.filter(file => !consumed.has(file));
            if (!files.length) {
              const current = selectionId; selectionId = null;
              if (current && typeof api.cancelImportSelection === 'function') await api.cancelImportSelection(current);
            }
          }
        }
        return result;
      } finally { submitting = false; }
    },
  };
}
export function mountFileDrop({ root = document, api = {}, canAccept = () => true, onFiles = () => {}, onError = () => {}, onHover = () => {} } = {}) {
  let entered = 0, disposed = false, generation = 0;
  const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files') || !!event.dataTransfer?.files?.length;
  function dragenter(event) { if (!isFileDrag(event)) return; event.preventDefault(); entered++; if (canAccept()) onHover(true); }
  function dragover(event) { if (!isFileDrag(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = canAccept() ? 'copy' : 'none'; }
  function dragleave(event) { if (!isFileDrag(event)) return; entered = Math.max(0, entered - 1); if (!entered) onHover(false); }
  async function drop(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault(); entered = 0; onHover(false);
    if (!canAccept() || disposed) return;
    const request = ++generation, files = Array.from(event.dataTransfer?.files || []);
    try {
      if (typeof api.stageDroppedFiles !== 'function') throw new Error('拖入导入需要使用新版桌面程序。');
      const result = await api.stageDroppedFiles(files);
      if (disposed || request !== generation || !canAccept()) {
        if (result?.selectionId && typeof api.cancelImportSelection === 'function') await api.cancelImportSelection(result.selectionId);
        return;
      }
      if (!result || result.canceled || result.cancelled) return;
      await onFiles(result);
    } catch (error) { if (!disposed && request === generation) onError(error); }
  }
  const listeners = { dragenter, dragover, dragleave, drop };
  for (const [name, callback] of Object.entries(listeners)) root.addEventListener(name, callback);
  return { dispose() { disposed = true; generation++; entered = 0; onHover(false); for (const [name, callback] of Object.entries(listeners)) root.removeEventListener(name, callback); } };
}
