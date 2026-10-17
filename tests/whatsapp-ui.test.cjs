const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('../src/model.js');
const WA = require('../src/whatsapp-ui.js');

const T = (d) => new Date(d).toISOString();
const state = () => ({
  customers: {
    'Nordic Lamps <AB>': {
      owner: '小王', country: '英国', phone: '07700 900123', phoneCountryCode: '+44', contact: 'Anna',
      history: [
        { type: 'chat', channel: 'WhatsApp', time: T('2026-10-12T10:05:00'), contact: 'Anna', text: 'WhatsApp 聊天 2 条', chatRef: { src: 'export', importId: 'i1', day: '2026-10-12' },
          lines: [{ at: T('2026-10-12T10:00:00'), from: 'Me', dir: 'out', text: 'Hi <b>Anna</b>\nprice?', key: 'a' }, { at: T('2026-10-12T10:05:00'), from: 'Anna', dir: 'in', text: 'OK, thanks', key: 'b' }] },
      ],
    },
    '深圳配件': {
      owner: '小李', phone: '13800000000',
      history: [{ type: 'chat', channel: 'WhatsApp', time: T('2026-10-11T09:00:00'), contact: '李伟', text: 'x', lines: [{ at: T('2026-10-11T09:00:00'), from: 'Me', dir: 'out', text: '样品已寄出', key: 'c' }] }],
    },
    '别人的客户': {
      owner: '小赵',
      history: [{ type: 'chat', channel: 'WhatsApp', time: T('2026-10-10T09:00:00'), lines: [{ at: T('2026-10-10T09:00:00'), from: 'X', dir: 'in', text: 'secret', key: 'd' }] }],
    },
    '没聊过': { owner: '小王', history: [{ type: 'note', text: 'n' }] },
  },
  laiChatImports: [
    { id: 'i1', at: T('2026-10-12T11:00:00'), operator: '小王', customer: 'Nordic Lamps <AB>', file: 'chat <1>.txt', added: 2, skipped: 0 },
    { id: 'i2', at: T('2026-10-10T11:00:00'), operator: '小赵', customer: '别人的客户', file: 'x.txt', added: 1, skipped: 0 },
  ],
  laiSettings: { whatsapp: { templates: [{ id: 'g1', name: '报价', items: [{ id: 't1', text: '你好 {{姓名}}，{{公司}} 的报价来了' }, { id: 't2', text: '来自 {{国家}}' }] }] } },
});

// 模型替身：记录调用，按需返回固定结果。
// like the real model: no code given, the country name supplies it
const withCountry = (raw, { code, country } = {}) => {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.length >= 9 ? digits : null;
  const prefix = code || ({ 德国: '+49' }[country] || '');
  return digits && prefix ? prefix + digits.replace(/^0/, '') : null;
};
function fakeModel(overrides = {}) {
  const calls = [];
  const model = {
    calls,
    toE164: (raw, { code } = {}) => {
      const digits = String(raw || '').replace(/[^\d+]/g, '');
      if (digits.startsWith('+')) return digits.length >= 9 ? digits : null;
      if (!digits || !code) return null;
      return code + digits.replace(/^0/, '');
    },
    waLink: (e164, body) => `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(body || '')}`,
    renderTemplate: (body, vars) => {
      const missing = [];
      const out = body.replace(/\{\{([^{}]+)\}\}/g, (m, k) => (vars[k] ? vars[k] : (missing.push(k), m)));
      return { text: out, missing };
    },
    parseExport: (raw, { dayFirst }) => (calls.push(['parse', dayFirst]), { messages: [{ at: 1, from: 'Me', text: 'hi' }, { at: 2, from: '+44 7700 900123', text: 'yo' }], senders: [{ name: 'Me', count: 1 }, { name: '+44 7700 900123', count: 1 }], unknownLines: 3, ambiguousDateOrder: true, range: { from: '2026-10-01T10:00:00', to: '2026-10-12T10:00:00' } }),
    readZip: async () => 'zip text',
    buildEntries: (messages, opts) => (calls.push(['build', messages.length, opts]), [{ type: 'chat', n: messages.length }]),
    mergeImport: (s, customer, entries, row) => (calls.push(['merge', customer, entries, row]), { state: { ...s, merged: customer }, added: 2, skipped: 1 }),
    undoImport: (s, id) => (calls.push(['undo', id]), { ...s, undoneId: id }),
    logChat: (s, customer, entry) => (calls.push(['log', customer, entry]), { ...s, logged: customer }),
    matchCustomers: (s, q, visible) => (calls.push(['match', q, visible]), { customers: [{ name: 'Nordic Lamps <AB>', score: 1, contact: 'Anna', peer: '+447700900123' }, { name: '别人的客户', score: 1, contact: '', peer: '' }], leads: [] }),
    ...overrides,
  };
  return model;
}

