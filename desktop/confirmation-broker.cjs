/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const { randomUUID } = require('node:crypto');

function createConfirmationBroker({ ipcMain, webContents }) {
  const pending = new Map();
  let closed = false;
  function cancelAll() { for (const resolve of pending.values()) resolve(false); pending.clear(); }
  function response(event, requestId, accepted) {
    if (event.sender !== webContents || typeof accepted !== 'boolean' || !pending.has(requestId)) return;
    const resolve = pending.get(requestId); pending.delete(requestId); resolve(accepted);
  }
  ipcMain.on('shelf:confirm-response', response);
  for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) webContents.on(event, cancelAll);
  return {
    request(payload) {
      if (closed || webContents.isDestroyed() || pending.size) return Promise.resolve(false);
      const requestId = randomUUID();
      return new Promise(resolve => {
        pending.set(requestId, resolve);
        try { webContents.send('shelf:confirm-request', { ...payload, requestId }); }
        catch { pending.delete(requestId); resolve(false); }
      });
    },
    close() {
      closed = true; cancelAll(); ipcMain.removeListener('shelf:confirm-response', response);
      for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) webContents.removeListener(event, cancelAll);
    }
  };
}
module.exports = { createConfirmationBroker };
