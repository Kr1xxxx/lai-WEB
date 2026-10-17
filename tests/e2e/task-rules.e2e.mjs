// 任务设置 (T1) in the real page with the real backend: 协同 → 任务设置 shows four rules, all off, with a preview;
// turning 客户没跟进 on creates the task for the customer's owner, it shows on the calendar, a reload does not
// duplicate it, 业务 Amy (本人) sees only her own auto task, deleting an auto task keeps it from coming back,
// and a rule that is on runs by itself once a day when the page is opened.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
const TODAY = new Date().toLocaleDateString('sv');
const YESTERDAY = new Date(Date.now() - 86400000).toLocaleDateString('sv');
// No mailbox is bound in the test data dir, so the mail badge requests answer 409; that is not a page error.
const pageErrors = () => app.errors.filter((e) => !/HTTP 409: .*\/api\/mail\//.test(e));
const data = () => app.readData();
const body = () => app.page.locator('body').innerText();
const go = async (route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await app.page.waitForTimeout(600);
};
const until = async (check, what) => {
  for (let i = 0; i < 80; i++) {
    if (check(await data())) return;
    await app.page.waitForTimeout(100);
  }
  assert.fail('timed out: ' + what);
};
const autoTasks = async () => ((await data()).laiTasks || []).filter((task) => task.auto);

async function save(mutate) {
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  state.data = mutate(state.data) || state.data;
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
}
const asMember = (current) => (d) => { d.laiSettings.roles.current = current; };

before(async () => {
  app = await startApp({ seed: false });
  await app.open('customers');
  await save((d) => {
    d.customers = {
      'Amy Stale': { client: 'Amy Stale', owner: 'Amy', lastFollowup: '2020-01-01T09:00:00', history: [] },
      'Kris Stale': { client: 'Kris Stale', owner: 'Kris', lastFollowup: '2020-02-01T09:00:00', history: [] },
      'Kris Fresh': { client: 'Kris Fresh', owner: 'Kris', lastFollowup: TODAY + 'T08:00:00', history: [] },
      'No Owner': { client: 'No Owner', owner: '', lastFollowup: '2020-03-01T09:00:00', history: [] },
    };
    d.laiTasks = [];
    d.laiSettings = {
      ...(d.laiSettings || {}), defaultOwner: 'Kris',
      roles: {
        roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'customer.view': true, 'order.view': true }, fields: {}, layouts: {}, v: 2 }],
        members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }],
        current: 'm-kris',
      },
    };
  });
});
after(async () => { await app?.close(); });

test('协同 → 任务设置 lists four rules, all off, with a preview and no task created yet', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.rail-item[data-rail-menu="协同"]').click();
  await page.locator('.section-tabs .section-tab:text-is("任务设置")').click();
  await page.locator('.tr-page').waitFor();
  assert.match(await page.locator('.pagebar h1').innerText(), /任务设置/);
  assert.equal(await page.locator('[data-tr-rule]').count(), 4);
  assert.equal(await page.locator('[data-tr-toggle]:checked').count(), 0, 'every rule starts off');
  assert.match(await page.locator('[data-tr-preview="noFollow"]').innerText(), /现在会生成 2 个任务/, 'Amy Stale and Kris Stale; no owner and recent are left out');
  assert.match(await page.locator('[data-tr-last]').innerText(), /还没有运行过/);
  assert.equal((await data()).laiTasks.length, 0);
  assert.deepEqual(pageErrors(), []);
});

