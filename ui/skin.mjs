/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export function mountSkin({ api, document }) {
  if (!api?.getSkin) return { open() {}, dispose() {} };
  const view = document.defaultView;
  const reducedMotion = view.matchMedia ? view.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const layer = document.createElement('div');
  layer.id = 'skin-background';
  layer.setAttribute('aria-hidden', 'true');
  const shade = document.createElement('div');
  shade.className = 'skin-background-shade';
  document.body.prepend(layer);
  const modal = document.createElement('dialog');
  modal.id = 'skin-dialog';
  modal.setAttribute('aria-labelledby', 'skin-dialog-title');
  modal.innerHTML = `<div class="skin-heading"><div><p class="skin-eyebrow">让素材库，也有你的风格</p><h2 id="skin-dialog-title">自定义底图皮肤</h2></div><button class="skin-close icon-button" type="button" aria-label="关闭皮肤设置">×</button></div><p class="skin-description">用喜欢的图片、GIF 或视频铺满背景，素材卡片保持清晰。</p><div class="skin-current"><span class="skin-current-dot"></span><div><strong class="skin-current-name">默认主题</strong><p class="skin-current-status" role="status">可以选择本机文件，媒体不会被复制。</p></div></div><div class="skin-choice-row"><button class="button primary skin-select" type="button">选择图片或视频</button><button class="button secondary skin-reset" type="button">恢复默认</button></div><label class="skin-opacity-label" for="skin-opacity"><span>背景遮罩深浅</span><output id="skin-opacity-value">55%</output></label><input id="skin-opacity" class="skin-opacity" type="range" min="0" max="90" step="1" value="55"><div class="skin-opacity-hints"><span>底图更明显</span><span>文字更清楚</span></div><label class="skin-animation"><input id="skin-animated" type="checkbox"><span>播放动态底图<small>关闭播放时视频停在当前画面，GIF 暂时隐藏。</small></span></label><p class="skin-format-note">图片：PNG / JPG / JPEG / WebP / GIF，最多 40 MB。<br>视频：MP4 / WebM，最多 300 MB，静音循环播放。<br>仅引用原文件，移动或删除后需要重新选择。窗口隐藏时暂停动态播放。</p><p class="skin-error" role="alert" hidden></p>`;
  document.body.append(modal);
  const get = selector => modal.querySelector(selector);
  const select = get('.skin-select'), reset = get('.skin-reset'), opacity = get('#skin-opacity'), animated = get('#skin-animated'), output = get('#skin-opacity-value');
  const status = get('.skin-current-status'), name = get('.skin-current-name'), error = get('.skin-error');
  let state = null, media = null, currentKey = null, disposed = false, busy = false, motionAllowed = false, requestGeneration = 0, focused = document.hasFocus(), failedUrl = null;

  function showError(message) {
    error.textContent = message || '';
    error.hidden = !message;
  }
  function syncControls() {
    if (!state) return;
    if (!busy) opacity.value = String(Math.round(state.opacity * 100));
    output.textContent = opacity.value + '%';
    if (!busy) animated.checked = state.animated && (!reducedMotion.matches || motionAllowed);
    opacity.disabled = busy || !state.enabled;
    animated.disabled = busy || !state.enabled || state.type === 'image';
    select.disabled = busy; reset.disabled = busy || (!state.enabled && !state.error);
    name.textContent = !state.enabled ? '默认主题' : state.type === 'video' ? '视频底图' : state.type === 'gif' ? 'GIF 动态底图' : '图片底图';
    const backgroundPaused = document.hidden || !focused;
    const playing = state.enabled && state.type !== 'image' && state.animated && (!reducedMotion.matches || motionAllowed) && !backgroundPaused;
    status.textContent = failedUrl === state.url && failedUrl ? '底图无法解码，已恢复默认显示，请重新选择。' : state.error || (!state.enabled ? '可以选择本机文件，媒体不会被复制。' : state.type !== 'image' && backgroundPaused ? '窗口在后台，动态底图已暂停。' : state.type === 'gif' && !playing ? '动态播放已暂停，GIF 暂时隐藏。' : state.type === 'video' && !playing ? '视频已暂停，保留当前画面。' : playing ? '动态底图播放中；窗口切到后台时自动暂停。' : '静态底图已启用。');
  }
  function releaseMedia() {
    if (!media) return;
    if (media.tagName === 'VIDEO') { media.pause(); media.removeAttribute('src'); media.load(); }
    else media.removeAttribute('src');
    media.remove(); media = null;
  }
  function apply() {
    if (disposed || !state) return;
    document.documentElement.classList.toggle('has-custom-skin', state.enabled && state.url !== failedUrl);
    layer.style.setProperty('--skin-opacity', String(state.opacity));
    const key = state.enabled ? state.url + ':' + state.type : null;
    if (key !== currentKey) {
      releaseMedia(); currentKey = key;
      if (state.enabled) {
        media = document.createElement(state.type === 'video' ? 'video' : 'img');
        media.className = 'skin-background-media';
        if (state.type === 'video') { media.muted = true; media.loop = true; media.playsInline = true; media.preload = 'metadata'; }
        else media.alt = '';
        const mediaUrl = state.url;
        media.addEventListener('error', () => { if (!disposed && state.url === mediaUrl) { failedUrl = mediaUrl; document.documentElement.classList.remove('has-custom-skin'); if (media?.tagName === 'VIDEO') media.pause(); showError('底图无法播放或解码，已恢复默认显示，请重新选择图片，或兼容的 MP4 / WebM 视频。'); syncControls(); } });
        layer.prepend(media);
      }
    }
    if (!layer.contains(shade)) layer.append(shade);
    if (media) {
      const playing = state.animated && (!reducedMotion.matches || motionAllowed) && !document.hidden && focused;
      if (state.type === 'video') {
        if (!media.getAttribute('src')) media.src = state.url;
        if (playing && state.url !== failedUrl) { const playback = media.play(); playback?.catch(() => {}); }
        else media.pause();
      } else if (state.type === 'gif') {
        media.hidden = !playing;
        if (playing && !media.getAttribute('src')) media.src = state.url;
        else if (!playing) media.removeAttribute('src');
      } else if (!media.getAttribute('src')) media.src = state.url;
    }
    syncControls();
  }
  async function action(callback) {
    if (busy || disposed) return;
    busy = true; requestGeneration++; syncControls(); showError('');
    try { const next = await callback(); if (!disposed) { state = next; apply(); } }
    catch (failure) { if (!disposed) showError(String(failure.message || failure)); }
    finally { busy = false; if (!disposed) syncControls(); }
  }
  async function load() {
    const generation = ++requestGeneration;
    try { const next = await api.getSkin(); if (!disposed && !busy && generation === requestGeneration) { state = next; apply(); } }
    catch (failure) { if (!disposed) showError(String(failure.message || failure)); }
  }
  select.addEventListener('click', () => action(async () => {
    let selected = await api.selectSkin();
    if (selected.enabled && selected.type !== 'image' && reducedMotion.matches && !motionAllowed && selected.animated) selected = await api.updateSkin({ animated: false });
    return selected;
  }));
  reset.addEventListener('click', () => action(() => api.resetSkin()));
  opacity.addEventListener('input', () => { output.textContent = opacity.value + '%'; layer.style.setProperty('--skin-opacity', String(Number(opacity.value) / 100)); });
  opacity.addEventListener('change', () => { const value = Number(opacity.value) / 100; action(() => api.updateSkin({ opacity: value })); });
  animated.addEventListener('change', () => { const enabled = animated.checked; motionAllowed = enabled; action(() => api.updateSkin({ animated: enabled })); });
  get('.skin-close').addEventListener('click', () => modal.close());
  const visibility = () => apply();
  document.addEventListener('visibilitychange', visibility);
  const blur = () => { focused = false; apply(); };
  const focus = () => { focused = true; apply(); };
  view.addEventListener('blur', blur);
  view.addEventListener('focus', focus);
  const stopActivity = api.onWindowActivity?.(active => { focused = active === true; apply(); });
  const motion = () => { motionAllowed = false; apply(); };
  reducedMotion.addEventListener?.('change', motion);
  load();
  return {
    open() { if (disposed) return; showError(''); if (!modal.open) modal.showModal(); load(); },
    dispose() { disposed = true; document.removeEventListener('visibilitychange', visibility); view.removeEventListener('blur', blur); view.removeEventListener('focus', focus); stopActivity?.(); reducedMotion.removeEventListener?.('change', motion); releaseMedia(); layer.remove(); modal.remove(); document.documentElement.classList.remove('has-custom-skin'); }
  };
}
