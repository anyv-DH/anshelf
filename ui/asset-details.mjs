/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { assetCategoryIds, assetFilename, assetMode, categoryPath, escapeHtml as e, isLiked, previewState } from './model.js';
import { formatTime } from './audio-controller.mjs';
import { icon } from './icons.js';
import { createCategoryCompatibility } from './category-compatibility.mjs';

const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const metadataRow = (label, value) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;

/** The lightbox owns this one editor; cards and the main page have no copy. */
export function renderAssetDetails(asset, { categories = [], bridge = {} } = {}) {
  if (!asset) return '<div class="asset-details-empty">暂无素材详情</div>';
  const knownCategories = Array.isArray(categories) ? categories : [];
  const mode = assetMode(asset), audio = mode === 'audio', image = asset.kind === 'image' || asset.assetType === 'image';
  const memberships = assetCategoryIds(asset), assigned = new Set(memberships);
  const targetScopes = createCategoryCompatibility(knownCategories);
  const compatible = knownCategories.filter(category => targetScopes.accepts(category.id, mode));
  const available = compatible.filter(category => !assigned.has(category.id));
  const currentCategory = knownCategories.find(category => category.id === asset.categoryId);
  const historicCurrent = currentCategory && !targetScopes.accepts(currentCategory.id, mode)
    ? `<option value="${e(currentCategory.id)}" disabled selected>${e(categoryPath(knownCategories, currentCategory.id))}（历史归属）</option>` : '';
  const options = (items, selected) => items.map(category => `<option value="${e(category.id)}"${category.id === selected ? ' selected' : ''}>${e(categoryPath(knownCategories, category.id) || category.name)}</option>`).join('');
  const tags = Array.isArray(asset.tags) ? asset.tags : [];
  const format = String(asset.extension || (audio ? '.mp3' : image ? '.png' : '.fla')).replace(/^\./, '').toUpperCase();
  const width = positive(asset.width), height = positive(asset.height), frames = positive(asset.frames), frameRate = positive(asset.frameRate);
  const state = previewState(asset);
  const origin = asset.previewOrigin === 'custom' ? '自定义预览图' : ['existing', 'sidecar', 'external'].includes(asset.previewOrigin) ? '同名预览图' : '自动预览';
  const liked = isLiked(asset);
  const notices = audio || image ? [] : [...new Set([asset.previewWarning, asset.animationNote].filter(Boolean))];
  const metadata = [metadataRow('文件格式', format)];
  if (audio) metadata.push(metadataRow('时长', formatTime(asset.duration)));
  else if (image) metadata.push(metadataRow('像素尺寸', width && height ? `${width} × ${height}` : '—'));
  else {
    metadata.push(metadataRow('画布尺寸', width && height ? `${width} × ${height}` : '—'));
    metadata.push(metadataRow('时间轴', frames ? `${frames} 帧` : '—'));
    if (frameRate) metadata.push(metadataRow('帧率', `${frameRate} fps`));
  }
  metadata.push(`<div><dt>原始名称</dt><dd title="${e(asset.originalName || assetFilename(asset))}">${e(asset.originalName || assetFilename(asset))}</dd></div>`);

  return `<div class="asset-detail-heading"><h3>素材详情</h3><div class="asset-detail-marks"><button class="favorite-button ${asset.favorite ? 'is-favorite' : ''}" data-action="favorite" data-id="${e(asset.id)}" aria-label="${asset.favorite ? '取消收藏' : '收藏'}" aria-pressed="${!!asset.favorite}">${icon('heart', 17)}</button><button class="favorite-button ${liked ? 'is-liked' : ''}" data-action="like" data-id="${e(asset.id)}" aria-label="${liked ? '取消点赞' : '点赞，保留24小时'}" aria-pressed="${liked}">${icon('like', 17)}</button></div></div>
    <p class="detail-origin">${audio ? '本地音频' : image ? '本地图片' : state === 'ready' ? e(origin) : state === 'error' ? '预览失败' : '正在生成预览'}${!audio && !image && bridge?.connected ? ' · AN 已连接' : ''}</p>
    <div class="detail-fields">
      <label>素材名称<input id="asset-name" data-field="name" data-id="${e(asset.id)}" value="${e(asset.name || '')}" maxlength="180" autocomplete="off"></label>
      <label>移动到分类<span class="field-hint">替换已有分类</span><select data-field="category" data-id="${e(asset.id)}"><option value="">未分类</option>${historicCurrent}${options(compatible, asset.categoryId)}</select></label>
      <div class="asset-categories"><span class="field-hint">已加入的分类 · 点击 × 仅取消该分类</span><div class="tag-list">${memberships.map(id => `<button data-action="remove-from-category" data-id="${e(asset.id)}" data-category-id="${e(id)}" title="从此分类移除，保留素材">${e(categoryPath(knownCategories, id) || '分类已移除')} ×</button>`).join('') || '<span class="field-hint">未分类</span>'}</div></div>
      <label>加入其他分类<span class="field-hint">保留已有分类</span><select data-field="add-category" data-id="${e(asset.id)}"${available.length ? '' : ' disabled'}><option value="">${available.length ? '选择要加入的分类…' : '暂无其他兼容分类'}</option>${options(available)}</select></label>
      <label>标签<span class="field-hint">用逗号分隔</span><input data-field="tags" data-id="${e(asset.id)}" value="${e(tags.join('，'))}" placeholder="例如：人物，动作，场景" maxlength="400" autocomplete="off"></label>
      ${tags.length ? `<div class="tag-list">${tags.map(tag => `<button data-action="search-tag" data-tag="${e(tag)}">${e(tag)}</button>`).join('')}</div>` : ''}
    </div>
    <dl class="metadata">${metadata.join('')}</dl>
    ${notices.map(note => `<p class="animation-note">${e(note)}</p>`).join('')}
    ${!audio && !image && state === 'error' ? `<div class="preview-error"><p>${e(asset.previewError || '当前文件暂时无法生成预览，可以重新生成。')}</p></div>` : ''}`;
}
