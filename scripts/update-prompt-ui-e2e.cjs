/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const key = 'anshelf-update-reminder';

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-update-prompt-ui-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = process.env.ANSHELF_UPDATE_PROMPT_OUTPUT || path.join(root, 'test-output/update-prompt-ui');
  await fs.mkdir(output, { recursive: true });
  const executable = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const version = require(path.join(root, 'package.json')).version;
  const checks = [], contexts = [], errors = [], geometries = [], onboarding = [];
  let app, page;
  async function launch(status = 'available') {
    app = await _electron.launch({ executablePath: executable, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    // Replace only the check IPC in this isolated process: no public network is used.
    await app.evaluate(({ ipcMain }, { status, version }) => {
      global.__promptChecks = 0;
      ipcMain.removeHandler('shelf:update-check');
      ipcMain.handle('shelf:update-check', () => { global.__promptChecks++; return { currentVersion: version, status, latestVersion: '99.0.0' }; });
    }, { status, version });
    const context = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath, profile: app.getPath('userData'), library: process.env.ANSHELF_DATA_DIR }));
    assert.equal(context.version, version); assert.equal(context.packaged, Boolean(process.env.ANSHELF_UI_EXECUTABLE));
    for (const [actual, expected] of [[context.executable, executable], [context.profile, profile], [context.library, data]]) assert.equal(path.resolve(actual).toLowerCase(), path.resolve(expected).toLowerCase());
    contexts.push(context);
    page = await app.firstWindow(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#navigation [data-id="all"]');
    const firstLaunch = contexts.length === 1;
    if (firstLaunch) {
      await page.locator('#onboarding-dialog[open]').waitFor({ state: 'visible' });
      await page.locator('#onboarding-dialog [data-onboarding-action="skip"]').click();
      await page.locator('#onboarding-dialog').waitFor({ state: 'hidden' });
    }
    const savedOnboarding = await page.evaluate(() => JSON.parse(localStorage.getItem('anshelf-onboarding-v1') || 'null'));
    assert.deepEqual(savedOnboarding, { status: 'skipped' }, 'the explicitly skipped first guide stays remembered on restart');
    assert.equal(await page.locator('#onboarding-dialog').count(), 1);
    assert.equal(await page.locator('#onboarding-dialog').isVisible(), false);
    onboarding.push({ launch: contexts.length, skippedFirstGuide: firstLaunch, ...savedOnboarding });
  }
  async function finishCheck(expected = 1) {
    await app.evaluate(async () => { const until = Date.now() + 6500; while (global.__promptChecks < 1 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25)); });
    assert.equal(await app.evaluate(() => global.__promptChecks), expected);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const closeDialog = () => page.locator('#dialog [data-action="close-dialog"]').first().click();
  const manual = async () => { await page.locator('#workspace-tools > summary').click(); await page.locator('[data-action="check-updates"]').click(); };
  try {
    await launch(); await page.locator('#update-panel').waitFor({ state: 'visible' });
    await finishCheck(); assert.match(await page.locator('#update-status').innerText(), /发现新版 99\.0\.0/);
    assert.equal(await page.locator('#update-reminder-days').inputValue(), '7');
    await page.screenshot({ path: path.join(output, 'startup-update.png'), fullPage: true });
    checks.push('one offline-injected startup request opens a clear available-release dialog');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(850, 600));
    await page.locator('.update-reminder').scrollIntoViewIfNeeded();
    const geometry = await page.locator('.update-reminder').evaluate(node => {
      const box = element => { const { left, right, top, bottom, width, height } = element.getBoundingClientRect(); return { left, right, top, bottom, width, height }; };
      return { reminder: box(node), hint: box(node.querySelector('.field-hint')), input: box(node.querySelector('input')), button: box(node.querySelector('button')), dialogOverflow: document.querySelector('#dialog').scrollWidth > document.querySelector('#dialog').clientWidth, bodyOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    geometries.push(geometry);
    assert.equal(geometry.dialogOverflow, false); assert.equal(geometry.bodyOverflow, false);
    for (const name of ['hint', 'input', 'button']) { assert.ok(geometry[name].left >= geometry.reminder.left + 1, name); assert.ok(geometry[name].right <= geometry.reminder.right - 1, name); }
    for (const value of ['0', '366', '1.5']) {
      await page.locator('#update-reminder-days').fill(value); await page.locator('[data-action="snooze-update"]').click();
      assert.equal(await page.locator('#dialog').evaluate(node => node.open), true);
      assert.equal(await page.locator('#update-reminder-days').evaluate(node => node.validity.valid), false);
    }
    await page.locator('#update-reminder-days').fill('13');
    await page.screenshot({ path: path.join(output, 'startup-update-small.png'), fullPage: true });
    checks.push('small-window reminder hint/input/button stay inside their container and invalid day counts cannot dismiss or save');
    await page.locator('#update-reminder-days').fill('13'); await page.locator('[data-action="snooze-update"]').click();
    assert.equal(await page.locator('#dialog').evaluate(node => node.open), false);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert.equal(saved.days, 13); assert.ok(saved.snoozedUntil > Date.now() + 12.99 * 86400000);
    checks.push('custom thirteen-day suppression saves and closes the popup');
    await app.close(); await launch(); await finishCheck();
    assert.equal(await page.locator('#dialog').evaluate(node => node.open), false);
    await manual(); await page.locator('#update-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#update-reminder-days').inputValue(), '13');
    assert.match(await page.locator('#update-reminder-status').innerText(), /已暂停启动弹窗至/);
    checks.push('restart respects suppression while manual checking and remembered days remain available');
    await closeDialog();
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ days: 13, snoozedUntil: Date.now() - 1 })), key);
    await app.close(); await launch();
    await page.locator('.import-entries [data-action="import"]').click();
    const importTitle = await page.locator('#dialog-title').innerText();
    await finishCheck(); assert.equal(await page.locator('#dialog-title').innerText(), importTitle);
    assert.equal(await page.locator('#update-panel').count(), 0);
    await closeDialog(); await page.locator('#update-panel').waitFor({ state: 'visible' });
    checks.push('expired reminders resume after an existing import dialog closes without replacing its contents');
    await closeDialog();
    await page.evaluate(key => localStorage.removeItem(key), key);
    await app.close(); await launch('offline'); await finishCheck();
    assert.equal(await page.locator('#dialog').evaluate(node => node.open), false);
    checks.push('offline startup updates the badge without opening a failure popup');
    await app.close(); await launch('current'); await finishCheck();
    assert.equal(await page.locator('#dialog').evaluate(node => node.open), false);
    checks.push('an already-current release never produces a startup popup');
    await page.evaluate(() => localStorage.setItem('anshelf-check-updates-on-start', 'false'));
    await app.close(); await launch();
    // The startup delay is three seconds; observing past it proves the opt-out.
    await page.waitForTimeout(3400);
    assert.equal(await app.evaluate(() => global.__promptChecks), 0);
    await manual(); await page.locator('#update-panel').waitFor({ state: 'visible' });
    await finishCheck(); assert.match(await page.locator('#update-status').innerText(), /发现新版/);
    checks.push('startup opt-out makes zero requests; manual checking still works');
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, contexts, geometries, onboarding, pageErrors: errors, externalNetworkUsed: false };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (app) await app.close().catch(() => {});
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('anshelf-update-prompt-ui-'));
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
