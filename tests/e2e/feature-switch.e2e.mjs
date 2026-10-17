// 功能开关 (FS) in the real page with the real backend: 设置 → 功能开关 has one switch per module. Switching a module off
// removes it from the rail, the flyouts, the 设置中心, 常用, the workbench and the customer detail; a direct link shows
// 这个功能已关闭 and goes to the workbench; nothing is deleted (data is the same after off and on); with 邮件 off the page
// sends no request to the mail service; and a task rule that needs a closed module does not run.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp, sampleCustomers } from './harness.mjs';

let app;
const requests = [];
const CUSTOMER = Object.keys(sampleCustomers())[0];
const TODAY = new Date().toLocaleDateString('sv');
const SOON = new Date(Date.now() + 2 * 86400000).toLocaleDateString('sv');
// No mailbox is bound in the test data dir, so the mail requests answer 409; that is not a page error.
const pageErrors = () => app.errors.filter((e) => !/HTTP 409: .*\/api\/mail/.test(e));
const settle = (ms = 500) => app.page.waitForTimeout(ms);
const data = () => app.readData();
const mailRequests = () => requests.filter((url) => url.includes('/api/mail'));

async function save(mutate) {
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  state.data = mutate(state.data) || state.data;
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
}

// module id → what it should take away
const MODULES = {
  lead: { label: '线索', rail: ['线索', 'Leads'], favorite: 'route:leads', route: 'leads' },
  opp: { label: '商机', rail: ['商机'], hub: 'flows', favorite: 'route:opportunities', route: 'opportunities' },
  product: { label: '产品', flyout: ['交易', 'products'], hub: 'product-settings', favorite: 'route:products', route: 'products' },
  doc: { label: '单据', flyout: ['交易', 'doc-templates'], hub: 'doc-templates', favorite: 'route:doc-templates', route: 'doc-templates' },
  mail: { label: '邮件', rail: ['邮件'], hub: 'mail-account', favorite: 'mail:inbox', route: 'mail' },
  chat: { label: '沟通', rail: ['沟通'], hub: 'chat-templates', favorite: 'route:chats', route: 'chats' },
  team: { label: '团队数据', rail: ['团队数据'], hub: 'targets', favorite: 'route:team-goals', route: 'team-goals' },
};
const FAVORITES = ['route:leads', 'route:opportunities', 'route:products', 'route:doc-templates', 'mail:inbox', 'route:chats', 'route:team-goals', 'route:order-list', 'screen:active'];

before(async () => {
  app = await startApp();
  app.page.on('request', (request) => requests.push(request.url()));
  // A toast stays for 3 seconds only, so keep every text it showed from the moment the page starts.
  await app.page.addInitScript(() => {
    window.__toasts = [];
    // Watch the whole document from the very start: the app can show a toast while its scripts run, before
    // DOMContentLoaded, so an observer added at DOMContentLoaded could miss it.
    let last = '';
    new MutationObserver(() => {
      const text = document.getElementById('toast')?.textContent || '';
      if (text && text !== last) window.__toasts.push(text);
      last = text;
    }).observe(document, { childList: true, characterData: true, subtree: true });
  });
  await app.open('customers');
  await save((d) => {
    d.laiLeads = [{ id: 'lead-1', name: 'Fs Lead Co', owner: 'Kris', email: 'fs@lead.example', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }];
    d.laiOpportunities = [{ id: 'opp-1', name: 'Fs Deal', client: CUSTOMER, owner: 'Amy', amount: '100', currency: 'USD', flow: 'default', stage: 'open', endDate: SOON, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }];
    d.laiProducts = [{ id: 'prod-1', name: 'Fs Product', code: 'FS-1' }];
    d.laiSettings = { ...(d.laiSettings || {}), favoriteNav: FAVORITES };
  });
});
after(async () => { await app?.close(); });

