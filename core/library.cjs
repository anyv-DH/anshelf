/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { insidePath, atomicJson, sha256, findSidecar, copySidecar, scanFla } = require('./files.cjs');
const { PREVIEW_RESOLUTIONS, normalizePreviewResolution } = require('./preview-resolution.cjs');
const { normalizeCategoryScopes, validateCategoryScopes, resolveCategoryScope, assertCategoryMoveScope } = require('./category-scope.cjs');

const DEFAULT_CATEGORIES = ['武器', '人物', '背景', '特效', '道具'];
const LIKE_DURATION_MS = 24 * 60 * 60 * 1000;
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac'];
const EDITABLE_FIELDS = new Set(['name', 'tags', 'favorite', 'categoryId', 'liked']);
const PREVIEW_FIELDS = new Set(['previewPath', 'previewPosterPath', 'previewStatus', 'previewError', 'width', 'height', 'frames', 'frameRate', 'scene', 'frame', 'previewOrigin', 'previewFormat', 'previewAnimated', 'previewFrameCount', 'previewDurationMs', 'previewWarning']);
const clone = (value) => structuredClone(value);

function assetCategoryIds(asset) {
  return [...new Set([asset.categoryId, ...(asset.categoryIds || [])].filter(Boolean))];
}

function setAssetCategories(asset, ids) {
  asset.categoryIds = [...new Set(ids)];
  asset.categoryId = asset.categoryIds[0] || null;
}

function checkAssetCategory(state, asset, id) {
  checkCategory(state, id);
  const target = state.categories.find(item => item.id === id);
  if (target && target.scope !== 'all' && target.scope !== (asset.assetType || 'ordinary')) throw new Error('素材类型与分类类型不匹配');
}

function isLiked(asset, now = Date.now()) {
  const likedAt = typeof asset?.likedAt === 'string' ? Date.parse(asset.likedAt) : NaN;
  return Number.isFinite(likedAt) && likedAt <= now && now - likedAt < LIKE_DURATION_MS;
}

function assetSnapshot(asset, now = Date.now()) {
  return { ...asset, likedAt: asset.likedAt ?? null, liked: isLiked(asset, now) };
}

function setLiked(asset, liked, now = Date.now()) {
  if (!liked) asset.likedAt = null;
  else if (!isLiked(asset, now)) asset.likedAt = new Date(now).toISOString();
}

function cleanName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw new Error('名称须为 1–200 个字符');
  return value.trim();
}

function findAsset(state, id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) throw new Error('素材不存在');
  return asset;
}

function checkCategory(state, id) {
  if (id !== null && !state.categories.some((category) => category.id === id)) throw new Error('分类不存在');
}

function categoryDescendantIds(categories, id) {
  if (!categories.some(category => category.id === id)) return [];
  const children = new Map();
  for (const category of categories) {
    const parentId = category.parentId ?? null;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(category.id);
  }
  const result = [id];
  const visited = new Set(result);
  for (let i = 0; i < result.length; i++) for (const child of children.get(result[i]) ?? []) {
    if (!visited.has(child)) {
      visited.add(child);
      result.push(child);
    }
  }
  return result;
}

function normalizeState(state) {
  normalizeCategoryScopes(state.categories);
  for (const category of state.categories) { category.parentId ??= null; category.pinned ??= false; }
  const knownCategories = new Set(state.categories.map(category => category.id));
  for (const asset of state.assets) {
    setAssetCategories(asset, assetCategoryIds(asset).filter(id => knownCategories.has(id)));
    asset.likedAt ??= null; asset.kind ??= 'fla'; asset.assetType ??= 'ordinary';
    asset.extension ??= '.fla'; asset.previewAnimated ??= false;
    asset.previewResolution = normalizePreviewResolution(asset.previewResolution);
    asset.previewFormat ??= asset.previewPath ? path.extname(asset.previewPath).slice(1).toLowerCase() : null;
  }
}

function checkCategoryName(state, name, parentId, exceptId) {
  if (state.categories.some(category => category.id !== exceptId && category.parentId === parentId && category.name === name)) {
    throw new Error('同一父级的分类名称已存在');
  }
}

