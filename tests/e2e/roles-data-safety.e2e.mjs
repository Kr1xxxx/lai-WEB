// 字段权限 must never lose customer data. In the real page with the real backend, the 业务 account (some customer fields
// read-only or hidden) merges two customers and renames a customer group: every value is kept and the rename sticks.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const R = require('../../src/role-model.js');
const CSM = require('../../src/customer-settings-model.js');

let app;
const MAPLE = 'Maple & Moss Cosmetics';
const LUMEN = 'Lumen Lash Lab';
const shot = (name) => (process.env.SHOT_DIR ? { path: `${process.env.SHOT_DIR}/${name}.png` } : undefined);

before(async () => {
  app = await startApp();
  await app.open('customers');
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  let next = { ...state.data, laiSettings: { ...(state.data.laiSettings || {}), defaultOwner: 'Kris' } };
  next = CSM.addGroup(next, { name: '老客户组' });
  for (const name of Object.keys(next.customers)) next.customers[name] = { ...next.customers[name], owner: 'Amy' };
  Object.assign(next.customers[MAPLE], { website: '', note: '', previewGroup: '老客户组' });
  Object.assign(next.customers[LUMEN], {
    website: 'lumen.example', note: '只给老板看的备注', previewGroup: '老客户组',
    contact: 'Greta Vogel', contacts: ['Greta Vogel'], email: 'greta@lumenlash.example', emails: ['greta@lumenlash.example'],
    phone: '+49 30 5550 0144', phones: ['+49 30 5550 0144'],
  });
  // Amy = 业务: may merge and open 客户设置, but phone/website/group are read-only and email/note hidden.
  next = R.updateRole(next, 'sales', {
    scope: 'all',
    perms: { ...R.settings(next).roles.find((r) => r.id === 'sales').perms, 'customer.view': true, 'customer.edit': true, 'customer.merge': true, 'settings.customer': true },
    fields: { customer: { 'contact.phone': 'read', 'contact.email': 'hidden', website: 'read', note: 'hidden', previewGroup: 'read' } },
  });
  next = R.switchTo(next, R.settings(next).members.find((m) => m.name === 'Amy').id);
  assert.equal(R.isAdmin(next), false);
  state.data = next;
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const rows = () => app.page.locator('tbody tr');

test('as 业务: merging two customers keeps the read-only and hidden values of the merged one', async () => {
  const { page } = app;
  await rows().first().waitFor();
  for (const name of [MAPLE, LUMEN]) await rows().filter({ hasText: name }).locator('input[type=checkbox]').check();
  await page.locator('[data-action="batch-more"]').click();
  await page.locator('.popover [data-action="batch-merge"]').click();
  await page.locator('#merge-form').waitFor();
  await page.locator(`#merge-form input[name="primary"][value="${MAPLE}"]`).check();
  await page.screenshot(shot('roles-merge-locked'));
  await page.locator('button[type=submit][form="merge-form"]').click();
  await page.locator('#merge-form').waitFor({ state: 'detached' });
  await settle(800);
  const data = await app.readData();
  assert.equal(data.customers[LUMEN], undefined, 'the merged customer is gone');
  const kept = data.customers[MAPLE];
  assert.equal(kept.website, 'lumen.example', 'read-only website filled from the merged customer');
  assert.match(kept.note, /只给老板看的备注/, 'hidden note kept');
  const greta = (kept.extraContacts || []).find((c) => c.contact === 'Greta Vogel');
  assert.ok(greta, 'the merged contact is kept');
  assert.equal(greta.email, 'greta@lumenlash.example', 'hidden email kept');
  assert.equal(greta.phone, '+49 30 5550 0144', 'read-only phone kept');
  assert.ok(kept.emails.includes('greta@lumenlash.example'));
  assert.deepEqual(app.errors, []);
});

test('as 业务: renaming a customer group in 客户设置 renames it on the customers too', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').click();
  await page.locator('.cs-page').waitFor();
  await page.locator('[data-cs-tab="groups"]').click();
  await page.locator('[data-cs-panel="groups"]').waitFor();
  await page.locator('.cs-group > .cs-row', { hasText: '老客户组' }).getByRole('button', { name: '编辑' }).click();
  await page.locator('#cs-group-form input[name=name]').fill('重点老客户');
  await page.locator('button[type=submit][form="cs-group-form"]').click();
  await page.locator('.cs-group', { hasText: '重点老客户' }).waitFor();
  await settle(600);
  const data = await app.readData();
  assert.equal(data.customers[MAPLE].previewGroup, '重点老客户');
  assert.equal(R.isAdmin(data), false, 'still the 业务 account');
  assert.deepEqual(app.errors, []);
});
