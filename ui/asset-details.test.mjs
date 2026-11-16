/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAssetDetails } from './asset-details.mjs';

const asset = { id: 'asset-1', name: '角色', originalName: '角色.fla', assetType: 'ordinary', extension: '.fla', tags: ['都市'], categoryId: 'people', categoryIds: ['people', 'project'], width: 1920, height: 1080, frames: 1, previewStatus: 'ready', previewUrl: 'asset-preview://example' };
const categories = [
  { id: 'people', name: '人物', scope: 'ordinary', parentId: null },
  { id: 'modern', name: '现代都市', scope: 'ordinary', parentId: 'people' },
  { id: 'project', name: '第一部剧', scope: 'all', kind: 'project', parentId: null },
  { id: 'music', name: '配乐', scope: 'audio', parentId: null },
  { id: 'music-child', name: '音乐子类', parentId: 'music' },
  { id: 'effect', name: '火焰', scope: 'effect', parentId: null },
  { id: 'unknown', name: '不支持的类型', scope: 'video', parentId: null },
];
const field = (markup, name) => markup.match(new RegExp(`<select[^>]*data-field="${name}"[^>]*>([\\s\\S]*?)</select>`))?.[1] || '';

test('preview details contain editable fields and multi-category actions without another preview or send area', () => {
  const markup = renderAssetDetails(asset, { categories, bridge: { connected: true } });
  assert.match(markup, /id="asset-name"[^>]*data-field="name"/);
  assert.match(markup, /data-field="tags"[^>]*value="都市"/);
  assert.match(field(markup, 'category'), /value="people" selected/);
  assert.match(markup, /data-action="remove-from-category"[^>]*data-id="asset-1"[^>]*data-category-id="project"/);
  assert.match(field(markup, 'add-category'), /value="modern"/);
  assert.doesNotMatch(field(markup, 'add-category'), /value="(?:people|project)"/);
  assert.match(markup, /1920 × 1080/);
  assert.match(markup, /1 帧/);
  assert.match(markup, /FLA/);
  assert.doesNotMatch(markup, /<img|data-preview-viewport|data-action="(?:send|replace-preview|retry|open-animate)"/);
});

test('category choices respect media scope, inherited scope, project sharing and unknown-scope rejection', () => {
  const ordinary = renderAssetDetails(asset, { categories });
  assert.match(field(ordinary, 'category'), /value="project"/);
  assert.match(field(ordinary, 'category'), /人物 \/ 现代都市/);
  assert.doesNotMatch(field(ordinary, 'category'), /value="(?:music|music-child|effect|unknown)"/);
  const audio = renderAssetDetails({ ...asset, kind: 'audio', assetType: 'audio', categoryId: null, categoryIds: [], extension: '.wav' }, { categories });
  assert.match(field(audio, 'category'), /value="music"/);
  assert.match(field(audio, 'category'), /value="music-child"/);
  assert.match(field(audio, 'category'), /value="project"/);
  assert.doesNotMatch(field(audio, 'category'), /value="(?:people|modern|effect|unknown)"/);
});

test('asset and category text are escaped in values, labels, metadata, notices and membership actions', () => {
  const markup = renderAssetDetails({ ...asset, id: 'id" onclick="bad', name: '<script>x</script>', originalName: '<img src=x onerror=bad>', tags: ['"><svg/onload=bad>'], previewWarning: '<b>warning</b>', previewStatus: 'error', previewError: '<iframe>bad</iframe>' }, {
    categories: [{ id: 'people', name: '<button>人物</button>', scope: 'ordinary' }],
  });
  assert.match(markup, /value="&lt;script&gt;x&lt;\/script&gt;"/);
  assert.match(markup, /&lt;img src=x onerror=bad&gt;/);
  assert.match(markup, /data-id="id&quot; onclick=&quot;bad"/);
  assert.match(markup, /&lt;button&gt;人物&lt;\/button&gt;/);
  assert.match(markup, /&lt;b&gt;warning&lt;\/b&gt;/);
  assert.match(markup, /&lt;iframe&gt;bad&lt;\/iframe&gt;/);
  assert.doesNotMatch(markup, /<script|<img|<iframe|<svg\/onload/);
});

test('audio details show duration and format instead of canvas or image failure status', () => {
  const markup = renderAssetDetails({ id: 'audio', name: '转场', extension: '.wav', kind: 'audio', duration: 125.9, previewStatus: 'error', previewError: '图片失败' }, { categories });
  assert.match(markup, /WAV/);
  assert.match(markup, /2:05/);
  assert.doesNotMatch(markup, /画布尺寸|时间轴|图片失败/);
  assert.match(markup, /未分类/);
});

test('details tolerate an empty snapshot and incomplete metadata, preserving favorites and daily likes', () => {
  const markup = renderAssetDetails({ id: 'new', name: '新素材', favorite: true, liked: true, likedAt: Date.now() });
  assert.match(markup, /data-action="favorite"[^>]*aria-pressed="true"/);
  assert.match(markup, /data-action="like"[^>]*aria-pressed="true"/);
  assert.match(markup, /<dd>—<\/dd>/);
  assert.match(field(markup, 'add-category'), /value=""/);
  assert.doesNotMatch(markup, /undefined|NaN/);
  assert.match(renderAssetDetails(null), /暂无素材详情/);
});

test('detail category menus reject new cross-type writes into legacy all system roots', () => {
  const legacy = [
    { id: 'people', name: '人物', systemKey: 'character', scope: 'all' },
    { id: 'child', name: '现代都市', parentId: 'people', scope: 'all' },
    { id: 'effects', name: '特效', systemKey: 'effect', scope: 'all' },
    { id: 'project', name: '我的剧', kind: 'project', scope: 'all' },
    { id: 'legacy', name: '旧共享分类', scope: 'all' },
  ];
  const audio = renderAssetDetails({ ...asset, assetType: 'audio', kind: 'audio', categoryId: 'people', categoryIds: ['people'], extension: '.wav' }, { categories: legacy });
  const selectable = field(audio, 'category').replace(/<option\b[^>]*\bdisabled\b[^>]*>[\s\S]*?<\/option>/g, '');
  assert.doesNotMatch(selectable, /value="(?:people|child|effects)"/);
  assert.doesNotMatch(field(audio, 'add-category'), /value="(?:people|child|effects)"/);
  assert.match(field(audio, 'category'), /value="project"/);
  assert.match(field(audio, 'category'), /value="legacy"/);
  assert.match(audio, /data-action="remove-from-category"[^>]*data-category-id="people"/);
  const ordinary = renderAssetDetails(asset, { categories: legacy });
  assert.match(field(ordinary, 'category'), /value="child"/);
  assert.doesNotMatch(field(ordinary, 'category'), /value="effects"/);
});

test('historical incompatible main category stays visibly selected without becoming a new write target', () => {
  const legacy = [{ id: 'people', name: '人物', scope: 'all', systemKey: 'character' }, { id: 'project', name: '我的剧', scope: 'all', kind: 'project' }];
  const markup = renderAssetDetails({ ...asset, kind: 'audio', assetType: 'audio', categoryId: 'people', categoryIds: ['people'], extension: '.wav' }, { categories: legacy });
  const move = field(markup, 'category');
  assert.match(move, /<option value="people" disabled selected>人物（历史归属）<\/option>/);
  assert.match(move, /<option value="">未分类<\/option>/);
  assert.match(move, /<option value="project">我的剧<\/option>/);
  assert.doesNotMatch(field(markup, 'add-category'), /value="people"/);
});
