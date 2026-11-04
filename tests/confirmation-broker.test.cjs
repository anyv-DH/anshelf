const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createConfirmationBroker } = require('../desktop/confirmation-broker.cjs');

function fixture() {
  const ipcMain = new EventEmitter(), webContents = new EventEmitter(), sent = [];
  webContents.send = (channel, payload) => sent.push({ channel, payload });
  webContents.isDestroyed = () => false;
  return { ipcMain, webContents, sent, broker: createConfirmationBroker({ ipcMain, webContents }) };
}
test('theme confirmation accepts only its bound sender and request once', async () => {
  const f = fixture();
  const pending = f.broker.request({ title: '确认复制', message: '请您核对', detail: '路径', confirmLabel: '确认复制' });
  const id = f.sent[0].payload.requestId;
  f.ipcMain.emit('shelf:confirm-response', { sender: {} }, id, true);
  f.ipcMain.emit('shelf:confirm-response', { sender: f.webContents }, id + 'wrong', true);
  f.ipcMain.emit('shelf:confirm-response', { sender: f.webContents }, id, 'true');
  f.ipcMain.emit('shelf:confirm-response', { sender: f.webContents }, id, true);
  assert.equal(await pending, true);
  f.broker.close();
});
test('cancel, navigation, renderer exit and close resolve safely without background timers', async () => {
  for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed', 'close']) {
    const f = fixture();
    const pending = f.broker.request({ title: '确认', message: '确认吗' });
    if (event === 'close') f.broker.close(); else f.webContents.emit(event);
    assert.equal(await pending, false);
    f.broker.close();
    assert.equal(f.ipcMain.listenerCount('shelf:confirm-response'), 0);
  }
  const f = fixture();
  const pending = f.broker.request({ title: '确认', message: '确认吗' });
  f.ipcMain.emit('shelf:confirm-response', { sender: f.webContents }, f.sent[0].payload.requestId, false);
  assert.equal(await pending, false); f.broker.close();
});
