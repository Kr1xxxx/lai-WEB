// 客户设置 A2 in the customer flows: the pieces that are pure functions — detail page markup for the pool forecast,
// hidden pool contacts, 最近成交时间, the follow-up time field and template list, and the auto-record-mail picker.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.js');
const S = require('../src/segments.js');
const CSM = require('../src/customer-settings-model.js');
const CT = require('../src/customer-tools.js');
require('../src/mail-ui.js');
globalThis.LaiCustomerSettings = CSM;
globalThis.LaiCustomerTools = CT;
const D = require('../src/customer-detail-ui.js');
const Mail = globalThis.LaiMailUI;

const NOW = new Date('2026-10-09T12:00:00');
const day = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const rule = { id: 'r30', name: '30天未联系', enabled: true, kind: 'noContact', days: 30, groups: [], startDate: '' };
const base = (profile = {}, settings = {}) => ({
  orders: [],
  customers: { Acme: { client: 'Acme', owner: 'Kris', contact: 'Main', email: 'main@acme.example', createdAt: day(25), ...profile } },
  laiSettings: settings,
});
const render = (state, options = {}) => {
  const row = S.enrich(M.buildCustomers(state), state)[0];
  return D.render(row, { state, escape: M.escapeHtml, now: NOW, ...options });
};
const withRules = (state, input) => CT.setPoolRules(state, input);

test('pool forecast: a notice when the customer is close to a rule, a different one when already due', () => {
  const close = render(withRules(base(), { rules: [rule] }));
  assert.match(close, /<p class="lcd-pool-notice"[^>]*data-pool-forecast>还有 5 天移入公海（规则：30天未联系）<\/p>/);
  const due = render(withRules(base({ createdAt: day(40) }), { rules: [rule] }));
  assert.match(due, /lcd-pool-notice is-due[^>]*>已符合公海规则「30天未联系」，下次执行时会移入公海</);
  const far = render(withRules(base({ createdAt: day(2) }), { rules: [rule] }));
  assert.doesNotMatch(far, /data-pool-forecast/);
  assert.doesNotMatch(render(base()), /data-pool-forecast/, 'no rules: no notice');
  const pooled = render(withRules(base({ laiBucket: 'pool', createdAt: day(40) }), { rules: [rule] }));
  assert.doesNotMatch(pooled, /data-pool-forecast/, 'only for customers in use');
});

test('pool forecast: the rule name is escaped', () => {
  const html = render(withRules(base(), { rules: [{ ...rule, name: 'A<b>&' }] }));
  assert.match(html, /规则：A&lt;b&gt;&amp;）/);
});

test('hidden pool contacts: the contact card, the contact data and the edit buttons', () => {
  const pool = base({ laiBucket: 'pool', laiPreviousOwner: 'Kris', owner: '' });
  const shown = render(withRules(pool, { rules: [], showPoolContacts: true }));
  assert.match(shown, /main@acme\.example/);
  assert.doesNotMatch(shown, /公海联系人已隐藏/);
  assert.doesNotMatch(shown, /data-action="edit" disabled/);
  const hidden = render(withRules(pool, { rules: [], showPoolContacts: false }), { sideColumn: true });
  assert.match(hidden, /公海联系人已隐藏/);
  assert.doesNotMatch(hidden, /main@acme\.example|lcd-contact-header-actions/);
  const edits = hidden.match(/<button[^>]*data-action="edit"[^>]*>/g);
  assert.equal(edits.length, 2, 'header button and side-card link');
  for (const button of edits) assert.match(button, /disabled title="公海客户不能编辑（客户设置 → 公海管理）"/);
  // An active customer is never locked, whatever the pool option says.
  const active = render(withRules(base(), { rules: [], showPoolContacts: false }));
  assert.match(active, /main@acme\.example/);
  assert.doesNotMatch(active, /data-action="edit" disabled/);
});

test('最近成交时间 comes from the enriched row (成交 rule), with — when there is none', () => {
  const none = render(base());
  assert.match(none, /<dt>最近成交时间<\/dt><dd>—<\/dd>/);
  const deal = base();
  deal.orders = [{ id: 'o1', num: 'SO-1', client: 'Acme', amount: 10, stage: 'done', createdAt: '2026-08-02' }];
  assert.match(render(deal), /<dt>最近成交时间<\/dt><dd>2026-08-02<\/dd>/);
  assert.doesNotMatch(render(deal), /最近成交日期/);
});

