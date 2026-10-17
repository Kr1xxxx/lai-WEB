// Top-bar search also finds customers by custom field values: 全部 matches them, the scope menu lists the field by name,
// choosing it searches only that field, and a deleted field falls back to 全部.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const CS = require('../../src/customer-settings-model.js');

let app;
const MAPLE = 'Maple & Moss Cosmetics';
const LUMEN = 'Lumen Lash Lab';
let fieldId = '';

before(async () => {
  app = await startApp();
  const state = await (await app.api('/api/data')).json();
  let data = state.data;
  data = CS.addCustomField(data, { name: '工厂规模', type: 'text' });
  fieldId = CS.customFieldSettings(data).customFields.find((f) => f.name === '工厂规模').id;
  data.customers[MAPLE].custom = { [fieldId]: '灯塔车间两百人' };
  state.data = data;
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const rows = () => app.page.locator('tbody tr');
const search = async (text) => {
  const box = app.page.locator('.global-search input[name="query"]');
  await box.fill(text);
  await box.press('Enter');
  await app.page.waitForTimeout(400);
};

test('top-bar search finds a customer by a custom field value, in 全部 and in the field scope', async () => {
  const { page } = app;
  await search('灯塔车间');
  assert.deepEqual(await rows().locator('.company-link').allInnerTexts(), [MAPLE]);
  await page.locator('[data-action="global-search-scope"]').click();
  const item = page.locator(`.global-search-scope-menu [data-global-field="custom:${fieldId}"]`);
  assert.equal(await item.innerText(), '工厂规模');
  await item.click();
  assert.equal((await page.locator('.global-search-label').innerText()).trim(), '工厂规模');
  await app.page.waitForTimeout(300);
  assert.deepEqual(await rows().locator('.company-link').allInnerTexts(), [MAPLE]);
  await search(LUMEN);
  assert.equal(await rows().count(), 0, 'only the chosen field is searched');
  await search('');
});
