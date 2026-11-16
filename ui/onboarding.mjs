/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { mountOnboardingPosition } from './onboarding-targets.mjs';
export const ONBOARDING_STORAGE_KEY = 'anshelf-onboarding-v1';
const statuses = new Set(['new', 'completed', 'skipped']);

export function createOnboardingPreferences({ getStorage = () => globalThis.localStorage } = {}) {
  let saved;
  try { saved = JSON.parse(getStorage()?.getItem(ONBOARDING_STORAGE_KEY) || '{}'); } catch { saved = {}; }
  let status = saved && !Array.isArray(saved) && statuses.has(saved.status) ? saved.status : 'new';
  return {
    get: () => ({ status }),
    shouldShow: () => status === 'new',
    setStatus(value) {
      if (!statuses.has(value)) return false;
      status = value;
      try { getStorage()?.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ status })); } catch { /* keep the current-session choice */ }
      return true;
    },
  };
}

export const ONBOARDING_STEPS = Object.freeze([
  { title: '欢迎', kicker: '把素材收好，让创作顺手一点', demo: 'welcome',
    lead: '欢迎使用安安素材管理器。跟着这六步，您可以先认识常用操作，再开始整理素材。',
    points: ['高亮区域就是您页面上的实际控件。接下来会带您认识导入、分类、预览和 AN 连接。', '素材在本机管理，分类和分组只记录整理关系，保留您的原始素材。'],
    note: '您可以随时跳过，之后从“工具 → 新手引导”重看。' },
  { title: '导入素材', kicker: '一个入口，按素材选择', demo: 'import',
    lead: '点击顶部“导入素材”，选择普通 FLA、特效、音频或图片；也可以把文件直接拖进窗口。',
    points: ['普通 FLA 生成静态预览，特效 FLA 生成动态预览；音频可试听，图片显示本地画面。', '拖入后先配置素材类型、分类与适用的预览分辨率，确认后再导入。', '图片可勾选“一个文件夹作为一个分组”。按图片直接所在的小文件夹分别分组，父文件夹里的图片另成一组。'],
    note: '导入会保留原始文件；图片组合只是归类，不会把多个角度合成或切换成一个画面。' },
  { title: '分类与项目', kicker: '按类型整理，也能按一部剧汇集', demo: 'categories',
    lead: '默认顶层包括人物、背景、表情、道具、特效、动物异兽、音效和 BGM，您也可以新建顶层分类。',
    points: ['选择顶层后，再选择下一层分类；旁边的添加按钮可继续创建子分类。', '点击“新建项目”，把一部剧需要的跨类型素材放在一起。同一素材可加入多个分类或项目，不用复制原文件。', '搜索用于查找素材，点赞与收藏帮助您快速回到常用内容。'],
    note: '分类和项目都是元数据；整理归属不会移动或修改原始素材。' },
  { title: '预览与整理', kicker: '先看清，再修改', demo: 'preview',
    lead: '点击素材封面打开预览。点击素材名称可修改名称，分类、标签等详情也集中在预览弹窗中。',
    points: ['详情默认折叠，展开或收起后会记忆您的选择；需要时再查看，预览更清爽。', '多选图片可创建一个组合，打开后并排查看成员；每张图片仍可单独预览或导入 AN。', '移除素材前会显示确认范围；素材库操作不会删除您的原始文件。'],
    note: '打开预览后，点击左上角素材名称可直接改名。' },
  { title: '放进 AN', kicker: '先连接当前文档，再发送素材', demo: 'animate',
    lead: '从“工具 → 检查更新”点击“一键安装／更新 AN 插件”，再在 Adobe Animate 中打开安安素材管理器扩展面板。',
    points: ['请保持 AN 扩展面板打开，并打开需要接收素材的文档；安装插件后按提示重新打开扩展面板。', '图片可点击“导入 AN”，也可以拖入 AN。FLA 可使用“粘贴到舞台”，按接收面板提示完成操作。', '未连接、文档不合适、插件过旧或导入失败时，请查看实际提示，再按原因处理。'],
    note: '发送前请确认 AN 中当前打开的是要接收素材的文档；软件不会自动保存或关闭 AN。' },
  { title: '按习惯浏览', kicker: '让预览和分页适合您', demo: 'browse',
    lead: '固定浏览和滚动浏览都按页显示。滚动只浏览当前页，翻页后再看下一批素材。',
    points: ['每页数量可自动适屏，也可选择预设或自定义数量；固定模式会按窗口容量封顶，避免内容挤出屏幕。', '网格可选择每行 7 个或 8 个等密度；小窗口会自动减少列数。', '“工具 → 外观与布局”提供新版／经典版和六套配色；预览底色可选透明网格、纯白、浅灰或深灰。'],
    note: '您已认识主要功能。可以完成教程，也可以选择下面的入口开始操作。' },
].map(step => Object.freeze({ ...step, points: Object.freeze(step.points) })));

