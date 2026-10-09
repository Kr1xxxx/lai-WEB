const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/customer-tools.js');
const L = require('../src/modules.js');
const CS = require('../src/customer-settings-model.js');

const NOW = new Date('2026-10-09T12:00:00Z');
const day = (n) => new Date(NOW.getTime() - n * 86400000).toISOString(); // n 天前
const ago = (n) => day(n);
const profile = (name, extra = {}) => ({ client: name, country: '美国', owner: 'Kris', source: '展会', createdAt: day(400), history: [], ...extra });
const base = () => ({
  orders: [],
  customers: {
    Idle: profile('Idle'),
    Fresh: profile('Fresh'),
    Mia1: profile('Mia1', { owner: 'Mia' }),
  },
  laiSettings: {},
});
// 联系时间、成交时间都由测试直接给，不依赖别的模块。
const stub = (contact = {}, deal = {}) => ({
  lastContact: (_s, name) => contact[name] || '',
  lastDeal: (_s, name) => deal[name] || '',
});
const rule = (extra = {}) => ({ name: '90 天未联系', enabled: true, kind: 'noContact', days: 90, groups: [], startDate: '', ...extra });
const withRules = (state, rules, more = {}) => T.setPoolRules(state, { rules, ...more });

test('defaults: nothing stored gives an empty v2 object and never throws', () => {
  const r = T.poolRules({});
  assert.deepEqual(r, {
    version: 2, rules: [], remindDays: 7, whitelist: [], skipOpenOrders: true, skipFollowed: true, skipTags: [],
    reclaimBlockDays: 0, claimLimit: { periodDays: 1, defaultLimit: 0, perOwner: {} }, showPoolContacts: true, requireReason: false, reasons: [],
  });
  assert.doesNotThrow(() => T.poolRules(null));
  assert.doesNotThrow(() => T.poolRules({ laiSettings: { poolRules: 'junk' } }));
  const bad = T.poolRules({ laiSettings: { poolRules: { rules: [{ name: '', days: 5 }, { name: 'ok', days: 'x' }, { name: 'ok', days: 5, kind: 'weird' }], remindDays: 99, reclaimBlockDays: -3, claimLimit: { periodDays: 0, defaultLimit: 'a' } } } });
  assert.deepEqual(bad.rules.map((x) => [x.name, x.kind]), [['ok', 'noContact']]);
  assert.equal(bad.remindDays, 7);
  assert.equal(bad.reclaimBlockDays, 0);
  assert.deepEqual(bad.claimLimit, { periodDays: 1, defaultLimit: 0, perOwner: {} });
  assert.equal(T.DEFAULT_POOL_RULES.version, 2);
});

test('v1 settings read as one v2 rule and keep the skip flags', () => {
  const s = { laiSettings: { poolRules: { enabled: true, noFollowDays: 45, skipOpenOrders: false, skipTags: ['VIP'], skipFollowed: false } } };
  const r = T.poolRules(s);
  assert.deepEqual(r.rules, [{ id: 'legacy', name: '45 天未联系', enabled: true, kind: 'noContact', days: 45, groups: [], startDate: '' }]);
  assert.equal(r.skipOpenOrders, false);
  assert.equal(r.skipFollowed, false);
  assert.deepEqual(r.skipTags, ['VIP']);
  const off = T.poolRules({ laiSettings: { poolRules: { enabled: false, noFollowDays: 90 } } });
  assert.equal(off.rules[0].enabled, false);
  // 保存后变成 v2，保存的是 rules 数组
  const saved = T.setPoolRules(s, T.poolRules(s));
  assert.equal(saved.laiSettings.poolRules.version, 2);
  assert.equal(saved.laiSettings.poolRules.rules.length, 1);
});

