/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const MAX_TTL_MS=30_000;

function handleValue(window){const b=window?.getNativeWindowHandle?.();if(!Buffer.isBuffer(b)||![4,8].includes(b.length))throw new Error('素材管理器窗口句柄无效');return b.length===8?b.readBigUInt64LE().toString():String(b.readUInt32LE());}
function nativeHelperPath(value){
  if(typeof value!=='string'||!path.isAbsolute(value)||path.extname(value).toLowerCase()!=='.exe')throw new Error('本机拖拽检测工具路径无效');
  let file=path.resolve(value);for(let p=file;;p=path.dirname(p)){let stat;try{stat=fs.lstatSync(p);}catch{throw new Error('本机拖拽检测工具不存在');}if(stat.isSymbolicLink())throw new Error('本机拖拽检测工具路径包含链接');if(p===file&&!stat.isFile())throw new Error('本机拖拽检测工具无效');if(path.dirname(p)===p)break;}return file;
}
function validPoint(v){return v&&typeof v.x==='number'&&Number.isFinite(v.x)&&typeof v.y==='number'&&Number.isFinite(v.y);}
function validNative(v){return v&&v.ok===true&&validPoint(v)&&typeof v.observedAt==='number'&&Number.isFinite(v.observedAt)&&v.root&&/^\d+$/.test(String(v.root.hwnd||''));}
function isAnimateTarget(value,pid){
  const r=value?.root;
  const classes=[r?.className,...(Array.isArray(value?.ancestors)?value.ancestors.map(p=>p?.className):[])].map(v=>String(v||''));
  const forbiddenHit=classes.some(name=>/^#327(?:68|70)$/.test(name)||/^OWL\.(?:Palette|Dialog|ModalDialog)$/i.test(name)||/^Chrome_(?:WidgetWin|RenderWidgetHostHWND)/i.test(name)||/^CEPDockable$/i.test(name));
  const documentHit=Array.isArray(value?.ancestors)&&value.ancestors.some(p=>p?.pid===pid&&p.className==='OWL.Document')&&!forbiddenHit;
  const mainWindowHit=typeof r?.className==='string'&&/^Adobe Animate(?:\s|$)/i.test(r.className)
    &&value.clientArea===true&&!forbiddenHit;
  return Boolean(validNative(value)&&value.buttonDown===false&&r.enabled===true&&r.visible===true&&r.pid===pid&&Number.isSafeInteger(pid)&&pid>0
    &&typeof r.exe==='string'&&path.win32.basename(r.exe).toLowerCase()==='animate.exe'
    &&(documentHit||mainWindowHit));
}

// Mouse/window observation is scoped to one gesture. Only a verified Animate
// taskbar hover may restore/activate AN, never inject input or drop a file.
function createNativeTargetProbe({helperPath,spawn:spawnImpl=spawn}={}){
  const file=nativeHelperPath(helperPath);
  function run(args,timeoutMs,onHover){
    let child,buffer='',bytes=0,settled=false,startedSettled=false,releaseSettled=false,resolveStart,rejectStart,resolveRelease,rejectRelease;
    const started=new Promise((res,rej)=>{resolveStart=res;rejectStart=rej;});
    const released=new Promise((res,rej)=>{resolveRelease=res;rejectRelease=rej;});
    released.catch(()=>{});started.catch(()=>{});
    let timer;
    const fail=error=>{if(settled)return;settled=true;clearTimeout(timer);if(!startedSettled){startedSettled=true;rejectStart(error);}if(!releaseSettled){releaseSettled=true;rejectRelease(error);}try{child?.kill();}catch{}};
    const receive=value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('本机拖拽检测结果无效');
      if(value.phase==='host-hover'){
        if(!startedSettled||releaseSettled)throw new Error('本机拖拽检测悬停状态无效');
        onHover?.(value);return;
      }
      if(value.phase==='started'||value.phase==='inspect'){
        if(startedSettled)throw new Error('本机拖拽检测重复返回手势');startedSettled=true;resolveStart(value);
        if(value.phase==='inspect'){releaseSettled=true;resolveRelease(value);settled=true;clearTimeout(timer);}
      }else if(value.phase==='released'){
        if(!startedSettled||releaseSettled)throw new Error('本机拖拽检测结果顺序无效');releaseSettled=true;resolveRelease(value);settled=true;clearTimeout(timer);
      }else throw new Error('本机拖拽检测状态无效');
    };
    timer=setTimeout(()=>fail(new Error('本机拖拽检测已超时')),timeoutMs);timer.unref?.();
    try{child=spawnImpl(file,args,{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
      child.stdin?.on?.('error',()=>{});
      child.stdout.setEncoding?.('utf8');child.stdout.on('data',chunk=>{
        bytes+=Buffer.byteLength(String(chunk));if(bytes>65536){fail(new Error('本机拖拽检测结果过大'));return;}
        buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(!line)continue;try{receive(JSON.parse(line));}catch{fail(new Error('本机拖拽检测工具返回了无效结果'));}}
      });
      child.stderr.on('data',()=>{});child.once('error',()=>fail(new Error('无法启动本机拖拽检测工具')));
      child.once('close',()=>{if(!settled)fail(new Error('本机拖拽检测未完成'));});
    }catch{fail(new Error('无法启动本机拖拽检测工具'));}
    return{started,released,approveHost(value){
      if(settled||releaseSettled||!startedSettled||!Number.isSafeInteger(value?.pid)||value.pid<=0||!/^\d+$/.test(String(value?.hwnd||''))||!Number.isSafeInteger(value?.hoverId)||value.hoverId<=0)return false;
      try{return child.stdin.write(JSON.stringify({phase:'approve-host',pid:value.pid,hwnd:String(value.hwnd),hoverId:value.hoverId})+'\n');}catch{return false;}
    },stop(){if(!settled)fail(new Error('拖拽已取消'));else{try{child?.kill();}catch{}}}};
  }
  return{
    probe:async()=>{const r=run(['inspect'],3000);try{return await r.started;}finally{r.stop();}},
    getAnimatePids:async()=>{
      const r=run(['animate-pids'],3000);const result=await r.started;r.stop();
      if(result.ok!==true||!Array.isArray(result.animatePids)||result.animatePids.some(pid=>!Number.isSafeInteger(pid)||pid<=0))throw new Error('无法确认本机 Animate 进程');
      return [...new Set(result.animatePids)].sort((a,b)=>a-b);
    },
    start:spec=>run(['watch',String(spec.sourceHwnd),String(Math.max(1000,Math.min(MAX_TTL_MS,spec.ttlMs||MAX_TTL_MS))),String(Number.isSafeInteger(spec.targetPid)&&spec.targetPid>0?spec.targetPid:0)],Math.min(MAX_TTL_MS,spec.ttlMs||MAX_TTL_MS)+3000,spec.onHover)
  };
}

function registerStageDrag({ipcMain,webContents,sourceWindow,getAsset,getBridgeStatus,sendStageDrop,monitor,screen,getAnimatePids,onResult=()=>{},now=Date.now,ttlMs=MAX_TTL_MS}={}){
  if(!ipcMain?.handle||!webContents||!sourceWindow||typeof getAsset!=='function'||typeof getBridgeStatus!=='function'||typeof sendStageDrop!=='function'||!monitor?.start)throw new Error('舞台拖拽桥接参数无效');
  const sourceHwnd=handleValue(sourceWindow),ttl=Math.min(MAX_TTL_MS,Math.max(1000,Number(ttlMs)||MAX_TTL_MS));
  let active=null,disposed=false;
  const sender=event=>{if(event?.sender!==webContents||disposed)throw new Error('操作不允许');};
  function host(){const s=getBridgeStatus(),h=s?.heartbeat;if(s?.connected!==true||h?.busy)throw new Error('AN 面板未就绪或正在插入');if(h?.capabilities?.stageDrop!==1||typeof h.documentId!=='number'||!Number.isSafeInteger(h.documentId)||h.documentId<0)throw new Error('请更新或重新打开 AN 的安安素材管理器面板，并打开目标文档');const pid=typeof h.pid==='number'&&Number.isSafeInteger(h.pid)&&h.pid>0?h.pid:null;if(!pid&&typeof getAnimatePids!=='function')throw new Error('无法确认 AN 目标进程，请重新打开面板');return{documentId:h.documentId,pid};}
  function clear(current){if(active!==current)return;active=null;clearTimeout(current.timer);try{current.monitor?.stop();}catch{}}
  function finish(current,result){if(active!==current)return;clear(current);try{onResult({token:current.token,...result});}catch{}}
  function requireCurrent(token){if(!active||typeof token!=='string'||token!==active.token)throw new Error('拖拽令牌已失效');if(now()>=active.expiresAt){finish(active,{ok:false,cancelled:true,error:'拖拽已超时'});throw new Error('拖拽令牌已过期');}return active;}
  async function onHostHover(current,value){
    if(active!==current||current.committing||current.hoverPending)return;
    const target=value?.host;
    if(value?.ok!==true||value.phase!=='host-hover'||value.buttonDown!==true||value.taskbar!==true||!validPoint(value)||!Number.isSafeInteger(value.hoverId)||value.hoverId<=0
      ||!Number.isSafeInteger(target?.pid)||target.pid<=0||!/^\d+$/.test(String(target?.hwnd||''))||target.enabled!==true||target.visible!==true
      ||typeof target.exe!=='string'||path.win32.basename(target.exe).toLowerCase()!=='animate.exe'||!/^Adobe Animate(?:\s|$)/i.test(String(target.className||'')))return;
    current.hoverPending=true;
    try{
      requireCurrent(current.token);
      if(value.observedAt<current.startedAt||now()-value.observedAt>1500||value.observedAt>now()+1000)throw new Error('任务栏悬停已过期');
      if(current.host.pid){if(target.pid!==current.host.pid)throw new Error('AN 进程已切换');}
      else{const pids=await getAnimatePids();requireCurrent(current.token);if(!Array.isArray(pids)||pids.length!==1||Number(pids[0])!==target.pid)throw new Error('AN 进程不唯一');}
      const nextHost=host();if(nextHost.documentId!==current.host.documentId||(nextHost.pid&&nextHost.pid!==target.pid))throw new Error('AN 文档已切换');
      if(screen?.getCursorScreenPoint&&screen?.screenToDipPoint){const p=screen.screenToDipPoint({x:value.x,y:value.y}),c=screen.getCursorScreenPoint();if(!validPoint(p)||!validPoint(c)||Math.abs(p.x-c.x)>12||Math.abs(p.y-c.y)>12)throw new Error('任务栏悬停位置已改变');}
      requireCurrent(current.token);if(current.committing)return;
      // Tell the renderer that native monitoring owns the remainder before
      // activation can cause Chromium to lose its mouse capture.
      current.hoverApproval={pid:target.pid,hwnd:String(target.hwnd),hoverId:value.hoverId,observedAt:value.observedAt};
      try{onResult({token:current.token,phase:'host-handoff',pid:target.pid});}catch{}
    }catch{/* An invalid hover cannot activate AN or queue any material. */}
    finally{current.hoverPending=false;}
  }
  async function released(current,v){
    if(active!==current||current.committing)return;
    if(v?.ok===false){finish(current,{ok:false,cancelled:true,error:v.reason==='escape'?'拖拽已取消':'拖拽未完成'});return;}
    try{
      requireCurrent(current.token);
      const targetPid=Number(v.root.pid);if(!Number.isSafeInteger(targetPid)||targetPid<=0)throw new Error('无法确认 Adobe Animate 目标进程');
      if(current.host.pid?targetPid!==current.host.pid:false){throw new Error('AN 目标进程已切换，请重新拖动素材');}
      if(!current.host.pid){
        const pids=typeof getAnimatePids==='function'?await getAnimatePids():[];
        requireCurrent(current.token);
        if(current.committing)throw new Error('拖拽已经完成或正在写入');
        if(!Array.isArray(pids)||pids.length!==1||Number(pids[0])!==targetPid)throw new Error('检测到多个或未知的 Animate 进程，请关闭其他 AN 后再拖动');
      }
      if(!isAnimateTarget(v,targetPid))throw new Error('请将素材拖到 Adobe Animate 的舞台区域');
      if(v.observedAt<current.startedAt||now()-v.observedAt>5000||v.observedAt>now()+1000)throw new Error('拖拽位置检测已过期');
      // Electron positions are DIP; helper Win32 coordinates are physical.
      if(screen?.getCursorScreenPoint&&screen?.screenToDipPoint){const p=screen.screenToDipPoint({x:v.x,y:v.y}),c=screen.getCursorScreenPoint();if(!validPoint(p)||!validPoint(c)||Math.abs(p.x-c.x)>12||Math.abs(p.y-c.y)>12)throw new Error('拖拽释放位置不一致，请重新拖动');}
      const nextHost=host();if(nextHost.documentId!==current.host.documentId||(nextHost.pid&&current.host.pid&&nextHost.pid!==current.host.pid)||(nextHost.pid&&nextHost.pid!==Number(v.root.pid)))throw new Error('AN 目标文档已切换，请重新拖动素材');
      const asset=getAsset(current.id);if(!asset||asset.kind==='audio')throw new Error('素材已移除或格式改变，请重新选择');
      requireCurrent(current.token);
      if(current.committing)throw new Error('拖拽已经完成或正在写入');
      current.committing=true;clearTimeout(current.timer);current.monitor?.stop();
      const request=await sendStageDrop(current.id,{documentId:current.host.documentId,pid:targetPid,hwnd:String(v.root.hwnd)});
      finish(current,{ok:true,requestId:request?.requestId||null});
    }catch(error){finish(current,{ok:false,error:String(error.message||error)});}
  }
  async function begin(event,id){
    sender(event);if(active)throw new Error('已有素材正在拖拽');if(typeof id!=='string'||!/^[\w-]{1,128}$/.test(id))throw new Error('素材参数无效');
    const asset=getAsset(id);if(!asset||asset.kind==='audio')throw new Error('只能拖拽素材库中的 FLA 素材');if(sourceWindow.isDestroyed?.()||!sourceWindow.isFocused?.())throw new Error('请先激活素材管理器窗口');
    const initialHost=host(),startedAt=now(),current={id,token:crypto.randomUUID(),startedAt,expiresAt:startedAt+ttl,host:initialHost,committing:false,monitor:null,timer:null};
    active=current;current.timer=setTimeout(()=>finish(current,{ok:false,cancelled:true,error:'拖拽已超时'}),ttl);current.timer.unref?.();
    try{
      current.monitor=monitor.start({sourceHwnd,ttlMs:ttl,targetPid:current.host.pid,token:current.token,onHover:value=>onHostHover(current,value)});
      const initial=await current.monitor.started;
      if(active!==current)throw new Error('拖拽已取消');
      if(!validNative(initial)||initial.buttonDown!==true||String(initial.root.hwnd)!==sourceHwnd||initial.root.enabled!==true||initial.root.visible!==true)throw new Error('未检测到素材管理器的有效鼠标拖拽手势');
      current.monitor.released.then(v=>released(current,v),error=>finish(current,{ok:false,error:String(error.message||error)}));
      return{token:current.token,expiresAt:current.expiresAt};
    }catch(error){clear(current);throw error;}
  }
  async function end(event,token){sender(event);const c=requireCurrent(token);return{ok:true,waiting:!c.committing};}
  async function confirmHandoff(event,token){
    sender(event);const c=requireCurrent(token),approval=c.hoverApproval;
    if(c.committing||!approval)throw new Error('任务栏悬停已经处理或失效');
    c.hoverApproval=null;
    if(now()-approval.observedAt>1500)throw new Error('任务栏悬停已过期');
    if(!c.host.pid){const pids=await getAnimatePids();requireCurrent(token);if(!Array.isArray(pids)||pids.length!==1||Number(pids[0])!==approval.pid)throw new Error('AN 进程不唯一');}
    requireCurrent(token);if(now()-approval.observedAt>1500)throw new Error('任务栏悬停已过期');
    const nextHost=host();if(nextHost.documentId!==c.host.documentId||(nextHost.pid&&nextHost.pid!==approval.pid))throw new Error('AN 文档已切换');
    sourceWindow.setAlwaysOnTop?.(false);
    return{approved:Boolean(c.monitor?.approveHost?.({pid:approval.pid,hwnd:approval.hwnd,hoverId:approval.hoverId}))};
  }
  async function cancel(event,token){sender(event);const c=requireCurrent(token);if(c.committing)return{cancelled:false};finish(c,{ok:false,cancelled:true});return{cancelled:true};}
  const names=['shelf:begin-stage-drag','shelf:end-stage-drag','shelf:cancel-stage-drag','shelf:confirm-stage-handoff'];
  ipcMain.handle(names[0],begin);ipcMain.handle(names[1],end);ipcMain.handle(names[2],cancel);ipcMain.handle(names[3],confirmHandoff);
  const dispose=()=>{disposed=true;if(active)finish(active,{ok:false,cancelled:true});for(const name of names)ipcMain.removeHandler?.(name);};webContents.once?.('destroyed',dispose);
  return{dispose,get active(){return active;}};
}
module.exports={registerStageDrag,createNativeTargetProbe,isAnimateTarget,MAX_TTL_MS};
