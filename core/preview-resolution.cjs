/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const PREVIEW_RESOLUTIONS = [256, 512, 1024, 2048];
const DEFAULT_PREVIEW_SIDE = 640;

function normalizePreviewResolution(value) {
  if (value === undefined || value === null) return null;
  if (!PREVIEW_RESOLUTIONS.includes(value)) throw new Error('预览分辨率须为默认、256、512、1024 或 2048 像素');
  return value;
}

function previewSide(value) {
  return normalizePreviewResolution(value) ?? DEFAULT_PREVIEW_SIDE;
}

module.exports = { PREVIEW_RESOLUTIONS, DEFAULT_PREVIEW_SIDE, normalizePreviewResolution, previewSide };
