/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const { chooseThemedOption } = require('./ui-select.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-navigation-ui-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = process.env.ANSHELF_NAVIGATION_OUTPUT || path.join(root, 'test-output/navigation-update-ui');
  await fs.mkdir(output, { recursive: true });
  const library = await Library.open(data);
  const legacy = await library.createCategory('已有的自建顶层', null, 'all');
  for (let index = 0; index < 12; index++) await library.createCategory('较长的项目分类 ' + (index + 1), null, 'all');
  const checks = [], contexts = [], errors = [], geometries = [];
  let app, page;
  const executable = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  async function launch() {
    app = await _electron.launch({ executablePath: executable, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    await app.evaluate(({ ipcMain, app }) => {
      globalThis.__navigationUpdateChecks = [];
      ipcMain.removeHandler('shelf:update-check');
      ipcMain.handle('shelf:update-check', (_event, options) => {
        globalThis.__navigationUpdateChecks.push(options);
        return { currentVersion: app.getVersion(), latestVersion: '99.0.0', status: 'available' };
      });
    });
    const context = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath, profile: app.getPath('userData'), library: process.env.ANSHELF_DATA_DIR }));
    assert.equal(context.packaged, !!process.env.ANSHELF_UI_EXECUTABLE);
    assert.equal(context.version, require('../package.json').version);
    assert.equal(path.resolve(context.executable).toLowerCase(), path.resolve(executable).toLowerCase());
    assert.equal(path.resolve(context.library), path.resolve(data));
    contexts.push(context);
    page = await app.firstWindow(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#navigation [data-system-key="character"]');
    await page.evaluate(() => localStorage.setItem('anshelf-check-updates-on-start', 'false'));
    await page.reload(); await page.waitForSelector('#navigation [data-system-key="character"]');
  }
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function categories() {
    if (await page.locator('[data-top-categories]').getAttribute('aria-expanded') !== 'true') await page.locator('[data-top-categories]').click();
  }
  const nav = id => page.locator(`#navigation [data-action="category"][data-id="${id}"]`);
  const snapshot = () => page.evaluate(() => window.shelf.snapshot());
  async function create(name, parent = '') {
    await categories();
    await page.locator('[data-action="create-category"]').click();
    await page.locator('#category-name').fill(name);
    if (parent) await chooseThemedOption(page, '#category-parent', parent);
    await page.locator('[data-action="save-category"]').click();
    await page.waitForFunction(() => !document.querySelector('#dialog').open && !document.body.classList.contains('is-busy'));
    const result = (await snapshot()).categories.find(item => item.name === name);
    assert.ok(result);
    return result;
  }
  async function selectedVisible(id) {
    const geometry = await nav(id).evaluate(button => {
      const item = button.getBoundingClientRect(), container = button.parentElement.getBoundingClientRect();
      return { left: item.left, right: item.right, top: item.top, bottom: item.bottom, containerLeft: container.left, containerRight: container.right, scrollLeft: button.parentElement.scrollLeft, active: button.classList.contains('active') };
    });
    geometries.push(geometry);
    assert.equal(geometry.active, true);
    assert.ok(geometry.left >= geometry.containerLeft - 2 && geometry.right <= geometry.containerRight + 2, 'selected root stays within its navigation viewport');
  }
  try {
    await launch();
    assert.equal(await nav(legacy.id).count(), 1);
    assert.deepEqual(await page.locator('#navigation [data-system-key] span').allTextContents(), ['人物', '背景', '表情', '道具', '特效', '动物异兽', '音效', 'BGM']);
    checks.push('existing custom roots and canonical system categories are both reachable');
    assert.equal(await page.locator('[data-top-more]').count(), 0);
    await categories(); await page.locator('#category-filter').fill('已有');
    assert.equal(await page.locator('.sidebar').evaluate(element => element.classList.contains('categories-open')), true);
    await page.locator('#category-filter').fill(''); await page.keyboard.press('Escape');
    await page.locator('#workspace-tools > summary').click();
    await page.locator('#workspace-tools [data-action="skin-settings"]').click();
    await page.waitForSelector('#skin-dialog[open]');
    await page.keyboard.press('Escape');
    checks.push('redundant more button removed; category search and relocated skin settings work');
    const top = await create('本次新建顶层');
    await page.waitForFunction(id => document.querySelector(`#navigation [data-id="${id}"]`)?.classList.contains('active'), top.id);
    assert.equal(top.parentId, null); assert.equal(await nav(top.id).count(), 1); await selectedVisible(top.id);
    checks.push('creating a regular root immediately displays, selects and reveals it');
    const child = await create('顶层的子分类', top.id);
    assert.equal(await nav(child.id).count(), 0);
    assert.equal(await page.locator(`#subcategories [data-id="${child.id}"]`).count(), 1);
    await nav(top.id).click();
    await categories(); await page.locator(`#categories [data-action="edit-category"][data-id="${top.id}"]`).click();
    await page.locator('#category-name').fill('改名后的顶层');
    await page.locator('[data-action="save-category"]').click();
    await page.waitForFunction(id => document.querySelector(`#navigation [data-id="${id}"]`)?.textContent.includes('改名后的顶层'), top.id);
    checks.push('children stay one level below; renaming updates the existing root');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === '安安素材管理器').setContentSize(850, 600));
    const firstRoot = (await snapshot()).categories.find(item => item.systemKey === 'character');
    await nav(firstRoot.id).click(); await nav(top.id).click(); await tick(); await selectedVisible(top.id);
    const layout = await page.evaluate(() => {
      const rect = selector => { const {left,right,top,bottom}=document.querySelector(selector).getBoundingClientRect();return {left,right,top,bottom}; };
      return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, import: rect('.import-entries'), tools: rect('#workspace-tools > summary') };
    });
    assert.equal(layout.overflow, false);
    for (const box of [layout.import, layout.tools]) assert.ok(box.left >= 0 && box.right <= layout.width);
    await page.screenshot({path:path.join(output,'custom-root-small.png')});
    checks.push('many roots in a minimum window remain horizontal; import and tools stay visible');
    await app.close(); app = null; await launch();
    assert.equal(await nav(top.id).count(), 1); assert.match(await nav(top.id).innerText(), /改名后的顶层/);
    assert.equal(await nav(child.id).count(), 0);
    await nav(top.id).click(); await selectedVisible(top.id);
    checks.push('custom root identity, renamed label and hierarchy persist after restart');
    assert.deepEqual(errors, []);
    const result = { passed:true,groups:checks.length,checks,contexts,geometries,pageErrors:errors,isolatedLibrary:true,installerCreated:false };
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
  } catch (error) {
    await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({checks,errors,message:error.message,stack:error.stack},null,2)); throw error;
  } finally {
    if(app) await app.close();
    assert.equal(path.dirname(temporary),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('anshelf-navigation-ui-'));
    await fs.rm(temporary,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
