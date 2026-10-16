const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/task-rule-model.js');
const B = require('../src/business-model.js');

// The clock is always passed in: 2026-10-16, noon, local time.
const NOW = new Date(2026, 9, 16, 12, 0, 0);
const TOMORROW = new Date(2026, 9, 17, 12, 0, 0);
const on = (state, type, patch = {}) => T.setRule(state, type, { enabled: true, ...patch });
const autoTasks = (state) => (state.laiTasks || []).filter((task) => task.auto);

// Kris owns Stale (last followed 2026-09-01 = 45 days ago) and Fresh (followed 3 days ago); Mia owns Quiet; Nobody has no owner.
function base() {
  return {
    laiSettings: { defaultOwner: 'Kris' },
    customers: {
      Stale: { client: 'Stale', owner: 'Kris', lastFollowup: '2026-09-01T09:00:00', history: [] },
      Fresh: { client: 'Fresh', owner: 'Kris', lastFollowup: '2026-10-13T09:00:00', history: [] },
      Quiet: { client: 'Quiet', owner: 'Mia', createdAt: '2026-08-01', history: [] },
      Nobody: { client: 'Nobody', owner: '', lastFollowup: '2026-01-01', history: [] },
      InPool: { client: 'InPool', owner: 'Kris', laiBucket: 'pool', lastFollowup: '2026-01-01', history: [] },
    },
    orders: [],
    laiTasks: [],
    laiOpportunities: [],
  };
}

test('everything is off by default: no rule enabled, nothing due, a run changes nothing', () => {
  const state = base();
  assert.deepEqual(T.TYPES, ['noFollow', 'orderStage', 'oppClose', 'repurchase']);
  const cfg = T.config(state);
  assert.deepEqual(cfg.rules.map((rule) => [rule.type, rule.enabled]), T.TYPES.map((type) => [type, false]));
  assert.equal(cfg.rules[0].days, 14);
  assert.equal(cfg.lastRun, '');
  assert.equal(T.due(state, NOW), false);
  const result = T.run(state, { now: NOW });
  assert.equal(result.state, state, 'the very same state comes back');
  assert.deepEqual(result.created, []);
  // the page can still show what turning a rule on would do
  assert.equal(T.preview(state, NOW).byType.noFollow.count, 2, 'Stale and Quiet; no owner and 公海 customers are not counted');
  assert.equal(T.preview(state, NOW).count, 0, 'the total only adds rules that are on');
});

test('there is no 回款 / 待收款 rule (D-006)', () => {
  assert.ok(!T.TYPES.some((type) => /pay|receiv|collect|回款|收款/i.test(type)));
});

test('rule 1: a customer with no follow-up for N days gets 「跟进 客户」, due today, owned by the customer owner', () => {
  const state = on(base(), 'noFollow');
  const result = T.run(state, { now: NOW });
  const tasks = autoTasks(result.state);
  assert.deepEqual(tasks.map((task) => task.title).sort(), ['跟进 Quiet', '跟进 Stale']);
  const stale = tasks.find((task) => task.customer === 'Stale');
  assert.equal(stale.owner, 'Kris');
  assert.equal(stale.date, '2026-10-16');
  assert.equal(stale.done, false);
  assert.deepEqual(stale.auto, { rule: 'noFollow', key: 'noFollow|Stale|2026-09-01' });
  assert.equal(tasks.find((task) => task.customer === 'Quiet').owner, 'Mia');
  assert.equal(tasks.find((task) => task.customer === 'Quiet').auto.key, 'noFollow|Quiet|2026-08-01', 'a customer never followed uses the day it was created');
  assert.ok(!tasks.some((task) => ['Fresh', 'Nobody', 'InPool'].includes(task.customer)), 'recent, no owner and 公海 customers are skipped');
  assert.deepEqual(result.byType, { noFollow: 2 });
  // days is respected
  const strict = on(base(), 'noFollow', { days: 60 });
  assert.deepEqual(autoTasks(T.run(strict, { now: NOW }).state).map((task) => task.customer), ['Quiet']);
});

