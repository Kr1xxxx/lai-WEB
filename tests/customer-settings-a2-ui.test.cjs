const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CS = require('../src/customer-settings-model.js');
const CT = require('../src/customer-tools.js');
const UI = require('../src/customer-settings-ui.js');

const E = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const OLD = new Date(Date.now() - 400 * 86400000).toISOString();
const base = () => ({
  orders: [],
  customers: {
    Acme: { client: 'Acme', country: '美国', owner: 'Kris', createdAt: OLD, history: [] },
    Fresh: { client: 'Fresh', country: '英国', owner: 'Mia', createdAt: new Date().toISOString(), history: [] },
  },
  laiSettings: {},
});
const src = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');

test('the tab list is the fourteen 小满 tabs plus 字段设置, each with a note', () => {
  assert.deepEqual(UI.TABS.map((t) => t.label), ['客户分组', '客户阶段', '客户类型', '字段设置', '公海管理', '客户跟进规则', '客户成交规则', '建档黑名单', '客户上限', '来源设置', '判重设置', '客户查重', '动态设置', '写跟进设置', '布局设置']);
  assert.deepEqual(UI.TABS.map((t) => t.id), ['groups', 'stages', 'types', 'fields', 'pool', 'follow', 'deal', 'blacklist', 'caps', 'sources', 'dedupe', 'duplicates', 'activity', 'followup', 'layout']);
  for (const t of UI.TABS) assert.ok(t.note && t.note.length > 5, t.id);
});