test('setPoolRules validates the whole object with Chinese errors', () => {
  const s = base();
  assert.throws(() => T.setPoolRules(s, { remindDays: 31 }), /提前提醒天数请填 0–30/);
  assert.throws(() => T.setPoolRules(s, { remindDays: 'abc' }), /提前提醒天数请填 0–30/);
  assert.throws(() => T.setPoolRules(s, { remindDays: 1.5 }), /提前提醒天数请填 0–30/);
  assert.throws(() => T.setPoolRules(s, { reclaimBlockDays: 366 }), /0–365/);
  assert.throws(() => T.setPoolRules(s, { claimLimit: { periodDays: 0 } }), /1–365/);
  assert.throws(() => T.setPoolRules(s, { claimLimit: { defaultLimit: -1 } }), /0–100000/);
  assert.throws(() => T.setPoolRules(s, { claimLimit: { perOwner: { Kris: 100001 } } }), /0–100000/);
  assert.throws(() => T.setPoolRules(s, { rules: [rule({ name: '' })] }), /规则名称/);
  assert.throws(() => T.setPoolRules(s, { rules: [rule({ name: 'x'.repeat(21) })] }), /规则名称/);
  assert.throws(() => T.setPoolRules(s, { rules: [rule({ days: 0 })] }), /1–3650/);
  assert.throws(() => T.setPoolRules(s, { rules: [rule({ days: 3651 })] }), /1–3650/);
  assert.throws(() => T.setPoolRules(s, { rules: [rule({ kind: 'x' })] }), /规则类型/);
  assert.throws(() => T.setPoolRules(s, { rules: [rule({ startDate: '2026-13-01' })] }), /开始日期/);
  assert.throws(() => T.setPoolRules(s, { rules: [rule({ name: 'Abc' }), rule({ name: 'abc' })] }), /规则名称不能重复/);
  assert.throws(() => T.setPoolRules(s, { rules: Array.from({ length: 11 }, (_, i) => rule({ name: 'r' + i })) }), /最多 10 条规则/);
  assert.throws(() => T.setPoolRules(s, { whitelist: Array.from({ length: 201 }, (_, i) => 'p' + i) }), /白名单最多 200/);
  assert.throws(() => T.setPoolRules(s, { reasons: ['x'.repeat(21)] }), /原因最多 20/);
  assert.throws(() => T.setPoolRules(s, { reasons: ['长期不回', ' 长期不回 '] }), /原因不能重复/);
  assert.throws(() => T.setPoolRules(s, { reasons: Array.from({ length: 31 }, (_, i) => 'r' + i) }), /最多 30 个原因/);
  assert.equal(Object.keys(s.laiSettings).length, 0, 'input state is never modified');
});

test('setPoolRules normalizes: trims, de-duplicates, keeps lastAutoRun, gives rules ids', () => {
  let s = withRules(base(), [rule({ name: '  A  ', groups: [' 重点 ', '重点', ''], startDate: ' 2026-01-01 ' })], {
    whitelist: [' Boss ', 'Boss', ''], skipTags: 'VIP，大客户', reasons: [' 价格 ', '', '没需求'], requireReason: true, showPoolContacts: false,
    claimLimit: { periodDays: '3', defaultLimit: '5', perOwner: { Kris: 8, Mia: '', Zed: null } },
  });
  const r = T.poolRules(s);
  assert.equal(r.rules[0].name, 'A');
  assert.ok(r.rules[0].id);
  assert.deepEqual(r.rules[0].groups, ['重点']);
  assert.equal(r.rules[0].startDate, '2026-01-01');
  assert.deepEqual(r.whitelist, ['Boss']);
  assert.deepEqual(r.skipTags, ['VIP', '大客户']);
  assert.deepEqual(r.reasons, ['价格', '没需求']);
  assert.equal(r.requireReason, true);
  assert.equal(T.poolContactsVisible(s), false);
  assert.deepEqual(r.claimLimit, { periodDays: 3, defaultLimit: 5, perOwner: { Kris: 8 } });
  assert.equal(T.poolContactsVisible(base()), true);
  s = T.markAutoRun(s, NOW);
  s = T.setPoolRules(s, T.poolRules(s));
  assert.ok(s.laiSettings.poolRules.lastAutoRun, 'lastAutoRun survives a save');
});

test('savePoolRule adds, replaces by id and caps at 10; deletePoolRule removes', () => {
  let s = T.savePoolRule(base(), rule({ name: 'A' }));
  const id = T.poolRules(s).rules[0].id;
  assert.ok(id);
  s = T.savePoolRule(s, { ...rule({ name: 'A2', days: 30 }), id });
  assert.deepEqual(T.poolRules(s).rules.map((r) => [r.id, r.name, r.days]), [[id, 'A2', 30]]);
  assert.throws(() => T.savePoolRule(s, rule({ name: 'a2' })), /规则名称不能重复/);
  assert.throws(() => T.savePoolRule(s, rule({ name: 'B', days: 0 })), /1–3650/);
  for (let i = 0; i < 9; i++) s = T.savePoolRule(s, rule({ name: 'R' + i }));
  assert.equal(T.poolRules(s).rules.length, 10);
  assert.throws(() => T.savePoolRule(s, rule({ name: 'one more' })), /最多 10 条规则/);
  s = T.deletePoolRule(s, id);
  assert.equal(T.poolRules(s).rules.length, 9);
  assert.throws(() => T.deletePoolRule(s, 'nope'), /不存在/);
});

