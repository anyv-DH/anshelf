/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HEARTBEAT_MAX_AGE = 15000;
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function rejectLinks(file) {
  let current = path.resolve(file);
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('路径包含符号链接，不能发送到 AN');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function resolveManagedPath(root, value, folder) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.split(/[\\/]/).includes('..')) throw new Error('无效的素材路径');
  const candidate = path.resolve(root, value);
  if (!inside(path.resolve(root, folder), candidate)) throw new Error('素材路径不在受管理目录内');
  rejectLinks(candidate);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error('素材路径对应的文件不存在');
  const canonical = fs.realpathSync(candidate);
  if (!inside(fs.realpathSync(path.join(root, folder)), canonical)) throw new Error('素材路径超出受管理目录');
  return canonical;
}

function atomicWrite(file, value) {
  rejectLinks(file);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readJson(file) {
  try {
    rejectLinks(file);
    if (fs.statSync(file).size > 1024 * 1024) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) && value.version === 1 ? value : null;
  } catch { return null; }
}

class Bridge {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    rejectLinks(this.root);
    this.root = fs.realpathSync(this.root);
    this.directory = path.join(this.root, 'bridge');
    rejectLinks(this.directory);
    fs.mkdirSync(this.directory, { recursive: true });
    this.maxAge = options.maxAge ?? HEARTBEAT_MAX_AGE;
  }

  sendStageDrop(asset, target) {
    return this.send(asset, target);
  }

  send(asset, stageTarget = null) {
    if (!asset || typeof asset !== 'object' || typeof asset.hash !== 'string' || !/^[a-f0-9]{64}$/.test(asset.hash)) throw new Error('无效的素材 SHA256 hash');
    if (typeof asset.id !== 'string' || !/^[\w-]{1,128}$/.test(asset.id)) throw new Error('无效的素材 ID');
    if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 256) throw new Error('无效的素材名称');
    const sourcePath = resolveManagedPath(this.root, asset.managedPath, 'assets');
    if (path.extname(sourcePath).toLowerCase() !== '.fla') throw new Error('只能发送 FLA 素材');
    const previewPath = asset.previewPath ? resolveManagedPath(this.root, asset.previewPath, 'previews') : null;
    const request = {
      version: 1, requestId: crypto.randomUUID(), createdAt: Date.now(), managedRoot: this.root,
      asset: { id: asset.id, hash: asset.hash, name: asset.name.trim(), sourcePath, previewPath }
    };
    const receiver = this.status();
    if (receiver.connected && receiver.heartbeat.busy) throw new Error('AN 正在插入，请等待完成后再发送');
    if (stageTarget !== null) {
      if (!stageTarget || typeof stageTarget !== 'object' || !Number.isSafeInteger(stageTarget.documentId) || stageTarget.documentId < 0
          || !Number.isSafeInteger(stageTarget.pid) || stageTarget.pid <= 0 || !/^[1-9]\d*$/.test(stageTarget.hwnd || '')) throw new Error('舞台目标无效');
      if (!receiver.connected) throw new Error('AN 面板未连接或未就绪');
      if (receiver.heartbeat.capabilities?.stageDrop !== 1) throw new Error('请重新打开新版安安素材管理器 AN 面板');
      if (!Number.isSafeInteger(receiver.heartbeat.documentId) || receiver.heartbeat.documentId !== stageTarget.documentId
          || (receiver.heartbeat.pid != null && receiver.heartbeat.pid !== stageTarget.pid)) throw new Error('AN 目标文档已变化，请重新拖动');
      Object.assign(request, { delivery: 'stage-drop', expiresAt: request.createdAt + 5000, targetDocumentId: stageTarget.documentId });
    }
    atomicWrite(path.join(this.directory, 'pending.json'), request);
    const oldResult = path.join(this.directory, 'result.json');
    rejectLinks(oldResult);
    if (fs.existsSync(oldResult)) fs.unlinkSync(oldResult);
    return request;
  }

  status() {
    const heartbeat = readJson(path.join(this.directory, 'status.json'));
    const age = heartbeat ? Date.now() - Number(heartbeat.updatedAt) : Infinity;
    return {
      connected: Boolean(heartbeat && Number.isFinite(age) && age >= -5000 && age <= this.maxAge),
      lastSeen: heartbeat?.updatedAt || null, heartbeat,
      pending: readJson(path.join(this.directory, 'pending.json')),
      result: readJson(path.join(this.directory, 'result.json'))
    };
  }

  clear(requestId) {
    for (const name of ['pending.json', 'result.json']) {
      const file = path.join(this.directory, name);
      rejectLinks(file);
      if (requestId && readJson(file)?.requestId !== requestId) continue;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
}

module.exports = { Bridge, atomicWrite, resolveManagedPath, HEARTBEAT_MAX_AGE };