function historyChanges(before, after) {
  const changes = [];
  for (const collection of ['assets', 'categories']) {
    const oldItems = new Map(before[collection].map((item) => [item.id, item]));
    const newItems = new Map(after[collection].map((item) => [item.id, item]));
    for (const id of new Set([...oldItems.keys(), ...newItems.keys()])) {
      const oldItem = oldItems.get(id);
      const newItem = newItems.get(id);
      if (JSON.stringify(oldItem) === JSON.stringify(newItem)) continue;
      if (!oldItem || !newItem) {
        changes.push({ collection, id, before: oldItem ?? null, after: newItem ?? null,
          index: oldItem ? before[collection].findIndex((item) => item.id === id) : newItems.size });
      } else {
        const previous = {};
        for (const key of new Set([...Object.keys(oldItem), ...Object.keys(newItem)])) {
          if (JSON.stringify(oldItem[key]) !== JSON.stringify(newItem[key])) previous[key] = oldItem[key];
        }
        changes.push({ collection, id, previous });
      }
    }
  }
  return changes;
}

function validateState(state, root) {
  if (state.version !== 1 || !Array.isArray(state.assets) || !Array.isArray(state.categories) || !Array.isArray(state.history)) {
    throw new Error('素材库元数据格式无效，请先备份并检查 library.json');
  }
  for (const asset of state.assets) {
    if (!asset || typeof asset.id !== 'string' || !/^[a-f0-9]{64}$/.test(asset.hash)
      || !Array.isArray(asset.sourcePaths) || !Array.isArray(asset.tags)) throw new Error('素材记录格式无效');
    insidePath(root, asset.managedPath);
    if (asset.previewPath) insidePath(root, asset.previewPath);
    if (asset.previewPosterPath) insidePath(root, asset.previewPosterPath);
    if (asset.kind != null && !['fla', 'audio'].includes(asset.kind)) throw new Error('无效的素材类型');
    if (asset.assetType != null && !['ordinary', 'effect', 'audio'].includes(asset.assetType)) throw new Error('无效的素材导入类型');
    if (asset.kind === 'audio' && (!AUDIO_EXTENSIONS.includes(asset.extension) || asset.assetType !== 'audio')) throw new Error('无效的音频素材记录');
    if (asset.categoryIds != null && (!Array.isArray(asset.categoryIds) || asset.categoryIds.some(id => typeof id !== 'string' || !id))) throw new Error('素材分类列表无效');
    normalizePreviewResolution(asset.previewResolution);
  }
  const ids = new Set();
  for (const category of state.categories) {
    if (!category || typeof category.id !== 'string' || !category.id || ids.has(category.id)
      || typeof category.name !== 'string' || !category.name.trim() || category.name.length > 200
      || (category.parentId != null && typeof category.parentId !== 'string')
      || (category.pinned != null && typeof category.pinned !== 'boolean')) throw new Error('分类记录格式无效');
    ids.add(category.id);
  }
  for (const category of state.categories) {
    const ancestors = new Set([category.id]);
    let parentId = category.parentId ?? null;
    while (parentId !== null) {
      if (!ids.has(parentId)) throw new Error('分类父级不存在');
      if (ancestors.has(parentId)) throw new Error('分类父级存在循环');
      ancestors.add(parentId);
      parentId = state.categories.find(item => item.id === parentId).parentId ?? null;
    }
  }
  validateCategoryScopes(state.categories);
}

