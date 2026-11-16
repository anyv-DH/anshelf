/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');

const root = path.resolve(__dirname, '..');
const themes = ['dark', 'warm', 'paper', 'slate', 'sage', 'bluewhite'];
const email = 'q17325759939@qq.com';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function stableFiles(directory, prefix = '') {
  const result = {};
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await stableFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile() && (relative === 'library.json' || /^(assets|previews)[\\/]/.test(relative))) result[relative] = digest(await fs.readFile(path.join(directory, entry.name)));
  }
  return result;
}

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-feedback-ui-'));
  const output = process.env.ANSHELF_FEEDBACK_OUTPUT || path.join(root, 'test-output/author-feedback-ui');
  await fs.mkdir(output, { recursive: true });
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const source = path.join(temporary, '反馈原件.png');
  await fs.copyFile(path.join(root, 'desktop/icon.png'), source);
  const originalHash = digest(await fs.readFile(source));
  const library = await Library.open(data);
  const asset = (await library.importPaths([source], { mode: 'image' })).assets[0];
  await library.updateAsset(asset.id, { name: '反馈隔离图片' });
  const before = await stableFiles(data);
  assert.ok(before['library.json']);
  const executable = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const contexts = [], checks = [], geometries = [], errors = [], requests = [];
  let app, page;
  const passed = message => { checks.push(message); console.log('[pass] ' + message); };
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function resize(width, height) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '安安素材管理器').setContentSize(...size), [width, height]);
    await page.waitForFunction(([width, height]) => Math.abs(innerWidth - width) < 3 && Math.abs(innerHeight - height) < 3, [width, height]);
    await tick();
  }
  async function tools() {
    if (await page.locator('#workspace-tools').getAttribute('open') === null) await page.locator('#workspace-tools > summary').click();
  }
  async function openFeedback() {
    await tools();
    const trigger = page.locator('#workspace-tools [data-action="author-feedback"]');
    assert.equal(await trigger.count(), 1, 'tools must expose one independent feedback/community entry');
    await trigger.click();
    await page.locator('#dialog[open] .author-feedback').waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal(await page.locator('#dialog-title').innerText(), '反馈与交流群');
    await tick();
  }
  async function closeFeedback() {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dialog').open);
    await tick();
  }
  async function chooseAppearance(layout, theme) {
    await tools();
    await page.locator('#workspace-tools [data-action="appearance-settings"]').click();
    await page.locator('#appearance-dialog[open]').waitFor();
    await page.locator(`[data-appearance-layout="${layout}"]`).click();
    await page.locator(`[data-appearance-theme="${theme}"]`).click();
    await page.locator('[data-appearance-close="done"]').click();
    await tick();
    assert.equal(await page.locator('html').getAttribute('data-layout'), layout);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
  }
  async function measure(layout, theme, size) {
    const result = await page.locator('#dialog').evaluate(dialog => {
      const rect = element => { const { left, right, top, bottom, width, height } = element.getBoundingClientRect(); return { left, right, top, bottom, width, height }; };
      const content = dialog.querySelector('.author-feedback');
      const visible = element => {
        const box = rect(element), frame = rect(dialog);
        const left = Math.max(0, frame.left + dialog.clientLeft), top = Math.max(0, frame.top + dialog.clientTop);
        const right = Math.min(innerWidth, frame.left + dialog.clientLeft + dialog.clientWidth), bottom = Math.min(innerHeight, frame.top + dialog.clientTop + dialog.clientHeight);
        const points = [[box.left + box.width / 2, box.top + 2], [box.left + box.width / 2, box.bottom - 2]];
        return { ...box, fullyVisible: box.width > 0 && box.height > 0 && box.left >= left && box.right <= right && box.top >= top && box.bottom <= bottom,
          reachable: points.every(([x, y]) => element.contains(document.elementFromPoint(x, y))) };
      };
      return { viewport: { width: innerWidth, height: innerHeight }, dialog: rect(dialog), contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth, email: rect(dialog.querySelector('#author-feedback-email')),
        copy: rect(dialog.querySelector('[data-action="copy-author-email"]')), image: rect(dialog.querySelector('.feedback-community-code img')),
        controls: { email: visible(dialog.querySelector('#author-feedback-email')), copy: visible(dialog.querySelector('[data-action="copy-author-email"]')),
          image: visible(dialog.querySelector('.feedback-community-code img')), return: visible(dialog.querySelector('.dialog-actions [data-action="close-dialog"]')),
          close: visible(dialog.querySelector('.dialog-heading [data-action="close-dialog"]')) },
        classes: dialog.className, activeInDialog: dialog.contains(document.activeElement) };
    });
    geometries.push({ layout, theme, size, ...result });
    assert.equal(result.pageOverflow, false);
    assert.ok(result.dialog.left >= -1 && result.dialog.top >= -1 && result.dialog.right <= result.viewport.width + 1 && result.dialog.bottom <= result.viewport.height + 1, 'feedback dialog stays inside the viewport');
    assert.ok(result.contentScrollWidth <= result.contentWidth + 1, 'feedback content has no horizontal scrolling');
    assert.ok(result.email.width > 100 && result.copy.width > 40 && result.image.width >= 180, 'email, copy control and QR remain readable');
    for (const [name, control] of Object.entries(result.controls)) {
      assert.equal(control.fullyVisible, true, `${layout}/${theme}/${size}: ${name} is completely visible without scrolling`);
      assert.equal(control.reachable, true, `${layout}/${theme}/${size}: ${name} is reachable without clipping or an overlay`);
    }
    assert.equal(result.activeInDialog, true, 'keyboard focus is within the modal');
    assert.doesNotMatch(result.classes, /preview-dialog|scene-group-dialog/, 'feedback must not inherit another dialog layout');
  }
  try {
    app = await _electron.launch({ executablePath: executable, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    const context = await app.evaluate(({ app, ipcMain, shell, net, dialog }) => {
      globalThis.__feedbackExternalCalls = []; globalThis.__feedbackNetworkCalls = []; globalThis.__feedbackNativeDialogs = [];
      shell.openExternal = async url => { globalThis.__feedbackExternalCalls.push(url); throw new Error('Unexpected external navigation'); };
      const originalRequest = net.request;
      net.request = function (...args) {
        const options = args[0];
        const url = typeof options === 'string' ? options : options?.url || `${options?.protocol || ''}//${options?.hostname || options?.host || ''}${options?.path || ''}`;
        if (/^https?:/.test(url)) globalThis.__feedbackNetworkCalls.push(url);
        return originalRequest.apply(this, args);
      };
      ipcMain.removeHandler('shelf:update-check');
      ipcMain.handle('shelf:update-check', () => ({ status: 'current', currentVersion: app.getVersion(), latestVersion: app.getVersion() }));
      for (const name of ['showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showMessageBox', 'showMessageBoxSync']) dialog[name] = () => { globalThis.__feedbackNativeDialogs.push(name); throw new Error('Unexpected native dialog'); };
      return { packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath, profile: app.getPath('userData'), library: process.env.ANSHELF_DATA_DIR };
    });
    assert.equal(context.packaged, Boolean(process.env.ANSHELF_UI_EXECUTABLE));
    assert.equal(context.version, require('../package.json').version);
    for (const [actual, expected] of [[context.executable, executable], [context.profile, profile], [context.library, data]]) assert.equal(path.resolve(actual).toLowerCase(), path.resolve(expected).toLowerCase());
    contexts.push(context);
    page = await app.firstWindow(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.waitForSelector('.asset-card');
    await page.locator('#onboarding-dialog[open]').waitFor();
    await page.locator('#onboarding-dialog [data-onboarding-action="skip"]').click();
    await page.evaluate(() => localStorage.setItem('anshelf-check-updates-on-start', 'false'));
    const networkBefore = await app.evaluate(() => globalThis.__feedbackNetworkCalls.length);
    await page.locator('#search').fill('反馈隔离');
    await page.locator('.asset-card h3').click();
    const selected = await page.locator('.asset-card.selected').getAttribute('data-asset');
    assert.equal(selected, asset.id);
    await tools();
    assert.equal(await page.locator('#workspace-tools [data-action="author-message"]').count(), 1);
    await openFeedback();
    const body = await page.locator('.author-feedback').innerText();
    assert.match(body, /免费/); assert.match(body, /Bug|问题|故障/); assert.match(body, /功能|建议/); assert.match(body, /QQ\s*(?:交流)?群/);
    assert.match(body, /投喂/); assert.match(body, /无关/); assert.doesNotMatch(body, /你/);
    assert.equal(await page.locator('#author-feedback-email').inputValue(), email);
    assert.equal(await page.locator('#author-feedback-email').getAttribute('readonly'), '');
    assert.equal(await page.locator('.author-feedback .author-payment-codes').count(), 0);
    assert.equal(await page.locator('.author-feedback img').count(), 1);
    assert.equal(await page.locator('.author-feedback a[href^="mailto:"]').count(), 0);
    assert.match(await page.locator('.feedback-community-code img').getAttribute('src'), /^assets\/community\/qq-group\.png$/);
    await page.waitForFunction(() => { const image = document.querySelector('.feedback-community-code img'); return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0; });
    passed('independent tools entry opens polite free-software feedback/community information with the fixed email and one bundled QQ QR image');

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__feedbackCopiedText = text; } } });
    });
    await page.locator('[data-action="copy-author-email"]').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#author-feedback-copy-status').textContent.includes('已复制'));
    assert.equal(await page.evaluate(() => window.__feedbackCopiedText), email);
    passed('keyboard copy writes exactly the author email through the clipboard boundary and reports success');
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); }; });
    await page.locator('[data-action="copy-author-email"]').click();
    await page.waitForFunction(() => /手动复制|Ctrl\+C/.test(document.querySelector('#author-feedback-copy-status').textContent));
    const fallback = await page.locator('#author-feedback-email').evaluate(element => ({ value: element.value, selected: element.value.slice(element.selectionStart, element.selectionEnd), focused: document.activeElement === element }));
    assert.equal(fallback.selected, email); assert.equal(fallback.focused, true);
    passed('clipboard rejection reports the failure and selects the entire email for manual copying without changing the user clipboard');

    await closeFeedback(); await openFeedback();
    assert.equal(await page.locator('#author-feedback-copy-status').innerText(), '');
    await closeFeedback();
    await tools(); await page.locator('#workspace-tools [data-action="author-message"]').click();
    await page.locator('#dialog[open] .author-support').waitFor();
    assert.equal(await page.locator('.author-payment-codes img').count(), 2);
    assert.equal(await page.locator('.feedback-community-code img').count(), 0);
    assert.equal(await page.locator('#author-feedback-email').count(), 0);
    await page.keyboard.press('Escape');
    passed('Escape and reopening reset only the feedback status; the separate support dialog retains its own two payment codes');

    for (const layout of ['modern', 'classic']) {
      for (const theme of themes) {
        await resize(850, 600); await chooseAppearance(layout, theme); await openFeedback();
        await measure(layout, theme, '850x600');
        await page.locator('.feedback-community-code img').scrollIntoViewIfNeeded();
        const imageBox = await page.locator('.feedback-community-code img').boundingBox();
        assert.ok(imageBox.width >= 180 && imageBox.x >= 0 && imageBox.x + imageBox.width <= 851 && imageBox.y >= 0 && imageBox.y + imageBox.height <= 601, 'the complete QR remains reachable at the minimum window size');
        if (theme === 'dark' || theme === 'bluewhite') await page.screenshot({ path: path.join(output, `feedback-${layout}-${theme}-small.png`) });
        await closeFeedback();
      }
    }
    passed('both layouts and all six themes keep the email, copy action, complete QR, return and close controls fully visible and reachable without scrolling at 850x600');
    await resize(1480, 940); await chooseAppearance('modern', 'dark'); await openFeedback();
    await measure('modern', 'dark', '1480x940');
    await page.screenshot({ path: path.join(output, 'feedback-modern-wide.png') });
    await page.locator('#dialog [data-action="close-dialog"]').last().click();
    await page.waitForFunction(() => !document.querySelector('#dialog').open);
    await tools(); await page.locator('#workspace-tools [data-action="appearance-settings"]').click();
    await page.locator('#appearance-dialog[open]').waitFor();
    await page.locator('[data-appearance-close="done"]').click();
    await openFeedback(); await closeFeedback();
    assert.equal(await page.locator('#search').inputValue(), '反馈隔离');
    assert.equal(await page.locator('.asset-card.selected').getAttribute('data-asset'), selected);
    passed('wide-window display and repeated feedback/support/appearance transitions preserve the current search and selected asset');

    assert.deepEqual(await stableFiles(data), before, 'feedback browsing must not change the isolated library or managed/preview files');
    assert.equal(digest(await fs.readFile(source)), originalHash);
    const activity = await app.evaluate(() => ({ external: globalThis.__feedbackExternalCalls, network: globalThis.__feedbackNetworkCalls, nativeDialogs: globalThis.__feedbackNativeDialogs }));
    assert.deepEqual(activity.external, []); assert.deepEqual(activity.nativeDialogs, []);
    assert.equal(activity.network.length, networkBefore, 'feedback operations cause no main-process network request');
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    passed('source bytes and isolated library hashes remain unchanged; feedback causes no network, external navigation, native dialogs or page errors');
    const report = { passed: true, contexts, checks, geometries, pageErrors: errors, requests, activity, originalUnchanged: true, libraryUnchanged: true, clipboardVerification: 'deterministic browser clipboard boundary; user clipboard untouched', animateVerified: false };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure-details.json'), JSON.stringify({ passed: false, error: error.message, contexts, checks, geometries, pageErrors: errors, requests }, null, 2));
    console.error(JSON.stringify({ pageErrors: errors, checks, requests }));
    throw error;
  } finally {
    if (app) await app.close();
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('anshelf-feedback-ui-'));
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