test('follow-up time input: only when past times are allowed, max is now (local), the draft value is kept', () => {
  assert.equal(D.localInputTime(new Date('2026-10-09T09:05:00')), '2026-10-09T09:05');
  const off = render(base());
  assert.doesNotMatch(off, /name="followupTime"/);
  assert.equal(D.followupTimeInput(base(), { now: NOW }), '');
  const on = CSM.setFollowupOptions(base(), { allowPastTime: true });
  const html = render(on, { tab: 'activity', followupDraft: { text: 'x', time: '2026-10-01T08:00' } });
  assert.match(html, /<label class="lcd-followup-time">跟进时间（选填，留空为现在） <input type="datetime-local" name="followupTime" max="2026-10-09T12:00" value="2026-10-01T08:00"/);
  assert.match(D.followupTimeInput(on, { now: NOW, id: 'batch-time' }), /^<input id="batch-time" type="datetime-local" name="followupTime" max="2026-10-09T12:00" value=""/);
});

test('template button and list: real button, groups with their texts, an empty hint with 去设置', () => {
  const html = render(base(), { tab: 'activity' });
  assert.match(html, /<button type="button" class="lcd-feature" data-action="followup-templates"[^>]*>[\s\S]*?选择模板<\/button>/);
  assert.doesNotMatch(html, /data-feature="选择跟进模板"/, 'no placeholder entry any more');
  assert.match(D.followupTemplateList(base()), /还没有跟进模板[\s\S]*data-action="followup-templates-settings">去设置</);
  let state = CSM.addTemplateGroup(base(), '样品 <组>');
  state = CSM.addTemplateGroup(state, '空组');
  const [group] = CSM.get(state).followup.templates;
  state = CSM.addTemplate(state, group.id, '样品已寄出 & 请查收');
  const list = D.followupTemplateList(state, M.escapeHtml);
  assert.match(list, /<h5>样品 &lt;组&gt;<\/h5>/);
  assert.match(list, /data-template-item="[^"]+">样品已寄出 &amp; 请查收<\/button>/);
  assert.doesNotMatch(list, /空组/, 'groups without texts are left out');
  assert.doesNotMatch(list, /还没有跟进模板/);
  // A group list with only empty groups counts as empty.
  assert.match(D.followupTemplateList(CSM.addTemplateGroup(base(), '空组')), /还没有跟进模板/);
});

// ---- 自动记往来邮件 ----
const SINCE = '2026-10-01T00:00:00.000Z';
const mailOf = (extra = {}) => ({ box: 'inbox', uid: 1, messageId: '<a@x>', subject: 'Hi', snippet: 's', date: '2026-10-05T10:00:00.000Z', from: { name: 'A', address: 'a@acme.example' }, to: [{ address: 'me@mine.example' }], ...extra });
const customers = () => ({
  Acme: { email: 'A@Acme.example', contacts: [{ email: 'second@acme.example' }], extraContacts: [{ email: 'third@acme.example' }] },
  Pooled: { email: 'p@pool.example', laiBucket: 'pool' },
  Trashed: { email: 't@trash.example', laiBucket: 'trash' },
  Twin1: { email: 'same@twin.example' },
  Twin2: { contacts: [{ email: 'same@twin.example' }] },
});
const plan = (messages, extra = {}) => Mail.autoRecordPlan({ customers: customers(), messages, since: SINCE, ...extra });

test('auto-record: inbox matches the sender, sent matches the first recipient, contacts and extra contacts count', () => {
  const sent = mailOf({ box: 'sent', uid: 2, messageId: '<b@x>', from: { address: 'me@mine.example' }, to: [{ address: 'Second@acme.example' }, { address: 'other@z.example' }] });
  const third = mailOf({ uid: 3, messageId: '<c@x>', from: { address: 'third@acme.example' } });
  const result = plan([mailOf(), sent, third]);
  assert.deepEqual(result.map((item) => [item.name, item.mail.uid]), [['Acme', 1], ['Acme', 2], ['Acme', 3]]);
  assert.equal(result[1].mail.box, 'sent');
  assert.deepEqual(Object.keys(result[0].mail).sort(), ['box', 'date', 'from', 'messageId', 'snippet', 'subject', 'to', 'uid']);
});

test('auto-record: only the counterpart counts, not other recipients', () => {
  const toOther = mailOf({ box: 'sent', from: { address: 'me@mine.example' }, to: [{ address: 'other@z.example' }, { address: 'a@acme.example' }] });
  assert.deepEqual(plan([toOther]), [], 'sent: only the first recipient counts');
  assert.deepEqual(plan([mailOf({ from: { address: 'me@mine.example' }, to: [{ address: 'a@acme.example' }] })]), [], 'inbox: only the sender counts');
});

