// 待办属于一个人（D-022）：默认负责人、谁能改负责人、按范围看待办、老待办的回退、团队数据按负责人算。
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/business-model.js');
const R = require('../src/role-model.js');
const T = require('../src/team-model.js');

const members = [
  { id: 'm-kris', name: 'Kris', roleId: 'admin' },
  { id: 'm-amy', name: 'Amy', roleId: 'sales', deptId: 'd1' },
  { id: 'm-bob', name: 'Bob', roleId: 'lead', deptId: 'd1' },
  { id: 'm-eve', name: 'Eve', roleId: 'sales', deptId: 'd2' },
];
const names = members.map((m) => m.name);
const base = (current, extra = {}) => ({
  customers: { Alpha: { owner: 'Amy' }, Beta: { owner: 'Bob' }, Gamma: { owner: 'Eve' } },
  laiSettings: {
    roles: {
      roles: [{ id: 'sales', name: '业务', scope: 'self', perms: {}, v: 2 }, { id: 'lead', name: '主管', scope: 'dept', perms: { 'customer.reassign': true }, v: 2 }],
      departments: [{ id: 'd1', name: '一部' }, { id: 'd2', name: '二部' }],
      members,
      current,
    },
  },
  laiTasks: [
    { id: 'own-amy', title: 'Amy task', date: '2026-10-05', done: false, owner: 'Amy' },
    { id: 'own-eve', title: 'Eve task', date: '2026-10-06', done: false, owner: 'Eve' },
    { id: 'legacy-bob', title: 'Legacy Bob', date: '2026-10-07', done: false, customer: 'Beta' },
    { id: 'legacy-none', title: 'Legacy none', date: '2026-10-08', done: false },
    { id: 'legacy-ghost', title: 'Legacy ghost customer', date: '2026-10-09', done: false, customer: 'Nobody Ltd' },
  ],
  ...extra,
});
const idsFor = (state) => B.visibleTasks(state, (owner) => R.canSee(state, owner)).map((t) => t.id);

test('setTask: a new task belongs to the creating account; the owner key is left off when no account is given', () => {
  const state = base('m-amy');
  const mine = B.setTask(state, 't1', { title: 'Call', date: '2026-10-10' }, { me: 'Amy', canReassign: false, members: names });
  assert.equal(mine.laiTasks[0].owner, 'Amy');
  assert.equal(mine.laiTasks[0].done, false);
  const raw = B.setTask({}, 't2', { title: 'Call', date: '2026-10-10' });
  assert.deepEqual(raw.laiTasks, [{ id: 't2', title: 'Call', date: '2026-10-10', done: false }], 'old callers see no new key');
});

test('setTask: without the reassign permission the owner of a new or existing task cannot be set or changed', () => {
  const state = base('m-amy');
  const forged = B.setTask(state, 't1', { title: 'Call', date: '2026-10-10', owner: 'Kris' }, { me: 'Amy', canReassign: false, members: names });
  assert.equal(forged.laiTasks[0].owner, 'Amy', 'a forged owner on a new task is ignored');
  const moved = B.setTask(state, 'own-amy', { title: 'Amy task', date: '2026-10-05', owner: 'Eve' }, { me: 'Amy', canReassign: false, members: names });
  assert.equal(moved.laiTasks.find((t) => t.id === 'own-amy').owner, 'Amy');
  const legacy = B.setTask(state, 'legacy-none', { title: 'Legacy none', date: '2026-10-08', owner: 'Amy' }, { me: 'Amy', canReassign: false, members: names });
  assert.ok(!('owner' in legacy.laiTasks.find((t) => t.id === 'legacy-none')), 'editing a legacy task does not claim it');
});

test('setTask: with the reassign permission the owner can be chosen from the member list only', () => {
  const state = base('m-kris');
  const own = B.setTask(state, 't1', { title: 'For Eve', date: '2026-10-10', owner: 'eve' }, { me: 'Kris', canReassign: true, members: names });
  assert.equal(own.laiTasks[0].owner, 'Eve', 'matches case-insensitively and takes the member spelling');
  const fallback = B.setTask(state, 't2', { title: 'Mine', date: '2026-10-10' }, { me: 'Kris', canReassign: true, members: names });
  assert.equal(fallback.laiTasks[0].owner, 'Kris', 'no owner chosen -> the creator');
  const moved = B.setTask(state, 'own-amy', { title: 'Amy task', date: '2026-10-05', owner: 'Bob' }, { me: 'Kris', canReassign: true, members: names });
  assert.equal(moved.laiTasks.find((t) => t.id === 'own-amy').owner, 'Bob');
  const assigned = B.setTask(state, 'legacy-none', { title: 'Legacy none', date: '2026-10-08', owner: 'Amy' }, { me: 'Kris', canReassign: true, members: names });
  assert.equal(assigned.laiTasks.find((t) => t.id === 'legacy-none').owner, 'Amy');
  assert.throws(() => B.setTask(state, 't3', { title: 'x', date: '2026-10-10', owner: 'Stranger' }, { me: 'Kris', canReassign: true, members: names }), /负责人/);
  const departed = { laiTasks: [{ id: 'x', title: 'Old', date: '2026-10-10', done: false, owner: 'Gone' }] };
  const kept = B.setTask(departed, 'x', { title: 'Old', date: '2026-10-10', owner: 'Gone' }, { me: 'Kris', canReassign: true, members: names });
  assert.equal(kept.laiTasks[0].owner, 'Gone', 'an unchanged owner who left the list is not an error');
});

