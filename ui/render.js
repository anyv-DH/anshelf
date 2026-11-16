/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { assetCategoryIds, assetFilename, assetMode, categoryCount, categoryPath, categoryTree, escapeHtml as e, isLiked, previewState, visibleAssets } from './model.js';
import { icon } from './icons.js';
import { planRemoval } from './removal.mjs';
import { formatTime } from './audio-controller.mjs';
import { renderAssetDetails } from './asset-details.mjs';
import { SYSTEM_LABELS, libraryNavigation, collectionAssets, mediaCategory } from './library-navigation.mjs';
import { rootNavigationView } from './root-navigation.mjs';
import { createCategoryCompatibility } from './category-compatibility.mjs';
import { createCategoryAssignmentNavigation } from './category-assignment-navigation.mjs';
import { pageAssets } from './pagination.mjs';
import { resolveBrowseLayout, applyBrowseLayout } from './browse-preferences.mjs';
import { categoryBrowser, categoryTrail, favoriteCategoryGroups, favoriteCategoryMatches } from './category-browser.mjs';
import { filterSceneAssets, collapseSceneGroups, sceneGroupCard } from './scene-groups.mjs';

export const filename = assetFilename;
const origin = asset => asset.previewOrigin === 'custom' ? '自定义预览图' : ['existing', 'sidecar', 'external'].includes(asset.previewOrigin) ? '同名预览图' : '自动预览';
const previewReplacement = asset => `<div class="preview-replacement"><div class="preview-replacement-actions"><button class="text-button" data-action="replace-preview" data-id="${e(asset.id)}" title="选择本地图片，更换这份素材的预览图">${icon('refresh', 14)}更换预览图</button><button class="text-button" data-action="retry" data-id="${e(asset.id)}" title="从当前素材文件重新生成预览">${icon('refresh', 14)}重新生成预览</button>${Number(asset.previewUndoUntil) > Date.now() ? `<button class="text-button" data-action="restore-preview" data-id="${e(asset.id)}" title="恢复这次更换前的预览图">${icon('undo', 14)}撤回预览更换</button>` : ''}</div><p>48 小时内可撤回。旧预览缓存保留两天，到期后在软件运行时自动清理；原图片文件不受影响。</p></div>`;
const format = asset => (asset.extension || '.fla').slice(1).toUpperCase();
const audioArt = () => `<div class="audio-art" aria-hidden="true"><span class="audio-disc">${icon('music', 28)}</span><span class="audio-wave">${Array.from({ length: 19 }, (_, index) => `<i style="--bar-height:${12 + ((index * 17 + 11) % 34)}px"></i>`).join('')}</span></div>`;
const audioButton = asset => `<button class="card-action audio-play" data-action="play-audio" data-id="${e(asset.id)}" aria-label="试听${e(filename(asset))}">${icon('play', 13)}<span>试听</span></button>`;
const dragHandle = (asset, className = 'drag-handle') => {
  if (asset.kind === 'image') return `<span class="${className}" data-drag-id="${e(asset.id)}" draggable="true" title="拖入 AN 导入图片" aria-label="拖出图片到 AN">${icon('grip', 14)}<span>拖出</span></span>`;
  const audio = assetMode(asset) === 'audio';
  return `<span class="${className}" data-drag-id="${e(asset.id)}" ${audio ? 'draggable="true"' : 'data-stage-drag-id="' + e(asset.id) + '"'} title="${audio ? '拖入剪映或 AN 导入音频' : '拖到 AN 舞台，松开后自动粘贴'}" aria-label="${audio ? '拖出音频到剪映或 AN' : '拖到 AN 舞台自动粘贴'}">${icon('grip', 14)}<span>拖出</span></span>`;
};

export const categoryOptions = (categories, selected = '', exclude = new Set()) => categories.filter(item => !exclude.has(item.id)).map(item => `<option value="${e(item.id)}" ${selected === item.id ? 'selected' : ''}>${e(categoryPath(categories, item.id))}</option>`).join('');