test('auto-record: skips pool, trash, ambiguous addresses, unknown addresses and mails before the start time', () => {
  const messages = [
    mailOf({ uid: 1, messageId: '<p>', from: { address: 'p@pool.example' } }),
    mailOf({ uid: 2, messageId: '<t>', from: { address: 't@trash.example' } }),
    mailOf({ uid: 3, messageId: '<w>', from: { address: 'same@twin.example' } }),
    mailOf({ uid: 4, messageId: '<u>', from: { address: 'nobody@z.example' } }),
    mailOf({ uid: 5, messageId: '<old>', date: '2026-09-30T23:59:59.000Z' }),
  ];
  assert.deepEqual(plan(messages), []);
  assert.deepEqual(plan([mailOf({ date: SINCE })]).map((item) => item.name), ['Acme'], 'exactly at the start time counts');
});

test('auto-record: no start time means off; recorded mails and repeats are skipped', () => {
  assert.deepEqual(plan([mailOf()], { since: '' }), []);
  assert.deepEqual(plan([mailOf()], { since: 'not a date' }), []);
  assert.deepEqual(plan([mailOf()], { isRecorded: () => true }), []);
  const once = plan([mailOf(), mailOf(), mailOf({ uid: 9 })]);
  assert.equal(once.length, 1, 'the same Message-ID twice in one batch is picked once');
  const state = base();
  state.customers.Acme.history = [];
  const first = M.addMailActivity(state, 'Acme', plan([mailOf()])[0].mail);
  assert.deepEqual(plan([mailOf()], { customers: first.customers, isRecorded: (name, mail) => M.mailRecorded(first, name, mail) }), [], 'after recording it is not picked again');
  // Without a Message-ID the box and uid identify the mail.
  assert.equal(plan([mailOf({ messageId: '', uid: 7 })]).length, 1);
  assert.deepEqual(plan([mailOf({ messageId: '', uid: 0 })]), []);
});

test('auto-record: odd mail and customer data never throws', () => {
  const odd = [null, undefined, 5, 'x', {}, { box: 'inbox' }, { box: 'trash', from: { address: 'a@acme.example' }, date: SINCE },
    mailOf({ from: null }), mailOf({ from: { address: 42 } }), mailOf({ date: 'never' }), mailOf({ date: undefined }),
    mailOf({ box: 'sent', to: 'a@acme.example' }), mailOf({ box: 'sent', to: [] }), mailOf({ box: 'sent', to: [null] })];
  assert.deepEqual(plan(odd), []);
  assert.deepEqual(plan('nope'), []);
  assert.deepEqual(Mail.autoRecordPlan({ customers: null, messages: [mailOf()], since: SINCE }), []);
  assert.deepEqual(Mail.autoRecordPlan({ customers: { Bad: null, Worse: 'x', Empty: {} }, messages: [mailOf()], since: SINCE }), []);
  assert.deepEqual(Mail.autoRecordPlan(), []);
  assert.deepEqual(plan([mailOf()], { isRecorded: () => { throw new Error('boom'); } }), [], 'a throwing check skips that mail');
});

test('auto-record: the plan applies in one state update and a second pass records nothing', () => {
  const state = base({ email: 'a@acme.example', history: [] });
  const messages = [mailOf(), mailOf({ uid: 2, messageId: '<b@x>' }), mailOf({ uid: 3, messageId: '<c@x>', from: { address: 'nobody@z.example' } })];
  const apply = (current) => Mail.autoRecordPlan({ customers: current.customers, messages, since: SINCE, isRecorded: (name, mail) => M.mailRecorded(current, name, mail) });
  const first = apply(state);
  assert.equal(first.length, 2);
  const next = first.reduce((current, { name, mail }) => M.addMailActivity(current, name, mail), state);
  assert.equal(next.customers.Acme.history.filter((item) => item.type === 'email').length, 2);
  assert.deepEqual(apply(next), []);
});

test('the customer save path refuses edits of a pool customer whose contacts are hidden', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/app.js'), 'utf8');
  assert.match(source, /form\.id === "customer-form" && form\.dataset\.oldName && poolEditBlocked\(form\.dataset\.oldName\)\)\s*throw new Error\(POOL_EDIT_BLOCKED\)/);
  assert.match(source, /if \(!isNew && poolEditBlocked\(customerName\)\) return toast\(POOL_EDIT_BLOCKED\)/);
  assert.match(source, /const poolEditBlocked = \(name\) =>\s*L\.bucket\(state\.customers\?\.\[name\] \|\| \{\}\) === "pool" && !CT\.poolContactsVisible\(state\)/);
});
