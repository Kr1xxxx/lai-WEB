// 企业管理 → 成员管理 (departments tree) and 角色权限 (部门管理员, 本部门, 字段权限, 布局权限) in the real page with the real
// backend. Field lists come from the other modules; if a module returns nothing yet, a fake list is registered so the
// dialog itself is always exercised. Data must survive a reload.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const stored = async () => (await app.readData()).laiSettings?.roles || {};
const shot = (name) => app.page.screenshot({ path: process.env.ROLE_SHOTS ? `${process.env.ROLE_SHOTS}/${name}.png` : undefined, type: 'png' }).catch(() => {});
const openPage = async (target) => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="企业管理"]').hover();
  await page.locator(`.rail-flyout-item[data-flyout-target="${target}"]`).click();
  await page.locator('.business-title h1').waitFor();
};
const node = (name) => app.page.locator('.role-dept-node', { has: app.page.locator(`.role-dept-name:text-is("${name}")`) });
const count = async (name) => Number(await node(name).locator('.role-dept-count').innerText());
const rows = async () => (await app.page.locator('[data-member-row] td:first-child b').allInnerTexts()).sort();
const memberRow = (name) => app.page.locator('[data-member-row]', { has: app.page.locator(`b:text-is("${name}")`) });
const roleRow = (name) => app.page.locator('[data-role-row]', { has: app.page.locator(`b:text-is("${name}")`) });
// Fake field lists, registered on every page load, for modules whose real list is empty in this build.
const FAKE = {
  lead: [{ key: 'phone', label: '电话' }, { key: 'email', label: '邮箱', group: '联系方式' }, { key: 'wechat', label: '微信', group: '联系方式' }],
  product: [{ key: 'cost', label: '成本价' }, { key: 'supplier', label: '供应商' }],
};
const ensureFields = () => app.page.evaluate((fake) => {
  const hosts = { lead: window.LaiLeadModel, product: window.LaiProductModel };
  for (const [module, rows] of Object.entries(fake)) {
    const host = hosts[module];
    let have = [];
    try { have = window.LaiRoleFields.list({}, module); } catch (error) { /* the module needs a real state */ }
    if (host && !have.length) try { host.roleFieldList = () => rows; } catch (error) { /* frozen */ }
  }
  return Object.fromEntries(Object.keys(fake).map((module) => [module, (window.LaiRoleFields.list({}, module) || []).map((row) => row.key)]));
}, FAKE);

test('成员管理 starts with 我的企业 and 未分配 and a 部门 column', async () => {
  const { page } = app;
  await openPage('members');
  assert.equal(await page.locator('.business-title h1').innerText(), '成员管理');
  assert.deepEqual(await page.locator('.role-dept-node .role-dept-name').allInnerTexts(), ['我的企业', '未分配']);
  assert.equal(await node('我的企业').getAttribute('aria-pressed'), 'true');
  assert.ok((await page.locator('.role-table thead th').allInnerTexts()).includes('部门'));
  const total = await count('我的企业');
  assert.equal(await count('未分配'), total);
  assert.equal((await rows()).length, total);
});

test('新建部门 销售部 and a child 一组 (name required)', async () => {
  const { page } = app;
  await page.locator('[data-role-action="dept-add"]').click();
  await page.locator('#dept-add-form').waitFor();
  await page.locator('button[form="dept-add-form"]').click();
  await settle();
  assert.equal(await page.locator('#dept-add-error').innerText(), '请填写部门名称');
  await page.locator('#dept-add-form input[name=name]').fill('销售部');
  await page.locator('button[form="dept-add-form"]').click();
  await node('销售部').waitFor();
  await page.locator('[data-role-action="dept-add"]').click();
  await page.locator('#dept-add-form').waitFor();
  await page.locator('#dept-add-form input[name=name]').fill('一组');
  const parents = await page.locator('#dept-add-form select[name=parentId] option').allInnerTexts();
  assert.deepEqual(parents, ['我的企业', '销售部']);
  await page.locator('#dept-add-form select[name=parentId]').selectOption({ label: '销售部' });
  await page.locator('button[form="dept-add-form"]').click();
  await node('一组').waitFor();
  assert.deepEqual(await page.locator('.role-dept-node .role-dept-name').allInnerTexts(), ['我的企业', '销售部', '一组', '未分配']);
  // 一组 sits one level deeper than 销售部
  const lv = (name) => node(name).evaluate((el) => el.style.getPropertyValue('--lv'));
  assert.deepEqual([await lv('我的企业'), await lv('销售部'), await lv('一组')], ['0', '1', '2']);
  const departments = (await stored()).departments;
  assert.equal(departments.length, 2);
  assert.equal(departments.find((d) => d.name === '一组').parentId, departments.find((d) => d.name === '销售部').id);
});

