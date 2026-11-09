/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
/** Exercise the visible theme menu; never force the hidden compatibility select. */
async function chooseThemedOption(page, selector, value) {
  const id = await page.locator(selector).getAttribute('id');
  if (!id) throw new Error('Themed select test requires a select id');
  await page.locator(`[data-select-trigger=${JSON.stringify(id)}]`).click();
  await page.locator(`[data-category-option=${JSON.stringify(String(value))}]`).click();
}
module.exports = { chooseThemedOption };
