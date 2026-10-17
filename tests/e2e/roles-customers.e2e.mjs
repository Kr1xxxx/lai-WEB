// 角色权限和测试账号 in the real page with the real backend: the avatar menu switches accounts, the customer
// list/detail follow the account's scope, and buttons the role lacks are gone. The account is saved, so a reload keeps it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
const OWNERS = { 'Northwind Lash Studio': 'Kris', 'Bluebell Beauty Supply': 'Kris', 'Maple & Moss Cosmetics': 'Amy', 'Lumen Lash Lab': 'Amy' };

before(async () => {
  app = await startApp();
  await app.open('customers');
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  for (const [name, owner] of Object.entries(OWNERS)) state.data.customers[name].owner = owner;
  // Two test accounts, saved explicitly (Kris is the administrator, Amy has the default 业务 role).
  state.data.laiSettings = { ...(state.data.laiSettings || {}), defaultOwner: 'Kris', roles: { roles: [], members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current: 'm-kris' } };
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const rows = () => app.page.locator('tbody tr');
const avatar = () => app.page.locator('[data-action="profile-menu"]');
const menu = () => app.page.locator('.popover.account-menu');
const openMenu = async () => { await avatar().click(); await menu().waitFor(); };
const names = async () => (await rows().locator('.company-link').allInnerTexts()).sort();
const current = async () => { const roles = (await app.readData()).laiSettings?.roles; return roles?.members.find((m) => m.id === roles.current)?.name; };
const switchTo = async (label) => {
  await openMenu();
  await menu().locator('[data-lai-switch-member]', { hasText: label }).click();
  await app.page.locator('#toast.show', { hasText: '已切换到' }).waitFor();
  await settle();
};
const gotoCustomer = async (name, hash = 'customers') => {
  const url = new URL(app.page.url());
  url.searchParams.set('customer', name);
  url.hash = hash;
  await app.page.goto(url.toString());
  await app.page.waitForLoadState('networkidle');
};

test('the administrator sees every customer and the whole avatar menu', async () => {
  await rows().first().waitFor();
  assert.equal(await rows().count(), 4);
  assert.equal(await avatar().getAttribute('title'), '当前账号：Kris');
  await openMenu();
  assert.equal((await menu().locator('.account-head').innerText()).trim(), 'Kris · 系统管理员');
  assert.deepEqual(await menu().locator('[data-lai-switch-member]').allInnerTexts(), ['Amy · 业务']);
  for (const label of ['来财设置', '角色权限', '成员管理', '关于来财']) await menu().getByRole('button', { name: label }).waitFor();
  await app.page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/shell-menu-admin.png` : undefined });
  await app.page.keyboard.press('Escape');
  // 客户设置 is offered, and so are the trash and merge actions.
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').waitFor();
  await rows().first().locator('input[type=checkbox]').check();
  await app.page.locator('[data-action="batch-more"]').click();
  await app.page.locator('.popover [data-action="batch-trash"]').waitFor();
  await app.page.locator('.popover [data-action="batch-merge"]').waitFor();
  assert.deepEqual(app.errors, []);
});

test('switching to the 业务 account shows only that account\'s customers and removes actions it may not use', async () => {
  const { page } = app;
  await app.open('customers');
  await switchTo('Amy');
  assert.equal(await avatar().getAttribute('title'), '当前账号：Amy');
  assert.deepEqual(await names(), ['Lumen Lash Lab', 'Maple & Moss Cosmetics']);
  assert.equal(await current(), 'Amy', 'the choice is saved');
  // The menu now names Amy and offers going back, but not the role pages.
  await openMenu();
  assert.equal((await menu().locator('.account-head').innerText()).trim(), 'Amy · 业务');
  assert.deepEqual(await menu().locator('[data-lai-switch-member]').allInnerTexts(), ['Kris · 系统管理员']);
  assert.equal(await menu().getByRole('button', { name: '角色权限' }).count(), 0);
  assert.equal(await menu().getByRole('button', { name: '成员管理' }).count(), 0);
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/shell-menu-amy.png` : undefined });
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 500);
  // 客户设置 is offered because 业务 holds 来源设置 (it then shows only that tab); the other customer pages still are.
  assert.equal(await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').count(), 1);
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("公海客户"))').waitFor();
  // The 企业管理 menu has nothing for this role, so it is not in the left rail.
  assert.equal(await page.locator('.rail-item[data-rail-menu="企业管理"]').count(), 0);
  await page.locator('.rail-item[data-rail-menu="客户"]').waitFor();
  // Batch actions: no trash, but moving to the pool and merging are kept.
  await rows().first().locator('input[type=checkbox]').check();
  await page.locator('[data-action="batch-more"]').click();
  await page.locator('.popover [data-action="batch-pool"]').waitFor();
  assert.equal(await page.locator('.popover [data-action="batch-trash"]').count(), 0);
  assert.equal(await page.locator('.popover [data-action="batch-clear-owner"]').count(), 0, '移除跟进人 is not in the 业务 role');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/shell-list-amy.png` : undefined });
  assert.deepEqual(app.errors, []);
});

test('the chosen account survives a reload, and a customer of someone else cannot be opened', async () => {
  const { page } = app;
  await page.reload();
  await page.waitForLoadState('networkidle');
  await rows().first().waitFor();
  assert.equal(await avatar().getAttribute('title'), '当前账号：Amy');
  assert.deepEqual(await names(), ['Lumen Lash Lab', 'Maple & Moss Cosmetics']);
  // Searching for the other account's customer finds nothing.
  const box = page.getByPlaceholder('请输入').first();
  await box.fill('Northwind');
  await box.press('Enter');
  await settle();
  assert.equal(await rows().count(), 0);
  await box.fill('');
  await box.press('Enter');
  await settle();
  // Opening that customer directly shows a notice instead of the detail.
  await gotoCustomer('Northwind Lash Studio');
  await page.getByText('这位客户不在你名下').waitFor();
  assert.equal(await page.locator('.lcd-root').count(), 0);
  // The role pages show why they cannot be opened.
  const url = new URL(page.url());
  url.hash = 'roles';
  url.searchParams.delete('customer');
  await page.goto(url.toString());
  await page.waitForLoadState('networkidle');
  await page.getByText('你的角色没有“设置管理·角色权限和成员管理”权限').waitFor();
  assert.deepEqual(app.errors, []);
});

test('a customer created by the 业务 account belongs to that account', async () => {
  const { page } = app;
  await app.open('customers');
  await page.getByRole('button', { name: '新建客户' }).first().click();
  assert.equal(await page.locator('#ce-owner').inputValue(), 'Amy', 'the owner starts as the current account');
  assert.equal(await page.locator('#ce-owner').getAttribute('readonly'), '', 'and a role without 重新分配 cannot change it');
  await page.locator('#ce-name').fill('Amy Test Beauty');
  await page.locator('#ce-country').fill('美国');
  await page.getByRole('option', { name: '美国', exact: true }).click();
  await page.locator('#ce-source').fill('官网');
  await page.keyboard.press('Enter');
  await page.locator('#ce-contact-0').fill('Iris Monroe');
  await page.locator('#ce-email-0').fill('iris@amytest.example');
  await page.locator('#ce-phone-0').fill('2125550199');
  await page.getByRole('button', { name: '确 定' }).click();
  await settle(1000);
  assert.equal((await app.readData()).customers['Amy Test Beauty'].owner, 'Amy');
  await page.reload();
  await page.getByText('Amy Test Beauty').first().waitFor();
  assert.equal(await rows().count(), 3);
  await rows().filter({ hasText: 'Amy Test Beauty' }).locator('.company-link').click();
  await page.locator('.lcd-root').waitFor();
  assert.equal(await page.locator('.lcd-root [data-action="edit"]').first().count(), 1, 'editing is allowed in the 业务 role');
  assert.deepEqual(app.errors, []);
});

test('switching back to the administrator restores everything', async () => {
  const { page } = app;
  await app.open('customers');
  await switchTo('Kris');
  assert.equal(await avatar().getAttribute('title'), '当前账号：Kris');
  assert.equal(await rows().count(), 5);
  assert.equal(await current(), 'Kris');
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').waitFor();
  await page.locator('.rail-item[data-rail-menu="企业管理"]').waitFor();
  assert.deepEqual(app.errors, []);
});

test('switching account while on a page the new account cannot open goes to the dashboard', async () => {
  const { page } = app;
  await app.open('customers');
  await openMenu();
  await menu().getByRole('button', { name: '角色权限' }).click();
  await page.waitForFunction(() => location.hash === '#roles');
  await openMenu();
  await menu().locator('[data-lai-switch-member]', { hasText: 'Amy' }).click();
  await page.locator('#toast.show', { hasText: '已切换到 Amy' }).waitFor();
  await settle();
  assert.equal(await page.evaluate(() => location.hash), '#dashboard');
  assert.equal(await page.locator('.rail-item[data-rail-menu="工作台"].active').count(), 1, 'the dashboard is shown');
  await switchTo('Kris');
  // The dashboard asks for unread mail; with no mailbox bound the backend answers 409, which is expected.
  assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/messages')), []);
});
