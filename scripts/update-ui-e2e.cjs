/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-update-ui-'));
  const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const app = await _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), `--user-data-dir=${path.join(temporary, 'profile')}`], env: { ...process.env, ANSHELF_DATA_DIR: path.join(temporary, 'library') }, timeout: 60000 });
  const checks = [], errors = [];
  const out = path.join(root, 'test-output');
  await fs.mkdir(out, { recursive: true });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      global.__updateTest = { calls: [], opens: 0, projectOpens: 0, delay: false, result: { currentVersion: '0.3.8', status: 'available', latestVersion: '0.3.9', releaseUrl: 'https://github.com/anyv-DH/anshelf/releases/tag/v0.3.9' } };
      ipcMain.removeHandler('shelf:update-check');
      ipcMain.handle('shelf:update-check', async (_event, options) => {
        global.__updateTest.calls.push(options);
        if (global.__updateTest.delay) await new Promise(resolve => { global.__updateTest.resolve = resolve; });
        return global.__updateTest.result;
      });
      ipcMain.removeHandler('shelf:update-open');
      ipcMain.handle('shelf:update-open', () => { global.__updateTest.opens++; return true; });
      ipcMain.removeHandler('shelf:project-open');
      ipcMain.handle('shelf:project-open', () => { global.__updateTest.projectOpens++; return true; });
    });
    await page.locator('#app-update').waitFor({ timeout: 4000 });
    await page.waitForFunction(() => document.querySelector('#app-update').textContent.includes('发现新版 0.3.9'), null, { timeout: 8000 });
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.open), false);
    assert.equal((await app.evaluate(() => global.__updateTest.calls)).length, 1);
    assert.equal((await app.evaluate(() => global.__updateTest.calls))[0].manual, false);
    await page.locator('.sidebar-bottom').screenshot({ path: path.join(out, 'update-entry.png'), scale: 'css' });
    checks.push('one automatic check shows a compact update badge without opening a modal');

    await app.evaluate(() => { global.__updateTest.delay = true; });
    await page.locator('#app-update').click();
    await page.waitForFunction(() => document.querySelector('#update-status')?.textContent.includes('正在检查'));
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator('#update-auto-check').isChecked(), true);
    await page.waitForTimeout(50);
    await app.evaluate(() => { global.__updateTest.delay = false; global.__updateTest.resolve(); });
    await page.waitForFunction(() => document.querySelector('#update-status')?.textContent.includes('发现新版'));
    assert.match(await page.locator('#update-status').textContent(), /0\.3\.9/);
    assert.match(await page.locator('#update-panel').textContent(), /当前版本.*0\.3\.8/);
    assert.match(await page.locator('#update-panel').textContent(), /安装版/);
    assert.match(await page.locator('#update-panel').textContent(), /免安装/);
    assert.match(await page.locator('#update-panel').textContent(), /不用卸载/);
    assert.match(await page.locator('#update-panel').textContent(), /素材库.*保留|保留.*素材库/);
    assert.match(await page.locator('#update-panel').textContent(), /插件.*单独更新/);
    assert.match(await page.locator('#update-panel').textContent(), /作者：安屿动画/);
    assert.equal(await page.locator('[data-action="open-project-page"]').textContent(), 'https://github.com/anyv-DH/anshelf');
    assert.equal(await page.locator('.update-support p').textContent(), '如果安安素材管理器帮到了您，欢迎到 GitHub 点一颗 Star ⭐。愿您的灵感不断，视频条条爆火！谢谢您的支持。');
    const callCount = (await app.evaluate(() => global.__updateTest.calls)).length;
    await page.locator('[data-action="open-project-page"]').click();
    assert.equal(await app.evaluate(() => global.__updateTest.projectOpens), 1);
    assert.equal(await app.evaluate(() => global.__updateTest.opens), 0);
    assert.equal((await app.evaluate(() => global.__updateTest.calls)).length, callCount);
    await page.locator('[data-action="open-update-page"]').click();
    assert.equal(await app.evaluate(() => global.__updateTest.opens), 1);
    assert.equal(await app.evaluate(() => global.__updateTest.projectOpens), 1);
    assert.equal((await app.evaluate(() => global.__updateTest.calls)).length, callCount);
    checks.push('manual check renders loading, both versions, Chinese install steps and opens downloads through fixed IPC');
    checks.push('author, official project link and respectful Star copy are visible; project and download IPC stay independent');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(930, 700));
    const smallLayout = await page.locator('#dialog').evaluate(dialog => {
      const r = dialog.getBoundingClientRect(), button = document.querySelector('#app-update').getBoundingClientRect();
      return { fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, noHorizontalScroll: dialog.scrollWidth <= dialog.clientWidth, sidebarFits: button.left >= 0 && button.bottom <= innerHeight };
    });
    assert.deepEqual(smallLayout, { fits: true, noHorizontalScroll: true, sidebarFits: true });
    await page.screenshot({ path: path.join(out, 'update-ui-small-dark.png'), scale: 'css' });
    await page.locator('#dialog').screenshot({ path: path.join(out, 'update-dialog.png'), scale: 'css' });
    const targets = await page.locator('#dialog').evaluate(dialog => {
      const box = dialog.getBoundingClientRect();
      return Object.fromEntries(['#update-status', '#update-auto-check', '[data-action="open-update-page"]', '[data-action="open-project-page"]'].map(selector => {
        const r = dialog.querySelector(selector).getBoundingClientRect();
        return [selector, { x: r.x - box.x + r.width / 2, y: r.y - box.y + r.height / 2 }];
      }));
    });
    await fs.writeFile(path.join(out, 'update-doc-targets.json'), JSON.stringify(targets, null, 2));
    checks.push('the update dialog and compact sidebar entry fit within a 930x700 window');

    await page.locator('#update-auto-check').uncheck();
    assert.equal(await page.evaluate(() => localStorage.getItem('anshelf-check-updates-on-start')), 'false');
    await page.locator('[data-action="close-dialog"]').click();
    const beforeReload = (await app.evaluate(() => global.__updateTest.calls)).length;
    await page.reload();
    await page.locator('#app-update').waitFor();
    await page.waitForTimeout(3300);
    assert.equal((await app.evaluate(() => global.__updateTest.calls)).length, beforeReload);
    checks.push('disabling startup checks persists across a reload and prevents any automatic request');

    await app.evaluate(() => { global.__updateTest.result = { currentVersion: '0.3.8', status: 'offline', error: '网络暂不可用' }; });
    await page.locator('#app-update').click();
    await page.waitForFunction(() => document.querySelector('#update-status')?.textContent.includes('暂时无法检查'));
    assert.match(await page.locator('#update-status').textContent(), /本地素材/);
    await page.locator('[data-action="close-dialog"]').click();
    await page.locator('#search').fill('仍然可以搜索');
    assert.equal(await page.locator('#search').inputValue(), '仍然可以搜索');
    assert.equal(await page.locator('#host-error').isVisible(), false);
    checks.push('offline checks show a recoverable message and leave library search available');

    await app.evaluate(() => { global.__updateTest.result = { currentVersion: '0.3.8', status: 'current', latestVersion: '0.3.8' }; });
    await page.locator('#app-update').click();
    await page.waitForFunction(() => document.querySelector('#update-status')?.textContent.includes('已是最新版本'));
    assert.equal(await page.locator('#app-update').getAttribute('data-state'), 'current');
    await page.locator('[data-action="close-dialog"]').click();
    await page.locator('[data-action="theme"][data-theme="warm"]').click();
    await page.locator('#app-update').click();
    await page.waitForFunction(() => document.querySelector('#update-status')?.textContent.includes('已是最新版本'));
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'warm');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(930, 700));
    const warm = await page.locator('#update-status').evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    assert.notEqual(warm.color, warm.background);
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
    await page.screenshot({ path: path.join(out, 'update-ui-small-warm.png'), scale: 'css' });
    assert.deepEqual(errors, []);
    checks.push('up-to-date result resets the badge, warm theme remains readable and no page errors occur');
    await page.screenshot({ path: path.join(out, 'update-ui.png'), scale: 'css' });
    await fs.writeFile(path.join(out, 'update-ui-result.json'), JSON.stringify({ checks, pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
  } finally { await app.close(); await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
