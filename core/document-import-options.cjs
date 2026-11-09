/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const { normalizePreviewResolution } = require('./preview-resolution.cjs');
const KEYS = new Set(['mode', 'categoryId', 'previewResolution', 'preferExistingPreview']);

function documentImportOptions(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !KEYS.has(key))) throw new Error('当前文档导入选项无效');
  const options = {};
  if ('mode' in value) {
    if (!['ordinary', 'effect'].includes(value.mode)) throw new Error('请选择普通素材或特效素材');
    options.mode = value.mode;
  }
  if ('categoryId' in value) {
    if (value.categoryId !== null && (typeof value.categoryId !== 'string' || !value.categoryId || value.categoryId.length > 128 || value.categoryId.includes('\0'))) throw new Error('请选择有效的分类文件夹');
    options.categoryId = value.categoryId;
  }
  if ('previewResolution' in value) options.previewResolution = normalizePreviewResolution(value.previewResolution);
  if ('preferExistingPreview' in value) {
    if (typeof value.preferExistingPreview !== 'boolean') throw new Error('同名预览选项无效');
    options.preferExistingPreview = value.preferExistingPreview;
  }
  return options;
}

module.exports = { documentImportOptions };