class Library {
  static async open(root) {
    if (typeof root !== 'string' || !root.trim()) throw new Error('素材库路径不能为空');
    const absolute = path.resolve(root);
    await fs.mkdir(absolute, { recursive: true });
    await fs.mkdir(path.join(absolute, 'assets'), { recursive: true });
    await fs.mkdir(path.join(absolute, 'previews'), { recursive: true });
    let state;
    try {
      state = JSON.parse(await fs.readFile(path.join(absolute, 'library.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { version: 1, assets: [], categories: DEFAULT_CATEGORIES.map((name) => ({ id: randomUUID(), name, parentId: null })), history: [] };
      await atomicJson(path.join(absolute, 'library.json'), state);
    }
    validateState(state, absolute);
    normalizeState(state);
    return new Library(absolute, state);
  }

  constructor(root, state) {
    this.root = root;
    this.state = state;
    this.revision = 0;
    this.queue = Promise.resolve();
  }

  snapshot() {
    const now = Date.now();
    return clone({ assets: this.state.assets.map(asset => assetSnapshot(asset, now)), categories: this.state.categories });
  }

  getAsset(id) {
    const asset = this.state.assets.find((item) => item.id === id);
    return asset ? clone(assetSnapshot(asset)) : null;
  }

  assetPath(id) {
    return insidePath(this.root, findAsset(this.state, id).managedPath);
  }

  previewPath(id) {
    const asset = findAsset(this.state, id);
    return asset.previewPath ? insidePath(this.root, asset.previewPath) : null;
  }

  change(operation, undoable = true) {
    const pending = this.queue.then(async () => {
      const next = clone(this.state);
      const result = await operation(next);
      const changes = historyChanges(this.state, next);
      if (changes.length || JSON.stringify(next.history) !== JSON.stringify(this.state.history)) {
        if (undoable && changes.length) next.history = [...next.history.slice(-49), changes];
        await atomicJson(path.join(this.root, 'library.json'), next);
        this.state = next;
        this.revision++;
      }
      return clone(result);
    });
    this.queue = pending.catch(() => {});
    return pending;
  }

  importPaths(paths, { preferExistingPreview = true, mode = 'ordinary', previewResolution = null, categoryId = undefined } = {}) {
    return this.change(async (state) => {
      if (!['ordinary', 'effect', 'audio'].includes(mode)) throw new Error('导入类型无效');
      if (categoryId !== undefined) {
        checkCategory(state, categoryId);
        if (categoryId !== null) {
          const target = state.categories.find((category) => category.id === categoryId);
          const scope = target?.scope || 'all';
          if (scope !== 'all' && scope !== mode) throw new Error(`“${target.name}”是${scope === 'effect' ? '特效' : scope === 'audio' ? '音频' : '普通'}素材分类，不能放入${mode === 'effect' ? '特效' : mode === 'audio' ? '音频' : '普通'}素材`);
        }
      }
      const resolution = normalizePreviewResolution(previewResolution);
      const kind = mode === 'audio' ? 'audio' : 'fla';
      if (!Array.isArray(paths) || paths.some((filename) => typeof filename !== 'string' || !filename.trim())) {
        throw new Error('导入路径须为文件或文件夹路径列表');
      }
      const result = { added: 0, duplicates: 0, failed: [], assets: [] };
      const visited = new Set();
      const changed = new Map();
      const fail = (filename, error) => result.failed.push({ path: filename, error: error.message || String(error) });
      const visit = async (source) => {
        const key = process.platform === 'win32' ? source.toLowerCase() : source;
        if (visited.has(key)) return;
        visited.add(key);
        const sidecar = kind === 'fla' && preferExistingPreview
          ? await findSidecar(source, mode === 'effect' ? ['.gif', '.png', '.jpg', '.jpeg', '.webp'] : undefined) : null;
        if (sidecar && (await fs.stat(sidecar)).size > 50 * 1024 * 1024) throw new Error('预览图不能超过 50 MB');
        const temporary = path.join(this.root, 'assets', `${randomUUID()}.tmp`);
        try {
          await fs.copyFile(source, temporary);
          const hash = await sha256(temporary);
          let asset = state.assets.find((item) => item.hash === hash && item.kind === kind);
          const isNew = !asset;
          if (!asset) {
            const originalName = path.basename(source);
            asset = { id: randomUUID(), hash, name: path.parse(source).name, originalName,
              kind, assetType: mode, extension: path.extname(source).toLowerCase(), previewResolution: kind === 'fla' ? resolution : null,
              sourcePaths: [], managedPath: `assets/${hash}${path.extname(source).toLowerCase()}`, previewPath: null,
              previewStatus: kind === 'audio' ? 'none' : 'pending', previewError: null, categoryId: categoryId ?? null, categoryIds: categoryId ? [categoryId] : [], tags: [], favorite: false, likedAt: null,
              createdAt: new Date().toISOString(), width: null, height: null, frames: null, previewOrigin: null, previewFormat: null };
            await fs.rename(temporary, insidePath(this.root, asset.managedPath));
          }
          const typeChanged = kind === 'fla' && asset.assetType !== mode;
          if (typeChanged) asset.assetType = mode;
          const resolutionChanged = kind === 'fla' && (asset.previewResolution ?? null) !== resolution;
          if (kind === 'fla') asset.previewResolution = resolution;
          // A later import may provide a same-stem preview for an existing
          // rendered asset. Prefer that explicit user preview whenever the
          // option is enabled, including duplicate-byte imports.
          if (sidecar) {
            const revision = randomUUID();
            const relative = `previews/${hash}-sidecar-${revision}${path.extname(sidecar).toLowerCase()}`;
            await copySidecar(sidecar, insidePath(this.root, relative));
            Object.assign(asset, { previewPath: relative, previewPosterPath: null, previewStatus: 'ready', previewError: null, previewOrigin: 'sidecar', previewRevision: revision,
              previewFormat: path.extname(sidecar).slice(1).toLowerCase(), previewAnimated: path.extname(sidecar).toLowerCase() === '.gif', previewWarning: null,
              previewFrameCount: null, previewDurationMs: null, frameRate: null, scene: null, frame: null, width: null, height: null, frames: null });
          } else if (kind === 'fla' && (!preferExistingPreview || typeChanged
            || (resolutionChanged && asset.previewOrigin !== 'sidecar'))) {
            Object.assign(asset, { previewPath: null, previewStatus: 'pending', previewError: null, previewOrigin: null,
              previewPosterPath: null, previewFormat: null, previewAnimated: false, previewWarning: null, previewRevision: randomUUID(),
              previewFrameCount: null, previewDurationMs: null, frameRate: null, scene: null, frame: null, width: null, height: null, frames: null });
          }
          asset.previewAnimated ??= false;
          if (!asset.sourcePaths.includes(source)) asset.sourcePaths.push(source);
          // Assign only successfully imported assets. An omitted destination
          // preserves the classification of an existing duplicate.
          if (categoryId !== undefined) setAssetCategories(asset, categoryId ? [categoryId] : []);
          if (isNew) {
            state.assets.push(asset);
            result.added++;
          } else result.duplicates++;
          changed.set(asset.id, asset);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      };
      for (const filename of paths) await scanFla(filename, visit, fail, this.root, kind === 'audio' ? AUDIO_EXTENSIONS : ['.fla']);
      result.assets = [...changed.values()];
      return result;
    }, false);
  }

  assignCategory(ids, id) {
    return this.change((state) => {
      checkCategory(state, id);
      if (!Array.isArray(ids)) throw new Error('请提供素材 ID 列表');
      const assets = [...new Set(ids)].map((assetId) => findAsset(state, assetId));
      for (const asset of assets) setAssetCategories(asset, id ? [id] : []);
      return assets;
    });
  }

  addToCategory(ids, id) {
    return this.change(state => {
      if (!id) throw new Error('请选择要加入的分类');
      checkCategory(state, id);
      if (!Array.isArray(ids)) throw new Error('请提供素材 ID 列表');
      const assets = [...new Set(ids)].map(assetId => findAsset(state, assetId));
      for (const asset of assets) { checkAssetCategory(state, asset, id); setAssetCategories(asset, [...assetCategoryIds(asset), id]); }
      return assets;
    });
  }

  removeFromCategory(ids, id) {
    return this.change(state => {
      checkCategory(state, id);
      if (!Array.isArray(ids)) throw new Error('请提供素材 ID 列表');
      const assets = [...new Set(ids)].map(assetId => findAsset(state, assetId));
      for (const asset of assets) setAssetCategories(asset, assetCategoryIds(asset).filter(value => value !== id));
      return assets;
    });
  }

  createCategory(name, parentId = null, scope = 'all') {
    return this.change((state) => {
      const clean = cleanName(name);
      checkCategory(state, parentId);
      const categoryScope = resolveCategoryScope(state.categories, parentId, scope);
      checkCategoryName(state, clean, parentId);
      const category = { id: randomUUID(), name: clean, parentId, pinned: false, scope: categoryScope };
      state.categories.push(category);
      return category;
    });
  }

  renameCategory(id, name, parentId) {
    return this.change((state) => {
      checkCategory(state, id);
      const category = state.categories.find((item) => item.id === id);
      if (!category) throw new Error('分类不存在');
      const clean = cleanName(name);
      const nextParentId = parentId === undefined ? category.parentId : parentId;
      checkCategory(state, nextParentId);
      assertCategoryMoveScope(state.categories, category, nextParentId);
      if (categoryDescendantIds(state.categories, id).includes(nextParentId)) throw new Error('分类不能移动到自身或子分类，避免循环');
      checkCategoryName(state, clean, nextParentId, id);
      category.name = clean;
      category.parentId = nextParentId;
      return category;
    });
  }

  setCategoryPinned(id, pinned) {
    return this.change(state => {
      if (typeof pinned !== 'boolean') throw new Error('置顶须为布尔值');
      const category = state.categories.find(item => item.id === id);
      if (!category) throw new Error('分类不存在');
      category.pinned = pinned;
      return category;
    });
  }

  deleteCategory(id) {
    return this.change((state) => {
      checkCategory(state, id);
      const deleted = state.categories.find(category => category.id === id);
      if (!deleted) throw new Error('分类不存在');
      const children = state.categories.filter(category => category.parentId === id);
      const occupiedNames = new Set(state.categories.filter(category => category.id !== id && category.parentId === deleted.parentId).map(category => category.name));
      const childNames = new Set(children.map(category => category.name));
      for (const child of children) {
        const originalName = child.name;
        let name = originalName;
        let number = 2;
        while (occupiedNames.has(name) || (name !== originalName && childNames.has(name))) {
          const suffix = `（${number++}）`;
          name = originalName.slice(0, 200 - suffix.length) + suffix;
        }
        child.name = name;
        child.parentId = deleted.parentId;
        occupiedNames.add(name);
      }
      state.categories = state.categories.filter((category) => category.id !== id);
      for (const asset of state.assets) if (assetCategoryIds(asset).includes(id)) setAssetCategories(asset, assetCategoryIds(asset).filter(value => value !== id));
      return true;
    });
  }

  updateAsset(id, patch) {
    return this.change((state) => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some((key) => !EDITABLE_FIELDS.has(key))) throw new Error('素材 patch 含不可修改的字段');
      const asset = findAsset(state, id);
      if ('name' in patch) asset.name = cleanName(patch.name);
      if ('tags' in patch) {
        if (!Array.isArray(patch.tags) || patch.tags.length > 100 || patch.tags.some((tag) => typeof tag !== 'string' || tag.length > 200)) {
          throw new Error('标签须为最多 100 个文本标签');
        }
        asset.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))];
      }
      if ('favorite' in patch) {
        if (typeof patch.favorite !== 'boolean') throw new Error('收藏须为布尔值');
        asset.favorite = patch.favorite;
      }
      if ('liked' in patch) {
        if (typeof patch.liked !== 'boolean') throw new Error('点赞须为布尔值');
        setLiked(asset, patch.liked);
      }
      if ('categoryId' in patch) {
        checkCategory(state, patch.categoryId);
        setAssetCategories(asset, patch.categoryId ? [patch.categoryId] : []);
      }
      return assetSnapshot(asset);
    });
  }

  toggleLike(id) {
    return this.change(state => {
      const asset = findAsset(state, id);
      const now = Date.now();
      setLiked(asset, !isLiked(asset, now), now);
      return assetSnapshot(asset, now);
    });
  }

  removeAssets(ids) {
    return this.change((state) => {
      if (!Array.isArray(ids)) throw new Error('请提供素材 ID 列表');
      const selected = new Set(ids);
      const removed = state.assets.filter((asset) => selected.has(asset.id));
      state.assets = state.assets.filter((asset) => !selected.has(asset.id));
      return removed.length;
    });
  }

  setPreview(id, patch, expectedRevision) {
    return this.change((state) => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some((key) => !PREVIEW_FIELDS.has(key))) throw new Error('无效的预览 patch 字段');
      if (patch.previewPath != null) insidePath(this.root, patch.previewPath);
      if (patch.previewPosterPath != null) insidePath(this.root, patch.previewPosterPath);
      if ('previewStatus' in patch && !['pending', 'ready', 'failed'].includes(patch.previewStatus)) throw new Error('无效的预览状态');
      if ('previewOrigin' in patch && ![null, 'sidecar', 'rendered'].includes(patch.previewOrigin)) throw new Error('无效的预览来源');
      for (const key of ['width', 'height', 'frames', 'frameRate', 'scene', 'frame', 'previewFrameCount', 'previewDurationMs']) {
        if (key in patch && patch[key] !== null && (!Number.isFinite(patch[key]) || patch[key] < 0)) throw new Error('无效的预览尺寸或帧数');
      }
      if ('previewError' in patch && patch.previewError !== null && typeof patch.previewError !== 'string') throw new Error('无效的预览错误信息');
      if ('previewAnimated' in patch && typeof patch.previewAnimated !== 'boolean') throw new Error('无效的动画预览标志');
      if ('previewFormat' in patch && ![null, 'png', 'gif', 'jpg', 'jpeg', 'webp'].includes(patch.previewFormat)) throw new Error('无效的预览格式');
      if ('previewWarning' in patch && patch.previewWarning !== null && typeof patch.previewWarning !== 'string') throw new Error('无效的预览提示');
      const asset = findAsset(state, id);
      // Explicit null also guards legacy/new pending assets without a token.
      if (expectedRevision !== undefined && (asset.previewRevision ?? null) !== expectedRevision) return asset;
      Object.assign(asset, patch);
      if (patch.previewStatus === 'ready') asset.previewRevision = randomUUID();
      return asset;
    }, false);
  }

  undo() {
    return this.change((state) => {
      const changes = state.history.pop();
      if (!changes) return false;
      for (const change of changes) {
        const items = state[change.collection];
        const index = items.findIndex((item) => item.id === change.id);
        if (change.previous) {
          if (index >= 0) {
            Object.assign(items[index], change.previous);
            // Version-one undo records knew only the primary assignment.
            if (change.collection === 'assets' && Object.hasOwn(change.previous, 'categoryId') && !Object.hasOwn(change.previous, 'categoryIds')) setAssetCategories(items[index], change.previous.categoryId ? [change.previous.categoryId] : []);
          }
        } else if (change.before === null) {
          if (index >= 0) items.splice(index, 1);
        } else {
          if (index >= 0) items[index] = change.before;
          else items.splice(Math.max(0, Math.min(change.index ?? items.length, items.length)), 0, change.before);
        }
      }
      normalizeState(state);
      return true;
    }, false);
  }
}

