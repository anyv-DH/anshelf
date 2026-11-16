/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportPreferences, IMPORT_PREFERENCES_STORAGE_KEY } from './import-preferences.mjs';

const defaults = { preferExistingPreview: true, customPreview: false, previewResolution: 512 };
function memoryStorage(initial) {
  const values = new Map(initial === undefined ? [] : [[IMPORT_PREFERENCES_STORAGE_KEY, initial]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test('ordinary and effect imports retain the existing defaults before any preference is saved', () => {
  const preferences = createImportPreferences({ getStorage: () => memoryStorage() });
  assert.deepEqual(preferences.get('ordinary'), defaults);
  assert.deepEqual(preferences.get('effect'), defaults);
});

test('2K resolution, custom toggle and same-name preview preference survive a new app session', () => {
  const storage = memoryStorage();
  const settings = { preferExistingPreview: false, customPreview: true, previewResolution: 2048 };
  createImportPreferences({ getStorage: () => storage }).set('ordinary', settings);
  assert.deepEqual(createImportPreferences({ getStorage: () => storage }).get('ordinary'), settings);
});

test('ordinary and effect preferences stay independent and a disabled custom option keeps its selected resolution', () => {
  const storage = memoryStorage(), preferences = createImportPreferences({ getStorage: () => storage });
  preferences.set('ordinary', { preferExistingPreview: false, customPreview: false, previewResolution: 2048 });
  preferences.set('effect', { preferExistingPreview: true, customPreview: true, previewResolution: 1024 });
  const reopened = createImportPreferences({ getStorage: () => storage });
  assert.deepEqual(reopened.get('ordinary'), { preferExistingPreview: false, customPreview: false, previewResolution: 2048 });
  assert.deepEqual(reopened.get('effect'), { preferExistingPreview: true, customPreview: true, previewResolution: 1024 });
});

test('all four supported resolution choices survive persistence', () => {
  for (const previewResolution of [256, 512, 1024, 2048]) {
    const storage = memoryStorage();
    createImportPreferences({ getStorage: () => storage }).set('effect', { ...defaults, customPreview: true, previewResolution });
    assert.equal(createImportPreferences({ getStorage: () => storage }).get('effect').previewResolution, previewResolution);
  }
});

test('corrupt JSON and non-object preference roots fall back safely', () => {
  for (const raw of ['{bad', 'null', 'true', '42', '[]', '"ordinary"']) {
    const preferences = createImportPreferences({ getStorage: () => memoryStorage(raw) });
    assert.deepEqual(preferences.get('ordinary'), defaults);
    assert.deepEqual(preferences.get('effect'), defaults);
  }
});

test('stored fields are validated independently and strings cannot enable preview options', () => {
  const storage = memoryStorage(JSON.stringify({ ordinary: { preferExistingPreview: 'false', customPreview: 'true', previewResolution: '2048' }, effect: { preferExistingPreview: false, customPreview: true, previewResolution: 4096 } }));
  const preferences = createImportPreferences({ getStorage: () => storage });
  assert.deepEqual(preferences.get('ordinary'), defaults);
  assert.deepEqual(preferences.get('effect'), { preferExistingPreview: false, customPreview: true, previewResolution: 512 });
});

test('saved preferences contain only preview controls, never a category or an import type', () => {
  const storage = memoryStorage(), preferences = createImportPreferences({ getStorage: () => storage });
  preferences.set('ordinary', { ...defaults, previewResolution: 2048, categoryId: 'old-folder', mode: 'effect', type: 'effect' });
  assert.deepEqual(JSON.parse(storage.getItem(IMPORT_PREFERENCES_STORAGE_KEY)), { ordinary: { ...defaults, previewResolution: 2048 }, effect: defaults });
  assert.deepEqual(preferences.get('ordinary'), { ...defaults, previewResolution: 2048 });
});

test('audio and unknown import modes cannot overwrite ordinary or effect preferences', () => {
  const storage = memoryStorage(), preferences = createImportPreferences({ getStorage: () => storage });
  preferences.set('ordinary', { ...defaults, customPreview: true, previewResolution: 2048 });
  const before = storage.getItem(IMPORT_PREFERENCES_STORAGE_KEY);
  for (const mode of ['audio', 'all', undefined, '__proto__']) preferences.set(mode, { preferExistingPreview: false, customPreview: false, previewResolution: 256 });
  assert.equal(storage.getItem(IMPORT_PREFERENCES_STORAGE_KEY), before);
  assert.deepEqual(preferences.get('ordinary'), { ...defaults, customPreview: true, previewResolution: 2048 });
  assert.deepEqual(preferences.get('effect'), defaults);
});

test('unavailable storage and failed reads or writes retain preferences for the current session', () => {
  const settings = { preferExistingPreview: false, customPreview: true, previewResolution: 2048 };
  const providers = [() => { throw new Error('storage denied'); }, () => null, () => ({ getItem() { throw new Error('read denied'); }, setItem() { throw new Error('write denied'); } })];
  for (const getStorage of providers) {
    const preferences = createImportPreferences({ getStorage });
    assert.deepEqual(preferences.get('ordinary'), defaults);
    assert.doesNotThrow(() => preferences.set('ordinary', settings));
    assert.deepEqual(preferences.get('ordinary'), settings);
  }
});

test('reading preferences returns an isolated value', () => {
  const preferences = createImportPreferences({ getStorage: () => memoryStorage() });
  preferences.get('ordinary').previewResolution = 2048;
  assert.deepEqual(preferences.get('ordinary'), defaults);
});