function harness({ perms = {}, st = state(), model = fakeModel(), ctx = {} } = {}) {
  let current = st;
  const mounted = [], dialogs = [], toasts = [], persisted = [], opened = [], externals = [], copied = [], nodes = new Map(), listeners = new Map();
  let closed = 0;
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, files: [], dataset: {}, classList: { on: false, toggle(_, v) { this.on = v; } }, addEventListener(type, fn) { listeners.set(id + ':' + type, fn); } });
    return nodes.get(id);
  };
  const decode = (v) => String(v || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const scan = (html) => {
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) node(id);
    for (const [, attrs] of html.matchAll(/<input\b([^>]*)>/g)) { const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1]; if (id) node(id).value = decode((/\bvalue="([^"]*)"/.exec(attrs) || [])[1]); }
    for (const [, attrs, inner] of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) { const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1]; if (id) node(id).value = decode(inner); }
    for (const [, attrs, inner] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) { const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1]; if (id) node(id).value = decode((/<option value="([^"]*)"[^>]*selected/.exec(inner) || /<option value="([^"]*)"/.exec(inner) || [])[1]); }
    for (const [, attrs] of html.matchAll(/<button\b([^>]*)>/g)) { const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1]; if (id) node(id).disabled = /\bdisabled\b/.test(attrs); }
    for (const [, attrs] of html.matchAll(/<(?:label|p)\b([^>]*)>/g)) { const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1]; if (id) node(id).hidden = /\bhidden\b/.test(attrs); }
  };
  const prev = globalThis.document;
  globalThis.document = { getElementById: (id) => nodes.get(id) || null };
  const ui = WA.create({
    escape: escapeHtml, icon: (n) => `<i data-icon="${n}"></i>`, model,
    getState: () => current, persist: async (next) => { persisted.push(next); current = next; },
    can: (k) => perms[k] !== false, canSeeCustomer: (name) => name !== '别人的客户', meName: () => '小王',
    openCustomer: (n) => opened.push(n), toast: (m) => toasts.push(m),
    mount: (html) => { nodes.clear(); listeners.clear(); mounted.push(html); scan(html); },
    openExternal: (u) => externals.push(u), copy: async (t) => { copied.push(t); },
    dialog: (title, body, footer, type) => { dialogs.push({ title, body, footer, type }); scan(body + footer); },
    closeDialog: () => { closed++; },
    now: () => new Date('2026-10-13T08:00:00'),
    ...ctx,
  });
  const el = (dataset) => ({ dataset });
  return {
    ui, model, mounted, dialogs, toasts, persisted, opened, externals, copied, node, listeners,
    get page() { return mounted.at(-1); }, get dialog() { return dialogs.at(-1); }, get closed() { return closed; },
    act: (name, dataset = {}) => ui.action(name, false, el(dataset)),
    fire: (id, type, event = {}) => listeners.get(id + ':' + type)(event),
    set state(v) { current = v; }, get state() { return current; },
    dispose() { globalThis.document = prev; },
  };
}

test('renderChatEntry counts lines, escapes text and folds into a details', () => {
  const html = WA.renderChatEntry(state().customers['Nordic Lamps <AB>'].history[0], escapeHtml);
  assert.match(html, /<details class="wa-entry"><summary>/);
  assert.match(html, /WhatsApp 聊天 · 2 条/);
  assert.match(html, /Hi &lt;b&gt;Anna&lt;\/b&gt;<br>price\?/);
  assert.doesNotMatch(html, /<b>Anna/);
  assert.match(html, /wa-bubble out/);
  assert.match(html, /wa-bubble in/);
  // 旧数据没有 lines：用摘要拼一行，不报错
  assert.match(WA.renderChatEntry({ type: 'chat', time: T('2026-10-01T10:00:00'), text: 'WhatsApp 聊天 1 条\n你好', lastReceivedAt: T('2026-10-01T10:00:00') }, escapeHtml), /WhatsApp 聊天 · 1 条/);
});

