/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
function setup(options={}){
  const handlers=new Map(),sent=[],outcomes=[],sender=new EventEmitter(),buffer=Buffer.alloc(8);buffer.writeBigUInt64LE(123n);
  let clock=1000,focused=true,capable=true,doc=77,pid=2,exists=true,cursor={x:240,y:150},release,stopped=0,gestureSpec,approved=[];
  const monitor={start:spec=>{gestureSpec=spec;let releaseResolve;const released=new Promise(resolve=>releaseResolve=resolve);release=releaseResolve;
    return{started:Promise.resolve({ok:true,x:50,y:50,observedAt:1000,buttonDown:true,root:{hwnd:'123',enabled:true,visible:true},...options.initial}),released,approveHost(value){approved.push(value);return true;},stop(){stopped++;}}}};
  const {registerStageDrag}=require('../desktop/stage-drag.cjs');
  const drag=registerStageDrag({ipcMain:{handle:(n,h)=>handlers.set(n,h),removeHandler:n=>handlers.delete(n)},webContents:sender,
    sourceWindow:{getNativeWindowHandle:()=>buffer,isFocused:()=>focused,isDestroyed:()=>false},getAsset:id=>exists&&id==='known-fla'?{id,kind:'fla'}:id==='known-audio'?{id,kind:'audio'}:null,
    getBridgeStatus:()=>({connected:true,heartbeat:{busy:false,documentId:doc,pid,capabilities:capable?{stageDrop:1}:{}}}),sendStageDrop:async(id,target)=>{sent.push({id,target});return{requestId:'req'};},
    monitor,screen:{getCursorScreenPoint:()=>cursor,screenToDipPoint:p=>p},now:()=>clock,onResult:r=>outcomes.push(r),...options.register});
  const call=(n,...args)=>handlers.get('shelf:'+n)({sender},...args);
  const drop=async(value={})=>{release({ok:true,x:240,y:150,observedAt:1200,buttonDown:false,root:{hwnd:'456',pid:2,enabled:true,visible:true,exe:'D:\\AN2023\\Animate.exe'},ancestors:[{pid:2,className:'OWL.Document'}],...value});await new Promise(resolve=>setImmediate(resolve));};
  const hover=async(value={})=>{gestureSpec.onHover?.({ok:true,phase:'host-hover',hoverId:1,x:240,y:150,observedAt:1200,buttonDown:true,taskbar:true,host:{hwnd:'456',pid:2,exe:'D:\\AN2023\\Animate.exe',className:'Adobe Animate 2023',enabled:true,visible:true},...value});await new Promise(resolve=>setImmediate(resolve));};
  return{handlers,sender,drag,call,drop,hover,sent,outcomes,approved,get gestureSpec(){return gestureSpec},get stopped(){return stopped},setClock:v=>clock=v,setFocus:v=>focused=v,setCapability:v=>capable=v,setDoc:v=>doc=v,setPid:v=>pid=v,setExists:v=>exists=v,setCursor:v=>cursor=v};
}
test('trusted stage gesture begins without pending mutation and native release is the only insertion trigger',async()=>{
  const f=setup();const {token,expiresAt}=await f.call('begin-stage-drag','known-fla');assert.match(token,/^[a-f0-9-]{36}$/);assert.equal(expiresAt,31000);assert.equal(f.sent.length,0);
  assert.deepEqual(await f.call('end-stage-drag',token,{x:240,y:150}),{ok:true,waiting:true});assert.equal(f.sent.length,0);
  f.setClock(1200);await f.drop();assert.deepEqual(f.sent,[{id:'known-fla',target:{documentId:77,pid:2,hwnd:'456'}}]);assert.equal(f.outcomes.length,1);assert.equal(f.outcomes[0].ok,true);
  await assert.rejects(f.call('end-stage-drag',token),/令牌|失效/);assert.equal(f.stopped,2);
});
test('stage drag rejects untrusted sender, invalid IDs, audio and unfocused source gestures',async()=>{
  const f=setup();await assert.rejects(f.handlers.get('shelf:begin-stage-drag')({sender:{}},'known-fla'),/不允许/);
  for(const id of ['missing','known-audio',{file:'outside.fla'},'../outside'])await assert.rejects(f.call('begin-stage-drag',id),/素材|格式|参数/);
  f.setFocus(false);await assert.rejects(f.call('begin-stage-drag','known-fla'),/窗口/);assert.equal(f.sent.length,0);f.drag.dispose();
});
test('source root and mouse down are verified from native helper independently of renderer',async()=>{
  for(const initial of [{buttonDown:false},{root:{hwnd:'999',enabled:true,visible:true}},{ok:false},{root:{hwnd:'123',enabled:false,visible:true}}]){
    const f=setup({initial});await assert.rejects(f.call('begin-stage-drag','known-fla'),/鼠标|拖拽/);assert.equal(f.sent.length,0);assert.equal(f.drag.active,null);assert.equal(f.stopped,1);f.drag.dispose();
  }
});
test('old CEP capability and null document/PID fail closed before monitor starts',async()=>{
  for(const field of ['capability','doc','pid']){const f=setup();if(field==='capability')f.setCapability(false);else if(field==='doc')f.setDoc(null);else f.setPid(null);await assert.rejects(f.call('begin-stage-drag','known-fla'),/面板|文档/);assert.equal(f.drag.active,null);assert.equal(f.sent.length,0);f.drag.dispose();}
});
test('wrong native target, stale detection, blocked dialog, missing document and different process do not insert',async()=>{
  for(const failure of [
    {root:{hwnd:'456',pid:2,enabled:true,visible:true,exe:'C:\\Other.exe'}},
    {root:{hwnd:'456',pid:2,enabled:false,visible:true,exe:'D:\\AN2023\\Animate.exe'}},
    {root:{hwnd:'456',pid:3,enabled:true,visible:true,exe:'D:\\AN2023\\Animate.exe'}},
    {ancestors:[]},{buttonDown:true},{observedAt:1},{ok:false,reason:'escape'},
  ]){const f=setup();const {token}=await f.call('begin-stage-drag','known-fla');f.setClock(1200);await f.drop(failure);assert.equal(f.sent.length,0);assert.equal(f.outcomes[0].ok,false);await assert.rejects(f.call('end-stage-drag',token),/令牌|失效/);f.drag.dispose();}
});
test('physical target coordinates convert to DIP once and large cursor mismatch cancels',async()=>{
  const f=setup({register:{screen:{getCursorScreenPoint:()=>({x:160,y:100}),screenToDipPoint:p=>({x:p.x/1.5,y:p.y/1.5})}}});await f.call('begin-stage-drag','known-fla');f.setClock(1200);await f.drop();assert.equal(f.sent.length,1);f.drag.dispose();
  const g=setup();await g.call('begin-stage-drag','known-fla');g.setClock(1200);g.setCursor({x:500,y:500});await g.drop();assert.equal(g.sent.length,0);assert.match(g.outcomes[0].error,/位置/);g.drag.dispose();
});
test('cancel and expired token stop only the active watcher and never alter pending',async()=>{
  const f=setup();const {token}=await f.call('begin-stage-drag','known-fla');assert.deepEqual(await f.call('cancel-stage-drag',token),{cancelled:true});await f.drop();assert.equal(f.sent.length,0);assert.equal(f.outcomes.length,1);assert.equal(f.outcomes[0].cancelled,true);f.drag.dispose();
  const g=setup();const t=await g.call('begin-stage-drag','known-fla');g.setClock(t.expiresAt);await assert.rejects(g.call('end-stage-drag',t.token),/过期/);assert.equal(g.drag.active,null);assert.equal(g.sent.length,0);g.drag.dispose();
});
test('begin reserves gesture before async helper started and forged tokens cannot cancel it',async()=>{
  const f=setup();const first=f.call('begin-stage-drag','known-fla');await assert.rejects(f.call('begin-stage-drag','known-fla'),/拖拽/);const {token}=await first;
  await assert.rejects(f.call('cancel-stage-drag','forged'),/令牌/);assert.deepEqual(await f.call('cancel-stage-drag',token),{cancelled:true});assert.equal(f.sent.length,0);f.drag.dispose();
});
test('document switch, disconnected capability and removed asset at release never insert',async()=>{
  for(const kind of ['doc','cap','asset']){const f=setup();await f.call('begin-stage-drag','known-fla');if(kind==='doc')f.setDoc(88);else if(kind==='cap')f.setCapability(false);else f.setExists(false);f.setClock(1200);await f.drop();assert.equal(f.sent.length,0);assert.equal(f.outcomes[0].ok,false);f.drag.dispose();}
});
test('renderer destruction removes handlers and cancels a waiting gesture',async()=>{
  const f=setup();await f.call('begin-stage-drag','known-fla');f.sender.emit('destroyed');assert.equal(f.handlers.size,0);assert.equal(f.drag.active,null);await f.drop();assert.equal(f.sent.length,0);
});
test('missing native target executable fails before subprocess launch',()=>{
  const {createNativeTargetProbe}=require('../desktop/stage-drag.cjs');assert.throws(()=>createNativeTargetProbe({helperPath:'Z:\\missing\\target-probe.exe'}),/工具不存在/);
});
test('missing CEP PID permits exactly one native Animate process and propagates that PID',async()=>{
  const f=setup({register:{getAnimatePids:async()=>[2]}});f.setPid(null);f.setDoc(0);await f.call('begin-stage-drag','known-fla');f.setClock(1200);await f.drop();assert.deepEqual(f.sent,[{id:'known-fla',target:{documentId:0,pid:2,hwnd:'456'}}]);f.drag.dispose();
  const g=setup({register:{getAnimatePids:async()=>[2,3]}});g.setPid(null);await g.call('begin-stage-drag','known-fla');g.setClock(1200);await g.drop();assert.equal(g.sent.length,0);assert.match(g.outcomes[0].error,/多个|未知/);g.drag.dispose();
});
test('cancellation while native process query is pending prevents a late stage insertion',async()=>{
  let resolvePids;const f=setup({register:{getAnimatePids:()=>new Promise(resolve=>resolvePids=resolve)}});f.setPid(null);const {token}=await f.call('begin-stage-drag','known-fla');f.setClock(1200);
  const dropping=f.drop();await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof resolvePids,'function');await f.call('cancel-stage-drag',token);resolvePids([2]);await dropping;
  assert.equal(f.sent.length,0);assert.equal(f.outcomes.length,1);assert.equal(f.outcomes[0].cancelled,true);f.drag.dispose();
});