test('turning 客户没跟进 on creates the tasks for the right owners and they show on the calendar', async () => {
  const { page } = app;
  await page.locator('[data-tr-toggle="noFollow"]').check();
  await until((d) => (d.laiTasks || []).length === 2, 'two auto tasks saved');
  const tasks = await autoTasks();
  const byCustomer = Object.fromEntries(tasks.map((task) => [task.customer, task]));
  assert.deepEqual(Object.keys(byCustomer).sort(), ['Amy Stale', 'Kris Stale']);
  assert.equal(byCustomer['Amy Stale'].owner, 'Amy');
  assert.equal(byCustomer['Kris Stale'].owner, 'Kris');
  assert.equal(byCustomer['Amy Stale'].date, TODAY);
  assert.deepEqual(byCustomer['Amy Stale'].auto, { rule: 'noFollow', key: 'noFollow|Amy Stale|2020-01-01' });
  assert.equal(byCustomer['Amy Stale'].title, '跟进 Amy Stale');
  const saved = (await data()).laiSettings.taskRules;
  assert.equal(saved.lastRun, TODAY);
  assert.deepEqual(saved.rules.map((rule) => [rule.type, rule.enabled]), [['noFollow', true], ['orderStage', false], ['oppClose', false], ['repurchase', false]]);
  assert.match(await page.locator('[data-tr-preview="noFollow"]').innerText(), /现在会生成 0 个任务/);
  assert.equal(await page.locator('[data-tr-task]').count(), 2, 'the auto tasks are listed on the page');
  await go('calendar');
  const text = await body();
  assert.ok(text.includes('跟进 Amy Stale') && text.includes('跟进 Kris Stale'), 'the admin sees both on the calendar');
  assert.ok(!text.includes('跟进 No Owner') && !text.includes('跟进 Kris Fresh'));
  assert.deepEqual(pageErrors(), []);
});

test('a reload does not create them again', async () => {
  await app.open('calendar');
  await app.page.waitForTimeout(800);
  assert.equal((await autoTasks()).length, 2);
  assert.equal((await data()).laiTasks.length, 2);
  await app.open('customers');
  await app.page.waitForTimeout(800);
  assert.equal((await data()).laiTasks.length, 2, 'a second boot on the same day adds nothing');
  assert.deepEqual(pageErrors(), []);
});

test('业务 Amy (本人) sees only her own auto task, cannot open 任务设置, and does not get a task for Kris', async () => {
  await save(asMember('m-amy'));
  await app.open('calendar');
  await app.page.waitForTimeout(800);
  const text = await body();
  assert.ok(text.includes('跟进 Amy Stale'), 'her own');
  assert.ok(!text.includes('跟进 Kris Stale'), "Kris's is hidden");
  await go('task-settings');
  assert.ok(!(await app.page.locator('[data-tr-rule]').count()), 'the page is closed to her');
  assert.match(await body(), /没有.*任务设置.*权限/);
  assert.equal((await data()).laiTasks.length, 2, 'opening the app as Amy changes nothing');
  assert.deepEqual(pageErrors(), []);
});

test('删除 on an auto task asks twice, removes it and it never comes back, even after a new day', async () => {
  await save(asMember('m-kris'));
  await app.open('task-settings');
  const row = app.page.locator('[data-tr-task]', { hasText: '跟进 Kris Stale' });
  await row.waitFor();
  await row.locator('[data-tr-action="delete"]').click();
  await row.locator('[data-tr-action="delete"]', { hasText: '确认删除' }).click();
  await until((d) => (d.laiTasks || []).length === 1, 'the task is removed');
  const cfg = (await data()).laiSettings.taskRules;
  assert.deepEqual(cfg.dismissed, ['noFollow|Kris Stale|2020-02-01']);
  // pretend yesterday was the last run, then boot again: the daily run goes, but the dismissed key stays out
  await save((d) => { d.laiSettings.taskRules.lastRun = YESTERDAY; });
  await app.open('calendar');
  await app.page.waitForTimeout(1000);
  const after = await data();
  assert.equal(after.laiTasks.length, 1);
  assert.equal(after.laiSettings.taskRules.lastRun, TODAY, 'the boot run marked today');
  assert.ok(!(await body()).includes('跟进 Kris Stale'));
  assert.deepEqual(pageErrors(), []);
});

test('a rule that is on runs by itself at boot once a day: a newly stale customer gets a task without opening the page', async () => {
  await save((d) => {
    d.customers['Kris Later'] = { client: 'Kris Later', owner: 'Kris', lastFollowup: '2020-04-01T09:00:00', history: [] };
    d.laiSettings.taskRules.lastRun = YESTERDAY;
  });
  await app.open('customers');
  await until((d) => (d.laiTasks || []).some((task) => task.customer === 'Kris Later'), 'the boot run created the task');
  const later = (await autoTasks()).find((task) => task.customer === 'Kris Later');
  assert.deepEqual([later.owner, later.date], ['Kris', TODAY]);
  // the same day again: nothing more
  const count = (await data()).laiTasks.length;
  await app.open('customers');
  await app.page.waitForTimeout(800);
  assert.equal((await data()).laiTasks.length, count);
  assert.deepEqual(pageErrors(), []);
});
