/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-download-ui-'));
  const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const output = path.join(root, 'test-output/update-download-ui'); await fs.mkdir(output, { recursive: true });
  let app, page; const checks = [], errors = [], nativeDialogs = [];
  try {
    app = await _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), `--user-data-dir=${path.join(temporary, 'profile')}`], env: { ...process.env, ANSHELF_DATA_DIR: path.join(temporary, 'library') }, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { nativeDialogs.push(dialog.message()); dialog.dismiss(); });
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(930, 700);
      globalThis.downloadUiTest = { calls: [], result: { currentVersion: '0.3.9', status: 'available', latestVersion: '0.3.10' }, mode: 'installed', fail: false };
      for (const channel of ['shelf:update-check', 'shelf:update-download', 'shelf:update-cancel', 'shelf:update-launch', 'shelf:update-reveal', 'shelf:plugin-status']) ipcMain.removeHandler(channel);
      ipcMain.handle('shelf:update-check', () => globalThis.downloadUiTest.result);
      ipcMain.handle('shelf:plugin-status', () => ({ bundledVersion: '0.3.9', installedVersion: '0.3.9', status: 'current' }));
      ipcMain.handle('shelf:update-download', (_event, ...args) => {
        globalThis.downloadUiTest.calls.push({ method: 'download', args });
        if (globalThis.downloadUiTest.fail) throw new Error('下载失败，请您稍后重试。');
        return new Promise((resolve, reject) => { globalThis.downloadUiTest.resolve = () => resolve({ version: '0.3.10', mode: globalThis.downloadUiTest.mode, ready: true }); globalThis.downloadUiTest.reject = reject; });
      });
      ipcMain.handle('shelf:update-cancel', (_event, ...args) => { globalThis.downloadUiTest.calls.push({ method: 'cancel', args }); globalThis.downloadUiTest.reject?.(new Error('下载已取消')); return true; });
      ipcMain.handle('shelf:update-launch', (_event, ...args) => { globalThis.downloadUiTest.calls.push({ method: 'launch', args }); return true; });
      ipcMain.handle('shelf:update-reveal', (_event, ...args) => { globalThis.downloadUiTest.calls.push({ method: 'reveal', args }); return true; });
    });
    const downloads = () => app.evaluate(() => globalThis.downloadUiTest.calls.filter(call => call.method === 'download').length);
    const launches = () => app.evaluate(() => globalThis.downloadUiTest.calls.filter(call => call.method === 'launch').length);
    const open = async () => { await page.locator('#app-update').click(); await page.locator('[data-update-download-controls]').waitFor({ state: 'visible' }); };
    const confirmDownload = async () => { await page.locator('[data-update-action="download"]').click(); await page.locator('#confirm-dialog[open] [data-confirm="accept"]').click(); };
    await open();
    await page.locator('[data-update-action="download"]').click();
    assert.match(await page.locator('#confirm-message').textContent(), /主动下载.*官方/);
    assert.match(await page.locator('#confirm-message').textContent(), /不会.*安装/);
    await page.keyboard.press('Enter'); await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
    assert.equal(await downloads(), 0);
    checks.push('downloading needs a themed confirmation; default Enter cancels without making a download request');

    await confirmDownload();
    await page.waitForFunction(() => document.querySelector('[data-update-download-status]')?.textContent.includes('正在下载'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('shelf:update-progress', { received: 52428800, total: 104857600, percent: 50 }));
    await page.waitForFunction(() => document.querySelector('[data-update-download-status]')?.textContent.includes('50%'));
    await page.locator('[data-action="close-dialog"]').click(); await open();
    assert.match(await page.locator('[data-update-download-status]').textContent(), /50%/);
    assert.equal(await downloads(), 1);
    await page.locator('[data-update-action="cancel"]').click();
    await page.waitForFunction(() => document.querySelector('[data-update-download-status]')?.textContent.includes('已取消'));
    assert.equal(await launches(), 0);
    checks.push('progress survives closing and reopening the update window; cancelling the transfer never launches an update');

    await app.evaluate(() => { globalThis.downloadUiTest.fail = true; });
    await confirmDownload();
    await page.waitForFunction(() => document.querySelector('[data-update-download-status]')?.textContent.includes('下载失败'));
    assert.doesNotMatch(await page.locator('[data-update-download-status]').textContent(), /Error invoking/);
    assert.equal(await page.locator('[data-update-action="download"]').isEnabled(), true);
    await app.evaluate(() => { globalThis.downloadUiTest.fail = false; });
    await confirmDownload(); await app.evaluate(() => globalThis.downloadUiTest.resolve());
    await page.locator('[data-update-action="launch"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-update-action="launch"]').textContent(), '退出并更新');
    assert.match(await page.locator('[data-update-download-status]').textContent(), /已下载.*0\.3\.10/);
    await page.locator('[data-update-action="launch"]').click();
    assert.match(await page.locator('#confirm-message').textContent(), /保存.*AN.*作品/);
    assert.match(await page.locator('#confirm-message').textContent(), /安装向导/);
    assert.match(await page.locator('#confirm-message').textContent(), /不会.*关闭 AN/);
    await page.keyboard.press('Escape'); await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
    assert.equal(await launches(), 0);
    await page.locator('[data-update-action="launch"]').click(); await page.locator('#confirm-dialog[open] [data-confirm="accept"]').click();
    await page.waitForFunction(() => document.querySelector('[data-update-download-status]')?.textContent.includes('正在打开'));
    assert.equal(await launches(), 1);
    checks.push('failure can retry; a verified installer is launched only after a second confirmation that mentions saving AN work and the install wizard');

    await page.reload(); await page.locator('#app-update').waitFor();
    await app.evaluate(() => { globalThis.downloadUiTest.mode = 'portable'; }); await open();
    await confirmDownload(); await app.evaluate(() => globalThis.downloadUiTest.resolve());
    await page.locator('[data-update-action="launch"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-update-action="launch"]').textContent(), '退出并打开新版');
    assert.match(await page.locator('[data-update-download-note]').textContent(), /固定.*本机更新目录/);
    assert.match(await page.locator('[data-update-download-note]').textContent(), /旧.*入口.*不会.*覆盖/);
    await page.locator('[data-update-action="reveal"]').click();
    await page.locator('[data-update-action="launch"]').click(); await page.keyboard.press('Enter');
    await page.locator('#confirm-dialog').waitFor({ state: 'hidden' }); assert.equal(await launches(), 1);
    await page.locator('[data-update-download-controls]').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
    await page.screenshot({ path: path.join(output, 'download-ready-portable.png'), scale: 'css' });
    assert.ok((await app.evaluate(() => globalThis.downloadUiTest.calls)).every(call => call.args.length === 0), 'renderer never supplies file paths, URLs or launch arguments');
    checks.push('portable update uses a distinct launch label, explains fixed storage and the old shortcut, and every IPC receives zero path or URL arguments');
    await page.locator('[data-action="close-dialog"]').click(); await page.reload();
    await app.evaluate(() => { globalThis.downloadUiTest.result = { currentVersion: '0.3.9', latestVersion: '0.3.9', status: 'current' }; });
    await page.locator('#app-update').click(); await page.waitForFunction(() => document.querySelector('#update-status')?.textContent.includes('最新版本'));
    assert.equal(await page.locator('[data-update-action="download"]').isVisible(), false);
    assert.equal(await page.locator('[data-action="open-update-page"]').isVisible(), true);
    assert.deepEqual(errors, []); assert.deepEqual(nativeDialogs, []);
    checks.push('no download button is offered without a newer release; official page fallback remains available and no native dialogs occur');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, pageErrors: errors, nativeDialogs }, null, 2));
    console.log(JSON.stringify({ checks, pageErrors: errors, nativeDialogs }, null, 2));
  } catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
  finally { if (app) await app.close().catch(() => {}); await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