test('添加成员 Mia into the selected department 一组; Joe moved to 销售部 with the 部门 select', async () => {
  const { page } = app;
  const total = await count('我的企业');
  await node('一组').click();
  assert.equal(await node('一组').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-role-action="member-add"]').click();
  await page.locator('#member-add-form').waitFor();
  assert.equal(await page.locator('#member-add-form select[name=deptId]').inputValue(), (await stored()).departments.find((d) => d.name === '一组').id, 'defaults to the selected node');
  await page.locator('#member-add-form input[name=name]').fill('Mia');
  await page.locator('button[form="member-add-form"]').click();
  await memberRow('Mia').waitFor();
  // Joe: added without a department, then moved with the select in the table
  await node('我的企业').click();
  await page.locator('[data-role-action="member-add"]').click();
  await page.locator('#member-add-form').waitFor();
  assert.equal(await page.locator('#member-add-form select[name=deptId]').inputValue(), '');
  await page.locator('#member-add-form input[name=name]').fill('Joe');
  await page.locator('button[form="member-add-form"]').click();
  await memberRow('Joe').waitFor();
  const options = await memberRow('Joe').locator('select[data-role-member-dept] option').allInnerTexts();
  assert.deepEqual(options.map((text) => text.trim()), ['未分配', '销售部', '一组']);
  assert.ok(options[2].startsWith('　'), 'indented by level');
  await memberRow('Joe').locator('select[data-role-member-dept]').selectOption({ label: '销售部' });
  await settle();
  const data = await stored();
  const deptOf = (name) => data.departments.find((d) => d.id === data.members.find((m) => m.name === name).deptId)?.name;
  assert.equal(deptOf('Mia'), '一组');
  assert.equal(deptOf('Joe'), '销售部');
  // counts: a department counts its sub-departments too
  assert.equal(await count('我的企业'), total + 2);
  assert.equal(await count('一组'), 1);
  assert.equal(await count('销售部'), 2);
  assert.equal(await count('未分配'), total);
});

test('clicking a node filters the table', async () => {
  const { page } = app;
  const total = await count('我的企业');
  await node('一组').click();
  assert.deepEqual(await rows(), ['Mia']);
  await node('销售部').click();
  assert.deepEqual(await rows(), ['Joe', 'Mia']);
  await node('未分配').click();
  const unassigned = await rows();
  assert.equal(unassigned.length, total - 2);
  assert.ok(!unassigned.includes('Mia') && !unassigned.includes('Joe'));
  await node('我的企业').click();
  assert.equal((await rows()).length, total);
  await node('销售部').click();
  await shot('a2-members-tree');
  assert.equal(await page.locator('.role-dept-bar b').innerText(), '销售部');
});

