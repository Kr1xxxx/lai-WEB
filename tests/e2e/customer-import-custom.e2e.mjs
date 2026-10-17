// 客户导入里的自定义字段，用真实页面和真实后端：匹配字段时能选自定义字段，预览里列出不合格的格子（只跳过这一格），
// 导入后值存进客户的 custom。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
let temp;
before(async () => {
  temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-import-'));
  app = await startApp();
  const state = await (await app.api('/api/data')).json();
  state.data.laiSettings = {
    ...(state.data.laiSettings || {}),
    fieldSettings: { customer: { customFields: [
      { id: 'qty', name: '采购量', type: 'number', options: [], required: false },
      { id: 'kind', name: '客户类别', type: 'select', options: ['经销商', '零售'], required: false },
    ], required: {} } },
  };
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
  await app.page.addInitScript(() => { window.__laiImportPreview = true; });
  await app.open('customers');
});
after(async () => { await app?.close(); fs.rmSync(temp, { recursive: true, force: true }); });

test('import: custom fields can be mapped, a bad cell is listed and skipped, the rest of the row is imported', async () => {
  const { page } = app;
  const file = path.join(temp, 'customers.csv');
  fs.writeFileSync(file, '公司名称,联系人昵称,采购量,客户类别\nImport Co One,Ana,1200,经销商\nImport Co Two,Bo,很多,批发商\n');
  await page.locator('[data-action="create-menu"]').first().click();
  await page.locator('.popover [data-action="import-customers"]').click();
  await page.locator('#customer-import-file').setInputFiles(file);
  await page.locator('[data-import-file-ready]').waitFor();
  await page.locator('.customer-import [data-action="import-next"]').click();
  // The two custom headers are matched by name and offered in the list.
  const options = await page.locator('select[data-import-column="2"] optgroup[label="自定义字段"] option').allInnerTexts();
  assert.deepEqual(options, ['采购量', '客户类别']);
  assert.equal(await page.locator('select[data-import-column="2"]').inputValue(), 'custom:qty');
  assert.equal(await page.locator('select[data-import-column="3"]').inputValue(), 'custom:kind');
  await page.locator('.customer-import [data-action="import-next"]').click();
  const warnings = await page.locator('[data-import-warnings]').innerText();
  assert.match(warnings, /第 3 行/);
  assert.match(warnings, /请填写数字/);
  assert.match(warnings, /选项“批发商”不在选项里/);
  assert.equal(await page.locator('[data-import-preview] tbody tr').count(), 2, 'both rows are in the preview');
  await page.locator('.customer-import [data-action="import-save"]').click();
  await page.locator('[data-import-result]').waitFor();
  assert.match(await page.locator('[data-import-result]').innerText(), /成功新建 2 位/);
  await page.locator('.customer-import [data-import-warnings]').waitFor();
  const data = await app.readData();
  assert.deepEqual(data.customers['Import Co One'].custom, { qty: 1200, kind: '经销商' });
  assert.equal(data.customers['Import Co Two'].contact, 'Bo');
  assert.equal(data.customers['Import Co Two'].custom, undefined, 'the bad cells were not stored');
  assert.deepEqual(app.errors, []);
});