export function previewDialog(asset, snapshot = {}) {
  const isAudio = assetMode(asset) === 'audio';
  const isImage = asset.kind === 'image' || asset.assetType === 'image';
  return `<div class="dialog-heading"><div><div class="eyebrow">${isAudio ? 'AUDIO' : 'PREVIEW'}</div><h2 id="dialog-title">${e(filename(asset))}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭预览">${icon('close', 19)}</button></div><div class="preview-workspace"><div class="preview-media">${isAudio ? `<div class="audio-lightbox">${audioArt()}${audioButton(asset)}<p>试听后，将下方拖拽区域拖入剪映或 AN。</p></div>` : `<div class="lightbox-preview checkerboard" data-preview-viewport tabindex="0" role="region" aria-label="素材预览，滚轮缩放，拖动平移，加减号缩放，0重置">${preview(asset, true)}</div><div class="preview-tools"><span>滚轮缩放 · 拖动查看</span><div class="zoom-controls" role="group" aria-label="预览缩放"><button class="icon-button" data-zoom="out" aria-label="缩小">−</button><output data-zoom-label aria-live="polite">100%</output><button class="icon-button" data-zoom="in" aria-label="放大">+</button><button class="text-button" data-zoom="reset">重置</button></div></div>`}${isAudio || isImage ? '' : previewReplacement(asset)}<div class="lightbox-actions">${dragHandle(asset, 'drag-handle lightbox-drag')}<button class="button secondary" data-action="duplicate-file" data-id="${e(asset.id)}" title="创建独立可编辑的新素材并自动入库，不影响原素材">${icon('copy', 16)}复制并入库</button><button class="button secondary" data-action="reveal-file" data-id="${e(asset.id)}">${icon('folder', 16)}文件位置</button>${isImage ? `<button class="button primary" data-action="send" data-id="${e(asset.id)}">${icon('arrow', 17)}导入 AN</button>` : isAudio ? '' : `<button class="button secondary" data-action="open-animate" data-id="${e(asset.id)}">${icon('file', 16)}用 AN 打开</button><button class="button primary" data-action="send" data-id="${e(asset.id)}">${icon('arrow', 17)}粘贴到舞台</button>`}</div></div><aside class="preview-details" aria-label="素材详情">${renderAssetDetails(asset, snapshot)}</aside></div>`;
}

function preview(asset, large = false) {
  const state = previewState(asset);
  if (state === 'ready') {
    const animated = asset.previewAnimated || asset.previewFormat === 'gif' || !!asset.animatedPreviewUrl;
    const animatedUrl = asset.animatedPreviewUrl || asset.previewUrl;
    const poster = asset.previewPosterUrl || asset.staticPreviewUrl || '';
    if (animated && !large) return `<span class="animation-cover ${poster ? '' : 'no-poster'}">${poster ? `<img src="${e(poster)}" alt="${e(filename(asset))}的静态预览" loading="lazy" draggable="false">` : `${icon('spark', 34)}<small>悬停播放动图</small>`}</span><img class="animated-image" data-hover-animation="${e(animatedUrl)}" ${poster ? `data-poster="${e(poster)}"` : ''} alt="${e(filename(asset))}的动态预览" draggable="false" hidden>`;
    return `<img src="${e(animated ? animatedUrl : asset.previewUrl)}" alt="${e(filename(asset))}的预览" loading="${large ? 'eager' : 'lazy'}" draggable="false">`;
  }
  return `<div class="preview-placeholder ${state}"${state === 'error' && asset.previewError ? ` title="${e(asset.previewError)}"` : ''}>${state === 'error' ? icon('alert', large ? 32 : 26) : '<span class="spinner"></span>'}<span>${state === 'error' ? '暂时无法预览' : '正在生成预览'}</span>${large && state === 'error' && asset.kind !== 'image' && asset.assetType !== 'image' ? '<small>请重新生成预览或查看下方详情中的原因</small>' : ''}</div>`;
}

export function categoryName(state) {
  const name = ({ all: '全部素材', ordinary: '普通素材', effects: '特效素材', audio: '音频素材', favorites: '我的收藏', liked: '今日点赞', uncategorized: '未分类' })[state.category] || state.snapshot.categories.find(item => item.id === state.category)?.name || '全部素材';
  const scope = { ordinary: '普通', effect: '特效', audio: '音频' }[state.typeScope];
  return scope && !['ordinary', 'effects', 'audio'].includes(state.category) ? `${scope} · ${name}` : name;
}

