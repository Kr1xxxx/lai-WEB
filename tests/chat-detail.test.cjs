const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.js');
const D = require('../src/customer-detail-ui.js');
const R = require('../src/role-model.js');
const WA = require('../src/whatsapp-model.js');
const WUI = require('../src/whatsapp-ui.js');

// 客户详情里的沟通入口：页头 WhatsApp、联系人每个号码一个 WhatsApp 图标、动态 › 聊天记录里的按钮和聊天条目。
const chatEntry = (importId = 'imp-1') => ({
  type: 'chat', subtype: 'whatsapp', channel: 'WhatsApp', time: '2026-10-12T14:06:00.000Z', owner: 'Kris', contact: 'Maria',
  text: 'WhatsApp 聊天 2 条（发出 1，收到 1）\nHi there', chatRef: { src: 'export', importId, peer: '+447700900123', day: '2026-10-12' },
  lastSentAt: '2026-10-12T14:06:00.000Z', lastReceivedAt: '2026-10-12T14:05:00.000Z',
  lines: [{ at: '2026-10-12T14:05:00.000Z', from: 'Maria', dir: 'in', text: 'Hello <b>', key: 'k1' }, { at: '2026-10-12T14:06:00.000Z', from: 'Kris', dir: 'out', text: 'Hi there', key: 'k2' }],
});
const stateWith = (profile = {}) => ({ laiSettings: { defaultOwner: 'Kris' }, orders: [], customers: { Acme: { owner: 'Kris', contact: 'Maria', phone: '7700 900123', phoneCountryCode: '+44', contacts: ['Maria'], history: [chatEntry(), { type: 'followup', time: '2026-10-11T10:00:00.000Z', text: 'Called', owner: 'Kris' }], ...profile } } });
const render = (state, options = {}) => D.render(M.buildCustomers(state)[0], { state, escape: M.escapeHtml, now: '2026-10-16T10:00:00', ...options });

function withGlobals(fn, { roles = true } = {}) {
  const had = { role: globalThis.LaiRoleModel, ui: globalThis.LaiWhatsAppUI };
  if (roles) globalThis.LaiRoleModel = R;
  globalThis.LaiWhatsAppUI = WUI;
  try { return fn(); } finally {
    if (had.role === undefined) delete globalThis.LaiRoleModel; else globalThis.LaiRoleModel = had.role;
    if (had.ui === undefined) delete globalThis.LaiWhatsAppUI; else globalThis.LaiWhatsAppUI = had.ui;
  }
}

test('a customer with a phone gets a WhatsApp pill beside 写邮件 and an icon on the contact card, with data-chat-action and no data-feature', () => withGlobals(() => {
  const html = render(stateWith());
  const pill = html.match(/<button[^>]*lcd-wa-pill[^>]*>WhatsApp<\/button>/)[0];
  assert.match(pill, /data-chat-action="open-wa"/);
  assert.match(pill, /data-wa-phone="7700 900123"/);
  assert.match(pill, /data-wa-code="\+44"/);
  assert.match(pill, /data-wa-contact="Maria"/);
  assert.doesNotMatch(pill, /data-feature/);
  assert.ok(html.indexOf('lcd-wa-pill') < html.indexOf('data-feature="写邮件"'), 'pill sits before 写邮件');
  const icon = html.match(/<button[^>]*lcd-wa-phone[^>]*>/g);
  assert.equal(icon.length, 1);
  assert.match(icon[0], /data-chat-action="open-wa"/);
  assert.doesNotMatch(icon[0], /data-feature/);
}));

test('every number of a contact gets its own WhatsApp icon; no phone means no pill and no icon', () => withGlobals(() => {
  const html = render(stateWith({ additionalPhones: [{ phone: '7700 900999', phoneCountryCode: '+44' }] }));
  assert.equal((html.match(/lcd-wa-phone/g) || []).length, 2);
  assert.match(html, /data-wa-phone="7700 900999"/);
  const none = render(stateWith({ phone: '', phoneCountryCode: '', additionalPhones: [] }));
  assert.doesNotMatch(none, /lcd-wa-pill|lcd-wa-phone/);
}));

