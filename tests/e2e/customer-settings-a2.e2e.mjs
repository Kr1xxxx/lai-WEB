// Browser end-to-end test: the five A2 tabs on 客户设置 (公海管理, 客户跟进规则, 客户成交规则, 动态设置, 写跟进设置) with real saves.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const openSettings = async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').click();
  await page.locator('.cs-page').waitFor();
};
const tab = async (id) => { await app.page.locator(`[data-cs-tab="${id}"]`).click(); await app.page.locator(`[data-cs-panel="${id}"]`).waitFor(); };
const settings = async () => (await app.readData()).laiSettings?.customerSettings || {};
const pool = async () => (await app.readData()).laiSettings?.poolRules || {};
const section = (title) => app.page.locator(`.cs-section:has(h3:text-is("${title}"))`);
const saveSection = (title) => section(title).locator('button[type=submit]').click();
const toast = async (pattern) => {
  await app.page.locator('#toast.show', { hasText: pattern }).waitFor();
};
const ruleDrawerSave = () => app.page.locator('button[type=submit][form="cs-rule-form"]').click();
// Make one customer look untouched for a long time (customers from the samples have no creation date).
const makeOld = (name, days) => app.page.evaluate(async ({ name, days }) => {
  const state = await (await fetch('/api/data')).json();
  const old = new Date(Date.now() - days * 86400000).toISOString();
  state.data.customers[name] = { ...state.data.customers[name], createdAt: old };
  const res = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  if (!res.ok) throw new Error('seed failed ' + res.status);
}, { name, days });

test('the old 公海规则 button is gone and the pool tab replaces it', async () => {
  await openSettings();
  assert.equal(await app.page.locator('[data-action="pool-rules"]').count(), 0);
  assert.ok(!(await app.page.locator('.cs-shortcuts').innerText()).includes('公海规则'));
  assert.equal(await app.page.locator('.cs-page [data-feature]').count(), 0);
  await tab('pool');
  assert.deepEqual(await app.page.locator('.cs-section h3').allInnerTexts(),
    ['自动移入公海规则', '现在符合规则的客户', '即将移入公海', '提前提醒', '白名单', '这些客户不移', '领回限制', '领取上限', '公海联系人', '移入公海原因']);
  assert.deepEqual(app.errors, []);
});