test('conversations group by customer, mark 等你回复, filter and search', () => {
  const all = WA.conversations(state(), { me: '小王' });
  assert.deepEqual(all.map((r) => r.name), ['Nordic Lamps <AB>', '深圳配件', '别人的客户']);
  const nordic = all[0];
  assert.equal(nordic.waiting, true);
  assert.equal(nordic.lastText, 'OK, thanks');
  assert.equal(nordic.contact, 'Anna');
  assert.equal(all[1].waiting, false);
  assert.deepEqual(WA.conversations(state(), { filter: 'waiting', me: '小王' }).map((r) => r.name), ['Nordic Lamps <AB>', '别人的客户']);
  assert.deepEqual(WA.conversations(state(), { filter: 'mine', me: '小王' }).map((r) => r.name), ['Nordic Lamps <AB>']);
  assert.deepEqual(WA.conversations(state(), { query: '样品' }).map((r) => r.name), ['深圳配件']);
  assert.deepEqual(WA.conversations(state(), { query: '李伟' }).map((r) => r.name), ['深圳配件']);
  // 看不到的客户不出现
  assert.deepEqual(WA.conversations(state(), { canSee: (n) => n !== '别人的客户' }).map((r) => r.name), ['Nordic Lamps <AB>', '深圳配件']);
});

test('dayGroups split bubbles by local day', () => {
  const groups = WA.dayGroups([{ at: '2026-10-12T10:00:00', text: 'a' }, { at: '2026-10-12T11:00:00', text: 'b' }, { at: '2026-10-13T09:00:00', text: 'c' }]);
  assert.deepEqual(groups.map((g) => [g.day, g.lines.length]), [['2026-10-12', 2], ['2026-10-13', 1]]);
});

test('page: list, transcript, escaping, visibility and gated buttons', () => {
  const h = harness();
  h.ui.render();
  const html = h.page;
  assert.match(html, /Nordic Lamps &lt;AB&gt;/);
  assert.doesNotMatch(html, /Nordic Lamps <AB>/);
  assert.match(html, /等你回复/);
  assert.doesNotMatch(html, /别人的客户|secret/);
  assert.match(html, /wa-day/);
  assert.match(html, /发出|wa-bubble out/);
  assert.match(html, /data-chat-action="import"/);
  assert.match(html, /data-chat-action="whatsapp"/);
  assert.match(html, /data-chat-action="log"/);
  assert.match(html, /data-chat-action="open-customer" data-name="Nordic Lamps &lt;AB&gt;"/);
  // 导入记录只列看得到的客户，文件名要转义
  assert.match(html, /导入记录/);
  assert.match(html, /chat &lt;1&gt;\.txt/);
  assert.match(html, /data-chat-action="undo" data-id="i1"/);
  assert.doesNotMatch(html, /data-id="i2"/);
  h.act('open-customer', { name: 'Nordic Lamps <AB>' });
  assert.deepEqual(h.opened, ['Nordic Lamps <AB>']);
  h.dispose();
});