test('flat Animate work area requires a confirmed native client hit and never treats titlebar as a stage drop',async()=>{
  for(const clientArea of [false,undefined]){
    const f=setup();await f.call('begin-stage-drag','known-fla');f.setClock(1200);
    await f.drop({clientArea,root:{hwnd:'456',pid:2,enabled:true,visible:true,exe:'D:\\AN2023\\Animate.exe',className:'Adobe Animate 2023'},ancestors:[{pid:2,className:'Adobe Animate 2023'}]});
    assert.equal(f.sent.length,0);assert.equal(f.outcomes[0].ok,false);f.drag.dispose();
  }
  const f=setup();await f.call('begin-stage-drag','known-fla');f.setClock(1200);
  await f.drop({clientArea:true,root:{hwnd:'456',pid:2,enabled:true,visible:true,exe:'D:\\AN2023\\Animate.exe',className:'Adobe Animate 2023'},ancestors:[{pid:2,className:'Adobe Animate 2023'}]});
  assert.equal(f.sent.length,1);f.drag.dispose();
});

test('menus, modal dialogs, palettes and CEP child windows cannot trigger automatic stage insertion',async()=>{
  for(const className of ['#32768','#32770','OWL.Dialog','OWL.ModalDialog','OWL.Palette','Chrome_WidgetWin_0','Chrome_RenderWidgetHostHWND','CEPDockable']){
    const f=setup();await f.call('begin-stage-drag','known-fla');f.setClock(1200);
    await f.drop({clientArea:true,root:{hwnd:'456',pid:2,enabled:true,visible:true,exe:'D:\\AN2023\\Animate.exe',className:'Adobe Animate 2023'},ancestors:[{pid:2,className},{pid:2,className:'OWL.Document'}]});
    assert.equal(f.sent.length,0,`${className} cannot insert`);assert.equal(f.outcomes[0].ok,false);f.drag.dispose();
  }
  for(const className of ['#32768','#32770','OWL.Dialog','OWL.ModalDialog','OWL.Palette']){
    const f=setup();await f.call('begin-stage-drag','known-fla');f.setClock(1200);
    await f.drop({clientArea:true,root:{hwnd:'456',pid:2,enabled:true,visible:true,exe:'D:\\AN2023\\Animate.exe',className},ancestors:[{pid:2,className:'OWL.Document'}]});
    assert.equal(f.sent.length,0,`root ${className} cannot insert`);f.drag.dispose();
  }
});

