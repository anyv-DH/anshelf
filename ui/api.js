/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export async function call(method, ...args) {
  if (window.shelf && typeof window.shelf[method] === 'function') return window.shelf[method](...args);
  const response = await fetch(`/api/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  const result = await response.json();
  if (!response.ok || result?.error) throw new Error(result?.error || '操作未完成，请重试');
  return result;
}
