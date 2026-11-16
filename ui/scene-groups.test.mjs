import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSceneAssets, collapseSceneGroups, sceneGroupCard, sceneGroupDialog } from './scene-groups.mjs';
const assets = ['a', 'b', 'c'].map((id, i) => ({ id, kind: 'image', name: '图片' + i, previewUrl: 'local-' + id }));
const groups = [{ id: 'g', name: '客厅', assetIds: ['a', 'b'], coverAssetId: 'b' }];
test('collapse happens before pagination and only includes matched members', () => {
  const entries = collapseSceneGroups(assets, groups);
  assert.equal(entries.length, 2); assert.equal(entries[0].id, 'b'); assert.deepEqual(entries[0].sceneMemberIds, ['a', 'b']);
  const filtered = collapseSceneGroups([assets[0], assets[2]], groups);
  assert.equal(filtered[0].id, 'a'); assert.deepEqual(filtered[0].sceneMemberIds, ['a']);
  assert.equal(filtered[1].id, 'c');
});
test('both group name and individual image names are searchable', () => {
  assert.deepEqual(filterSceneAssets(assets, groups, '客厅').map(a => a.id), ['a', 'b']);
  assert.deepEqual(filterSceneAssets(assets, groups, '图片0').map(a => a.id), ['a']);
  assert.deepEqual(filterSceneAssets(assets, groups, '没有'), []);
});
test('group UI opens a flat image grid with individual actions and no view switching', () => {
  const card = sceneGroupCard(collapseSceneGroups(assets, groups)[0], false);
  assert.match(card, /open-scene-group/); assert.match(card, /2 张/);
  const html = sceneGroupDialog(groups[0], assets);
  assert.equal((html.match(/data-action="send"/g) || []).length, 2);
  assert.equal((html.match(/data-drag-id=/g) || []).length, 2);
  assert.match(html, /scene-member-grid/); assert.match(html, /移出组合/);
  assert.doesNotMatch(html, /视角切换|下一视角|carousel|slider|data-scene-active/i);
  assert.ok(!html.includes('local-c'));
});
