// 企业管理 → 角色权限 and 成员管理 in the real page with the real backend: the role list, the edit view, adding a
// role, adding a test account, switching to it, and the no-permission notice. Data must survive a reload.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const stored = async () => (await app.readData()).laiSettings?.roles || {};
const openPage = async (label) => {
  const { page } = app;
  // 企业管理 has no page of its own: hover the rail icon and pick the entry from the flyout.
  await page.locator('.rail-item[data-rail-menu="企业管理"]').hover();
  await page.locator(`.rail-flyout-item[data-flyout-target="${label === '角色权限' ? 'roles' : 'members'}"]`).click();
  await page.locator('.business-title h1').waitFor();
};
const rowOf = (name) => app.page.locator('[data-role-row]', { has: app.page.locator(`b:text-is("${name}")`) });

test('角色权限 lists 系统管理员 (view only) and 业务', async () => {
  const { page } = app;
  await openPage('角色权限');
  assert.equal(await page.locator('.business-title h1').innerText(), '角色权限');
  assert.deepEqual(await page.locator('.role-table thead th').allInnerTexts(), ['角色', '可见范围', '成员', '操作']);
  assert.deepEqual(await rowOf('系统管理员').locator('.role-actions button').allInnerTexts(), ['查看']);
  assert.equal(await rowOf('系统管理员').locator('.role-actions button').getAttribute('title'), '不可编辑，仅查看');
  assert.deepEqual(await rowOf('业务').locator('.role-actions button').allInnerTexts(), ['编辑']);
  assert.deepEqual(await rowOf('部门管理员').locator('.role-actions button').allInnerTexts(), ['编辑']);
  assert.equal(await rowOf('部门管理员').locator('.role-members-empty').innerText(), '暂无成员');
  assert.equal(await rowOf('业务').locator('.role-members button').innerText(), '编辑成员');
  assert.ok((await rowOf('业务').locator('.role-avatar').count()) >= 1);
  await page.screenshot({ path: process.env.ROLE_SHOTS ? `${process.env.ROLE_SHOTS}/roles-list.png` : undefined, type: 'png' }).catch(() => {});
});

test('系统管理员 opens read-only', async () => {
  const { page } = app;
  await rowOf('系统管理员').locator('.role-actions button').click();
  await page.locator('#role-edit-form').waitFor();
  assert.ok((await page.locator('.role-lock-note').innerText()).includes('系统管理员不可编辑，仅查看'));
  assert.equal(await page.locator('#role-edit-form button[type=submit]').count(), 0);
  assert.equal(await page.locator('input[name=perm]:not(:checked)').count(), 0);
  assert.equal(await page.locator('input[name=perm]:not(:disabled)').count(), 0);
  await page.locator('[data-role-action="back"]').click();
  await page.locator('.role-table').waitFor();
});

test('edit 业务: 全选 follows the items, saving keeps 线索·删除 after a reload', async () => {
  const { page } = app;
  await rowOf('业务').locator('.role-actions button', { hasText: '编辑' }).click();
  await page.locator('#role-edit-form').waitFor();
  const leadGroup = page.locator('[data-role-group]', { has: page.locator('.role-group-name:text-is("线索")') });
  const del = leadGroup.locator('input[value="lead.delete"]');
  assert.equal(await del.isChecked(), false);
  assert.equal(await leadGroup.locator('[data-role-all]').isChecked(), false);
  await del.check();
  // 彻底删除（回收站） is a separate permission now, so 全选 turns on only after it is ticked too.
  assert.equal(await leadGroup.locator('[data-role-all]').isChecked(), false);
  await leadGroup.locator('input[value="lead.purge"]').check();
  // 导出线索 is another permission of the group (admin only by default), so it has to be ticked as well.
  assert.equal(await leadGroup.locator('[data-role-all]').isChecked(), false);
  await leadGroup.locator('input[value="lead.export"]').check();
  assert.equal(await leadGroup.locator('[data-role-all]').isChecked(), true, 'the last item turns 全选 on');
  await page.locator('#role-scope').selectOption('all');
  await page.locator('#role-edit-form button[type=submit]').click();
  await page.locator('.role-table').waitFor();
  await settle();
  const sales = (await stored()).roles.find((role) => role.id === 'sales');
  assert.equal(sales.perms['lead.delete'], true);
  assert.equal(sales.scope, 'all');
  await app.open('customers');
  await openPage('角色权限');
  assert.equal(await rowOf('业务').locator('td').nth(1).innerText(), '全公司');
  await rowOf('业务').locator('.role-actions button', { hasText: '编辑' }).click();
  await page.locator('#role-edit-form').waitFor();
  assert.equal(await page.locator('input[value="lead.delete"]').isChecked(), true);
  // 全选 on a whole group, then back to the list without saving: nothing is stored.
  await page.locator('[data-role-group]', { has: page.locator('.role-group-name:text-is("产品")') }).locator('[data-role-all]').check();
  assert.equal(await page.locator('input[value="product.delete"]').isChecked(), true);
  await page.screenshot({ path: process.env.ROLE_SHOTS ? `${process.env.ROLE_SHOTS}/roles-edit.png` : undefined, type: 'png' }).catch(() => {});
  await page.locator('[data-role-action="back"]').click();
  await page.locator('.role-table').waitFor();
  await settle();
  assert.equal((await stored()).roles.find((role) => role.id === 'sales').perms['product.delete'], undefined);
});

