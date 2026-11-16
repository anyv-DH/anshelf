/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export const THEMES = Object.freeze([
  { id: 'dark', label: '紫夜', scheme: 'dark', background: '#171520', description: '柔和紫调，适合长时间创作' },
  { id: 'warm', label: '暖米', scheme: 'light', background: '#f7f1e9', description: '温暖米色，轻松浏览素材' },
  { id: 'paper', label: '雾白', scheme: 'light', background: '#f4f5f7', description: '简洁浅色，让素材更清晰' },
  { id: 'slate', label: '石墨', scheme: 'dark', background: '#191f27', description: '中性深色，专注预览细节' },
  { id: 'sage', label: '青灰', scheme: 'light', background: '#f0f4f1', description: '清淡绿灰，安静舒适' },
  { id: 'bluewhite', label: '清爽蓝白', scheme: 'light', background: '#ffffff', description: '白底浅灰分区，蓝色突出当前选择' },
].map(theme => Object.freeze(theme)));

const LAYOUTS = Object.freeze([
  { id: 'modern', label: '新版 · 素材优先', description: '大预览、紧凑工具栏，常用操作更顺手' },
  { id: 'classic', label: '经典版', description: '沿用熟悉的页面布局与操作位置' },
]);
export const PREVIEW_BACKGROUNDS = Object.freeze([
  { id: 'checker', label: '透明网格', description: '查看透明区域' },
  { id: 'white', label: '纯白', description: '明亮干净' },
  { id: 'gray', label: '浅灰', description: '柔和中性' },
  { id: 'dark', label: '深灰', description: '查看浅色细节' },
].map(background => Object.freeze(background)));
const KEYS = { layout: 'anshelf-layout', theme: 'anshelf-theme', previewBackground: 'anshelf-preview-background' };
const valid = {
  layout: value => LAYOUTS.some(layout => layout.id === value),
  theme: value => THEMES.some(theme => theme.id === value),
  previewBackground: value => PREVIEW_BACKGROUNDS.some(background => background.id === value),
};

export function createAppearancePreferences({ getStorage = () => globalThis.localStorage } = {}) {
  const preferences = { layout: 'modern', theme: 'dark', previewBackground: 'checker' };
  for (const key of Object.keys(KEYS)) {
    try {
      const value = getStorage()?.getItem(KEYS[key]);
      if (valid[key](value)) preferences[key] = value;
    } catch { /* Each setting remains usable if the other key cannot be read. */ }
  }
  const get = () => ({ ...preferences });
  function set(key, value) {
    if (!valid[key](value)) return get();
    preferences[key] = value;
    try { getStorage()?.setItem(KEYS[key], value); }
    catch { /* Retain the selected appearance for this session. */ }
    return get();
  }
  return {
    get,
    setLayout: value => set('layout', value),
    setTheme: value => set('theme', value),
    setPreviewBackground: value => set('previewBackground', value),
  };
}

