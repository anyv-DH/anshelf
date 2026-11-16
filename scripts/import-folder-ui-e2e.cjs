/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { chooseThemedOption } = require('./ui-select.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-import-folder-ui-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = path.join(root, 'test-output/import-folder-ui');
  await fs.mkdir(output, { recursive: true });
  const demos = (await fs.readdir(path.join(root, 'demo'))).filter(file => file.endsWith('.fla'));
  assert.ok(demos.length >= 3);
  const files = [path.join(temporary, '顶级导入.fla'), path.join(temporary, '素材文件夹/子类导入.fla'), path.join(temporary, '特效导入.fla')];
  await fs.mkdir(path.dirname(files[1]), { recursive: true });
  for (let index = 0; index < files.length; index++) await fs.copyFile(path.join(root, 'demo', demos[index]), files[index]);
  const originals = await Promise.all(files.map(file => fs.readFile(file)));
  const checks = [], errors = [];
  let app, page;
  async function launch() {
    app = await _electron.launch({
      executablePath: process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron')),
      args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile],
      env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000,
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('[data-action="import"][data-mode="ordinary"]');
    await page.evaluate(() => localStorage.setItem('anshelf-check-updates-on-start', 'false'));
  }
  const snapshot = () => page.evaluate(() => window.shelf.snapshot());
  async function open(mode) {
    if (await isModern() && await page.locator('[data-top-categories]').getAttribute('aria-expanded') === 'true') {
      await page.keyboard.press('Escape');
    }
    const selector = '[data-action="import"][data-mode="' + mode + '"]';
    await page.locator(selector).click();
  }
  const isModern = () => page.evaluate(() => document.documentElement.dataset.layout === 'modern');
  async function openCategories() {
    if (await isModern() && await page.locator('[data-top-categories]').getAttribute('aria-expanded') !== 'true') {
      await page.locator('[data-top-categories]').click();
    }
  }
  async function create(name, child = false) {
    await page.locator(`[data-action="${child ? 'import-create-child-category' : 'import-create-category'}"]`).click();
    await page.locator('#import-folder-name').fill(name);
    await page.locator('[data-action="save-import-folder"]').click();
    let committed = false;
    for (let attempt = 0; attempt !== 60; attempt += 1) {
      const selectedText = await page.locator('#import-category option:checked').textContent().catch(() => '');
      const busy = await page.locator('body.is-busy').count();
      if (selectedText?.includes(name) && busy === 0) {
        committed = true;
        break;
      }
      await page.waitForTimeout(250);
    }
    assert.equal(committed, true, '导入文件夹提交超时');
    const category = (await snapshot()).categories.find(category => category.name === name);
    assert.ok(category);
    assert.equal(await page.locator('#import-category').inputValue(), category.id);
    assert.match(await page.locator('[data-select-trigger="import-category"]').innerText(), new RegExp(name));
    return category;
  }
  async function importFile(file, category, method = 'import-files') {
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, file);
    await page.locator(`[data-action="${method}"]`).click();
    const deadline = Date.now() + 90000;
    let asset;
    while (Date.now() < deadline) {
      asset = (await snapshot()).assets.find(asset => asset.sourcePaths.some(source => source === (method === 'import-folder' ? files[1] : file)));
      if (asset?.previewStatus === 'ready') break;
      if (asset?.previewStatus === 'failed') throw new Error(asset.previewError || 'Offline preview failed');
      await page.waitForTimeout(100);
    }
    assert.equal(asset?.previewStatus, 'ready');
    assert.equal(asset.categoryId, category.id);
    assert.deepEqual(asset.categoryIds, [category.id]);
    await page.locator(`.asset-card[data-asset="${asset.id}"]`).waitFor();
    await page.locator(`.asset-card[data-asset="${asset.id}"] .preview-origin.ready`).waitFor();
    assert.match(await page.locator('#breadcrumb').textContent(), new RegExp(category.name));
    return asset;
  }
  try {
    await launch();
    await page.locator('#navigation [data-system-key="effect"]').click();
    await page.locator('#search').fill('旧搜索不会匹配');
    await openCategories();
    await page.locator('#category-filter').fill('旧分类筛选');
    await open('ordinary');
    await page.locator('#prefer-preview').uncheck();
    await page.locator('#custom-preview-resolution').check();
    await chooseThemedOption(page, '#preview-resolution', '2048');
    const parent = await create('导入新建顶级');
    assert.equal(parent.scope, 'ordinary'); assert.equal(parent.parentId, null);
    assert.equal(await page.locator('#search').inputValue(), '');
    assert.equal(await page.locator('#category-filter').inputValue(), '');
    assert.equal(await page.locator('#prefer-preview').isChecked(), false);
    assert.equal(await page.locator('#preview-resolution').inputValue(), '2048');
    assert.equal(await page.locator('#custom-preview-resolution').isChecked(), true);
    const modern = await isModern();
    if (modern) {
      await page.locator('#dialog [data-action="close-dialog"]').click();
      await openCategories();
    }
    assert.equal(await page.locator(`#categories .nav-item[data-id="${parent.id}"]`).isVisible(), true);
    if (modern) {
      await page.keyboard.press('Escape');
      await open('ordinary');
      assert.equal(await page.locator('#import-category').inputValue(), parent.id);
      assert.equal(await page.locator('#preview-resolution').inputValue(), '2048');
      assert.equal(await page.locator('#prefer-preview').isChecked(), false);
    }
    const parentAsset = await importFile(files[0], parent);
    assert.equal(parentAsset.assetType, 'ordinary'); assert.equal(parentAsset.previewResolution, 2048);
    checks.push('creating an ordinary folder from the effect view reveals it and imports directly into it, preserving 2K and clearing hiding filters');

    await open('ordinary');
    assert.equal(await page.locator('#import-category').inputValue(), parent.id);
    await page.locator('[data-action="import-create-child-category"]').click();
    await page.locator('#import-folder-name').fill('取消的新子类');
    const beforeCancel = await fs.readFile(path.join(data, 'library.json'));
    await page.locator('[data-action="cancel-import-folder"]').click();
    assert.deepEqual(await fs.readFile(path.join(data, 'library.json')), beforeCancel);
    assert.equal(await page.locator('#import-category').inputValue(), parent.id);
    await page.locator('[data-action="import-create-category"]').click();
    await page.locator('#import-folder-name').fill(parent.name);
    await page.locator('[data-action="save-import-folder"]').click();
    await page.waitForFunction(() => !document.body.classList.contains('is-busy'));
    assert.equal(await page.locator('#import-category').inputValue(), parent.id);
    assert.equal((await snapshot()).categories.filter(category => category.name === parent.name).length, 1);
    await page.locator('[data-action="cancel-import-folder"]').click();
    const child = await create('导入新建子类', true);
    assert.equal(child.parentId, parent.id); assert.equal(child.scope, 'ordinary');
    assert.equal(await page.locator('#preview-resolution').inputValue(), '2048');
    assert.equal(await page.locator('#prefer-preview').isChecked(), false);
    const childAsset = await importFile(path.dirname(files[1]), child, 'import-folder');
    assert.equal(childAsset.previewResolution, 2048);
    checks.push('cancelled or duplicate folder creation preserves the destination; creating a child then importing a whole source folder assigns its real file correctly');

    await open('effect');
    await page.locator('#custom-preview-resolution').check();
    await chooseThemedOption(page, '#preview-resolution', '256');
    await page.locator('#prefer-preview').uncheck();
    const effect = await create('导入新建特效');
    assert.equal(effect.scope, 'effect');
    const effectAsset = await importFile(files[2], effect);
    assert.equal(effectAsset.assetType, 'effect'); assert.equal(effectAsset.previewResolution, 256);
    checks.push('new effect folders keep their own type and resolution and receive the imported effect asset');

    await page.screenshot({ path: path.join(output, 'new-folder-applied.png'), animations: 'disabled' });
    await app.close(); app = null;
    await launch();
    const reopened = await snapshot();
    for (const category of [parent, child, effect]) assert.deepEqual(reopened.categories.find(item => item.id === category.id), category);
    for (const asset of [parentAsset, childAsset, effectAsset]) {
      const saved = reopened.assets.find(item => item.id === asset.id);
      assert.equal(saved.categoryId, asset.categoryId); assert.deepEqual(saved.categoryIds, asset.categoryIds);
    }
    await openCategories();
    await page.locator(`#categories .nav-item[data-id="${child.id}"]`).click();
    await page.locator(`.asset-card[data-asset="${childAsset.id}"]`).waitFor();
    for (let index = 0; index < files.length; index++) assert.deepEqual(await fs.readFile(files[index]), originals[index]);
    checks.push('top-level, child and effect folders and all memberships survive a real restart; original source files remain byte-identical');
    assert.deepEqual(errors, []);
    const report = { passed: checks.length, checks, pageErrors: errors };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, pageErrors: errors, error: error.stack }, null, 2));
    throw error;
  } finally {
    if (app) await app.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
