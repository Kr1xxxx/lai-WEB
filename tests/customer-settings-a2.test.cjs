const test = require('node:test');
const assert = require('node:assert/strict');
const CS = require('../src/customer-settings-model.js');
const M = require('../src/model.js');
const S = require('../src/segments.js');

const withSettings = (patch, extra = {}) => ({ orders: [], customers: {}, ...extra, laiSettings: { customerSettings: patch } });
const ALL = CS.FOLLOW_ACTIONS.map(([key]) => key);

test('FOLLOW_ACTIONS lists the seven actions in order', () => {
  assert.deepEqual(ALL, ['followup', 'mailSent', 'mailReceived', 'chat', 'order', 'opportunity', 'claim']);
  assert.equal(CS.FOLLOW_ACTIONS[0][1], '写跟进');
  assert.ok(Object.isFrozen(CS.FOLLOW_ACTIONS));
});

test('defaults for every new key, also from missing or broken data', () => {
  for (const state of [{}, null, withSettings(null), withSettings({ followRules: 5, dealRule: 'x', activity: [], followup: 'bad' })]) {
    const s = CS.get(state);
    assert.deepEqual(s.followRules, { contact: ALL, followup: ['followup', 'mailSent', 'chat'] });
    assert.deepEqual(s.dealRule, { by: 'order' });
    assert.deepEqual(s.activity, { autoMail: false, since: '' });
    assert.deepEqual(s.followup, { allowPastTime: false, templates: [] });
  }
});

test('normalization drops unknown keys, keeps order, and falls back when empty', () => {
  const s = CS.get(withSettings({
    followRules: { contact: ['claim', 'nope', 'followup'], followup: ['nope'] },
    dealRule: { by: 'weird' },
    activity: { autoMail: true, since: 'not a date' },
    followup: { allowPastTime: 'yes', templates: [
      { id: 'a', name: 'A', items: [{ id: 'i', text: ' hi ' }, { text: '' }, null] },
      { id: 'b', name: 'a', items: [] },
      { name: '' },
      { name: 'x'.repeat(21) },
      null,
    ] },
  }));
  assert.deepEqual(s.followRules.contact, ['followup', 'claim']);
  assert.deepEqual(s.followRules.followup, ['followup', 'mailSent', 'chat']);
  assert.equal(s.dealRule.by, 'order');
  assert.deepEqual(s.activity, { autoMail: true, since: '' });
  assert.equal(s.followup.allowPastTime, false);
  assert.equal(s.followup.templates.length, 1);
  assert.deepEqual(s.followup.templates[0].items, [{ id: 'i', text: 'hi' }]);
});

test('setFollowRules validates each list and does not touch the other', () => {
  const state = CS.setFollowRules({}, { contact: ['mailSent'], followup: ['chat', 'followup', 'zzz'] });
  assert.deepEqual(CS.get(state).followRules, { contact: ['mailSent'], followup: ['followup', 'chat'] });
  assert.throws(() => CS.setFollowRules({}, { contact: [], followup: ['chat'] }), /请至少选一项“算作最近联系”的动作/);
  assert.throws(() => CS.setFollowRules({}, { contact: ['chat'], followup: ['zzz'] }), /请至少选一项“算作最近跟进”的动作/);
  const only = CS.setFollowRules(state, { contact: ['chat'] });
  assert.deepEqual(CS.get(only).followRules.followup, ['followup', 'chat']);
});

