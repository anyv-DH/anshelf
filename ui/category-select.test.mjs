/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryPickerItems, selectPickerItems } from './category-select.mjs';

const options = [
  { value: '', label: '不指定文件夹（新素材为未分类）' },
  { value: 'female', label: '都市人物 / 女' },
  { value: 'outdoor', label: '背景 / 户外' },
  { value: 'urban', label: '都市人物' },
  { value: 'indoor', label: '背景 / 室内' },
  { value: 'background', label: '背景' },
  { value: 'lead', label: '都市人物 / 女 / 主角' },
];

test('category picker groups full paths into a readable hierarchy and keeps the empty choice first', () => {
  const items = categoryPickerItems(options);
  assert.equal(items[0].value, '');
  const urban = items.findIndex(item => item.value === 'urban');
  assert.deepEqual(items.slice(urban).map(item => item.value), ['urban', 'female', 'lead']);
  const lead = items.find(item => item.value === 'lead');
  assert.equal(lead.name, '主角');
  assert.equal(lead.parentLabel, '都市人物 / 女');
  assert.equal(lead.depth, 2);
});

test('category picker searches complete paths with multiple terms and excludes disabled options', () => {
  assert.deepEqual(categoryPickerItems(options, '都市 主角').map(item => item.value), ['lead']);
  assert.deepEqual(categoryPickerItems(options, '女').map(item => item.value), ['female', 'lead']);
  assert.deepEqual(categoryPickerItems(options, '无此分类'), []);
  assert.deepEqual(categoryPickerItems([{ value: 'disabled', label: '不可用', disabled: true }]), []);
  assert.equal(categoryPickerItems([{ value: 'latin', label: 'Characters / HERO' }], 'hero')[0].value, 'latin');
});

test('short theme menus preserve numeric resolution and media type option order without treating labels as folders', () => {
  const resolutions = [256, 512, 1024, 2048].map(value => ({ value: String(value), label: `${value} 像素` }));
  assert.deepEqual(selectPickerItems(resolutions).map(item => item.value), ['256', '512', '1024', '2048']);
  const media = [{ value: 'all', label: '所有素材' }, { value: 'ordinary', label: '普通素材' }, { value: 'effect', label: '特效素材' }, { value: 'audio', label: '音频素材' }];
  assert.deepEqual(selectPickerItems(media).map(item => item.value), ['all', 'ordinary', 'effect', 'audio']);
  assert.equal(selectPickerItems([{ value: 'slash', label: 'MP3 / WAV' }])[0].name, 'MP3 / WAV');
});