const rail = (label) => app.page.locator(`.rail-item[data-rail-menu="${label}"]`);
const flyoutTargets = async (menu) => {
  await rail(menu).hover();
  await app.page.locator('.rail-flyout').waitFor();
  const targets = await app.page.locator('.rail-flyout-item').evaluateAll((nodes) => nodes.map((node) => node.dataset.flyoutTarget));
  await app.page.mouse.move(700, 500);
  return targets;
};
const toggleOnPage = async (module, on) => {
  const box = app.page.locator(`[data-fs-toggle="${module}"]`);
  await box.waitFor();
  if (on) await box.check(); else await box.uncheck();
  await settle();
};
const openSwitchPage = async () => {
  await app.open('feature-switch');
  await app.page.locator('.fs-page').waitFor();
};
const hubItems = async () => {
  await app.open('settings-hub');
  await app.page.locator('.sh-page').waitFor();
  return app.page.locator('[data-sh-item]').evaluateAll((nodes) => nodes.map((node) => node.dataset.shItem));
};
const favoriteTargets = async () => {
  await app.open('dashboard');
  await rail('常用').hover();
  await app.page.locator('.rail-flyout').waitFor();
  const targets = await app.page.locator('.rail-flyout-item').evaluateAll((nodes) => nodes.map((node) => node.dataset.flyoutTarget));
  await app.page.mouse.move(700, 500);
  return targets;
};
const workbenchText = async () => {
  await app.open('dashboard');
  await app.page.locator('.wb').waitFor();
  return app.page.locator('.wb').innerText();
};
const openDetail = async () => {
  const url = new URL(app.page.url());
  url.searchParams.set('customer', CUSTOMER);
  url.hash = 'customers';
  await app.page.goto(url.toString());
  await app.page.waitForLoadState('networkidle');
  await app.page.locator('.lcd-root').waitFor();
  await app.page.locator('.lcd-tabs [data-tab="activity"]').click();
  await app.page.locator('[data-activity-filter="all"]').waitFor();
};

test('设置 → 功能开关: one switch per module, all on, the fixed sentence, and the page is in 设置中心 and the 设置 flyout', async () => {
  const { page } = app;
  await openSwitchPage();
  assert.equal(await page.locator('.pagebar h1').innerText(), '功能开关');
  assert.deepEqual(await page.locator('[data-fs-module] h3').allInnerTexts(), ['线索', '商机', '产品', '单据', '邮件', '沟通', '团队数据']);
  assert.equal(await page.locator('[data-fs-toggle]:checked').count(), 7);
  assert.match(await page.locator('.pagebar').innerText(), /关掉后，这个功能不再显示；数据都保留，重新打开就能用。/);
  assert.match(await page.locator('.fs-fixed').innerText(), /客户、订单、工作台、协同、设置、企业管理是基础功能，不能关闭/);
  assert.ok((await hubItems()).includes('feature-switch'));
  assert.deepEqual((await flyoutTargets('设置')).filter((t) => t === 'feature-switch'), ['feature-switch']);
  assert.equal((await data()).laiSettings.featureSwitch, undefined, 'nothing is stored until a switch is used');
  assert.deepEqual(pageErrors(), []);
});