test('销售部: cannot delete while it has people; 改名 works; Mia becomes 部门管理员', async () => {
  const { page } = app;
  await node('销售部').click();
  await page.locator('[data-role-action="dept-delete"]').click();
  assert.equal(await page.locator('[data-role-action="dept-delete"]').innerText(), '确定删除');
  await page.locator('[data-role-action="dept-delete"]').click();
  await settle();
  assert.equal(await page.locator('#member-list-error').innerText(), '先删掉或移走下级部门');
  assert.equal(await node('销售部').count(), 1);
  // 改名
  await page.locator('[data-role-action="dept-rename"]').click();
  await page.locator('#dept-rename-form').waitFor();
  assert.equal(await page.locator('#dept-rename-form input[name=name]').inputValue(), '销售部');
  await page.locator('#dept-rename-form input[name=name]').fill('销售中心');
  await page.locator('button[form="dept-rename-form"]').click();
  await node('销售中心').waitFor();
  assert.equal(await page.locator('.role-dept-bar b').innerText(), '销售中心');
  await page.locator('[data-role-action="dept-rename"]').click();
  await page.locator('#dept-rename-form input[name=name]').fill('销售部');
  await page.locator('button[form="dept-rename-form"]').click();
  await node('销售部').waitFor();
  // Mia -> 部门管理员
  await node('一组').click();
  await memberRow('Mia').locator('select[data-role-member-role]').selectOption({ label: '部门管理员' });
  await settle();
  assert.equal((await stored()).members.find((m) => m.name === 'Mia').roleId, 'deptAdmin');
  // an empty department can be deleted
  await node('我的企业').click();
  await page.locator('[data-role-action="dept-add"]').click();
  await page.locator('#dept-add-form input[name=name]').fill('临时部');
  await page.locator('button[form="dept-add-form"]').click();
  await node('临时部').waitFor();
  await node('临时部').click();
  await page.locator('[data-role-action="dept-delete"]').click();
  await page.locator('[data-role-action="dept-delete"]').click();
  await settle();
  assert.equal(await node('临时部').count(), 0);
  assert.equal((await stored()).departments.length, 2);
});

test('角色权限: 部门管理员 shows Mia, 编辑成员 opens 成员管理 for that role', async () => {
  const { page } = app;
  await openPage('roles');
  const row = roleRow('部门管理员');
  assert.equal(await row.locator('.role-avatar').count(), 1);
  assert.equal(await row.locator('.role-avatar').innerText(), 'M');
  assert.equal(await row.locator('td').nth(1).innerText(), '本部门');
  await shot('a2-roles-list');
  await row.locator('.role-members button').click();
  await page.locator('.role-filter').waitFor();
  assert.deepEqual(await rows(), ['Mia']);
  await openPage('roles');
});

test('编辑 业务: 本部门 scope shows its hint; 设置字段权限 for 线索 stays in the draft until 保存', async () => {
  const { page } = app;
  const fakes = await ensureFields();
  const modules = Object.entries(fakes);
  await roleRow('业务').locator('.role-actions button', { hasText: '编辑' }).click();
  await page.locator('#role-edit-form').waitFor();
  await page.locator('#role-scope').selectOption('dept');
  assert.ok((await page.locator('#role-scope-hint').innerText()).startsWith('本部门＝看自己和本部门（含下级部门）成员负责的'));
  const leadGroup = page.locator('[data-role-group]', { has: page.locator('.role-group-name:text-is("线索")') });
  assert.equal(await leadGroup.locator('[data-role-action="fields"]').innerText(), '设置字段权限');
  assert.equal(await leadGroup.locator('[data-role-limit]').isHidden(), true);
  assert.equal(await page.locator('[data-role-action="fields"]').count(), 5);
  assert.equal(await page.locator('[data-role-action="layouts"]').count(), 1);
  assert.deepEqual(modules.map(([module]) => module).sort(), ['lead', 'product']);
  assert.ok(fakes.lead.includes('phone') || fakes.lead.length > 0, 'the lead list has fields');
  await leadGroup.locator('[data-role-action="fields"]').click();
  await page.locator('#role-fields-form').waitFor();
  const keys = await page.locator('#role-fields-form [data-field-row]').evaluateAll((els) => els.map((el) => el.dataset.fieldKey));
  assert.deepEqual(keys, fakes.lead);
  assert.equal(await page.locator('#role-fields-form input[type=radio]:checked[value=edit]').count(), keys.length, 'everything starts 可编辑');
  await shot('a2-field-dialog');
  // quick buttons, then set the first two by hand
  await page.locator('[data-role-action="fields-all"][data-level="read"]').click();
  assert.equal(await page.locator('#role-fields-form input[type=radio]:checked[value=read]').count(), keys.length);
  await page.locator('[data-role-action="fields-all"][data-level="edit"]').click();
  assert.equal(await page.locator('#role-fields-form input[type=radio]:checked[value=edit]').count(), keys.length);
  const first = page.locator('#role-fields-form [data-field-row]').nth(0), second = page.locator('#role-fields-form [data-field-row]').nth(1);
  await first.locator('.role-seg-item', { hasText: '只读' }).click();
  await second.locator('.role-seg-item', { hasText: '隐藏' }).click();
  await page.locator('button[form="role-fields-form"]').click();
  await page.locator('#role-fields-form').waitFor({ state: 'detached' });
  assert.equal(await leadGroup.locator('[data-role-limit]').innerText(), '已限制 2 个');
  // nothing is stored before 保存; 取消 drops the draft
  assert.equal((await stored()).roles.find((r) => r.id === 'sales').fields, undefined);
  await page.locator('[data-role-action="back"]').click();
  await page.locator('.role-table').waitFor();
  await settle();
  assert.equal((await stored()).roles.find((r) => r.id === 'sales').fields, undefined);
  assert.equal((await stored()).roles.find((r) => r.id === 'sales').scope, 'self');
  await roleRow('业务').locator('.role-actions button', { hasText: '编辑' }).click();
  await page.locator('#role-edit-form').waitFor();
  assert.equal(await page.locator('[data-role-limit="lead"]').isHidden(), true, 'draft was dropped');
});

