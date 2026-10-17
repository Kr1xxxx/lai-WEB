'use strict';
// 线索（D-030）和协同／任务（D-031）的代码去掉了，但存着的数据一条都不能丢：
// 老数据里的 laiLeads、线索设置、线索字段、线索判重、商机上的来源线索、客户上的关联线索，
// 以及 laiTasks、任务规则、团队目标里的「任务完成」目标，在平常的修改和保存之后都要原样留着。
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.js');
const O = require('../src/opportunity-model.js');
const CS = require('../src/customer-settings-model.js');
const R = require('../src/role-model.js');
const FS = require('../src/feature-switch-model.js');
const F = require('../src/field-model.js');
const B = require('../src/business-model.js');
const TM = require('../src/team-model.js');

const NOW = '2026-10-17T08:00:00.000Z';
const clone = (value) => JSON.parse(JSON.stringify(value));

// 一份带着所有“已去掉功能”数据的老状态。
function oldState() {
  return {
    customers: {
      Acme: { client: 'Acme', owner: 'Kris', country: '美国', linkedLead: 'Acme 线索', lastConvertedLeadCreated: '2026-05-01T00:00:00.000Z', sourceLead: 'L1',
        history: [{ time: '2026-05-02T00:00:00.000Z', type: 'operation', text: '由线索转入：Acme 线索' }] },
    },
    orders: [],
    laiOpportunities: [{ id: 'p1', name: 'Big deal', client: 'Acme', owner: 'Kris', amount: 100, currency: 'USD', endDate: '2026-11-30', flow: 'default', stage: 'open', leadId: 'L1', createdAt: '2026-06-01T00:00:00.000Z' }],
    laiLeads: [
      { id: 'L1', name: 'Acme 线索', owner: 'Kris', status: 'converted', convertedTo: 'Acme', custom: { f1: '蓝色' }, history: [{ type: 'followup', text: '打过电话' }] },
      { id: 'L2', name: 'Beta 线索', owner: 'Amy', status: 'following', trashed: true },
    ],
    laiTasks: [
      { id: 't1', title: '回电话', customer: 'Acme', owner: 'Kris', date: '2026-10-20', done: false },
      { id: 't2', title: '自动任务', customer: 'Acme', owner: 'Kris', date: '2026-10-01', done: true, auto: { key: 'noFollow|Acme|2026-10-01' } },
    ],
    laiTargets: [
      { metric: 'tasksDone', period: '2026-10', owner: null, currency: '', value: 20 },
      { metric: 'orders', period: '2026-10', owner: null, currency: '', value: 5 },
    ],
    laiSettings: {
      defaultOwner: 'Kris',
      leadSettings: { reasons: ['没有需求', '联系不上'], fields: { email: { required: true } } },
      taskRules: { rules: [{ type: 'noFollow', enabled: true, days: 30 }, { type: 'oppClose', enabled: true, days: 7 }], lastRun: '2026-10-16', dismissed: [], skipped: [] },
      fieldSettings: { lead: { customFields: [{ id: 'f1', name: '颜色', type: 'text' }], required: { country: true } } },
      customerSettings: { leadDedupe: { name: 'block', website: 'allow', email: 'off', phone: 'block' } },
      opportunitySettings: { fields: { leadId: { show: true, required: true } } },
      featureSwitch: { off: ['lead'] },
    },
  };
}

// 被检查的“老数据”：去掉的功能留下的每一处。
function kept(state) {
  return {
    laiLeads: state.laiLeads,
    laiTasks: state.laiTasks,
    tasksDoneTarget: (state.laiTargets || []).filter((target) => target.metric === 'tasksDone'),
    leadSettings: state.laiSettings?.leadSettings,
    taskRules: state.laiSettings?.taskRules,
    leadFields: state.laiSettings?.fieldSettings?.lead,
    leadDedupe: state.laiSettings?.customerSettings?.leadDedupe,
    leadIdSetting: state.laiSettings?.opportunitySettings?.fields?.leadId,
    oppLeadId: (state.laiOpportunities || []).find((item) => item.id === 'p1')?.leadId,
    customerLead: ['linkedLead', 'lastConvertedLeadCreated', 'sourceLead'].map((key) => state.customers?.Acme?.[key]),
    convertedHistory: (state.customers?.Acme?.history || []).filter((item) => /由线索转入/.test(item.text)),
  };
}

