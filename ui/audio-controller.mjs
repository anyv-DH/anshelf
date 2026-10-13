/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

/** A detached player keeps playback alive when cards and snapshots refresh. */
export function createAudioController({ player = new Audio(), onChange = () => {} } = {}) {
  let asset = null, error = '', revision = 0, disposed = false;
  player.preload = 'metadata';
  const state = () => ({ id: asset?.id || null, name: asset?.name || '', playing: !!asset && !player.paused && !error, currentTime: Number.isFinite(player.currentTime) ? player.currentTime : 0, duration: Number.isFinite(player.duration) ? player.duration : null, error });
  const changed = () => { if (!disposed) onChange(state()); };
  const events = ['timeupdate', 'loadedmetadata', 'durationchange', 'play', 'pause', 'ended'];
  events.forEach(name => player.addEventListener(name, changed));
  const failed = () => { error = '无法解码这份音频，请检查文件或音频格式。仍可定位或拖出原文件。'; player.pause(); changed(); };
  player.addEventListener('error', failed);
  async function toggle(next) {
    if (disposed || !next) return;
    const token = ++revision;
    if (asset?.id === next.id && !player.paused && !error) { player.pause(); return; }
    if (asset?.id !== next.id || error) {
      player.pause(); asset = next; error = '';
      if (!next.mediaUrl) { error = '音频文件暂时不可用，请重新导入或定位原文件。'; changed(); return; }
      player.src = next.mediaUrl; player.load();
    }
    try { await player.play(); if (token === revision) changed(); }
    catch (cause) {
      if (token !== revision || cause?.name === 'AbortError') return;
      error = cause?.name === 'NotAllowedError' ? '请再点击一次播放按钮开始试听。' : '无法解码这份音频，请检查文件或音频格式。'; changed();
    }
  }
  function stop() { ++revision; player.pause(); asset = null; error = ''; player.removeAttribute('src'); player.load(); changed(); }
  return {
    state, toggle,
    seek(seconds) { if (!asset || !Number.isFinite(seconds) || !(player.duration > 0) || !Number.isFinite(player.duration)) return; player.currentTime = Math.min(player.duration, Math.max(0, seconds)); changed(); },
    reconcile(assets) { if (asset && !assets.some(item => item.id === asset.id)) stop(); },
    dispose() { stop(); disposed = true; events.forEach(name => player.removeEventListener(name, changed)); player.removeEventListener('error', failed); },
  };
}
