// 线索 module in the real page with the real backend: create, follow up, convert, trash, reload.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); await openLeads(); });
after(async () => { await app?.close(); });

const openLeads = async () => { await app.page.locator('.rail-item[data-rail-menu="线索"]').click(); await app.page.waitForTimeout(500); };
const settle = (ms = 350) => app.page.waitForTimeout(ms);
const count = (sel) => app.page.locator(sel).count();
const text = (sel) => app.page.locator(sel).first().innerText();
const tab = (id) => app.page.locator(`[data-lead-status="${id}"] b`).innerText();
const fill = async (form, values) => { for (const [name, value] of Object.entries(values)) await app.page.locator(`${form} [name="${name}"]`).fill(value); };
const submit = async (form) => { await app.page.locator(`button[type="submit"][form="${form}"], #${form} button[type="submit"]`).first().click(); await settle(); };

test('the 线索 entry opens the real module, empty at first', async () => {
  await app.page.locator('.lead-none').waitFor();
  assert.equal(await text('.lead-none .k-empty-title'), '还没有线索');
});

test('a new lead is saved, followed up, and becomes 跟进中', async () => {
  const { page } = app;
  await page.locator('.lead-none [data-lead-action="new"]').click();
  await settle();
  await fill('#lead-form', { name: 'Northwind Beauty GmbH', contact: 'Anna Berg', email: 'anna@northwind.example', source: '展会' });
  await submit('lead-form');
  assert.equal(await tab('new'), '1');
  await page.locator('.lead-table tbody tr [data-lead-action="follow"]').click();
  await settle();
  await page.locator('#lead-follow-form textarea').fill('电话沟通：需要 500 盒报价。');
  await submit('lead-follow-form');
  assert.equal(await text('.lead-detail-head .lead-status'), '跟进中');
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
  assert.equal(await tab('following'), '1');
});

test('a malformed email is refused with a message', async () => {
  const { page } = app;
  await page.locator('[data-lead-action="new"]').first().click();
  await settle();
  await fill('#lead-form', { name: 'Bad Mail Co', email: 'a@b' });
  await page.locator('#lead-form').evaluate((form) => { form.noValidate = true; form.removeAttribute('data-form-check'); });
  await submit('lead-form');
  assert.match(await text('#lead-error'), /邮箱格式不正确/);
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
});

test('converting needs a country, then creates a customer that shows where it came from', async () => {
  const { page } = app;
  await page.locator('.lead-table tbody tr [data-lead-action="convert"]').click();
  await settle();
  assert.equal(await page.locator('#lead-convert-form [name="name"]').inputValue(), 'Northwind Beauty GmbH');
  await page.locator('#lead-convert-form').evaluate((form) => { form.noValidate = true; form.removeAttribute('data-form-check'); });
  await submit('lead-convert-form');
  assert.match(await text('#lead-convert-error'), /国家地区/);
  await page.locator('#lead-convert-form [name="country"]').fill('德国');
  await submit('lead-convert-form');
  assert.equal(await text('.lead-detail-head .lead-status'), '已转客户');
  await page.locator('.lead-banner.is-converted [data-biz-customer]').click();
  await settle(900);
  const html = await page.content();
  assert.ok(html.includes('anna@northwind.example') && html.includes('由线索转入'));
});

test('trash, restore and reload keep the leads', async () => {
  const { page } = app;
  await app.open('customers');
  await openLeads();
  await page.locator('.lead-table tbody tr [data-lead-action="open"]').first().waitFor();
  await page.locator('.lead-table tbody tr [data-lead-action="open"]').first().click();
  await settle();
  await page.locator('.lead-detail-actions [data-lead-action="trash"]').click();
  await settle();
  assert.equal(await count('.lead-table tbody tr'), 0);
  await page.locator('[data-lead-action="trash-page"]').click();
  await settle();
  await page.locator('[data-lead-action="restore"]').click();
  await settle();
  await page.locator('[data-lead-action="list-page"]').click();
  await settle();
  assert.equal(await tab('all'), '1');
  assert.equal((await app.readData()).laiLeads?.length, 1, 'saved to the backend');
  await app.open('customers');
  await openLeads();
  await page.locator('.lead-table').waitFor();
  assert.equal(await tab('converted'), '1');
  assert.deepEqual(app.errors, []);
});
