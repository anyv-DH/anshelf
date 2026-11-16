/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export const IMPORT_PREFERENCES_STORAGE_KEY = 'anshelf-import-preview-preferences';

const defaults = { preferExistingPreview: true, customPreview: false, previewResolution: 512 };
const modes = ['ordinary', 'effect'];
const resolutions = [256, 512, 1024, 2048];

function normalize(value) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    preferExistingPreview: typeof settings.preferExistingPreview === 'boolean' ? settings.preferExistingPreview : defaults.preferExistingPreview,
    customPreview: typeof settings.customPreview === 'boolean' ? settings.customPreview : defaults.customPreview,
    previewResolution: resolutions.includes(settings.previewResolution) ? settings.previewResolution : defaults.previewResolution,
  };
}

export function createImportPreferences({ getStorage = () => globalThis.localStorage } = {}) {
  let stored;
  try { stored = JSON.parse(getStorage()?.getItem(IMPORT_PREFERENCES_STORAGE_KEY) || '{}'); } catch { stored = {}; }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
  const preferences = { ordinary: normalize(stored.ordinary), effect: normalize(stored.effect) };
  return {
    get(mode) { return modes.includes(mode) ? { ...preferences[mode] } : null; },
    set(mode, settings) {
      if (!modes.includes(mode)) return;
      preferences[mode] = normalize(settings);
      try { getStorage()?.setItem(IMPORT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences)); } catch { /* retain the current-session preference */ }
    },
  };
}