test('only enabled rules count', () => {
  const t = stub({ Idle: ago(100), Fresh: ago(1), Mia1: ago(1) });
  const off = withRules(base(), [rule({ enabled: false })]);
  assert.deepEqual(T.poolCandidates(off, undefined, NOW, t), []);
  assert.equal(T.autoRunDue(off, NOW), false, 'a disabled rule never runs by itself');
  const on = withRules(base(), [rule(), rule({ name: '关着的', days: 1, enabled: false })]);
  const list = T.poolCandidates(on, undefined, NOW, t);
  assert.deepEqual(list.map((c) => c.name), ['Idle']);
  assert.deepEqual(list[0], { name: 'Idle', owner: 'Kris', ruleId: T.poolRules(on).rules[0].id, ruleName: '90 天未联系', kind: 'noContact', days: 100, dueInDays: -10, basis: day(100).slice(0, 10) });
});

test('noContact uses the last contact, noDeal the last deal; empty falls back to creation time', () => {
  const s = withRules(base(), [rule({ name: '联系', days: 30 }), rule({ name: '成交', kind: 'noDeal', days: 200 })]);
  // 联系过但很久没成交
  let t = stub({ Idle: ago(5), Fresh: ago(5), Mia1: ago(5) }, { Idle: ago(250), Fresh: ago(10), Mia1: ago(10) });
  let list = T.poolCandidates(s, undefined, NOW, t);
  assert.deepEqual(list.map((c) => [c.name, c.kind]), [['Idle', 'noDeal']]);
  // 没有任何时间：按建档时间（400 天前）
  t = stub();
  list = T.poolCandidates(s, undefined, NOW, t);
  assert.deepEqual(list.map((c) => c.name).sort(), ['Fresh', 'Idle', 'Mia1']);
  assert.ok(list.every((c) => c.days === 400));
  // 连建档时间都没有：跳过
  const noTime = withRules({ orders: [], customers: { X: { client: 'X', owner: 'Kris', country: '美国', source: 'a' } } }, [rule({ days: 1 })]);
  assert.deepEqual(T.poolCandidates(noTime, undefined, NOW, stub()), []);
});

test('defaultTimes uses the settings model: latest settled order for deals, non-draft orders for contact', () => {
  const s = withRules({
    orders: [
      { id: 'a', client: 'Idle', stage: 'done', createdAt: day(300), shippedAt: day(250), amount: 1 },
      { id: 'b', client: 'Idle', stage: 'quote', createdAt: day(3), amount: 1 },
      { id: 'c', client: 'Idle', stage: 'shipment', isDraft: true, createdAt: day(2), amount: 1 },
    ],
    customers: { Idle: profile('Idle') }, laiSettings: {},
  }, [rule({ name: '成交', kind: 'noDeal', days: 100 })], { skipOpenOrders: false });
  const d = T.defaultTimes.lastDeal(s, 'Idle');
  assert.equal(d, day(250));
  const list = T.poolCandidates(s, undefined, NOW);
  assert.equal(list[0].days, 250);
  // 联系时间来自客户设置的跟进规则：草稿订单不算，最近一笔非草稿订单是 3 天前
  assert.equal(Date.parse(T.defaultTimes.lastContact(s, 'Idle')), Date.parse(day(3)));
});

test('groups: a first-level group covers its children, unrelated groups do not match, empty means all', () => {
  const s0 = base();
  s0.customers.Idle.previewGroup = '重点 / A类';
  s0.customers.Fresh.previewGroup = '重点';
  s0.customers.Mia1.previewGroup = '普通 / B类';
  s0.customers.Other = profile('Other', { previewGroup: '重点客户 / X' });
  const t = stub();
  const names = (groups) => T.poolCandidates(withRules(s0, [rule({ groups })]), undefined, NOW, t).map((c) => c.name).sort();
  assert.deepEqual(names(['重点']), ['Fresh', 'Idle'], '重点 covers 重点 and 重点 / A类, not 重点客户');
  assert.deepEqual(names(['重点 / A类']), ['Idle']);
  assert.deepEqual(names(['普通']), ['Mia1']);
  assert.deepEqual(names(['不存在']), []);
  assert.deepEqual(names([]), ['Fresh', 'Idle', 'Mia1', 'Other']);
});

