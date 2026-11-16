/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-root-navigation-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = process.env.ANSHELF_ROOT_NAVIGATION_OUTPUT || path.join(root, 'test-output/root-navigation-ui');
  await fs.mkdir(output, { recursive: true });
  const library = await Library.open(data);
  const project = await library.createCategory('常用的项目', null, 'all');
  for (let index = 0; index < 20; index++) await library.createCategory('更多顶层分类 ' + (index + 1), null, 'all');
  const initial = await library.snapshot(), scene = initial.categories.find(item => item.systemKey === 'scene');
  const indexFile = path.join(data, 'library.json');
  const initialHash = digest(await fs.readFile(indexFile));
  const executable = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const checks = [], contexts = [], geometries = [], errors = [];
  let app, page;
  const passed = message => { checks.push(message); console.log('[pass] ' + message); };
  async function launch() {
    app = await _electron.launch({ executablePath: executable, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    contexts.push(await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, executable: process.execPath, profile: app.getPath('userData'), library: process.env.ANSHELF_DATA_DIR })));
    page = await app.firstWindow(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#navigation [data-system-key="character"]');
  }
  const nav = id => page.locator(`#navigation [data-action="category"][data-id="${id}"]`);
  const row = id => page.locator(`[data-root-navigation-row="${id}"]`);
  const open = () => page.locator('[data-root-navigation-open]').click();
  const close = () => page.keyboard.press('Escape');
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    await launch();
    await page.evaluate(({ scene, project }) => {
      localStorage.setItem('anshelf-check-updates-on-start', 'false');
      localStorage.setItem('anshelf-onboarding-v1', JSON.stringify({ status: 'completed' }));
      localStorage.setItem('anshelf-root-navigation-v1', JSON.stringify({ hidden: [scene], order: [project] }));
      localStorage.setItem('anshelf-layout', 'modern'); localStorage.setItem('anshelf-theme', 'bluewhite');
    }, { scene: scene.id, project: project.id });
    await page.reload(); await page.waitForSelector('#navigation [data-system-key="character"]');
    assert.equal(await nav(scene.id).count(), 0, 'a hidden root must stop taking space in the top bar');
    assert.equal(await page.locator('#navigation [data-action="category"]').nth(1).getAttribute('data-id'), project.id);
    passed('saved hidden roots stop occupying the top bar and a frequent project is directly reachable first');

    await open(); await row(scene.id).locator('[data-root-navigation-choose]').click();
    assert.equal(await nav(scene.id).getAttribute('aria-current'), 'page');
    assert.match(await nav(scene.id).getAttribute('class'), /root-temporary/);
    await open(); assert.equal(await row(scene.id).locator('input').isChecked(), false);
    await close(); await nav('all').click(); assert.equal(await nav(scene.id).count(), 0);
    passed('hidden roots are directly selectable from More; the current root appears temporarily without changing its preference');

    await page.locator('[data-root-navigation-open]').focus(); await page.keyboard.press('Enter');
    await page.locator('[data-root-navigation-search]').fill('更多顶层分类 15');
    assert.equal(await page.locator('[data-root-navigation-row]').count(), 1);
    const fifteenth = initial.categories.find(item => item.name === '更多顶层分类 15');
    await row(fifteenth.id).locator('[data-root-navigation-operation="first"]').click();
    assert.equal(await page.locator('[data-root-navigation-search]').inputValue(), '更多顶层分类 15');
    assert.equal(await row(fifteenth.id).locator('[data-root-navigation-choose]').evaluate(node => node === document.activeElement), true, 'disabled first-position action moves focus to its visible category name');
    await row(fifteenth.id).locator('input').uncheck();
    assert.equal(await row(fifteenth.id).locator('input').evaluate(node => node === document.activeElement), true);
    await close(); assert.equal(await page.locator('[data-root-navigation-open]').evaluate(node => node === document.activeElement), true);
    assert.equal(await nav(fifteenth.id).count(), 0);
    passed('keyboard opening, filtered reordering, unpinning and Escape preserve search and visible focus');

    await open(); await page.locator('[data-root-navigation-search]').fill('常用');
    await row(project.id).locator('[data-root-navigation-operation="first"]').click();
    await page.locator('[data-root-navigation-search]').fill('背景'); await row(scene.id).locator('input').check();
    assert.equal(await nav(scene.id).count(), 1);
    await row(scene.id).locator('input').uncheck(); await close();
    passed('visible categories can be restored and cancelled again without changing the library');

    for (const [width, height] of [[1480, 940], [850, 600]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(win => win.getTitle() === '安安素材管理器').setContentSize(...size), [width, height]);
      await tick();
      const geometry = await page.evaluate(() => {
        const box = selector => { const { left, right, top, bottom, height } = document.querySelector(selector).getBoundingClientRect(); return { left, right, top, bottom, height }; };
        return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, sidebar: box('.sidebar'), more: box('[data-root-navigation-open]'), import: box('.import-entries'), tools: box('#workspace-tools > summary') };
      });
      geometries.push(geometry); assert.equal(geometry.overflow, false); assert.ok(geometry.sidebar.height <= 43);
      for (const item of [geometry.more, geometry.import, geometry.tools]) assert.ok(item.left >= 0 && item.right <= geometry.width + 1);
      await page.waitForFunction(() => !document.querySelector('[data-root-navigation-scroll="next"]').hidden);
      await page.locator('[data-root-navigation-scroll="next"]').click();
      await page.waitForFunction(() => document.querySelector('#navigation').scrollLeft > 5);
      await page.waitForFunction(() => !document.querySelector('[data-root-navigation-scroll="previous"]').disabled);
      await page.locator('[data-root-navigation-scroll="previous"]').click();
      await page.waitForFunction(() => document.querySelector('#navigation').scrollLeft < 5);
      await open(); await page.screenshot({ path: path.join(output, `root-manager-${width}.png`) }); await close();
    }
    passed('many roots in normal and minimum windows have working arrows, a single compact row and reachable More/import/tools');

    await open();
    await page.evaluate(() => { globalThis.__rootNavigationStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw Error('isolated storage failure'); }; });
    await row(scene.id).locator('input').check();
    assert.match(await page.locator('[data-root-navigation-status]').innerText(), /暂时无法保存/);
    assert.equal(await nav(scene.id).count(), 1);
    await page.evaluate(() => { Storage.prototype.setItem = globalThis.__rootNavigationStorageSet; delete globalThis.__rootNavigationStorageSet; });
    await row(scene.id).locator('input').uncheck(); await close();
    passed('unavailable preference storage reports session-only success while keeping the interface usable');

    await page.evaluate(() => localStorage.setItem('anshelf-layout', 'classic')); await page.reload();
    await page.waitForSelector('#navigation [data-system-key="character"]');
    const classic = await page.evaluate(() => {
      const box = selector => { const { top, bottom } = document.querySelector(selector).getBoundingClientRect(); return { top, bottom }; };
      return { roots: box('.root-navigation-shell'), categories: box('#category-panel'), search: box('.category-search'), tree: box('#categories'), bottom: box('.sidebar-bottom') };
    });
    assert.ok(classic.roots.bottom <= classic.categories.top + 1, 'classic root navigation must not overlap category management');
    assert.ok(classic.categories.bottom <= classic.bottom.top + 1, 'classic category management must stay above bottom controls');
    assert.ok(classic.search.bottom <= classic.bottom.top + 1, 'classic category search must stay above bottom controls');
    assert.ok(classic.tree.bottom <= classic.bottom.top + 1, 'classic category tree must not overflow into bottom controls: ' + JSON.stringify(classic));
    assert.equal(await nav(scene.id).count(), 0); await open(); await row(scene.id).locator('[data-root-navigation-choose]').click();
    assert.equal(await nav(scene.id).getAttribute('aria-current'), 'page'); await open(); await close();
    assert.equal(await page.locator('[data-root-navigation-open]').evaluate(node => node === document.activeElement), true);
    await page.screenshot({ path: path.join(output, 'root-manager-classic.png') });
    passed('classic layout shares saved navigation choices, directly opens hidden categories and restores focus');

    await app.close(); app = null; await launch();
    assert.equal(await nav(scene.id).count(), 0);
    assert.equal(await page.locator('#navigation [data-action="category"]').nth(1).getAttribute('data-id'), project.id);
    assert.equal(digest(await fs.readFile(indexFile)), initialHash, 'all navigation changes leave the isolated library index byte-for-byte unchanged');
    assert.deepEqual(errors, []);
    passed('restarting preserves ordering and visibility; the isolated library index remains byte-for-byte unchanged');
    const result = { passed: true, groups: checks.length, checks, contexts, geometries, pageErrors: errors, isolatedLibrary: true, libraryUnchanged: true, installerCreated: false };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ checks, errors, message: error.message, stack: error.stack }, null, 2)); throw error;
  } finally {
    if (app) await app.close();
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir())); assert.ok(path.basename(temporary).startsWith('anshelf-root-navigation-'));
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
