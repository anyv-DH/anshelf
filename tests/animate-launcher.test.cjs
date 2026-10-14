/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnimateLauncher, executableFromCommand } = require('../desktop/animate-launcher.cjs');

test('FLA association discovery extracts only an absolute Animate executable, ignoring arguments', () => {
  assert.equal(executableFromCommand('"D:\\AN2023\\Adobe Animate 2023\\Animate.exe" "%1"'), 'D:\\AN2023\\Adobe Animate 2023\\Animate.exe');
  assert.equal(executableFromCommand('C:\\Adobe\\Animate.exe %1'), 'C:\\Adobe\\Animate.exe');
  for (const value of ['Animate.exe %1', '"C:\\Other.exe" "D:\\Animate.exe"', '"D:\\Animate.exe";other', null]) assert.equal(executableFromCommand(value), null);
});

test('Animate startup is single flight, starts no document and suppresses repeats while launching', async () => {
  let probes = 0, launches = 0, release;
  const gate = new Promise(resolve => release = resolve);
  const launcher = createAnimateLauncher({ inspect: async () => { probes++; await gate; return { running: false, candidates: ['D:\\AN2023\\Animate.exe'] }; },
    validateExecutable: async () => true, launch: async (file, args) => { assert.equal(file, 'D:\\AN2023\\Animate.exe'); assert.deepEqual(args, []); launches++; } });
  const first = launcher.ensureRunning(); const second = launcher.ensureRunning();
  release(); await Promise.all([first, second]); await launcher.ensureRunning();
  assert.equal(probes, 1); assert.equal(launches, 1);
});

test('Animate startup leaves an existing host alone and ignores unrelated executables', async () => {
  let launches = 0;
  const existing = createAnimateLauncher({ inspect: async () => ({ running: true, candidates: [] }), launch: async () => launches++ });
  assert.equal((await existing.ensureRunning()).state, 'running');
  const unsafe = createAnimateLauncher({ inspect: async () => ({ running: false, candidates: ['C:\\Tools\\Other.exe', 'Animate.exe'] }),
    validateExecutable: async () => true, launch: async () => launches++ });
  await assert.rejects(unsafe.ensureRunning(), /未找到|Animate/);
  assert.equal(launches, 0);
});

test('Animate startup validates configured paths, retries failed spawns and refreshes after cooldown', async () => {
  let time = 1000, attempts = 0;
  const launcher = createAnimateLauncher({ executable: 'D:\\Animate\\Animate.exe', now: () => time,
    inspect: async () => ({ running: false, candidates: [] }), validateExecutable: async () => true,
    launch: async () => { if (++attempts === 1) throw new Error('spawn failed'); } });
  await assert.rejects(launcher.ensureRunning(), /spawn failed/);
  await launcher.ensureRunning(); await launcher.ensureRunning(); assert.equal(attempts, 2);
  time += 30000; await launcher.ensureRunning(); assert.equal(attempts, 3);
});