test('startDate pushes the basis forward', () => {
  const t = stub({ Idle: ago(200) });
  const s = withRules(base(), [rule({ days: 60, startDate: '2026-09-01' })]);
  const list = T.poolCandidates(s, undefined, NOW, { lastContact: (_s, n) => (n === 'Idle' ? ago(200) : ago(1)) });
  assert.deepEqual(list, [], 'Sept 1 is only 38 days ago, so nothing is due yet');
  const reminders = T.poolReminders(withRules(s, T.poolRules(s).rules, { remindDays: 30 }), NOW, { ...t, lastContact: () => ago(200) });
  const hit = reminders.find((c) => c.name === 'Idle');
  assert.equal(hit.basis, '2026-09-01');
  assert.equal(hit.days, 38);
  assert.equal(hit.dueInDays, 22);
});

test('whitelist owners, missing owners and skip flags are respected', () => {
  const s0 = base();
  s0.customers.Followed = profile('Followed', { previewFollowed: true });
  s0.customers.Tagged = profile('Tagged', { tags: ['大客户'] });
  s0.customers.NoOwner = profile('NoOwner', { owner: '' });
  s0.customers.Pooled = profile('Pooled', { laiBucket: 'pool', owner: '' });
  s0.customers.Trashed = profile('Trashed', { laiBucket: 'trash' });
  s0.orders = [{ id: 'o', client: 'Fresh', stage: 'production', amount: 1, createdAt: day(300) }];
  const t = stub();
  const run = (more) => T.poolCandidates(withRules(s0, [rule()], more), undefined, NOW, t).map((c) => c.name).sort();
  assert.deepEqual(run({ skipTags: ['大客户'] }), ['Idle', 'Mia1']);
  assert.deepEqual(run({ skipTags: ['大客户'], whitelist: ['Mia'] }), ['Idle']);
  assert.deepEqual(run({ skipTags: ['大客户'], whitelist: ['Kris', 'Mia'] }), []);
  assert.deepEqual(run({ skipTags: ['大客户'], skipFollowed: false, skipOpenOrders: false }), ['Followed', 'Fresh', 'Idle', 'Mia1']);
  assert.deepEqual(run({}), ['Idle', 'Mia1', 'Tagged']);
});

test('a customer takes the matching rule with the smallest dueInDays', () => {
  const s = withRules(base(), [rule({ name: '联系 30', days: 30 }), rule({ name: '成交 80', kind: 'noDeal', days: 80 }), rule({ name: '联系 200', days: 200 })]);
  const list = T.poolCandidates(s, undefined, NOW, { lastContact: (_s, n) => (n === 'Idle' ? ago(20) : ago(1)), lastDeal: (_s, n) => (n === 'Idle' ? ago(100) : ago(1)) });
  assert.equal(list.length, 1);
  assert.equal(list[0].ruleName, '成交 80');
  assert.equal(list[0].dueInDays, -20);
  assert.deepEqual([list[0].days, list[0].kind], [100, 'noDeal']);
});

test('candidates are sorted by days (most first) then name', () => {
  const s0 = base();
  s0.customers.Aaa = profile('Aaa');
  const t = stub({ Idle: ago(100), Aaa: ago(100), Fresh: ago(200), Mia1: ago(1) });
  const list = T.poolCandidates(withRules(s0, [rule()]), undefined, NOW, t);
  assert.deepEqual(list.map((c) => c.name), ['Fresh', 'Aaa', 'Idle']);
});

test('poolCandidates accepts v1 rule objects passed in directly', () => {
  const list = T.poolCandidates(base(), { enabled: true, noFollowDays: 90, skipOpenOrders: true, skipTags: [], skipFollowed: true }, NOW, stub());
  assert.equal(list.length, 3);
});

