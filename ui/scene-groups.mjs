/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { escapeHtml as e, assetFilename } from './model.js';
import { icon } from './icons.js';
export function filterSceneAssets(assets, groups = [], query = '') {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return assets;
  const names = new Map();
  for (const g of groups) for (const id of g.assetIds) names.set(id, g.name);
  return assets.filter(a => [a.name, a.originalName, ...(a.tags || []), names.get(a.id)].some(v => String(v || '').toLocaleLowerCase().includes(needle)));
}
export function collapseSceneGroups(assets, groups = []) {
  const byId = new Map(assets.map(a => [a.id, a])), memberships = new Map(), emitted = new Set(), result = [];
  for (const g of groups) for (const id of g.assetIds) memberships.set(id, g);
  for (const a of assets) {
    const g = memberships.get(a.id);
    if (!g) { result.push(a); continue; }
    if (emitted.has(g.id)) continue;
    emitted.add(g.id);
    const ids = g.assetIds.filter(id => byId.has(id));
    const cover = byId.get(g.coverAssetId) || byId.get(ids[0]);
    result.push({ ...cover, sceneGroup: g, sceneMemberIds: ids });
  }
  return result;
}
export function sceneGroupCard(entry, selected) {
  const g = entry.sceneGroup, count = entry.sceneMemberIds.length;
  return `<article class="asset-card scene-group-card ${selected ? 'selected' : ''}" data-asset="${e(entry.id)}" data-scene-group="${e(g.id)}" tabindex="0" aria-label="场景组合：${e(g.name)}" aria-selected="${selected}"><div class="card-preview checkerboard"><button class="preview-trigger" data-action="open-scene-group" data-id="${e(g.id)}" aria-label="打开组合 ${e(g.name)}"><img src="${e(entry.previewUrl || '')}" alt="${e(g.name)}组合封面" loading="lazy" draggable="false"></button><span class="format-badge">场景组合 · ${count} 张</span><span class="selected-mark">${icon('check', 13)}</span></div><div class="card-information"><div class="filename-row"><h3 title="${e(g.name)}">${e(g.name)}</h3></div><div><span class="preview-origin ready">图片组合</span><span>${count === g.assetIds.length ? count + ' 张图片' : '匹配 ' + count + ' / ' + g.assetIds.length + ' 张'}</span></div><div class="card-actions"><button class="card-action" data-action="open-scene-group" data-id="${e(g.id)}">${icon('folder', 13)}打开组合</button></div></div></article>`;
}
export function sceneGroupDialog(group, assets) {
  const byId = new Map(assets.map(a => [a.id, a]));
  return `<div class="dialog-heading"><div><div class="eyebrow">场景组合 · ${group.assetIds.length} 张图片</div><h2 id="dialog-title">${e(group.name)}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭组合">${icon('close', 19)}</button></div><div class="scene-group-toolbar"><label>组合名称<input id="scene-group-name" maxlength="100" value="${e(group.name)}" aria-label="组合名称"></label><button class="button secondary" data-action="rename-scene-group" data-id="${e(group.id)}">保存名称</button><button class="button secondary" data-action="pick-scene-members" data-id="${e(group.id)}">${icon('plus', 14)}添加图片</button><button class="text-button" data-action="undo-scene-group">撤销上次操作</button><button class="text-button" data-action="dissolve-scene-group" data-id="${e(group.id)}">解散组合</button></div><p class="dialog-copy">同一场景的图片放在一起，每张都可单独预览、拖出或导入 AN。</p><div class="scene-member-grid">${group.assetIds.map(id => {
    const a = byId.get(id); if (!a) return '';
    return `<article class="scene-member" data-scene-member="${e(id)}"><button class="scene-member-preview checkerboard" data-action="zoom-preview" data-id="${e(id)}" aria-label="预览 ${e(assetFilename(a))}"><img src="${e(a.previewUrl || '')}" alt="${e(assetFilename(a))}" draggable="false" loading="lazy"></button><strong title="${e(assetFilename(a))}">${e(assetFilename(a))}</strong><div class="scene-member-actions"><button class="button secondary" data-action="send" data-id="${e(id)}">导入 AN</button><span class="button secondary drag-handle" draggable="true" data-drag-id="${e(id)}">${icon('grip', 14)}拖出</span><button class="text-button" data-action="remove-scene-member" data-id="${e(id)}" data-group-id="${e(group.id)}">移出组合</button></div><button class="text-button" data-action="scene-cover" data-id="${e(id)}" data-group-id="${e(group.id)}" ${id === group.coverAssetId ? 'disabled' : ''}>${id === group.coverAssetId ? '当前封面' : '设为封面'}</button></article>`;
  }).join('')}</div>`;
}

