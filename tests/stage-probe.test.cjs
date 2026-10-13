/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const path=require('node:path');
const {createNativeTargetProbe}=require('../desktop/stage-drag.cjs');
function fixture(){
  const calls=[],commands=[],child=new EventEmitter();let stopped=0;
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
  child.stdin.write=text=>{commands.push(JSON.parse(text));return true;};child.kill=()=>{stopped++;};
  const probe=createNativeTargetProbe({helperPath:path.join(__dirname,'../desktop/native/stage-target.exe'),spawn:(...args)=>{calls.push(args);return child;}});
  return{probe,calls,commands,emit:message=>child.stdout.emit('data',JSON.stringify(message)+'\n'),get stopped(){return stopped;}};
}
test('native hover protocol scopes activation to a verified started gesture and leaves release observation pending',async()=>{
  const f=fixture(),hovers=[];assert.equal(f.calls.length,0,'no idle observer process');
  const gesture=f.probe.start({sourceHwnd:'123',targetPid:42,ttlMs:1000,onHover:value=>hovers.push(value)});
  assert.deepEqual(f.calls[0][1],['watch','123','1000','42']);assert.equal(f.calls[0][2].shell,false);
  assert.equal(gesture.approveHost({pid:42,hwnd:'456',hoverId:1}),false);
  f.emit({phase:'started',ok:true});await gesture.started;
  f.emit({phase:'host-hover',ok:true,hoverId:1,host:{pid:42,hwnd:'456'}});assert.equal(hovers.length,1);
  assert.equal(gesture.approveHost({pid:42,hwnd:'456',hoverId:1}),true);
  assert.deepEqual(f.commands,[{phase:'approve-host',pid:42,hwnd:'456',hoverId:1}]);
  f.emit({phase:'released',ok:true});assert.equal((await gesture.released).phase,'released');
  assert.equal(gesture.approveHost({pid:42,hwnd:'456',hoverId:1}),false);gesture.stop();
});
test('cancellation or malformed hover sequence cannot activate AN after release or before source verification',async()=>{
  const f=fixture(),gesture=f.probe.start({sourceHwnd:'123',ttlMs:1000});
  f.emit({phase:'host-hover'});await assert.rejects(gesture.started,/无效结果/);await assert.rejects(gesture.released,/无效结果/);
  assert.equal(f.commands.length,0);assert.equal(f.stopped,1);
  const g=fixture(),started=g.probe.start({sourceHwnd:'123',targetPid:42,ttlMs:1000});g.emit({phase:'started'});await started.started;started.stop();
  await assert.rejects(started.released,/取消/);assert.equal(started.approveHost({pid:42,hwnd:'456',hoverId:1}),false);assert.equal(g.commands.length,0);
});
