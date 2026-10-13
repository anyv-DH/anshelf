/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';

// Keep pinning local to a focused mini window. Maximum/fullscreen layouts are
// ordinary windows, and leaving mini mode restores the preceding bounds.
function createWindowMode(window){
  let compact=false,saved=null,restoreAfterExpansion=null;
  const alive=()=>!window.isDestroyed?.();
  const expanded=()=>Boolean(window.isMaximized?.()||window.isFullScreen?.());
  const bounds=()=>window.getNormalBounds?.()||window.getBounds?.()||{width:1480,height:940};
  function pin(){if(alive())window.setAlwaysOnTop(compact&&!expanded()&&window.isFocused?.()!==false);}
  function restore(value){
    if(!value||!alive())return;
    if(window.setBounds&&Number.isFinite(value.bounds.x)&&Number.isFinite(value.bounds.y))window.setBounds(value.bounds);
    else window.setSize(value.bounds.width,value.bounds.height);
  }
  function leaveCompact({restoreBounds=true,restoreMaximum=false}={}){
    const prior=saved;compact=false;saved=null;pin();
    if(restoreBounds)restore(prior);
    if(restoreMaximum&&prior?.maximized)window.maximize();
    return prior;
  }
  function nativeExpanded(){
    if(compact){restoreAfterExpansion=leaveCompact({restoreBounds:false});}
    pin();
  }
  function nativeRestored(){
    const pending=restoreAfterExpansion;restoreAfterExpansion=null;restore(pending);pin();
  }
  window.on?.('maximize',nativeExpanded);window.on?.('enter-full-screen',nativeExpanded);
  window.on?.('unmaximize',nativeRestored);window.on?.('leave-full-screen',nativeRestored);
  window.on?.('minimize',()=>{if(compact)restoreAfterExpansion=leaveCompact({restoreBounds:false});pin();});
  window.on?.('restore',nativeRestored);
  window.on?.('blur',()=>{if(alive())window.setAlwaysOnTop(false);});window.on?.('focus',pin);
  function toggleCompact(){
    if(!alive())return false;
    if(compact){leaveCompact({restoreMaximum:true});return false;}
    saved={bounds:{...bounds()},maximized:Boolean(window.isMaximized?.())};
    if(window.isFullScreen?.())window.setFullScreen(false);
    if(window.isMaximized?.())window.unmaximize();
    compact=true;window.setSize(930,700);pin();return true;
  }
  function action(name){
    if(name==='minimize'){if(compact)leaveCompact();window.minimize();}
    else if(name==='maximize'){
      if(compact)leaveCompact();
      if(window.isMaximized())window.unmaximize();else{window.setAlwaysOnTop(false);window.maximize();}
    }else if(name==='close')window.close();
    return{maximized:alive()&&window.isMaximized()};
  }
  return{toggleCompact,action,get compact(){return compact;}};
}
module.exports={createWindowMode};