test('everyday edits through the models leave every piece of lead and task data exactly as it was', () => {
  const start = oldState();
  const before = clone(kept(start));
  const saved = M.snapshotState(start);
  let s = start;
  // 客户：改资料、写跟进
  s = M.upsertCustomer(s, 'Acme', { ...s.customers.Acme, name: 'Acme', note: '老客户' }, NOW);
  s = M.addFollowup(s, 'Acme', '电话沟通了报价', '2026-10-25', NOW);
  // 商机：新建一个、改一个
  s = O.upsert(s, 'p2', { client: 'Acme', amount: '50', currency: 'USD', owner: 'Kris', stage: 'open', endDate: '2026-12-01', contact: '' }, { now: NOW, today: '2026-10-17' });
  s = O.upsert(s, 'p1', { note: '谈到第二轮' }, { now: NOW, today: '2026-10-17', mustExist: true });
  s = O.setField(s, 'note', { required: false });
  // 订单
  s = B.upsertOrder(s, 'o1', { num: 'L-1', client: 'Acme', country: 'US', productType: 'Lash', amount: '100', currency: 'USD', paidAmount: '0', stage: 'quote', createdAt: '2026-10-17', owner: 'Kris', isDraft: false, items: [] });
  // 设置：客户判重、来源、成交规则；字段；角色；功能开关；团队目标
  s = CS.setDedupe(s, { ...CS.get(s).dedupe, email: 'block' });
  s = CS.addSource(s, { name: '展会' });
  s = CS.setDealRule(s, 'order');
  s = F.addField(s, 'customer', { name: '等级', type: 'text' }, { id: 'c1' });
  s = R.addMember(s, { name: 'Amy' });
  s = R.updateRole(s, 'sales', { perms: { 'opp.view': true, 'customer.view': true } });
  s = FS.set(s, 'mail', false);
  s = FS.set(s, 'mail', true);
  s = TM.setTarget(s, { metric: 'orders', period: '2026-10', scope: 'company', value: '8' });

  // the edits really happened
  assert.equal(s.customers.Acme.note, '老客户');
  assert.equal(s.laiOpportunities.length, 2);
  assert.equal(s.orders.length, 1);
  assert.equal(CS.get(s).dedupe.email, 'block');
  assert.equal(TM.listTargets(s).find((target) => target.metric === 'orders').value, 8);
  // and nothing of the removed features moved
  assert.deepEqual(kept(s), before);
  assert.deepEqual(kept(start), before, 'the starting state was not changed in place either');

  // the save never asks the server to drop a key, and the untouched keys are not even resent
  const { changes } = M.diffState(saved, s);
  assert.deepEqual(changes.removeAppState, []);
  for (const key of ['laiLeads', 'laiTasks']) assert.ok(!Object.hasOwn(changes.appState, key), `${key} is unchanged, so it is not resent`);
  assert.deepEqual(changes.appState.laiSettings.leadSettings, before.leadSettings);
  assert.deepEqual(changes.appState.laiSettings.taskRules, before.taskRules);
  assert.deepEqual(changes.customers.set.Acme.sourceLead, 'L1');
});

test('renaming a customer or a member keeps the stored tasks and leads pointing at the right names', () => {
  let s = oldState();
  s = M.upsertCustomer(s, 'Acme', { ...s.customers.Acme, name: 'Acme Ltd' }, NOW);
  assert.deepEqual(s.laiTasks.map((task) => task.customer), ['Acme Ltd', 'Acme Ltd'], 'tasks follow the customer rename');
  const kris = R.settings(s).members.find((member) => member.name === 'Kris');
  s = R.renameMember(s, kris.id, 'Chris');
  assert.deepEqual(s.laiLeads.map((lead) => lead.owner), ['Chris', 'Amy']);
  assert.deepEqual(s.laiTasks.map((task) => task.owner), ['Chris', 'Chris']);
  assert.equal(s.laiLeads[0].custom.f1, '蓝色', 'the rest of the record is untouched');
});