export function mountAppearance({ document, preferences, onChange = () => {}, onSkin = () => {} }) {
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  };
  const button = (className, text) => { const element = node('button', className, text); element.type = 'button'; return element; };
  const dialog = node('dialog', 'appearance-dialog'); dialog.id = 'appearance-dialog';
  dialog.setAttribute('aria-labelledby', 'appearance-title'); dialog.setAttribute('aria-describedby', 'appearance-description');
  const header = node('div', 'appearance-heading');
  const heading = node('div', 'appearance-heading-copy');
  const title = node('h2', '', '外观设置'); title.id = 'appearance-title';
  const description = node('p', '', '选择你顺手的布局和配色，更改即时生效。'); description.id = 'appearance-description';
  heading.append(title, description);
  const closeButton = button('icon-button appearance-close', '×'); closeButton.dataset.appearanceClose = 'close'; closeButton.setAttribute('aria-label', '关闭外观设置');
  header.append(heading, closeButton);

  function section(label, hint, className) {
    const group = node('fieldset', 'appearance-section');
    group.append(node('legend', '', label), node('p', 'appearance-section-hint', hint));
    const options = node('div', className); group.append(options); dialog.append(group);
    return options;
  }
  function optionCopy(label, description) {
    const copy = node('span', 'appearance-option-copy');
    copy.append(node('strong', '', label), node('small', '', description));
    return copy;
  }
  function mark() { const check = node('span', 'appearance-check', '✓'); check.setAttribute('aria-hidden', 'true'); return check; }

  dialog.append(header);
  const layoutOptions = section('页面布局', '随时切换，保留当前分类、搜索和素材选择。', 'appearance-layouts');
  const layoutButtons = LAYOUTS.map(layout => {
    const choice = button('appearance-option appearance-layout'); choice.dataset.appearanceLayout = layout.id;
    const preview = node('span', 'appearance-layout-picture'); preview.dataset.layoutPreview = layout.id; preview.setAttribute('aria-hidden', 'true');
    const miniGrid = node('span', 'appearance-mini-grid');
    for (let i = 0; i < 6; i++) miniGrid.append(node('span'));
    preview.append(node('span', 'appearance-mini-sidebar'), miniGrid);
    choice.append(preview, optionCopy(layout.label, layout.description), mark()); layoutOptions.append(choice);
    choice.addEventListener('click', () => apply('layout', layout.id));
    return choice;
  });
  const themeOptions = section('界面配色', '布局和配色可以自由搭配。', 'appearance-themes');
  const themeButtons = THEMES.map(theme => {
    const choice = button('appearance-option appearance-theme'); choice.dataset.appearanceTheme = theme.id;
    const swatch = node('span', 'appearance-swatch'); swatch.setAttribute('aria-hidden', 'true');
    swatch.append(node('span'), node('span'), node('span'));
    choice.append(swatch, optionCopy(theme.label, theme.description), mark()); themeOptions.append(choice);
    choice.addEventListener('click', () => apply('theme', theme.id));
    return choice;
  });
  const backgroundOptions = section('素材预览背景', '同时用于素材卡片和放大预览，选择会自动记住。', 'appearance-preview-backgrounds');
  const backgroundButtons = PREVIEW_BACKGROUNDS.map(background => {
    const choice = button('appearance-option appearance-preview-background'); choice.dataset.appearancePreviewBackground = background.id;
    const swatch = node('span', 'appearance-background-swatch'); swatch.setAttribute('aria-hidden', 'true');
    choice.append(swatch, optionCopy(background.label, background.description), mark()); backgroundOptions.append(choice);
    choice.addEventListener('click', () => apply('previewBackground', background.id));
    return choice;
  });
  const footer = node('div', 'appearance-footer');
  const skinButton = button('button secondary appearance-skin', '更换底图'); skinButton.dataset.appearanceSkin = 'open';
  const doneButton = button('button primary', '完成'); doneButton.dataset.appearanceClose = 'done';
  footer.append(skinButton, node('p', '', '选择后立即生效'), doneButton); dialog.append(footer); document.body.append(dialog);
  let trigger = null, disposed = false;

  function updateChoices() {
    const current = preferences.get();
    for (const choice of layoutButtons) choice.setAttribute('aria-pressed', choice.dataset.appearanceLayout === current.layout);
    for (const choice of themeButtons) choice.setAttribute('aria-pressed', choice.dataset.appearanceTheme === current.theme);
    for (const choice of backgroundButtons) choice.setAttribute('aria-pressed', choice.dataset.appearancePreviewBackground === current.previewBackground);
    return current;
  }
  function apply(key, value) {
    if (disposed || preferences.get()[key] === value) return;
    const current = key === 'layout' ? preferences.setLayout(value) :
      key === 'theme' ? preferences.setTheme(value) : preferences.setPreviewBackground(value);
    updateChoices(); onChange(current);
  }
  function restoreFocus() {
    const target = trigger; trigger = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }
  function close() { if (dialog.open) dialog.close(); }
  closeButton.addEventListener('click', close); doneButton.addEventListener('click', close);
  skinButton.addEventListener('click', () => { close(); onSkin(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', restoreFocus);
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  });
  updateChoices();
  return {
    open() {
      if (disposed || dialog.open) return false;
      const current = updateChoices(); trigger = document.activeElement;
      try {
        dialog.showModal();
        layoutButtons.find(choice => choice.dataset.appearanceLayout === current.layout)?.focus({ preventScroll: true });
        return true;
      } catch { restoreFocus(); return false; }
    },
    dispose() { if (disposed) return; disposed = true; close(); dialog.remove(); },
  };
}