test('a task made by a rule is a normal task: it goes through setTask, so the owner shows on the calendar', () => {
  const result = T.run(on(base(), 'noFollow'), { now: NOW });
  const task = result.state.laiTasks.find((item) => item.customer === 'Stale');
  assert.equal(B.taskOwner(result.state, task), 'Kris');
  assert.ok(B.calendarEvents(result.state, '2026-10').some((event) => event.kind === 'task' && event.title === '跟进 Stale' && event.owner === 'Kris'));
  assert.ok(B.visibleTasks(result.state, (owner) => owner === 'Mia').every((item) => item.owner === 'Mia'), 'a 本人 account sees only its own');
});

test('rule 2: an order at the chosen stage, N days after, owned by the order owner (or the customer owner)', () => {
  const state = base();
  state.orders = [
    { id: 'o1', num: 'L001', client: 'Stale', stage: 'shipment', owner: 'Amy', createdAt: '2026-09-20' },
    { id: 'o2', num: 'L002', client: 'Stale', stage: 'shipment', createdAt: '2026-09-21' },
    { id: 'o3', num: 'L003', client: 'Stale', stage: 'deposit', owner: 'Amy', createdAt: '2026-09-22' },
    { id: 'o4', num: 'L004', client: 'Stale', stage: 'shipment', owner: 'Amy', createdAt: '2026-09-23', isDraft: true },
    { id: 'o5', num: 'L005', client: 'Ghost', stage: 'shipment', createdAt: '2026-09-24' },
  ];
  const result = T.run(on(state, 'orderStage', { stage: 'shipment', dueDays: 3 }), { now: NOW });
  const tasks = autoTasks(result.state);
  assert.deepEqual(tasks.map((task) => task.title).sort(), ['订单 L001 到了「已发货」', '订单 L002 到了「已发货」']);
  const first = tasks.find((task) => task.title.includes('L001'));
  assert.deepEqual([first.owner, first.date, first.auto], ['Amy', '2026-10-19', { rule: 'orderStage', key: 'orderStage|o1|shipment' }]);
  assert.equal(tasks.find((task) => task.title.includes('L002')).owner, 'Kris', 'no order owner: the customer owner');
  assert.ok(!tasks.some((task) => /L005/.test(task.title)), 'no owner anywhere: skipped');
  assert.throws(() => T.setRule(state, 'orderStage', { stage: 'nope' }), /有效的订单阶段/);
});

test('rule 2: moving the order to another stage later is a new key; the same stage is never repeated', () => {
  let state = base();
  state.orders = [{ id: 'o1', num: 'L001', client: 'Stale', stage: 'deposit', owner: 'Amy', createdAt: '2026-09-20' }];
  state = on(state, 'orderStage', { stage: 'deposit' });
  state = T.run(state, { now: NOW }).state;
  assert.equal(autoTasks(state).length, 1);
  state = T.setRule(state, 'orderStage', { stage: 'production' });
  state = { ...state, orders: [{ ...state.orders[0], stage: 'production' }] };
  state = T.run(state, { now: TOMORROW }).state;
  assert.deepEqual(autoTasks(state).map((task) => task.auto.key).sort(), ['orderStage|o1|deposit', 'orderStage|o1|production']);
  state = { ...state, orders: [{ ...state.orders[0], stage: 'deposit' }] };
  state = T.setRule(state, 'orderStage', { stage: 'deposit' });
  assert.equal(T.run(state, { now: new Date(2026, 9, 18) }).created.length, 0, 'back at 定金: the old key still exists');
});

