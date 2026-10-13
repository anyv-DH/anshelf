/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');

function fixture(){
  const window=new EventEmitter();
  Object.assign(window,{bounds:{x:80,y:90,width:1280,height:800},top:false,maximized:false,fullscreen:false,focused:true,
    isDestroyed:()=>false,isFocused(){return this.focused;},isMaximized(){return this.maximized;},isFullScreen(){return this.fullscreen;},
    getBounds(){return{...this.bounds};},getNormalBounds(){return{...this.bounds};},setBounds(bounds){this.bounds={...bounds};},
    setSize(width,height){this.bounds={...this.bounds,width,height};},setAlwaysOnTop(top){this.top=top;},
    maximize(){this.maximized=true;this.emit('maximize');},unmaximize(){this.maximized=false;this.emit('unmaximize');},
    minimize(){this.minimized=true;this.focused=false;this.emit('minimize');},close(){this.closed=true;this.emit('closed');}});
  const {createWindowMode}=require('../desktop/window-mode.cjs');
  return{window,mode:createWindowMode(window)};
}

test('mini mode restores the preceding window size and does not impose its topmost state on maximum view',()=>{
  const {window,mode}=fixture();
  assert.equal(mode.toggleCompact(),true);assert.equal(window.top,true);assert.deepEqual([window.bounds.width,window.bounds.height],[930,700]);
  assert.equal(mode.action('maximize').maximized,true);assert.equal(window.top,false);assert.equal(mode.compact,false);
  assert.deepEqual(window.bounds,{x:80,y:90,width:1280,height:800});
  mode.action('maximize');assert.equal(window.maximized,false);assert.equal(window.top,false);
});

test('switching to another application releases mini topmost until the manager is focused again',()=>{
  const {window,mode}=fixture();mode.toggleCompact();
  window.focused=false;window.emit('blur');assert.equal(window.top,false);assert.equal(mode.compact,true);
  window.focused=true;window.emit('focus');assert.equal(window.top,true);
  mode.toggleCompact();assert.equal(window.top,false);assert.deepEqual(window.bounds,{x:80,y:90,width:1280,height:800});
});

test('native maximum/fullscreen and minimization clear pinning so other programs can appear on top',()=>{
  for(const event of ['maximize','enter-full-screen','minimize']){
    const {window,mode}=fixture();mode.toggleCompact();window.emit(event);
    assert.equal(window.top,false,event);assert.equal(mode.compact,false,event);
    window.emit('focus');assert.equal(window.top,false,event);
  }
});

test('mini mode from maximized view restores the maximized layout on exit and handles close',()=>{
  const {window,mode}=fixture();window.maximize();mode.toggleCompact();assert.equal(window.maximized,false);
  mode.toggleCompact();assert.equal(window.maximized,true);assert.equal(window.top,false);
  mode.action('minimize');assert.equal(window.minimized,true);mode.action('close');assert.equal(window.closed,true);
});
