/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const errorText = error => String(error?.message || '下载未完成，请您稍后重试。').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
const mb = value => `${(Math.max(0, Number(value) || 0) / 1048576).toFixed(1)} MB`;

export function mountUpdateDownloadControls({ document, api, confirm, getUpdate }) {
  let phase = 'idle', progress = null, ready = null, error = '', sequence = 0, confirming = false, disposed = false;
  function render() {
    if (disposed) return;
    const update = getUpdate(), supported = typeof api?.downloadUpdate === 'function' && typeof api?.launchUpdate === 'function';
    for (const panel of document.querySelectorAll('[data-update-download-controls]')) {
      panel.hidden = !supported || (update.status !== 'available' && phase === 'idle');
      if (panel.hidden) continue;
      if (!panel.children.length) panel.innerHTML = '<div class="update-download-heading"><strong>软件更新</strong><span>您确认后才开始</span></div><p data-update-download-status role="status" aria-live="polite"></p><progress data-update-download-progress max="100" hidden aria-label="新版下载进度"></progress><p data-update-download-note></p><div class="update-download-actions"><button type="button" class="button primary" data-update-action="update">一键更新</button><button type="button" class="button secondary" data-update-action="download">仅下载</button><button type="button" class="button secondary" data-update-action="cancel" hidden>取消下载</button><button type="button" class="button primary" data-update-action="launch" hidden>退出并更新</button><button type="button" class="text-button" data-update-action="reveal" hidden>打开下载位置</button></div>';
      const get = selector => panel.querySelector(selector), downloading = phase === 'downloading', available = update.status === 'available';
      const status = downloading ? `正在下载${progress?.percent != null ? ` ${progress.percent}%` : '…'}${progress ? ` · ${mb(progress.received)}${progress.total ? ` / ${mb(progress.total)}` : ''}` : ''}`
        : phase === 'ready' ? error || `已下载 v${ready.version}，文件校验通过。`
        : phase === 'launching' ? '正在打开新版，管理器将正常退出…'
        : phase === 'cancelling' ? '正在取消下载…'
        : phase === 'cancelled' ? '下载已取消，您可以稍后重新下载。'
        : phase === 'error' ? error : `发现新版 ${update.latestVersion || ''}，可直接下载官方程序。`;
      get('[data-update-download-status]').textContent = status;
      get('[data-update-download-status]').dataset.state = phase;
      const meter = get('[data-update-download-progress]'); meter.hidden = !downloading;
      if (progress?.percent != null) meter.value = progress.percent; else meter.removeAttribute('value');
      get('[data-update-download-note]').textContent = ready?.mode === 'portable'
        ? '免安装版固定保存在本机更新目录，可直接打开；旧桌面入口不会被覆盖或自动更改。您可打开下载位置，为新版手动创建桌面快捷方式。'
        : phase === 'ready' ? '点击“退出并更新”后打开安装向导，请您选择原安装位置。原素材库与分类继续保留。'
        : '一键更新：您确认后下载并校验，随后正常退出管理器并启动新版安装向导或程序。仅下载：完成后由您决定何时打开。';
      for (const action of ['update', 'download']) {
        const button = get(`[data-update-action="${action}"]`);
        button.hidden = !available || downloading || phase === 'cancelling' || phase === 'ready' || phase === 'launching'; button.disabled = confirming;
      }
      const cancel = get('[data-update-action="cancel"]'); cancel.hidden = !downloading;
      const launch = get('[data-update-action="launch"]'); launch.hidden = phase !== 'ready'; launch.disabled = confirming;
      launch.textContent = ready?.mode === 'portable' ? '退出并打开新版' : '退出并更新';
      get('[data-update-action="reveal"]').hidden = phase !== 'ready' || typeof api?.revealDownloadedUpdate !== 'function';
    }
  }
  async function download(autoLaunch = false) {
    if (disposed || confirming || !['idle', 'error', 'cancelled'].includes(phase) || getUpdate().status !== 'available') return;
    confirming = true; render();
    let accepted = false;
    try { accepted = await confirm(autoLaunch
      ? { title: '一键更新安安素材管理器', message: '请您先保存 AN 中正在制作的作品。\n确认后将下载官方新版并校验文件；校验通过后，管理器会正常退出并启动新版安装向导或免安装程序，无需再次点击。安装版仍请您在向导中选择原安装位置完成安装。\n下载期间可取消；本操作不会自动保存、关闭 AN，也不会修改您的作品、素材库或分类。', confirmLabel: '确认一键更新', cancelLabel: '暂不更新' }
      : { title: '下载新版程序', message: '请您确认主动下载安安素材管理器的官方发布附件。\n下载后会核验文件，完成后不会自行安装。只有您再次确认，才会退出管理器并打开新版程序。\n下载期间您可以继续使用素材库，也可以取消下载。', confirmLabel: '确认下载', cancelLabel: '暂不下载' }); }
    catch (cause) { error = errorText(cause); phase = 'error'; }
    finally { confirming = false; }
    if (!accepted || disposed || getUpdate().status !== 'available') { render(); return; }
    const current = ++sequence; phase = 'downloading'; progress = null; ready = null; error = ''; render();
    try {
      const result = await api.downloadUpdate();
      if (disposed || current !== sequence) return;
      if (result?.cancelled) { phase = 'cancelled'; return; }
      if (result?.ready !== true || !['installed', 'portable'].includes(result.mode) || typeof result.version !== 'string') throw new Error('下载文件尚未校验完成，请您重试。');
      ready = { version: result.version, mode: result.mode }; phase = 'ready';
      if (autoLaunch) await launchReady(current);
    } catch (cause) { if (!disposed && current === sequence) { phase = 'error'; error = errorText(cause); } }
    finally { if (!disposed && current === sequence) render(); }
  }
  async function launchReady(current) {
    if (disposed || current !== sequence || phase !== 'ready') return;
    phase = 'launching'; error = ''; render();
    try { await api.launchUpdate(); }
    catch (cause) { if (!disposed && current === sequence) { phase = 'error'; ready = null; error = errorText(cause); render(); } }
  }
  async function cancel() {
    if (phase !== 'downloading' || disposed) return;
    ++sequence; phase = 'cancelling'; progress = null; render();
    try { await api.cancelUpdateDownload(); if (!disposed) { phase = 'cancelled'; render(); } }
    catch (cause) { if (!disposed) { phase = 'error'; error = errorText(cause); render(); } }
  }
  async function launch() {
    if (disposed || confirming || phase !== 'ready') return;
    confirming = true; render();
    const current = sequence;
    let accepted = false;
    try {
      accepted = await confirm({ title: ready.mode === 'portable' ? '退出并打开新版' : '退出并更新', message: `请您先保存 AN 中正在制作的作品。\n${ready.mode === 'portable' ? '确认后管理器将正常退出，并打开已经校验的新版免安装程序。新版保存在本机更新目录；旧程序和旧快捷方式不会被覆盖，您可打开下载位置，为新版创建新快捷方式。' : '确认后管理器将正常退出，并打开新版安装向导，请您选择原安装位置完成更新。'}\n本操作不会保存、关闭 AN，也不会修改您的作品。`, confirmLabel: ready.mode === 'portable' ? '确认打开新版' : '确认退出并更新', cancelLabel: '暂不更新' });
    } finally { confirming = false; }
    if (!accepted || disposed) { render(); return; }
    await launchReady(current);
  }
  const click = event => {
    const action = event.target.closest('[data-update-action]')?.dataset.updateAction;
    if (action === 'update') download(true);
    if (action === 'download') download(false);
    if (action === 'cancel') cancel();
    if (action === 'launch') launch();
    if (action === 'reveal') Promise.resolve(api.revealDownloadedUpdate()).catch(cause => { error = errorText(cause); const status = document.querySelector('[data-update-download-status]'); if (status) status.textContent = error; });
  };
  document.addEventListener('click', click);
  const stopProgress = api?.onUpdateProgress?.(value => {
    if (disposed || phase !== 'downloading') return;
    const received = Math.max(0, Number(value?.received) || 0), total = Math.max(0, Number(value?.total) || 0);
    const percent = Number(value?.percent);
    progress = { received, total, percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.floor(percent))) : total ? Math.min(100, Math.floor(received * 100 / total)) : null };
    render();
  });
  return { refresh: render, dispose() { disposed = true; ++sequence; stopProgress?.(); document.removeEventListener('click', click); } };
}
