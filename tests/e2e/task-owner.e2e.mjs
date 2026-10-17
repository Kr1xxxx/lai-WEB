// 待办属于一个人（D-022）：业务 Amy（本人）新建的待办负责人是她自己，看不到 Kris 的待办，也不能改负责人；
// 系统管理员 Kris 看得到全部，能改负责人，并且在日历上看到“有 N 条待办没有负责人”的提示。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const TODAY = new Date().toLocaleDateString('sv');
const task = (id, title, extra = {}) => ({ id, title, date: TODAY, done: false, ...extra });

async function start(current) {
  const app = await startApp();
  await app.open('customers');
  const ctx = app.page.context().request;
  const loaded = await (await ctx.get(app.base + '/api/data')).json();
  const data = loaded.data;
  data.customers = { 'Amy Client': { owner: 'Amy', history: [] }, 'Kris Client': { owner: 'Kris', history: [] } };
  data.laiTasks = [
    task('t-amy', 'Amy 的待办', { owner: 'Amy' }),
    task('t-kris', 'Kris 的待办', { owner: 'Kris' }),
    task('t-legacy', '老待办没负责人'),
    task('t-legacy-amy', '老待办 Amy 的客户', { customer: 'Amy Client' }),
  ];
  data.laiSettings = {
    ...(data.laiSettings || {}),
    roles: {
      roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'customer.view': true, 'order.view': true }, fields: {}, layouts: {}, v: 2 }],
      members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }],
      current,
    },
  };
  const res = await ctx.post(app.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
  return app;
}
const go = async (app, route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await app.page.waitForTimeout(600);
};
const body = (app) => app.page.locator('body').innerText();
const until = async (app, check, what) => {
  for (let i = 0; i < 60; i++) {
    if (check(await app.readData())) return;
    await app.page.waitForTimeout(100);
  }
  assert.fail('timed out: ' + what);
};
const addTask = async (app, title) => {
  await app.page.locator('[data-biz-action="new-task"]').first().click();
  await app.page.locator('#biz-task-form').waitFor();
  await app.page.locator('#biz-task-form [name=title]').fill(title);
};

test('业务 Amy (本人): her new task is hers, she sees only her own tasks and cannot pick another owner', async () => {
  const app = await start('m-amy');
  try {
    await go(app, 'calendar');
    let text = await body(app);
    assert.ok(text.includes('Amy 的待办'), 'her own task');
    assert.ok(text.includes('老待办 Amy 的客户'), "a legacy task of her customer falls back to her");
    assert.ok(!text.includes('Kris 的待办'), "Kris's task is hidden");
    assert.ok(!text.includes('老待办没负责人'), 'an unassigned task is hidden from 本人');
    assert.ok(!text.includes('没有负责人'), 'the admin hint is not shown to her');
    // 新建：负责人是自己，且不能改
    await addTask(app, 'Amy 新待办');
    const owner = app.page.locator('#biz-task-form label.field', { hasText: '负责人' }).locator('input');
    assert.equal(await owner.inputValue(), 'Amy');
    assert.equal(await owner.isDisabled(), true, 'no reassign permission -> read only');
    assert.equal(await app.page.locator('#biz-task-form select[name=owner]').count(), 0);
    await app.page.locator('button[form="biz-task-form"]').click();
    await app.page.locator('#biz-task-form').waitFor({ state: 'detached' });
    await until(app, (d) => (d.laiTasks || []).some((t) => t.title === 'Amy 新待办'), 'new task saved');
    assert.equal((await app.readData()).laiTasks.find((t) => t.title === 'Amy 新待办').owner, 'Amy');
    // 工作台里的待办数也只算她自己的：Amy 的待办 + 老待办 Amy 的客户 + 新待办 = 3
    await go(app, 'dashboard');
    text = await body(app);
    assert.ok(text.includes('Amy 新待办') && !text.includes('Kris 的待办') && !text.includes('老待办没负责人'));
    assert.equal(await app.page.locator('.wb-queue .wb-row').count(), 3, 'her three tasks are in 今天先做');
    assert.match(await app.page.locator('.wb-hello').innerText(), /今天有 3 件事要处理/);
    assert.equal(await app.page.locator('.wb-queue .wb-tag', { hasText: '今天到期' }).count(), 3);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('系统管理员 Kris: sees every task, is told how many have no owner, and can reassign', async () => {
  const app = await start('m-kris');
  try {
    await go(app, 'calendar');
    let text = await body(app);
    for (const title of ['Amy 的待办', 'Kris 的待办', '老待办没负责人', '老待办 Amy 的客户']) assert.ok(text.includes(title), title);
    // 没有 owner 的老待办有 2 条（客户 Amy 的那条也算没有自己的负责人）
    assert.ok(text.includes('有 2 条待办没有负责人'), 'the hint counts tasks without an owner');
    // 新建：默认是自己，可以选别人
    await addTask(app, 'Kris 新待办');
    const select = app.page.locator('#biz-task-form select[name=owner]');
    assert.equal(await select.inputValue(), 'Kris');
    assert.deepEqual(await select.locator('option').allInnerTexts(), ['Kris', 'Amy']);
    await select.selectOption('Amy');
    await app.page.locator('button[form="biz-task-form"]').click();
    await app.page.locator('#biz-task-form').waitFor({ state: 'detached' });
    await until(app, (d) => (d.laiTasks || []).some((t) => t.title === 'Kris 新待办'), 'new task saved');
    assert.equal((await app.readData()).laiTasks.find((t) => t.title === 'Kris 新待办').owner, 'Amy');
    // 去分配：打开第一条没有负责人的待办，选负责人后提示少一条
    await app.page.locator('[data-biz-action="assign-tasks"]').click();
    await app.page.locator('#biz-task-form').waitFor();
    assert.equal(await app.page.locator('#biz-task-form [name=title]').inputValue(), '老待办没负责人');
    await app.page.locator('#biz-task-form select[name=owner]').selectOption('Amy');
    await app.page.locator('button[form="biz-task-form"]').click();
    await app.page.locator('#biz-task-form').waitFor({ state: 'detached' });
    await until(app, (d) => d.laiTasks.find((t) => t.id === 't-legacy')?.owner === 'Amy', 'reassigned');
    text = await body(app);
    assert.ok(text.includes('有 1 条待办没有负责人'), 'the hint count goes down');
    // 知道了：提示不再出现
    await app.page.locator('[data-biz-action="hide-task-hint"]').click();
    await app.page.waitForTimeout(300);
    assert.ok(!(await body(app)).includes('没有负责人'));
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
