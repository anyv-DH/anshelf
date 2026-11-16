/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const zlib = require('node:zlib');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const systemNames = ['特效', '音频', '人物', '场景', '道具', '表情'];

function previewPng() {
  function crc(buffer) {
    let value = 0xffffffff;
    for (const byte of buffer) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  }
  const width = 320, height = 240, pixels = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 4) + 1 + x * 4;
    const circle = Math.hypot(x - 160, y - 112) < 58;
    const ground = y > 180 + Math.sin(x / 42) * 14;
    const color = circle ? [233, 175, 105, 255] : ground ? [100, 146, 139, 255] : [0, 0, 0, 0];
    color.forEach((value, channel) => { pixels[offset + channel] = value; });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

function audioWav() {
  const rate = 8000, samples = rate * 25, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) data.writeInt16LE(Math.round(Math.sin(index * 440 * Math.PI * 2 / rate) * 600), 44 + index * 2);
  return data;
}

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-practical-ui-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = process.env.ANSHELF_PRACTICAL_OUTPUT || path.join(root, 'test-output/practical-ui');
  await fs.mkdir(output, { recursive: true });
  const source = path.join(temporary, '分类布局测试.fla'), picture = path.join(temporary, '分类布局测试.png'), sound = path.join(temporary, '分类试听.wav'), effectSource=path.join(temporary,'特效分类验收.fla');
  const demos = (await fs.readdir(path.join(root, 'demo'))).filter(file => file.endsWith('.fla'));
  await fs.copyFile(path.join(root, 'demo', demos[0]), source);
  await fs.copyFile(path.join(root, 'demo', demos[1]), effectSource);
  await fs.writeFile(picture, previewPng()); await fs.writeFile(sound, audioWav());
  const originalFiles=[source,picture,sound,effectSource];
  const originals = await Promise.all(originalFiles.map(async file => digest(await fs.readFile(file))));
  const library = await Library.open(data);
  const initialCategories = library.snapshot().categories;
  // The fallback lets the pre-change renderer reach the failing navigation assertion.
  const person = initialCategories.find(item => item.systemKey === 'character') || initialCategories.find(item => item.name === '人物');
  const city = initialCategories.find(item => item.parentId === person?.id && item.name === '现代都市') || await library.createCategory('现代都市', person?.id || null, 'ordinary');
  const subtype = await library.createCategory('都市女主', city.id, 'ordinary');
  const target = await library.createCategory('详情移动验收', person?.id || null, 'ordinary');
  const legacyMedia=await library.createCategory('旧版共享素材分类',null,'all');
  const imported = await library.importPaths([source], { categoryId: subtype.id });
  const first = imported.assets[0];
  for (let index = 1; index < 65; index++) {
    const asset = await library.duplicateAsset(first.id);
    await library.updateAsset(asset.id, { name: '分类布局测试 · ' + String(index).padStart(2, '0') });
  }
  await library.updateAsset(first.id, { name: '角色详情原始', favorite: true, liked: true });
  const audioRoot = initialCategories.find(item => item.systemKey === 'audio');
  const audioImport = await library.importPaths([sound], { mode: 'audio', categoryId:legacyMedia.id });
  const audio = audioImport.assets[0];
  await library.updateAsset(audio.id,{favorite:true,liked:true});
  const effectRoot=initialCategories.find(item=>item.systemKey==='effect');
  const effectImport=await library.importPaths([effectSource],{mode:'effect',categoryId:legacyMedia.id});
  const before = library.snapshot();
  const payloads = await Promise.all(before.assets.map(async asset => ({ id: asset.id, managedPath: asset.managedPath, hash: digest(await fs.readFile(path.join(data, asset.managedPath))) })));
  // Legacy person folders were unrestricted. Preserve that stored metadata
  // while proving new root semantics prevent cross-type destinations in UI.
  const fixtureIndex=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8'));
  const personIds=new Set([person.id]);
  let expanding=true;
  while(expanding) { expanding=false; for(const category of fixtureIndex.categories) if(personIds.has(category.parentId) && !personIds.has(category.id)) { personIds.add(category.id); expanding=true; } }
  for(const category of fixtureIndex.categories) if(personIds.has(category.id)) category.scope='all';
  await fs.writeFile(path.join(data,'library.json'),JSON.stringify(fixtureIndex,null,2));
  const checks = [], errors = [], geometry = [], draftObservations=[], runtimeContexts=[];
  let app, page, createdProjectId;
  async function launch() {
    const executable = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
    app = await _electron.launch({
      executablePath: executable,
      args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile],
      env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000,
    });
    const context = await app.evaluate(({app}) => ({ packaged:app.isPackaged, version:app.getVersion(), executable:process.execPath, profile:app.getPath('userData'), library:process.env.ANSHELF_DATA_DIR }));
    runtimeContexts.push(context);
    const runtimePath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    assert.equal(context.packaged, Boolean(process.env.ANSHELF_UI_EXECUTABLE), 'runtime packaging matches launch mode');
    assert.equal(context.version, require(path.join(root, 'package.json')).version, 'runtime version matches source');
    assert.equal(runtimePath(context.executable), runtimePath(executable), 'runtime uses the requested executable');
    assert.equal(runtimePath(context.profile), runtimePath(profile), 'runtime uses the isolated profile');
    assert.equal(runtimePath(context.library), runtimePath(data), 'runtime uses the isolated library');
    assert.deepEqual(context, runtimeContexts[0], 'every restart uses the same runtime and isolated data paths');
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.asset-card');
    await page.evaluate(() => localStorage.setItem('anshelf-check-updates-on-start', 'false'));
  }
  async function resize(width, height) {
    await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '安安素材管理器').setContentSize(size.width, size.height), { width, height });
    await page.waitForFunction(({width,height}) => Math.abs(innerWidth - width) <= 2 && Math.abs(innerHeight - height) <= 2, { width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const openAppearance = () => page.locator('[data-action="appearance-settings"]').click();
  const closeAppearance = () => page.locator('[data-appearance-close]').first().click();
  async function choose(kind, value) {
    const attribute = kind === 'background' ? 'preview-background' : kind;
    await page.locator(`[data-appearance-${attribute}="${value}"]`).click();
    await page.waitForFunction(({attribute, value}) => document.documentElement.getAttribute('data-' + attribute) === value, { attribute, value });
  }
  const closeDialog = () => page.locator('#dialog [data-action="close-dialog"]').first().click();
  async function topCategory(id) {
    await page.locator(`#navigation [data-action="category"][data-id="${id}"]`).click();
    await page.locator('#search').fill('');
  }
  async function density(value) {
    await page.locator('#density').click(); await page.locator(`[data-action="density"][data-density="${value}"]`).click();
    await page.waitForFunction(value => localStorage.getItem('anshelf-density') === value, value);
  }
  async function addMembership(categoryId) {
    const select=page.locator('#dialog select[data-field="add-category"]');
    const wrapper=select.locator('..');
    if(await wrapper.locator('[data-select-trigger]').count()) {
      await wrapper.locator('[data-select-trigger]').click();
      await page.locator(`[data-category-option="${categoryId}"]`).click();
    } else await select.selectOption(categoryId);
    await page.waitForFunction(id => [...document.querySelectorAll('#dialog [data-action="remove-from-category"]')].some(element=>element.dataset.categoryId===id),categoryId);
  }
  async function checkDraftRecovery(id) {
    await app.evaluate(({app}) => {
      const localRequire=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
      const {Library}=localRequire(app.getAppPath()+'/core/library.cjs');
      const original=Library.prototype.updateAsset;
      globalThis.__anshelfDraftProbe={original,prototype:Library.prototype,library:null};
      Library.prototype.updateAsset=async function(assetId,patch) {
        globalThis.__anshelfDraftProbe.library=this;
        if(patch.name==='慢保存姓名') await new Promise(resolve=>setTimeout(resolve,500));
        return original.call(this,assetId,patch);
      };
    });
    const draft='尚未失焦的标签草稿';
    try {
      await page.locator('#dialog [data-field="name"]').fill('慢保存姓名');
      await page.locator('#dialog [data-field="name"]').press('Tab');
      await page.locator('#dialog [data-field="tags"]').fill(draft);
      await page.evaluate(()=>{globalThis.__draftField=document.querySelector('#dialog [data-field="tags"]');});
      await page.waitForFunction(()=>document.querySelector('#dialog-title')?.textContent==='慢保存姓名');
      const observe=() => page.evaluate(()=>{const field=document.querySelector('#dialog [data-field="tags"]'); return {value:field.value,sameNode:field===globalThis.__draftField,focused:field===document.activeElement};});
      draftObservations.push({phase:'delayed-name-save',...(await observe())});
      // Re-enter a draft if the first regression failed, so the independent
      // background-preview regression is still observed in the same red run.
      await page.locator('#dialog [data-field="tags"]').fill(draft);
      await page.evaluate(()=>{globalThis.__draftField=document.querySelector('#dialog [data-field="tags"]');});
      const previousUrl=await page.locator('.lightbox-preview img').getAttribute('src');
      await app.evaluate(async(_electron,id)=>{
        const library=globalThis.__anshelfDraftProbe.library,asset=library.getAsset(id);
        await library.setPreview(id,{previewStatus:'ready',previewWarning:'后台预览完成 · 草稿验收'},asset.previewRevision);
      },id);
      await page.waitForFunction(previous=>document.querySelector('.lightbox-preview img')?.getAttribute('src')!==previous,previousUrl);
      draftObservations.push({phase:'background-preview-revision',...(await observe())});
      assert.deepEqual(draftObservations.filter(item=>item.value!==draft || !item.sameNode || !item.focused),[],'asynchronous saves and preview commits preserve the active unsaved draft');
      checks.push('a 500ms delayed name save and a real background preview revision preserve the exact focused tags input and its unsaved text');
    } finally {
      await app.evaluate(()=>{const probe=globalThis.__anshelfDraftProbe; if(probe)probe.prototype.updateAsset=probe.original; delete globalThis.__anshelfDraftProbe;});
    }
  }
  async function metrics(label) {
    const report = await page.evaluate(() => {
      const box = selector => { const element = document.querySelector(selector), r = element?.getBoundingClientRect(); return r ? { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom, hidden:!!element.hidden } : null; };
      const first = document.querySelector('.asset-card'), firstBox = first?.getBoundingClientRect();
      const firstRow = firstBox ? [...document.querySelectorAll('.asset-card')].filter(card => Math.abs(card.getBoundingClientRect().top - firstBox.top) <= 1).length : 0;
      return { viewport:[innerWidth,innerHeight], layout:document.documentElement.dataset.layout, firstRow,
        bodyOverflow:document.body.scrollWidth-innerWidth, mainOverflow:document.querySelector('.main').scrollWidth-document.querySelector('.main').clientWidth,
        first:box('.asset-card'), preview:box('.card-preview'), search:box('#search'), nav:box('#navigation'), subcategories:box('#subcategories'),
        update:box('#app-update'), author:box('[data-action="author-message"]'), inspector:box('#inspector'), columns:document.querySelector('#asset-grid').dataset.columns };
    });
    geometry.push({ label, ...report });
    assert.ok(report.bodyOverflow <= 1 && report.mainOverflow <= 1, label + ' has no horizontal page overflow: ' + JSON.stringify(report));
    for (const [name, box] of Object.entries({ search:report.search, update:report.update, author:report.author })) {
      assert.ok(box && box.width > 0 && box.height > 0 && box.x >= -1 && box.right <= report.viewport[0]+1 && box.y >= 0 && box.bottom <= report.viewport[1]+1, label + ' persistent ' + name + ' reachable: ' + JSON.stringify(box));
    }
    if (report.inspector) assert.ok(report.inspector.hidden || report.inspector.width === 0 || report.inspector.height === 0, 'no separate detail pane');
    return report;
  }
  try {
    await launch(); await resize(1480,940);
    const visibleRoots = await page.locator('#navigation [data-system-key]').allTextContents();
    for (const name of systemNames) assert.ok(visibleRoots.some(text => text.includes(name)), 'top navigation exposes ' + name + ': ' + visibleRoots.join('|'));
    assert.equal(await page.locator('[data-action="create-project"]').count(), 1, 'dedicated create project entry');
    await topCategory(effectRoot.id);
    assert.equal(await page.locator('.asset-card').count(),1,'effect root displays its own type');
    assert.equal(await page.locator('.asset-card').getAttribute('data-asset'),effectImport.assets[0].id);
    await topCategory(audioRoot.id);
    assert.equal(await page.locator('.audio-card').count(),1,'audio root displays its own type');
    const legacySnapshot=await page.evaluate(()=>window.shelf.snapshot());
    for(const id of [audio.id,effectImport.assets[0].id]) assert.deepEqual(legacySnapshot.assets.find(asset=>asset.id===id).categoryIds,[legacyMedia.id],'aggregate media navigation never silently moves legacy membership');
    await topCategory(person.id);
    await page.waitForFunction(()=>document.querySelector('#queue-status').hidden);
    for (const name of ['现代都市','玄幻修仙','近代人物','古代人物']) assert.ok((await page.locator('#subcategories').textContent()).includes(name), 'person subtype ' + name);
    assert.equal(await page.locator('#subcategories [data-action="collection"][data-collection="favorites"]').count(), 1);
    assert.equal(await page.locator('#subcategories [data-action="collection"][data-collection="liked"]').count(), 1);
    const standard = await metrics('modern-1480x940');
    assert.ok(standard.first.y <= 230, 'first asset starts by 230px: ' + standard.first.y);
    await page.screenshot({ path:path.join(output, 'modern-1480x940.png') });
    checks.push('six roots, project entry and character subtypes fit the compact first screen; effect/audio aggregate legacy shared categories without changing membership');
    await page.locator('[data-action="import"][data-mode="audio"]').click();
    assert.equal(await page.locator('#import-category').inputValue(),audioRoot.id,'audio import defaults to audio root instead of the active person category');
    const audioDestinations=await page.locator('#import-category option').evaluateAll(options=>options.map(option=>option.value));
    for(const id of personIds) assert.equal(audioDestinations.includes(id),false,'legacy unrestricted person branch excluded from audio import');
    await closeDialog();
    checks.push('legacy scope=all person folders retain stored scopes but audio import defaults and category choices honor their material role');

    await page.locator(`#subcategories [data-action="category"][data-id="${city.id}"]`).click();
    const sticky = await page.evaluate(() => {
      const selectors=['#search','#navigation','#subcategories','#app-update','[data-action="author-message"]'];
      const boxes=() => selectors.map(selector => { const r=document.querySelector(selector).getBoundingClientRect(); return [r.y,r.height]; });
      const before=boxes(); let owner=document.querySelector('#asset-grid').parentElement;
      while(owner && !(owner.scrollHeight>owner.clientHeight+100 && /auto|scroll/.test(getComputedStyle(owner).overflowY))) owner=owner.parentElement;
      if(!owner) owner=document.scrollingElement;
      owner.scrollTop=650;
      return new Promise(resolve => requestAnimationFrame(() => resolve({before,after:boxes(),scrollTop:owner.scrollTop})));
    });
    assert.ok(sticky.scrollTop>100, 'asset list really scrolled');
    assert.deepEqual(sticky.after,sticky.before,'search, both classification levels, updates and author entry stay fixed while assets scroll');
    await page.screenshot({ path:path.join(output, 'sticky-search-categories.png') });
    await topCategory(person.id);
    await page.locator('#subcategories [data-action="collection"][data-collection="favorites"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===1);
    assert.equal(await page.locator('.asset-card').count(),1,'person favorites stays scoped to person branch');
    await topCategory(person.id);
    await page.locator('#subcategories [data-action="collection"][data-collection="liked"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===1);
    assert.equal(await page.locator('.asset-card').count(),1,'person liked stays scoped to person branch');
    checks.push('real content scroll preserves search and two classification levels; favorite/liked filters stay within the selected root');

    await topCategory(person.id); await resize(1640,940);
    for(const value of ['7','8']) { await density(value); const report=await metrics('density-'+value); assert.equal(report.firstRow,Number(value),'requested full-width column count'); }
    for(const size of [[1080,760],[930,700],[850,600]]) {
      await resize(...size); const report=await metrics('modern-'+size.join('x'));
      assert.ok(report.firstRow < 8 && report.preview.width>=145,'narrow viewport reduces columns instead of squeezing actions');
      await page.screenshot({ path:path.join(output,'modern-'+size.join('x')+'.png') });
    }
    checks.push('7/8 columns render at wide width and automatically reduce at three smaller window sizes');

    await resize(1480,940); await density('7'); await openAppearance();
    const backgrounds=['checker','white','gray','dark'];
    for(const value of backgrounds) {
      await choose('background',value); await closeAppearance();
      const card=await page.locator('.card-preview.checkerboard').first().evaluate(element => ({ image:getComputedStyle(element).backgroundImage,color:getComputedStyle(element).backgroundColor }));
      if(value==='checker') assert.notEqual(card.image,'none'); else assert.equal(card.image,'none',value+' card removes grid');
      await page.locator('.asset-card [data-action="zoom-preview"]').first().click(); await page.waitForSelector('#dialog.preview-dialog[open]');
      const preview=await page.locator('.lightbox-preview').evaluate(element => ({ image:getComputedStyle(element).backgroundImage,color:getComputedStyle(element).backgroundColor }));
      assert.deepEqual(preview,card,'card and large preview share selected background');
      await page.screenshot({ path:path.join(output,'preview-background-'+value+'.png') }); await closeDialog(); await openAppearance();
    }
    assert.equal(await page.locator('[data-appearance-theme]').count(),6,'all six palettes remain selectable');
    await choose('background','white'); await choose('theme','bluewhite'); await closeAppearance();
    checks.push('four preview backgrounds update both cards and large preview without changing the material');

    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.asset-card')).borderTopColor==='rgb(223, 231, 242)');
    const bluewhite=await page.evaluate(()=>{
      const style=element=>getComputedStyle(document.querySelector(element));
      return {page:style('html').getPropertyValue('--bg').trim(),category:style('#subcategories').backgroundColor,
        selected:style('#subcategories .is-current').backgroundColor,selectedInk:style('#subcategories .is-current').color,
        root:style('#navigation .active').boxShadow,card:style('.asset-card').borderTopColor,
        preview:style('.card-preview.checkerboard').backgroundColor};
    });
    assert.equal(bluewhite.page,'#ffffff'); assert.equal(bluewhite.category,'rgb(247, 248, 250)');
    assert.equal(bluewhite.selected,'rgb(22, 115, 206)'); assert.equal(bluewhite.selectedInk,'rgb(255, 255, 255)');
    assert.ok(bluewhite.root.includes('64, 158, 255'),'reference blue marks selected top-level navigation');
    assert.equal(bluewhite.card,'rgb(223, 231, 242)'); assert.equal(bluewhite.preview,'rgb(255, 255, 255)');
    for(const size of [[1480,940],[930,700],[850,600]]) {
      await resize(...size); await metrics('bluewhite-'+size.join('x'));
      await page.screenshot({path:path.join(output,'bluewhite-'+size.join('x')+'.png')});
    }
    checks.push('reference-inspired bluewhite uses white pages, pale category capsules and readable blue selected states; wide and minimum windows fit');

    await page.locator('#search').fill('角色详情原始');
    for(const size of [[930,700],[850,600]]) {
      await resize(...size);
      await page.locator(`.asset-card[data-asset="${first.id}"] [data-action="zoom-preview"]`).click();
      const panel=await page.locator('#dialog').boundingBox(),viewport=await page.evaluate(()=>[innerWidth,innerHeight]);
      assert.ok(panel.x>=0 && panel.y>=0 && panel.x+panel.width<=viewport[0]+1 && panel.y+panel.height<=viewport[1]+1,'small preview dialog fits viewport');
      for(const selector of ['[data-field="name"]','[data-field="tags"]','[data-select-trigger="asset-category"]','[data-select-trigger="asset-add-category"]','[data-action="close-dialog"]']) {
        const control=page.locator('#dialog '+selector).first(); await control.scrollIntoViewIfNeeded();
        const box=await control.boundingBox();
        assert.ok(box && box.x>=panel.x && box.x+box.width<=panel.x+panel.width+1 && box.y>=0 && box.y+box.height<=viewport[1]+1,'small preview field reachable: '+selector);
      }
      assert.equal(await page.locator('#dialog').evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,'preview has no horizontal overflow');
      await page.screenshot({path:path.join(output,'preview-details-'+size.join('x')+'.png')});
      geometry.push({label:'preview-details-'+size.join('x'),viewport,panel});
      await closeDialog();
    }
    checks.push('930px and minimum windows keep all preview detail fields and close action reachable through ordinary dialog scrolling');
    await resize(1480,940);
    await page.locator(`.asset-card[data-asset="${first.id}"] .card-information > div:nth-child(2)`).click();
    await page.locator(`#selection-bar [data-action="zoom-preview"][data-id="${first.id}"]`).click();
    await page.waitForSelector('#dialog.preview-dialog[open]');
    assert.equal(await page.locator('#dialog [data-field="name"]').count(),1);
    checks.push('a single selected material opens the same preview editor from its Details action');
    await checkDraftRecovery(first.id);
    const editedName='弹窗编辑已保存';
    await page.locator('#dialog [data-field="name"]').fill(editedName); await page.locator('#dialog [data-field="name"]').press('Tab');
    await page.waitForFunction(async({id,name}) => (await window.shelf.snapshot()).assets.find(asset=>asset.id===id)?.name===name,{id:first.id,name:editedName});
    await page.locator('#dialog [data-field="tags"]').fill('都市，验收'); await page.locator('#dialog [data-field="tags"]').press('Tab');
    await page.waitForFunction(async id => (await window.shelf.snapshot()).assets.find(asset=>asset.id===id)?.tags?.join()==='都市,验收',first.id);
    await page.locator('#dialog select[data-field="category"]').locator('..').locator('[data-select-trigger]').click();
    await page.locator('[data-category-search]').fill('详情移动验收'); await page.locator(`[data-category-option="${target.id}"]`).click();
    await page.waitForFunction(async({assetId,categoryId}) => (await window.shelf.snapshot()).assets.find(asset=>asset.id===assetId)?.categoryId===categoryId,{assetId:first.id,categoryId:target.id});
    await addMembership(city.id);
    await page.screenshot({ path:path.join(output,'preview-with-details.png') }); await closeDialog();
    assert.equal(await page.locator('#inspector:visible').count(),0);
    checks.push('name, tags, category movement and extra membership are edited inside the preview dialog; no external detail pane');

    await page.locator('[data-action="create-project"]').click();
    await page.locator('#project-name').fill('星河短剧 · 验收'); await page.locator('[data-action="save-project"]').click();
    await page.waitForFunction(() => !document.querySelector('#dialog').open);
    const project=await page.evaluate(async () => (await window.shelf.snapshot()).categories.find(item => item.kind==='project' && item.name==='星河短剧 · 验收'));
    assert.ok(project,'project persisted'); createdProjectId=project.id;
    // Use the same UI detail flow to add the edited character and audio to a shared project.
    await topCategory(person.id); await page.locator('#search').fill(editedName);
    await page.locator('.asset-card [data-action="zoom-preview"]').first().click();
    await addMembership(createdProjectId);
    await closeDialog();
    await topCategory(audioRoot.id); await page.locator('.audio-card .card-preview [data-action="zoom-preview"]').first().click();
    await page.waitForSelector('#dialog.preview-dialog[open]');
    const audioDetailDestinations=await page.locator('#dialog select[data-field="category"] option,#dialog select[data-field="add-category"] option').evaluateAll(options=>options.map(option=>option.value));
    for(const id of personIds) assert.equal(audioDetailDestinations.includes(id),false,'legacy person branch excluded from audio detail moves/additions');
    await addMembership(createdProjectId); await closeDialog();
    await topCategory(createdProjectId); assert.equal(await page.locator('.asset-card').count(),2,'shared project shows character plus audio');
    checks.push('a top-level project groups existing character and audio records without duplication');

    await page.locator('[data-action="author-message"]').click();
    assert.ok((await page.locator('#dialog').textContent()).includes('安屿动画'),'author message has editable provisional copy with attribution'); await closeDialog();
    const updateButton=await page.locator('#app-update').boundingBox();
    assert.ok(updateButton && updateButton.width>=85 && updateButton.height>=26,'prominent update button has a readable target');
    await page.locator('#app-update').click(); await page.waitForSelector('#update-panel');
    await closeDialog();
    checks.push('author message and update status have independent persistent visible entries');

    await topCategory(person.id); await page.locator('#search').fill('分类布局测试');
    await page.locator('[data-action="next-page"]').click();
    await page.locator('.asset-card .card-information > div:nth-child(2)').first().click();
    await page.locator('.asset-card .card-information > div:nth-child(2)').nth(1).click({modifiers:['Control']});
    await page.evaluate(() => { globalThis.practicalProbe={ nodes:[...document.querySelectorAll('.asset-card')], selected:[...document.querySelectorAll('.asset-card.selected')].map(card=>card.dataset.asset), query:document.querySelector('#search').value,page:document.querySelector('#asset-pagination').textContent }; });
    await openAppearance();
    for(const layout of ['classic','modern']) {
      await choose('layout',layout);
      for(const theme of ['dark','warm','paper','slate','sage','bluewhite']) {
        await choose('theme',theme);
      assert.equal(await page.evaluate(() => { const p=globalThis.practicalProbe; return p.nodes.every((node,index)=>node===document.querySelectorAll('.asset-card')[index]) && p.selected.join()===[...document.querySelectorAll('.asset-card.selected')].map(card=>card.dataset.asset).join() && p.query===document.querySelector('#search').value && p.page===document.querySelector('#asset-pagination').textContent; }),true,'appearance preserves exact DOM/page/query/selection');
      }
    }
    await closeAppearance(); await topCategory(audioRoot.id);
    await page.locator('.audio-card [data-action="play-audio"]').first().click();
    await page.waitForFunction(() => document.querySelector('#audio-player').dataset.playing==='true' && Number(document.querySelector('#audio-player').dataset.time)>0);
    const playing=await page.locator('#audio-player').getAttribute('data-id');
    await openAppearance(); await choose('layout','classic'); await choose('background','gray'); await choose('theme','bluewhite'); await choose('layout','modern');
    assert.equal(await page.locator('#audio-player').getAttribute('data-id'),playing); assert.equal(await page.locator('#audio-player').getAttribute('data-playing'),'true');
    await closeAppearance(); await page.locator('[data-action="audio-stop"]').click();
    checks.push('both layouts and all six themes retain exact card DOM, query, selection and page; bluewhite/background switches preserve actual WAV playback');

    await app.close(); app=null; await launch();
    assert.equal(await page.locator('html').getAttribute('data-layout'),'modern');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'bluewhite');
    assert.equal(await page.locator('html').getAttribute('data-preview-background'),'gray');
    assert.equal(await page.locator('#density-label').textContent(),'每行 7 个');
    const after=await page.evaluate(() => window.shelf.snapshot());
    const edited=after.assets.find(asset=>asset.id===first.id);
    assert.equal(edited.name,'弹窗编辑已保存'); assert.deepEqual(edited.tags,['都市','验收']);
    assert.ok(edited.categoryIds.includes(target.id) && edited.categoryIds.includes(city.id) && edited.categoryIds.includes(createdProjectId));
    assert.ok(after.assets.find(asset=>asset.id===audio.id).categoryIds.includes(createdProjectId));
    for(const category of after.categories.filter(category=>personIds.has(category.id))) assert.equal(category.scope,'all','legacy scope metadata preserved');
    assert.deepEqual(after.assets.map(asset=>asset.id).sort(),before.assets.map(asset=>asset.id).sort(),'grouping never duplicates material identities');
    await app.close(); app=null;
    for(const payload of payloads) assert.equal(digest(await fs.readFile(path.join(data,payload.managedPath))),payload.hash,'managed bytes remain unchanged: '+payload.id);
    assert.deepEqual(await Promise.all(originalFiles.map(async file=>digest(await fs.readFile(file)))),originals,'external originals unchanged');
    assert.deepEqual(errors,[]);
    checks.push('real restart restores background/density/appearance and detail/project edits; all identities and source/managed bytes are preserved; zero renderer errors');
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,context:runtimeContexts[0],runtimeContexts,checks,geometry,draftObservations,pageErrors:errors},null,2));
    console.log(JSON.stringify({passed:true,context:runtimeContexts[0],launches:runtimeContexts.length,checks,geometryCases:geometry.length,pageErrors:errors,output},null,2));
  } catch(error) {
    if(page && !page.isClosed()) await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.stack,runtimeContexts,checks,geometry,draftObservations,pageErrors:errors},null,2)); throw error;
  } finally {
    if(app) await app.close();
    await fs.rm(temporary,{recursive:true,force:true});
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
