/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export function pageAssets(assets, page = 0, size = 60) {
  const pageSize = Number.isInteger(size) && size > 0 ? size : 60;
  const pages = Math.max(1, Math.ceil(assets.length / pageSize));
  const current = Math.max(0, Math.min(pages - 1, Number.isInteger(page) ? page : 0));
  return { items: assets.slice(current * pageSize, (current + 1) * pageSize), page: current, pages, total: assets.length, size: pageSize };
}