function filterAssets(assets, { query = '', categoryId, categories, favorites = false, likes = false, now = Date.now(), sort = 'newest' } = {}) {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const categoryIds = categories ? new Set(categoryDescendantIds(categories, categoryId)) : new Set([categoryId]);
  const filtered = assets.filter((asset) => {
    const haystack = `${asset.name} ${(asset.tags ?? []).join(' ')}`.toLocaleLowerCase();
    const categoryMatches = categoryId === undefined || categoryId === null || categoryId === 'all'
      || (['uncategorized', '__uncategorized__'].includes(categoryId) ? assetCategoryIds(asset).length === 0 : assetCategoryIds(asset).some(id => categoryIds.has(id)));
    return categoryMatches && (!favorites || asset.favorite) && (!likes || isLiked(asset, now)) && words.every((word) => haystack.includes(word));
  });
  const dateOrder = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
  const nameOrder = (a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true });
  if (['name', 'name-asc'].includes(sort)) filtered.sort(nameOrder);
  else if (sort === 'name-desc') filtered.sort((a, b) => nameOrder(b, a));
  else if (['oldest', 'created-asc'].includes(sort)) filtered.sort((a, b) => dateOrder(b, a));
  else filtered.sort(dateOrder);
  return filtered;
}

module.exports = { Library, filterAssets, findSidecar, categoryDescendantIds, assetCategoryIds, isLiked, LIKE_DURATION_MS, AUDIO_EXTENSIONS, normalizePreviewResolution, PREVIEW_RESOLUTIONS };