test('the pool tab lists its ten sections, the rules and who is due now', () => {
  let s = CT.savePoolRule(base(), { name: '<b>90 天没联系', kind: 'noContact', days: 90, enabled: true });
  s = CT.savePoolRule(s, { name: '半年没成交', kind: 'noDeal', days: 180, enabled: false, groups: ['重点客户'], startDate: '2026-01-01' });
  const html = UI.markup(s, { tab: 'pool' }, E, ['Kris', 'Mia']);
  assert.equal([...html.matchAll(/<h3>/g)].length, 10);
  assert.ok(!html.includes('<b>90'), 'rule names are escaped');
  assert.match(html, /90 天没有联系/);
  assert.match(html, /180 天没有成交/);
  assert.match(html, /重点客户/);
  assert.match(html, /2026-01-01/);
  assert.equal([...html.matchAll(/data-cs-rule-toggle=/g)].length, 2);
  assert.equal([...html.matchAll(/data-cs-rule-toggle="[^"]+" checked/g)].length, 1, 'only the enabled rule is ticked');
  // Acme is idle for 400 days, Fresh is not.
  const due = html.slice(html.indexOf('现在符合规则的客户'), html.indexOf('即将移入公海'));
  assert.ok(due.includes('Acme') && !due.includes('Fresh'));
  assert.ok(due.includes('data-cs-pool-run'));
  // Asking for confirmation swaps the button for the confirm bar.
  const asking = UI.markup(s, { tab: 'pool', editing: { kind: 'poolrun' } }, E, ['Kris']);
  assert.match(asking, /data-cs-pool-run-ok/);
  assert.ok(!/data-cs-pool-run>/.test(asking));
});

test('the pool tab says so when nothing is switched on, and reflects every saved option', () => {
  const empty = UI.markup(base(), { tab: 'pool' }, E, ['Kris']);
  assert.match(empty, /还没有规则/);
  assert.match(empty, /还没有启用的规则/);
  let s = CT.setPoolRules(base(), { ...CT.poolRules(base()), remindDays: 0, whitelist: ['Mia'], skipFollowed: false, skipTags: ['VIP'], reclaimBlockDays: 14, showPoolContacts: false, requireReason: true, reasons: ['已失联'], claimLimit: { periodDays: 7, defaultLimit: 5, perOwner: { Kris: 2 } } });
  const html = UI.markup(s, { tab: 'pool' }, E, ['Kris', 'Mia']);
  assert.match(html, /提前提醒已关闭/);
  assert.match(html, /data-cs-pool-white-remove="Mia"/);
  assert.ok(!/<option value="Mia">/.test(html), 'a whitelisted person is not offered again');
  assert.match(html, /name="skipFollowed"(?! checked)/);
  assert.match(html, /name="skipTags" value="VIP"/);
  assert.match(html, /name="reclaimBlockDays" type="number" min="0" max="365" step="1" value="14"/);
  assert.match(html, /value="hide" checked/);
  assert.match(html, /data-cs-pool-require checked/);
  assert.match(html, /data-cs-pool-reason-remove="已失联"/);
  assert.match(html, /name="claim:Kris"[^>]*value="2"/);
  assert.match(html, /name="claim:Mia"[^>]*value=""/);
  assert.match(html, /name="periodDays"[^>]*value="7"/);
});

test('the rule form fills in a rule, offers groups and their children, and keeps a group that was deleted', () => {
  let s = CS.addGroup(base(), { name: '重点客户' });
  s = CS.addGroup(s, { name: 'A类', parentId: CS.get(s).groups[0].id });
  s = CT.savePoolRule(s, { name: '旧规则', kind: 'noDeal', days: 200, groups: ['重点客户 / A类', '已删分组'], startDate: '2026-02-03', enabled: false });
  const id = CT.poolRules(s).rules[0].id;
  const edit = UI.ruleForm(s, id, E);
  assert.match(edit, /id="cs-rule-form"/);
  assert.match(edit, /value="旧规则"/);
  assert.match(edit, /<option value="noDeal" selected>/);
  assert.match(edit, /name="days" type="number" min="1" max="3650" step="1" value="200"/);
  assert.match(edit, /value="重点客户 \/ A类" checked/);
  assert.match(edit, /value="重点客户"(?! checked)/);
  assert.match(edit, /value="已删分组" checked/);
  assert.match(edit, /value="2026-02-03"/);
  assert.match(edit, /name="enabled"(?! checked)/);
  const fresh = UI.ruleForm(s, '', E);
  assert.match(fresh, /name="name" value=""/);
  assert.match(fresh, /name="days"[^>]*value="90"/);
  assert.match(fresh, /name="enabled" checked/);
});

test('follow, deal, activity and followup tabs show the saved values', () => {
  let s = CS.setFollowRules(base(), { contact: ['followup'], followup: ['mailSent', 'chatSent'] });
  let html = UI.markup(s, { tab: 'follow' }, E, []);
  assert.equal([...html.matchAll(/name="contact"/g)].length, 8);
  assert.equal([...html.matchAll(/name="contact" value="[a-zA-Z]+" checked/g)].length, 1);
  assert.equal([...html.matchAll(/name="followup" value="[a-zA-Z]+" checked/g)].length, 2);
  assert.match(html, /最近联系时间决定公海规则里“多少天没有联系”/);
  assert.match(html, /最近跟进时间显示在客户列表和详情里/);

  html = UI.markup(base(), { tab: 'deal' }, E, []);
  assert.match(html, /data-cs-deal="order" checked/);
  html = UI.markup(CS.setDealRule(base(), 'opportunity'), { tab: 'deal' }, E, []);
  assert.match(html, /data-cs-deal="opportunity" checked/);

  html = UI.markup(base(), { tab: 'activity' }, E, []);
  assert.ok(!html.includes('起自动记录'));
  assert.match(html, /同一封邮件只记一次/);
  html = UI.markup(CS.setActivity(base(), { autoMail: true }, '2026-10-09T08:00:00.000Z'), { tab: 'activity' }, E, []);
  assert.match(html, /data-cs-activity checked/);
  assert.match(html, /从 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 起自动记录/);

  html = UI.markup(base(), { tab: 'followup' }, E, []);
  assert.match(html, /还没有模板。建好后，写跟进时点“选择模板”就能插入。/);
  assert.match(html, /data-cs-allow-past>/);
  s = CS.addTemplateGroup(CS.setFollowupOptions(base(), { allowPastTime: true }), '开发信');
  s = CS.addTemplate(s, CS.get(s).followup.templates[0].id, '<i>您好</i>');
  html = UI.markup(s, { tab: 'followup' }, E, []);
  assert.match(html, /data-cs-allow-past checked/);
  assert.ok(!html.includes('<i>您好'), 'template text is escaped');
  assert.match(html, /1 条常用语/);
  assert.match(html, /disabled/, 'the only group cannot move up or down');
  const group = CS.get(s).followup.templates[0];
  assert.match(UI.markup(s, { tab: 'followup', editing: { kind: 'tplgroup', key: group.id } }, E, []), /data-cs-form="tpl-group-rename"/);
  const form = UI.tplForm(s, { groupId: group.id, itemId: group.items[0].id }, E);
  assert.match(form, /id="cs-tpl-form"/);
  assert.match(form, /maxlength="500"/);
  assert.match(form, /&lt;i&gt;您好&lt;\/i&gt;/);
});

test('every control the new tabs draw is handled by app.js, and nothing collides with the customer list', () => {
  const app = src('app.js');
  let s = CT.savePoolRule(CT.setPoolRules(base(), { ...CT.poolRules(base()), whitelist: ['Mia'], reasons: ['已失联'] }), { name: 'R', days: 30, enabled: true });
  s = CS.addTemplateGroup(s, 'G');
  s = CS.addTemplate(s, CS.get(s).followup.templates[0].id, 'text');
  const group = CS.get(s).followup.templates[0];
  const html = ['pool', 'follow', 'deal', 'activity', 'followup'].map((tab) => UI.markup(s, { tab, editing: tab === 'pool' ? { kind: 'poolrun' } : null }, E, ['Kris', 'Mia'])).join('')
    + UI.markup(s, { tab: 'followup', editing: { kind: 'tplgroup', key: group.id } }, E, [])
    + UI.ruleForm(s, '', E) + UI.tplForm(s, { groupId: group.id }, E);
  const attrs = new Set([...html.matchAll(/data-(cs-[a-z-]+)/g)].map((m) => m[1]).filter((n) => n !== 'cs-panel' && n !== 'cs-form'));
  assert.ok(attrs.size >= 15);
  const camel = (n) => n.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (const name of attrs) assert.ok(app.includes(`d.${camel(name)}`), `${name} has no handler in app.js`);
  const forms = new Set([...html.matchAll(/data-cs-form="([a-z-]+)"/g)].map((m) => m[1]));
  assert.ok(forms.size >= 10);
  for (const form of forms) assert.ok(app.includes(`"${form}"`), `form ${form} has no handler in app.js`);
  assert.ok(app.includes('"cs-rule-form"') && app.includes('"cs-tpl-form"'));
  // The customer list answers any click on a bare data-group attribute (it filters by group), so the settings page must not use one.
  assert.ok(!/\sdata-group=/.test(html), 'no data-group attribute on the settings page');
});

test('the old 公海规则 dialog is gone', () => {
  const app = src('app.js');
  assert.ok(!app.includes('poolRulesDialog'));
  assert.ok(!app.includes('"pool-rules"'));
  assert.ok(!src('customer-settings-ui.js').includes('pool-rules'));
  const html = UI.markup(base(), { tab: 'groups' }, E, []);
  assert.ok(!html.includes('公海规则') && !html.includes('data-feature'));
});
