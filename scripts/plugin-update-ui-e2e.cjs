/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-plugin-update-ui-'));
  const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const output = path.join(root, 'test-output/plugin-update-ui'); await fs.mkdir(output, { recursive: true });
  let app, page; const checks = [], errors = [], nativeDialogs = [];
  try {
    app = await _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), `--user-data-dir=${path.join(temporary, 'profile')}`], env: { ...process.env, ANSHELF_DATA_DIR: path.join(temporary, 'library') }, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { nativeDialogs.push(dialog.message()); dialog.dismiss(); });
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(930, 700);
      globalThis.pluginUiTest = { installs: 0, statusCalls: 0, fail: false, status: { bundledVersion: '0.3.9', installedVersion: '0.3.8', status: 'needs-update' } };
      ipcMain.removeHandler('shelf:plugin-status');
      ipcMain.handle('shelf:plugin-status', () => { globalThis.pluginUiTest.statusCalls++; return globalThis.pluginUiTest.status; });
      ipcMain.removeHandler('shelf:plugin-install');
      ipcMain.handle('shelf:plugin-install', async () => {
        globalThis.pluginUiTest.installs++;
        if (globalThis.pluginUiTest.fail) throw new Error('测试安装失败，请您重试。');
        await new Promise(resolve => setTimeout(resolve, 150));
        globalThis.pluginUiTest.status = { bundledVersion: '0.3.9', installedVersion: '0.3.9', status: 'current' };
        return { ...globalThis.pluginUiTest.status, restartRequired: true };
      });
      ipcMain.removeHandler('shelf:update-check'); ipcMain.handle('shelf:update-check', () => ({ currentVersion: '0.3.9', status: 'current', latestVersion: '0.3.9' }));
    });
    await page.locator('#app-update').click();
    await page.waitForFunction(() => document.querySelector('[data-plugin-panel]')?.textContent.includes('有新版可更新'));
    const panel = page.locator('[data-plugin-panel]');
    assert.match(await panel.textContent(), /软件附带.*0\.3\.9/);
    assert.match(await panel.textContent(), /已安装.*0\.3\.8/);
    for (const cancel of ['button', 'Escape', 'backdrop']) {
      await panel.locator('[data-plugin-action="install"]').click(); await page.locator('#confirm-dialog[open]').waitFor();
      assert.match(await page.locator('#confirm-message').textContent(), /已附带.*无需另行下载/);
      assert.match(await page.locator('#confirm-message').textContent(), /不会.*保存.*关闭.*AN/);
      if (cancel === 'button') await page.locator('[data-confirm="cancel"]').click();
      else if (cancel === 'Escape') await page.keyboard.press('Escape'); else await page.mouse.click(3, 3);
      await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
      assert.equal(await app.evaluate(() => globalThis.pluginUiTest.installs), 0);
      assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.open), true);
    }
    checks.push('both plugin versions and update state are visible; cancel, Escape and backdrop never install or close the update window');
    await panel.locator('[data-plugin-action="install"]').click();
    await page.locator('#confirm-dialog[open] [data-confirm="accept"]').click();
    await panel.locator('[data-plugin-restart]').waitFor({ state: 'visible' });
    assert.equal(await app.evaluate(() => globalThis.pluginUiTest.installs), 1);
    assert.match(await panel.textContent(), /已安装.*0\.3\.9/);
    assert.match(await panel.textContent(), /已是随软件附带的版本/);
    assert.match(await panel.textContent(), /必要时.*重启 AN/);
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(930, 700));
    await page.waitForFunction(() => innerWidth === 930);
    await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'plugin-updated-dark.png'), scale: 'css' });
    checks.push('explicit confirmation installs once, refreshes installed version and explains reopening the panel without touching AN documents');

    await page.locator('[data-action="close-dialog"]').first().click();
    await page.locator('[data-action="bridge-help"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-plugin-panel]')?.textContent.includes('已是随软件附带的版本'));
    assert.equal(await app.evaluate(() => globalThis.pluginUiTest.installs), 1);
    await app.evaluate(() => { globalThis.pluginUiTest.status = { bundledVersion: '0.3.9', installedVersion: null, status: 'not-installed' }; globalThis.pluginUiTest.fail = true; });
    await page.locator('[data-action="close-dialog"]').first().click();
    await page.locator('[data-action="theme"][data-theme="warm"]').click();
    await page.locator('[data-action="bridge-help"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-plugin-panel]')?.textContent.includes('尚未安装'));
    assert.equal(await panel.locator('[data-plugin-action="install"]').textContent(), '安装／更新 AN 插件');
    await panel.locator('[data-plugin-action="install"]').click(); await page.locator('#confirm-dialog[open] [data-confirm="accept"]').click();
    await page.waitForFunction(() => document.querySelector('[data-plugin-error]')?.textContent.includes('测试安装失败'));
    assert.doesNotMatch(await panel.locator('[data-plugin-error]').textContent(), /Error invoking remote method/);
    assert.equal(await panel.locator('[data-plugin-restart]').isVisible(), false);
    assert.equal(await panel.locator('[data-plugin-action="install"]').isEnabled(), true);
    await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'plugin-install-warm.png'), scale: 'css' });
    checks.push('connection window shares plugin installation, missing installation is clear and failure allows retry in the warm theme');
    assert.deepEqual(errors, []); assert.deepEqual(nativeDialogs, []);
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, pageErrors: errors, nativeDialogs }, null, 2));
    console.log(JSON.stringify({ checks, pageErrors: errors, nativeDialogs }, null, 2));
  } catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
  finally { if (app) await app.close().catch(() => {}); await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