test('page: filter and select re-render; search updates the list', () => {
  const h = harness();
  h.ui.render();
  h.act('filter', { id: 'mine' });
  assert.doesNotMatch(h.page, /深圳配件/);
  h.act('filter', { id: 'all' });
  h.act('select', { name: '深圳配件' });
  assert.match(h.page, /wa-row selected" data-chat-action="select" data-name="深圳配件"/);
  assert.match(h.page, /样品已寄出/);
  const search = h.node('wa-search');
  search.value = '样品';
  h.fire('wa-search', 'input');
  assert.match(h.node('wa-list').innerHTML, /深圳配件/);
  assert.doesNotMatch(h.node('wa-list').innerHTML, /Nordic/);
  search.value = 'zzz';
  h.fire('wa-search', 'input');
  assert.match(h.node('wa-list').innerHTML, /没有符合的聊天/);
  h.dispose();
});

test('page: empty state shows the plan text and an import button; no chat.view blocks', () => {
  const h = harness({ st: { customers: { A: { history: [] } } } });
  h.ui.render();
  assert.ok(h.page.includes(WA.EMPTY_TEXT));
  assert.match(h.page, /data-chat-action="import"/);
  const blocked = harness({ perms: { 'chat.view': false } });
  blocked.ui.render();
  assert.match(blocked.page, /没有查看权限/);
  assert.doesNotMatch(blocked.page, /Nordic/);
  const noImport = harness({ perms: { 'chat.import': false, 'chat.send': false } });
  noImport.ui.render();
  assert.doesNotMatch(noImport.page, /data-chat-action="import"|data-chat-action="whatsapp"|data-chat-action="undo"/);
  noImport.act('import');
  assert.equal(noImport.dialogs.length, 0);
  assert.equal(noImport.toasts.length, 1);
  [h, blocked, noImport].forEach((x) => x.dispose());
});

async function chooseFile(h, name, content, size = content.length) {
  const file = { name, size, text: async () => content, arrayBuffer: async () => new TextEncoder().encode(content).buffer };
  h.node('wa-import-file').files = [file];
  await h.fire('wa-import-file', 'change');
  await new Promise((r) => setImmediate(r));
}

test('import: preview shows count, range, senders, unknown lines, date choice; confirm persists mergeImport result', async () => {
  const h = harness();
  h.ui.render();
  h.act('import');
  assert.equal(h.dialog.title, '导入聊天记录');
  assert.doesNotMatch(h.dialog.body, /试用版只用示例聊天/);
  assert.equal(h.node('wa-import-confirm').disabled, true);
  await chooseFile(h, 'WhatsApp Chat.txt', 'raw');
  const preview = h.node('wa-import-preview').innerHTML;
  assert.match(preview, /2 条/);
  assert.match(preview, /2026-10-01 到 2026-10-12/);
  assert.match(preview, /没认出的行<\/dt><dd>3 条/);
  assert.match(preview, /哪个是你/);
  assert.match(preview, /日期是怎么写的/);
  assert.match(preview, /会更新最近联系时间/);
  // 建议的客户排在最前，且已看不到的客户被过滤掉
  assert.match(preview, /data-name="Nordic Lamps &lt;AB&gt;"[\s\S]*可能是/);
  assert.doesNotMatch(preview, /别人的客户/);
  assert.deepEqual(h.model.calls.find((c) => c[0] === 'match')[2].slice().sort(), ['Nordic Lamps <AB>', '深圳配件', '没聊过'].sort());
  // 还没选“你”不能确认
  assert.equal(h.node('wa-import-confirm').disabled, true);
  h.node('wa-import-preview');
  await h.act('import-confirm');
  assert.match(h.node('wa-import-error').textContent, /哪个是你/);
  assert.equal(h.persisted.length, 0);
  // 选“你”，再换日期顺序会重新解析
  await h.fire('wa-import-preview', 'change', { target: { name: 'me', value: 'Me' } });
  assert.equal(h.node('wa-import-confirm').disabled, false);
  await h.fire('wa-import-preview', 'change', { target: { name: 'order', value: 'month' } });
  assert.deepEqual(h.model.calls.filter((c) => c[0] === 'parse').map((c) => c[1]), [true, false]);
  await h.act('import-confirm');
  const build = h.model.calls.find((c) => c[0] === 'build');
  assert.equal(build[2].me, 'Me');
  assert.equal(build[2].peer, '+447700900123');
  assert.equal(build[2].contact, 'Anna');
  assert.equal(build[2].owner, '小王');
  assert.equal(build[2].subtype, 'whatsapp');
  const merge = h.model.calls.find((c) => c[0] === 'merge');
  assert.equal(merge[1], 'Nordic Lamps <AB>');
  assert.equal(merge[3].file, 'WhatsApp Chat.txt');
  assert.equal(merge[3].customer, 'Nordic Lamps <AB>');
  assert.equal(h.persisted.length, 1);
  assert.equal(h.persisted[0].merged, 'Nordic Lamps <AB>');
  assert.equal(h.persisted[0].laiSettings.whatsapp.me, 'Me', 'remembers who you are');
  assert.deepEqual(h.toasts, ['已导入 2 条，跳过 1 条重复']);
  assert.equal(h.closed, 1);
  h.dispose();
});

test('import: remembered sender is preselected; zip goes through readZip; trial note and size limit', async () => {
  const st = state();
  st.laiSettings.whatsapp.me = 'Me';
  const h = harness({ st, ctx: { isTrial: true } });
  h.act('import');
  assert.match(h.dialog.body, /试用版只用示例聊天，不要导入真实客户聊天/);
  await chooseFile(h, 'big.txt', 'x', 400 * 1024);
  assert.match(h.node('wa-import-error').textContent, /300 KB/);
  await chooseFile(h, 'chat.zip', 'zipdata');
  assert.match(h.node('wa-import-preview').innerHTML, /<option value="Me" selected>/);
  assert.equal(h.node('wa-import-confirm').disabled, false);
  h.dispose();
});

test('import: choosing another customer, persist failure keeps the drawer', async () => {
  const h = harness({ model: fakeModel({ mergeImport: () => { throw new Error('太多了'); } }) });
  h.act('import');
  await chooseFile(h, 'a.txt', 'raw');
  await h.fire('wa-import-preview', 'change', { target: { name: 'me', value: 'Me' } });
  h.act('import-pick', { name: '深圳配件' });
  assert.match(h.node('wa-import-preview').innerHTML, /wa-pick selected" data-chat-action="import-pick" data-name="深圳配件"/);
  await h.act('import-confirm');
  assert.equal(h.node('wa-import-error').textContent, '太多了');
  assert.equal(h.closed, 0);
  assert.equal(h.node('wa-import-confirm').disabled, false);
  h.dispose();
});

test('dialog: builds the link from number and text, copies, then asks to log with src link', async () => {
  const h = harness();
  h.ui.openDialog({ customer: 'Nordic Lamps <AB>' });
  assert.equal(h.dialog.title, '打开 WhatsApp');
  assert.match(h.dialog.body, /将打开 \+447700900123/);
  assert.match(h.dialog.body, /<option value="g1\|t1">/);
  assert.match(h.dialog.body, /id="wa-dlg-fix" hidden/);
  // 选模板：变量换成客户资料
  h.node('wa-dlg-text');
  await h.fire('wa-dlg-form', 'change', { target: { id: 'wa-dlg-template', value: 'g1|t1' } });
  assert.equal(h.node('wa-dlg-text').value, '你好 Anna，Nordic Lamps <AB> 的报价来了');
  await h.act('dlg-copy-link');
  assert.equal(h.copied[0], 'https://wa.me/447700900123?text=' + encodeURIComponent('你好 Anna，Nordic Lamps <AB> 的报价来了'));
  await h.act('dlg-copy-text');
  assert.equal(h.copied[1], '你好 Anna，Nordic Lamps <AB> 的报价来了');
  h.act('dlg-open');
  assert.equal(h.externals.length, 1);
  assert.match(h.externals[0], /^https:\/\/wa\.me\/447700900123\?text=/);
  assert.equal(h.dialog.title, '发出去了吗？');
  assert.match(h.dialog.body, /Nordic Lamps &lt;AB&gt; 的报价来了/);
  await h.act('dlg-log');
  const log = h.model.calls.find((c) => c[0] === 'log');
  assert.equal(log[1], 'Nordic Lamps <AB>');
  assert.equal(log[2].src, 'link');
  assert.equal(log[2].peer, '+447700900123');
  assert.equal(log[2].contact, 'Anna');
  assert.equal(log[2].owner, '小王');
  assert.equal(h.persisted[0].logged, 'Nordic Lamps <AB>');
  assert.deepEqual(h.toasts.at(-1), '已记到客户动态');
  h.dispose();
});

test('dialog for a lead: its own country fills the code, templates work, and 记一笔 goes to onLog instead of a customer', async () => {
  const logged = [];
  const h = harness({ model: fakeModel({ toE164: withCountry }) });
  h.ui.openDialog({ lead: { id: 'L1', name: 'Berlin <GmbH>', country: '德国' }, contact: 'Hans', phone: '0151 23456789', onLog: async (text) => { logged.push(text); return '已记到线索跟进'; } });
  assert.equal(h.dialog.title, '打开 WhatsApp');
  assert.match(h.dialog.body, /class="wa-dlg-who">Berlin &lt;GmbH&gt; · Hans/);
  assert.doesNotMatch(h.dialog.body, /wa-dlg-customer/, 'the target is fixed: no customer picker');
  assert.match(h.dialog.body, /id="wa-dlg-template"/, 'templates are offered for leads too');
  assert.match(h.dialog.body, /将打开 \+4915123456789/);
  await h.fire('wa-dlg-form', 'change', { target: { id: 'wa-dlg-template', value: 'g1|t1' } });
  assert.equal(h.node('wa-dlg-text').value, '你好 Hans，Berlin <GmbH> 的报价来了');
  h.act('dlg-open');
  assert.match(h.externals[0], /^https:\/\/wa\.me\/4915123456789\?text=/);
  assert.equal(h.dialog.title, '发出去了吗？');
  assert.match(h.dialog.body, /记到这条线索的跟进里/);
  await h.act('dlg-log');
  assert.deepEqual(logged, ['你好 Hans，Berlin <GmbH> 的报价来了']);
  assert.equal(h.model.calls.some((c) => c[0] === 'log'), false, 'never written to a customer');
  assert.equal(h.persisted.length, 0);
  assert.equal(h.toasts.at(-1), '已记到线索跟进');
  h.dispose();
});

test('dialog for a lead: without onLog it does not ask 发出去了吗; a failing onLog shows the error and keeps the dialog', async () => {
  const h = harness({ model: fakeModel({ toE164: withCountry }) });
  h.ui.openDialog({ lead: { name: 'Berlin', country: '德国' }, contact: 'Hans', phone: '0151 23456789' });
  h.node('wa-dlg-text').value = '你好';
  h.act('dlg-open');
  assert.equal(h.externals.length, 1);
  assert.equal(h.model.calls.some((c) => c[0] === 'log'), false);
  h.dispose();
  const g = harness({ model: fakeModel({ toE164: withCountry }) });
  g.ui.openDialog({ lead: { name: 'Berlin', country: '德国' }, contact: 'Hans', phone: '0151 23456789', onLog: async () => { throw new Error('线索已被删除'); } });
  g.node('wa-dlg-text').value = '你好';
  g.act('dlg-open');
  await g.act('dlg-log');
  assert.equal(g.node('wa-ask-error').textContent, '线索已被删除');
  assert.equal(g.dialog.title, '发出去了吗？');
  g.dispose();
});

test('dialog for an opportunity: the customer is passed explicitly and the chat is logged to that customer', async () => {
  const h = harness();
  h.ui.openDialog({ customer: '深圳配件', contact: 'Amy', phone: '+447700900999' });
  assert.match(h.dialog.body, /class="wa-dlg-who">深圳配件 · Amy/);
  assert.match(h.dialog.body, /将打开 \+447700900999/);
  h.node('wa-dlg-text').value = 'Quote sent.';
  h.act('dlg-open');
  await h.act('dlg-log');
  const log = h.model.calls.find((c) => c[0] === 'log');
  assert.equal(log[1], '深圳配件');
  assert.equal(log[2].peer, '+447700900999');
  assert.equal(log[2].contact, 'Amy');
  h.dispose();
});

test('dialog: unreplaced variables and bad numbers block opening; skip does not log', async () => {
  const st = state();
  delete st.customers['Nordic Lamps <AB>'].country;
  delete st.customers['Nordic Lamps <AB>'].phoneCountryCode;
  const h = harness({ st });
  h.ui.openDialog({ customer: 'Nordic Lamps <AB>' });
  await h.fire('wa-dlg-form', 'change', { target: { id: 'wa-dlg-template', value: 'g1|t2' } });
  assert.match(h.node('wa-dlg-error').textContent, /\{\{国家\}\}/);
  h.node('wa-dlg-phone').value = '+447700900123';
  h.act('dlg-open');
  assert.equal(h.externals.length, 0);
  assert.match(h.node('wa-dlg-error').textContent, /还有没填的内容/);
  await h.act('dlg-copy-link');
  assert.equal(h.copied.length, 0);
  // 号码不对：显示区号选择，选了才能用
  h.node('wa-dlg-text').value = '你好';
  h.node('wa-dlg-phone').value = '7700 900123';
  h.node('wa-dlg-code').value = '';
  h.fire('wa-dlg-form', 'input');
  assert.equal(h.node('wa-dlg-fix').hidden, false);
  assert.match(h.node('wa-dlg-note').textContent, /号码还不能用/);
  h.act('dlg-open');
  assert.match(h.node('wa-dlg-error').textContent, /号码不对/);
  assert.equal(h.externals.length, 0);
  h.node('wa-dlg-code').value = '+44';
  h.fire('wa-dlg-form', 'change', { target: { id: 'wa-dlg-code' } });
  assert.equal(h.node('wa-dlg-fix').hidden, true);
  h.act('dlg-open');
  assert.equal(h.externals.length, 1);
  h.act('dlg-skip');
  assert.equal(h.model.calls.some((c) => c[0] === 'log'), false);
  assert.equal(h.persisted.length, 0);
  h.dispose();
});

test('dialog: needs chat.send; manual log saves with src manual', async () => {
  const denied = harness({ perms: { 'chat.send': false } });
  denied.ui.openDialog({ customer: '深圳配件' });
  denied.act('log');
  assert.equal(denied.dialogs.length, 0);
  assert.equal(denied.toasts.length, 2);
  const h = harness();
  h.ui.render();
  h.act('log');
  assert.equal(h.dialog.title, '记一笔聊天');
  h.node('wa-log-customer').value = '深圳配件';
  h.node('wa-log-text').value = '';
  await h.act('log-save');
  assert.match(h.node('wa-log-error').textContent, /聊天内容/);
  assert.equal(h.persisted.length, 0);
  h.node('wa-log-text').value = '  已报价  ';
  await h.act('log-save');
  const log = h.model.calls.find((c) => c[0] === 'log');
  assert.equal(log[1], '深圳配件');
  assert.equal(log[2].src, 'manual');
  assert.equal(log[2].text, '已报价');
  assert.equal(h.persisted.length, 1);
  denied.dispose();
  h.dispose();
});

test('undo: confirm first, then undoImport and mark the log row', async () => {
  const h = harness();
  h.ui.render();
  h.act('undo', { id: 'i1' });
  assert.equal(h.dialog.title, '撤销这次导入？');
  assert.equal(h.persisted.length, 0);
  assert.match(h.dialog.body, /Nordic Lamps &lt;AB&gt;/);
  await h.act('undo-confirm', { id: 'i1' });
  assert.deepEqual(h.model.calls.find((c) => c[0] === 'undo'), ['undo', 'i1']);
  assert.equal(h.persisted[0].undoneId, 'i1');
  assert.equal(h.persisted[0].laiChatImports.find((r) => r.id === 'i1').undone, true);
  assert.match(h.page, /已撤销/);
  h.dispose();
});

test('templates page: add, rename, reorder, delete with limits and permission', async () => {
  const h = harness();
  h.ui.renderTemplates();
  assert.match(h.page, /<code>\{\{姓名\}\}<\/code> <code>\{\{公司\}\}<\/code> <code>\{\{我的名字\}\}<\/code> <code>\{\{国家\}\}<\/code>/);
  const groups = () => h.state.laiSettings.whatsapp.templates;
  h.node('wa-new-group').value = '跟进 <新>';
  await h.act('group-add');
  assert.equal(groups().length, 2);
  assert.equal(groups()[1].name, '跟进 <新>');
  assert.match(h.page, /跟进 &lt;新&gt;/);
  const gid = groups()[1].id;
  h.node('wa-new-item-' + gid).value = '谢谢你的回复';
  await h.act('item-add', { gid });
  assert.equal(groups()[1].items[0].text, '谢谢你的回复');
  // 改名
  await h.act('group-edit', { gid });
  assert.match(h.page, /id="wa-edit-group"/);
  h.node('wa-edit-group').value = '催单';
  await h.act('group-save', { gid });
  assert.equal(groups()[1].name, '催单');
  // 上移分组、上移条目
  await h.act('group-up', { gid });
  assert.equal(groups()[0].name, '催单');
  const first = groups()[1].items;
  await h.act('item-down', { gid: 'g1', id: 't1' });
  assert.deepEqual(groups().find((g) => g.id === 'g1').items.map((i) => i.id), ['t2', 't1']);
  assert.equal(first.length, 2);
  // 修改条目
  await h.act('item-edit', { gid: 'g1', id: 't2' });
  h.node('wa-edit-item').value = '新的话';
  await h.act('item-save', { gid: 'g1', id: 't2' });
  assert.equal(groups().find((g) => g.id === 'g1').items[0].text, '新的话');
  // 删除要点两次
  await h.act('item-del', { gid: 'g1', id: 't1' });
  assert.equal(groups().find((g) => g.id === 'g1').items.length, 2);
  assert.match(h.page, /再点一次删除/);
  await h.act('item-del', { gid: 'g1', id: 't1' });
  assert.equal(groups().find((g) => g.id === 'g1').items.length, 1);
  await h.act('group-del', { gid });
  await h.act('group-del', { gid });
  assert.deepEqual(groups().map((g) => g.id), ['g1']);
  h.dispose();
});

test('templates: limits and guard', async () => {
  const { tpl, LIMITS } = WA;
  assert.match(tpl.addGroup([], '  ').error, /分组名称/);
  assert.match(tpl.addGroup([], 'x'.repeat(LIMITS.groupName + 1)).error, /最多/);
  const full = Array.from({ length: LIMITS.groups }, (_, i) => ({ id: 'g' + i, name: 'n' + i, items: [] }));
  assert.match(tpl.addGroup(full, 'more').error, /30 个分组/);
  assert.match(tpl.addItem(full, 'g0', 'x'.repeat(LIMITS.chars + 1)).error, /500/);
  assert.match(tpl.addItem(full, 'g0', '').error, /模板内容/);
  const items = [{ id: 'g0', name: 'a', items: Array.from({ length: LIMITS.items }, (_, i) => ({ id: 't' + i, text: 'x' })) }];
  assert.match(tpl.addItem(items, 'g0', 'y').error, /100 条/);
  assert.equal(tpl.moveGroup(full, 'g0', -1).groups[0].id, 'g0');
  assert.deepEqual(WA.leftovers('a {{姓名}} b {{国家}} {{姓名}}'), ['{{姓名}}', '{{国家}}']);
  // 没有 chat.template 权限：页面被挡住，也不能改
  const h = harness({ perms: { 'chat.template': false } });
  h.ui.renderTemplates();
  assert.match(h.page, /没有管理权限/);
  await h.act('group-add');
  assert.equal(h.persisted.length, 0);
  assert.equal(h.toasts.length, 1);
  // 错误提示：没写名字
  const ok = harness();
  ok.ui.renderTemplates();
  ok.node('wa-new-group').value = '';
  await ok.act('group-add');
  assert.match(ok.page, /请先写分组名称/);
  assert.equal(ok.persisted.length, 0);
  h.dispose();
  ok.dispose();
});

test('css classes exist and the source has no placeholder entries', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/whatsapp.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../src/whatsapp-ui.js'), 'utf8');
  for (const name of ['wa-row', 'wa-bubble', 'wa-day', 'wa-entry', 'wa-tpl-group', 'wa-pick']) assert.ok(css.includes('.' + name), name);
  assert.doesNotMatch(js, /功能入口已保留/);
});

test('a customer the account cannot see: no dialog, no 记一笔, no undo', async () => {
  // opening the dialog for a customer outside the account's scope is refused
  const h = harness();
  h.ui.openDialog({ customer: '别人的客户' });
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.toasts.at(-1), '你看不到这位客户，不能操作');
  // the customer was visible when the dialog opened but is not any more when 记一笔 is pressed
  let seen = true;
  const g = harness({ ctx: { canSeeCustomer: () => seen } });
  g.ui.openDialog({ customer: 'Nordic Lamps <AB>' });
  g.node('wa-dlg-text').value = 'hello';
  g.act('dlg-open');
  assert.equal(g.dialog.title, '发出去了吗？');
  seen = false;
  await g.act('dlg-log');
  assert.equal(g.model.calls.some((c) => c[0] === 'log'), false, 'nothing is written');
  assert.equal(g.persisted.length, 0);
  assert.equal(g.node('wa-ask-error').textContent, '你看不到这位客户，不能操作');
  // undo of an import that belongs to a customer outside the scope
  const u = harness();
  u.act('undo', { id: 'i2' });
  assert.equal(u.dialogs.length, 0, 'no confirm dialog');
  assert.equal(u.toasts.at(-1), '你看不到这位客户，不能操作');
  await u.act('undo-confirm', { id: 'i2' });
  assert.equal(u.model.calls.some((c) => c[0] === 'undo'), false, 'undoImport is never called');
  assert.equal(u.persisted.length, 0);
  // a visible customer's import still undoes
  await u.act('undo-confirm', { id: 'i1' });
  assert.deepEqual(u.model.calls.find((c) => c[0] === 'undo'), ['undo', 'i1']);
  for (const x of [h, g, u]) x.dispose();
});
