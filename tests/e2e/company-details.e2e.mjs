// 公司资料 is one record (D-022): edit it on 设置, see it in 单据模板 and in the 报价单 preview; the old 公司名称 migrates.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('settings'); });
after(async () => { await app?.close(); });

const settle = (ms = 700) => app.page.waitForTimeout(ms);
const openDocs = async () => {
  await app.open('customers');
  await app.page.locator('.rail-item[data-rail-menu="交易"]').click();
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("单据模板"))').click();
  await app.page.locator('[data-doc-panel]').waitFor();
};

test('the old 公司名称 field is gone and the 公司资料 fields are on 设置', async () => {
  const { page } = app;
  const form = page.locator('#biz-settings-form');
  assert.equal(await form.locator('[name=companyName]').count(), 0);
  for (const key of ['name', 'address', 'phone', 'email', 'website']) assert.equal(await form.locator(`[name="company:${key}"]`).count(), 1, key);
  assert.equal(await form.locator('[name="bank:bank"]').count(), 1);
});

test('company details edited on 设置 show in 单据模板 and in the 报价单 preview', async () => {
  const { page } = app;
  const form = page.locator('#biz-settings-form');
  await form.locator('[name="company:name"]').fill('Sunrise Trading Ltd.');
  await form.locator('[name="company:address"]').fill('88 Harbour Road, Shenzhen');
  await form.locator('[name="company:phone"]').fill('+86 755 0000 0000');
  await form.locator('[name="bank:bank"]').fill('HSBC Shenzhen');
  await form.locator('button[type=submit]').click();
  await settle();
  const saved = (await app.readData()).laiSettings;
  assert.equal(saved.docTemplates.company.name, 'Sunrise Trading Ltd.');
  assert.equal(saved.docTemplates.bank.bank, 'HSBC Shenzhen');
  await openDocs();
  const co = await page.locator('.dt-co').innerText();
  assert.match(co, /Sunrise Trading Ltd\./);
  assert.match(co, /88 Harbour Road/);
  assert.match(await page.locator('.dt-block').allInnerTexts().then((t) => t.join('|')), /HSBC Shenzhen/);
  await page.locator('[data-doc-tab="company"]').click();
  await settle(300);
  assert.equal(await page.locator('[name="company:name"]').inputValue(), 'Sunrise Trading Ltd.');
  assert.equal(await page.locator('[name="company:phone"]').inputValue(), '+86 755 0000 0000');
  assert.deepEqual(app.errors, []);
});

test('a change in 单据模板 shows on 设置 (same record)', async () => {
  const { page } = app;
  await page.locator('[name="company:email"]').fill('sales@sunrise.test');
  await page.locator('[data-doc-form="company"] button[type=submit]').click();
  await settle();
  await app.open('settings');
  assert.equal(await page.locator('#biz-settings-form [name="company:email"]').inputValue(), 'sales@sunrise.test');
  assert.equal(await page.locator('#biz-settings-form [name="company:name"]').inputValue(), 'Sunrise Trading Ltd.');
});

test('an old 公司名称 saved in laiSettings migrates into the shared record', async () => {
  const { page } = app;
  // Simulate old data: no template name, companyName set.
  const state = await (await app.api('/api/data')).json();
  const docTemplates = { ...state.data.laiSettings.docTemplates, company: { ...state.data.laiSettings.docTemplates.company, name: '' } };
  state.data.laiSettings = { ...state.data.laiSettings, docTemplates, companyName: '老公司有限公司' };
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200);
  await app.open('settings');
  await page.locator('#biz-settings-form').waitFor();
  assert.equal(await page.locator('#biz-settings-form [name="company:name"]').inputValue(), '老公司有限公司');
  await openDocs();
  assert.match(await page.locator('.dt-co').innerText(), /老公司有限公司/);
  assert.deepEqual(app.errors, []);
});
