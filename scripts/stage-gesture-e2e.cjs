/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const checks = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 240 } });
    page.on('pageerror', error => errors.push(error.message));
    const module = await fs.readFile(path.join(root, 'ui/stage-drag.mjs'), 'utf8');
    await page.route('http://stage.test/**', route => {
      if (new URL(route.request().url()).pathname === '/stage-drag.mjs') return route.fulfill({ contentType: 'text/javascript', body: module });
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:20px}span{display:block;margin:20px;padding:12px;width:200px;background:#eee;user-select:none}</style><span id="fla" data-stage-drag-id="weapon">FLA 舞台拖动</span><span id="audio" draggable="true">原生音频</span><script type="module">import {mountStageDrag} from "./stage-drag.mjs";window.test={calls:[],states:[],errors:[],htmlDrags:0};const shelf={beginStageDrag(id){test.calls.push(["begin",id]);return test.defer?new Promise(resolve=>test.resolve=resolve):Promise.resolve({token:"token-1",expiresAt:Date.now()+30000});},endStageDrag(token){test.calls.push(["end",token]);return Promise.resolve({ok:true,waiting:true});},cancelStageDrag(token){test.calls.push(["cancel",token]);return Promise.resolve({cancelled:true});},onStageDragResult(fn){test.result=fn;return()=>test.unsubscribed=true;}};test.shelf=shelf;test.controller=mountStageDrag({root:document,shelf,getAsset:id=>({id,kind:"fla"}),onState:value=>test.states.push(value),onError:error=>test.errors.push(error.message)});document.addEventListener("dragstart",e=>{test.htmlDrags++;if(e.target.id==="audio")test.calls.push(["audio-file"]);});test.ready=true;</script>' });
    });
    await page.goto('http://stage.test/');
    await page.waitForFunction(() => window.test?.ready);
    const box = await page.locator('#fla').boundingBox(), x = box.x + 30, y = box.y + 20;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 3, y); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => test.calls), []);
    checks.push('real pointer click and small movement do not start a transfer');
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 12, y);
    await page.waitForFunction(() => test.states.includes('dragging'));
    await page.mouse.move(420, 170); await page.mouse.up();
    await page.waitForFunction(() => test.calls.some(call => call[0] === 'end'));
    assert.deepEqual(await page.evaluate(() => test.calls), [['begin', 'weapon'], ['end', 'token-1']]);
    assert.equal(await page.evaluate(() => test.htmlDrags), 0);
    await page.evaluate(() => test.result({ token: 'token-1', ok: true, requestId: 'request-1' }));
    assert.equal(await page.evaluate(() => test.controller.active), null);
    checks.push('FLA capture survives leaving handle; release ends guarded gesture without HTML file drag');
    await page.evaluate(() => { test.calls = []; test.states = []; test.defer = true; });
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 12, y); await page.mouse.up();
    await page.evaluate(() => test.resolve({ token: 'late-token' }));
    await page.waitForFunction(() => test.calls.some(call => call[0] === 'cancel'));
    assert.deepEqual(await page.evaluate(() => test.calls), [['begin', 'weapon'], ['cancel', 'late-token']]);
    checks.push('release during native helper startup cancels rather than queues');
    await page.evaluate(() => { test.calls = []; test.states = []; test.defer = false; });
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 12, y);
    await page.waitForFunction(() => test.states.includes('dragging'));
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.waitForFunction(() => test.calls.some(call => call[0] === 'cancel'));
    assert.deepEqual(await page.evaluate(() => test.calls), [['begin', 'weapon'], ['cancel', 'token-1']]);
    checks.push('Escape cancels the gesture and releases capture');
    await page.evaluate(() => { test.calls=[];test.states=[];window.test.shelf.confirmStageHandoff=token=>{test.calls.push(['handoff',token]);return Promise.resolve({approved:true});}; });
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+12,y);
    await page.waitForFunction(()=>test.states.includes('dragging'));
    await page.evaluate(()=>test.result({token:'token-1',phase:'host-handoff',pid:42}));
    await page.waitForFunction(()=>test.calls.some(call=>call[0]==='handoff'));
    await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:test.controller.active.pointerId,bubbles:true})));
    assert.notEqual(await page.evaluate(()=>test.controller.active),null);assert.equal(await page.evaluate(()=>test.calls.some(call=>call[0]==='cancel')),false);
    await page.mouse.up();await page.evaluate(()=>test.result({token:'token-1',ok:true,requestId:'handoff-done'}));
    assert.equal(await page.evaluate(()=>test.controller.active),null);
    checks.push('native AN taskbar handoff releases browser capture without canceling the verified release observer');
    assert.deepEqual(errors, []);
    const result = { checks, pageErrors: errors };
    await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
    await fs.writeFile(path.join(root, 'test-output/stage-gesture-e2e-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