test('rule 3: open opportunities whose end date is within N days; closed, archived, overdue and owner-less ones are skipped', () => {
  const state = base();
  state.laiOpportunities = [
    { id: 'p1', name: 'Big deal', client: 'Stale', owner: 'Amy', endDate: '2026-10-20', flow: 'default', stage: 'open' },
    { id: 'p2', name: 'Far', client: 'Stale', owner: 'Amy', endDate: '2026-12-01', flow: 'default', stage: 'open' },
    { id: 'p3', name: 'Overdue', client: 'Stale', owner: 'Amy', endDate: '2026-10-01', flow: 'default', stage: 'open' },
    { id: 'p4', name: 'Won', client: 'Stale', owner: 'Amy', endDate: '2026-10-18', flow: 'default', stage: 'done' },
    { id: 'p5', name: 'Archived', client: 'Stale', owner: 'Amy', endDate: '2026-10-18', flow: 'default', stage: 'open', archived: true },
    { id: 'p6', name: 'No owner', client: 'Stale', owner: '', endDate: '2026-10-18', flow: 'default', stage: 'open' },
    { id: 'p7', name: 'Today', client: 'Stale', owner: 'Mia', endDate: '2026-10-16', flow: 'default', stage: 'open' },
  ];
  const result = T.run(on(state, 'oppClose', { days: 7 }), { now: NOW });
  const tasks = autoTasks(result.state);
  assert.deepEqual(tasks.map((task) => task.auto.key).sort(), ['oppClose|p1|2026-10-20', 'oppClose|p7|2026-10-16']);
  const big = tasks.find((task) => task.auto.key.startsWith('oppClose|p1'));
  assert.deepEqual([big.title, big.owner, big.date, big.customer], ['商机「Big deal」快到结束日期', 'Amy', '2026-10-20', 'Stale']);
  // moving the end date makes it a new thing to remind about
  const moved = { ...result.state, laiOpportunities: result.state.laiOpportunities.map((item) => (item.id === 'p1' ? { ...item, endDate: '2026-10-22' } : item)) };
  assert.equal(T.run(moved, { now: TOMORROW }).created.length, 1);
});

test('rule 4: the last order is older than the customer 复购周期; no cycle, no order, no owner = nothing', () => {
  const state = base();
  state.customers.Stale.repurchaseCycle = 30;
  state.customers.Fresh.repurchaseCycle = 30;
  state.customers.Quiet.repurchaseCycle = 0;
  state.customers.Nobody.repurchaseCycle = 30;
  state.customers.InPool.repurchaseCycle = 30;
  state.orders = [
    { id: 'a1', num: 'A1', client: 'Stale', stage: 'done', createdAt: '2026-06-01' },
    { id: 'a2', num: 'A2', client: 'Stale', stage: 'done', createdAt: '2026-08-20' },
    { id: 'a3', num: 'A3', client: 'Fresh', stage: 'done', createdAt: '2026-10-01' },
    { id: 'a4', num: 'A4', client: 'Quiet', stage: 'done', createdAt: '2025-01-01' },
    { id: 'a5', num: 'A5', client: 'Nobody', stage: 'done', createdAt: '2025-01-01' },
    { id: 'a6', num: 'A6', client: 'Stale', stage: 'quote', createdAt: '2026-10-10', isDraft: true },
  ];
  const result = T.run(on(state, 'repurchase'), { now: NOW });
  const tasks = autoTasks(result.state);
  assert.equal(tasks.length, 1);
  assert.deepEqual([tasks[0].title, tasks[0].owner, tasks[0].date, tasks[0].auto], ['复购提醒：Stale', 'Kris', '2026-10-16', { rule: 'repurchase', key: 'repurchase|a2' }]);
  // a newer order = a new last order = a new key, so the reminder can come again later
  const later = { ...result.state, orders: [...result.state.orders, { id: 'a7', num: 'A7', client: 'Stale', stage: 'done', createdAt: '2026-09-01' }] };
  assert.deepEqual(autoTasks(T.run(later, { now: TOMORROW }).state).map((task) => task.auto.key).sort(), ['repurchase|a2', 'repurchase|a7']);
});

