/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');
const memberships = asset => [...new Set([asset.categoryId, ...(asset.categoryIds || [])].filter(Boolean))].sort();

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-category-removal-'));
  const data = path.join(temporary, 'library'), output = path.join(root, 'test-output/category-removal');
  await fs.mkdir(output, { recursive: true });
  const library = await Library.open(data), demos = (await fs.readdir(path.join(root, 'demo'))).filter(name => name.endsWith('.fla')).slice(0, 3);
  assert.equal(demos.length, 3);
  const sources = [], originals = [];
  for (let i = 0; i < demos.length; i++) {
    const file = path.join(temporary, ['跨剧人物', '子类人物', '新分类专用'][i] + '.fla');
    await fs.copyFile(path.join(root, 'demo', demos[i]), file);
    sources.push(file); originals.push(await fs.readFile(file));
  }
  const imported = (await library.importPaths(sources)).assets;
  assert.equal(imported.length, 3);
  const [shared, nested, onlyB] = imported;
  const a = await library.createCategory('原分类'), b = await library.createCategory('新分类');
  const child = await library.createCategory('子文件夹', b.id);
  await library.assignCategory([shared.id, nested.id], a.id);
  await library.addToCategory([shared.id, onlyB.id], b.id);
  await library.addToCategory([nested.id], child.id);
  await library.updateAsset(nested.id, { favorite: true, liked: true });
  const managed = new Map(imported.map(asset => [asset.id, asset.managedPath]));
  let app, page;
  const checks = [], errors = [], confirmations = [];
  try {
    const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
    app = await _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), `--user-data-dir=${path.join(temporary, 'profile')}`], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    const snapshot = () => page.evaluate(() => window.shelf.snapshot());
    const openCategory = async id => { await page.locator(`[data-action="category"][data-id="${id}"]`).first().click(); };
    const select = async id => { await page.locator(`[data-asset="${id}"] h3`).click(); };
    const confirm = async (action, accept, expected) => {
      await page.locator(`[data-action="${action}"]`).click();
      const dialog = page.locator('#confirm-dialog[open]'); await dialog.waitFor();
      const message = await dialog.locator('#confirm-message').textContent(); confirmations.push(message);
      assert.equal(await dialog.getAttribute('role'), 'alertdialog'); assert.match(message, expected);
      assert.equal(await page.locator('[data-confirm="cancel"]').evaluate(button => document.activeElement === button), true);
      await dialog.locator(`[data-confirm="${accept ? 'accept' : 'cancel'}"]`).click();
      await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.body.classList.contains('is-busy'));
    };
    await page.waitForSelector('.asset-card');
    await openCategory(b.id); await select(shared.id);
    assert.equal(await page.locator('[data-action="remove"]').textContent(), '从当前分类移除');
    assert.equal(await page.locator('[data-action="remove-library"]').textContent(), '从素材库移除');
    await confirm('remove', false, /新分类.*子分类/);
    assert.deepEqual(memberships((await snapshot()).assets.find(asset => asset.id === shared.id)), [a.id, b.id].sort());
    checks.push('a real folder offers category removal by default and cancel preserves every membership');

    await confirm('remove', true, /其他分类.*素材库.*保留/);
    await page.waitForFunction(id => !document.querySelector(`[data-asset="${id}"]`), shared.id);
    let current = await snapshot();
    assert.equal(current.assets.length, 3);
    assert.deepEqual(memberships(current.assets.find(asset => asset.id === shared.id)), [a.id]);
    await openCategory(a.id); assert.equal(await page.locator(`[data-asset="${shared.id}"]`).count(), 1);
    assert.equal(current.assets.find(asset => asset.id === shared.id).managedPath, managed.get(shared.id));
    checks.push('removing B keeps the shared material, its A membership and managed file unchanged');

    await page.locator('[data-action="undo-assign"]').click();
    await openCategory(b.id);
    await select(shared.id);
    await page.keyboard.press('Control+A');
    assert.equal(await page.locator('.asset-card.selected').count(), 3);
    await confirm('remove', true, /新分类.*子分类/);
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 0);
    current = await snapshot();
    assert.equal(current.assets.length, 3);
    assert.deepEqual(memberships(current.assets.find(asset => asset.id === shared.id)), [a.id]);
    assert.deepEqual(memberships(current.assets.find(asset => asset.id === nested.id)), [a.id]);
    assert.deepEqual(memberships(current.assets.find(asset => asset.id === onlyB.id)), []);
    await page.locator('[data-action="undo-assign"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 3);
    current = await snapshot();
    assert.deepEqual(memberships(current.assets.find(asset => asset.id === nested.id)), [a.id, child.id].sort());
    checks.push('parent-folder removal includes descendant memberships in one undoable batch; other folders and unclassified assets survive');

    await page.reload(); await page.waitForSelector('.asset-card');
    await openCategory(b.id); await select(shared.id);
    await confirm('remove-library', false, /所有分类、收藏和点赞/);
    assert.equal((await snapshot()).assets.length, 3);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(930, 700));
    assert.equal(await page.locator('#selection-bar').evaluate(bar => bar.scrollWidth <= bar.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'folder-removal.png'), scale: 'css' });
    await confirm('remove-library', true, /整个素材库/);
    await page.waitForFunction(id => !document.querySelector(`[data-asset="${id}"]`), shared.id);
    current = await snapshot(); assert.equal(current.assets.length, 2);
    assert.equal(current.assets.some(asset => asset.id === shared.id), false);
    await openCategory(a.id); assert.equal(await page.locator(`[data-asset="${shared.id}"]`).count(), 0);
    checks.push('explicit library removal confirms all-category impact, cancel is safe and accepting removes the record everywhere');

    await openCategory(child.id); await select(nested.id);
    await confirm('remove', true, /新分类 \/ 子文件夹/);
    assert.doesNotMatch(confirmations.at(-1), /及其子分类/);
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 0);
    assert.deepEqual(memberships((await snapshot()).assets.find(asset => asset.id === nested.id)), [a.id]);
    await openCategory(b.id); await select(onlyB.id);
    await confirm('remove', true, /其他分类.*保留/);
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 0);
    checks.push('leaf-folder confirmation names its complete path and a material with no remaining memberships becomes unclassified');

    for (const view of ['all', 'ordinary', 'favorites', 'liked', 'uncategorized']) {
      await openCategory(view);
      assert.ok(await page.locator('.asset-card').count(), view);
      await select(await page.locator('.asset-card').first().getAttribute('data-asset'));
      assert.equal(await page.locator('[data-action="remove"]').textContent(), '从素材库移除');
      assert.equal(await page.locator('[data-action="remove-library"]').count(), 0);
      await confirm('remove', false, /并非只移出当前页面/);
      assert.equal((await snapshot()).assets.length, 2);
    }
    current = await snapshot();
    for (let i = 0; i < sources.length; i++) assert.deepEqual(await fs.readFile(sources[i]), originals[i]);
    for (const asset of current.assets) { assert.equal(asset.managedPath, managed.get(asset.id)); await fs.access(path.join(data, asset.managedPath)); }
    assert.deepEqual(errors, []);
    checks.push('virtual views label global removal clearly, original source bytes and remaining managed files stay unchanged, no page errors');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, confirmations, pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
