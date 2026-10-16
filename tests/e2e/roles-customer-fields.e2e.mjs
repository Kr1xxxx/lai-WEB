// 字段权限 and 本部门 for customers, in the real page with the real backend: the 业务 role gets some customer fields hidden
// or read-only; the list columns, filters, search, detail and editor follow, and saving keeps the locked values.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const R = require('../../src/role-model.js');

let app;
const MAPLE = 'Maple & Moss Cosmetics';
const shot = (name) => (process.env.SHOT_DIR ? { path: `${process.env.SHOT_DIR}/${name}.png` } : undefined);

before(async () => {
  app = await startApp();
  await app.open('customers');
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  const data = state.data;
  for (const [name, owner] of Object.entries({ 'Northwind Lash Studio': 'Kris', 'Bluebell Beauty Supply': 'Cat', [MAPLE]: 'Amy', 'Lumen Lash Lab': 'Bob' })) data.customers[name].owner = owner;
  Object.assign(data.customers[MAPLE], {
    website: 'maple.example', note: '价格敏感', tags: ['VIP'], customerStars: '4', email: 'iris@maple.example', phone: '2125550101', phones: ['2125550101', '2125550102'],
    emails: ['iris@maple.example', 'leo@maple.example'], contact: 'Iris', contacts: ['Iris', 'Leo'],
    extraContacts: [{ id: 'x1', contact: 'Leo', email: 'leo@maple.example', phone: '2125550102', contactNote: '二号联系人备注' }],
  });
  // Kris = administrator; Amy = 业务 (some fields locked); Bob = 部门管理员 in 销售部 with Amy; Cat = 业务 in 二组.
  let settings = { ...(data.laiSettings || {}), defaultOwner: 'Kris' };
  let next = { ...data, laiSettings: settings };
  // Bob, Cat and Amy are the customers' owners, so the page already lists them as 业务 test accounts.
  next = R.setMemberRole(next, R.settings(next).members.find((m) => m.name === 'Bob').id, R.DEPT_ADMIN);
  next = R.addDepartment(next, { name: '销售部' });
  next = R.addDepartment(next, { name: '二组' });
  const id = (name) => R.settings(next).members.find((m) => m.name === name).id;
  const dept = (name) => R.deptTree(next).find((d) => d.name === name).id;
  next = R.setMemberDept(next, id('Amy'), dept('销售部'));
  next = R.setMemberDept(next, id('Bob'), dept('销售部'));
  next = R.setMemberDept(next, id('Cat'), dept('二组'));
  next = R.updateRole(next, 'sales', { fields: { customer: { 'contact.email': 'hidden', 'contact.phone': 'read', website: 'hidden', note: 'read', tags: 'read', customerStars: 'read', 'contact.contactNote': 'hidden' } } });
  state.data = next;
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const rows = () => app.page.locator('tbody tr');
const names = async () => (await rows().locator('.company-link').allInnerTexts()).sort();
const headers = async () => (await app.page.locator('thead .column-label').allInnerTexts());
const switchTo = async (label) => {
  await app.page.locator('[data-action="profile-menu"]').click();
  await app.page.locator('.popover.account-menu [data-lai-switch-member]', { hasText: label }).click();
  await app.page.locator('#toast.show', { hasText: '已切换到' }).waitFor();
  await settle();
};
const openCustomer = async (name) => {
  await rows().filter({ hasText: name }).locator('.company-link').click();
  await app.page.locator('.lcd-root').waitFor();
};
const stored = async () => (await app.readData()).customers[MAPLE];

test('the administrator sees every customer field in the list, the detail and the editor', async () => {
  const { page } = app;
  await rows().first().waitFor();
  const heads = await headers();
  for (const label of ['邮箱', '联系电话', '客户标签']) assert.ok(heads.includes(label), label);
  assert.equal(await page.locator('#search-field option[value="email"]').count(), 1);
  await openCustomer(MAPLE);
  await page.locator('.lcd-root').getByText('maple.example').first().waitFor();
  assert.ok((await page.locator('.lcd-root').innerText()).includes('iris@maple.example'));
  await page.locator('.lcd-root [data-action="edit"]').first().click();
  for (const selector of ['#ce-website', '#ce-note', '#ce-email-0', '#ce-phone-0', '#ce-contactNote-0']) assert.equal(await page.locator(selector).count(), 1, selector);
  assert.equal(await page.locator('[data-role-readonly]').count(), 0);
  assert.equal(await page.locator('#ce-note').isDisabled(), false);
  await page.keyboard.press('Escape');
  assert.deepEqual(app.errors, []);
});

test('as 业务: hidden fields leave the list, filters, search and column chooser; read-only ones stay', async () => {
  const { page } = app;
  await app.open('customers');
  await switchTo('Amy');
  await rows().first().waitFor();
  assert.deepEqual(await names(), [MAPLE], 'Amy only sees her own customer');
  const heads = await headers();
  assert.ok(!heads.includes('邮箱'));
  assert.ok(heads.includes('联系电话'), 'a read-only field is still shown');
  assert.ok(heads.includes('客户标签'));
  assert.ok(!(await rows().first().innerText()).includes('iris@maple.example'));
  // Quick filter: no 邮箱 / read-only tags stays.
  assert.equal(await page.locator('#search-field option[value="email"]').count(), 0);
  assert.equal(await page.locator('#search-field option[value="tag"]').count(), 1);
  // Global search by a hidden field finds nothing; "all" never matches it either.
  await page.locator('[data-action="global-search-scope"]').click();
  assert.equal(await page.locator('.global-search-scope-menu [data-global-field="email"]').count(), 0);
  assert.equal(await page.locator('.global-search-scope-menu [data-global-field="phone"]').count(), 1);
  await page.keyboard.press('Escape');
  const box = page.locator('.global-search input[name="query"]');
  await box.fill('iris@maple');
  await box.press('Enter');
  await settle();
  assert.equal(await rows().count(), 0, 'the hidden email cannot be searched');
  await box.fill('');
  await box.press('Enter');
  await settle();
  assert.equal(await rows().count(), 1);
  // Column chooser does not list the hidden columns.
  await page.locator('[data-action="table-options"]').click();
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('.columns-dialog').waitFor();
  assert.equal(await page.locator('.columns-dialog [data-column-toggle="email"]').count(), 0);
  assert.equal(await page.locator('.columns-dialog [data-column-toggle="phone"]').count(), 1);
  await page.locator('.columns-dialog [data-action="close-modal"]').first().click();
  // Filter dialog: no 邮箱 field.
  await page.locator('[data-action="filter"]').click();
  await page.locator('#filter-form').waitFor();
  assert.equal(await page.locator('#filter-form [name="email"]').count(), 0);
  assert.equal(await page.locator('#filter-form [name="name"]').count(), 1);
  await page.locator('[data-action="close-modal"]').first().click();
  assert.deepEqual(app.errors, []);
});

test('as 业务: the detail hides locked fields, read-only tags have no editor, and batch actions skip locked fields', async () => {
  const { page } = app;
  await openCustomer(MAPLE);
  const text = await page.locator('.lcd-root').innerText();
  for (const secret of ['maple.example', 'iris@maple.example', 'leo@maple.example', '二号联系人备注']) assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes('2125550101'), 'the read-only phone is shown');
  assert.ok(text.includes('VIP'), 'the read-only tags are shown');
  assert.equal(await page.locator('[data-action="customer-tags"]').count(), 0);
  await page.screenshot(shot('b2-detail-sales'));
  await page.locator('.lcd-root [data-action="list"]').first().click();
  await rows().first().waitFor();
  // Batch: tags are read-only, so there is no 设置标签; website is hidden so it is not offered in 编辑字段.
  await rows().first().locator('input[type=checkbox]').check();
  assert.equal(await page.locator('[data-action="batch-tags"]').count(), 0);
  await page.locator('[data-action="batch-edit-field"]').click();
  await page.locator('#batch-field-form').waitFor();
  const options = await page.locator('#batch-field-name option').allInnerTexts();
  assert.ok(!options.includes('公司网址'));
  assert.ok(!options.includes('客户星级'), 'read-only stars cannot be batch edited');
  assert.ok(options.includes('客户来源'));
  await page.locator('[data-action="close-modal"]').first().click();
  assert.deepEqual(app.errors, []);
});

test('as 业务: the editor hides and disables locked fields, and saving keeps every locked value', async () => {
  const { page } = app;
  await app.open('customers');
  await openCustomer(MAPLE);
  await page.locator('.lcd-root [data-action="edit"]').first().click();
  await page.locator('#customer-form').waitFor();
  for (const selector of ['#ce-website', '#ce-email-0', '#ce-emailExtra-1', '#ce-contactNote-0']) assert.equal(await page.locator(selector).count(), 0, selector);
  assert.equal(await page.locator('#ce-phone-0').isDisabled(), true);
  assert.equal(await page.locator('#ce-phoneExtra-1').isDisabled(), true);
  assert.equal(await page.locator('#ce-note').isDisabled(), true);
  assert.equal(await page.locator('#ce-contact-0').isDisabled(), false);
  assert.equal(await page.locator('#ce-productType').isDisabled(), false);
  await page.locator('.ce-company-extra summary').click();
  await page.locator('#ce-note').scrollIntoViewIfNeeded();
  await page.screenshot(shot('b2-editor-sales'));
  await page.locator('#ce-phone-0').scrollIntoViewIfNeeded();
  await page.screenshot(shot('b2-editor-sales-contacts'));
  await page.locator('#ce-contact-0').fill('Iris Monroe');
  await page.locator('#ce-contactExtra-1').fill('Leo Park');
  await page.getByRole('button', { name: '确 定', exact: true }).click();
  await settle(1000);
  const profile = await stored();
  assert.equal(profile.contact, 'Iris Monroe', 'unlocked fields change');
  assert.equal(profile.extraContacts[0].contact, 'Leo Park');
  assert.equal(profile.email, 'iris@maple.example');
  assert.equal(profile.website, 'maple.example');
  assert.equal(profile.phone, '2125550101');
  assert.equal(profile.note, '价格敏感');
  assert.deepEqual(profile.tags, ['VIP']);
  assert.equal(profile.customerStars, '4');
  assert.equal(profile.extraContacts[0].email, 'leo@maple.example');
  assert.equal(profile.extraContacts[0].phone, '2125550102');
  assert.equal(profile.extraContacts[0].contactNote, '二号联系人备注');
  assert.deepEqual(profile.emails, ['iris@maple.example', 'leo@maple.example']);
  assert.deepEqual(app.errors, []);
});

test('a tampered save from the 业务 account still cannot change locked fields (batch edit and tags)', async () => {
  const { page } = app;
  // Run the page's own batch path with a locked field name: the dialog refuses it, and the stored value stays.
  await app.open('customers');
  await rows().first().locator('input[type=checkbox]').check();
  await page.locator('[data-action="batch-edit-field"]').click();
  await page.locator('#batch-field-form').waitFor();
  await page.evaluate(() => {
    const select = document.querySelector('#batch-field-name');
    const option = document.createElement('option');
    option.value = 'website'; option.textContent = '公司网址（改装）';
    select.append(option);
    select.value = 'website';
  });
  await page.locator('#batch-field-value').fill('evil.example');
  await page.getByRole('button', { name: /应用到 1 位客户/ }).click();
  await page.locator('#workspace-error.visible').waitFor();
  assert.equal((await stored()).website, 'maple.example');
  await page.locator('[data-action="close-modal"]').first().click();
});

test('switching back to the administrator shows everything again', async () => {
  const { page } = app;
  await app.open('customers');
  await switchTo('Kris');
  assert.equal(await rows().count(), 4);
  assert.ok((await headers()).includes('邮箱'));
  await openCustomer(MAPLE);
  const text = await page.locator('.lcd-root').innerText();
  for (const shown of ['maple.example', 'iris@maple.example', 'leo@maple.example', '二号联系人备注']) assert.ok(text.includes(shown), shown);
  await page.locator('.lcd-root [data-action="edit"]').first().click();
  assert.equal(await page.locator('#ce-website').isDisabled(), false);
  assert.equal(await page.locator('#ce-email-0').inputValue(), 'iris@maple.example');
  await page.keyboard.press('Escape');
  assert.deepEqual(app.errors, []);
});

test('活动 without 跟进动态·查看: the detail shows a notice instead of the timeline', async () => {
  const { page } = app;
  const request = page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  state.data.customers[MAPLE].history = [{ type: 'followup', time: new Date().toISOString().slice(0, 19), text: '聊过交期', owner: 'Amy' }, ...(state.data.customers[MAPLE].history || [])];
  const sales = R.settings(state.data).roles.find((role) => role.id === 'sales');
  const perms = { ...sales.perms };
  delete perms['activity.view'];
  state.data = R.updateRole(state.data, 'sales', { perms });
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
  await openCustomer(MAPLE);
  await page.locator('.lcd-tabs button[data-tab="activity"]').click();
  await page.getByText('聊过交期').first().waitFor();
  await page.locator('.lcd-root [data-action="list"]').first().click();
  await rows().first().waitFor();
  await switchTo('Amy');
  await openCustomer(MAPLE);
  await page.locator('.lcd-tabs button[data-tab="activity"]').click();
  await page.locator('[data-activity-denied]').waitFor();
  assert.equal(await page.getByText('聊过交期').count(), 0);
  assert.equal(await page.locator('#followup-form').count(), 1, 'writing a follow-up is still there');
  assert.ok((await page.locator('[data-activity-denied]').innerText()).includes('你的角色没有“跟进动态·查看”权限'));
  assert.ok(!(await headers().catch(() => [])).includes('最近动态'));
  await switchTo('Kris');
  assert.deepEqual(app.errors, []);
});

test('本部门: a 部门管理员 sees the customers of the department and sub-departments only, and the team picker lists departments', async () => {
  const { page } = app;
  await app.open('customers');
  // Administrator: the picker lists departments and members, and choosing a department filters by its members.
  const picker = page.locator('#customer-owner');
  const labels = (await picker.locator('option').allInnerTexts()).map((text) => text.replace(/^[\s　▸]+/, ''));
  for (const label of ['销售部', '二组', 'Amy', 'Bob', 'Cat', 'Kris']) assert.ok(labels.includes(label), label);
  await picker.evaluate((el) => { el.value = [...el.options].find((o) => o.value.startsWith('dept:') && o.text.includes('销售部')).value; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
  assert.deepEqual(await names(), [MAPLE, 'Lumen Lash Lab'].sort(), 'Amy and Bob are in 销售部');
  await picker.evaluate((el) => { el.value = [...el.options].find((o) => o.value.startsWith('dept:') && o.text.includes('二组')).value; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
  assert.deepEqual(await names(), ['Bluebell Beauty Supply']);
  await picker.evaluate((el) => { el.value = 'Kris'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
  assert.deepEqual(await names(), ['Northwind Lash Studio']);
  // Bob (部门管理员, scope 本部门).
  await switchTo('Bob');
  assert.deepEqual(await names(), [MAPLE, 'Lumen Lash Lab'].sort());
  const bobLabels = (await page.locator('#customer-owner option').allInnerTexts()).map((text) => text.replace(/^[\s　▸]+/, ''));
  assert.ok(bobLabels.includes('销售部') && bobLabels.includes('Amy'));
  assert.ok(!bobLabels.includes('二组') && !bobLabels.includes('Cat') && !bobLabels.includes('Kris'), 'only people he can see');
  // Global search does not reach other departments.
  const box = page.locator('.global-search input[name="query"]');
  await box.fill('Northwind');
  await box.press('Enter');
  await settle();
  assert.equal(await rows().count(), 0);
  await box.fill('Maple');
  await box.press('Enter');
  await settle();
  assert.equal(await rows().count(), 1);
  await box.fill('');
  await box.press('Enter');
  await settle();
  // Opening a customer of another department directly shows the notice.
  const url = new URL(page.url());
  url.searchParams.set('customer', 'Northwind Lash Studio');
  url.hash = 'customers';
  await page.goto(url.toString());
  await page.waitForLoadState('networkidle');
  await page.getByText('这位客户不在你的部门').waitFor();
  assert.equal(await page.locator('.lcd-root').count(), 0);
  await app.open('customers');
  await switchTo('Kris');
  assert.deepEqual(app.errors, []);
});
