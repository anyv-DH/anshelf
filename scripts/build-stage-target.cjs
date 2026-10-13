/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),source=path.join(root,'desktop/native/StageTarget.cs'),output=path.join(root,'desktop/native/stage-target.exe');
const windows=process.env.WINDIR||'C:\\Windows';
const candidates=['Framework64','Framework'].map(folder=>path.join(windows,'Microsoft.NET',folder,'v4.0.30319/csc.exe'));
const compiler=candidates.find(file=>fs.existsSync(file));
if(!compiler)throw new Error('本机缺少 .NET Framework C# 编译器，无法构建拖拽检测工具');
fs.mkdirSync(path.dirname(output),{recursive:true});
const wpf=path.join(path.dirname(compiler),'WPF');
const result=spawnSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/r:System.Web.Extensions.dll','/r:'+path.join(wpf,'UIAutomationClient.dll'),'/r:'+path.join(wpf,'UIAutomationTypes.dll'),'/r:'+path.join(wpf,'WindowsBase.dll'),'/out:'+output,source],{windowsHide:true,encoding:'utf8',shell:false});
if(result.error||result.status!==0)throw new Error('拖拽检测工具构建失败：'+(result.error?.message||result.stdout||result.stderr));
process.stdout.write('Built gesture-scoped Windows stage target helper\n');