export function mountSceneGroups({ document, getSnapshot, getSelected, run, refresh, closeDialog, toast, confirmation, onCreated, onError }) {
  const dialog = document.querySelector('#dialog'), content = document.querySelector('#dialog-content');
  let createIds = [];
  const groupById = id => (getSnapshot().sceneGroups || []).find(g => g.id === id);
  function show(html, groupId = '') {
    closeDialog(); content.innerHTML = html; content.dataset.sceneGroup = groupId;
    dialog.classList.add('scene-group-dialog'); dialog.showModal();
  }
  function open(id) {
    const group = groupById(id); if (!group) return;
    show(sceneGroupDialog(group, getSnapshot().assets), id);
  }
  function create() {
    createIds = [...getSelected()];
    show(`<div class="dialog-heading"><h2 id="dialog-title">创建场景组合</h2><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close',19)}</button></div><p class="dialog-copy">将已选的 ${createIds.length} 张图片归在一起，原分类及图片文件保持不变。</p><label class="dialog-label">组合名称<input id="scene-new-name" maxlength="100" placeholder="例如：客厅场景" autocomplete="off"></label><div class="dialog-actions"><button class="button secondary" data-action="close-dialog">取消</button><button class="button primary" data-action="save-scene-group">创建组合</button></div>`);
    content.querySelector('#scene-new-name').focus();
  }
  function picker(id) {
    const group = groupById(id); if (!group) return;
    const snapshot = getSnapshot(), occupied = new Set((snapshot.sceneGroups || []).flatMap(g => g.assetIds));
    const available = snapshot.assets.filter(a => a.kind === 'image' && !occupied.has(a.id));
    show(`<div class="dialog-heading"><h2 id="dialog-title">添加图片到「${e(group.name)}」</h2><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close',19)}</button></div><p class="dialog-copy">选择尚未加入其他组合的图片，最多 ${200 - group.assetIds.length} 张。</p><div class="scene-picker-list">${available.map(a => `<label class="scene-picker-row"><input type="checkbox" data-scene-pick="${e(a.id)}"><img src="${e(a.previewUrl || '')}" alt="" loading="lazy" draggable="false"><span>${e(assetFilename(a))}</span></label>`).join('') || '<p class="dialog-copy">没有可添加的图片，请先导入图片素材。</p>'}</div><div class="dialog-actions"><button class="button secondary" data-action="open-scene-group" data-id="${e(id)}">返回组合</button><button class="button primary" data-action="add-scene-members" data-id="${e(id)}" ${available.length ? '' : 'disabled'}>添加所选图片</button></div>`, id);
  }
  async function mutate(method, args, id, message) {
    await run(method, ...args); await refresh();
    if (dialog.open && content.dataset.sceneGroup === id) { if (groupById(id)) open(id); else closeDialog(); }
    toast(message, { action: 'undo-assign', label: '撤销' });
  }
  async function execute(action, target) {
    const id = target.dataset.id, g = groupById(target.dataset.groupId || id);
    if (action === 'open-scene-group') return open(id);
    if (action === 'create-scene-group') return create();
    if (action === 'undo-scene-group') { await run('undo'); await refresh(); return toast('已撤销上次操作'); }
    if (action === 'save-scene-group') {
      const input = content.querySelector('#scene-new-name'), name = input.value.trim();
      if (!name) return input.focus();
      const created = await run('createSceneGroup', name, createIds); await refresh(); onCreated?.();
      if (dialog.open && content.querySelector('#scene-new-name')) open(created.id);
      return toast('场景组合已创建');
    }
    if (!g) return;
    if (action === 'rename-scene-group') {
      const name = content.querySelector('#scene-group-name').value.trim();
      if (!name) return content.querySelector('#scene-group-name').focus();
      return mutate('updateSceneGroup', [id, { name }], id, '组合名称已保存');
    }
    if (action === 'pick-scene-members') return picker(id);
    if (action === 'add-scene-members') {
      const ids = [...content.querySelectorAll('[data-scene-pick]:checked')].map(el => el.dataset.scenePick);
      if (!ids.length) return toast('请先选择图片');
      return mutate('updateSceneGroup', [id, { assetIds: [...g.assetIds, ...ids] }], id, '图片已加入组合');
    }
    if (action === 'scene-cover') return mutate('updateSceneGroup', [g.id, { coverAssetId: id }], g.id, '组合封面已更新');
    if (action === 'remove-scene-member') {
      const ids = g.assetIds.filter(a => a !== id);
      return ids.length ? mutate('updateSceneGroup', [g.id, { assetIds: ids }], g.id, '图片已移出组合') : mutate('deleteSceneGroup', [g.id], g.id, '最后一张图片已移出，组合已解散');
    }
    if (action === 'dissolve-scene-group') {
      if (!await confirmation.ask({ title: '解散场景组合', message: '解散「' + g.name + '」后，图片仍保留在素材库和原分类中。', confirmLabel: '解散组合' })) return;
      return mutate('deleteSceneGroup', [id], id, '组合已解散，图片仍保留');
    }
  }
  const actions = new Set(['open-scene-group','create-scene-group','save-scene-group','rename-scene-group','pick-scene-members','add-scene-members','scene-cover','remove-scene-member','dissolve-scene-group','undo-scene-group']);
  return { open, sync() {
    const id = content.dataset.sceneGroup;
    if (!id || !dialog.open || !content.querySelector('.scene-member-grid') || content.contains(document.activeElement) && document.activeElement.matches('input')) return;
    const g = groupById(id);
    if (!g) { closeDialog(); return; }
    const grid = content.querySelector('.scene-member-grid');
    const template = document.createElement('template'); template.innerHTML = sceneGroupDialog(g, getSnapshot().assets);
    grid.innerHTML = template.content.querySelector('.scene-member-grid').innerHTML;
    content.querySelector('#dialog-title').textContent = g.name;
    content.querySelector('#scene-group-name').value = g.name;
    content.querySelector('.eyebrow').textContent = '场景组合 · ' + g.assetIds.length + ' 张图片';
  }, handle(action, target) { if (!actions.has(action)) return false; void execute(action, target).catch(onError); return true; } };
}