test('idempotent: a second run, even on another day, never re-creates a key, whether the task is open or done', () => {
  let state = T.run(on(base(), 'noFollow'), { now: NOW }).state;
  assert.equal(autoTasks(state).length, 2);
  const again = T.run(state, { now: TOMORROW });
  assert.equal(again.created.length, 0);
  assert.equal(autoTasks(again.state).length, 2);
  state = { ...state, laiTasks: state.laiTasks.map((task) => ({ ...task, done: true })) };
  assert.equal(T.run(state, { now: new Date(2026, 9, 20) }).created.length, 0, 'done tasks still hold their key');
  // a new follow-up day on the customer = a new key
  const followed = { ...state, customers: { ...state.customers, Stale: { ...state.customers.Stale, lastFollowup: '2026-09-10T09:00:00' } } };
  const result = T.run(followed, { now: new Date(2026, 9, 21) });
  assert.deepEqual(result.created.map((task) => task.auto.key), ['noFollow|Stale|2026-09-10']);
});

test('dismissed keys never come back; deleting an auto task records its key and nothing else', () => {
  let state = T.run(on(base(), 'noFollow'), { now: NOW }).state;
  const stale = state.laiTasks.find((task) => task.customer === 'Stale');
  state = T.dismissTask(state, stale.id);
  assert.ok(!state.laiTasks.some((task) => task.id === stale.id));
  assert.equal(state.laiTasks.length, 1);
  assert.deepEqual(T.config(state).dismissed, ['noFollow|Stale|2026-09-01']);
  assert.equal(T.run(state, { now: TOMORROW }).created.length, 0);
  assert.equal(T.preview(state, TOMORROW).byType.noFollow.count, 0);
  assert.throws(() => T.dismissTask(state, 'nope'), /找不到/);
  const manual = { ...state, laiTasks: [{ id: 'm', title: 'by hand', date: '2026-10-16', done: false }] };
  assert.throws(() => T.dismissTask(manual, 'm'), /找不到这条自动待办/, 'a task made by hand is not an auto task');
});

test('once per day: after a run lastRun is today, nothing is due until the next day; no enabled rule is never due', () => {
  const state = on(base(), 'noFollow');
  assert.equal(T.due(state, NOW), true);
  const ran = T.run(state, { now: NOW }).state;
  assert.equal(T.config(ran).lastRun, '2026-10-16');
  assert.equal(T.due(ran, NOW), false);
  assert.equal(T.due(ran, TOMORROW), true);
  // a run with nothing to create still marks the day
  const empty = T.run(on({ ...base(), customers: {} }, 'noFollow'), { now: NOW });
  assert.equal(T.config(empty.state).lastRun, '2026-10-16');
  assert.equal(T.due(empty.state, NOW), false);
  assert.equal(T.due(T.setRule(ran, 'noFollow', { enabled: false }), TOMORROW), false);
});

test('cap: at most 50 tasks per rule per run, the most overdue first; the rest follow on later runs', () => {
  const state = base();
  state.customers = {};
  for (let i = 1; i <= 70; i++) state.customers[`C${String(i).padStart(2, '0')}`] = { client: `C${i}`, owner: 'Kris', lastFollowup: `2026-0${i <= 35 ? 7 : 8}-${String((i % 28) + 1).padStart(2, '0')}`, history: [] };
  // C01..C35 last followed in July (older), C36..C70 in August
  const first = T.run(on(state, 'noFollow'), { now: NOW });
  assert.equal(first.created.length, 50);
  assert.equal(T.CAP, 50);
  assert.equal(T.preview(on(state, 'noFollow'), NOW).byType.noFollow.count, 50);
  assert.equal(T.preview(on(state, 'noFollow'), NOW).byType.noFollow.total, 70);
  const days = first.created.map((task) => task.auto.key.split('|')[2]);
  assert.deepEqual([...days].sort(), days, 'sorted most overdue (oldest follow-up) first');
  const julyDone = first.created.filter((task) => task.auto.key.split('|')[2].startsWith('2026-07')).length;
  assert.equal(julyDone, 35, 'every July customer is in the first 50');
  const second = T.run(first.state, { now: TOMORROW });
  assert.equal(second.created.length, 20);
  assert.equal(autoTasks(second.state).length, 70);
  // the cap is per rule: two rules can each add 50
  const both = on(on(state, 'noFollow'), 'repurchase');
  assert.ok(T.run(both, { now: NOW }).created.length >= 50);
});