test('a role name that is already taken shows an error under the form', async () => {
  const { page } = app;
  await rowOf('业务').locator('.role-actions button', { hasText: '编辑' }).click();
  await page.locator('#role-edit-form').waitFor();
  await page.locator('#role-edit-form input[name=name]').fill('系统管理员');
  await page.locator('#role-edit-form button[type=submit]').click();
  await settle();
  assert.equal(await page.locator('#role-error').innerText(), '已有同名角色');
  await page.locator('[data-role-action="back"]').click();
  await page.locator('.role-table').waitFor();
});

test('新增角色 "经理" copies 业务 and opens its edit view; it can be deleted with two clicks', async () => {
  const { page } = app;
  await page.locator('[data-role-action="add"]').click();
  await page.locator('#role-add-form').waitFor();
  await page.locator('button[form="role-add-form"]').click();
  await settle();
  assert.equal(await page.locator('#role-add-error').innerText(), '请填写角色名称');
  await page.locator('#role-add-form input[name=name]').fill('经理');
  await page.locator('button[form="role-add-form"]').click();
  await page.locator('#role-edit-form').waitFor();
  assert.equal(await page.locator('#role-edit-form input[name=name]').inputValue(), '经理');
  assert.equal(await page.locator('input[value="lead.delete"]').isChecked(), true, 'copied from 业务');
  await page.locator('[data-role-action="back"]').click();
  await rowOf('经理').waitFor();
  assert.ok((await stored()).roles.some((role) => role.name === '经理'));
  await rowOf('经理').locator('button', { hasText: '删除' }).click();
  assert.equal(await rowOf('经理').locator('button').last().innerText(), '确定删除');
  await rowOf('经理').locator('button').last().click();
  await settle();
  assert.equal(await rowOf('经理').count(), 0);
  // keep one 经理 for the later steps
  await page.locator('[data-role-action="add"]').click();
  await page.locator('#role-add-form input[name=name]').fill('经理');
  await page.locator('button[form="role-add-form"]').click();
  await page.locator('#role-edit-form').waitFor();
  await page.locator('[data-role-action="back"]').click();
  await rowOf('经理').waitFor();
});

test('成员管理: add Bob as 业务, switch to Bob, and he lands on 工作台 without 企业管理', async () => {
  const { page } = app;
  await openPage('成员管理');
  assert.equal(await page.locator('.business-title h1').innerText(), '成员管理');
  assert.ok((await page.locator('.role-note').innerText()).includes('不是安全措施'));
  assert.equal(await page.locator('[data-member-row]:has-text("当前使用")').count(), 1);
  await page.locator('[data-role-action="member-add"]').click();
  await page.locator('#member-add-form').waitFor();
  await page.locator('#member-add-form input[name=name]').fill('Bob');
  await page.locator('button[form="member-add-form"]').click();
  await page.locator('[data-member-row]', { hasText: 'Bob' }).waitFor();
  assert.ok((await stored()).members.some((member) => member.name === 'Bob' && member.roleId === 'sales'));
  // a role change in the table is saved at once
  const bob = page.locator('[data-member-row]', { hasText: 'Bob' });
  await bob.locator('select[data-role-member-role]').selectOption({ label: '经理' });
  await settle();
  assert.notEqual((await stored()).members.find((member) => member.name === 'Bob').roleId, 'sales');
  await bob.locator('select[data-role-member-role]').selectOption({ label: '业务' });
  await settle();
  assert.equal((await stored()).members.find((member) => member.name === 'Bob').roleId, 'sales');
  // rename the account and back
  await bob.locator('button', { hasText: '改名' }).click();
  await page.locator('#member-rename-form').waitFor();
  await page.locator('#member-rename-form input[name=name]').fill('Bobby');
  await page.locator('button[form="member-rename-form"]').click();
  await page.locator('[data-member-row]', { hasText: 'Bobby' }).waitFor();
  await page.locator('[data-member-row]', { hasText: 'Bobby' }).locator('button', { hasText: '改名' }).click();
  await page.locator('#member-rename-form input[name=name]').fill('Bob');
  await page.locator('button[form="member-rename-form"]').click();
  await bob.waitFor();
  // switch
  await bob.locator('button', { hasText: '切换到此账号' }).click();
  // Bob (业务) cannot open 成员管理: like the avatar menu, the switch lands on 工作台 and 企业管理 disappears.
  await page.locator('.avatar[data-action="profile-menu"][aria-label*="Bob"]').waitFor();
  assert.equal(await page.locator('.rail-item[data-rail-menu="企业管理"]').count(), 0);
  assert.equal(await page.locator('.role-table').count(), 0);
  const roles = await stored();
  assert.equal(roles.members.find((member) => member.id === roles.current).name, 'Bob');
  await page.screenshot({ path: process.env.ROLE_SHOTS ? `${process.env.ROLE_SHOTS}/roles-denied.png` : undefined, type: 'png' }).catch(() => {});
});

test('after a reload Bob is still the account and 企业管理 is hidden from him', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.avatar[data-action="profile-menu"]').waitFor();
  assert.match(await page.locator('.avatar[data-action="profile-menu"]').getAttribute('aria-label'), /Bob/);
  assert.equal(await page.locator('.rail-item[data-rail-menu="企业管理"]').count(), 0);
  const roles = await stored();
  assert.equal(roles.members.find((member) => member.id === roles.current).name, 'Bob');
  assert.ok(roles.roles.some((role) => role.name === '经理'));
});

test('no page errors in the whole run', () => {
  // Switching to Bob lands on 工作台, which asks for unread mail; with no mailbox bound the backend answers 409, which is expected.
  assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/messages')), []);
});
