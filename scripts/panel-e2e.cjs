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
  const context = await browser.newContext({ viewport: { width: 48, height: 88 }, deviceScaleFactor: 2 });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  let settingsPage;
  try {
    await context.exposeBinding('openImportSettings', async (source, id, params) => {
      assert.equal(id, 'com.anshelf.receiver.import-settings'); assert.equal(params, '');
      settingsPage = await context.newPage();
      await settingsPage.setViewportSize({ width: 380, height: 440 });
      await settingsPage.goto(pathToFileURL(path.join(root, 'plugin/import-settings.html')).href);
    });
    await context.exposeBinding('closeImportSettings', async source => { if (!source.page.isClosed()) await source.page.close(); });
    await context.exposeBinding('relayCepEvent', async (source, event) => {
      // Real CEP 6.1+ parses JSON event.data before invoking the recipient.
      const forwarded = { ...event, data: typeof event.data === 'string' ? JSON.parse(event.data) : event.data };
      for (const target of context.pages()) {
        if (target === source.page || target.isClosed()) continue;
        await target.evaluate(event => { const handler = window.panelTest.listeners[event.type]; if (handler) handler(event); }, forwarded).catch(error => { if (!target.isClosed()) throw error; });
      }
    });
    await context.addInitScript(() => {
      window.panelTest = { listeners: {}, pending: null, response: null, heartbeatError: false, completed: [], prepared: [], imports: [], importOptions: [], saveCodes: [], importResult: null, resized: [], remembered: [],
        settings: { categories: [{ id:'effect-root',name:'特效素材',parentId:null,scope:'effect' }, { id:'effect-child',name:'旋转特效',parentId:'effect-root',scope:'effect' }, { id:'people',name:'人物',parentId:null,scope:'ordinary' }, { id:'audio',name:'音频',parentId:null,scope:'audio' }, { id:'shared',name:'通用文件夹',parentId:null,scope:'all' }], defaults: { mode:'effect',categoryId:'effect-child',previewResolution:2048,preferExistingPreview:true }, preferences: { ordinary:{previewResolution:512,preferExistingPreview:true},effect:{previewResolution:2048,preferExistingPreview:true} } } };
      const queue = {
        heartbeat() { if (window.panelTest.heartbeatError) throw new Error('写入失败'); },
        pending() { return window.panelTest.pending; },
        prepare(request) { window.panelTest.prepared.push(request.requestId); return { ...request, managedRoot: 'file:///managed' }; },
        complete(request, result) { window.panelTest.completed.push({ requestId: request.requestId, result }); if (window.panelTest.pending && window.panelTest.pending.requestId === request.requestId) window.panelTest.pending = null; },
        documentImportSettings() { return window.panelTest.settings; },
        rememberDocumentImportOptions(options) { window.panelTest.remembered.push(options); },
        requestDocumentImport(file, options) { window.panelTest.imports.push(file); window.panelTest.importOptions.push(options); return { requestId:'current-document',createdAt:Date.now() }; },
        documentImportResult() { return window.panelTest.importResult; },
        clearDocumentImport() { window.panelTest.importResult = null; }
      };
      window.__adobe_cep__ = { getSystemPath: () => '/extension',
        resizeContent(width,height) { window.panelTest.resized.push([width,height]); throw new Error('Docked panel cannot resize'); },
        addEventListener(name,callback) { window.panelTest.listeners[name]=callback; },
        removeEventListener(name) { delete window.panelTest.listeners[name]; },
        dispatchEvent(event) { window.relayCepEvent(event); },
        requestOpenExtension(id,params) { window.openImportSettings(id,params); },
        closeExtension() { window.setTimeout(() => window.closeImportSettings(),40); },
        evalScript(code, callback) {
          if (code.includes('AnShelfCurrentDocumentInfoForLibrary')) { callback(JSON.stringify({version:1,ok:true,documentId:42,name:'当前作品.fla',file:'C:\\works\\当前作品.fla'})); return; }
          if (code.includes('AnShelfCurrentDocumentForLibrary')) { window.panelTest.saveCodes.push(code); window.panelTest.saveResponse=callback; return; }
          if (!code.includes('AnShelfInsertWhole')) { callback('42'); return; }
          window.panelTest.response=callback;
        }
      };
      window.cep_node = { require(name) {
        if (name==='path') return { join:(...parts)=>parts.join('/') };
        if (name==='crypto') return { randomBytes:()=>({toString:()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}) };
        if (name==='process') return { env:{APPDATA:'/appdata'} };
        return { Queue:function(){return queue;},localURI:value=>'file:///'+value, documentImportOptions:options=>options };
      }};
      window.setInterval = callback => { window.panelTest.tick=callback; return 1; };
    });
    const panel = await context.newPage();
    await panel.goto(pathToFileURL(path.join(root,'plugin/index.html')).href);
    const add = panel.locator('#add-current'), insert = panel.locator('#insert');
    assert.equal(await panel.locator('main>button').count(),2);
    assert.equal(await panel.locator('#add-confirm').count(),0);
    for (const [width,height] of [[40,80],[48,88],[180,120],[320,160]]) {
      await panel.setViewportSize({width,height});
      const layout = await panel.evaluate(() => ({ width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,buttons:Array.from(document.querySelectorAll('main>button')).map(button=>{const r=button.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,fits:button.scrollWidth<=button.clientWidth&&button.scrollHeight<=button.clientHeight};}) }));
      assert.deepEqual([layout.width,layout.height],[width,height]);
      assert.deepEqual(layout.buttons.map(r=>[r.x,r.y,r.width,r.height]),[[4,4,width-8,(height-12)/2],[4,(height+4)/2,width-8,(height-12)/2]]);
      assert.equal(layout.buttons.every(r=>r.fits),true);
    }
    checks.push('two compact actions fit 40x80, 48x88, 180x120 and 320x160 without overflow');
    const icon=await panel.evaluate(()=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=reject;image.src='icon.png';}));
    assert.deepEqual(icon,[64,64]);
    await panel.evaluate(()=>{window.panelTest.pending={version:2,requestId:'first',asset:{id:'first',name:'测试素材'}};window.panelTest.tick();});
    await insert.click(); assert.equal(await insert.textContent(),'正在粘贴…');
    await panel.evaluate(()=>window.panelTest.response(JSON.stringify({version:1,ok:true})));
    assert.equal(await insert.textContent(),'已粘贴 ✓');
    checks.push('paste pending, busy and successful completion retain their compact state');
    await panel.setViewportSize({width:48,height:88});
    const originalBounds=await panel.locator('main').boundingBox();
    async function openSettings() {
      const opened=context.waitForEvent('page'); await add.click();
      const dialog=await opened; await dialog.locator('#add-confirm').waitFor({state:'visible'});
      assert.deepEqual(await panel.locator('main').boundingBox(),originalBounds);
      assert.deepEqual(await panel.evaluate(()=>window.panelTest.resized),[]);
      return dialog;
    }
    async function choose(dialog,name,value) {
      const button=dialog.locator(name==='category'?'#import-category':'#preview-resolution');
      const menu=dialog.locator(name==='category'?'#category-options':'#resolution-options');
      if (!await menu.isVisible()) await button.click();
      await menu.locator(`[role="option"][data-value="${value}"]`).click();
    }
    let dialog=await openSettings();
    assert.equal(await dialog.locator('#current-file').textContent(),'当前作品.fla');
    assert.equal(await dialog.locator('#preview-resolution').evaluate(e=>e.value),'2048');
    assert.equal(await dialog.locator('#import-effect').getAttribute('aria-pressed'),'true');
    assert.match(await dialog.locator('#category-options').textContent(),/特效素材 \/ 旋转特效/);
    assert.doesNotMatch(await dialog.locator('#category-options').textContent(),/人物|音频/);
    await dialog.locator('#category-search').fill('旋转');
    assert.doesNotMatch(await dialog.locator('#category-options').textContent(),/通用文件夹/);
    await dialog.locator('#import-ordinary').click();
    assert.equal(await dialog.locator('#preview-resolution').evaluate(e=>e.value),'512');
    await dialog.locator('#category-search').fill('');
    assert.match(await dialog.locator('#category-options').textContent(),/人物/);
    await dialog.locator('#import-effect').click();
    assert.equal(await dialog.locator('#preview-resolution').evaluate(e=>e.value),'2048');
    await dialog.locator('#preview-resolution').click();
    await dialog.keyboard.press('Home'); await dialog.keyboard.press('ArrowDown');
    assert.equal(await dialog.locator('#resolution-options [data-value="256"]').evaluate(e=>e===document.activeElement),true);
    await dialog.keyboard.press('End'); await dialog.keyboard.press('ArrowUp'); await dialog.keyboard.press('Enter');
    assert.equal(await dialog.locator('#preview-resolution').evaluate(e=>e.value),'1024');
    await dialog.keyboard.press('ArrowDown'); await dialog.keyboard.press('Escape');
    assert.equal(await dialog.locator('#resolution-options').isVisible(),false);
    await dialog.locator('#confirm-save').focus(); await dialog.keyboard.press('Tab');
    assert.equal(await dialog.locator('#import-ordinary').evaluate(e=>e===document.activeElement),true);
    await dialog.keyboard.press('Shift+Tab');
    assert.equal(await dialog.locator('#confirm-save').evaluate(e=>e===document.activeElement),true);
    for (const [width,height] of [[340,400],[380,440],[480,500]]) {
      await dialog.setViewportSize({width,height});
      assert.equal(await dialog.locator('#add-confirm').evaluate(e=>e.scrollWidth<=e.clientWidth&&Array.from(e.querySelectorAll('h1,.confirmation-actions button')).every(button=>{const r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&button.scrollWidth<=button.clientWidth;})),true);
    }
    const out=path.join(root,'test-output');await fs.mkdir(out,{recursive:true});
    await dialog.setViewportSize({width:380,height:440});await dialog.screenshot({path:path.join(out,'panel-import-independent.png'),scale:'css'});
    const cancelled=dialog.waitForEvent('close');await dialog.locator('#confirm-cancel').click();await cancelled;
    await add.filter({hasText:'已取消'}).waitFor();
    assert.equal(await panel.evaluate(()=>window.panelTest.saveCodes.length),0);
    checks.push('separate Modeless settings inherit 2K, search categories, change per-mode preferences, use themed keyboard menus, trap focus and cancel without changing the 48x88 panel');
    dialog=await openSettings();
    const closed=dialog.waitForEvent('close');await dialog.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));await closed;
    await add.filter({hasText:'已取消'}).waitFor();
    assert.equal(await panel.evaluate(()=>window.panelTest.saveCodes.length),0);
    checks.push('closing the independent settings window cancels without saving');
    dialog=await openSettings();
    await choose(dialog,'category','effect-child');await choose(dialog,'resolution','512');await dialog.locator('#prefer-existing-preview').uncheck();
    const confirmed=dialog.waitForEvent('close');await dialog.locator('#confirm-save').click();await confirmed;
    await panel.waitForFunction(()=>window.panelTest.saveCodes.length===1);
    assert.match(await panel.evaluate(()=>window.panelTest.saveCodes[0]),/AnShelfCurrentDocumentForLibrary","42"/);
    assert.equal(await panel.evaluate(()=>window.panelTest.imports.length),0);
    await panel.evaluate(()=>window.panelTest.saveResponse(JSON.stringify({version:1,ok:true,file:'C:\\works\\当前作品.fla'})));
    assert.deepEqual(await panel.evaluate(()=>window.panelTest.importOptions),[{mode:'effect',categoryId:'effect-child',previewResolution:512,preferExistingPreview:false}]);
    await panel.evaluate(()=>{window.panelTest.importResult={version:1,requestId:'current-document',ok:true,assetId:'current',name:'当前作品'};window.panelTest.tick();});
    assert.equal(await add.textContent(),'已加入 ✓');assert.deepEqual(await panel.locator('main').boundingBox(),originalBounds);
    checks.push('confirmed options reach the import only after the fixed document-bound save and receipt completes');
    dialog=await openSettings();const nativeCancelled=dialog.waitForEvent('close');await dialog.locator('#confirm-save').click();await nativeCancelled;
    await panel.waitForFunction(()=>window.panelTest.saveCodes.length===2);
    await panel.evaluate(()=>window.panelTest.saveResponse(JSON.stringify({version:1,ok:false,cancelled:true})));
    assert.equal(await add.textContent(),'已取消');assert.equal(await panel.evaluate(()=>window.panelTest.imports.length),1);
    checks.push('native Save As cancellation after settings does not queue an unsaved document');
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(out,'panel-e2e-result.json'),JSON.stringify({checks,pageErrors:errors},null,2));
    console.log(JSON.stringify({checks,pageErrors:errors},null,2));
  } finally { await context.close();await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