test('records without an owner are skipped by every rule, and an owner-less customer gets no task even when it is the oldest', () => {
  const state = base();
  state.customers.Nobody.repurchaseCycle = 10;
  state.orders = [{ id: 'z', num: 'Z', client: 'Nobody', stage: 'shipment', createdAt: '2020-01-01' }];
  state.laiOpportunities = [{ id: 'q', name: 'No owner', owner: '', endDate: '2026-10-17', flow: 'default', stage: 'open' }];
  let next = state;
  for (const type of T.TYPES) next = on(next, type);
  next = T.setRule(next, 'orderStage', { stage: 'shipment' });
  const result = T.run(next, { now: NOW });
  assert.ok(!autoTasks(result.state).some((task) => /Nobody|Z|No owner/.test(task.title)));
});

test('settings are validated and normalised; unknown input falls back to the defaults', () => {
  const state = base();
  assert.throws(() => T.setRule(state, 'noFollow', { days: 0 }), /1 到 365/);
  assert.throws(() => T.setRule(state, 'noFollow', { days: 'abc' }), /1 到 365/);
  assert.throws(() => T.setRule(state, 'noFollow', { days: '3.5' }), /1 到 365/);
  assert.throws(() => T.setRule(state, 'noFollow', { enabled: 'yes' }), /开关/);
  assert.throws(() => T.setRule(state, 'bogus', {}), /找不到这条规则/);
  assert.throws(() => T.setRule(state, 'orderStage', { dueDays: -1 }), /0 到 90/);
  const odd = { laiSettings: { taskRules: { rules: [{ type: 'noFollow', enabled: 'true', days: -5 }, 'x', null], lastRun: 'yesterday', dismissed: ['a', 3, 'a', ''] } } };
  const cfg = T.config(odd);
  assert.deepEqual([cfg.rules[0].enabled, cfg.rules[0].days, cfg.lastRun, cfg.dismissed], [false, 14, '', ['a']]);
  assert.equal(cfg.rules.length, 4);
  const saved = T.setRule(state, 'noFollow', { days: '21' });
  assert.deepEqual(saved.laiSettings.taskRules.rules.map((rule) => rule.type), T.TYPES);
  assert.equal(saved.laiSettings.taskRules.rules[0].days, 21);
  assert.equal(saved.laiSettings.defaultOwner, 'Kris', 'other settings are kept');
  assert.equal(state.laiSettings.taskRules, undefined, 'the input state is not changed');
});

test('timestamps with a time zone count as the local day; a bad date is ignored instead of throwing', () => {
  assert.equal(T.dayOf('2026-09-01'), '2026-09-01');
  assert.equal(T.dayOf('2026-09-01 08:30'), '2026-09-01');
  assert.equal(T.dayOf(new Date(2026, 8, 1, 23, 30).toISOString()), '2026-09-01');
  assert.equal(T.dayOf('nonsense'), '');
  assert.equal(T.dayOf('2026-13-45'), '');
  const state = base();
  state.customers.Stale.lastFollowup = 'garbage';
  state.customers.Stale.createdAt = '';
  assert.doesNotThrow(() => T.run(on(state, 'noFollow'), { now: NOW }));
});
