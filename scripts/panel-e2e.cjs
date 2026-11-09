/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [], checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 48, height: 88 }, deviceScaleFactor: 2 });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.panelTest = { pending: null, response: null, heartbeatError: false, completed: [], prepared: [], imports: [], importOptions: [], saveCodes: [], importResult: null,
        settings: { categories: [{ id:'effect-root',name:'特效素材',parentId:null,scope:'effect' }, { id:'effect-child',name:'旋转特效',parentId:'effect-root',scope:'effect' }, { id:'people',name:'人物',parentId:null,scope:'ordinary' }, { id:'audio',name:'音频',parentId:null,scope:'audio' }, { id:'shared',name:'通用文件夹',parentId:null,scope:'all' }], defaults: { mode:'ordinary',categoryId:null,previewResolution:null,preferExistingPreview:true } } };
      const queue = {
        heartbeat() { if (window.panelTest.heartbeatError) throw new Error('写入失败'); },
        pending() { return window.panelTest.pending; },
        prepare(request) { window.panelTest.prepared.push(request.requestId); return { ...request, managedRoot: 'file:///managed' }; },
        complete(request, result) { window.panelTest.completed.push({ requestId: request.requestId, result }); if (window.panelTest.pending && window.panelTest.pending.requestId === request.requestId) window.panelTest.pending = null; },
        documentImportSettings() { return window.panelTest.settings; },
        requestDocumentImport(file, options) { window.panelTest.imports.push(file); window.panelTest.importOptions.push(options === undefined ? null : options); return {requestId:'current-document',createdAt:Date.now()}; },
        documentImportResult() { return window.panelTest.importResult; },
        clearDocumentImport() { window.panelTest.importResult = null; }
      };
      window.__adobe_cep__ = { getSystemPath: () => '/extension', evalScript(code, callback) {
        if (code.includes('AnShelfCurrentDocumentInfoForLibrary')) { callback(JSON.stringify({version:1,ok:true,documentId:42,name:'当前作品.fla',file:'C:\\works\\当前作品.fla'})); return; }
        if (code.includes('AnShelfCurrentDocumentForLibrary')) { window.panelTest.saveCodes.push(code); window.panelTest.saveResponse = callback; return; }
        if (!code.includes('AnShelfInsertWhole')) { callback('42'); return; }
        window.panelTest.response = callback;
      } };
      window.cep_node = { require(name) {
        if (name === 'path') return { join: (...parts) => parts.join('/') };
        if (name === 'process') return { env: { APPDATA: '/appdata' } };
        return { Queue: function () { return queue; }, localURI: value => 'file:///' + value };
      } };
      window.setInterval = callback => { window.panelTest.tick = callback; return 1; };
    });
    await page.goto(pathToFileURL(path.join(root, 'plugin/index.html')).href);
    const button = page.locator('#insert');
    await button.waitFor();
    assert.equal(await button.textContent(), '等待素材');
    assert.equal(await button.isDisabled(), true);
    assert.equal(await page.locator('main>button').count(), 2);
    assert.equal(await page.locator('#add-confirm').isVisible(), false);
    const addButton = page.locator('#add-current');
    const choiceValue = selector => page.locator(selector).evaluate(button => button.value);
    async function choose(name, value) {
      const trigger = page.locator(name === 'category' ? '#import-category' : '#preview-resolution');
      const menu = page.locator(name === 'category' ? '#category-options' : '#resolution-options');
      if (!await menu.isVisible()) await trigger.click();
      await menu.locator(`[role="option"][data-value="${value}"]`).click();
    }
    assert.equal(await addButton.isEnabled(), true);
    checks.push('waiting state with compact paste and add-current buttons');

    async function layouts(state) {
      for (const [width, height] of [[40, 80], [48, 88], [180, 120], [320, 160]]) {
        await page.setViewportSize({ width, height });
        const layout = await page.evaluate(() => {
          const button = document.getElementById('insert'), rect = button.getBoundingClientRect();
          const style = getComputedStyle(button), icon = getComputedStyle(button, '::before');
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, textFits: button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight, fontSize: parseFloat(style.fontSize), icon: icon.backgroundImage, iconWidth: parseFloat(icon.width), label: button.getAttribute('aria-label'), title: button.title, state: button.getAttribute('data-state') };
        });
        assert.equal(layout.state, state);
        assert.deepEqual([layout.x, layout.y, layout.width, layout.height], [4, 4, width - 8, (height - 12) / 2]);
        assert.equal(layout.scrollWidth, width);
        assert.equal(layout.scrollHeight, height);
        assert.equal(layout.textFits, true, `${state} at ${width}x${height}`);
        assert.equal(layout.fontSize === 0, width < 200);
        assert.match(layout.icon, /icon\.png/);
        assert.ok(layout.iconWidth > 0 && layout.iconWidth <= layout.width);
        assert.ok(layout.label.length > 0 && layout.title.length > 0);
        const addLayout = await addButton.evaluate(button => { const r = button.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,textFits:button.scrollWidth<=button.clientWidth&&button.scrollHeight<=button.clientHeight,scrollWidth:button.scrollWidth,clientWidth:button.clientWidth,scrollHeight:button.scrollHeight,clientHeight:button.clientHeight,font:getComputedStyle(button).font,iconFont:getComputedStyle(button,'::before').font }; });
        assert.deepEqual([addLayout.x,addLayout.y,addLayout.width,addLayout.height], [4,(height + 4)/2,width - 8,(height - 12)/2]);
        assert.equal(addLayout.textFits,true,`${state} at ${width}x${height}: ${JSON.stringify(addLayout)}`);
      }
      checks.push(`${state} at 40/48/180/320 pixels retains two vertical buttons, tooltip/accessibility and has no clipping or scrolling`);
    }
    await layouts('waiting');

    async function send(id) {
      await page.evaluate(value => {
        window.panelTest.pending = { version: 2, requestId: value, asset: { id: value, name: '非常长的武器素材名称'.repeat(20) } };
        window.panelTest.tick();
      }, id);
    }
    await send('first');
    assert.equal(await button.isEnabled(), true);
    assert.equal(await button.textContent(), '粘贴到舞台');
    assert.match(await button.getAttribute('title'), /非常长的武器素材名称/);
    await layouts('ready');
    const icon = await page.evaluate(() => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('Panel icon failed to decode')); image.src = 'icon.png'; }));
    assert.deepEqual(icon, { width: 64, height: 64 });
    checks.push('original local PNG icon decodes without remote assets');
    const out = path.join(root, 'test-output');
    await fs.mkdir(out, { recursive: true });
    await page.setViewportSize({ width: 48, height: 88 });
    await page.screenshot({ path: path.join(out, 'panel-icon-small.png'), scale: 'css' });
    await page.setViewportSize({ width: 320, height: 160 });
    await page.screenshot({ path: path.join(out, 'panel-icon-wide.png'), scale: 'css' });
    await page.screenshot({ path: path.join(out, 'panel-compact.png'), scale: 'css' });
    await button.click();
    assert.equal(await button.textContent(), '正在粘贴…');
    assert.equal(await button.isDisabled(), true);
    await layouts('busy');
    await page.evaluate(() => window.panelTest.response(JSON.stringify({ version: 1, ok: true, warning: '提示保留在悬停内容中' })));
    assert.equal(await button.textContent(), '已粘贴 ✓');
    assert.match(await button.getAttribute('title'), /提示保留/);
    await layouts('success');
    await page.evaluate(() => window.panelTest.tick());
    assert.equal(await button.textContent(), '已粘贴 ✓');
    checks.push('click, busy, completed state and warning tooltip');
    await send('second');
    await button.click();
    await page.evaluate(() => window.panelTest.response(JSON.stringify({ version: 1, ok: false, error: '当前图层锁定' })));
    assert.equal(await button.textContent(), '粘贴失败');
    assert.match(await button.getAttribute('aria-label'), /当前图层锁定/);
    await layouts('error');
    await send('third');
    await page.evaluate(() => { window.panelTest.heartbeatError = true; window.panelTest.tick(); });
    assert.equal(await button.textContent(), '连接失败');
    assert.equal(await button.isDisabled(), true);
    await page.evaluate(() => { window.panelTest.heartbeatError = false; window.panelTest.tick(); });
    assert.equal(await button.textContent(), '粘贴到舞台');
    assert.equal(await button.isEnabled(), true);
    const state = await page.evaluate(() => ({ completed: window.panelTest.completed.length, prepared: window.panelTest.prepared.length }));
    assert.deepEqual(state, { completed: 2, prepared: 2 });
    checks.push('failure, new request and connection recovery');
    await page.evaluate(() => {
      const createdAt = Date.now();
      window.panelTest.pending = { version: 2, requestId: 'stage-drag', createdAt, delivery: 'stage-drop', expiresAt: createdAt + 5000, targetDocumentId: 42, asset: { id: 'stage-drag', name: '自动拖到舞台的武器' } };
      window.panelTest.tick();
    });
    assert.equal(await button.textContent(), '正在粘贴…');
    assert.equal(await button.isDisabled(), true);
    await page.evaluate(() => {
      window.panelTest.tick();
      window.panelTest.response(JSON.stringify({ version: 1, ok: true }));
      window.panelTest.tick();
    });
    assert.equal(await button.textContent(), '已粘贴 ✓');
    const stageState = await page.evaluate(() => ({ prepared: window.panelTest.prepared.filter(id => id === 'stage-drag').length, completed: window.panelTest.completed.filter(item => item.requestId === 'stage-drag').length }));
    assert.deepEqual(stageState, { prepared: 1, completed: 1 });
    checks.push('stage-drop automatically inserts once while the existing manual button flow remains intact');
    await addButton.click();
    assert.equal(await addButton.isDisabled(),true);
    assert.equal(await button.isDisabled(),true);
    await page.evaluate(() => window.panelTest.saveResponse(JSON.stringify({version:1,ok:true,file:'C:\\works\\当前作品.fla',name:'当前作品.fla'})));
    assert.equal(await addButton.textContent(),'正在加入…');
    await page.evaluate(() => { window.panelTest.importResult={version:1,requestId:'current-document',ok:true,assetId:'current',name:'当前作品'};window.panelTest.tick(); });
    assert.equal(await addButton.textContent(),'已加入 ✓');
    assert.match(await addButton.getAttribute('title'),/当前作品/);
    assert.deepEqual(await page.evaluate(() => window.panelTest.imports),['C:\\works\\当前作品.fla']);
    checks.push('add-current saves through fixed JSFL, submits saved file once and displays import completion');
    await addButton.click();
    await page.evaluate(() => window.panelTest.saveResponse(JSON.stringify({version:1,ok:false,cancelled:true})));
    assert.equal(await addButton.textContent(),'已取消');
    assert.equal(await addButton.isEnabled(),true);
    assert.equal(await page.evaluate(() => window.panelTest.imports.length),1);
    checks.push('native save cancellation leaves the document out of the import queue');
    await page.evaluate(() => { window.panelTest.settings.defaults={mode:'effect',categoryId:'effect-child',previewResolution:2048,preferExistingPreview:true}; });
    await page.setViewportSize({width:380,height:440});
    await addButton.click();
    assert.equal(await page.locator('#add-confirm').isVisible(),true);
    assert.equal(await page.locator('#current-file').textContent(),'当前作品.fla');
    assert.equal(await page.locator('#import-effect').getAttribute('aria-pressed'),'true');
    assert.equal(await choiceValue('#preview-resolution'),'2048');
    assert.equal(await choiceValue('#import-category'),'effect-child');
    assert.match(await page.locator('#category-options').textContent(),/特效素材 \/ 旋转特效/);
    assert.doesNotMatch(await page.locator('#category-options').textContent(),/人物|音频/);
    assert.equal(await page.locator('select, option').count(),0);
    await page.locator('#preview-resolution').click();
    assert.equal(await page.locator('#resolution-options').isVisible(),true);
    await page.screenshot({path:path.join(out,'panel-import-resolution-themed.png'),scale:'css'});
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#resolution-options [data-value="256"]').evaluate(button => button===document.activeElement),true);
    await page.keyboard.press('End'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    assert.equal(await choiceValue('#preview-resolution'),'1024');
    assert.equal(await page.locator('#resolution-options').isVisible(),false);
    assert.equal(await page.locator('#preview-resolution').evaluate(button => button===document.activeElement),true);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#resolution-options').isVisible(),false);
    assert.equal(await page.locator('#add-confirm').isVisible(),true);
    await choose('resolution','2048');
    await page.locator('#import-category').click();
    await page.screenshot({path:path.join(out,'panel-import-category-themed.png'),scale:'css'});
    await page.locator('#confirm-heading').click();
    assert.equal(await page.locator('#category-options').isVisible(),false);
    assert.equal(await page.locator('#import-category').evaluate(button => button===document.activeElement),true);
    assert.equal(await page.evaluate(() => window.panelTest.saveCodes.length),2);
    await page.locator('#category-search').fill('旋转');
    assert.doesNotMatch(await page.locator('#category-options').textContent(),/通用文件夹/);
    await page.locator('#import-ordinary').click();
    assert.equal(await choiceValue('#import-category'),'');
    assert.doesNotMatch(await page.locator('#category-options').textContent(),/旋转特效/);
    await page.locator('#category-search').fill('');
    assert.match(await page.locator('#category-options').textContent(),/人物/);
    await page.locator('#import-effect').click();
    await choose('category','effect-child');
    await choose('resolution','512');
    await page.locator('#prefer-existing-preview').uncheck();
    await page.locator('#confirm-save').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.locator('#import-ordinary').evaluate(button => button===document.activeElement),true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#confirm-save').evaluate(button => button===document.activeElement),true);
    for (const [width,height] of [[340,400],[380,440],[480,500]]) {
      await page.setViewportSize({width,height});
      const readable = await page.locator('#add-confirm').evaluate(dialog => {
        const box=dialog.getBoundingClientRect();
        return dialog.scrollWidth<=dialog.clientWidth&&document.documentElement.scrollWidth===innerWidth&&Array.from(dialog.querySelectorAll('h1,.confirmation-actions button')).every(item => {
          const rect=item.getBoundingClientRect();
          return rect.left>=box.left&&rect.right<=box.right&&rect.top>=box.top&&rect.bottom<=box.bottom&&item.scrollWidth<=item.clientWidth&&item.scrollHeight<=item.clientHeight;
        });
      });
      assert.equal(readable,true,`themed confirmation at ${width}x${height}`);
    }
    await page.setViewportSize({width:380,height:440});
    await page.screenshot({path:path.join(out,'panel-confirm-themed.png'),scale:'css'});
    await page.locator('#confirm-cancel').click();
    assert.equal(await page.locator('#add-confirm').isVisible(),false);
    assert.equal(await page.evaluate(() => window.panelTest.imports.length),1);
    assert.equal(await page.evaluate(() => window.panelTest.saveCodes.length),2);
    await addButton.click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#add-confirm').isVisible(),false);
    assert.equal(await page.evaluate(() => window.panelTest.saveCodes.length),2);
    await addButton.click();
    await choose('category','effect-child');
    await choose('resolution','512');
    await page.locator('#prefer-existing-preview').uncheck();
    await page.locator('#confirm-save').click();
    assert.equal(await page.evaluate(() => window.panelTest.imports.length),1);
    await page.evaluate(() => window.panelTest.saveResponse(JSON.stringify({version:1,ok:true,file:'C:\\works\\另一份作品.fla',name:'另一份作品.fla'})));
    assert.equal(await page.locator('#add-confirm').isVisible(),false);
    assert.equal(await page.evaluate(() => window.panelTest.imports.length),2);
    assert.deepEqual(await page.evaluate(() => window.panelTest.importOptions),[null,{mode:'effect',categoryId:'effect-child',previewResolution:512,preferExistingPreview:false}]);
    assert.match(await page.evaluate(() => window.panelTest.saveCodes[2]),/AnShelfCurrentDocumentForLibrary","42"/);
    checks.push('themed import settings show the current file, inherit effect/2K/category defaults, search nested folders, filter by type, trap focus, cancel without saving and transmit selected options after a document-bound save');
    checks.push('all plugin choices use themed listboxes without native select menus, support Home/End/arrow/Enter/Escape, close outside and restore trigger focus');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'panel-e2e-result.json'), JSON.stringify({ checks, pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