export function renderSidebar(state) {
  const { assets, categories } = state.snapshot;
  const view = libraryNavigation(categories, state.category);
  const roots = rootNavigationView(view.roots, view.root?.id, state.rootNavigationPreferences);
  const nav = (id, name, glyph, systemKey = '') => {
    const active = id === 'all' ? state.category === 'all' : view.root?.id === id;
    const temporary = roots.temporaryId === id;
    return '<button class="nav-item '+(active ? 'active' : '')+(temporary ? ' root-temporary' : '')+'" data-action="category" data-id="'+e(id)+'" '+(systemKey ? 'data-system-key="'+e(systemKey)+'"' : '')+' '+(active ? 'aria-current="page"' : '')+(temporary ? ' title="当前分类，未常驻顶部；离开后收起"' : '')+'>'+icon(glyph)+'<span>'+e(name)+'</span></button>';
  };
  const navigation = document.querySelector('#navigation'), activeRoot = view.root?.id || state.category;
  const previousRoot = navigation.dataset.activeRoot, scrollLeft = navigation.scrollLeft;
  navigation.innerHTML = nav('all', '全部', 'grid') + roots.visible.map(item => nav(item.id, SYSTEM_LABELS[item.systemKey] || item.name, item.kind === 'project' ? 'folder' : ({ effect: 'spark', audio: 'music', character: 'file', scene: 'grid', prop: 'folder', expression: 'heart' })[item.systemKey] || 'folder', item.systemKey)).join('') + '<button class="nav-item create-project" data-action="create-project" title="创建一部剧的项目素材文件夹">'+icon('plus', 14)+'<span>新建项目</span></button>';
  navigation.scrollLeft = scrollLeft;
  navigation.dataset.activeRoot = activeRoot;
  if (activeRoot !== previousRoot && navigation.scrollWidth > navigation.clientWidth) {
    const active = navigation.querySelector('[aria-current="page"]');
    if (active) {
      const bounds = navigation.getBoundingClientRect(), selected = active.getBoundingClientRect();
      if (selected.left < bounds.left) navigation.scrollLeft += selected.left - bounds.left;
      else if (selected.right > bounds.right) navigation.scrollLeft += selected.right - bounds.right;
    }
  }
  const tree = document.querySelector('#categories'), scrollTop = tree.scrollTop;
  const rows = categoryTree(categories, state.categoryQuery || '', state.collapsedCategories || new Set());
  tree.innerHTML = rows.length ? rows.map((item, index) => `<div class="category-node" style="--depth:${item.depth}"><div class="category-row ${item.pinned ? 'is-pinned' : ''}" data-category="${e(item.id)}">${item.hasChildren ? `<button class="category-fold" data-action="toggle-category" data-id="${e(item.id)}" aria-expanded="${!item.collapsed}" aria-label="${item.collapsed ? '展开' : '收起'}${e(item.name)}">${icon('chevron', 12)}</button>` : '<span class="category-fold-spacer"></span>'}<button class="nav-item ${state.category === item.id ? 'active' : ''}" data-action="category" data-id="${e(item.id)}" title="${e(categoryPath(categories, item.id))}"><span class="folder-color color-${index % 5}">${icon('folder', 15)}</span><span>${e(item.name)}</span><small>${categoryCount(assets, item.id, categories, state.typeScope || 'all')}</small></button><span class="category-row-actions"><button class="category-pin icon-button ${item.pinned ? 'pinned' : ''}" data-action="pin-category" data-id="${e(item.id)}" aria-pressed="${!!item.pinned}" title="${item.pinned ? '取消置顶' : '置顶分类'}" aria-label="${item.pinned ? '取消置顶' : '置顶'}${e(item.name)}">${icon('pin', 12)}</button><button class="category-menu icon-button" data-action="edit-category" data-id="${e(item.id)}" title="管理${e(item.name)}" aria-label="管理${e(item.name)}">${icon('more', 13)}</button></span></div></div>`).join('') : `<p class="category-empty">${state.categoryQuery ? '没有匹配的分类' : '给素材一个小小的归处'}</p>`;
  tree.scrollTop = scrollTop;
}

function renderFavoriteCategories(state) {
  const bar = document.querySelector('#subcategories');
  const { categories, assets } = state.snapshot;
  const scoped = state.typeScope === 'all' ? assets : assets.filter(asset => assetMode(asset) === state.typeScope);
  const groups = favoriteCategoryGroups(categories, scoped);
  const total = scoped.filter(asset => asset.favorite).length;
  bar.hidden = !total;
  if (!total) return;
  const scroll = bar.querySelector('.subcategory-folders')?.scrollLeft || 0;
  bar.innerHTML = `<span class="subcategory-caption">分类</span><div class="subcategory-folders"><button class="button secondary subcategory-folder ${state.favoriteCategory === 'all' ? 'is-current' : ''}" data-action="favorite-category" data-id="" aria-current="${state.favoriteCategory === 'all' ? 'page' : 'false'}"><span>全部收藏</span><small>${total}</small></button>${groups.map(group => `<button class="button secondary subcategory-folder ${state.favoriteCategory === group.id ? 'is-current' : ''}" data-action="favorite-category" data-id="${e(group.id)}" title="${e(group.name)}" aria-current="${state.favoriteCategory === group.id ? 'page' : 'false'}"><span>${e(group.name)}</span><small>${group.count}</small></button>`).join('')}</div>`;
  bar.querySelector('.subcategory-folders').scrollLeft = scroll;
}