test('field and layout choices are saved with 保存 and survive a reload', async () => {
  const { page } = app;
  await ensureFields();
  const leadGroup = page.locator('[data-role-group]', { has: page.locator('.role-group-name:text-is("线索")') });
  const productGroup = page.locator('[data-role-group]', { has: page.locator('.role-group-name:text-is("产品")') });
  await page.locator('#role-scope').selectOption('dept');
  await leadGroup.locator('[data-role-action="fields"]').click();
  await page.locator('#role-fields-form').waitFor();
  const keys = await page.locator('#role-fields-form [data-field-row]').evaluateAll((els) => els.map((el) => el.dataset.fieldKey));
  await page.locator('#role-fields-form [data-field-row]').nth(0).locator('.role-seg-item', { hasText: '只读' }).click();
  await page.locator('#role-fields-form [data-field-row]').nth(1).locator('.role-seg-item', { hasText: '隐藏' }).click();
  await page.locator('button[form="role-fields-form"]').click();
  await page.locator('#role-fields-form').waitFor({ state: 'detached' });
  // layout dialog
  await productGroup.locator('[data-role-action="layouts"]').click();
  await page.locator('#role-layout-form').waitFor();
  const layoutOptions = await page.locator('#role-layout-form select[name=form] option').allInnerTexts();
  assert.equal(layoutOptions[0], '跟随默认分配');
  assert.ok(layoutOptions.includes('默认布局'));
  assert.deepEqual(await page.locator('#role-layout-form label.field').allInnerTexts().then((list) => list.map((text) => text.split('\n')[0].trim())), ['新建/编辑产品用的布局', '产品详情用的布局']);
  await page.locator('#role-layout-form select[name=form]').selectOption({ label: '默认布局' });
  await page.locator('button[form="role-layout-form"]').click();
  await page.locator('#role-layout-form').waitFor({ state: 'detached' });
  assert.equal(await productGroup.locator('[data-role-layout-tag]').isVisible(), true);
  // editing the dialog again shows what was chosen
  await leadGroup.locator('[data-role-action="fields"]').click();
  await page.locator('#role-fields-form').waitFor();
  assert.equal(await page.locator('#role-fields-form [data-field-row]').nth(0).locator('input:checked').getAttribute('value'), 'read');
  await page.locator('#role-fields-form button, .drawer-footer button[data-action="close-modal"]').first().waitFor();
  await page.locator('.drawer-footer button', { hasText: '取消' }).click();
  await page.locator('#role-fields-form').waitFor({ state: 'detached' });
  assert.equal(await leadGroup.locator('[data-role-limit]').innerText(), '已限制 2 个', '取消 in the dialog keeps the draft');
  await shot('a2-role-edit');
  await page.locator('#role-edit-form button[type=submit]').click();
  await page.locator('.role-table').waitFor();
  await settle();
  const role = (await stored()).roles.find((r) => r.id === 'sales');
  assert.equal(role.scope, 'dept');
  assert.deepEqual(role.fields.lead, { [keys[0]]: 'read', [keys[1]]: 'hidden' });
  assert.equal(role.layouts.product.form, 'default');
  assert.ok(!role.layouts.product.detail);
  // reload, reopen
  await app.open('customers');
  await ensureFields();
  await openPage('roles');
  assert.equal(await roleRow('业务').locator('td').nth(1).innerText(), '本部门');
  await roleRow('业务').locator('.role-actions button', { hasText: '编辑' }).click();
  await page.locator('#role-edit-form').waitFor();
  assert.equal(await page.locator('#role-scope').inputValue(), 'dept');
  assert.equal(await page.locator('[data-role-limit="lead"]').innerText(), '已限制 2 个');
  await page.locator('[data-role-group]:has(.role-group-name:text-is("线索")) [data-role-action="fields"]').click();
  await page.locator('#role-fields-form').waitFor();
  const levels = await page.locator('#role-fields-form [data-field-row]').evaluateAll((els) => els.map((el) => el.querySelector('input:checked').value));
  assert.equal(levels[0], 'read');
  assert.equal(levels[1], 'hidden');
  assert.ok(levels.slice(2).every((level) => level === 'edit'));
  await page.locator('.drawer-footer button', { hasText: '取消' }).click();
  await page.locator('[data-role-action="layouts"]').click();
  await page.locator('#role-layout-form').waitFor();
  assert.equal(await page.locator('#role-layout-form select[name=form]').inputValue(), 'default');
  assert.equal(await page.locator('#role-layout-form select[name=detail]').inputValue(), '');
  await page.locator('.drawer-footer button', { hasText: '取消' }).click();
  // putting everything back to 可编辑 clears the limit
  await page.locator('[data-role-group]:has(.role-group-name:text-is("线索")) [data-role-action="fields"]').click();
  await page.locator('[data-role-action="fields-all"][data-level="edit"]').click();
  await page.locator('button[form="role-fields-form"]').click();
  await page.locator('#role-fields-form').waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-role-limit="lead"]').isHidden(), true);
  await page.locator('#role-edit-form button[type=submit]').click();
  await page.locator('.role-table').waitFor();
  await settle();
  assert.equal((await stored()).roles.find((r) => r.id === 'sales').fields, undefined);
});

