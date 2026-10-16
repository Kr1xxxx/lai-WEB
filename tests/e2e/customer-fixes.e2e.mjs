// Customer page fixes (batch C2) in the real page with the real backend:
// leftover follow-up drafts, stage and 是/否 filters, batch-create 完成, tag permissions and tag-manager scope,
// merge and mail entries on the detail page, and the 商机和订单 tab.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
const ME = 'Northwind Lash Studio';
const OTHER = 'Bluebell Beauty Supply';
const OWNERS = { [ME]: 'Kris', [OTHER]: 'Kris', 'Maple & Moss Cosmetics': 'Amy', 'Lumen Lash Lab': 'Amy' };

before(async () => {
  app = await startApp();
  await app.open('customers');
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  for (const [name, owner] of Object.entries(OWNERS)) state.data.customers[name].owner = owner;
  Object.assign(state.data.customers[ME], { customerStage: '未成单', previewFollowed: true, tags: ['VIP', 'KrisOnly'] });
  Object.assign(state.data.customers['Maple & Moss Cosmetics'], { tags: ['VIP'] });
  state.data.laiOpportunities = [
    { id: 'opp1', number: 'OPP-1', name: 'Spring restock', client: ME, amount: 5000, currency: 'USD', stage: 'open', owner: 'Kris', endDate: '2026-12-01', createdAt: '2026-10-01T04:00:00.000Z' },
    { id: 'opp2', number: 'OPP-2', name: 'Autumn deal', client: ME, amount: 800, currency: 'USD', stage: 'done', owner: 'Kris', endDate: '2026-09-01', createdAt: '2026-08-01T04:00:00.000Z', closedAt: '2026-09-01T04:00:00.000Z' },
  ];
  state.data.orders = [...(state.data.orders || []), { id: 'ord-fix-1', num: 'L-2610-901', client: ME, owner: 'Kris', amount: 100, currency: 'USD', stage: 'quote', createdAt: '2026-10-01', orderMonth: '2026-10' }];
  state.data.laiSettings = {
    ...(state.data.laiSettings || {}), defaultOwner: 'Kris',
    roles: {
      roles: [{ id: 'viewer', name: '只读', scope: 'all', perms: { 'customer.view': true } }],
      members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }, { id: 'm-vic', name: 'Vic', roleId: 'viewer' }],
      current: 'm-kris',
    },
  };
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

