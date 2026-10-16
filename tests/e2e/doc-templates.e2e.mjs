// 单据模板 in the real page with the real backend: edit a template, company info, preview follows, reload keeps it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); await openPage(); });
after(async () => { await app?.close(); });

const openPage = async () => {
  await app.page.locator('.rail-item[data-rail-menu="交易"]').click();
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("单据模板"))').click();
  await app.page.locator('[data-doc-panel]').waitFor();
};
const settle = (ms = 350) => app.page.waitForTimeout(ms);
const tab = async (id) => { await app.page.locator(`[data-doc-tab="${id}"]`).click(); await settle(); };

test('the 单据模板 entry shows five tabs and a preview', async () => {
  const { page } = app;
  assert.deepEqual(await page.locator('[data-doc-tab]').allInnerTexts(), ['报价单', '形式发票', '销售订单', '发货通知', '编号规则', '单据记录', '公司信息']);
  assert.match(await page.locator('.dt-title h2').innerText(), /报价单/);
});

test('company info and a template change show up in the preview and survive a reload', async () => {
  const { page } = app;
  await tab('company');
  await page.locator('[name="company:name"]').fill('Comely Beauty Inc.');
  await page.locator('[name="bank:bank"]').fill('HSBC');
  await page.locator('[data-doc-form="company"] button[type=submit]').click();
  await settle();
  await tab('pi');
  assert.match(await page.locator('.dt-co strong').innerText(), /Comely Beauty Inc\./);
  assert.match(await page.locator('.dt-block').allInnerTexts().then((t) => t.join('|')), /HSBC/);
  await page.locator('[data-doc-form="template"] [name="title"]').fill('PI 单');
  await page.locator('[data-doc-form="template"] [name="col:price"]').uncheck();
  await page.locator('[data-doc-form="template"] [name="col:amount"]').uncheck();
  await page.locator('[data-doc-form="template"] button[type=submit]').click();
  await settle();
  assert.match(await page.locator('.dt-title h2').innerText(), /PI 单/);
  assert.equal(await page.locator('.dt-table th', { hasText: '单价' }).count(), 0);
  const saved = (await app.readData()).laiSettings.docTemplates;
  assert.equal(saved.templates.pi.title, 'PI 单');
  assert.equal(saved.company.name, 'Comely Beauty Inc.');
  await app.open('customers');
  await openPage();
  await tab('pi');
  assert.match(await page.locator('.dt-title h2').innerText(), /PI 单/);
  assert.deepEqual(app.errors, []);
});

test('reset needs a second click and brings the default back', async () => {
  const { page } = app;
  await page.locator('[data-doc-action="reset"]').click();
  assert.match(await page.locator('[data-doc-action="reset"]').innerText(), /确定恢复/);
  await page.locator('[data-doc-action="reset"]').click();
  await settle();
  assert.match(await page.locator('.dt-title h2').innerText(), /形式发票/);
});