test('verified taskbar hover hands off the gesture to the native AN host without queuing a paste before release',async()=>{
  const f=setup();const {token}=await f.call('begin-stage-drag','known-fla');assert.equal(f.gestureSpec.targetPid,2);f.setClock(1200);await f.hover();
  assert.equal(f.sent.length,0);assert.deepEqual(f.approved,[]);
  assert.deepEqual(f.outcomes,[{token,phase:'host-handoff',pid:2}]);
  assert.deepEqual(await f.call('confirm-stage-handoff',token),{approved:true});assert.deepEqual(f.approved,[{pid:2,hwnd:'456',hoverId:1}]);
  await f.drop();assert.equal(f.sent.length,1);assert.equal(f.outcomes.at(-1).ok,true);f.drag.dispose();
});

test('hover cannot activate an unrelated app, released gesture, stale hit or mismatched process',async()=>{
  for(const value of [{buttonDown:false},{taskbar:false},{observedAt:1},{host:{hwnd:'456',pid:2,exe:'C:\\WeChat.exe',className:'Adobe Animate 2023',enabled:true,visible:true}},{host:{hwnd:'456',pid:3,exe:'D:\\AN2023\\Animate.exe',className:'Adobe Animate 2023',enabled:true,visible:true}}]){
    const f=setup();await f.call('begin-stage-drag','known-fla');f.setClock(1200);await f.hover(value);assert.equal(f.approved.length,0);assert.equal(f.sent.length,0);f.drag.dispose();
  }
});

