/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-workspace-ui-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = process.env.ANSHELF_WORKSPACE_OUTPUT || path.join(root, 'test-output/workspace-update-ui');
  await fs.mkdir(output, { recursive: true });
  const source = path.join(temporary, '界面测试.fla'), image = path.join(temporary, '图片导入.png');
  const demo = (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla'));
  await fs.copyFile(path.join(root, 'demo', demo), source);
  await fs.copyFile(path.join(root, 'desktop/icon.png'), image);
  await fs.copyFile(image, source.replace(/\.fla$/, '.png'));
  const originalHashes = await Promise.all([source, image].map(async file => hash(await fs.readFile(file))));
  const sound = path.join(temporary, '试听验收.wav'), rate = 8000, samples = rate * 25, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index * 440 * Math.PI * 2 / rate) * 200), 44 + index * 2);
  await fs.writeFile(sound, wav);
  const library = await Library.open(data);
  const categories = library.snapshot().categories;
  const person = categories.find(item => item.systemKey === 'character');
  const city = categories.find(item => item.parentId === person.id && item.name === '现代都市');
  const child = await library.createCategory('逐层分类验收', city.id, 'ordinary');
  const imported = (await library.importPaths([source], { categoryId: child.id })).assets[0];
  for (let index = 1; index < 65; index++) {
    const copy = await library.duplicateAsset(imported.id);
    await library.updateAsset(copy.id, { name: '测试角色 ' + String(index).padStart(2, '0') });
  }
  let app, page; const errors = [], checks = [], contexts = [], geometries = [], onboarding = [];
  const executable = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const closeDialog = () => page.locator('#dialog [data-action="close-dialog"]').first().click();
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function launch() {
    app = await _electron.launch({ executablePath: executable, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    const context = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath, profile: app.getPath('userData'), library: process.env.ANSHELF_DATA_DIR }));
    assert.equal(context.packaged, Boolean(process.env.ANSHELF_UI_EXECUTABLE));
    assert.equal(context.version, require(path.join(root, 'package.json')).version);
    for (const [actual, expected] of [[context.executable, executable], [context.profile, profile], [context.library, data]]) assert.equal(path.resolve(actual).toLowerCase(), path.resolve(expected).toLowerCase());
    contexts.push(context);
    page = await app.firstWindow(); page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.asset-card');
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
    await page.evaluate(() => localStorage.setItem('anshelf-check-updates-on-start', 'false'));
  }
  async function resize(width, height) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '安安素材管理器').setContentSize(...size), [width, height]);
    await page.waitForFunction(([width, height]) => Math.abs(innerWidth - width) < 3 && Math.abs(innerHeight - height) < 3, [width, height]);
    await tick();
  }
  async function browse(action, value) {
    await page.locator('#browse').click();
    if (action === 'custom') { await page.locator('#browse-size-input').fill(String(value)); await page.locator('[data-action="browse-custom-size"]').click(); }
    else await page.locator(`[data-action="browse-${action}"][data-browse-${action}="${value}"]`).click();
    await page.locator('#search').click(); await tick();
  }
  async function all() { await page.locator('#navigation [data-id="all"]').click(); await page.locator('#search').fill(''); await tick(); }
  async function checkTopActions() {
    const geometry = await page.evaluate(() => {
      const rect = selector => { const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
      return { width: innerWidth, sidebar: rect('.sidebar'), navigation: rect('#navigation'), import: rect('.import-entries'), tools: rect('#workspace-tools > summary'), search: rect('#search'), firstCard: rect('.asset-card'), oldToolbarHeight: document.querySelector('.library-toolbar .topbar').getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    geometries.push({ kind: 'top actions', ...geometry });
    for (const action of [geometry.import, geometry.tools]) {
      assert.ok(action.y >= geometry.sidebar.y && action.bottom <= geometry.sidebar.bottom + 1, 'import and tools share the root category row');
      assert.ok(action.right <= geometry.width && action.x >= geometry.navigation.right - 1, 'top actions remain visible beside navigation');
    }
    assert.equal(geometry.oldToolbarHeight, 0, 'the former action row no longer consumes space');
    assert.equal(geometry.overflow, false);
    return geometry;
  }
  async function checkPreviewActions() {
    const geometry = await page.locator('.lightbox-actions').evaluate(container => {
      const row = container.getBoundingClientRect(), actions = [...container.children].map(element => { const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom }; });
      return { width: innerWidth, left: row.left, right: row.right, actions };
    });
    geometries.push({ kind: 'preview actions', ...geometry });
    assert.ok(Math.abs(geometry.right - geometry.actions.at(-1).right) < 2, 'preview actions align to the right edge');
    assert.ok(geometry.actions.every(action => action.left >= geometry.left - 1 && action.right <= geometry.right + 1), 'wrapped preview actions remain within their panel');
  }
  try {
    await launch(); await resize(1480, 940);
    assert.equal((await page.locator('.titlebar-wordmark').textContent()).trim(), '安安素材管理器');
    assert.equal(await page.locator('.titlebar-wordmark .anan-wordmark').count(), 1);
    await checkTopActions();
    checks.push('AN logo and full product name; actions occupy the top category row');
    assert.deepEqual(await page.locator('#navigation [data-system-key] span').allTextContents(), ['人物', '背景', '表情', '道具', '特效', '动物异兽', '音效', 'BGM']);
    checks.push('eight initial roots');
    await page.locator('#density').click(); await page.locator('[data-density="7"]').click(); await tick();
    let count = await page.locator('.asset-card').count();
    const columns = Number(await page.locator('#asset-grid').getAttribute('data-columns'));
    assert.equal(columns, 7); assert.ok(count > 0 && count < 65 && count % columns === 0, 'fit mode fills every row before the final page');
    const firstPage = await page.locator('.asset-card').evaluateAll(cards => cards.map(card => card.dataset.asset));
    await page.locator('.asset-card h3').first().click(); await tick();
    assert.equal(await page.locator('#selection-bar').isVisible(), true);
    await page.locator('[data-action="next-page"]').click();
    await tick();
    assert.match(await page.locator('#asset-pagination').textContent(), /第 2 \//, 'clearing selection during a page turn does not reset the page');
    const secondPage = await page.locator('.asset-card').evaluateAll(cards => cards.map(card => card.dataset.asset));
    assert.ok(!secondPage.some(id => firstPage.includes(id)));
    checks.push('fit pagination fills rows and advances without overlap');

    await all();
    await page.locator('.asset-card h3').first().click();
    await page.locator('[data-action="toggle-quick-categories"]').click();
    assert.equal(await page.locator(`.quick-category-options [data-id="${child.id}"]`).count(), 0);
    await page.locator(`.quick-category-options [data-id="${person.id}"]`).click();
    await page.locator(`.quick-category-options [data-id="${city.id}"]`).waitFor({ state: 'visible' });
    await page.locator('#quick-category-filter').fill('逐层');
    assert.equal(await page.locator(`.quick-category-options [data-id="${city.id}"]`).count(), 1);
    await page.locator(`.quick-category-options [data-id="${city.id}"]`).click();
    await page.locator(`.quick-category-options [data-id="${child.id}"]`).waitFor({ state: 'visible' });
    await page.locator('[data-action="quick-browse-back"]').click();
    await page.locator('[data-action="quick-select-current"]').waitFor({ state: 'visible' });
    await page.locator('[data-action="deselect"]').click();
    checks.push('category assignment browses, searches and returns one level at a time');

    const originalId = await page.locator('.asset-card').first().getAttribute('data-asset');
    await page.locator(`.asset-card[data-asset="${originalId}"] [data-action="duplicate-file"]`).click();
    await page.locator('#duplicate-category-dialog').waitFor({ state: 'visible' });
    await page.locator('[data-copy-cancel]').first().click();
    assert.equal((await page.evaluate(() => window.shelf.snapshot())).assets.length, 65);
    await page.locator(`.asset-card[data-asset="${originalId}"] [data-action="favorite"]`).click();
    await page.locator('[data-action="collection"][data-collection="favorites"]').click();
    await page.locator(`.asset-card[data-asset="${originalId}"]`).waitFor({ state: 'visible' });
    await page.locator(`.asset-card[data-asset="${originalId}"] [data-action="duplicate-file"]`).click();
    await page.locator('#duplicate-category-dialog [data-select-trigger]').click();
    await page.locator(`[data-category-option="category:${person.id}"]`).click();
    await page.locator('[data-copy-confirm]').click();
    await page.locator('#confirm-dialog [data-confirm="accept"]').click();
    await page.waitForFunction(() => document.querySelector('#asset-count').textContent.includes('66'));
    const snapshot = await page.evaluate(() => window.shelf.snapshot());
    const copy = snapshot.assets.find(item => item.independentCopy && item.id !== originalId && item.categoryIds.includes(person.id));
    assert.ok(copy); assert.equal(snapshot.assets.find(item => item.id === originalId).categoryId, child.id);
    checks.push('copy destination selects a category; cancel has no effect');

    await browse('custom', 7); await all();
    assert.equal(await page.locator('.asset-card').count(), 7);
    for (const [width, height] of [[1480, 940], [930, 700], [850, 600]]) {
      await resize(width, height);
      await checkTopActions();
      const geometry = await page.evaluate(() => { const main = document.querySelector('.main'), cards = [...document.querySelectorAll('.asset-card')], search = document.querySelector('#search').getBoundingClientRect(), last = cards.at(-1).getBoundingClientRect(), pagination = document.querySelector('#asset-pagination').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, mainClient: main.clientHeight, mainScroll: main.scrollHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, searchTop: search.top, cardsBottom: last.bottom, pageBottom: pagination.bottom }; });
      geometries.push(geometry); assert.equal(geometry.horizontalOverflow, false); assert.ok(geometry.cardsBottom <= geometry.height + 1); assert.ok(geometry.pageBottom <= geometry.height + 1, 'fixed pagination remains reachable');
    }
    await resize(1480, 940); await browse('custom', 24); await browse('mode', 'scroll');
    assert.equal(await page.locator('#asset-pagination').isVisible(), true);
    const scrollFirstPage = await page.locator('.asset-card').evaluateAll(cards => cards.map(card => card.dataset.asset));
    assert.equal(scrollFirstPage.length, 24);
    await page.locator('.main').evaluate(main => { main.scrollTop = main.scrollHeight; main.dispatchEvent(new Event('scroll')); });
    await tick();
    assert.deepEqual(await page.locator('.asset-card').evaluateAll(cards => cards.map(card => card.dataset.asset)), scrollFirstPage, 'scrolling to the bottom never appends another page');
    const sticky = await page.locator('#search').boundingBox(); assert.ok(sticky.y >= 0 && sticky.y < 240);
    await page.locator('[data-action="next-page"]').click(); await tick();
    const scrollSecondPage = await page.locator('.asset-card').evaluateAll(cards => cards.map(card => card.dataset.asset));
    assert.equal(scrollSecondPage.length, 24); assert.ok(!scrollSecondPage.some(id => scrollFirstPage.includes(id)));
    assert.equal(await page.locator('.main').evaluate(main => main.scrollTop), 0, 'turning a page returns to its top');
    await page.locator('[data-action="next-page"]').click(); await tick();
    assert.equal(await page.locator('.asset-card').count(), 18, 'the final page contains only its remaining assets');
    assert.equal(await page.locator('[data-action="next-page"]').isDisabled(), true);
    await page.locator('#search').fill('测试角色 01'); await tick();
    assert.equal(await page.locator('.asset-card').count(), 1); assert.equal(await page.locator('#asset-pagination').isVisible(), false);
    await all(); assert.equal(await page.locator('.asset-card').count(), 24);
    checks.push('scroll browsing uses separate 24/24/18 pages, resets on search and never auto-appends');

    await page.locator('#workspace-tools').evaluate(node => { node._layoutIdentity = true; });
    await page.locator('.import-entries [data-action="import"]').evaluate(node => { node._layoutIdentity = true; });
    await page.locator('#workspace-tools > summary').click(); await page.locator('[data-action="appearance-settings"]').click();
    await page.locator('[data-appearance-layout="classic"]').click(); await tick();
    assert.equal(await page.locator('.brand').innerText(), '安安素材管理器');
    assert.equal(await page.locator('.library-toolbar .import-entries [data-action="import"]').isVisible(), true);
    assert.equal(await page.locator('.library-toolbar #workspace-tools > summary').isVisible(), true);
    await page.locator('[data-appearance-layout="modern"]').click(); await tick();
    await page.locator('[data-appearance-close]').first().click(); await checkTopActions();
    assert.equal(await page.locator('#workspace-tools').count(), 1);
    assert.equal(await page.locator('#workspace-tools').evaluate(node => node._layoutIdentity), true);
    assert.equal(await page.locator('.import-entries [data-action="import"]').evaluate(node => node._layoutIdentity), true);
    await page.locator('#workspace-tools > summary').click(); await page.locator('.workspace-tools-panel [data-action="author-message"]').click();
    await page.locator('#dialog-title').waitFor({ state: 'visible' }); await closeDialog();
    checks.push('classic/modern switching preserves the same working import and tools controls');
    await browse('mode', 'fit'); await browse('size', 'auto'); await all();

    await page.locator('.asset-card [data-action="zoom-preview"]').first().click();
    assert.equal(await page.locator('.preview-details').isVisible(), false);
    await checkPreviewActions(); await page.screenshot({ path: path.join(output, 'preview-actions-right.png') });
    await page.locator('#dialog-title').click();
    await page.locator('[data-preview-title-input]').fill('标题直接改名验收'); await page.locator('[data-preview-title-input]').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-preview-title-text]')?.textContent === '标题直接改名验收');
    await page.locator('[data-preview-details-toggle]').click(); assert.equal(await page.locator('.preview-details').isVisible(), true);
    await checkPreviewActions(); await resize(850, 600); await checkPreviewActions(); await resize(1480, 940);
    await closeDialog(); await page.locator('.asset-card [data-action="zoom-preview"]').first().click();
    assert.equal(await page.locator('.preview-details').isVisible(), true); await closeDialog();
    checks.push('preview actions align right and wrap safely; collapsed details and title rename persist');

    await app.evaluate(({ dialog }, image) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] }); }, image);
    await page.locator('.import-entries [data-action="import"]').click();
    assert.equal(await page.locator('.import-type-option').count(), 4);
    await page.locator('[data-action="import-select-type"][data-mode="image"]').click();
    await page.locator('[data-action="select-import-files"]').click();
    await page.locator('[data-action="confirm-import"]').waitFor({ state: 'visible' });
    assert.equal((await page.evaluate(() => window.shelf.snapshot())).assets.length, 66, 'selection waits for configuration');
    await page.locator('[data-action="confirm-import"]').click();
    await page.waitForFunction(() => !document.querySelector('#dialog').open);
    await all(); await page.locator('#search').fill('图片导入');
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 1);
    assert.equal(await page.locator('.asset-card [data-action="open-animate"]').count(), 0);
    assert.equal(await page.locator('.asset-card [data-action="send"]').count(), 1);
    await page.locator('.asset-card [data-action="zoom-preview"]').first().click();
    assert.match(await page.locator('.preview-details').textContent(), /本地图片/);
    assert.equal(await page.locator('#dialog [data-action="open-animate"], #dialog [data-action="retry"]').count(), 0);
    assert.equal(await page.locator('.lightbox-preview img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    await closeDialog();
    checks.push('unified image import waits for configuration and displays local pixels');

    const dragged = path.join(temporary, '拖入验收.png'); await fs.copyFile(image, dragged);
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'test-file-drop'; document.body.append(input); });
    await page.locator('#test-file-drop').setInputFiles(dragged);
    await page.locator('#test-file-drop').evaluate(input => { const transfer = new DataTransfer(); for (const file of input.files) transfer.items.add(file); document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); input.remove(); });
    await page.locator('[data-action="confirm-import"]').waitFor({ state: 'visible' });
    assert.match(await page.locator('.import-detected-summary').textContent(), /拖入验收/);
    await closeDialog();
    checks.push('native file drop opens configuration without the import button');

    await app.evaluate(({ dialog }, sound) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sound] }); }, sound);
    await page.locator('.import-entries [data-action="import"]').click(); await page.locator('[data-action="import-select-type"][data-mode="audio"]').click(); await page.locator('[data-action="select-import-files"]').click(); await page.locator('[data-action="confirm-import"]').click(); await page.waitForFunction(() => !document.querySelector('#dialog').open);
    await all(); await page.locator('#search').fill('试听验收'); await page.locator('.asset-card [data-action="play-audio"]').click();
    await page.waitForFunction(() => document.querySelector('#audio-player').dataset.playing === 'true'); await all(); await tick();
    const playerFit = await page.evaluate(() => ({ pageBottom: document.querySelector('#asset-pagination').getBoundingClientRect().bottom, playerTop: document.querySelector('#audio-player').getBoundingClientRect().top }));
    assert.ok(playerFit.pageBottom <= playerFit.playerTop, 'pagination remains above the playing audio bar');
    await page.locator('[data-action="audio-stop"]').click();
    checks.push('audio playback keeps fixed pagination clear of the player');

    await all(); await browse('custom', 7);
    await page.locator('#workspace-tools > summary').click(); await page.locator('[data-action="appearance-settings"]').click(); await page.locator('[data-appearance-theme="bluewhite"]').click(); await page.locator('[data-appearance-preview-background="white"]').click(); await page.locator('[data-appearance-close]').first().click();
    await page.screenshot({ path: path.join(output, 'workspace-bluewhite.png') });
    await app.close(); app = null; await launch();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'bluewhite'); assert.equal(await page.locator('html').getAttribute('data-preview-background'), 'white'); assert.equal(await page.locator('.asset-card').count(), 7);
    await page.locator('.asset-card [data-action="zoom-preview"]').first().click(); assert.equal(await page.locator('.preview-details').isVisible(), true); await closeDialog();
    checks.push('restart restores browse size, appearance and details choice');
    await browse('mode', 'scroll'); await browse('custom', 24); await app.close(); app = null; await launch();
    assert.equal(await page.locator('#asset-grid').getAttribute('data-browse-mode'), 'scroll');
    assert.equal(await page.locator('.asset-card').count(), 24); assert.equal(await page.locator('#asset-pagination').isVisible(), true);
    await page.locator('.main').evaluate(main => { main.scrollTop = main.scrollHeight; main.dispatchEvent(new Event('scroll')); }); await tick();
    assert.equal(await page.locator('.asset-card').count(), 24);
    checks.push('restart restores scroll mode and its finite page size');
    assert.deepEqual(await Promise.all([source, image].map(async file => hash(await fs.readFile(file)))), originalHashes);
    assert.deepEqual(errors, []);
    const result = { passed: true, checks, groups: checks.length, contexts, geometries, onboarding, pageErrors: errors, originalsUnchanged: true, isolatedLibrary: true };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ checks, errors, geometries, message: error.message, stack: error.stack }, null, 2)); throw error;
  } finally {
    if (app) await app.close();
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir())); assert.ok(path.basename(temporary).startsWith('anshelf-workspace-ui-'));
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
