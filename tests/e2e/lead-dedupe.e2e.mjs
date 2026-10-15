// 新线索与已有客户的判重: set the rule in 客户设置, then try to save leads that match a customer.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const EMAIL = 'avery@northwindlash.example'; // a sample customer
const settle = (ms = 400) => app.page.waitForTimeout(ms);
const openSettings = async () => {
  await app.open('customers');
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').click();
  await app.page.locator('.cs-page').waitFor();
  await app.page.locator('[data-cs-tab="dedupe"]').click();
  await app.page.locator('[data-cs-panel="dedupe"]').waitFor();
};
const setLeadMode = async (field, mode) => {
  await app.page.locator('[data-cs-dedupe-sub="lead"]').click();
  await app.page.locator('[data-cs-form="lead-dedupe"]').waitFor();
  await app.page.locator(`input[name="dedupe:${field}"][value="${mode}"]`).check();
  await app.page.locator('[data-cs-form="lead-dedupe"] button[type=submit]').click();
  await settle();
};
const newLead = async (values) => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="线索"]').click();
  await settle();
  await page.locator('[data-lead-action="new"]').first().click();
  await page.locator('#lead-form').waitFor();
  for (const [name, value] of Object.entries(values)) await page.locator(`#lead-form [name="${name}"]`).fill(value);
};
const submit = async () => { await app.page.locator('button[type="submit"][form="lead-form"]').click(); await settle(); };

test('settings: two sub-tabs, the lead table defaults to 判重，不允许保存 and saves', async () => {
  const { page } = app;
  await openSettings();
  assert.equal(await page.locator('.cs-subtabs button').count(), 2);
  assert.equal(await page.locator('[data-cs-form="dedupe"]').count(), 1, 'the customer table is the first sub-tab');
  await page.locator('[data-cs-dedupe-sub="lead"]').click();
  assert.deepEqual(await page.locator('[data-cs-form="lead-dedupe"] tbody td:first-child').allInnerTexts(), ['公司名称', '公司网址', '邮箱', '联系电话']);
  assert.equal(await page.locator('input[name^="dedupe:"][value="block"]:checked').count(), 4);
  assert.match(await page.locator('.cs-panel').innerText(), /新建或修改线索时，按这里的规则和已有客户比对。/);
  await setLeadMode('email', 'block');
  assert.equal((await app.readData()).laiSettings.customerSettings.leadDedupe.email, 'block');
});

test('block: a lead with an existing customer email is refused with the customer name', async () => {
  const { page } = app;
  await newLead({ name: 'Fresh Lead Co', email: EMAIL.toUpperCase() });
  await submit();
  assert.match(await page.locator('#lead-error').innerText(), /和已有客户「Northwind Lash Studio」的邮箱相同，不能保存。可以直接给这个客户写跟进。/);
  assert.equal(await page.locator('#lead-form').count(), 1, 'the form stays open');
  await page.locator('#lead-form [name="email"]').fill('new@fresh.example');
  await submit();
  await page.locator('#lead-form').waitFor({ state: 'detached' });
  assert.equal((await app.readData()).laiLeads.length, 1);
});

test('allow: first save shows a warning and 仍然保存, the second saves', async () => {
  const { page } = app;
  await openSettings();
  await setLeadMode('email', 'allow');
  await newLead({ name: 'Warned Lead', email: EMAIL });
  await submit();
  assert.match(await page.locator('#lead-warn').innerText(), /和已有客户「Northwind Lash Studio」的邮箱相同，确定还要保存吗？/);
  assert.equal(await page.locator('button[type="submit"][form="lead-form"]').innerText(), '仍然保存');
  assert.equal((await app.readData()).laiLeads.length, 1, 'nothing saved yet');
  await submit();
  await page.locator('#lead-form').waitFor({ state: 'detached' });
  const leads = (await app.readData()).laiLeads;
  assert.equal(leads.length, 2);
  assert.ok(leads.some((lead) => lead.name === 'Warned Lead' && lead.email === EMAIL));
  assert.deepEqual(app.errors, []);
});