test('cancel, document switch and an asynchronously unresolved native PID query never permit a late hover activation',async()=>{
  const f=setup();const {token}=await f.call('begin-stage-drag','known-fla');f.setClock(1200);await f.call('cancel-stage-drag',token);await f.hover();assert.equal(f.approved.length,0);
  const g=setup();await g.call('begin-stage-drag','known-fla');g.setClock(1200);g.setDoc(88);await g.hover();assert.equal(g.approved.length,0);g.drag.dispose();
  let resolvePids;const h=setup({register:{getAnimatePids:()=>new Promise(resolve=>resolvePids=resolve)}});h.setPid(null);const pending=await h.call('begin-stage-drag','known-fla');h.setClock(1200);await h.hover();assert.equal(typeof resolvePids,'function');
  await h.call('cancel-stage-drag',pending.token);resolvePids([2]);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.approved.length,0);assert.equal(h.sent.length,0);h.drag.dispose();
});

test('taskbar hover activation is gated by a renderer handoff acknowledgment and cannot be approved twice',async()=>{
  const f=setup();const {token}=await f.call('begin-stage-drag','known-fla');f.setClock(1200);await f.hover();
  await assert.rejects(f.call('confirm-stage-handoff','wrong'),/令牌|失效/);assert.equal(f.approved.length,0);
  f.setDoc(88);await assert.rejects(f.call('confirm-stage-handoff',token),/文档已切换/);assert.equal(f.approved.length,0);f.drag.dispose();
  const g=setup();const t=await g.call('begin-stage-drag','known-fla');g.setClock(1200);await g.hover();assert.deepEqual(await g.call('confirm-stage-handoff',t.token),{approved:true});
  await assert.rejects(g.call('confirm-stage-handoff',t.token),/已经处理/);g.drag.dispose();
});