test('reminders and forecast depend on remindDays', () => {
  const t = stub({ Idle: ago(85), Fresh: ago(60), Mia1: ago(95) });
  const s7 = withRules(base(), [rule()], { remindDays: 7 });
  const rem = T.poolReminders(s7, NOW, t);
  assert.deepEqual(rem.map((c) => [c.name, c.dueInDays]), [['Idle', 5]]);
  assert.deepEqual(T.poolForecast(s7, 'Idle', NOW, t), { ruleName: '90 天未联系', dueInDays: 5 });
  assert.equal(T.poolForecast(s7, 'Fresh', NOW, t), null, '30 days away is beyond the reminder window');
  assert.deepEqual(T.poolForecast(s7, 'Mia1', NOW, t), { ruleName: '90 天未联系', dueInDays: -5 }, 'already due');
  assert.equal(T.poolForecast(s7, 'Nobody', NOW, t), null);
  const s0 = withRules(base(), [rule()], { remindDays: 0 });
  assert.deepEqual(T.poolReminders(s0, NOW, t), []);
  assert.equal(T.poolForecast(s0, 'Idle', NOW, t), null);
  assert.deepEqual(T.poolForecast(s0, 'Mia1', NOW, t), { ruleName: '90 天未联系', dueInDays: -5 });
  const wide = withRules(base(), [rule()], { remindDays: 30 });
  assert.deepEqual(T.poolReminders(wide, NOW, t).map((c) => c.name), ['Idle', 'Fresh'], 'soonest first');
});

test('applyPoolRules moves due customers with a reason and one history line; empty result does not throw', () => {
  const t = stub({ Idle: ago(120), Fresh: ago(2), Mia1: ago(2) }, { Idle: ago(10), Fresh: ago(300), Mia1: ago(300) });
  const s = withRules(base(), [rule({ name: '联系 90' }), rule({ name: '半年没成交', kind: 'noDeal', days: 180, groups: [] })]);
  const before = JSON.stringify(s);
  const r = T.applyPoolRules(s, NOW, t);
  assert.equal(JSON.stringify(s), before, 'input is not modified');
  assert.deepEqual(r.moved.map((c) => c.name).sort(), ['Fresh', 'Idle', 'Mia1']);
  const idle = r.state.customers.Idle;
  assert.equal(L.bucket(idle), 'pool');
  assert.equal(idle.poolReason, '联系 90');
  assert.equal(idle.laiPreviousOwner, 'Kris');
  assert.equal(idle.history.length, 1, 'exactly one history line');
  assert.deepEqual(idle.history[0], { time: NOW.toISOString(), text: '公海规则「联系 90」：120 天没有联系，自动移入公海', type: 'operation' });
  assert.equal(r.state.customers.Fresh.poolReason, '半年没成交');
  assert.equal(r.state.customers.Fresh.history[0].text, '公海规则「半年没成交」：300 天没有成交，自动移入公海');
  const again = T.applyPoolRules(r.state, NOW, t);
  assert.deepEqual(again.moved, []);
  assert.equal(again.state, r.state);
  assert.doesNotThrow(() => T.applyPoolRules(base(), NOW, t));
});

test('applyPoolRules is not blocked by requireReason', () => {
  const s = withRules(base(), [rule()], { requireReason: true });
  const r = T.applyPoolRules(s, NOW, stub());
  assert.equal(r.moved.length, 3);
  assert.equal(L.bucket(r.state.customers.Idle), 'pool');
});

test('autoRunDue and markAutoRun work once per local day', () => {
  const s = withRules(base(), [rule()]);
  const d1 = new Date(2026, 9, 9, 8, 0, 0);
  const d1late = new Date(2026, 9, 9, 23, 30, 0);
  const d2 = new Date(2026, 9, 10, 0, 5, 0);
  assert.equal(T.autoRunDue(s, d1), true);
  const marked = T.markAutoRun(s, d1);
  assert.equal(marked.laiSettings.poolRules.lastAutoRun, '2026-10-09');
  assert.equal(T.autoRunDue(marked, d1late), false);
  assert.equal(T.autoRunDue(marked, d2), true);
  assert.equal(T.autoRunDue(base(), d1), false, 'no rules, nothing to run');
  assert.equal(JSON.stringify(s).includes('lastAutoRun'), false, 'input not modified');
  assert.deepEqual(T.poolRules(marked), T.poolRules(s), 'lastAutoRun is not part of the rules object');
});

// ---------- moveCustomers ----------