export function mountOnboarding({ document, preferences, canOpen = () => true, onAction = () => {}, onClose = () => {} }) {
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  };
  const button = (label, action, className = 'button secondary') => {
    const element = node('button', className, label); element.type = 'button'; element.dataset.onboardingAction = action; return element;
  };
  const dialog = node('dialog', 'onboarding-dialog'); dialog.id = 'onboarding-dialog';
  dialog.setAttribute('aria-labelledby', 'onboarding-title'); dialog.setAttribute('aria-describedby', 'onboarding-description');
  const heading = node('header', 'onboarding-heading'), headingCopy = node('div', 'onboarding-heading-copy');
  const title = node('h2', '', '新手引导'); title.id = 'onboarding-title';
  const description = node('p', 'onboarding-description', '跟随高亮区域，认识页面上的常用操作'); description.id = 'onboarding-description';
  headingCopy.append(title, description);
  const closeButton = button('×', 'close', 'icon-button onboarding-close'); closeButton.setAttribute('aria-label', '关闭新手引导'); heading.append(headingCopy, closeButton);
  const workspace = node('div', 'onboarding-workspace'), navigation = node('nav', 'onboarding-steps'); navigation.setAttribute('aria-label', '教程目录');
  const stepButtons = ONBOARDING_STEPS.map((step, index) => {
    const item = node('button', 'onboarding-step'); item.type = 'button'; item.dataset.onboardingStep = String(index);
    item.setAttribute('aria-label', `第 ${index + 1} 步：${step.title}`); item.title = step.title;
    item.append(node('span', 'onboarding-step-number', String(index + 1))); navigation.append(item); return item;
  });
  const content = node('section', 'onboarding-content'); content.setAttribute('aria-labelledby', 'onboarding-step-title');
  workspace.append(navigation, content);
  const footer = node('footer', 'onboarding-footer'), progress = node('span', 'onboarding-progress'); progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
  const actions = node('div', 'onboarding-actions'), skip = button('稍后再看', 'skip', 'text-button onboarding-skip'), previous = button('上一步', 'previous'), next = button('下一步', 'next', 'button primary'), finish = button('完成引导', 'finish', 'button primary');
  actions.append(skip, previous, next, finish); footer.append(progress, actions);
  const highlight = node('div', 'onboarding-spotlight'); highlight.dataset.onboardingTarget = ''; highlight.setAttribute('aria-hidden', 'true');
  const card = node('div', 'onboarding-card'); card.dataset.onboardingCard = ''; card.append(heading, workspace, footer);
  dialog.append(highlight, card); document.body.append(dialog);
  let index = 0, opened = false, disposed = false, considered = false, pending = false, trigger = null, triggerSummary = null, toolsState = null;
  const position = mountOnboardingPosition({ document, dialog, highlight, card, getIndex: () => index });

  function restoreTools() {
    if (!toolsState) return;
    toolsState.element.open = toolsState.open; toolsState = null;
  }
  function revealTools() {
    if (index !== 4) { restoreTools(); return; }
    const tools = document.querySelector('#workspace-tools');
    if (!tools) return;
    if (!toolsState) toolsState = { element: tools, open: tools.open };
    tools.open = true;
  }
  function render(focus = false) {
    const step = ONBOARDING_STEPS[index], last = index === ONBOARDING_STEPS.length - 1;
    dialog.dataset.onboardingIndex = String(index); progress.textContent = `第 ${index + 1} 步 / 共 ${ONBOARDING_STEPS.length} 步`;
    for (let position = 0; position < stepButtons.length; position++) stepButtons[position].setAttribute('aria-current', position === index ? 'step' : 'false');
    const copy = node('div', 'onboarding-copy'), stepTitle = node('h3', '', step.title); stepTitle.id = 'onboarding-step-title'; stepTitle.setAttribute('tabindex', '-1'); stepTitle.setAttribute('aria-live', 'polite');
    const points = node('ul', 'onboarding-points'); for (const point of step.points) points.append(node('li', '', point));
    copy.append(node('p', 'onboarding-kicker', step.kicker), stepTitle, node('p', 'onboarding-lead', step.lead), points, node('p', 'onboarding-note', step.note));
    if (last) { const start = node('div', 'onboarding-start-actions'); start.append(button('去导入素材', 'import', 'button secondary'), button('连接 AN', 'bridge', 'button secondary')); copy.append(start); }
    content.replaceChildren(copy); previous.disabled = index === 0; next.hidden = last; finish.hidden = !last;
    if (focus) stepTitle.focus({ preventScroll: true });
    content.scrollTop = 0; dialog.scrollTop = 0;
    if (opened) { revealTools(); position.update(); }
  }
  function restoreFocus() {
    let target = trigger;
    if (!target?.isConnected && trigger?.dataset?.action) target = [...document.querySelectorAll('[data-action]')].find(element => element.dataset.action === trigger.dataset.action && element.dataset.id === trigger.dataset.id);
    const visible = element => {
      if (!element?.isConnected || element.getClientRects && !element.getClientRects().length) return false;
      for (let parent = element.closest('details'); parent; parent = parent.parentElement?.closest('details')) {
        if (!parent.open && !parent.querySelector('summary')?.contains(element)) return false;
      }
      const style = document.defaultView?.getComputedStyle?.(element);
      return style?.visibility !== 'hidden' && style?.display !== 'none';
    };
    if (!visible(target)) target = visible(triggerSummary) ? triggerSummary : document.querySelector('#search');
    target?.focus({ preventScroll: true });
  }
  function close(status, action) {
    if (!opened || disposed) return;
    opened = false; pending = false;
    if (status === 'completed' || preferences.get().status !== 'completed') preferences.setStatus(status);
    restoreTools(); if (dialog.open) dialog.close(); position.update(); restoreFocus();
    try { if (action) onAction(action); } finally { onClose(); }
  }
  function open(nextTrigger = document.activeElement) {
    if (disposed || opened || !canOpen()) return false;
    trigger = nextTrigger; triggerSummary = trigger?.closest('details')?.querySelector('summary'); index = 0; render();
    try { dialog.showModal(); } catch { return false; }
    opened = true; pending = false; render(true); return true;
  }
  function resume() {
    if (disposed || !pending) return;
    if (!preferences.shouldShow()) { pending = false; return; }
    open();
  }
  const click = event => {
    if (!opened || disposed) return;
    event.stopPropagation();
    const step = event.target.closest('[data-onboarding-step]');
    if (step && dialog.contains(step)) { const value = Number(step.dataset.onboardingStep); if (Number.isInteger(value) && value >= 0 && value < ONBOARDING_STEPS.length) { index = value; render(true); } return; }
    const target = event.target.closest('[data-onboarding-action]'); if (!target || !dialog.contains(target)) return;
    const action = target.dataset.onboardingAction;
    if (action === 'next' && index < ONBOARDING_STEPS.length - 1) { index++; render(true); }
    if (action === 'previous' && index > 0) { index--; render(true); }
    if (action === 'skip' || action === 'close') close('skipped');
    if (index === ONBOARDING_STEPS.length - 1 && ['finish', 'import', 'bridge'].includes(action)) close('completed', action === 'finish' ? null : action);
  };
  const cancel = event => { event.preventDefault(); event.stopPropagation(); close('skipped'); };
  const nativeClose = () => { if (!dialog.open) close('skipped'); };
  const keydown = event => event.stopPropagation();
  dialog.addEventListener('click', click); dialog.addEventListener('cancel', cancel); dialog.addEventListener('close', nativeClose); dialog.addEventListener('keydown', keydown);
  render();
  return {
    consider() { if (disposed || considered) return; considered = true; pending = preferences.shouldShow(); resume(); },
    resume, open, pending: () => pending, isPending: () => pending, isOpen: () => opened,
    dispose() {
      if (disposed) return; disposed = true; opened = false; pending = false;
      restoreTools(); position.dispose();
      dialog.removeEventListener('click', click); dialog.removeEventListener('cancel', cancel); dialog.removeEventListener('close', nativeClose); dialog.removeEventListener('keydown', keydown);
      if (dialog.open) dialog.close(); dialog.remove();
    },
  };
}
