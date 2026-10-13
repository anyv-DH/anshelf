# Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE.
param([Parameter(Mandatory=$true)][int]$AppPid)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IdleThreadName {
  [DllImport("kernel32.dll")] static extern IntPtr OpenThread(uint access, bool inherit, uint id);
  [DllImport("kernel32.dll")] static extern int GetThreadDescription(IntPtr thread, out IntPtr name);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  public static string Read(uint id) {
    IntPtr thread=OpenThread(0x800, false, id), name=IntPtr.Zero;
    if(thread==IntPtr.Zero) return "";
    try { return GetThreadDescription(thread,out name)==0 ? Marshal.PtrToStringUni(name) : ""; }
    finally { if(name!=IntPtr.Zero) LocalFree(name); CloseHandle(thread); }
  }
}
'@
@(Get-Process -Id $AppPid -ErrorAction Stop).Threads | ForEach-Object {
  try { [pscustomobject]@{id=$_.Id;name=[IdleThreadName]::Read($_.Id);cpuSeconds=$_.TotalProcessorTime.TotalSeconds;state=[string]$_.ThreadState} } catch {}
} | ConvertTo-Json -Compress