export function renderSubcategories(state) {
  const bar = document.querySelector('#subcategories');
  const { categories, assets } = state.snapshot;
  const view = libraryNavigation(categories, state.category);
  const scroll = bar.querySelector('.subcategory-folders')?.scrollLeft || 0;
  const baseId = view.root?.id || 'all';
  const tab = (label, action, id, active, extra = '') => '<button class="subcategory-folder '+(active ? 'is-current' : '')+'" data-action="'+action+'" data-id="'+e(id)+'" '+extra+' aria-current="'+(active ? 'page' : 'false')+'">'+e(label)+'</button>';
  bar.hidden = false;
  bar.innerHTML = '<div class="subcategory-folders">'+tab('全部', 'category', baseId, state.category === baseId && (!state.collection || state.collection === 'all'))+view.children.map(item => tab(item.name, 'category', item.id, view.firstSelected === item.id && (!state.collection || state.collection === 'all'))).join('')+
    '<button class="subcategory-add icon-button" data-action="add-root-subcategory" data-id="'+e(view.root?.id || '')+'" aria-label="新建子分类" title="'+(view.root ? '新建子分类' : '新建分类')+'">'+icon('plus',15)+'</button>'+
    '<span class="subcategory-divider"></span>'+tab('点赞', 'collection', '', state.collection === 'liked', 'data-collection="liked"')+tab('收藏', 'collection', '', state.collection === 'favorites', 'data-collection="favorites"')+
    (!view.root ? tab('未分类', 'category', 'uncategorized', state.category === 'uncategorized') : '')+'</div>';
  bar.querySelector('.subcategory-folders').scrollLeft = scroll;
  const deep = document.querySelector('#deepcategories');
  if (deep) {
    deep.hidden = view.path.length < 2;
    deep.innerHTML = view.path.length < 2 ? '' : '<span class="deepcategory-path">'+e(view.path.slice(1).map(x=>x.name).join(' / '))+'</span>'+ (view.path.length > 2 ? tab('上一级', 'category', view.path.at(-2).id, false) : '') + view.deeper.map(item => tab(item.name, 'category', item.id, false)).join('') + '<button class="text-button" data-action="add-subcategory">'+icon('plus',13)+'新建子分类</button>';
  }
}