test('pool rules: create, reject a duplicate name, edit, switch off and delete', async () => {
  const { page } = app;
  // A group to pick in the rule form.
  await tab('groups');
  await page.locator('[data-cs-group-add=""]').click();
  await page.locator('#cs-group-form input[name=name]').fill('重点客户');
  await page.locator('button[type=submit][form="cs-group-form"]').click();
  await page.locator('.cs-group', { hasText: '重点客户' }).waitFor();
  await tab('pool');
  await page.locator('[data-cs-rule-edit=""]').click();
  await page.locator('#cs-rule-form').waitFor();
  await page.locator('#cs-rule-form [name=name]').fill('半年没联系');
  await page.locator('#cs-rule-form [name=days]').fill('180');
  await ruleDrawerSave();
  await page.locator('.cs-rules tr', { hasText: '半年没联系' }).waitFor();
  let rules = (await pool()).rules;
  assert.equal(rules.length, 1);
  assert.deepEqual([rules[0].name, rules[0].kind, rules[0].days, rules[0].enabled, rules[0].groups, rules[0].startDate], ['半年没联系', 'noContact', 180, true, [], '']);
  const row = page.locator('.cs-rules tr', { hasText: '半年没联系' });
  assert.match(await row.innerText(), /180 天没有联系.*全部客户/s);

  // Same name again is refused and the drawer stays open.
  await page.locator('[data-cs-rule-edit=""]').click();
  await page.locator('#cs-rule-form [name=name]').fill('半年没联系');
  await ruleDrawerSave();
  await page.locator('#workspace-error.visible').waitFor();
  assert.match(await page.locator('#workspace-error').innerText(), /不能重复/);
  assert.equal((await pool()).rules.length, 1);
  await page.locator('.drawer [data-action="close-modal"]').first().click();
  await page.locator('#cs-rule-form').waitFor({ state: 'detached' });

  // Edit: new name, 没有成交, a group and a start date.
  await row.getByRole('button', { name: '编辑' }).click();
  await page.locator('#cs-rule-form [name=name]').fill('一年没成交');
  await page.locator('#cs-rule-form [name=kind]').selectOption('noDeal', { force: true });
  await page.locator('#cs-rule-form [name=days]').fill('365');
  await page.locator('#cs-rule-form input[name=group][value="重点客户"]').check();
  await page.locator('#cs-rule-form [name=startDate]').evaluate((el) => { el.value = '2026-01-01'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await ruleDrawerSave();
  await page.locator('.cs-rules tr', { hasText: '一年没成交' }).waitFor();
  rules = (await pool()).rules;
  assert.equal(rules.length, 1, 'edit does not add a second rule');
  assert.deepEqual([rules[0].name, rules[0].kind, rules[0].days, rules[0].groups, rules[0].startDate], ['一年没成交', 'noDeal', 365, ['重点客户'], '2026-01-01']);
  assert.match(await page.locator('.cs-rules tr', { hasText: '一年没成交' }).innerText(), /365 天没有成交.*重点客户.*2026-01-01/s);

  // Switch off, then delete.
  await page.locator('[data-cs-rule-toggle]').uncheck();
  await settle(600);
  assert.equal((await pool()).rules[0].enabled, false);
  await page.locator('.cs-rules tr', { hasText: '一年没成交' }).getByRole('button', { name: '删除' }).click();
  await page.locator('.cs-rules').waitFor({ state: 'detached' });
  assert.deepEqual((await pool()).rules, []);
  assert.deepEqual(app.errors, []);
});

test('立即执行 moves a customer who is due into the pool and says how many', async () => {
  const { page } = app;
  await makeOld('Northwind Lash Studio', 400);
  await openSettings();
  await tab('pool');
  // Nothing is switched on yet: the button says there is nobody.
  await page.locator('[data-cs-pool-run]').click();
  await toast('现在没有符合规则的客户');
  await page.locator('[data-cs-rule-edit=""]').click();
  await page.locator('#cs-rule-form [name=name]').fill('90 天没联系');
  await page.locator('#cs-rule-form [name=days]').fill('90');
  await ruleDrawerSave();
  const preview = section('现在符合规则的客户');
  await preview.locator('tbody tr', { hasText: 'Northwind Lash Studio' }).waitFor();
  assert.equal(await preview.locator('tbody tr').count(), 1);
  assert.match(await preview.locator('tbody tr').innerText(), /Kris.*90 天没联系.*\d+ 天/s);
  await page.locator('[data-cs-pool-run]').click();
  assert.match(await page.locator('.cs-confirm').innerText(), /将把\s*1\s*位客户移入公海/);
  await page.locator('.cs-confirm [data-cs-cancel]').click();
  assert.notEqual((await app.readData()).customers['Northwind Lash Studio'].laiBucket, 'pool', 'cancel moves nobody');
  await page.locator('[data-cs-pool-run]').click();
  await page.locator('[data-cs-pool-run-ok]').click();
  await toast('已移入公海 1 位客户');
  await section('现在符合规则的客户').getByText('现在没有符合规则的客户').waitFor();
  const moved = (await app.readData()).customers['Northwind Lash Studio'];
  assert.equal(moved.laiBucket, 'pool');
  assert.match(moved.history[0].text, /公海规则「90 天没联系」/);
  // And it really is in the pool list now.
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("公海客户"))').click();
  await page.locator('tbody tr', { hasText: 'Northwind Lash Studio' }).waitFor();
  assert.deepEqual(app.errors, []);
});

test('pool settings: every small section saves on its own', async () => {
  const { page } = app;
  await openSettings();
  await tab('pool');
  // 提前提醒
  await page.locator('input[name=remindDays]').fill('10');
  await saveSection('提前提醒');
  await toast('已保存');
  assert.equal((await pool()).remindDays, 10);
  await page.locator('input[name=remindDays]').fill('99');
  await page.locator('[data-cs-form="pool-remind"]').evaluate((form) => { form.noValidate = true; }); // let the model, not the browser, say no
  await saveSection('提前提醒');
  await page.locator('#cs-error.visible').waitFor();
  assert.match(await page.locator('#cs-error').innerText(), /0–30/);
  assert.equal((await pool()).remindDays, 10, 'a bad value is not saved');
  // 白名单
  await page.locator('[data-cs-form="pool-white-add"] select').selectOption('Kris', { force: true });
  await page.locator('[data-cs-form="pool-white-add"] button[type=submit]').click();
  await section('白名单').locator('.cs-row', { hasText: 'Kris' }).waitFor();
  assert.deepEqual((await pool()).whitelist, ['Kris']);
  await page.locator('[data-cs-pool-white-remove="Kris"]').click();
  await section('白名单').getByText('白名单是空的').waitFor();
  assert.deepEqual((await pool()).whitelist, []);
  // 这些客户不移
  await page.locator('input[name=skipFollowed]').uncheck();
  await page.locator('input[name=skipTags]').fill('VIP，样品');
  await saveSection('这些客户不移');
  await settle(600);
  let saved = await pool();
  assert.deepEqual([saved.skipOpenOrders, saved.skipFollowed, saved.skipTags], [true, false, ['VIP', '样品']]);
  // 领回限制
  await page.locator('input[name=reclaimBlockDays]').fill('14');
  await saveSection('领回限制');
  await settle(600);
  assert.equal((await pool()).reclaimBlockDays, 14);
  // 领取上限，含单独设置
  await page.locator('input[name=periodDays]').fill('7');
  await page.locator('input[name=defaultLimit]').fill('5');
  await page.locator('input[name="claim:Kris"]').fill('2');
  await saveSection('领取上限');
  await settle(600);
  saved = await pool();
  assert.deepEqual(saved.claimLimit, { periodDays: 7, defaultLimit: 5, perOwner: { Kris: 2 } });
  await page.locator('input[name="claim:Kris"]').fill('');
  await saveSection('领取上限');
  await settle(600);
  assert.deepEqual((await pool()).claimLimit.perOwner, {});
  // 公海联系人
  await page.locator('input[name=showPoolContacts][value=hide]').check();
  await saveSection('公海联系人');
  await settle(600);
  assert.equal((await pool()).showPoolContacts, false);
  // 移入公海原因
  await page.locator('[data-cs-pool-require]').check();
  await settle(600);
  assert.equal((await pool()).requireReason, true);
  await page.locator('[data-cs-form="pool-reason-add"] input').fill('客户已失联');
  await page.locator('[data-cs-form="pool-reason-add"] button[type=submit]').click();
  await section('移入公海原因').locator('.cs-row', { hasText: '客户已失联' }).waitFor();
  assert.deepEqual((await pool()).reasons, ['客户已失联']);
  await page.locator('[data-cs-pool-reason-remove="客户已失联"]').click();
  await section('移入公海原因').getByText('还没有原因').waitFor();
  await page.locator('[data-cs-pool-require]').uncheck();
  await settle(600);
  saved = await pool();
  assert.deepEqual([saved.reasons, saved.requireReason], [[], false]);
  // The rule saved earlier survives every one of these saves.
  assert.equal(saved.rules.length, 1);
  assert.deepEqual(app.errors.filter((e) => !/HTTP 4/.test(e)), []);
});

test('客户跟进规则: needs at least one action in each list', async () => {
  const { page } = app;
  await openSettings();
  await tab('follow');
  assert.equal(await page.locator('input[name=contact]').count(), 7);
  assert.equal(await page.locator('input[name=followup]').count(), 7);
  for (const box of await page.locator('input[name=contact]').all()) await box.uncheck();
  await page.locator('[data-cs-form="follow"] button[type=submit]').click();
  await page.locator('#cs-error.visible').waitFor();
  assert.match(await page.locator('#cs-error').innerText(), /请至少选一项/);
  assert.equal((await settings()).followRules.contact.length, 7, 'nothing was saved');
  await page.locator('input[name=contact][value=followup]').check();
  await page.locator('input[name=contact][value=mailSent]').check();
  await page.locator('input[name=followup][value=chat]').uncheck();
  await page.locator('[data-cs-form="follow"] button[type=submit]').click();
  await settle(600);
  assert.deepEqual((await settings()).followRules, { contact: ['followup', 'mailSent'], followup: ['followup', 'mailSent'] });
  assert.deepEqual(app.errors.filter((e) => !/HTTP 4/.test(e)), []);
});

test('客户成交规则: switch between 订单 and 商机', async () => {
  const { page } = app;
  await openSettings();
  await tab('deal');
  assert.equal(await page.locator('[data-cs-deal="order"]').isChecked(), true);
  await page.locator('[data-cs-deal="opportunity"]').check();
  await page.locator('[data-cs-deal="opportunity"]:checked').waitFor();
  assert.equal((await settings()).dealRule.by, 'opportunity');
  await page.locator('[data-cs-deal="order"]').check();
  await page.locator('[data-cs-deal="order"]:checked').waitFor();
  assert.equal((await settings()).dealRule.by, 'order');
  assert.deepEqual(app.errors, []);
});

test('动态设置: turning on auto-record stamps the start time', async () => {
  const { page } = app;
  await openSettings();
  await tab('activity');
  assert.equal(await page.getByText('起自动记录').count(), 0);
  const before = Date.now();
  await page.locator('[data-cs-activity]').check();
  await page.getByText('起自动记录').waitFor();
  const a = (await settings()).activity;
  assert.equal(a.autoMail, true);
  assert.ok(Date.parse(a.since) >= before - 1000 && Date.parse(a.since) <= Date.now() + 1000);
  assert.match(await page.getByText('起自动记录').innerText(), /^从 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 起自动记录$/);
  await page.locator('[data-cs-activity]').uncheck();
  await settle(600);
  assert.equal((await settings()).activity.autoMail, false);
  assert.deepEqual(app.errors, []);
});

test('写跟进设置: past times and template groups with texts', async () => {
  const { page } = app;
  await openSettings();
  await tab('followup');
  await page.locator('[data-cs-allow-past]').check();
  await settle(600);
  assert.equal((await settings()).followup.allowPastTime, true);
  await page.getByText('还没有模板').waitFor();

  // Groups: add two, rename, reorder.
  for (const name of ['开发信跟进', '报价后跟进']) {
    await page.locator('[data-cs-form="tpl-group-add"] input').fill(name);
    await page.locator('[data-cs-form="tpl-group-add"] button[type=submit]').click();
    await page.locator('.cs-group', { hasText: name }).waitFor();
  }
  const names = async () => (await settings()).followup.templates.map((g) => g.name);
  assert.deepEqual(await names(), ['开发信跟进', '报价后跟进']);
  await page.locator('[data-cs-form="tpl-group-add"] input').fill('开发信跟进');
  await page.locator('[data-cs-form="tpl-group-add"] button[type=submit]').click();
  await page.locator('#cs-error.visible').waitFor();
  assert.match(await page.locator('#cs-error').innerText(), /同名/);
  await page.locator('.cs-group', { hasText: '报价后跟进' }).locator('[data-cs-tpl-move][data-delta="-1"]').click();
  await page.locator('.cs-group').first().getByText('报价后跟进').waitFor();
  assert.deepEqual(await names(), ['报价后跟进', '开发信跟进']);
  await page.locator('.cs-group', { hasText: '报价后跟进' }).getByRole('button', { name: '改名' }).click();
  await page.locator('.cs-inline input').fill('报价跟进');
  await page.locator('.cs-inline button[type=submit]').click();
  await page.locator('.cs-group', { hasText: '报价跟进' }).waitFor();
  assert.deepEqual(await names(), ['报价跟进', '开发信跟进']);

  // Texts: add, edit, delete.
  const group = () => page.locator('.cs-group', { hasText: '报价跟进' });
  await group().getByRole('button', { name: '添加常用语' }).click();
  await page.locator('#cs-tpl-form [name=text]').fill('您好，上次的报价看了吗？');
  await page.locator('button[type=submit][form="cs-tpl-form"]').click();
  await group().locator('.cs-child', { hasText: '上次的报价' }).waitFor();
  let templates = (await settings()).followup.templates;
  assert.deepEqual(templates[0].items.map((i) => i.text), ['您好，上次的报价看了吗？']);
  await group().locator('.cs-child').getByRole('button', { name: '编辑' }).click();
  assert.equal(await page.locator('#cs-tpl-form [name=text]').inputValue(), '您好，上次的报价看了吗？');
  await page.locator('#cs-tpl-form [name=text]').fill('报价三天后到期，要不要先确认？');
  await page.locator('button[type=submit][form="cs-tpl-form"]').click();
  await group().locator('.cs-child', { hasText: '三天后到期' }).waitFor();
  templates = (await settings()).followup.templates;
  assert.deepEqual(templates[0].items.map((i) => i.text), ['报价三天后到期，要不要先确认？']);
  await group().locator('.cs-child').getByRole('button', { name: '删除' }).click();
  await group().locator('.cs-child').waitFor({ state: 'detached' });
  assert.deepEqual((await settings()).followup.templates[0].items, []);

  // Delete a group, then the empty hint comes back after the last one.
  await group().getByRole('button', { name: '删除' }).click();
  await page.locator('.cs-group', { hasText: '报价跟进' }).waitFor({ state: 'detached' });
  await page.locator('.cs-group', { hasText: '开发信跟进' }).getByRole('button', { name: '删除' }).click();
  await page.getByText('还没有模板').waitFor();
  assert.deepEqual((await settings()).followup.templates, []);
  assert.equal((await settings()).followup.allowPastTime, true, 'the time option is kept');
  assert.deepEqual(app.errors.filter((e) => !/HTTP 4/.test(e)), []);
});