test('without 打开 WhatsApp 聊天 the pill and icons disappear; without 查看聊天记录 chat entries and the 聊天记录 filter disappear', () => withGlobals(() => {
  const base = { laiSettings: { defaultOwner: 'Kris' }, orders: [], customers: { Acme: { owner: 'Amy', contact: 'Maria', phone: '7700 900123', phoneCountryCode: '+44', contacts: ['Maria'], history: [chatEntry(), { type: 'followup', time: '2026-10-11T10:00:00.000Z', text: 'Called', owner: 'Amy' }] } } };
  const sales = R.switchTo(base, R.settings(base).members.find(m => m.name === 'Amy').id);
  // 业务 default: view, send, import all on.
  let html = render(sales, { tab: 'activity', activityFilter: 'chat' });
  assert.match(html, /data-chat-action="open-wa"/);
  assert.match(html, /data-chat-action="log-chat"/);
  assert.match(html, /data-chat-action="import-chat"/);
  assert.match(html, /聊天记录\(1\)/);
  const off = (state, keys) => {
    const role = R.settings(state).roles.find(r => r.id === 'sales');
    const perms = { ...role.perms };
    for (const key of keys) delete perms[key];
    return R.updateRole(state, 'sales', { perms });
  };
  // send off (updateRole needs admin; switch around)
  const admin = base;
  const noSend = R.switchTo(off(admin, ['chat.send']), R.settings(admin).members.find(m => m.name === 'Amy').id);
  html = render(noSend, { tab: 'activity', activityFilter: 'chat' });
  assert.doesNotMatch(html, /lcd-wa-pill|lcd-wa-phone|data-chat-action="log-chat"/);
  assert.match(html, /data-chat-action="import-chat"/);
  const noImport = R.switchTo(off(admin, ['chat.import']), R.settings(admin).members.find(m => m.name === 'Amy').id);
  html = render(noImport, { tab: 'activity', activityFilter: 'chat' });
  assert.match(html, /data-chat-action="log-chat"/);
  assert.doesNotMatch(html, /data-chat-action="import-chat"/);
  const noView = R.switchTo(off(admin, ['chat.view']), R.settings(admin).members.find(m => m.name === 'Amy').id);
  html = render(noView, { tab: 'activity', activityFilter: 'all' });
  assert.doesNotMatch(html, /wa-entry|WhatsApp 聊天 · /);
  assert.doesNotMatch(html, /data-activity-filter="chat"/);
  assert.match(html, /Called/, 'other activity is still shown');
  assert.doesNotMatch(render(noView, { tab: 'activity', activityFilter: 'chat' }), /data-chat-action="log-chat"|data-chat-action="import-chat"/);
}));

test('动态 › 聊天记录 renders chat entries with the WhatsApp entry markup, escaped, and the other filters do not show the buttons', () => withGlobals(() => {
  const html = render(stateWith(), { tab: 'activity', activityFilter: 'chat' });
  assert.match(html, /lcd-chat-record/);
  assert.match(html, /WhatsApp 聊天 · 2 条/);
  assert.match(html, /Hello &lt;b&gt;/);
  assert.doesNotMatch(html, /Hello <b>/);
  assert.match(html, /<div class="lcd-chat-tools">/);
  const all = render(stateWith(), { tab: 'activity', activityFilter: 'all' });
  assert.match(all, /lcd-chat-record/, 'chat entries also appear under 全部');
  assert.doesNotMatch(all, /lcd-chat-tools/);
}));

test('without the WhatsApp page script a chat entry falls back to the generic activity card instead of breaking', () => {
  const had = globalThis.LaiWhatsAppUI;
  delete globalThis.LaiWhatsAppUI;
  try {
    const html = render(stateWith(), { tab: 'activity', activityFilter: 'chat' });
    assert.match(html, /WhatsApp 聊天 2 条/);
  } finally { if (had) globalThis.LaiWhatsAppUI = had; }
});

test('最近WhatsApp沟通时间 reads the derived row value and falls back to the stored profile field', () => withGlobals(() => {
  const state = stateWith({ lastWhatsAppContact: '2026-01-02' });
  const row = M.buildCustomers(state)[0];
  const derived = D.render({ ...row, lastWhatsAppContact: '2026-10-12' }, { state, escape: M.escapeHtml, tab: 'info', now: '2026-10-16T10:00:00' });
  assert.match(derived, /最近WhatsApp沟通时间<\/dt><dd>2026-10-12/);
  const stored = D.render(row, { state, escape: M.escapeHtml, tab: 'info', now: '2026-10-16T10:00:00' });
  assert.match(stored, /最近WhatsApp沟通时间<\/dt><dd>2026-01-02/);
}));

test('the model reconciles with the UI: a logged chat shows up in the customer detail', () => withGlobals(() => {
  const next = WA.logChat(stateWith(), 'Acme', { text: 'Quote sent', owner: 'Kris', src: 'manual', at: '2026-10-15T09:00:00.000Z' });
  const html = render(next, { tab: 'activity', activityFilter: 'chat' });
  assert.match(html, /WhatsApp 聊天 · 1 条/);
}));
