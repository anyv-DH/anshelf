/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');

const root = path.resolve(__dirname, '..');
const storageKey = 'anshelf-onboarding-v1';
const stepTitles = ['欢迎', '导入素材', '分类与项目', '预览与整理', '放进 AN', '按习惯浏览'];
const themeIds = ['dark', 'warm', 'paper', 'slate', 'sage', 'bluewhite'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalized = value => path.resolve(value).toLowerCase();

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-onboarding-ui-'));
  const output = process.env.ANSHELF_ONBOARDING_OUTPUT || path.join(root, 'test-output/onboarding-ui');
  await fs.mkdir(output, { recursive: true });
  const executable = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const checks = [], contexts = [], geometries = [], scrollGeometries = [], errors = [], nativeDialogs = [];
  const fixtures = [], libraryHashes = [];
  let app, page, currentScenario;
  const passed = message => { checks.push(message); console.log('[pass] ' + message); };

  async function scenario(name) {
    const data = path.join(temporary, name, 'library');
    const profile = path.join(temporary, name, 'profile');
    const library = await Library.open(data);
    return { name, data, profile, library };
  }
  async function immutableFiles(directory, prefix = '') {
    const result = {};
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) Object.assign(result, await immutableFiles(path.join(directory, entry.name), relative));
      else if (entry.isFile()) result[relative] = hash(await fs.readFile(path.join(directory, entry.name)));
    }
    return result;
  }
  async function freezeLibrary(item) {
    // Include index metadata and managed/preview bytes. Exclude runtime bridge/cache files.
    const files = await immutableFiles(item.data);
    const stable = Object.fromEntries(Object.entries(files).filter(([name]) => name === 'library.json' || /^(assets|previews)[\\/]/.test(name)));
    assert.ok(stable['library.json'], 'the isolated library must have a persistent index');
    libraryHashes.push({ scenario: item.name, data: item.data, before: stable });
  }
  async function verifyLibraries() {
    for (const record of libraryHashes) {
      const files = await immutableFiles(record.data);
      const after = Object.fromEntries(Object.entries(files).filter(([name]) => name === 'library.json' || /^(assets|previews)[\\/]/.test(name)));
      assert.deepEqual(after, record.before, `${record.scenario}: guide must not modify library metadata or asset bytes`);
      record.after = after;
    }
    for (const fixture of fixtures) assert.equal(hash(await fs.readFile(fixture.path)), fixture.before, 'source originals stay byte-identical');
  }
  async function launch(item, update = 'current') {
    currentScenario = item.name;
    app = await _electron.launch({
      executablePath: executable,
      args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + item.profile],
      env: { ...process.env, ANSHELF_DATA_DIR: item.data }, timeout: 60000,
    });
    const context = await app.evaluate(({ ipcMain, app, dialog }, options) => {
      globalThis.__onboardingUpdateChecks = [];
      globalThis.__onboardingNativeDialogs = [];
      ipcMain.removeHandler('shelf:update-check');
      ipcMain.handle('shelf:update-check', (_event, input) => {
        globalThis.__onboardingUpdateChecks.push(input);
        return { status: options.update, currentVersion: app.getVersion(), latestVersion: options.update === 'available' ? '99.0.0' : app.getVersion() };
      });
      for (const name of ['showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showMessageBox', 'showMessageBoxSync']) {
        dialog[name] = () => { globalThis.__onboardingNativeDialogs.push(name); throw new Error('Unexpected native dialog: ' + name); };
      }
      return { packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath, profile: app.getPath('userData'), library: process.env.ANSHELF_DATA_DIR };
    }, { update });
    assert.equal(context.packaged, Boolean(process.env.ANSHELF_UI_EXECUTABLE));
    assert.equal(context.version, require('../package.json').version);
    for (const [actual, expected] of [[context.executable, executable], [context.profile, item.profile], [context.library, item.data]]) assert.equal(normalized(actual), normalized(expected));
    contexts.push({ scenario: item.name, update, ...context });
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push({ scenario: currentScenario, message: error.message }));
    await page.waitForSelector('#navigation [data-system-key="character"]');
    await waitForSnapshot(value => Array.isArray(value.assets), 'the initial library snapshot must be ready');
  }
  async function closeApp() {
    if (!app) return;
    nativeDialogs.push(...await app.evaluate(() => globalThis.__onboardingNativeDialogs || []));
    await app.close(); app = null; page = null;
  }
  const snapshot = () => page.evaluate(() => window.shelf.snapshot());
  async function waitForSnapshot(predicate, message, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await snapshot();
      if (predicate(value)) return value;
      await page.waitForTimeout(100);
    }
    assert.fail(message);
  }
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const guide = () => page.locator('#onboarding-dialog');
  const action = name => guide().locator(`[data-onboarding-action="${name}"]`);
  const storedStatus = () => page.evaluate(key => {
    const value = localStorage.getItem(key); return value == null ? 'new' : JSON.parse(value).status;
  }, storageKey);
  async function step(index) {
    await page.waitForSelector(`#onboarding-dialog[open][data-onboarding-index="${index}"]`);
    assert.equal(await page.locator('#onboarding-step-title').innerText(), stepTitles[index]);
    assert.equal(await guide().locator(`[data-onboarding-step="${index}"]`).getAttribute('aria-current'), 'step');
    assert.equal(await page.locator('dialog[open]').count(), 1, 'only the guide may own the modal layer');
    assert.equal(await page.evaluate(() => document.querySelector('#onboarding-dialog').contains(document.activeElement)), true, 'keyboard focus belongs to the guide');
  }
  async function openGuide() {
    const menu = page.locator('#workspace-tools');
    if (await menu.getAttribute('open') === null) await page.locator('#workspace-tools > summary').click();
    await page.locator('#workspace-tools [data-action="onboarding"]').click();
    await step(0);
  }
  async function closeGuide(name = 'skip') {
    await action(name).click();
    await page.waitForFunction(() => !document.querySelector('#onboarding-dialog').open);
  }
  async function visibleReturnFocus() {
    await tick();
    const focus = await page.evaluate(() => {
      const element = document.activeElement, box = element?.getBoundingClientRect();
      const describe = item => ({ html: item?.outerHTML.slice(0, 500), rects: item?.getClientRects().length, visibility: item && getComputedStyle(item).visibility, display: item && getComputedStyle(item).display, checkVisibility: item?.checkVisibility?.(), details: item?.closest('details')?.id });
      return { usable: element?.matches('#search, #workspace-tools > summary') && box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden', tag: element?.tagName, id: element?.id, action: element?.dataset.action, toolsOpen: document.querySelector('#workspace-tools').open, active: describe(element), summary: describe(document.querySelector('#workspace-tools > summary')), trigger: describe(document.querySelector('#workspace-tools [data-action="onboarding"]')) };
    });
    assert.equal(focus.usable, true, 'manual replay must return focus to the visible tools summary or search field: ' + JSON.stringify(focus));
  }
  async function resize(width, height) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '安安素材管理器').setContentSize(...size), [width, height]);
    await page.waitForFunction(([width, height]) => Math.abs(innerWidth - width) < 3 && Math.abs(innerHeight - height) < 3, [width, height]);
    await tick();
  }
  async function chooseAppearance(layout, theme) {
    if (await page.locator('#workspace-tools').getAttribute('open') === null) await page.locator('#workspace-tools > summary').click();
    await page.locator('#workspace-tools [data-action="appearance-settings"]').click();
    await page.waitForSelector('#appearance-dialog[open]');
    await page.locator(`[data-appearance-layout="${layout}"]`).click();
    await page.locator(`[data-appearance-theme="${theme}"]`).click();
    await page.locator('[data-appearance-close="done"]').click();
    await tick();
    assert.equal(await page.locator('html').getAttribute('data-layout'), layout);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
  }
  async function measure(layout, theme, index) {
    const geometry = await guide().evaluate(dialog => {
      const rect = element => { const { left, right, top, bottom, width, height } = element.getBoundingClientRect(); return { left, right, top, bottom, width, height }; };
      const visible = element => !element.hidden && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0;
      const highlighter = dialog.querySelector('[data-onboarding-target]');
      const selector = highlighter?.dataset.targetSelector || highlighter?.dataset.onboardingTarget;
      const target = selector && document.querySelector(selector);
      const tooltip = dialog.querySelector('[data-onboarding-card]');
      const footer = dialog.querySelector('.onboarding-footer');
      return {
        viewport: { width: innerWidth, height: innerHeight }, dialog: rect(dialog),
        documentOverflow: document.documentElement.scrollWidth > innerWidth,
        panelOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
        highlighter: highlighter && rect(highlighter), selector, target: target && rect(target),
        tooltip: tooltip && rect(tooltip), footer: footer && rect(footer),
        buttons: [...dialog.querySelectorAll('[data-onboarding-action]')].filter(visible).map(element => ({ action: element.dataset.onboardingAction, fixed: !!element.closest('.onboarding-footer') || element.dataset.onboardingAction === 'close', disabled: element.disabled, ...rect(element) })),
      };
    });
    const record = { layout, theme, index, ...geometry }; geometries.push(record);
    assert.equal(geometry.documentOverflow, false);
    assert.equal(geometry.panelOverflow, false);
    assert.ok(geometry.highlighter && geometry.target && geometry.selector, `${layout}/${theme}/step ${index}: guide must point at a real page element`);
    for (const box of [geometry.dialog, geometry.tooltip, geometry.footer, geometry.highlighter, ...geometry.buttons.filter(button => button.fixed)]) {
      assert.ok(box, `${layout}/${theme}/step ${index}: anchored guide controls must exist`);
      assert.ok(box.left >= -1 && box.top >= -1 && box.right <= geometry.viewport.width + 1 && box.bottom <= geometry.viewport.height + 1,
        `${layout}/${theme}/step ${index}: ${box.action || 'dialog'} must remain inside the minimum window`);
    }
    const target = geometry.target, highlight = geometry.highlighter, tooltip = geometry.tooltip;
    const visibleTarget = { left: Math.max(0, target.left), right: Math.min(geometry.viewport.width, target.right), top: Math.max(0, target.top), bottom: Math.min(geometry.viewport.height, target.bottom) };
    assert.ok(visibleTarget.right > visibleTarget.left && visibleTarget.bottom > visibleTarget.top, 'the highlighted actual control is visible');
    assert.ok(highlight.left <= visibleTarget.left + 2 && highlight.right >= visibleTarget.right - 2 && highlight.top <= visibleTarget.top + 2 && highlight.bottom >= visibleTarget.bottom - 2,
      `${layout}/${theme}/step ${index}: highlight must cover its actual page control`);
    const intersection = Math.max(0, Math.min(tooltip.right, visibleTarget.right) - Math.max(tooltip.left, visibleTarget.left)) * Math.max(0, Math.min(tooltip.bottom, visibleTarget.bottom) - Math.max(tooltip.top, visibleTarget.top));
    const targetArea = (visibleTarget.right - visibleTarget.left) * (visibleTarget.bottom - visibleTarget.top);
    geometry.overlapFraction = intersection / targetArea; record.overlapFraction = geometry.overlapFraction;
    if (!['#empty-state', '.main'].includes(geometry.selector)) assert.ok(geometry.overlapFraction < 0.15, `${layout}/${theme}/step ${index}: tooltip must leave the highlighted control readable`);
  }
  async function browseState() {
    return page.evaluate(() => ({
      query: document.querySelector('#search').value,
      roots: [...document.querySelectorAll('#navigation .active')].map(element => element.dataset.id),
      children: [...document.querySelectorAll('#subcategories .active')].map(element => element.dataset.id),
      selected: [...document.querySelectorAll('.asset-card.selected')].map(element => element.dataset.asset),
      page: document.querySelector('#asset-pagination').innerText,
      cards: [...document.querySelectorAll('.asset-card')].map(element => element.dataset.asset),
      browse: document.querySelector('#browse-label').textContent,
      scroll: ['.main', '#navigation', '#categories'].map(selector => ({ selector, top: document.querySelector(selector)?.scrollTop || 0, left: document.querySelector(selector)?.scrollLeft || 0 })),
    }));
  }
  async function waitForStartupCheck() {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && await app.evaluate(() => globalThis.__onboardingUpdateChecks.length) === 0) await page.waitForTimeout(100);
    assert.equal(await app.evaluate(() => globalThis.__onboardingUpdateChecks.length), 1, 'startup checks once through the offline release fixture');
    await page.waitForTimeout(250);
  }
  try {
    const empty = await scenario('empty');
    await freezeLibrary(empty);
    await launch(empty); await step(0);
    assert.equal((await snapshot()).assets.length, 0);
    assert.equal(await storedStatus(), 'new');
    assert.equal(await page.locator('#onboarding-title').innerText(), '新手引导');
    assert.equal(await guide().locator('[data-onboarding-demo]').count(), 0, 'the guide explains actual page controls without a simulated page');
    assert.equal(await action('previous').isDisabled(), true);
    await page.screenshot({ path: path.join(output, 'empty-step-0.png') }); await measure('modern-empty', 'dark', 0);
    for (let index = 1; index < stepTitles.length; index++) {
      await action('next').click(); await step(index); await tick();
      await page.screenshot({ path: path.join(output, `empty-step-${index}.png`) }); await measure('modern-empty', 'dark', index);
    }
    await action('previous').click(); await step(4);
    for (const index of [2, 5, 1, 3, 0]) { await guide().locator(`[data-onboarding-step="${index}"]`).click(); await step(index); }
    for (let index = 0; index < 36; index++) {
      await page.keyboard.press(index < 18 ? 'Tab' : 'Shift+Tab');
      assert.equal(await page.evaluate(() => document.querySelector('#onboarding-dialog').contains(document.activeElement)), true);
    }
    await page.screenshot({ path: path.join(output, 'first-launch.png') });
    passed('fresh empty profile automatically opens the six-step guide; next/previous/directory and keyboard focus work');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#onboarding-dialog').open);
    assert.equal(await storedStatus(), 'skipped');
    await closeApp(); await launch(empty); await tick();
    assert.equal(await guide().getAttribute('open'), null);
    assert.equal(await storedStatus(), 'skipped');
    await openGuide(); await guide().locator('[data-onboarding-step="5"]').click(); await step(5); await closeGuide('finish');
    assert.equal(await storedStatus(), 'completed');
    await closeApp(); await launch(empty); await tick();
    assert.equal(await guide().getAttribute('open'), null); assert.equal(await storedStatus(), 'completed');
    passed('Escape remembers skipped; manual replay begins at step zero and finish persists completed across actual restarts');
    await openGuide(); await guide().locator('[data-onboarding-step="5"]').click(); await step(5); await action('import').click();
    await page.waitForSelector('#dialog[open]');
    assert.equal(await guide().getAttribute('open'), null);
    assert.match(await page.locator('#dialog-title').textContent(), /导入素材/);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal((await snapshot()).assets.length, 0, 'opening import requires a separate explicit file selection');
    await page.locator('#dialog [data-action="close-dialog"]').first().click();
    await openGuide(); await guide().locator('[data-onboarding-step="5"]').click(); await step(5); await action('bridge').click();
    await page.waitForSelector('#dialog[open]');
    assert.equal(await guide().getAttribute('open'), null);
    assert.equal(await page.locator('#dialog-title').textContent(), '连接 Adobe Animate');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.locator('#dialog [data-action="close-dialog"]').first().click();
    await openGuide(); await closeGuide('close');
    await visibleReturnFocus();
    assert.equal(await storedStatus(), 'completed', 'closing a completed guide cannot downgrade its status');
    passed('explicit final actions close the guide before opening the existing import or AN connection dialog; no assets or native windows are created');
    await closeApp();

    const interrupted = await scenario('interrupted'); await freezeLibrary(interrupted);
    await launch(interrupted); await step(0); await action('next').click(); await step(1); await closeApp();
    await launch(interrupted); await step(0);
    assert.equal(await storedStatus(), 'new');
    await closeGuide(); await closeApp();
    passed('exiting with an unfinished automatic guide leaves new status and reopens step zero on the next launch');

    const existing = await scenario('existing');
    const demoFiles = (await fs.readdir(path.join(root, 'demo'))).filter(name => name.endsWith('.fla'));
    for (const name of demoFiles) { const file = path.join(root, 'demo', name); fixtures.push({ path: file, before: hash(await fs.readFile(file)) }); }
    await existing.library.importPaths([path.join(root, 'demo')]);
    const source = path.join(temporary, '教程图片.png'); await fs.copyFile(path.join(root, 'desktop/icon.png'), source);
    fixtures.push({ path: source, before: hash(await fs.readFile(source)) });
    const custom = await existing.library.createCategory('已有项目分类', null, 'all');
    const image = (await existing.library.importPaths([source], { mode: 'image', categoryId: custom.id })).assets[0];
    for (let index = 0; index < 27; index++) {
      const copy = await existing.library.duplicateAsset(image.id);
      await existing.library.updateAsset(copy.id, { name: '教程图片 ' + String(index + 1).padStart(2, '0') });
    }
    await launch(existing); await step(0);
    await waitForSnapshot(value => value.assets.length === demoFiles.length + 28 && value.assets.every(asset => !['pending', 'rendering'].includes(asset.previewStatus)), 'existing demo previews must settle', 100000);
    await closeGuide();
    await freezeLibrary(existing);
    await resize(1480, 940);
    await page.locator(`#navigation [data-action="category"][data-id="${custom.id}"]`).click();
    await page.locator('#search').fill('教程图片');
    await page.locator('#browse').click(); await page.locator('[data-browse-mode="scroll"]').click();
    await page.locator('#search').click();
    await page.locator('#browse').click(); await page.locator('#browse-size-input').fill('3'); await page.locator('[data-action="browse-custom-size"]').click();
    await page.locator('#search').click(); await tick();
    await page.locator('[data-action="next-page"]').click();
    await page.locator('.asset-card h3').first().click(); await tick();
    const before = await browseState();
    assert.equal(before.query, '教程图片'); assert.equal(before.cards.length, 3); assert.equal(before.selected.length, 1); assert.match(before.page, /第 2 \//);
    await openGuide();
    await guide().locator('[data-onboarding-step="3"]').click(); await step(3); await closeGuide();
    await visibleReturnFocus();
    assert.deepEqual(await browseState(), before, 'manual guide preserves search, category, current page, visible cards and selection');
    passed('existing demo library plus image library opens automatically; manual replay preserves category/search/page/selection/browse mode');
    await resize(850, 600);
    for (const layout of ['modern', 'classic']) {
      for (const theme of themeIds) {
        await chooseAppearance(layout, theme);
        const preserved = await browseState();
        await openGuide();
        for (let index = 0; index < stepTitles.length; index++) {
          if (index) await guide().locator(`[data-onboarding-step="${index}"]`).click();
          await step(index); await tick(); await measure(layout, theme, index);
          if (theme === 'bluewhite') await page.screenshot({ path: path.join(output, `${layout}-step-${index}-minimum.png`) });
        }
        await page.screenshot({ path: path.join(output, `${layout}-${theme}-minimum.png`) });
        await closeGuide('finish');
        assert.deepEqual(await browseState(), preserved, `${layout}/${theme}: guide leaves current browsing state intact`);
      }
    }
    passed('all six real-page highlights and anchored explanations fit 850×600 in both layouts and all six themes; browsing state stays intact');
    await chooseAppearance('modern', 'bluewhite');
    await page.locator('#browse').click(); await page.locator('#browse-size-input').fill('12'); await page.locator('[data-action="browse-custom-size"]').click();
    await page.locator('#search').click();
    await page.locator('.main').evaluate(element => { element.scrollTop = 0; }); await tick();
    await page.evaluate(() => {
      const main = document.querySelector('.main'), first = document.querySelector('#asset-grid .asset-card').getBoundingClientRect(), toolbar = document.querySelector('.library-toolbar').getBoundingClientRect();
      main.scrollTop = Math.max(80, first.bottom - toolbar.bottom + 24);
    });
    await tick(); const beforeScrollGuide = await browseState();
    assert.ok(beforeScrollGuide.scroll.find(item => item.selector === '.main').top > 0, 'the current finite page must actually scroll');
    await openGuide(); await guide().locator('[data-onboarding-step="3"]').click(); await step(3); await tick();
    const scrolled = await page.evaluate(() => {
      const highlighter = document.querySelector('[data-onboarding-target]'), selector = highlighter.dataset.targetSelector || highlighter.dataset.onboardingTarget;
      const target = document.querySelector(selector), first = document.querySelector('#asset-grid .asset-card');
      const rect = element => { const {left,right,top,bottom}=element.getBoundingClientRect();return {left,right,top,bottom}; };
      const main = document.querySelector('.main'), toolbar = document.querySelector('.library-toolbar');
      return { selector, actualCard: target.matches('.asset-card'), targetId: target.dataset.asset, firstId: first.dataset.asset, target: rect(target), first: rect(first), highlight: rect(highlighter), main: rect(main), toolbar: rect(toolbar), scrollTop: main.scrollTop };
    });
    scrollGeometries.push(scrolled);
    await page.screenshot({ path: path.join(output, 'scrolled-preview-step.png') });
    const clipTop = Math.max(scrolled.main.top, scrolled.toolbar.bottom);
    assert.equal(scrolled.actualCard, true, 'preview guidance on a scrolled page must highlight an actual visible asset card');
    assert.notEqual(scrolled.targetId, scrolled.firstId, 'the first card is behind the sticky toolbar and cannot be the preview target');
    assert.ok(scrolled.target.bottom > clipTop + 2 && scrolled.target.top < scrolled.main.bottom, 'the highlighted asset is in the usable scrolled content area');
    assert.ok(scrolled.highlight.top >= clipTop - 1 && scrolled.highlight.bottom <= scrolled.main.bottom + 1, 'the highlight is clipped to the main viewport below the sticky toolbar');
    assert.equal(scrolled.scrollTop, beforeScrollGuide.scroll.find(item => item.selector === '.main').top, 'opening guidance must not scroll the underlying page');
    await closeGuide(); await visibleReturnFocus();
    assert.deepEqual(await browseState(), beforeScrollGuide, 'closing the scrolled guide restores the same current page, cards, selection and scroll position');
    passed('after scrolling the current page, preview guidance highlights a visible actual card below the sticky toolbar and preserves scroll position');
    await closeApp();

    const concurrent = await scenario('concurrent'); await freezeLibrary(concurrent);
    await launch(concurrent, 'available'); await step(0);
    await waitForStartupCheck();
    assert.equal(await page.locator('#dialog[open] #update-panel').count(), 0, 'startup update must wait while the guide is open');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await closeGuide();
    await page.waitForSelector('#dialog[open] #update-panel');
    assert.equal(await guide().getAttribute('open'), null);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.screenshot({ path: path.join(output, 'deferred-startup-update.png') });
    await page.locator('#dialog [data-action="close-dialog"]').first().click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'startup reminder cannot reopen after it has been shown');
    passed('fixed offline startup release check waits for onboarding, opens once after closing it, and never stacks two dialogs');
    await closeApp();

    const destination = await scenario('concurrent-import'); await freezeLibrary(destination);
    await launch(destination, 'available'); await step(0); await waitForStartupCheck();
    await guide().locator('[data-onboarding-step="5"]').click(); await step(5); await action('import').click();
    await page.waitForSelector('#dialog[open] #dialog-title');
    assert.match(await page.locator('#dialog-title').textContent(), /导入素材/);
    assert.equal(await page.locator('#dialog[open] #update-panel').count(), 0, 'explicit import destination keeps priority over a pending update');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal(await storedStatus(), 'completed');
    await page.locator('#dialog [data-action="close-dialog"]').first().click();
    await page.waitForSelector('#dialog[open] #update-panel');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.locator('#dialog [data-action="close-dialog"]').first().click();
    passed('final import action opens the import dialog first; a pending startup update resumes only after that destination closes');
    await closeApp();
    await verifyLibraries();
    assert.deepEqual(errors, []); assert.deepEqual(nativeDialogs, []);
    passed('all original/demo bytes and isolated library index/managed/preview hashes remain unchanged; zero page errors or native dialogs');
    const result = { passed: true, groups: checks.length, checks, contexts, geometries, scrollGeometries, libraryHashes, originals: fixtures, pageErrors: errors, nativeDialogs, isolatedLibrary: true, installerCreated: false };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, geometries: `${geometries.length} measurements in result.json`, libraryHashes: libraryHashes.map(item => ({ scenario: item.scenario, files: Object.keys(item.before).length, unchanged: true })) }, null, 2));
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ scenario: currentScenario, checks, contexts, geometries, scrollGeometries, errors, message: error.message, stack: error.stack }, null, 2));
    throw error;
  } finally {
    await closeApp();
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('anshelf-onboarding-ui-'));
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