// The test backend has no mailbox bound, so the mail poll answers 409; that is not what these tests are about.
const pageErrors = () => app.errors.filter((e) => !/HTTP 409: .*\/api\/mail\//.test(e));
const settle = (ms = 400) => app.page.waitForTimeout(ms);
const rows = () => app.page.locator('tbody tr');
const names = async () => (await rows().locator('.company-link').allInnerTexts()).sort();
// The page replaces native selects with its own menu; set the hidden native one and fire the change the page listens to.
const setSelect = (selector, value) => app.page.evaluate(([sel, val]) => {
  const el = document.querySelector(sel);
  el.value = val;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [selector, value]);
const openCustomer = async (name) => {
  const url = new URL(app.page.url());
  url.searchParams.set('customer', name);
  url.hash = 'customers';
  await app.page.goto(url.toString());
  await app.page.waitForLoadState('networkidle');
  await app.page.locator('.lcd-root').waitFor();
};
const switchTo = async (label) => {
  await app.page.locator('[data-action="profile-menu"]').click();
  await app.page.locator('.popover.account-menu [data-lai-switch-member]', { hasText: label }).click();
  await app.page.locator('#toast.show', { hasText: '已切换到' }).waitFor();
  await settle();
};

test('a follow-up draft left on another customer does not block leaving; the open page still does', async () => {
  const { page } = app;
  await openCustomer(OTHER);
  await page.locator('.lcd-tabs [data-tab="activity"]').click();
  await page.locator('#followup-text').fill('half written note');
  // Draft on the page that is open: the guard says no.
  assert.equal(await page.evaluate(() => window.flushPendingSave()), false);
  await page.locator('#toast.show', { hasText: '请先保存或取消' }).waitFor();
  // Back to the list (the draft stays in memory, silently): nothing blocks any more.
  await page.locator('[data-action="list"]').click();
  await rows().first().waitFor();
  assert.equal(await page.evaluate(() => window.flushPendingSave()), true);
  // Another customer's page is not blocked by the first one's draft either.
  await page.locator('.company-link', { hasText: ME }).first().click();
  await page.locator('.lcd-root').waitFor();
  assert.equal(await page.evaluate(() => window.flushPendingSave()), true);
  assert.deepEqual(pageErrors(), []);
});

test('the stage filter offers the 客户设置 stages and matches a manual stage', async () => {
  const { page } = app;
  await app.open('customers');
  await rows().first().waitFor();
  await page.locator('[data-action="filter"]').first().click();
  const options = await page.locator('#filter-form select[name="stage"] option').evaluateAll((list) => list.map((o) => o.textContent.trim()));
  for (const label of ['未成单', '付款未到账', '待付尾款.', '已完成', '输单', '已成交', '未成交']) assert.ok(options.includes(label), label + ' in ' + options);
  await setSelect('#filter-form select[name="stage"]', '未成单');
  await page.locator('button[type="submit"][form="filter-form"]').click();
  await settle();
  assert.deepEqual(await names(), [ME]);
  await page.locator('[data-action="reset-all"]').click();
  await settle();
  assert.equal(await rows().count(), 4);
});

test('是否关注 uses a 是/否 select in the quick filter and the advanced filter, and × clears the filter', async () => {
  const { page } = app;
  await app.open('customers');
  await rows().first().waitFor();
  await setSelect('#search-field', 'followed');
  await settle();
  assert.equal(await page.locator('#search').evaluate((el) => el.tagName), 'SELECT');
  assert.deepEqual(await page.locator('#search option').evaluateAll((list) => list.map((o) => o.textContent.trim())), ['请选择', '是', '否']);
  await setSelect('#search', 'true');
  await settle();
  assert.deepEqual(await names(), [ME]);
  await page.locator('[data-action="clear-query"]').click();
  await settle();
  assert.equal(await rows().count(), 4, 'clearing the value shows the whole list again');
  assert.equal(await page.locator('[data-action="clear-query"]').count(), 0);
  // Advanced filter: choosing the boolean field turns the value into a select.
  await page.locator('[data-action="filter"]').first().click();
  await page.locator('[data-filter-mode="advanced"]').click();
  await setSelect('[data-advanced-prop="field"]', 'followed');
  await settle();
  assert.equal(await page.locator('[data-advanced-prop="value"]').evaluate((el) => el.tagName), 'SELECT');
  assert.deepEqual(await page.locator('[data-advanced-prop="value"] option').evaluateAll((list) => list.map((o) => o.textContent.trim())), ['是', '否']);
  await page.locator('button[type="submit"][form="filter-form"]').click();
  await settle();
  assert.deepEqual(await names(), [ME]);
  await page.locator('[data-action="reset-all"]').click();
  await settle();
  assert.deepEqual(pageErrors(), []);
});

test('batch create: 完成 closes the dialog after a successful run', async () => {
  const { page } = app;
  await app.open('customers');
  await rows().first().waitFor();
  await page.locator('[data-action="create-menu"]').click();
  await page.locator('.popover [data-action="batch-create"]').click();
  await page.locator('#batch-create-form textarea[name="text"]').fill('Zeta Trading Ltd，Zed，zed@zeta.test，+1 555 0100，美国');
  await page.locator('button[form="batch-create-form"]').click();
  const done = page.locator('.drawer-footer button.primary, .drawer button.primary', { hasText: '完成' });
  await done.waitFor();
  await done.click();
  await page.locator('.drawer').waitFor({ state: 'detached' });
  assert.ok(Object.keys((await app.readData()).customers).includes('Zeta Trading Ltd'));
  assert.deepEqual(pageErrors(), []);
});

test('tags: a role without edit rights gets no tag button; the tag manager only sees the account\'s own customers', async () => {
  const { page } = app;
  await app.open('customers');
  await switchTo('Vic');
  await openCustomer(ME);
  assert.equal(await page.locator('[data-action="customer-tags"]').count(), 0, 'no 设置客户标签 for a read-only role');
  assert.equal(await page.locator('[data-action="merge-customer"]').count(), 0);
  // Amy (业务) sees and may edit only her own customers.
  await switchTo('Amy');
  await app.open('customers');
  await rows().first().waitFor();
  await page.locator('[data-action="table-options"]').click();
  await page.locator('.popover [data-action="tag-manager"]').click();
  const manager = page.locator('.tag-manager');
  await manager.waitFor();
  const text = await manager.innerText();
  assert.match(text, /VIP/);
  assert.match(text, /1 位客户/, 'only Amy\'s own customer is counted');
  assert.doesNotMatch(text, /KrisOnly/);
  // Renaming changes her customer only; Kris's customer keeps the old tag.
  await manager.locator('[data-tag-rename="VIP"]').click();
  await manager.locator('.tag-rename-input').fill('Gold');
  await manager.locator('[data-tag-save]').click();
  await page.locator('#toast.show', { hasText: '已保存' }).waitFor();
  const data = await app.readData();
  assert.deepEqual(data.customers['Maple & Moss Cosmetics'].tags, ['Gold']);
  assert.deepEqual(data.customers[ME].tags, ['VIP', 'KrisOnly']);
  await page.locator('[data-action="close-modal"]').first().click();
  await switchTo('Kris');
  assert.deepEqual(pageErrors(), []);
});

test('设置中心 opens 客户设置 as a real page (address and highlight follow), and the tag manager stays open after an edit', async () => {
  const { page } = app;
  await app.open('settings-hub');
  await page.locator('button[data-lai-screen="customer-settings"]').click();
  await page.locator('.cs-panel').first().waitFor();
  assert.equal(new URL(page.url()).hash, '#customers');
  assert.equal((await page.locator('.subnav .nav-entry.active').innerText()).trim(), '客户设置');
  // The tag manager opened from 客户设置 survives the page redraw after a rename.
  await page.locator('[data-action="tag-manager"]').first().click();
  const manager = page.locator('.tag-manager');
  await manager.waitFor();
  await manager.locator('[data-tag-rename="KrisOnly"]').click();
  await manager.locator('.tag-rename-input').fill('KrisRenamed');
  await manager.locator('[data-tag-save]').click();
  await page.locator('#toast.show', { hasText: '已保存' }).waitFor();
  await settle();
  assert.equal(await page.locator('.tag-manager').count(), 1, 'the dialog is still open');
  assert.match(await page.locator('.tag-manager').innerText(), /KrisRenamed/);
  assert.deepEqual((await app.readData()).customers[ME].tags, ['VIP', 'KrisRenamed']);
  await page.locator('[data-action="close-modal"]').first().click();
  assert.deepEqual(pageErrors(), []);
});

test('opening an order from a customer\'s detail and closing it brings you back to that customer', async () => {
  const { page } = app;
  await openCustomer(ME);
  await page.locator('.lcd-side [data-lai-order="ord-fix-1"]').click();
  await page.locator('[data-biz-action="close-editor"]').first().click();
  await page.locator('.lcd-root').waitFor();
  assert.match(await page.locator('.lcd-root h2').first().innerText(), new RegExp(ME.split(' ')[0]));
  assert.deepEqual(pageErrors(), []);
});

test('detail: 商机和订单 lists the customer\'s real opportunities and has no 回款, 产品 or AI entries', async () => {
  const { page } = app;
  await openCustomer(ME);
  assert.equal(await page.locator('.lcd-tabs [data-tab="trade"]').innerText(), '商机和订单');
  for (const gone of ['Tips', 'AI 背调', '数据分析']) assert.equal(await page.locator('.lcd-tabs').getByText(gone, { exact: true }).count(), 0, gone);
  await page.locator('.lcd-tabs [data-tab="trade"]').click();
  const body = page.locator('.lcd-body-trade');
  await body.waitFor();
  const table = body.locator('.lcd-opportunity-table');
  const text = await table.innerText();
  assert.match(text, /Spring restock/);
  assert.match(text, /Autumn deal/);
  assert.match(text, /OPP-1/);
  const all = await body.innerText();
  assert.match(all, /共 2 条/);
  assert.doesNotMatch(all, /回款|成交的产品|关联产品/);
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/detail-trade.png` : undefined });
  assert.deepEqual(pageErrors(), []);
});

test('detail: 合并客户 picks other customers and merges; 写邮件 on the contact card opens the mail flow', async () => {
  const { page } = app;
  await openCustomer(ME);
  // Contact card mail button reacts (this test backend has no mailbox bound, so it says so instead of doing nothing).
  await page.locator('.lcd-contact [data-feature="写邮件"]').first().click();
  await page.locator('#toast.show, .drawer, .mail-compose').first().waitFor();
  await page.keyboard.press('Escape');
  await openCustomer(ME);
  await page.locator('[data-action="merge-customer"]').click();
  await page.locator('#merge-pick-form').waitFor();
  // Nothing picked: stays on the picker with a message.
  await page.locator('button[form="merge-pick-form"]').click();
  await page.locator('#workspace-error.visible').waitFor();
  await page.locator('#merge-pick-search').fill('Bluebell');
  await page.locator('#merge-pick-list label', { hasText: OTHER }).locator('input').check();
  await page.locator('button[form="merge-pick-form"]').click();
  await page.locator('#merge-form').waitFor();
  assert.match(await page.locator('#merge-form').innerText(), new RegExp(OTHER));
  await page.locator('button[form="merge-form"]').click();
  await page.locator('#toast.show', { hasText: '已保存' }).waitFor();
  const customers = (await app.readData()).customers;
  assert.ok(!customers[OTHER] || !customers[ME], 'one of the two customers was merged into the other');
  assert.deepEqual(pageErrors(), []);
});