for (const [id, spec] of Object.entries(MODULES)) {
  test(`switching ${spec.label} off hides it everywhere (rail, flyout, 设置中心, 常用, workbench, customer detail), blocks the link, and on brings it all back`, async () => {
    const { page } = app;
    await save((d) => { d.laiSettings.featureSwitch = { off: [] }; });
    // before: it is there
    const before = { hub: await hubItems(), fav: await favoriteTargets(), wb: await workbenchText() };
    if (spec.hub) assert.ok(before.hub.includes(spec.hub), `${spec.hub} in the hub before`);
    assert.ok(before.fav.includes(spec.favorite), `${spec.favorite} in 常用 before`);
    for (const label of spec.rail || []) assert.equal(await rail(label).count(), 1, `${label} on the rail before`);
    if (spec.flyout) assert.ok((await flyoutTargets(spec.flyout[0])).includes(spec.flyout[1]));

    await openSwitchPage();
    await toggleOnPage(id, false);
    assert.deepEqual((await data()).laiSettings.featureSwitch.off, [id]);
    assert.match(await page.locator(`[data-fs-module="${id}"] .fs-switch`).innerText(), /已关闭/);

    // the rail and flyouts lose it at once (no reload)
    for (const label of spec.rail || []) assert.equal(await rail(label).count(), 0, `${label} left the rail`);
    if (spec.flyout) {
      const targets = await flyoutTargets(spec.flyout[0]);
      assert.ok(!targets.includes(spec.flyout[1]) && targets.includes('order-list'), 'only that entry left the flyout');
    }
    assert.equal(await rail('客户').count(), 1);
    assert.equal(await rail('设置').count(), 1);

    // 设置中心, 常用 (read time: the saved list is untouched), workbench
    const hub = await hubItems();
    if (spec.hub) assert.ok(!hub.includes(spec.hub), `${spec.hub} left the hub`);
    assert.ok(hub.includes('feature-switch') && hub.includes('defaults'));
    const fav = await favoriteTargets();
    assert.ok(!fav.includes(spec.favorite), `${spec.favorite} left 常用`);
    assert.ok(fav.includes('route:order-list') && fav.includes('screen:active'), 'the other favorites stay');
    assert.deepEqual((await data()).laiSettings.favoriteNav, FAVORITES, 'the saved 常用 list is not changed');
    const wb = await workbenchText();
    const cards = { opp: ['商机阶段', '进行中商机', '新建商机'], mail: ['未读邮件'], team: ['本月目标'] }[id] || [];
    for (const text of cards) { assert.ok(before.wb.includes(text), `${text} was on the workbench`); assert.ok(!wb.includes(text), `${text} left the workbench`); }
    assert.ok(wb.includes('有效订单') && wb.includes('待办任务'), 'orders and tasks are never switchable');

    // customer detail
    await openDetail();
    const detail = await page.locator('.lcd-root').innerText();
    if (id === 'opp') {
      assert.equal(await page.locator('.lcd-opportunity').count(), 0, '进行中的商机 card is gone');
      assert.ok(!detail.includes('进行中的商机'));
    } else assert.equal(await page.locator('.lcd-opportunity').count(), 1);
    assert.equal((await page.locator('.lcd-root [data-feature="写邮件"]').count()) > 0, id !== 'mail', '写邮件');
    assert.equal(await page.locator('[data-activity-filter="email"]').count(), id === 'mail' ? 0 : 1, '往来邮件');
    assert.equal(await page.locator('[data-activity-filter="chat"]').count(), id === 'chat' ? 0 : 1, '聊天记录');
    await page.locator('.lcd-tabs [data-tab="info"]').click();
    const info = await page.locator('.lcd-body').innerText();
    assert.equal(info.includes('关联线索'), id !== 'lead', '关联线索 field');

    // a direct link to the closed module says so and lands on the workbench
    await app.open(spec.route);
    await page.locator('.wb').waitFor();
    // The workbench can render before the toast text is set, so wait for the message instead of reading it once.
    const said = await page.waitForFunction(() => window.__toasts.includes('这个功能已关闭'), null, { timeout: 5000 }).then(() => true, () => false);
    assert.ok(said, 'the page said 这个功能已关闭');
    assert.match(page.url(), /#dashboard$/);
    assert.equal(await page.locator('.pagebar h1', { hasText: '没有权限' }).count(), 0);

    // on again: everything is back and the saved data is the same
    await openSwitchPage();
    await toggleOnPage(id, true);
    assert.deepEqual((await data()).laiSettings.featureSwitch.off, []);
    for (const label of spec.rail || []) assert.equal(await rail(label).count(), 1, `${label} back on the rail`);
    const back = { hub: await hubItems(), fav: await favoriteTargets(), wb: await workbenchText() };
    assert.deepEqual(back.hub, before.hub);
    assert.deepEqual(back.fav, before.fav);
    assert.equal(back.wb.includes('有效订单'), true);
    for (const text of cards) assert.ok(back.wb.includes(text), `${text} back on the workbench`);
    await app.open(spec.route);
    await settle();
    assert.doesNotMatch(page.url(), /#dashboard$/, 'the link works again');
    assert.ok(!(await page.evaluate(() => window.__toasts)).includes('这个功能已关闭'));
    assert.deepEqual(pageErrors(), []);
  });
}

test('data is untouched by switching everything off and on: leads, opportunities, products, customers, orders and 常用 are the same', async () => {
  const pick = (d) => JSON.stringify({ customers: d.customers, orders: d.orders, leads: d.laiLeads, opps: d.laiOpportunities, products: d.laiProducts, fav: d.laiSettings.favoriteNav });
  const before = pick(await data());
  await openSwitchPage();
  for (const id of Object.keys(MODULES)) await toggleOnPage(id, false);
  assert.deepEqual((await data()).laiSettings.featureSwitch.off, Object.keys(MODULES));
  // with everything off the basics are all still there, and so is the switch page
  for (const label of ['客户', '交易', '协同', '设置', '企业管理']) assert.equal(await rail(label).count(), 1, label);
  for (const label of ['线索', '商机', 'Leads', '邮件', '沟通', '团队数据']) assert.equal(await rail(label).count(), 0, label);
  assert.equal(await app.page.locator('.fs-page').count(), 1, 'the switch page stays open');
  assert.equal(pick(await data()), before, 'nothing changed while everything was off');
  for (const id of Object.keys(MODULES)) await toggleOnPage(id, true);
  assert.deepEqual((await data()).laiSettings.featureSwitch.off, []);
  assert.equal(pick(await data()), before);
  for (const label of ['线索', '商机', 'Leads', '邮件', '沟通', '团队数据']) assert.equal(await rail(label).count(), 1, label);
  assert.deepEqual(pageErrors(), []);
});

test('with 邮件 off the page sends no request to the mail service, not on boot, not on the workbench, not on a timer; on again it asks again', async () => {
  const { page } = app;
  await save((d) => { d.laiSettings.featureSwitch = { off: ['mail'] }; });
  const mark = mailRequests().length;
  await app.open('customers');
  await settle(1500);
  await app.open('dashboard');
  await page.locator('.wb').waitFor();
  await settle(1500);
  await page.locator('.rail-item[data-rail-menu="客户"]').click();
  await settle(800);
  assert.deepEqual(mailRequests().slice(mark), [], 'no /api/mail request at all while 邮件 is off');
  // the mail polling timer is also blocked at the door: even a forced mail call does not leave the page
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-lai-route="mail"]').length), 0);
  // turn it on from the page: the page starts asking the mail service
  await openSwitchPage();
  const before = mailRequests().length;
  await toggleOnPage('mail', true);
  await settle(1000);
  assert.ok(mailRequests().length > before, 'the mail service is asked again once 邮件 is on');
  assert.deepEqual(pageErrors(), []);
});

test('客户设置: the 新线索与已有客户 tab goes when 线索 is off and comes back when it is on', async () => {
  const { page } = app;
  const openDedupe = async () => {
    await app.open('customers');
    await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').click();
    await page.locator('.cs-page').waitFor();
    await page.locator('[data-cs-tab="dedupe"]').click();
    await page.locator('[data-cs-panel="dedupe"]').waitFor();
  };
  await openDedupe();
  assert.equal(await page.locator('[data-cs-dedupe-sub="lead"]').count(), 1);
  await save((d) => { d.laiSettings.featureSwitch = { off: ['lead'] }; });
  await openDedupe();
  assert.equal(await page.locator('[data-cs-dedupe-sub="lead"]').count(), 0);
  assert.equal(await page.locator('[data-cs-form="dedupe"]').count(), 1, 'the customer table stays');
  await save((d) => { d.laiSettings.featureSwitch = { off: [] }; });
  await openDedupe();
  assert.equal(await page.locator('[data-cs-dedupe-sub="lead"]').count(), 1);
  assert.deepEqual(pageErrors(), []);
});

test('任务规则: 商机快到结束日期 does not run while 商机 is off (its switch stays on) and runs once 商机 is on', async () => {
  const { page } = app;
  const autoTasks = async () => ((await data()).laiTasks || []).filter((task) => task.auto);
  await save((d) => {
    d.laiTasks = [];
    d.laiSettings.taskRules = { rules: [{ id: 'oppClose', type: 'oppClose', enabled: true, days: 7, dueDays: 0 }], lastRun: '', dismissed: [] };
    d.laiSettings.featureSwitch = { off: ['opp'] };
  });
  await app.open('dashboard');
  await page.locator('.wb').waitFor();
  await settle(1500);
  assert.deepEqual(await autoTasks(), [], 'no task is made while 商机 is off');
  const rules = (await data()).laiSettings.taskRules;
  assert.deepEqual(rules.rules.map((rule) => [rule.type, rule.enabled]), [['oppClose', true]], 'the rule keeps its switch');
  assert.notEqual(rules.lastRun, TODAY, 'and it did not count as having run today');
  await save((d) => { d.laiSettings.featureSwitch = { off: [] }; });
  await app.open('dashboard');
  await page.locator('.wb').waitFor();
  await settle(1500);
  const tasks = await autoTasks();
  assert.deepEqual(tasks.map((task) => task.auto.key), [`oppClose|opp-1|${SOON}`], 'on again: the rule runs');
  assert.deepEqual(pageErrors(), []);
});
