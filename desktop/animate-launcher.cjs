/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { spawn } = require('node:child_process');

const execFileAsync = promisify(execFile);
const isAnimateExe = file => typeof file === 'string' && !file.includes('\0') && path.win32.isAbsolute(file) && path.win32.basename(file).toLowerCase() === 'animate.exe';

function knownCandidates() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'];
  const result = [];
  for (const root of roots.filter(Boolean)) for (const version of ['2026', '2025', '2024', '2023', '2022']) {
    result.push(path.win32.join(root, 'Adobe', `Adobe Animate ${version}`, 'Animate.exe'));
  }
  return [...new Set(result)];
}

function executableFromCommand(command) {
  if (typeof command !== 'string') return null;
  const match = command.trim().match(/^"([^"]+\.exe)"(?:\s|$)/i) || command.trim().match(/^(.+?\.exe)(?:\s|$)/i);
  return match && isAnimateExe(match[1]) ? match[1] : null;
}

// Only reads fixed registry locations. Registry command strings are parsed as
// data and never executed; FLA input paths are never interpolated into scripts.
const registryScript = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'SilentlyContinue'
$found = New-Object System.Collections.Generic.List[string]
$association = @('Registry::HKEY_CLASSES_ROOT\\.fla')
$userChoice = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.fla\\UserChoice'
$programIds = @($userChoice.ProgId)
foreach ($keyName in $association) { $key = Get-Item -LiteralPath $keyName; if ($key) { $programIds += $key.GetValue('') } }
foreach ($programId in $programIds) {
  if ($programId) { $key = Get-Item -LiteralPath ('Registry::HKEY_CLASSES_ROOT\\' + $programId + '\\shell\\open\\command'); if ($key) { $found.Add([string]$key.GetValue('')) } }
}
foreach ($keyName in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Animate.exe', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Animate.exe', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Animate.exe')) {
  $key = Get-Item -LiteralPath $keyName; if ($key) { $found.Add('"' + [string]$key.GetValue('') + '"') }
}
ConvertTo-Json -InputObject @($found.ToArray()) -Compress
`;

async function defaultInspect(executable) {
  let running = false;
  if (process.platform === 'win32') {
    try {
      const tasklist = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
      const { stdout } = await execFileAsync(tasklist, ['/FI', 'IMAGENAME eq Animate.exe', '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 5000 });
      running = /Animate\.exe/i.test(stdout);
    } catch { /* no process information is available */ }
  }
  if (running) return { running: true, candidates: [] };
  return { running: false, candidates: await discoverAnimateInstallations(executable) };
}

async function discoverAnimateInstallations(executable) {
  const candidates = [executable];
  if (process.platform === 'win32') {
    try {
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const { stdout } = await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(registryScript, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
      const commands = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
      if (Array.isArray(commands)) candidates.push(...commands.map(executableFromCommand));
    } catch { /* fall back to standard installation discovery */ }
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      const adobe = path.join(root, 'Adobe');
      try {
        const entries = await fs.readdir(adobe, { withFileTypes: true });
        candidates.push(...entries.filter(item => item.isDirectory() && /^Adobe Animate(?:\s|$)/i.test(item.name)).sort((a,b) => b.name.localeCompare(a.name)).map(item => path.join(adobe, item.name, 'Animate.exe')));
      } catch { /* this installation root does not exist */ }
    }
  }
  return [...new Set([...candidates, ...knownCandidates()].filter(Boolean))];
}

function createAnimateLauncher({ executable = process.env.ANSHELF_ANIMATE_EXE, inspect = file => defaultInspect(file), validateExecutable = async file => { const stat = await fs.lstat(file); return stat.isFile() && !stat.isSymbolicLink(); }, launch = async (file, args = []) => {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}, now = Date.now } = {}) {
  let launchedUntil = 0;
  let inFlight = null;
  return {
    async ensureRunning() {
      if (now() < launchedUntil) return { state: 'starting' };
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const status = await inspect(executable);
        if (status?.running) return { state: 'running' };
        const candidates = [executable, ...(status?.candidates || [])].filter((file, index, list) => file && list.indexOf(file) === index && isAnimateExe(file));
        let selected = null;
        for (const candidate of candidates) {
          try { if (await validateExecutable(candidate)) { selected = candidate; break; } } catch { /* try the next installation */ }
        }
        if (!selected) throw new Error('未找到 Adobe Animate.exe，请设置 ANSHELF_ANIMATE_EXE');
        await launch(selected, []);
        launchedUntil = now() + 20000;
        return { state: 'started', executable: selected, at: now() };
      })();
      try { return await inFlight; } finally { inFlight = null; }
    },
  };
}

module.exports = { createAnimateLauncher, isAnimateExe, knownCandidates, defaultInspect, executableFromCommand, discoverAnimateInstallations };
