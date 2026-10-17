// 线索设置 in the real page with the real backend: open it from Leads → 设置, add a 无效原因 and use it, hide and
// require a field in the lead form; a 业务 account cannot open the page.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const L = require('../../src/lead-model.js');

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const settle = (ms = 450) => app.page.waitForTimeout(ms);
const body = () => app.page.locator('body').innerText();
const stored = async () => (await app.readData());
const go = async (route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(600);
};

test('Leads → 设置 opens the 线索设置 page (flyout row and rail icon)', async () => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="Leads"]').hover();
  await page.locator('.rail-flyout [data-flyout-target="lead-settings"]').click();
  await settle(700);
  await page.locator('[data-ls-section="reasons"]').waitFor();
  assert.match(await page.locator('.business-title h1').innerText(), /线索设置/);
  assert.equal(await page.locator('[data-ls-section]').count(), 3);
  assert.match(await body(), /来源请到 客户设置 → 来源设置/);
  assert.match(await body(), /判重请到 客户设置 → 判重设置/);
  assert.equal(await page.locator('.cs-list li').count(), 6);
  await go('leads');
  await page.locator('.rail-item[data-rail-menu="Leads"]').click();
  await settle(700);
  await page.locator('[data-ls-section="reasons"]').waitFor();
});

test('a new 无效原因 is saved and offered in the 标记无效 dialog; a reason in use cannot be deleted', async () => {
  const { page } = app;
  await page.locator('#ls-reason-add input[name="text"]').fill('价格太高');
  await page.locator('#ls-reason-add button[type="submit"]').click();
  await settle();
  assert.equal(await page.locator('.cs-list li').count(), 7);
  assert.ok((await stored()).laiSettings.leadSettings.reasons.includes('价格太高'));
  // A lead, marked invalid with the new reason.
  await go('leads');
  await page.locator('[data-lead-action="new"]').first().click();
  await settle();
  await page.locator('#lead-form [name="name"]').fill('Cheap Buyer Ltd');
  await page.locator('button[type="submit"][form="lead-form"]').click();
  await settle();
  await page.locator('.lead-table tbody tr .company-link').first().click();
  await settle();
  await page.locator('[data-lead-action="invalid"]').click();
  await settle();
  const options = await page.locator('#lead-invalid-form [name="reason"] option').allInnerTexts();
  assert.deepEqual(options, ['请选择', '无法联系', '没有需求', '预算不符', '重复线索', '同行或广告', '其他', '价格太高']);
  await page.locator('#lead-invalid-form [name="reason"]').selectOption('价格太高');
  await page.locator('button[type="submit"][form="lead-invalid-form"]').click();
  await settle();
  assert.equal((await stored()).laiLeads[0].invalidReason, '价格太高');
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
  // Deleting is blocked while the lead uses it; renaming keeps the lead in step.
  await go('lead-settings');
  const remove = page.locator('[data-ls-action="remove"][data-name="价格太高"]');
  await remove.click();
  await remove.click();
  await settle();
  assert.match(await page.locator('#ls-error').innerText(), /还有 1 条线索用了这个原因，先改掉它们/);
  const rename = page.locator('input[data-ls-rename="价格太高"]');
  await rename.fill('报价太高');
  await rename.press('Enter');
  await settle();
  const data = await stored();
  assert.ok(data.laiSettings.leadSettings.reasons.includes('报价太高'));
  assert.equal(data.laiLeads[0].invalidReason, '报价太高');
});

test('a hidden field leaves the lead form and a required field must be filled', async () => {
  const { page } = app;
  await go('lead-settings');
  await page.locator('input[data-ls-field="website"][data-ls-kind="show"]').uncheck();
  await settle();
  await page.locator('input[data-ls-field="email"][data-ls-kind="required"]').check();
  await settle();
  const fields = (await stored()).laiSettings.leadSettings.fields;
  assert.deepEqual(fields.website, { show: false, required: false });
  assert.deepEqual(fields.email, { show: true, required: true });
  assert.equal(await page.locator('input[data-ls-field="website"][data-ls-kind="required"]').isDisabled(), true, 'a hidden field cannot be required');
  await go('leads');
  await page.locator('[data-lead-action="new"]').first().click();
  await settle();
  assert.equal(await page.locator('#lead-form [name="website"]').count(), 0);
  assert.equal(await page.locator('#lead-form [name="email"]').getAttribute('required') !== null, true);
  await page.locator('#lead-form [name="name"]').fill('Needs Mail Co');
  await page.locator('#lead-form').evaluate((form) => { form.noValidate = true; });
  await page.locator('button[type="submit"][form="lead-form"]').click();
  await settle();
  assert.match(await page.locator('#lead-error').innerText(), /请填写邮箱/);
  await page.locator('#lead-form [name="email"]').fill('buyer@needsmail.example');
  await page.locator('button[type="submit"][form="lead-form"]').click();
  await settle();
  const leads = (await stored()).laiLeads;
  assert.equal(leads.length, 2);
  assert.equal(leads[0].email, 'buyer@needsmail.example');
  assert.equal(L.list({ laiLeads: leads }).length, 2);
});

test('a 业务 account cannot open 线索设置', async () => {
  const sales = await startApp();
  try {
    await sales.open('customers');
    const request = sales.page.context().request;
    const loaded = await (await request.get(sales.base + '/api/data')).json();
    const data = loaded.data;
    data.laiSettings = { ...(data.laiSettings || {}), defaultOwner: 'Amy', roles: {
      roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'lead.view': true, 'lead.create': true, 'lead.edit': true, 'customer.view': true }, v: 2 }],
      departments: [], members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current: 'm-amy',
    } };
    const res = await request.post(sales.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
    assert.equal(res.status(), 200, await res.text());
    await sales.open('lead-settings');
    await sales.page.waitForTimeout(700);
    assert.equal(await sales.page.locator('[data-ls-section]').count(), 0);
    assert.equal(await sales.page.locator('.role-blocked').count(), 1);
    assert.match(await sales.page.locator('.role-blocked').innerText(), /没有|权限/);
  } finally { await sales.close(); }
});

test('the page logged no errors', () => {
  assert.deepEqual(app.errors, []);
});