test('setTask: ticking a task done (no account given) keeps the owner', () => {
  const state = base('m-amy');
  const task = state.laiTasks[0];
  const done = B.setTask(state, task.id, { ...task, done: true });
  assert.deepEqual(done.laiTasks[0], { ...task, done: true });
});

test('taskOwner: own owner first, then the linked customer owner, otherwise none', () => {
  const state = base('m-kris');
  const by = (id) => B.taskOwner(state, state.laiTasks.find((t) => t.id === id));
  assert.equal(by('own-amy'), 'Amy');
  assert.equal(by('legacy-bob'), 'Bob');
  assert.equal(by('legacy-none'), '');
  assert.equal(by('legacy-ghost'), '');
});

test('visibleTasks: 本人 sees only own tasks (and legacy ones through the customer); 本部门 its department; 全公司 everything', () => {
  assert.deepEqual(idsFor(base('m-amy')), ['own-amy'], 'Amy (本人): not Bob legacy task, not unassigned ones');
  const bobView = base('m-bob');
  assert.equal(R.scopeOf(bobView), 'dept');
  assert.deepEqual(idsFor(bobView), ['own-amy', 'legacy-bob'], 'Bob (本部门 d1): Amy and Bob, not Eve');
  assert.deepEqual(idsFor(base('m-kris')), ['own-amy', 'own-eve', 'legacy-bob', 'legacy-none', 'legacy-ghost'], 'admin sees all including unassigned');
  assert.equal(B.visibleTasks({ laiTasks: 5 }, () => true), 5, 'not a list -> returned as is');
});

test("visibleTasks: a task Amy created for a customer that is now Bob's stays hers", () => {
  const state = base('m-amy', { laiTasks: [{ id: 'k', title: 'k', date: '2026-10-05', done: false, owner: 'Amy', customer: 'Beta' }] });
  assert.deepEqual(idsFor(state), ['k']);
});

test('legacy task of a customer that is still Amy\'s is Amy\'s', () => {
  const state = base('m-amy', { laiTasks: [{ id: 'l', title: 'l', date: '2026-10-05', done: false, customer: 'Alpha' }] });
  assert.deepEqual(idsFor(state), ['l']);
});

test('calendarEvents carries the effective owner of a task event', () => {
  const events = B.calendarEvents(base('m-kris'), '2026-10').filter((e) => e.kind === 'task');
  assert.deepEqual(events.map((e) => [e.id, e.owner]), [['own-amy', 'Amy'], ['own-eve', 'Eve'], ['legacy-bob', 'Bob'], ['legacy-none', ''], ['legacy-ghost', '']]);
});

test('unassignedTasks: open tasks that have no owner of their own', () => {
  const state = base('m-kris');
  state.laiTasks.push({ id: 'done-old', title: 'd', date: '2026-10-01', done: true });
  assert.deepEqual(B.unassignedTasks(state).map((t) => t.id), ['legacy-bob', 'legacy-none', 'legacy-ghost']);
  assert.deepEqual(B.unassignedTasks({}), []);
});

test('renaming a member carries the task owner along', () => {
  const state = base('m-kris');
  const next = R.renameMember(state, 'm-amy', 'Amelia');
  assert.equal(next.laiTasks.find((t) => t.id === 'own-amy').owner, 'Amelia');
  assert.equal(next.laiTasks.find((t) => t.id === 'own-eve').owner, 'Eve');
});

test('team data: a task counts for its own owner, else the customer owner; the scope keeps own and legacy-through-customer tasks only', () => {
  const state = base('m-kris', { laiTasks: [
    { id: 'a', title: 'a', date: '2026-10-05', done: true, owner: 'Amy', customer: 'Beta' },
    { id: 'b', title: 'b', date: '2026-10-05', done: false, customer: 'Beta' },
    { id: 'c', title: 'c', date: '2026-10-05', done: false },
    { id: 'd', title: 'd', date: '2026-10-05', done: false, owner: 'Eve' },
  ] });
  const report = T.report('tasks', state, '2026-10');
  const row = (name) => report.rows.find((r) => r.owner === name);
  assert.equal(row('Amy').cells.total.value, 1, "task owner wins over the customer owner (Beta is Bob's)");
  assert.equal(row('Amy').cells.done.value, 1);
  assert.equal(row('Bob').cells.total.value, 1, 'legacy task falls back to the customer owner');
  assert.equal(row('Eve').cells.total.value, 1);
  assert.equal(report.total.total.value, 4);
  const sees = (name) => (owner) => String(owner || '').trim().toLowerCase() === name;
  assert.deepEqual(T.scopeState(state, sees('amy')).laiTasks.map((t) => t.id), ['a']);
  assert.deepEqual(T.scopeState(state, sees('bob')).laiTasks.map((t) => t.id), ['b']);
  assert.deepEqual(T.scopeState(state, () => true).laiTasks.map((t) => t.id), ['a', 'b', 'c', 'd']);
  assert.equal(T.report('tasks', T.scopeState(state, sees('amy')), '2026-10').total.total.value, 1);
});