export function renderGrid(state) {
  const focusedId = document.activeElement?.closest('.asset-card')?.dataset.asset;
  let matches = visibleAssets(state.snapshot.assets, mediaCategory(state.snapshot.categories, state.category), '', state.sort, state.snapshot.categories, state.typeScope || 'all', { hideChildCategories: state.hideChildCategories });
  matches = filterSceneAssets(matches, state.snapshot.sceneGroups, state.query);
  matches = collectionAssets(matches, state.collection);
  if (state.category === 'favorites' && state.favoriteCategory !== 'all') matches = matches.filter(asset => favoriteCategoryMatches(state.snapshot.categories, asset, state.favoriteCategory));
  const matchedCount = matches.length;
  matches = collapseSceneGroups(matches, state.snapshot.sceneGroups);
  const browse = resolveBrowseLayout(state.browsePreferences, state.browseViewport);
  // Measured capacity can change when selection or playback controls appear.
  // Only a different view resets the page; pageAssets clamps capacity changes.
  const view = [state.category, state.collection || 'all', state.favoriteCategory || 'all', state.typeScope || 'all', state.query, state.sort, !!state.hideChildCategories, browse.mode].join('\u0000');
  if (state.pageView !== view) { state.page = 0; state.pageView = view; }
  if (state.revealAssetId) {
    const index = matches.findIndex(asset => asset.id === state.revealAssetId || asset.sceneMemberIds?.includes(state.revealAssetId));
    if (index >= 0) state.page = Math.floor(index / browse.size);
    delete state.revealAssetId;
  }
  const pagination = pageAssets(matches, state.page || 0, browse.size);
  const assets = pagination.items;
  state.browseLayout = browse;
  state.browseTotal = matches.length;
  applyBrowseLayout(document.querySelector('#asset-grid'), browse);
  state.page = pagination.page; state.pages = pagination.pages;
  state.visible = assets.map(asset => asset.id);
  state.visibleSelection = assets.flatMap(asset => asset.sceneMemberIds || [asset.id]);
  state.visibleGroups = new Map(assets.filter(a => a.sceneGroup).map(a => [a.sceneGroup.id, a.sceneMemberIds]));
  document.querySelector('#asset-count').textContent = `${matchedCount} 个素材${matches.length !== matchedCount ? ' · ' + matches.length + ' 项' : ''}`;
  document.querySelector('#asset-grid').innerHTML = assets.map(asset => {
    if (asset.sceneGroup) return sceneGroupCard(asset, asset.sceneMemberIds.every(id => state.selected.has(id)));
    const selected = state.selected.has(asset.id), isAudio = assetMode(asset) === 'audio', isImage = asset.kind === 'image' || asset.assetType === 'image', status = isAudio || isImage ? 'ready' : previewState(asset);
    return `<article class="asset-card ${selected ? 'selected' : ''} ${isAudio ? 'audio-card' : ''}" data-asset="${e(asset.id)}" tabindex="0" aria-label="${e(filename(asset))}" aria-selected="${selected}">
      <div class="card-preview ${isAudio ? 'audio-card-preview' : 'checkerboard'}"><button class="preview-trigger" data-action="zoom-preview" data-id="${e(asset.id)}" title="${isAudio ? '查看音频详情并试听' : '点击放大预览'}" aria-label="${isAudio ? '查看详情' : '放大'}${e(filename(asset))}">${isAudio ? audioArt() : preview(asset)}</button><span class="format-badge">${e(format(asset))}${!isAudio && asset.previewFormat === 'gif' ? ' · GIF' : ''}</span><button class="favorite-button ${asset.favorite ? 'is-favorite' : ''}" data-action="favorite" data-id="${e(asset.id)}" aria-label="${asset.favorite ? '取消收藏' : '收藏'}${e(filename(asset))}" aria-pressed="${!!asset.favorite}">${icon('heart', 16)}</button><button class="like-button ${isLiked(asset) ? 'is-liked' : ''}" data-action="like" data-id="${e(asset.id)}" aria-label="${isLiked(asset) ? '取消点赞' : '点赞'}" aria-pressed="${isLiked(asset)}">${icon('like', 15)}</button><span class="zoom-hint">${icon(isAudio ? 'play' : 'zoom', 15)}</span><span class="selected-mark">${icon('check', 13)}</span>${!isAudio ? dragHandle(asset) : ''}</div>
      <div class="card-information"><div class="filename-row"><h3 title="${e(filename(asset))}">${e(filename(asset))}</h3><button class="reveal-button duplicate-button" data-action="duplicate-file" data-id="${e(asset.id)}" title="复制并加入素材库，可独立编辑" aria-label="复制并加入素材库：${e(filename(asset))}">${icon('copy', 14)}</button><button class="reveal-button" data-action="reveal-file" data-id="${e(asset.id)}" title="在文件夹中显示" aria-label="在文件夹中显示${e(filename(asset))}">${icon('folder', 14)}</button></div><div><span class="preview-origin ${status}">${isAudio ? '本地音频' : isImage ? '本地图片' : status === 'error' ? '预览失败' : status === 'pending' ? '生成中' : origin(asset)}</span><span>${isAudio ? formatTime(asset.duration) : isImage ? (asset.width && asset.height ? `${Number(asset.width)} × ${Number(asset.height)}` : '图片素材') : asset.frames ? `${Number(asset.frames)} 帧` : assetMode(asset) === 'effect' ? '特效素材' : 'AN 素材'}</span></div><div class="card-actions">${isAudio ? `${audioButton(asset)}${dragHandle(asset, 'card-action drag-handle audio-drag')}` : isImage ? `<button class="card-action" data-action="zoom-preview" data-id="${e(asset.id)}">${icon('zoom', 13)}查看图片</button><button class="card-action paste" data-action="send" data-id="${e(asset.id)}">${icon('arrow', 13)}导入 AN</button>` : `<button class="card-action open" data-action="open-animate" data-id="${e(asset.id)}">${icon('file', 13)}用 AN 打开</button><button class="card-action paste" data-action="send" data-id="${e(asset.id)}">${icon('arrow', 13)}粘贴到舞台</button>`}</div></div>
    </article>`;
  }).join('');
  const pager = document.querySelector('#asset-pagination');
  if (pager) {
    pager.hidden = pagination.pages <= 1;
    pager.innerHTML = `<button class="button secondary" data-action="previous-page" ${pagination.page ? '' : 'disabled'}>${icon('chevron', 13)}上一页</button><span>第 ${pagination.page + 1} / ${pagination.pages} 页<small>每页 ${pagination.size} 个 · 共 ${pagination.total} 个素材</small></span><button class="button secondary" data-action="next-page" ${pagination.page + 1 < pagination.pages ? '' : 'disabled'}>下一页${icon('chevron', 13)}</button>`;
  }
  const empty = document.querySelector('#empty-state');
  empty.hidden = assets.length !== 0;
  if (!assets.length) {
    const isLibraryEmpty = state.snapshot.assets.length === 0;
    empty.innerHTML = isLibraryEmpty ? `<div class="empty-art" aria-hidden="true"><div class="art-card back"></div><div class="art-card middle"></div><div class="art-card front"><span class="art-orbit"></span><span class="art-moon"></span><span class="art-star">✦</span><span class="art-label">YOUR NEXT FRAME</span></div><span class="art-spark spark-one">✦</span><span class="art-spark spark-two">+</span></div><span class="empty-kicker">让好素材，随时触手可及</span><h2>把你的 .fla 素材，放进安安。</h2><p>导入后自动生成预览，在这里挑选、整理，<br>再把喜欢的素材送进 Adobe Animate。</p><button class="button primary" data-action="import">${icon('upload', 18)}导入第一份素材</button><button class="text-button demo-button" data-action="demo">先用示例逛一逛 ${icon('arrow', 15)}</button>` : `<div class="empty-search">${icon(state.query ? 'search' : 'folder', 42)}</div><h2>${state.query ? '还没有找到这份灵感' : '这里还没有素材'}</h2><p>${state.query ? '试试其他名称或标签。' : state.category === 'liked' ? '点一下素材上的赞，暂存 24 小时。' : '选中素材后，点击分类即可收进这里。'}</p><button class="button secondary" data-action="${state.query ? 'clear-search' : 'home'}">${state.query ? '清除搜索' : '查看全部素材'}</button>`;
  }
  document.querySelector('#footer-summary').textContent = state.snapshot.assets.length ? `素材库共 ${state.snapshot.assets.length} 份素材 · 本地保存` : '你的素材，只在这台电脑上。';
  if (focusedId) document.querySelector(`.asset-card[data-asset="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
}

export function renderSelection(state) {
  const bar = document.querySelector('#selection-bar');
  const focused = document.activeElement;
  const focusedSearch = focused?.id === 'quick-category-filter' ? { start: focused.selectionStart, end: focused.selectionEnd } : null;
  const focusedAction = bar.contains(focused) && focused.matches('button[data-action]')
    ? { action: focused.dataset.action, id: focused.dataset.id } : null;
  bar.hidden = state.selected.size === 0;
  if (!state.selected.size) { state.quickCategoryParentId = null; state.quickCategorySelectionKey = ''; return; }
  const adding = state.quickCategoryMode === 'add';
  const removal = planRemoval(state), showLibraryRemoval = removal?.scope === 'category' || (!removal && !!planRemoval(state, true));
  const selectedAssets = state.snapshot.assets.filter(asset => state.selected.has(asset.id));
  const selectionKey = selectedAssets.map(asset => asset.id).sort().join('\u0000');
  if (state.quickCategorySelectionKey && state.quickCategorySelectionKey !== selectionKey) state.quickCategoryParentId = null;
  state.quickCategorySelectionKey = selectionKey;
  const modes = [...new Set(selectedAssets.map(assetMode))].sort().join(',');
  if (state.quickCategoryNavigation?.categories !== state.snapshot.categories || state.quickCategoryNavigation?.modes !== modes) {
    state.quickCategoryNavigation = { categories: state.snapshot.categories, modes,
      navigation: createCategoryAssignmentNavigation(state.snapshot.categories, modes.split(',')) };
  }
  const view = state.quickCategoryNavigation.navigation.browse(state.quickCategoryParentId, state.quickCategoryQuery);
  state.quickCategoryParentId = view.parentId;
  const categoryAction = adding ? 'add-to-category' : 'assign';
  const navigationHtml = `<div class="quick-category-path">${view.parentId ? `<button class="category-chip" data-action="quick-browse-back" data-id="${e(view.backId || '')}">${icon('chevron', 12)}上一级</button>` : ''}<span>${e(view.trail.map(item => item.label).join(' / ') || '顶层分类')}</span>${view.canSelectCurrent ? `<button class="category-chip" data-action="quick-select-current" data-id="${e(view.parentId)}">${adding ? '加入当前分类' : '归入当前分类'}</button>` : ''}</div>`;
  const optionsHtml = `${adding || view.parentId ? '' : '<button class="category-chip" data-action="assign" data-id="">未分类</button>'}${view.rows.map(item => `<button class="category-chip" data-action="${item.hasChildren || !item.canSelect ? 'quick-browse-category' : categoryAction}" data-id="${e(item.id)}" title="${item.hasChildren ? '打开子分类' : adding ? '加入这个分类' : '归入这个分类'}">${e(item.label)}${item.hasChildren ? icon('chevron', 12) : ''}</button>`).join('')}${view.rows.length ? '' : '<span class="field-hint">没有可用的子分类</span>'}<button class="category-chip add-category" data-action="create-quick-category" data-id="${e(view.parentId || '')}" title="${view.parentId ? '在当前分类下新建子分类' : '新建顶层分类'}">${icon('plus', 14)}</button>`;
  bar.innerHTML = `<div class="selection-title"><span class="selection-check">${icon('check', 14)}</span><strong>已选 ${state.selected.size} 项</strong><button class="text-button" data-action="deselect">取消</button><button class="text-button" data-action="toggle-quick-categories" aria-expanded="${!!state.quickCategories && !adding}" title="移到所选分类，替换原分类">${icon('folder', 13)}选择分类</button><button class="text-button" data-action="toggle-add-categories" aria-expanded="${!!state.quickCategories && adding}" title="保留原分类，让同一素材也出现在其他分类">${icon('plus', 13)}加入其他分类</button>${selectedAssets.length >= 2 && selectedAssets.every(a => a.kind === 'image') && !state.snapshot.sceneGroups?.some(g => g.assetIds.some(id => state.selected.has(id))) ? '<button class="text-button" data-action="create-scene-group">' + icon('folder',13) + '创建场景组合</button>' : ''}${state.selected.size === 1 ? `<button class="text-button" data-action="zoom-preview" data-id="${e([...state.selected][0])}">${icon('info', 13)}详情</button>` : ''}</div><div class="quick-categories" ${state.quickCategories ? '' : 'hidden'}><label class="quick-category-filter">${adding ? '加入到 · 保留原分类' : '移动到 · 替换原分类'}<input id="quick-category-filter" type="search" placeholder="查找分类…" aria-label="查找要归入的分类" value="${e(state.quickCategoryQuery || '')}"></label>${navigationHtml}<div class="quick-category-options">${optionsHtml}</div></div>${showLibraryRemoval ? '<button class="text-button" data-action="remove-library" title="从整个素材库移除，影响所有分类">从素材库移除</button>' : ''}<button class="text-button remove-selected" data-action="remove" title="${e(removal?.title || '当前选择不在这个分类中')}"${removal ? '' : ' disabled'}>${icon('trash', 15)}${e(removal?.buttonLabel || '从当前分类移除')}</button>`;
  if (focusedSearch) {
    const input = bar.querySelector?.('#quick-category-filter');
    input?.focus({ preventScroll: true });
    if (focusedSearch.start != null) input?.setSelectionRange(focusedSearch.start, focusedSearch.end);
  }
  if (focusedAction) Array.from(bar.querySelectorAll('button[data-action]'))
    .find(button => button.dataset.action === focusedAction.action && button.dataset.id === focusedAction.id && !button.disabled)
    ?.focus({ preventScroll: true });
}

export function renderInspector(state) {
  const inspector = document.querySelector('#inspector');
  if (inspector) { inspector.hidden = true; inspector.innerHTML = ''; }
  document.querySelector('.app-shell').classList.remove('has-inspector');
}

export function renderStatus(state) {
  const { queue = {}, bridge = {} } = state.snapshot;
  const connected = !!bridge.connected;
  const folderView = ['ordinary', 'effects', 'audio'].includes(state.category) || state.snapshot.categories.some(item => item.id === state.category);
  const filter = document.querySelector('#filter');
  if (filter) {
    const active = folderView && state.hideChildCategories;
    filter.classList.toggle('is-active', !!active);
    filter.querySelector('span:first-child').textContent = active ? '筛选 1' : '筛选';
    const option = document.querySelector('#filter-menu [data-filter="hide-child-categories"]');
    if (option) {
      option.disabled = !folderView;
      option.setAttribute('aria-checked', String(!!state.hideChildCategories));
      option.title = folderView ? '仅显示直接归在当前文件夹的素材' : '在普通、特效、音频或分类文件夹中使用';
    }
  }
  const detailConnection = document.querySelector('.detail-send[data-kind="fla"] p');
  if (detailConnection) detailConnection.textContent = connected ? '在 AN 面板点击「粘贴到舞台」' : 'AN 未连接 · 发送后会保留待处理';
  document.querySelector('#connection').classList.toggle('connected', connected);
  document.querySelector('#connection').setAttribute('aria-label', connected ? 'AN 已连接，查看连接设置' : 'AN 未连接，查看连接设置');
  document.querySelector('#connection').title = connected ? 'AN 已连接 · 查看连接设置' : 'AN 未连接 · 查看连接设置';
  document.querySelector('#connection').innerHTML = `<span class="status-dot"></span><span>${connected ? 'AN 已连接' : 'AN 未连接'}</span>`;
  document.querySelector('#sidebar-bridge').textContent = connected ? '已连接 · 可以接收素材' : '打开 AN 面板即可接收';
  const status = document.querySelector('#queue-status');
  const pending = Array.isArray(queue.pending) ? queue.pending.length : Number(queue.pending) || 0;
  const active = Array.isArray(queue.active) ? queue.active.length : Number(queue.active) || (queue.active ? 1 : 0);
  status.hidden = !(pending || active);
  status.innerHTML = `<span class="spinner"></span><span>正在整理预览${active ? ` · 生成中 ${active} 份` : ''}${pending ? ` · 等待 ${pending} 份` : ''}</span><small>你可以继续浏览素材</small>`;
  const transfer = document.querySelector('#bridge-status');
  transfer.hidden = !state.transferVisible || (!bridge.pending && !bridge.result);
  transfer.classList.toggle('transfer-error', !!bridge.result && !bridge.result.ok);
  transfer.innerHTML = bridge.pending ? `${icon('link', 15)}<span><strong>${e(bridge.pending.asset?.name || '素材')}</strong> · ${connected ? '已发送到 AN 面板，等待插入' : '待发送 · AN 未连接'}</span><button class="text-button" data-action="bridge-help">${connected ? '查看插入说明' : '如何连接'}</button>` : bridge.result ? `${icon(bridge.result.ok ? 'check' : 'alert', 15)}<span>${bridge.result.ok ? 'AN 面板已确认插入完成' : `AN 插入失败：${e(bridge.result.error || '请在 AN 面板检查并重试')}`}</span>` : '';
  const name = categoryName(state);
  const breadcrumb = document.querySelector('#breadcrumb');
  const trail = (['ordinary', 'effects', 'audio'].includes(state.category) || state.snapshot.categories.some(item => item.id === state.category))
    ? categoryTrail(state.snapshot.categories, state.category, state.typeScope || 'all') : [];
  breadcrumb.innerHTML = trail.length
    ? trail.map((item, index) => `${index ? `<span class="breadcrumb-separator" aria-hidden="true">${icon('chevron', 10)}</span>` : ''}<button class="breadcrumb-link ${index === trail.length - 1 ? 'current' : ''}" data-action="category" data-id="${e(item.id)}" ${index === trail.length - 1 ? 'aria-current="page"' : ''}>${e(item.name)}</button>`).join('')
    : `<span class="breadcrumb-current">${e(name)}</span>`;
  document.querySelector('#page-title').innerHTML = `${e(name)}<span class="heading-dot">.</span>`;
  document.querySelector('#page-description').textContent = ({ favorites: '长期收藏，随时回来取用。', liked: '临时喜欢，24 小时后自动退场。', uncategorized: '整理一下，让好素材各得其所。', all: '把灵感收好，让创作轻一点。', ordinary: '静态预览，快速挑选并送进 AN。', effects: '悬停播放动图，让每个特效一目了然。', audio: '点击试听，拖入剪映或 AN 使用。' })[state.category] || '包含这个分类与它的所有子分类。';
}
