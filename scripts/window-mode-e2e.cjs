/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
const {_electron}=require(process.env.ANSHELF_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');
function closeBounds(actual,expected){for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<=1,`${key} stayed within one DIP after the native round trip`);}
async function main(){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-window-mode-'));let app;
  const checks=[];
  try{
    app=await _electron.launch({executablePath:require(path.join(root,'node_modules/electron')),args:[root,'--user-data-dir='+path.join(temporary,'profile')],env:{...process.env,ANSHELF_DATA_DIR:path.join(temporary,'library')},timeout:60000});
    const page=await app.firstWindow();await page.waitForSelector('#compact');
    const native=()=>app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];return{bounds:window.getBounds(),maximized:window.isMaximized(),fullScreen:window.isFullScreen(),top:window.isAlwaysOnTop()};});
    await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setSize(1280,800);});
    const normalBefore=(await native()).bounds;
    await page.evaluate(()=>window.shelf.compact());assert.equal((await native()).top,true);assert.ok(Math.abs((await native()).bounds.width-930)<=1);assert.ok(Math.abs((await native()).bounds.height-700)<=1);
    await page.evaluate(()=>window.shelf.windowAction('maximize'));await page.waitForTimeout(200);assert.equal((await native()).maximized,true);assert.equal((await native()).top,false);
    await page.evaluate(()=>window.shelf.windowAction('maximize'));await page.waitForTimeout(150);assert.equal((await native()).top,false);closeBounds((await native()).bounds,normalBefore);
    checks.push('real Electron mini maximum and restore keeps normal bounds and releases topmost');
    const normalBeforeSecond=(await native()).bounds;
    await page.evaluate(()=>window.shelf.compact());await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.emit('blur');});assert.equal((await native()).top,false);
    await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.emit('focus');});assert.equal((await native()).top,true);
    await page.evaluate(()=>window.shelf.compact());assert.equal((await native()).top,false);closeBounds((await native()).bounds,normalBeforeSecond);
    checks.push('real Electron pin state follows focus events and compact exits to original size');
    await page.evaluate(()=>window.shelf.compact());await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(true));await page.waitForTimeout(150);assert.equal((await native()).top,false);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(false));await page.waitForTimeout(150);assert.equal((await native()).top,false);
    checks.push('real Electron full-screen clears mini pinning');
    const result={passed:checks.length,checks};await fs.writeFile(path.join(root,'test-output/window-mode-e2e-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{if(app)await app.close();await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
