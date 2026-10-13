/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { resolveManagedPath } = require('../core/bridge.cjs');
const AUDIO_MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };

function byteRange(value, size) {
  if (value === null) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

async function createMediaResponse(request, library) {
  try {
    const url = new URL(request.url), id = decodeURIComponent(url.pathname.slice(1));
    if (url.protocol !== 'anshelf:' || url.hostname !== 'media' || !/^[\w-]{1,128}$/.test(id)) return new Response('', { status: 404 });
    const method = request.method || 'GET';
    if (!['GET', 'HEAD'].includes(method)) return new Response('', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const asset = library.getAsset(id);
    if (!asset || asset.kind !== 'audio' || !Object.hasOwn(AUDIO_MIME, asset.extension) || !/^[a-f0-9]{64}$/.test(asset.hash)) return new Response('', { status: 404 });
    const file = resolveManagedPath(library.root, asset.managedPath, 'assets');
    if (path.basename(file) !== `${asset.hash}${asset.extension}`) return new Response('', { status: 404 });
    const stat = await fs.promises.stat(file);
    const range = byteRange(request.headers?.get('Range') ?? null, stat.size);
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' } });
    const headers = { 'Content-Type': AUDIO_MIME[asset.extension], 'Accept-Ranges': 'bytes', 'Content-Length': String(Math.max(0, range.end - range.start + 1)), 'Cache-Control': 'no-store' };
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    const body = method === 'HEAD' || stat.size === 0 ? null : Readable.toWeb(fs.createReadStream(file, { start: range.start, end: range.end }));
    return new Response(body, { status: range.partial ? 206 : 200, headers });
  } catch { return new Response('', { status: 404 }); }
}

module.exports = { createMediaResponse };