test('系统管理员: the dialogs open read-only with everything 可编辑 / 跟随默认分配', async () => {
  const { page } = app;
  await ensureFields();
  await roleRow('系统管理员').locator('.role-actions button').click();
  await page.locator('#role-edit-form').waitFor();
  await page.locator('[data-role-group]:has(.role-group-name:text-is("线索")) [data-role-action="fields"]').click();
  await page.locator('#role-fields-form').waitFor();
  const radios = page.locator('#role-fields-form input[type=radio]');
  assert.ok(await radios.count() > 0);
  assert.equal(await page.locator('#role-fields-form input[type=radio]:not(:disabled)').count(), 0);
  assert.equal(await page.locator('#role-fields-form input[type=radio]:checked[value=edit]').count(), (await radios.count()) / 3);
  assert.equal(await page.locator('button[form="role-fields-form"]').count(), 0, 'nothing to confirm');
  await page.locator('.drawer-footer button', { hasText: '关闭' }).click();
  await page.locator('[data-role-action="layouts"]').click();
  await page.locator('#role-layout-form').waitFor();
  assert.equal(await page.locator('#role-layout-form select:not(:disabled)').count(), 0);
  assert.equal(await page.locator('#role-layout-form select[name=form]').inputValue(), '');
  await page.locator('.drawer-footer button', { hasText: '关闭' }).click();
  await page.locator('[data-role-action="back"]').click();
  await page.locator('.role-table').waitFor();
});

test('a module without fields says so in the dialog', async () => {
  const { page } = app;
  await roleRow('业务').locator('.role-actions button', { hasText: '编辑' }).click();
  await page.locator('#role-edit-form').waitFor();
  await page.locator('[data-role-group]:has(.role-group-name:text-is("商机")) [data-role-action="fields"]').click();
  await page.locator('#role-fields-form').waitFor();
  const rowsCount = await page.locator('#role-fields-form [data-field-row]').count();
  if (rowsCount === 0) assert.ok((await page.locator('#role-fields-form').innerText()).includes('这个模块还没有可以单独设置的字段'));
  await page.locator('.drawer-footer button', { hasText: /取消|关闭/ }).click();
  await page.locator('[data-role-action="back"]').click();
});

test('no page errors in the whole run', () => {
  assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/messages')), []);
});
