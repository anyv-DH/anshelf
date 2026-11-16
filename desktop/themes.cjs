/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const THEME_BACKGROUNDS = Object.freeze({ dark: '#171520', warm: '#f7f1e9', paper: '#f4f5f7', slate: '#191f27', sage: '#f0f4f1', bluewhite: '#ffffff' });
const isTheme = value => typeof value === 'string' && Object.hasOwn(THEME_BACKGROUNDS, value);
module.exports = { THEME_BACKGROUNDS, isTheme };
