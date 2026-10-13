/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MAX_FLA_BYTES = 512 * 1024 * 1024;
const DRAG_TTL_MS = 5 * 60 * 1000;
const STAGE_DROP_TTL_MS = 5000;

function validDocumentId(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateDelivery(request, now) {
  if (request.delivery === undefined) {
    if (request.expiresAt !== undefined || request.targetDocumentId !== undefined) throw new Error('舞台拖拽请求缺少传递方式');
    return;
  }
  if (request.delivery !== 'stage-drop' || !validDocumentId(request.targetDocumentId)
    || !Number.isSafeInteger(request.createdAt) || !Number.isSafeInteger(request.expiresAt)
    || request.createdAt < 0 || request.expiresAt !== request.createdAt + STAGE_DROP_TTL_MS) throw new Error('舞台拖拽目标文档或请求时效无效');
  if (now !== undefined && (request.createdAt > now + 1000 || request.expiresAt <= now)) throw new Error('舞台拖拽请求已过期，请重新拖入');
}

function noLinks(value) {
  let cursor = path.resolve(value);
  while (true) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('路径包含符号链接');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function localURI(file) {
  return 'file:///' + file.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1|').split('/').map((part, i) => i === 0 ? part : encodeURIComponent(part)).join('/');
}

class Queue {
  constructor(root) {
    this.root = path.resolve(root);
    noLinks(this.root);
    noLinks(path.join(this.root, 'bridge'));
    fs.mkdirSync(path.join(this.root, 'bridge'), { recursive: true });
    this.root = fs.realpathSync(this.root);
  }
  file(name) { return path.join(this.root, 'bridge', name); }
  read(name) {
    const file = this.file(name);
    noLinks(file);
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > 65536) throw new Error('素材请求过大');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && value.version === 1 ? value : null;
  }
  atomic(name, value) {
    const target = this.file(name), temporary = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    noLinks(target);
    try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' }); fs.renameSync(temporary, target); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  requireInside(value, folder) {
    if (typeof value !== 'string' || value.includes('\0') || value.split(/[\\/]/).includes('..')) throw new Error('无效的素材路径');
    const candidate = path.resolve(value), base = path.resolve(this.root, folder), rel = path.relative(base, candidate);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('素材路径超出受管理目录');
    noLinks(candidate);
    return candidate;
  }
  validate(request) {
    if (!request || request.version !== 1 || !/^[a-zA-Z0-9-]{1,80}$/.test(request.requestId || '') || !request.asset || !/^[a-f0-9]{64}$/.test(request.asset.hash || '')) throw new Error('无效的素材请求');
    validateDelivery(request);
    if (path.resolve(request.managedRoot || '') !== this.root) throw new Error('素材库根目录不匹配');
    const source = this.requireInside(request.asset.sourcePath, 'assets');
    if (path.extname(source).toLowerCase() !== '.fla' || !fs.statSync(source).isFile()) throw new Error('只能插入本地 FLA');
    return source;
  }
  pending() {
    const request = this.read('pending.json');
    if (request) this.validate(request);
    return request;
  }
  acceptDrop(marker, name, now = Date.now()) {
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)
      || Object.keys(marker).sort().join(',') !== 'expiresAt,requestId,type,version'
      || marker.type !== 'anshelf-transfer' || marker.version !== 1
      || !/^[a-zA-Z0-9-]{1,80}$/.test(marker.requestId || '')
      || name !== marker.requestId + '.anshelf-transfer'
      || !Number.isFinite(marker.expiresAt) || marker.expiresAt <= now || marker.expiresAt > now + DRAG_TTL_MS + 5000) throw new Error('拖拽传递标记无效或已过期，请重新从管理器拖出');
    const request = this.pending();
    if (!request || request.requestId !== marker.requestId || !Number.isFinite(request.createdAt)
      || request.createdAt > now + 5000 || now - request.createdAt >= DRAG_TTL_MS
      || marker.expiresAt > request.createdAt + DRAG_TTL_MS + 5000) throw new Error('拖拽请求已失效，请重新从管理器拖出');
    const file = this.requireInside(this.file(path.join('drag', name)), 'bridge/drag');
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > 4096) throw new Error('拖拽传递标记无效');
    const managed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!managed || Object.keys(managed).sort().join(',') !== 'expiresAt,requestId,type,version'
      || managed.type !== marker.type || managed.version !== marker.version
      || managed.requestId !== marker.requestId || managed.expiresAt !== marker.expiresAt) throw new Error('拖拽传递标记与素材库不匹配');
    return request;
  }
  heartbeat(busy, documentId = null) {
    this.atomic('status.json', { version: 1, updatedAt: Date.now(), app: 'Animate', busy: Boolean(busy), capabilities: { stageDrop: 1 }, documentId: validDocumentId(documentId) ? documentId : null });
  }
  prepare(request) {
    const source = this.validate(request);
    validateDelivery(request, Date.now());
    if (fs.statSync(source).size > MAX_FLA_BYTES) throw new Error('素材 FLA 过大，当前插入上限为 512 MB');
    const bytes = fs.readFileSync(source);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== request.asset.hash) throw new Error('素材哈希不匹配，不能插入');
    const temporary = this.file(path.join('temp', request.requestId + '.fla'));
    this.requireInside(temporary, 'bridge/temp');
    fs.mkdirSync(path.dirname(temporary), { recursive: true });
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    const prepared = { version: 1, requestId: request.requestId, managedRoot: localURI(this.root), asset: { id: request.asset.id, hash: request.asset.hash, name: request.asset.name, sourceURI: localURI(source) }, temporaryURI: localURI(temporary), temporaryPath: temporary };
    if (request.delivery === 'stage-drop') Object.assign(prepared, { delivery: request.delivery, createdAt: request.createdAt, expiresAt: request.expiresAt, targetDocumentId: request.targetDocumentId });
    return prepared;
  }
  complete(request, result) {
    const stored = { version: 1, requestId: request.requestId, completedAt: Date.now(), ok: result.ok === true, error: result.error || null, message: result.message || null, warning: result.warning || null, reused: Boolean(result.reused), sceneCount: result.sceneCount || null, frameCount: result.frameCount || null, rootSymbol: result.rootSymbol || null };
    this.atomic('result.json', stored);
    const pending = this.read('pending.json');
    if (pending && pending.requestId === request.requestId) fs.unlinkSync(this.file('pending.json'));
    const marker = this.requireInside(this.file(path.join('drag', request.requestId + '.anshelf-transfer')), 'bridge/drag');
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
  }
  cleanup(file) { this.requireInside(file, 'bridge/temp'); if (fs.existsSync(file)) fs.unlinkSync(file); }
}

module.exports = { Queue, localURI, MAX_FLA_BYTES, DRAG_TTL_MS, STAGE_DROP_TTL_MS };
