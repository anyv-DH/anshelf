/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
class PreviewQueue {
  constructor(library, render, changed = () => {}) {
    this.library=library; this.render=render; this.changed=changed;
    this.queue=[]; this.active=null; this.running=false; this.waiters=[];
    this.retryRequested=new Set();
  }
  add(assets, force=false) {
    for(const item of assets) {
      const asset=this.library.getAsset(item.id);
      if(!asset || asset.kind==='audio' || (!force && asset.previewStatus!=='pending')) continue;
      if(this.active===asset.id) {
        if(force) this.retryRequested.add(asset.id);
        continue;
      }
      if(this.queue.includes(asset.id)) continue;
      this.queue.push(asset.id);
    }
    this.notify();
    return this.drain();
  }
  snapshot(){return{pending:this.queue.length,active:this.active};}
  idle(){return this.running?new Promise(resolve=>this.waiters.push(resolve)):Promise.resolve();}
  notify(){
    try { this.changed(); } catch(_error) { /* A view callback cannot stop background processing. */ }
  }
  currentAsset(id){
    try { return this.library.getAsset(id); } catch(_error) { return null; }
  }
  stale(id, startedAsset){
    const current=this.currentAsset(id);
    if(!current || this.retryRequested.has(id))return true;
    return (current.previewRevision ?? null)!==(startedAsset.previewRevision ?? null)
      || (current.previewStatus==='ready' && current.previewOrigin==='sidecar');
  }
  async renderOne(id,asset){
    try {
      const result=await this.render(asset);
      // Reimporting a sidecar or requesting a retry supersedes this render.
      if(this.stale(id,asset))return;
      await this.library.setPreview(id,{...result,previewStatus:'ready',previewOrigin:'rendered',previewError:null},asset.previewRevision ?? null);
    } catch(error) {
      if(this.stale(id,asset))return;
      try {
        await this.library.setPreview(id,{previewStatus:'failed',previewError:String(error?.message||error).slice(0,500)},asset.previewRevision ?? null);
      } catch(_metadataError) {
        // A failed metadata write (including removal during the write) must not
        // reject an unobserved drain promise or abandon the remaining queue.
      }
    }
  }
  async drain(){
    if(this.running)return; this.running=true;
    try {
      while(this.queue.length){
        const id=this.queue.shift();const asset=this.currentAsset(id);if(!asset)continue;
        this.active=id;this.notify();
        await this.renderOne(id,asset);
        this.active=null;
        if(this.retryRequested.delete(id) && this.currentAsset(id) && !this.queue.includes(id))this.queue.push(id);
        this.notify();
      }
    } finally {this.running=false;this.active=null;this.waiters.splice(0).forEach(resolve=>resolve());this.notify();}
  }
}
module.exports={PreviewQueue};