const T0 = '2026-10-09T08:00:00.000Z';
const hours = (h) => new Date(Date.parse(T0) + h * 3600000).toISOString();
const poolState = (more = {}, extra = {}) => withRules({
  orders: [],
  customers: {
    A: profile('A', { owner: 'Kris' }),
    B: profile('B', { owner: 'Kris' }),
    C: profile('C', { owner: 'Kris' }),
    Away: profile('Away', { owner: '', laiBucket: 'pool', laiPreviousOwner: 'Kris', lastPoolEntry: hours(-24 * 3) }),
    Away2: profile('Away2', { owner: '', laiBucket: 'pool', laiPreviousOwner: 'Kris', lastPoolEntry: hours(-24 * 3) }),
    Nobody: profile('Nobody', { owner: '', laiBucket: 'pool' }),
  },
  laiSettings: {},
  ...extra,
}, [], more);

test('move to pool: reason optional by default, stored and written to history once', () => {
  const s = poolState();
  const plain = L.moveCustomers(s, ['A'], 'pool', T0);
  assert.equal(L.bucket(plain.customers.A), 'pool');
  assert.equal(plain.customers.A.poolReason, undefined);
  assert.deepEqual(plain.customers.A.history[0], { time: T0, text: '移入公海', type: 'operation' });
  const why = L.moveCustomers(s, ['A', 'B'], 'pool', T0, { reason: '  客户转行  ' });
  assert.equal(why.customers.A.poolReason, '客户转行');
  assert.equal(why.customers.B.history[0].text, '移入公海，原因：客户转行');
  assert.equal(why.customers.A.history.length, 1);
  assert.throws(() => L.moveCustomers(s, ['A'], 'pool', T0, { reason: 'x'.repeat(51) }), /50/);
  assert.equal(L.moveCustomers(s, ['A'], 'pool', T0, { reason: 'x'.repeat(50) }).customers.A.poolReason.length, 50);
});

test('move to pool: requireReason makes the reason mandatory', () => {
  const s = poolState({ requireReason: true, reasons: ['客户转行'] });
  assert.throws(() => L.moveCustomers(s, ['A'], 'pool', T0), /请选择移入公海的原因/);
  assert.throws(() => L.moveCustomers(s, ['A'], 'pool', T0, { reason: '   ' }), /请选择移入公海的原因/);
  assert.equal(L.bucket(L.moveCustomers(s, ['A'], 'pool', T0, { reason: '客户转行' }).customers.A), 'pool');
  assert.equal(L.bucket(L.moveCustomers(s, ['Away'], 'active', T0).customers.Away), 'active', 'claiming does not need a reason');
  assert.equal(L.bucket(L.moveCustomers(s, ['A'], 'trash', T0).customers.A), 'trash', 'trash does not need a reason');
});

test('claim: previous owner by default, another owner when given, records poolClaims', () => {
  const s = poolState();
  const back = L.moveCustomers(s, ['Away'], 'active', T0);
  assert.equal(back.customers.Away.owner, 'Kris');
  assert.deepEqual(back.customers.Away.poolClaims, [{ owner: 'Kris', time: T0 }]);
  assert.equal(back.customers.Away.lastPrivatePoolEntry, T0);
  const other = L.moveCustomers(s, ['Away'], 'active', T0, { owner: ' Mia ' });
  assert.equal(other.customers.Away.owner, 'Mia');
  assert.equal(other.customers.Away.laiPreviousOwner, 'Kris');
  assert.deepEqual(other.customers.Away.poolClaims, [{ owner: 'Mia', time: T0 }]);
  const noOwner = L.moveCustomers(s, ['Nobody'], 'active', T0);
  assert.equal(noOwner.customers.Nobody.owner, '');
  assert.equal(noOwner.customers.Nobody.poolClaims, undefined);
  assert.equal(L.moveCustomers(s, ['Nobody'], 'active', T0, { owner: 'Mia' }).customers.Nobody.owner, 'Mia');
});

test('reclaimBlockDays: the previous owner waits, others and later dates are fine', () => {
  const s = poolState({ reclaimBlockDays: 7 }); // 3 天前进的公海
  assert.throws(() => L.moveCustomers(s, ['Away'], 'active', T0), /原跟进人 7 天内不能领回这个客户，还要等 4 天/);
  assert.throws(() => L.moveCustomers(s, ['Away'], 'active', T0, { owner: 'Kris' }), /还要等 4 天/);
  assert.throws(() => L.moveCustomers(s, ['Away'], 'active', hours(24 * 3 + 12)), /还要等 1 天/);
  assert.equal(L.moveCustomers(s, ['Away'], 'active', T0, { owner: 'Mia' }).customers.Away.owner, 'Mia');
  assert.equal(L.moveCustomers(s, ['Away'], 'active', hours(24 * 4)).customers.Away.owner, 'Kris', '7 days have passed');
  assert.equal(L.moveCustomers(poolState({ reclaimBlockDays: 0 }), ['Away'], 'active', T0).customers.Away.owner, 'Kris');
});

