/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
(async function () {
  let source;
  try {
    const bytes = await window.posterWorker.input();
    source = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('GIF无法解码')); image.src = source; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 20000 || image.naturalHeight > 20000) throw new Error('GIF尺寸无效');
    const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    window.posterWorker.done({ png: canvas.toDataURL('image/png') });
  } catch (error) { window.posterWorker.done({ error: String(error.message || error) }); }
  finally { if (source) URL.revokeObjectURL(source); }
}());
