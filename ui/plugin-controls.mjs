/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export function mountPluginControls({ document, api, confirm }) {
  let status = null, loading = false, installing = false, confirming = false, error = '', restartRequired = false, disposed = false, loadPromise;
  const panels = () => [...document.querySelectorAll('[data-plugin-panel]')];
  const errorMessage = cause => String(cause?.message || '操作未完成，请您稍后重试。').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
  function render() {
    for (const panel of panels()) {
      if (!panel.children.length) {
        panel.innerHTML = '<div class="plugin-panel-heading"><strong>AN 插件</strong><span data-plugin-state role="status"></span></div><p class="plugin-versions"><span data-plugin-bundled></span><span data-plugin-installed></span></p><p class="plugin-hint">随软件附带，可直接安装或更新，无需另行下载。</p><p class="plugin-restart" data-plugin-restart role="status" hidden>安装已完成。请您关闭并重新打开 AN 中的安安素材管理器面板；必要时保存作品后重启 AN。软件不会自动保存或关闭 AN。</p><p class="plugin-error" data-plugin-error role="alert" hidden></p><button type="button" class="button secondary plugin-install" data-plugin-action="install">安装／更新 AN 插件</button>';
      }
      const get = selector => panel.querySelector(selector), unsupported = typeof api?.pluginStatus !== 'function' || typeof api?.installPlugin !== 'function';
      const state = installing ? '正在安装 AN 插件…' : loading ? '正在检查…' : unsupported ? '请使用桌面软件' : status?.status === 'current' ? '已是随软件附带的版本' : status?.status === 'needs-update' ? '有新版可更新' : status?.status === 'not-installed' ? '尚未安装' : '暂时无法检查';
      get('[data-plugin-state]').textContent = state;
      get('[data-plugin-state]').dataset.state = status?.status || 'idle';
      get('[data-plugin-bundled]').textContent = `软件附带 v${status?.bundledVersion || '—'}`;
      get('[data-plugin-installed]').textContent = `已安装${status?.installedVersion ? ` v${status.installedVersion}` : '：无'}`;
      get('[data-plugin-restart]').hidden = !restartRequired || installing;
      get('[data-plugin-error]').textContent = error; get('[data-plugin-error]').hidden = !error;
      const button = get('[data-plugin-action="install"]');
      button.disabled = unsupported || loading || installing || confirming || (status?.status === 'current' && !error);
      button.textContent = installing ? '正在安装…' : '安装／更新 AN 插件';
    }
  }
  async function load() {
    if (disposed || typeof api?.pluginStatus !== 'function') { render(); return; }
    if (loadPromise) return loadPromise;
    loading = true; render();
    loadPromise = Promise.resolve().then(() => api.pluginStatus()).then(result => {
      if (!disposed) { status = result; if (result?.status !== 'current') restartRequired = false; }
    }).catch(cause => { if (!disposed) error = errorMessage(cause); }).finally(() => { loading = false; loadPromise = null; if (!disposed) render(); });
    return loadPromise;
  }
  async function install() {
    if (disposed || loading || installing || confirming || typeof api?.installPlugin !== 'function') return;
    confirming = true;
    let accepted;
    try {
      accepted = await confirm({ title: '安装／更新 AN 插件', message: '请您确认安装软件已附带的 AN 插件，无需另行下载。\n安装后请关闭并重新打开 AN 中的安安素材管理器面板；必要时保存作品后重启 AN。\n本操作不会自动保存或关闭 AN，也不会修改您的作品。', confirmLabel: '确认安装插件', cancelLabel: '暂不安装' });
    } finally { confirming = false; }
    if (!accepted || disposed) { render(); return; }
    installing = true; error = ''; restartRequired = false; render();
    try {
      const result = await api.installPlugin();
      if (result?.status) status = result;
      await load();
      restartRequired = result?.restartRequired !== false;
    } catch (cause) { error = errorMessage(cause); }
    finally { installing = false; if (!disposed) render(); }
  }
  const click = event => { if (event.target.closest('[data-plugin-action="install"]')) install(); };
  document.addEventListener('click', click);
  return { refresh: load, dispose() { disposed = true; document.removeEventListener('click', click); } };
}
