/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

async function pollSnapshot(page, predicate) {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    const snapshot = await page.evaluate(() => window.shelf.snapshot());
    if (predicate(snapshot)) return snapshot;
    await page.waitForTimeout(100);
  }
  throw new Error('Import did not reach its committed preview state');
}

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-category-ui-'));
  const checks = [], errors = [];
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const launch = () => _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
  let app;
  async function create(page, name, scope, parentId = null) {
    await page.locator('#subcategories [data-action="add-subcategory"]').click();
    assert.equal(await page.locator('#category-parent').inputValue(), parentId || '');
    assert.equal(await page.locator('#category-scope').inputValue(), scope);
    assert.equal(await page.locator('#category-scope').isDisabled(), !!parentId);
    await page.locator('#category-name').fill(name);
    await page.locator('[data-action="save-category"]').click();
    await page.waitForFunction(name => [...document.querySelectorAll('#categories .nav-item span')].some(item => item.textContent === name), name);
    return (await page.evaluate(() => window.shelf.snapshot())).categories.find(item => item.name === name);
  }
  try {
    app = await launch(); let page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#empty-state:not([hidden])');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
    assert.equal(await page.locator('#subcategories').isVisible(), false);
    await page.locator('#navigation [data-id="effects"]').click();
    assert.equal(await page.locator('#subcategories').isVisible(), true);
    const flame = await create(page, '火焰', 'effect');
    const smoke = await create(page, '烟雾', 'effect');
    assert.equal(flame.scope, 'effect'); assert.equal(flame.parentId, null);
    await page.locator(`#subcategories [data-id="${flame.id}"]`).click();
    const magic = await create(page, '魔法火焰', 'effect', flame.id);
    assert.equal(magic.parentId, flame.id); assert.equal(magic.scope, 'effect');
    assert.equal(await page.locator('#subcategories .subcategory-folder').count(), 1);
    assert.ok(await page.locator('#subcategories .subcategory-folder').first().evaluate(element => element.classList.contains('button')));
    assert.equal(await page.locator(`#subcategories [data-id="${smoke.id}"]`).count(), 0);
    await page.locator(`#subcategories [data-id="${magic.id}"]`).click();
    assert.equal(await page.locator('#subcategories .subcategory-folder').count(), 0);
    assert.match(await page.locator('#breadcrumb').textContent(), /火焰.*魔法火焰/);
    await page.locator('#subcategories [data-action="category"]').click();
    assert.equal(await page.locator(`#subcategories [data-id="${magic.id}"]`).count(), 1);
    await page.locator('#subcategories .subcategory-up').click();
    assert.equal(await page.locator('#subcategories .subcategory-folder').count(), 2);
    checks.push('effect root categories, immediate children, empty leaves and return navigation');
    await page.locator('#navigation [data-id="audio"]').click();
    const sound = await create(page, '音效', 'audio');
    assert.equal(sound.scope, 'audio');
    assert.equal(await page.locator(`#subcategories [data-id="${flame.id}"]`).count(), 0);
    await page.locator('#navigation [data-id="ordinary"]').click();
    const weapons = await create(page, '普通武器', 'ordinary');
    assert.equal(weapons.scope, 'ordinary');
    assert.equal(await page.locator(`#subcategories [data-id="${sound.id}"]`).count(), 0);
    const urban = await create(page, '都市人物', 'ordinary');
    await page.locator(`#subcategories [data-id="${urban.id}"]`).click();
    const female = await create(page, '女', 'ordinary', urban.id);
    assert.equal(await page.locator(`#subcategories [data-id="${female.id}"]`).count(), 1);
    assert.match(await page.locator('#breadcrumb').textContent(), /普通素材.*都市人物/);
    await page.locator('#breadcrumb [data-id="ordinary"]').click();
    assert.equal(await page.locator(`#subcategories [data-id="${urban.id}"]`).count(), 1);
    checks.push('ordinary, effect and audio category buttons remain separate');
    checks.push('ordinary folder buttons drill into deeper child folders and breadcrumb returns');
    // Import destination workflow: create a top-level folder, select it, then
    // create and select a child without leaving the import dialog.
    await page.locator('[data-action="import"][data-mode="ordinary"]').click();
    await page.locator('[data-action="import-create-category"]').click();
    await page.locator('#import-folder-name').fill('导入归类');
    await page.locator('[data-action="save-import-folder"]').click();
    await page.waitForFunction(() => !!document.querySelector('#import-category')?.value);
    const importRoot = (await page.evaluate(() => window.shelf.snapshot())).categories.find(item => item.name === '导入归类');
    assert.ok(importRoot);
    assert.equal(await page.locator('#import-category').inputValue(), importRoot.id);
    await page.locator('[data-action="import-create-child-category"]').click();
    await page.locator('#import-folder-name').fill('导入子类');
    await page.locator('[data-action="save-import-folder"]').click();
    await page.waitForFunction(() => document.querySelector('#import-category')?.value && document.querySelector('#import-category option:checked')?.textContent.includes('导入子类'));
    const importChild = (await page.evaluate(() => window.shelf.snapshot())).categories.find(item => item.name === '导入子类');
    assert.ok(importChild); assert.equal(importChild.parentId, importRoot.id);
    assert.equal(await page.locator('#import-category').inputValue(), importChild.id);
    await page.locator('[data-action="close-dialog"]').click();
    checks.push('import can create a folder, select it and create a selected child folder');
    await page.locator('#navigation [data-id="effects"]').click();
    await page.screenshot({ path: path.join(root, 'test-output/category-effects.png'), scale: 'css', animations: 'disabled' });
    await page.locator('[data-action="import"][data-mode="ordinary"]').click();
    assert.equal(await page.locator('#custom-preview-resolution').isChecked(), false);
    assert.equal(await page.locator('#preview-resolution').isDisabled(), true);
    await page.locator('#custom-preview-resolution').check();
    assert.equal(await page.locator('#preview-resolution').isDisabled(), false);
    await page.locator('#preview-resolution').selectOption('2048');
    await page.locator('#prefer-preview').uncheck();
    await page.screenshot({ path: path.join(root, 'test-output/import-resolution-2k.png'), scale: 'css', animations: 'disabled' });
    await page.locator('#import-category').selectOption(importChild.id);
    const file = path.join(root, 'demo', (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla')));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await page.locator('[data-action="import-files"]').click();
    let snapshot = await pollSnapshot(page, state => state.assets.length === 1 && state.assets[0].previewStatus === 'ready');
    assert.equal(snapshot.assets[0].previewResolution, 2048); assert.equal(snapshot.assets[0].assetType, 'ordinary'); assert.equal(snapshot.assets[0].categoryId, importChild.id);
    checks.push('optional 2K setting reaches real import and persists on the asset');
    const archive = await fs.readFile(file), end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(end >= 0);
    const comment = Buffer.from('anshelf-effect-resolution-check'); archive.writeUInt16LE(comment.length, end + 20);
    const effectFile = path.join(temporary, 'effect-resolution.fla');
    await fs.writeFile(effectFile, Buffer.concat([archive.subarray(0, end + 22), comment]));
    await page.locator('[data-action="import"][data-mode="effect"]').click();
    assert.equal(await page.locator('#preview-resolution').isDisabled(), true);
    await page.locator('#custom-preview-resolution').check();
    await page.locator('#preview-resolution').selectOption('256');
    await page.locator('#prefer-preview').uncheck();
    assert.equal(await page.locator('.resolution-note').isVisible(), true);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, effectFile);
    await page.locator('[data-action="import-files"]').click();
    snapshot = await pollSnapshot(page, state => state.assets.length === 2 && state.assets.some(asset => asset.sourcePaths.includes(effectFile) && asset.previewStatus === 'ready'));
    const effectAsset = snapshot.assets.find(asset => asset.sourcePaths.includes(effectFile));
    assert.equal(effectAsset.previewResolution, 256); assert.equal(effectAsset.assetType, 'effect');
    checks.push('effect import applies selected resolution and reports animation budget');
    // Regression: choosing a typed child category from the sidebar must switch
    // the active type scope. The old UI retained the previous scope, so a
    // cross-type click rendered an empty grid even though the asset matched.
    await page.evaluate(({ id, category }) => window.shelf.assignCategory([id], category), { id: effectAsset.id, category: flame.id });
    await page.waitForFunction(({ id, category }) => window.shelf.snapshot().then(state => state.assets.some(asset => asset.id === id && asset.categoryId === category)), { id: effectAsset.id, category: flame.id });
    await page.waitForTimeout(1700);
    await page.locator(`#navigation [data-id="audio"]`).click();
    const audioFile = path.join(temporary, 'regression.mp3');
    await fs.writeFile(audioFile, Buffer.from('anshelf-regression-audio'));
    await page.locator('[data-action="import"][data-mode="audio"]').click();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, audioFile);
    await page.locator('[data-action="import-files"]').click();
    snapshot = await pollSnapshot(page, state => state.assets.some(asset => asset.sourcePaths.includes(audioFile)));
    const audioAsset = snapshot.assets.find(asset => asset.sourcePaths.includes(audioFile));
    await page.evaluate(({ id, category }) => window.shelf.assignCategory([id], category), { id: audioAsset.id, category: sound.id });
    await page.waitForFunction(({ id, category }) => window.shelf.snapshot().then(state => state.assets.some(asset => asset.id === id && asset.categoryId === category)), { id: audioAsset.id, category: sound.id });
    await page.waitForTimeout(1700);
    await page.locator(`#categories .nav-item[data-id="${flame.id}"]`).click();
    await page.waitForSelector(`.asset-card[data-asset="${effectAsset.id}"]`);
    await page.locator(`#categories .nav-item[data-id="${sound.id}"]`).click();
    await page.waitForSelector(`.asset-card[data-asset="${audioAsset.id}"]`);
    checks.push('sidebar typed categories switch ordinary/effect/audio scope');

    // Regression: a legacy/shared category remains reachable from each typed
    // root and its breadcrumb returns to that root, rather than to "全部".
    const shared = await page.evaluate(() => window.shelf.createCategory('旧共享回归类目'));
    await page.evaluate(({ ids, category }) => window.shelf.assignCategory(ids, category), { ids: [effectAsset.id, audioAsset.id], category: shared.id });
    await page.waitForFunction(({ ids, category }) => window.shelf.snapshot().then(state => ids.every(id => state.assets.some(asset => asset.id === id && asset.categoryId === category))), { ids: [effectAsset.id, audioAsset.id], category: shared.id });
    await page.waitForTimeout(1700);
    await page.locator('#navigation [data-id="effects"]').click();
    await page.locator(`#categories .nav-item[data-id="${shared.id}"]`).click();
    await page.waitForSelector('#subcategories .subcategory-up[data-id="effects"]');
    await page.locator('#navigation [data-id="audio"]').click();
    await page.locator(`#categories .nav-item[data-id="${shared.id}"]`).click();
    await page.waitForSelector('#subcategories .subcategory-up[data-id="audio"]');
    checks.push('legacy shared category returns to the active typed root');
    await page.locator('[data-action="import"][data-mode="audio"]').click();
    assert.equal(await page.locator('#custom-preview-resolution').count(), 0);
    assert.equal(await page.locator('#preview-resolution').count(), 0);
    await page.locator('[data-action="close-dialog"]').click();
    checks.push('audio import has no preview resolution controls');
    await app.close(); app = await launch(); page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.asset-card');
    snapshot = await page.evaluate(() => window.shelf.snapshot());
    assert.equal(snapshot.categories.find(item => item.id === magic.id).parentId, flame.id);
    assert.equal(snapshot.categories.find(item => item.id === sound.id).scope, 'audio');
    assert.equal(snapshot.assets.find(item => item.sourcePaths.some(source => source.includes('demo'))).previewResolution, 2048);
    assert.equal(snapshot.assets.find(item => item.sourcePaths.some(source => source === path.join(temporary, 'effect-resolution.fla'))).previewResolution, 256);
    await page.locator('#navigation [data-id="effects"]').click();
    assert.equal(await page.locator('#subcategories .subcategory-folder').count(), 3);
    const demoAsset = snapshot.assets.find(asset => asset.sourcePaths.some(source => source.includes('demo')));
    await page.evaluate(({ id, category }) => window.shelf.updateAsset(id, { favorite: true, categoryId: category }), { id: demoAsset.id, category: female.id });
    await page.waitForTimeout(1700);
    await page.locator('#navigation [data-id="ordinary"]').click();
    await page.locator('#navigation [data-id="favorites"]').click();
    await page.waitForSelector(`#subcategories [data-id="${female.id}"]`);
    assert.match(await page.locator('#subcategories').textContent(), /都市人物 \/ 女/);
    await page.locator(`#subcategories [data-id="${female.id}"]`).click();
    await page.waitForSelector(`.asset-card[data-asset="${demoAsset.id}"]`);
    await page.screenshot({ path: path.join(root, 'test-output/category-favorites.png'), fullPage: true });
    await page.locator('#navigation [data-id="liked"]').click();
    assert.equal(await page.locator('#subcategories').isVisible(), false);
    checks.push('favorites reuse original category paths while likes stay ungrouped');
    checks.push('category hierarchy, type and preview resolution survive restart');
    assert.deepEqual(errors, []);
    const report = { passed: checks.length, checks, pageErrors: errors };
    await fs.writeFile(path.join(root, 'test-output/category-ui-e2e-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { if (app) await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
