/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs=require('node:fs/promises');
const path=require('node:path');
const esbuild=require('esbuild');
const {execFileSync}=require('node:child_process');
async function build(){
  const root=path.resolve(__dirname,'..');await fs.mkdir(path.join(root,'dist'),{recursive:true});
  if(process.platform==='win32')execFileSync(process.execPath,[path.join(root,'scripts/build-stage-target.cjs')],{windowsHide:true,stdio:'inherit'});
  await fs.cp(path.join(root,'ui'),path.join(root,'dist'),{recursive:true});
  await esbuild.build({entryPoints:[path.join(root,'preview/worker.ts')],outfile:path.join(root,'dist/worker.js'),bundle:true,format:'iife',platform:'browser',target:'chrome120',minify:true});
  await fs.copyFile(path.join(root,'preview/worker.html'),path.join(root,'dist/worker.html'));
  console.log('Built local UI + offline FLA preview worker');
}
build().catch(error=>{console.error(error);process.exitCode=1;});