test('claim limits: per period, per owner override, batch counts every customer', () => {
  const s = poolState({ claimLimit: { periodDays: 2, defaultLimit: 2, perOwner: { Mia: 1 } } });
  const one = L.moveCustomers(s, ['Away'], 'active', T0);
  assert.equal(T.claimCount(one, 'Kris', new Date(T0)), 1);
  assert.equal(T.claimLimitFor(one, 'Kris'), 2);
  assert.equal(T.claimLimitFor(one, 'Mia'), 1);
  // 同一批两位：刚好到上限
  assert.doesNotThrow(() => L.moveCustomers(s, ['Away', 'Away2'], 'active', T0));
  // 批量超出上限
  assert.throws(() => L.moveCustomers(s, ['Away', 'Away2', 'Nobody'], 'active', T0, { owner: 'Kris' }), /Kris 2 天内最多领取 2 位客户，已领 0 位/);
  // 已领 1 位，再来 2 位超出
  assert.throws(() => L.moveCustomers(one, ['Away2', 'Nobody'], 'active', hours(1), { owner: 'Kris' }), /已领 1 位/);
  // 每人单独的上限
  assert.throws(() => L.moveCustomers(s, ['Away', 'Away2'], 'active', T0, { owner: 'Mia' }), /Mia 2 天内最多领取 1 位客户，已领 0 位/);
  // 过了统计天数就重新算
  assert.equal(T.claimCount(one, 'Kris', new Date(hours(24 * 2 + 1))), 0);
  assert.doesNotThrow(() => L.moveCustomers(one, ['Away2', 'Nobody'], 'active', hours(24 * 2 + 1), { owner: 'Kris' }));
  // 0 = 不限
  const free = poolState({ claimLimit: { periodDays: 1, defaultLimit: 0, perOwner: {} } });
  assert.doesNotThrow(() => L.moveCustomers(free, ['Away', 'Away2', 'Nobody'], 'active', T0, { owner: 'Kris' }));
  assert.equal(T.claimCount(free, 'Kris', new Date(T0)), 0);
});

test('the customer-count cap from the customer settings is still enforced when claiming', () => {
  const s = CS.setCaps(poolState({ reclaimBlockDays: 0 }), { defaultLimit: 3 }); // Kris already has A B C
  assert.throws(() => L.moveCustomers(s, ['Away'], 'active', T0), /上限是 3/);
  assert.throws(() => L.moveCustomers(s, ['Away'], 'active', T0, { owner: 'Kris' }), /上限是 3/);
  assert.equal(L.moveCustomers(s, ['Away'], 'active', T0, { owner: 'Mia' }).customers.Away.owner, 'Mia');
});

test('poolClaims keeps only the newest 20 entries', () => {
  let s = poolState();
  for (let i = 0; i < 25; i++) {
    s = L.moveCustomers(s, ['A'], 'pool', hours(i * 2));
    s = L.moveCustomers(s, ['A'], 'active', hours(i * 2 + 1), { owner: 'Kris' });
  }
  const claims = s.customers.A.poolClaims;
  assert.equal(claims.length, 20);
  assert.equal(claims.at(-1).time, hours(24 * 2 + 1));
  assert.equal(claims[0].time, hours(5 * 2 + 1));
});

test('existing behaviour is kept: pool keeps lastPoolEntry/poolEntryCount, claim keeps lastPrivatePoolEntry', () => {
  let s = poolState();
  s = L.moveCustomers(s, ['A'], 'pool', T0);
  assert.equal(s.customers.A.lastPoolEntry, T0);
  assert.equal(s.customers.A.poolEntryCount, 1);
  assert.equal(s.customers.A.owner, '');
  assert.equal(s.customers.A.laiPreviousOwner, 'Kris');
  assert.throws(() => L.moveCustomers(s, ['missing'], 'pool', T0), /客户不存在/);
});