const customerState = (rules, extra = {}) => ({
  ...withSettings(rules ? { followRules: rules } : {}),
  customers: {
    Acme: {
      history: [
        { time: '2026-09-01T00:00:00Z', type: 'followup' },
        { time: '2026-09-02T00:00:00Z', type: 'email', subtype: 'sent' },
        { time: '2026-09-03T00:00:00Z', type: 'email', subtype: 'received' },
        { date: '2026-09-04T00:00:00Z', type: 'chat' },
        { time: '2026-09-05T00:00:00Z', type: 'call' },
        { time: 'garbage', type: 'followup' },
        { time: '2026-12-01T00:00:00Z', type: 'operation' },
      ],
      lastPrivatePoolEntry: '2026-09-06T00:00:00Z',
    },
    Empty: {},
  },
  orders: [
    { client: 'Acme', createdAt: '2026-09-07T00:00:00Z', updated: '2026-09-08T00:00:00Z' },
    { client: 'Acme', createdAt: '2027-01-01T00:00:00Z', isDraft: true },
    { client: 'Other', createdAt: '2027-01-01T00:00:00Z' },
  ],
  laiOpportunities: [
    { id: 'o1', client: 'Acme', createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' },
    { id: 'o2', client: 'Other', createdAt: '2027-02-01T00:00:00Z' },
  ],
  ...extra,
});

test('contactTimes: every action counts by default for lastContact', () => {
  assert.deepEqual(CS.contactTimes(customerState(), 'Acme'), { lastContact: '2026-09-10T00:00:00Z', lastFollowup: '2026-09-05T00:00:00Z' });
  assert.deepEqual(CS.contactTimes(customerState(), 'Empty'), { lastContact: '', lastFollowup: '' });
  assert.deepEqual(CS.contactTimes(customerState(), 'Nobody'), { lastContact: '', lastFollowup: '' });
});

test('contactTimes: each action on its own', () => {
  const only = (key) => CS.contactTimes(customerState({ contact: [key], followup: [key] }), 'Acme').lastContact;
  assert.equal(only('followup'), '2026-09-01T00:00:00Z');
  assert.equal(only('mailSent'), '2026-09-02T00:00:00Z');
  assert.equal(only('mailReceived'), '2026-09-03T00:00:00Z');
  assert.equal(only('chat'), '2026-09-05T00:00:00Z');
  assert.equal(only('order'), '2026-09-08T00:00:00Z');
  assert.equal(only('opportunity'), '2026-09-10T00:00:00Z');
  assert.equal(only('claim'), '2026-09-06T00:00:00Z');
});

test('contactTimes: turning an action off removes it; the legacy saved value is a floor', () => {
  const rules = { contact: ['followup', 'chat'], followup: ['followup'] };
  assert.equal(CS.contactTimes(customerState(rules), 'Acme').lastContact, '2026-09-05T00:00:00Z');
  const legacyLater = customerState(rules);
  legacyLater.customers.Acme.lastContact = '2026-11-01';
  legacyLater.customers.Acme.lastFollowup = '2026-08-01';
  assert.deepEqual(CS.contactTimes(legacyLater, 'Acme'), { lastContact: '2026-11-01', lastFollowup: '2026-09-01T00:00:00Z' });
  const legacyOnly = withSettings({}, { customers: { X: { lastContact: '2026-01-02', lastFollowup: 'bad' } } });
  assert.deepEqual(CS.contactTimes(legacyOnly, 'X'), { lastContact: '2026-01-02', lastFollowup: '' });
});

const dealState = (by) => ({
  ...withSettings(by ? { dealRule: { by } } : {}),
  customers: { Acme: { opportunityLastWonDate: '2026-05-05' } },
  orders: [
    { client: 'Acme', stage: 'done', createdAt: '2026-01-01' },
    { client: 'Acme', stage: 'shipment', createdAt: '2026-02-01', shippedAt: '2026-03-03' },
    { client: 'Acme', stage: 'quote', createdAt: '2026-08-01' },
    { client: 'Acme', stage: 'done', createdAt: '2026-09-01', isDraft: true },
    { client: 'Other', stage: 'done', createdAt: '2026-10-01' },
  ],
});

test('dealRule setter and lastDealDate in both modes', () => {
  assert.throws(() => CS.setDealRule({}, 'x'), /请选择成交的算法/);
  assert.equal(CS.lastDealDate(dealState(), 'Acme'), '2026-03-03');
  assert.equal(CS.lastDealDate(dealState(), 'Nobody'), '');
  const opp = CS.setDealRule(dealState(), 'opportunity');
  assert.equal(CS.get(opp).dealRule.by, 'opportunity');
  assert.equal(CS.lastDealDate(opp, 'Acme'), '2026-05-05');
  assert.equal(CS.lastDealDate(opp, 'Other'), '');
  assert.equal(CS.lastDealDate(CS.setDealRule(opp, 'order'), 'Acme'), '2026-03-03');
});

test('activity: autoMail records the start time once, keeps it when turned off', () => {
  assert.equal(CS.autoMailSince({}), '');
  const on = CS.setActivity({}, { autoMail: true }, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(CS.get(on).activity, { autoMail: true, since: '2026-10-01T00:00:00.000Z' });
  assert.equal(CS.autoMailSince(on), '2026-10-01T00:00:00.000Z');
  const again = CS.setActivity(on, { autoMail: true }, '2026-11-01T00:00:00.000Z');
  assert.equal(CS.autoMailSince(again), '2026-10-01T00:00:00.000Z');
  const off = CS.setActivity(on, { autoMail: false }, '2026-12-01T00:00:00.000Z');
  assert.equal(CS.autoMailSince(off), '');
  assert.equal(off.laiSettings.customerSettings.activity.since, '2026-10-01T00:00:00.000Z');
  const back = CS.setActivity(off, { autoMail: true }, '2027-01-01T00:00:00.000Z');
  assert.equal(CS.autoMailSince(back), '2027-01-01T00:00:00.000Z');
});

test('template groups and items: CRUD, order, validation and limits', () => {
  let state = CS.addTemplateGroup({}, '  问候  ');
  const g = CS.get(state).followup.templates[0];
  assert.equal(g.name, '问候');
  assert.throws(() => CS.addTemplateGroup(state, '问候'), /已有同名分组/);
  assert.throws(() => CS.addTemplateGroup(state, ' '), /请填写/);
  assert.throws(() => CS.addTemplateGroup(state, 'x'.repeat(21)), /最长 20/);
  state = CS.addTemplateGroup(state, '报价');
  const [a, b] = CS.get(state).followup.templates;
  assert.throws(() => CS.renameTemplateGroup(state, b.id, '问候'), /已有同名分组/);
  state = CS.renameTemplateGroup(state, b.id, '报价单');
  assert.equal(CS.get(state).followup.templates[1].name, '报价单');
  state = CS.moveTemplateGroup(state, b.id, -1);
  assert.deepEqual(CS.get(state).followup.templates.map((x) => x.name), ['报价单', '问候']);
  assert.equal(CS.moveTemplateGroup(state, b.id, -1), state);
  assert.throws(() => CS.moveTemplateGroup(state, 'nope', 1), /找不到这个分组/);

  state = CS.addTemplate(state, a.id, '  您好  ');
  let item = CS.get(state).followup.templates.find((x) => x.id === a.id).items[0];
  assert.equal(item.text, '您好');
  assert.throws(() => CS.addTemplate(state, a.id, '  '), /请填写/);
  assert.throws(() => CS.addTemplate(state, a.id, 'x'.repeat(501)), /最长 500/);
  state = CS.addTemplate(state, a.id, 'x'.repeat(500));
  state = CS.editTemplate(state, a.id, item.id, '你好');
  assert.equal(CS.get(state).followup.templates.find((x) => x.id === a.id).items[0].text, '你好');
  assert.throws(() => CS.editTemplate(state, a.id, 'nope', 'x'), /找不到这条模板/);
  assert.throws(() => CS.editTemplate(state, 'nope', item.id, 'x'), /找不到这个分组/);
  assert.throws(() => CS.deleteTemplate(state, a.id, 'nope'), /找不到这条模板/);
  state = CS.deleteTemplate(state, a.id, item.id);
  assert.equal(CS.get(state).followup.templates.find((x) => x.id === a.id).items.length, 1);
  state = CS.deleteTemplateGroup(state, a.id);
  assert.deepEqual(CS.get(state).followup.templates.map((x) => x.id), [b.id]);
  assert.throws(() => CS.deleteTemplateGroup(state, a.id), /找不到这个分组/);
});

test('template limits: 30 groups, 100 items per group', () => {
  let state = {};
  for (let i = 0; i < 30; i++) state = CS.addTemplateGroup(state, `g${i}`);
  assert.throws(() => CS.addTemplateGroup(state, 'more'), /最多 30/);
  const id = CS.get(state).followup.templates[0].id;
  for (let i = 0; i < 100; i++) state = CS.addTemplate(state, id, `t${i}`);
  assert.throws(() => CS.addTemplate(state, id, 'more'), /最多 100/);
  assert.equal(CS.get(state).followup.templates[0].items.length, 100);
});

test('checkFollowupTime', () => {
  const now = new Date('2026-10-09T12:00:00.000Z');
  const off = {};
  const on = CS.setFollowupOptions({}, { allowPastTime: true });
  assert.equal(CS.get(on).followup.allowPastTime, true);
  assert.equal(CS.checkFollowupTime(off, '', now), now.toISOString());
  assert.equal(CS.checkFollowupTime(on, '  ', now), now.toISOString());
  assert.throws(() => CS.checkFollowupTime(off, '2026-10-01T10:00', now), /现在不允许填写历史跟进时间/);
  assert.throws(() => CS.checkFollowupTime(on, 'tomorrow-ish', now), /跟进时间无效/);
  assert.throws(() => CS.checkFollowupTime(on, '2026-10-09T12:02:00.000Z', now), /跟进时间不能晚于现在/);
  assert.equal(CS.checkFollowupTime(on, '2026-10-09T12:00:30.000Z', now), '2026-10-09T12:00:30.000Z');
  assert.equal(CS.checkFollowupTime(on, '2026-10-01T10:00:00.000Z', now), '2026-10-01T10:00:00.000Z');
  const local = CS.checkFollowupTime(on, '2026-10-01T10:00', now);
  assert.equal(local, new Date(2026, 9, 1, 10, 0).toISOString());
  assert.equal(CS.get(CS.setFollowupOptions(on, { allowPastTime: false })).followup.allowPastTime, false);
});

test('enrich exposes lastContact, lastFollowup and lastDealDate by the rules', () => {
  const state = {
    ...withSettings({ followRules: { contact: ['mailSent'], followup: ['followup', 'order'] } }),
    customers: {
      Acme: { history: [
        { time: '2026-09-01T00:00:00Z', type: 'followup' },
        { time: '2026-09-02T00:00:00Z', type: 'email', subtype: 'sent' },
        { time: '2026-09-03T00:00:00Z', type: 'chat' },
      ], opportunityLastWonDate: '2026-05-05' },
    },
    orders: [{ client: 'Acme', amount: 10, currency: 'USD', stage: 'done', createdAt: '2026-08-01', shippedAt: '2026-08-04', updated: '2026-09-15T00:00:00Z' }],
  };
  const row = () => S.enrich(M.buildCustomers(state), state).find((r) => r.name === 'Acme');
  assert.equal(row().lastContact, '2026-09-02T00:00:00Z');
  assert.equal(row().lastFollowup, '2026-09-15T00:00:00Z');
  assert.equal(row().lastDealDate, '2026-08-04');
  const opp = CS.setDealRule(state, 'opportunity');
  assert.equal(S.enrich(M.buildCustomers(opp), opp).find((r) => r.name === 'Acme').lastDealDate, '2026-05-05');
});

test('a follow-up time saved on the profile (imported customers without history) counts as 写跟进', () => {
  const state = { orders: [], customers: { Old: { client: 'Old', lastFollowup: '2026-10-01T00:00:00.000Z' } } };
  assert.equal(CS.contactTimes(state, 'Old').lastContact, '2026-10-01T00:00:00.000Z');
  const off = { ...state, laiSettings: { customerSettings: { followRules: { contact: ['mailSent'] } } } };
  assert.equal(CS.contactTimes(off, 'Old').lastContact, '');
});
