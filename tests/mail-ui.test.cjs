const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('../src/model.js');
require('../src/mail-ui.js');
const Mail = globalThis.LaiMailUI;

// 小型界面替身：记录渲染结果与对话框，按 id 提供表单/提示节点；本机服务的应答由 routes 决定。
const decode = value => String(value || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ACCOUNT = { provider: 'zoho', email: 'sales@example-trade.com', site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993, boundAt: '2026-10-06T10:00:00.000Z', verifiedAt: '2026-10-06T10:00:00.000Z' };
const anna = { name: 'Anna Berg', address: 'anna@nordic-lamps.example' }, li = { name: '李伟', address: 'liwei@shenzhen-parts.example' }, self = { name: '', address: ACCOUNT.email };
const INBOX = [
  { box: 'inbox', uid: 4, from: li, to: [self], cc: [{ name: '', address: 'purchasing@shenzhen-parts.example' }], subject: '样品寄送确认', date: '2026-10-06T02:10:00.000Z', seen: false, pending: false, hasAttachment: true, snippet: '您好， 样品已寄出 <装箱单>' },
  { box: 'inbox', uid: 3, from: anna, to: [self], cc: [], subject: 'Re: Quotation <b>', date: '2026-10-05T14:20:00.000Z', seen: true, pending: true, hasAttachment: false },
];
const MESSAGE = { box: 'inbox', uid: 4, from: li, to: [self, { name: 'Ops', address: 'ops@example-trade.com' }], cc: [{ name: '', address: 'purchasing@shenzhen-parts.example' }], replyTo: [], subject: '样品寄送确认', date: '2026-10-06T02:10:00.000Z', messageId: '<s-9@shenzhen-parts.example>', references: '<s-8@x>', text: '您好，\n样品已寄出。', html: '', attachments: [{ index: 0, filename: '装箱单 <1>.pdf', contentType: 'application/pdf', size: 2048 }], seen: true, pending: false };
const CUSTOMERS = { 'Nordic Lamps AB': { email: 'Anna@Nordic-Lamps.example' }, '深圳配件': { contacts: [{ email: 'liwei@shenzhen-parts.example' }, { email: 'wanglei@shenzhen-parts.example' }, { email: 'bad' }] }, 'No Mail Co': {}, 'Archived Co': { email: 'old@x.example', laiBucket: 'trash' } };

function harness({ routes = {}, account = ACCOUNT, available = true, active = true, customers = CUSTOMERS, favoriteHeart, ctx = {} } = {}) {
  const mounted = [], requests = [], toasts = [], opened = [], nodes = new Map(), submitters = new Map(), listeners = new Map();
  let dialog = null, closed = 0, forms = new Map(), pageForms = new Map(), editor = null;
  const editors = [];
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { id, textContent: '', innerHTML: '', disabled: false, isConnected: true, value: '', files: [], classList: { visible: false, toggle(_, on) { this.visible = on; } }, addEventListener(type, fn) { listeners.set(id + ':' + type, fn); } }); return nodes.get(id); };
  const scan = (html, target = forms) => {
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) node(id);
    for (const match of html.matchAll(/<form\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)) {
      const elements = {};
      for (const [, attrs] of match[2].matchAll(/<input\b([^>]*)>/g)) { const name = (/\bname="([^"]+)"/.exec(attrs) || [])[1]; if (name) elements[name] = { value: decode((/\bvalue="([^"]*)"/.exec(attrs) || [])[1]), checked: /\bchecked\b/.test(attrs) }; }
      for (const [, attrs, inner] of match[2].matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) elements[(/\bname="([^"]+)"/.exec(attrs))[1]] = { value: decode(inner.replace(/^\n/, '')) };  // browsers drop one newline right after <textarea>
      for (const [, attrs, inner] of match[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) elements[(/\bname="([^"]+)"/.exec(attrs))[1]] = { value: (/<option value="([^"]*)" selected/.exec(inner) || /<option value="([^"]*)"/.exec(inner) || [])[1] };
      target.set(match[1], { elements, addEventListener: (type, fn) => { if (type === 'submit') submitters.set(match[1], fn); } });
      nodes.delete(match[1]);   // a form is found through the form maps, so a redrawn page never leaves a stale one behind
    }
  };
  const previous = { document: globalThis.document, FileReader: globalThis.FileReader };
  const keyHandlers = [];
  globalThis.document = { getElementById: id => forms.get(id) || pageForms.get(id) || nodes.get(id) || null, querySelectorAll: () => [], querySelector: () => null, addEventListener: (type, fn) => { if (type === 'keydown') keyHandlers.push(fn); } };
  globalThis.FileReader = class { readAsDataURL(file) { if (file.fail) return this.onerror(); const done = () => { this.result = 'data:' + file.type + ';base64,' + Buffer.from(file.content).toString('base64'); this.onload(); }; if (file.slow) file.finish = done; else done(); } };
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
  const defaults = {
    '/api/mail-account': () => reply(200, { ok: true, available, account }),
    '/api/mail/messages': () => reply(200, { ok: true, folder: 'inbox', page: 1, pageSize: 50, total: INBOX.length, items: INBOX.map(item => ({ ...item })), counts: { unread: 1, pending: 1 } }),
    '/api/mail/message': () => reply(200, { ok: true, message: { ...MESSAGE } }),
    '/api/mail/drafts': () => reply(200, { ok: true, items: [] }),
    '/api/mail/correspondence': () => reply(200, { ok: true, items: [] }),
    '/api/mail/bulk': () => reply(200, { ok: true, items: [] }),
  };
  const mail = Mail.create({
    escape: escapeHtml, icon: name => `<svg data-icon="${name}"></svg>`,
    mount: (html) => { pageForms = new Map(); mounted.push(html); scan(html, pageForms); },
    // 编辑器替身：只保存 HTML。真实的编辑器（Squire + DOMPurify）会净化放进去的内容，这里不会。
    createEditor: (node, bar, html) => { editor = { html, destroyed: false, getHTML() { return this.html; }, getText() { return this.html.replace(/<br\s*\/?>/g, '\n').replace(/<\/(div|p|blockquote)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }, setHTML(next) { this.html = next; }, destroy() { this.destroyed = true; } }; editors.push(editor); return editor; },
    editorToolbar: () => '<div class="mail-editor-toolbar"></div>',
    request: async (url, payload) => { const [route, queryString = ''] = url.split('?'); const query = Object.fromEntries(new URLSearchParams(queryString)); payload = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)); requests.push({ route, query, payload }); const handler = routes[route] || defaults[route]; return handler ? handler({ query, payload, reply }) : reply(200, { ok: true }); },
    isActive: () => active, favoriteHeart, pollMs: 0, keyDelayMs: 0, hasDialog: () => !!dialog, openMail: folder => opened.push('mail:' + folder),
    dialog: (title, body, footer, type) => { dialog = { title, body, footer, type }; forms = new Map(); scan(body + footer); },
    closeDialog: () => { closed++; dialog = null; forms = new Map(); },
    toast: text => toasts.push(text),
    getCustomers: () => customers, isArchived: profile => profile.laiBucket === 'trash', openCustomer: name => opened.push(name), checkMs: 0,
    ...ctx,
  });
  const element = (dataset) => ({ dataset });
  return { mail, mounted, requests, toasts, opened, node, editors, get editor() { return editor; }, get page() { return mounted.at(-1); }, get dialog() { return dialog; }, get closed() { return closed; },
    form: id => forms.get(id) || pageForms.get(id), submit: id => submitters.get(id)({ preventDefault() {} }), fire: (id, type) => listeners.get(id + ':' + type)(), act: (name, dataset = {}) => mail.action(name, false, element(dataset)),
    calls: route => requests.filter(r => r.route === route), setActive(value) { active = value; },
    // 按键：走页面模块自己注册的 keydown 处理函数，和真实页面一样。
    key: (key, target = {}) => { const event = { key, target, prevented: false, preventDefault() { this.prevented = true; } }; const result = keyHandlers.at(-1)(event); return { event, result }; },
    dispose() { active = false; globalThis.document = previous.document || { getElementById: () => null, querySelectorAll: () => [] }; globalThis.FileReader = previous.FileReader; } };
}

test('navigation shows the three tabs, compose, six folders and live counts', async () => {
  assert.deepEqual(Mail.folders.map(f => f.label), ['收件箱', '待处理邮件', '未读邮件', '草稿箱', '发件箱', '群发箱']);
  assert.deepEqual(Mail.views.map(v => v.label), ['邮件', '客户', '下属']);
  const h = harness();
  try {
    let html = h.mail.subnav();
    assert.deepEqual([...html.matchAll(/data-mail-view="(\w+)" aria-selected="(\w+)"/g)].map(m => m.slice(1)), [['mail', 'true'], ['customer', 'false'], ['team', 'false']]);
    assert.equal([...html.matchAll(/data-mail-folder="/g)].length, 6); assert.match(html, /data-mail-action="compose"/); assert.doesNotMatch(html, /data-feature|mail-count/);
    await h.mail.select();
    html = h.mail.subnav();
    assert.deepEqual([...html.matchAll(/data-mail-folder="(\w+)"[^>]*>.*?<\/button>/g)].map(m => [m[1], (/mail-count">(\d+)/.exec(m[0]) || [])[1]]), [['inbox', '1'], ['pending', '1'], ['unread', '1'], ['drafts', undefined], ['sent', undefined], ['bulk', undefined]]);
  } finally { h.dispose(); }
});

test('each folder row carries the heart from the page shell; without one the row stays plain', () => {
  const heart = (id, label) => `<heart ${id}|${label}>`;
  const h = harness({ favoriteHeart: heart });
  try {
    const html = h.mail.subnav();
    assert.deepEqual([...html.matchAll(/<heart ([^|]+)\|([^>]+)>/g)].map(m => [m[1], m[2]]), Mail.folders.map(f => ['mail:' + f.id, f.label]));
    assert.equal([...html.matchAll(/<div class="nav-row" role="listitem"><button type="button" class="nav-entry [^"]*" data-mail-folder="(\w+)"[^>]*>.*?<\/button><heart /g)].length, 6, 'the heart sits beside the folder button, never inside it');
    h.mail.select('drafts');
    assert.match(h.mail.subnav(), /class="nav-entry active" data-mail-folder="drafts" aria-current="page"/);
  } finally { h.dispose(); }
  const plain = harness();
  try { assert.doesNotMatch(plain.mail.subnav(), /nav-heart|<heart/); assert.equal([...plain.mail.subnav().matchAll(/data-mail-folder=/g)].length, 6); } finally { plain.dispose(); }
});

test('the page waits for the binding, offers a retry on failure, and never pretends to be unbound', async () => {
  let fail = true;
  const h = harness({ routes: { '/api/mail-account': ({ reply }) => fail ? reply(503, { ok: false, message: 'storage unavailable' }) : reply(200, { ok: true, available: true, account: null }) } });
  try {
    const pending = h.mail.select();
    assert.match(h.page, /正在读取邮箱绑定状态/); assert.doesNotMatch(h.page, /data-mail-action="bind"/);
    await pending;
    assert.match(h.page, /无法读取邮箱绑定状态/); assert.match(h.page, /storage unavailable/); assert.doesNotMatch(h.page, /未绑定邮箱/);
    fail = false; await h.act('reload');
    assert.match(h.page, /未绑定邮箱/); assert.match(h.page, /data-mail-action="bind"/); assert.equal(h.calls('/api/mail/messages').length, 0, 'no mail is requested without a binding');
    await h.act('compose'); assert.deepEqual(h.toasts, ['请先绑定邮箱']); assert.equal(h.dialog.type, 'mail-bind'); assert.equal(h.mail.composing(), false);
  } finally { h.dispose(); }
});

test('binding verifies through the local service and then loads the inbox', async () => {
  let bound = null;
  const h = harness({ routes: { '/api/mail-account': ({ reply }) => reply(200, { ok: true, available: true, account: bound }), '/api/mail-account/bind': ({ payload, reply }) => payload.password === 'good' ? (bound = ACCOUNT, reply(200, { ok: true, available: true, account: ACCOUNT })) : reply(422, { ok: false, code: 'auth_failed', message: '登录被邮箱服务器拒绝。<b>' }) } });
  try {
    await h.mail.select();
    h.act('bind');
    assert.match(h.dialog.body, /type="password"[^>]*autocomplete="new-password"/); assert.match(h.dialog.body, /<option value="cn" selected>/); assert.match(h.dialog.body, /IMAP 访问/); assert.match(h.dialog.body, /备份文件也会包含/);
    const form = h.form('mail-bind-form');
    await h.submit('mail-bind-form'); assert.equal(h.node('mail-bind-error').textContent, '请填写邮箱地址');
    form.elements.email.value = ' sales@example-trade.com '; await h.submit('mail-bind-form'); assert.equal(h.node('mail-bind-error').textContent, '请填写应用专用密码'); assert.equal(h.calls('/api/mail-account/bind').length, 0);
    form.elements.password.value = 'bad'; await h.submit('mail-bind-form');
    assert.equal(h.node('mail-bind-error').textContent, '登录被邮箱服务器拒绝。<b>'); assert.equal(h.closed, 0); assert.equal(h.node('mail-bind-submit').disabled, false); assert.equal(h.mail.account(), null);
    form.elements.password.value = 'good'; await h.submit('mail-bind-form');
    assert.deepEqual(h.calls('/api/mail-account/bind').at(-1).payload, { email: 'sales@example-trade.com', password: 'good', site: 'cn', accountType: 'auto' });
    assert.equal(h.closed, 1); assert.deepEqual(h.toasts, ['邮箱已绑定']); assert.deepEqual(h.calls('/api/mail/messages').at(-1).query, { folder: 'inbox', page: '1' });
    assert.match(h.page, /样品寄送确认/); assert.doesNotMatch(h.mounted.join(''), /good|bad"/);
  } finally { h.dispose(); }
});

test('the list shows unread state, pending stars, attachments and the matching customer, all escaped', async () => {
  const h = harness();
  try {
    await h.mail.select();
    assert.match(h.page, /<h1>收件箱（2）<\/h1>/);
    const rows = [...h.page.matchAll(/<div class="mail-row ([^"]*)" role="listitem">([\s\S]*?)<\/div>/g)].map(m => ({ unread: m[1].includes('unread'), html: m[2] }));
    assert.deepEqual(rows.map(r => r.unread), [true, false]);
    assert.match(rows[0].html, /data-mail-action="open" data-box="inbox" data-uid="4"/); assert.match(rows[0].html, /mail-row-who">李伟</); assert.match(rows[0].html, /mail-clip/); assert.match(rows[0].html, /data-mail-action="customer-open" data-name="深圳配件"/);
    assert.match(rows[0].html, /class="mail-pending " data-mail-action="toggle-pending" data-box="inbox" data-uid="4" aria-pressed="false" aria-label="标为待处理"/);
    assert.match(rows[1].html, /class="mail-pending on"[^>]*aria-pressed="true" aria-label="取消待处理"/); assert.match(rows[1].html, /Re: Quotation &lt;b&gt;/); assert.doesNotMatch(rows[1].html, /<b>|mail-clip/); assert.match(rows[1].html, /data-name="Nordic Lamps AB"/);
    assert.match(rows[0].html, /mail-row-snippet">您好， 样品已寄出 &lt;装箱单&gt;</, 'the body preview is shown, escaped'); assert.match(rows[1].html, /mail-row-snippet"><\/span>/);
    assert.match(rows[0].html, /data-mail-action="row-read" data-box="inbox" data-uid="4" aria-label="标为已读"/); assert.match(rows[1].html, /data-mail-action="row-read"[^>]*aria-label="标为未读"/); assert.match(rows[0].html, /data-mail-action="row-delete" data-box="inbox" data-uid="4"/);
    assert.match(h.page, /class="module-page mail-page mail-split contact-auto"/); assert.match(h.page, /mail-reader-empty[\s\S]*选择一封邮件/, 'nothing is selected yet, so the reading pane says so');
    assert.match(h.page, /共 2 封 · 第 1 \/ 1 页/); assert.match(h.page, /data-mail-action="page-prev" disabled/); assert.match(h.page, /data-mail-action="page-next" disabled/);
    h.act('customer-open', { name: '深圳配件' }); assert.deepEqual(h.opened, ['深圳配件']);
  } finally { h.dispose(); }
});

test('switching folders, searching and paging ask the service for exactly that view and never show stale rows', async () => {
  let release = null;
  const h = harness({ routes: { '/api/mail/messages': ({ query, reply }) => { const answer = reply(200, { ok: true, page: Number(query.page), pageSize: 50, total: 120, items: [{ ...INBOX[0], subject: `${query.folder}/${query.query || ''}/${query.page}`, box: query.folder === 'sent' ? 'sent' : 'inbox' }] }); return query.folder === 'sent' && !release ? new Promise(resolve => { release = () => resolve(answer); }) : answer; } } });
  try {
    await h.mail.select('unread');
    assert.match(h.page, /unread\/\/1/); assert.match(h.page, /第 1 \/ 3 页/); assert.match(h.page, /data-mail-action="page-next" >/);
    await h.act('page-next'); assert.deepEqual(h.calls('/api/mail/messages').at(-1).query, { folder: 'unread', page: '2' }); assert.match(h.page, /unread\/\/2/);
    h.form('mail-search-form').elements.query.value = '  报价 '; h.submit('mail-search-form'); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.calls('/api/mail/messages').at(-1).query, { folder: 'unread', page: '1', query: '报价' }); assert.match(h.page, /unread\/报价\/1/); assert.match(h.page, /value="报价"/);
    const slow = h.mail.select('sent');
    assert.doesNotMatch(h.page, /unread\//, 'rows from the previous folder are gone while the new one loads'); assert.match(h.page, /正在读取邮件/);
    const fast = h.mail.select('pending'); await fast;
    assert.match(h.page, /pending\/\/1/); assert.doesNotMatch(h.page, /value="报价"/, 'search does not carry over to another folder');
    release(); await slow;
    assert.match(h.page, /pending\/\/1/, 'a late answer for another folder is ignored'); assert.doesNotMatch(h.page, /sent\//);
    await h.mail.select('sent'); assert.match(h.page, /发给 /); assert.match(h.page, /mail-pending-slot/, 'sent mail has no pending star');
  } finally { h.dispose(); }
});

test('empty and failed lists explain themselves', async () => {
  let mode = 'empty';
  const h = harness({ routes: { '/api/mail/messages': ({ reply }) => mode === 'fail' ? reply(422, { ok: false, code: 'auth_failed', message: '邮箱登录失败。请重新验证。' }) : reply(200, { ok: true, page: 1, pageSize: 50, total: 0, items: [] }) } });
  try {
    await h.mail.select('pending'); assert.match(h.page, /「待处理邮件」里没有邮件/); assert.match(h.page, /星标/);
    h.form('mail-search-form').elements.query.value = 'zzz'; h.submit('mail-search-form'); await new Promise(resolve => setImmediate(resolve));
    assert.match(h.page, /没有符合搜索条件的邮件/); await h.act('clear-search'); assert.equal(h.calls('/api/mail/messages').at(-1).query.query, undefined);
    mode = 'fail'; await h.act('refresh'); assert.match(h.page, /读取邮件失败/); assert.match(h.page, /请重新验证/); assert.match(h.page, /data-mail-action="refresh">重试/);
    await h.mail.select('bulk'); assert.match(h.page, /还没有群发记录/); assert.match(h.page, /data-mail-action="bulk-new"/);
  } finally { h.dispose(); }
});

test('opening a message shows its details and attachments; html runs in a locked frame', async () => {
  let html = '';
  const h = harness({ routes: { '/api/mail/message': ({ reply }) => reply(200, { ok: true, message: { ...MESSAGE, html } }) } });
  try {
    await h.mail.select();
    const opening = h.act('open', { box: 'inbox', uid: '4' });
    assert.match(h.page, /正在读取邮件内容/); await opening;
    assert.deepEqual(h.calls('/api/mail/message').at(-1).query, { box: 'inbox', uid: '4' });
    assert.match(h.page, /<h1>收件箱（2）<\/h1>/, 'the list stays on screen beside the message'); assert.match(h.page, /mail-split reading contact-auto/);
    assert.match(h.page, /<div class="mail-row  selected" role="listitem"><button type="button" class="mail-row-main" data-mail-action="open" data-box="inbox" data-uid="4" aria-current="true">/, 'the open message is highlighted in the list and no longer unread');
    assert.match(h.page, /<h2 class="mail-reader-subject">样品寄送确认<\/h2>/); assert.match(h.page, /mail-avatar"[^>]*>李<\/span>/); assert.match(h.page, /mail-reader-name">李伟<\/strong><span class="mail-reader-address">liwei@shenzhen-parts\.example</); assert.match(h.page, /Ops &lt;ops@example-trade\.com&gt;/); assert.match(h.page, /<dt>抄送<\/dt><dd>purchasing@/);
    assert.match(h.page, /class="mail-quick-reply" data-mail-action="reply">.*回复 李伟…/);
    assert.match(h.page, /<div class="mail-body-text">您好，\n样品已寄出。<\/div>/); assert.doesNotMatch(h.page, /<iframe/);
    assert.match(h.page, /附件（1）/); assert.match(h.page, /装箱单 &lt;1&gt;\.pdf/); assert.match(h.page, /2\.0 KB/); assert.match(h.page, /data-mail-action="attachment-save" data-index="0"/);
    for (const action of ['reply', 'reply-all', 'forward', 'mark-unread', 'toggle-pending', 'delete', 'back']) assert.match(h.page, new RegExp(`data-mail-action="${action}"`));
    assert.match(h.page, /data-mail-action="customer-open" data-name="深圳配件"/);
    assert.doesNotMatch(/data-mail-folder="unread"[^>]*>.*?<\/button>/.exec(h.mail.subnav())[0], /mail-count/, 'the unread badge drops once the message is read');
    await h.act('attachment-save', { index: '0' });
    assert.deepEqual(h.calls('/api/mail/attachment/save').at(-1).payload, { box: 'inbox', uid: 4, index: 0 });
    html = '<p onclick="x()">Hi</p><script>alert(1)</script><img src="https://t.example/p.gif"><a href="https://x.example">link</a>';
    await h.act('refresh');
    const frame = /<iframe class="mail-body-frame"[^>]*>/.exec(h.page)[0];
    assert.match(frame, / sandbox="allow-popups allow-popups-to-escape-sandbox" /); assert.doesNotMatch(frame, /allow-scripts|allow-same-origin|allow-forms|allow-top-navigation/); assert.match(frame, /referrerpolicy="no-referrer"/);
    const doc = decode((/srcdoc="([^"]*)"/.exec(frame))[1]);
    assert.match(doc, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">/); assert.ok(doc.includes(html));
    assert.doesNotMatch(h.page.replace(frame, ''), /<script|onclick=/, 'message html never lands in the app document itself'); assert.match(h.page, /远程图片不会加载/);
    await h.act('back'); assert.match(h.page, /<h1>收件箱/); assert.match(h.page, /mail-reader-empty/); assert.doesNotMatch(h.page.match(/<div class="mail-row [^"]*"/)[0], /unread|selected/);
  } finally { h.dispose(); }
});

test('a message that cannot be opened says why and returns to the list', async () => {
  const h = harness({ routes: { '/api/mail/message': ({ reply }) => reply(404, { ok: false, code: 'not_found', message: '这封邮件已经不在邮箱里了' }) } });
  try {
    await h.mail.select(); await h.act('open', { box: 'inbox', uid: '4' });
    assert.match(h.page, /无法打开这封邮件/); assert.match(h.page, /已经不在邮箱里了/);
    await h.act('back'); assert.match(h.page, /<h1>收件箱/); assert.match(h.page, /mail-reader-empty/);
  } finally { h.dispose(); }
});

test('pending, unread and delete change the mailbox through the service and update the page', async () => {
  let failFlags = false;
  const h = harness({ routes: { '/api/mail/flags': ({ reply }) => failFlags ? reply(502, { ok: false, message: '邮箱服务器拒绝了这个请求' }) : reply(200, { ok: true }), '/api/mail/trash': ({ reply }) => reply(200, { ok: true }) } });
  try {
    await h.mail.select();
    await h.act('toggle-pending', { box: 'inbox', uid: '4' });
    assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 4, pending: true }); assert.match(h.page, /data-uid="4" aria-pressed="true"/); assert.match(h.mail.subnav(), /data-mail-folder="pending"[^>]*>.*?mail-count">2</);
    await h.act('toggle-pending', { box: 'inbox', uid: '3' }); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 3, pending: false });
    failFlags = true; await h.act('toggle-pending', { box: 'inbox', uid: '3' }); assert.deepEqual(h.toasts, ['邮箱服务器拒绝了这个请求']); assert.match(h.page, /data-uid="3" aria-pressed="false"/, 'a failed change is not shown as done');
    failFlags = false; await h.act('open', { box: 'inbox', uid: '4' });
    const lists = h.calls('/api/mail/messages').length;
    await h.act('mark-unread'); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 4, seen: false }); assert.match(h.page, /<h1>收件箱/); assert.equal(h.calls('/api/mail/messages').length, lists + 1, 'the list is re-read');
    await h.act('open', { box: 'inbox', uid: '4' });
    h.act('delete'); assert.equal(h.dialog.type, 'mail-confirm'); assert.match(h.dialog.body, /删除「样品寄送确认」/); assert.match(h.dialog.body, /可以在 Zoho 里恢复/); assert.equal(h.calls('/api/mail/trash').length, 0, 'asking does not delete');
    await h.act('delete-confirm'); assert.deepEqual(h.calls('/api/mail/trash').at(-1).payload, { box: 'inbox', uid: 4 }); assert.equal(h.closed, 1); assert.equal(h.toasts.at(-1), '已移到「已删除」'); assert.match(h.page, /<h1>收件箱/);
  } finally { h.dispose(); }
});

test('写信 opens a full page, not a drawer, with the editor, signature-free body and sender shown', async () => {
  const h = harness();
  try {
    await h.mail.select();
    await h.act('compose');
    assert.equal(h.dialog, null, 'no drawer is opened'); assert.equal(h.mail.composing(), true);
    assert.match(h.page, /<h1>写信<\/h1>/); assert.match(h.page, /data-mail-action="compose-close">.*返回/); assert.match(h.page, /id="mail-compose-submit">发送</); assert.match(h.page, /data-mail-action="compose-draft"/);
    assert.match(h.page, /<div class="mail-editor-toolbar"><\/div><div class="mail-editor" id="mail-compose-editor"/); assert.match(h.page, /mail-compose-address">sales@example-trade\.com</);
    assert.match(h.page, /data-mail-action="compose-cc"/); assert.equal(h.form('mail-compose-form').elements.cc, undefined);
    assert.equal(h.editor.html, '<div><br></div>'); assert.doesNotMatch(h.page.split('id="mail-compose-editor"')[1].split('</div>')[0], /\S</, 'body content is handed to the editor, never written into the page markup');
    const f = h.form('mail-compose-form').elements; f.to.value = 'a@b.example'; h.editor.html = '<div>typed</div>';
    await h.act('compose-cc');
    const again = h.form('mail-compose-form').elements;
    assert.deepEqual([again.to.value, again.cc.value, again.bcc.value, h.editor.html], ['a@b.example', '', '', '<div>typed</div>'], 'showing Cc/Bcc redraws without losing what was typed'); assert.equal(h.editors.at(-2).destroyed, true);
    const before = h.mounted.length; await h.act('refresh'); assert.equal(h.mounted.length, before, 'background list loads never redraw the compose page');
  } finally { h.dispose(); }
});

test('reply, reply-all and forward prefill the right recipients, subject, quoted original and thread ids', async () => {
  let html = '';
  const h = harness({ routes: { '/api/mail/message': ({ reply }) => reply(200, { ok: true, message: { ...MESSAGE, html } }), '/api/mail/send': ({ reply }) => reply(200, { ok: true, recipients: ['x@y.example'], rejected: [] }) } });
  try {
    await h.mail.select(); await h.act('open', { box: 'inbox', uid: '4' });
    await h.act('reply'); let f = h.form('mail-compose-form').elements;
    assert.match(h.page, /<h1>回复<\/h1>/); assert.equal(f.to.value, '李伟 <liwei@shenzhen-parts.example>'); assert.equal(f.cc, undefined); assert.equal(f.subject.value, 'Re: 样品寄送确认');
    assert.match(h.editor.html, /^<div><br><\/div><div><br><\/div><div>在 2026-10-06 \d\d:10，李伟 &lt;liwei@shenzhen-parts\.example&gt; 写道：<\/div><blockquote><div>您好，<\/div><div>样品已寄出。<\/div><\/blockquote>$/);
    await h.act('compose-close'); assert.equal(h.calls('/api/mail/drafts/save').length, 0, 'an untouched reply is not saved as a draft'); assert.match(h.page, /<h2 class="mail-reader-subject">样品寄送确认<\/h2>/, 'closing returns to the message');
    await h.act('reply-all'); f = h.form('mail-compose-form').elements;
    assert.equal(f.to.value, '李伟 <liwei@shenzhen-parts.example>'); assert.equal(f.cc.value, 'Ops <ops@example-trade.com>, purchasing@shenzhen-parts.example', 'own address is left out, and Cc is shown because it is filled');
    h.editor.html = '<div>好的</div>' + h.editor.html; await h.submit('mail-compose-form');
    const sent = h.calls('/api/mail/send').at(-1).payload;
    assert.equal(sent.inReplyTo, '<s-9@shenzhen-parts.example>'); assert.equal(sent.references, '<s-8@x> <s-9@shenzhen-parts.example>'); assert.equal(sent.forwardOf, null);
    assert.match(sent.html, /^<div style="font-family:[^"]+"><div>好的<\/div>.*<blockquote style="margin:[^"]+"><div>您好，<\/div>/, 'outgoing html carries inline styles the recipient can render'); assert.match(sent.text, /^好的\n/);
    html = '<p>Original <b>html</b></p><script>alert(1)</script>';
    await h.act('refresh'); await h.act('forward'); f = h.form('mail-compose-form').elements;
    assert.match(h.page, /<h1>转发<\/h1>/); assert.equal(f.to.value, ''); assert.equal(f.subject.value, 'Fwd: 样品寄送确认');
    assert.match(h.editor.html, /转发的邮件[\s\S]*发件人：李伟 &lt;liwei@[\s\S]*主题：样品寄送确认[\s\S]*<p>Original <b>html<\/b><\/p>/, 'the original html is quoted (the real editor sanitises it)');
    assert.doesNotMatch(h.page, /<script>alert|Original <b>html/, 'quoted html goes to the editor only, never into the page markup');
    assert.match(h.page, /name="forwardAttachments" checked> 附带原邮件的 1 个附件/);
    f.to.value = 'boss@example-trade.com'; f.forwardAttachments.checked = false; await h.submit('mail-compose-form');
    const forwarded = h.calls('/api/mail/send').at(-1).payload;
    assert.deepEqual(forwarded.forwardOf, { box: 'inbox', uid: 4 }); assert.equal(forwarded.forwardAttachments, false); assert.equal(forwarded.inReplyTo, '');
  } finally { h.dispose(); }
  const again = harness({ routes: { '/api/mail/message': ({ reply }) => reply(200, { ok: true, message: { ...MESSAGE, subject: 'RE: already', replyTo: [{ name: '', address: 'reply-here@x.example' }] } }) } });
  try { await again.mail.select(); await again.act('open', { box: 'inbox', uid: '4' }); await again.act('reply'); const f = again.form('mail-compose-form').elements; assert.equal(f.subject.value, 'RE: already'); assert.equal(f.to.value, 'reply-here@x.example'); }
  finally { again.dispose(); }
});

test('composing validates, attaches files, sends once and reports the result', async () => {
  let attempt = 0;
  const h = harness({ routes: { '/api/mail/send': ({ reply }) => ++attempt === 1 ? reply(422, { ok: false, code: 'smtp_rejected', message: '收件人 gone@x.example 被发信服务器拒绝，邮件没有发出' }) : new Promise(resolve => setImmediate(() => resolve(reply(200, { ok: true, recipients: ['a@b.example'], rejected: ['c@d.example'] })))) } });
  try {
    await h.mail.select('sent');
    await h.act('compose'); let f = h.form('mail-compose-form').elements;
    await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-error').textContent, '请至少填写一位收件人');
    f.to.value = 'a@b.example'; await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-error').textContent, '主题和正文不能都为空'); assert.equal(h.calls('/api/mail/send').length, 0);
    h.node('mail-compose-file').files = [{ name: '报价.pdf', type: 'application/pdf', size: 4, content: '%PDF' }, { name: 'huge.bin', type: '', size: 11 * 1024 * 1024, content: '' }, { name: 'slow.txt', type: 'text/plain', size: 2, content: 'ok', slow: true }, { name: 'broken.txt', type: 'text/plain', size: 1, fail: true }];
    const slow = h.node('mail-compose-file').files[2];
    h.fire('mail-compose-file', 'change');
    assert.match(h.node('mail-compose-file-list').innerHTML, /报价\.pdf[\s\S]*slow\.txt/); assert.doesNotMatch(h.node('mail-compose-file-list').innerHTML, /huge\.bin|broken\.txt/);
    await h.act('compose-cc'); f = h.form('mail-compose-form').elements;
    f.subject.value = 'Hello'; h.editor.html = '<div>Body <b>bold</b></div>'; f.cc.value = 'c@d.example'; f.fromName.value = ' Kris ';
    await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-error').textContent, '附件还在读取，请稍候再发送'); assert.equal(h.calls('/api/mail/send').length, 0);
    slow.finish(); h.act('file-remove', { index: '1' }); assert.doesNotMatch(h.node('mail-compose-file-list').innerHTML, /slow\.txt/);
    await h.submit('mail-compose-form');
    assert.match(h.node('mail-compose-error').textContent, /gone@x\.example/); assert.equal(h.mail.composing(), true); assert.equal(h.node('mail-compose-submit').disabled, false); assert.equal(h.node('mail-compose-submit').textContent, '发送');
    const first = h.submit('mail-compose-form'); await h.submit('mail-compose-form');
    assert.equal(h.node('mail-compose-submit').textContent, '正在发送…'); await first;
    assert.equal(h.calls('/api/mail/send').length, 2, 'a second click while sending is ignored');
    const payload = h.calls('/api/mail/send').at(-1).payload;
    assert.deepEqual({ ...payload, html: undefined }, { to: 'a@b.example', cc: 'c@d.example', bcc: '', subject: 'Hello', text: 'Body bold\n', html: undefined, inReplyTo: '', references: '', forwardOf: null, fromName: 'Kris', forwardAttachments: true, attachments: [{ filename: '报价.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }] });
    assert.match(payload.html, /^<div style="[^"]+"><div>Body <b>bold<\/b><\/div><\/div>$/);
    assert.equal(h.mail.composing(), false); assert.equal(h.editors.at(-1).destroyed, true); assert.equal(h.toasts.at(-1), '已发送给 1 位收件人；c@d.example 被服务器拒绝，没有收到'); assert.equal(h.mail.account().senderName, 'Kris');
    assert.match(h.page, /<h1>发件箱/); assert.equal(h.calls('/api/mail/messages').length, 2, 'the sent folder is shown again and re-read after sending');
  } finally { h.dispose(); }
});

test('leaving an edited message saves it as a draft; drafts can be reopened, sent and deleted', async () => {
  const stored = [];
  let failSave = false;
  const h = harness({ routes: {
    '/api/mail/drafts/save': ({ payload, reply }) => { if (failSave) return reply(503, { ok: false, message: 'storage unavailable' }); const draft = { ...payload, id: payload.id || 'a'.repeat(32), updatedAt: '2026-10-06T09:00:00.000Z' }; stored.splice(0, stored.length, draft); return reply(200, { ok: true, draft }); },
    '/api/mail/drafts': ({ reply }) => reply(200, { ok: true, items: stored.map(d => ({ ...d })) }),
    '/api/mail/drafts/delete': ({ reply }) => { stored.length = 0; return reply(200, { ok: true }); },
    '/api/mail/send': ({ reply }) => reply(200, { ok: true, recipients: ['a@b.example'], rejected: [] }) } });
  try {
    await h.mail.select('drafts'); assert.match(h.page, /草稿箱是空的/); assert.match(h.page, /只保存在这台电脑上/);
    await h.act('compose'); await h.act('compose-close'); assert.equal(stored.length, 0, 'an empty message is just closed'); assert.equal(h.mail.composing(), false); assert.match(h.page, /<h1>草稿箱/);
    await h.act('compose'); let f = h.form('mail-compose-form').elements; f.to.value = 'a@b.example'; f.subject.value = '报价 <1>';
    failSave = true; assert.equal(await h.mail.select('inbox'), false, 'switching folders is refused while the draft cannot be saved');
    assert.match(h.node('mail-compose-error').textContent, /草稿保存失败：storage unavailable 再点一次「返回」将放弃这封信/); assert.equal(h.mail.composing(), true); assert.equal(h.mail.folder(), 'drafts');
    failSave = false; await h.act('compose-draft'); assert.equal(h.toasts.at(-1), '已存入草稿箱'); assert.equal(h.mail.composing(), true);
    assert.deepEqual(h.calls('/api/mail/drafts/save').at(-1).payload, { to: 'a@b.example', cc: '', bcc: '', subject: '报价 <1>', text: '\n\n', html: '<div><br></div>', inReplyTo: '', references: '', forwardOf: null, attachments: [] });
    assert.equal(h.mail.composeDirty(), false); h.editor.html = '<div>more <i>text</i></div>'; assert.equal(h.mail.composeDirty(), true);
    await h.mail.select('drafts');
    assert.equal(h.calls('/api/mail/drafts/save').at(-1).payload.id, 'a'.repeat(32), 'the same draft is updated, not duplicated'); assert.equal(h.calls('/api/mail/drafts/save').at(-1).payload.html, '<div>more <i>text</i></div>'); assert.equal(h.mail.composing(), false);
    assert.match(h.page, /草稿箱（1）/); assert.match(h.page, /发给 a@b\.example/); assert.match(h.page, /报价 &lt;1&gt;/);
    await h.act('draft-open', { id: 'a'.repeat(32) }); f = h.form('mail-compose-form').elements;
    assert.match(h.page, /<h1>继续写信<\/h1>/); assert.deepEqual([f.to.value, f.subject.value, h.editor.html], ['a@b.example', '报价 <1>', '<div>more <i>text</i></div>'], 'formatting is kept in the draft');
    await h.act('compose-close'); assert.equal(h.calls('/api/mail/drafts/save').length, 3, 'reopening without changes does not save again');
    await h.act('draft-open', { id: 'a'.repeat(32) }); await h.submit('mail-compose-form');
    assert.equal(h.calls('/api/mail/send').at(-1).payload.draftId, 'a'.repeat(32)); assert.equal(h.calls('/api/mail/send').at(-1).payload.id, undefined);
    stored.push({ id: 'b'.repeat(32), to: '', subject: '', text: 'plain only', updatedAt: '2026-10-06T09:00:00.000Z' }); await h.act('refresh'); assert.match(h.page, /（未填收件人）/); assert.match(h.page, /（无主题）/);
    await h.act('draft-open', { id: 'b'.repeat(32) }); assert.equal(h.editor.html, '<div>plain only</div>', 'an older text-only draft opens as text'); await h.act('compose-close');
    await h.act('draft-delete', { id: 'b'.repeat(32) }); assert.deepEqual(h.calls('/api/mail/drafts/delete').at(-1).payload, { id: 'b'.repeat(32) }); assert.match(h.page, /草稿箱是空的/);
  } finally { h.dispose(); }
});

test('the customer tab lists customers with addresses and shows their correspondence', async () => {
  const h = harness({ routes: { '/api/mail/correspondence': ({ query, reply }) => query.addresses.includes('anna') ? reply(200, { ok: true, items: [{ ...INBOX[1] }, { box: 'sent', uid: 6, from: self, to: [anna], cc: [], subject: 'Quotation', date: '2026-10-04T08:00:00.000Z', seen: true, pending: false }] }) : reply(502, { ok: false, message: '无法连接邮箱服务器' }) } });
  try {
    await h.mail.showView('customer');
    assert.deepEqual([...h.mail.subnav().matchAll(/data-mail-action="customer-select" data-name="([^"]+)"/g)].map(m => m[1]).sort(), ['Nordic Lamps AB', '深圳配件'], 'customers without an address or in the recycle bin are left out');
    assert.match(h.page, /选择一个客户/); assert.match(h.page, /2 个填写了邮箱的客户/); assert.doesNotMatch(h.mail.subnav(), /data-mail-folder/);
    await h.act('customer-select', { name: 'Nordic Lamps AB' });
    assert.deepEqual(h.calls('/api/mail/correspondence').at(-1).query, { addresses: 'anna@nordic-lamps.example' });
    assert.match(h.page, /<h1>Nordic Lamps AB<\/h1>/); assert.match(h.page, /最近的 2 封/);
    assert.deepEqual([...h.page.matchAll(/mail-direction (in|out)">(.)<\/span><span class="mail-row-who">([^<]*)</g)].map(m => m.slice(1)), [['in', '收', 'Anna Berg'], ['out', '发', 'Anna Berg']]);
    await h.act('customer-compose'); assert.equal(h.form('mail-compose-form').elements.to.value, 'anna@nordic-lamps.example'); await h.act('compose-close'); assert.match(h.page, /<h1>Nordic Lamps AB<\/h1>/, 'closing returns to the customer view');
    await h.act('open', { box: 'sent', uid: '6' }); assert.deepEqual(h.calls('/api/mail/message').at(-1).query, { box: 'sent', uid: '6' }); await h.act('back'); assert.match(h.page, /<h1>Nordic Lamps AB<\/h1>/);
    await h.act('customer-select', { name: '深圳配件' });
    assert.equal(h.calls('/api/mail/correspondence').at(-1).query.addresses, 'liwei@shenzhen-parts.example,wanglei@shenzhen-parts.example'); assert.match(h.page, /读取往来邮件失败/); assert.match(h.page, /无法连接邮箱服务器/);
    await h.mail.showView('team'); assert.match(h.page, /<h1>下属邮件<\/h1>/); assert.match(h.page, /单机版/);
    await h.mail.showView('nope'); assert.equal(h.mail.view(), 'mail');
  } finally { h.dispose(); }
  const none = harness({ customers: { 'No Mail Co': {} } });
  try { await none.mail.showView('customer'); assert.match(none.page, /还没有填写了邮箱的客户/); assert.equal(none.calls('/api/mail/correspondence').length, 0); } finally { none.dispose(); }
  assert.deepEqual(Mail.customerAddresses({ email: ' A@B.co ', emails: ['a@b.co', 'c@d.io', 5, null], contacts: [null, { email: 'E@F.org' }, {}], alternateEmail: 'x' }), ['a@b.co', 'c@d.io', 'e@f.org']);
});

test('mailbox settings show the account, re-verify it, and unbind only after confirmation', async () => {
  let ok = true;
  const h = harness({ routes: { '/api/mail-account/verify': ({ reply }) => ok ? reply(200, { ok: true, available: true, account: { ...ACCOUNT, verifiedAt: '2026-10-07T01:02:00.000Z' } }) : reply(422, { ok: false, code: 'auth_failed', message: '登录被邮箱服务器拒绝' }), '/api/mail-account/unbind': ({ reply }) => reply(200, { ok: true, available: true, account: null }) } });
  try {
    await h.mail.select(); assert.match(h.page, /data-mail-action="account"/);
    h.act('account'); assert.equal(h.dialog.type, 'mail-account'); assert.match(h.dialog.body, /已绑定/); assert.match(h.dialog.body, /sales@example-trade\.com/); assert.match(h.dialog.body, /imappro\.zoho\.com\.cn:993/);
    await h.act('verify'); assert.deepEqual(h.toasts, ['验证通过，邮箱连接正常']); assert.equal(h.mail.account().verifiedAt, '2026-10-07T01:02:00.000Z'); assert.doesNotMatch(h.dialog.body, /disabled/);
    ok = false; await h.act('verify'); assert.match(h.dialog.body, /id="mail-account-error" role="alert">登录被邮箱服务器拒绝</); assert.match(h.dialog.body, /class="error visible"/); assert.equal(h.mail.account().email, ACCOUNT.email, 'a failed check keeps the binding');
    h.act('unbind'); assert.equal(h.dialog.type, 'mail-unbind'); assert.match(h.dialog.body, /密码会一并删除，本机草稿保留/); assert.equal(h.calls('/api/mail-account/unbind').length, 0);
    await h.act('unbind-confirm'); assert.equal(h.mail.account(), null); assert.equal(h.toasts.at(-1), '已解除绑定'); assert.match(h.page, /未绑定邮箱/); assert.doesNotMatch(h.page, /样品寄送确认/, 'mail from the old binding is cleared'); assert.doesNotMatch(h.mail.subnav(), /mail-count/);
  } finally { h.dispose(); }
});

test('the web trial explains that it cannot connect and sends nothing', async () => {
  const h = harness({ account: null, available: false });
  try {
    await h.mail.select();
    await h.act('compose'); assert.deepEqual(h.toasts, ['网页试用版无法收发邮件']);
    assert.match(h.dialog.body, /网页试用版[^<]*无法连接邮箱服务器/); assert.match(h.dialog.footer, /id="mail-bind-submit" disabled/);
    const f = h.form('mail-bind-form').elements; f.email.value = 'a@zoho.com.cn'; f.password.value = 'p'; await h.submit('mail-bind-form');
    assert.deepEqual(h.requests.map(r => r.route), ['/api/mail-account']);
  } finally { h.dispose(); }
});

test('answers that arrive after leaving the mail page do not redraw another page', async () => {
  const h = harness();
  try {
    const pending = h.mail.select(); const count = h.mounted.length; h.setActive(false); await pending;
    assert.equal(h.mounted.length, count); assert.equal(h.mail.account().email, ACCOUNT.email);
  } finally { h.dispose(); }
});

test('the page module only talks through the provided request and keeps no credential', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const source = read('src/mail-ui.js');
  for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'console.', 'innerHTML = m.', 'eval(']) assert.ok(!source.includes(banned), banned);
  assert.deepEqual([...new Set([...source.matchAll(/"(\/api\/[^"?]+)"/g)].map(m => m[1]))].sort(), ['/api/mail-account', '/api/mail-account/bind', '/api/mail-account/settings', '/api/mail-account/unbind', '/api/mail-account/verify', '/api/mail/attachment/save', '/api/mail/bulk', '/api/mail/bulk/batch', '/api/mail/bulk/cancel', '/api/mail/bulk/start', '/api/mail/correspondence', '/api/mail/draft', '/api/mail/drafts', '/api/mail/drafts/delete', '/api/mail/drafts/save', '/api/mail/flags', '/api/mail/message', '/api/mail/messages', '/api/mail/send', '/api/mail/status', '/api/mail/templates', '/api/mail/templates/delete', '/api/mail/templates/save', '/api/mail/trash']);
  for (const marker of ['<!--MAIL_STYLE-->', '<!--LAI_MAIL_UI-->', '<!--LAI_MAIL_EDITOR-->']) { assert.equal(read('src/template.html').split(marker).length, 2, marker); assert.ok(read('scripts/build.py').includes(marker), marker); }
  const app = read('src/app.js');
  assert.ok(app.includes('["mail", "邮件", "mail"]')); for (const hook of ['d.mailFolder', 'd.mailAction', 'd.mailView', 'mail?.composing() && !(await mail.leave())', 'mail?.composeDirty()', 'd.feature === "写邮件"', 'LaiMailEditor.create']) assert.ok(app.includes(hook), hook);
  for (const file of ['mail-account.js', 'mail-imap.js', 'mail-client.js', 'mail-smtp.js', 'mail-mime.js', 'mail-service.js', 'mail-libs.js', 'mail-libs.cjs', 'squire-raw.js', 'purify.min.js']) assert.ok(read('scripts/build.py').includes(`'${file}'`), file + ' is bundled into the app');
  const RM = require('../src/rail-menu.js');
  assert.deepEqual(RM.menuFor('邮件', {}).map(row => [row.label, row.kind, row.target]), Mail.folders.map(f => [f.label, 'mail', f.id]));
});

test('the web trial sample mailbox is labelled as a sample everywhere and never claims a real send', async () => {
  const h = harness({ account: { ...ACCOUNT, email: 'demo@lai-trial.example', demo: true, host: '', port: 0 }, available: false, routes: { '/api/mail/send': ({ reply }) => reply(200, { ok: true, recipients: ['a@b.example'] }) } });
  try {
    await h.mail.select();
    assert.match(h.page, /mail-demo-tag[^>]*>示例邮箱 · 不会真的发信</); assert.match(h.page, /样品寄送确认/);
    h.act('account'); assert.match(h.dialog.body, /示例邮箱（网页试用版）/); assert.match(h.dialog.body, /不会真的发出/); assert.doesNotMatch(h.dialog.body, /data-mail-action="(verify|unbind|bind)"|已绑定/);
    await h.act('compose'); const f = h.form('mail-compose-form').elements; f.to.value = 'a@b.example'; f.subject.value = 'x'; await h.submit('mail-compose-form');
    assert.equal(h.toasts.at(-1), '示例邮箱：邮件没有真的发出，已放入发件箱');
  } finally { h.dispose(); }
  const real = harness();
  try { await real.mail.select(); assert.doesNotMatch(real.page, /mail-demo-tag|示例邮箱/); } finally { real.dispose(); }
});

test('the sample mailbox script answers like the local mail service and sends nothing anywhere', async () => {
  const outside = [];
  const sandbox = { fetch: (...args) => { outside.push(args[0]); return Promise.resolve(new Response('{}')); }, Response, URLSearchParams, JSON, Date, Promise, String, Number, Math };
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/web-trial/mail-demo.js'), 'utf8'), Object.assign(sandbox, { window: sandbox }));
  const get = async (url) => (await sandbox.fetch(url)).json(), post = async (url, body) => { const r = await sandbox.fetch(url, { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const status = await get('/api/mail-account');
  assert.equal(status.available, false); assert.equal(status.account.demo, true); assert.equal(status.account.password, undefined);
  assert.equal((await post('/api/mail-account/bind', { email: 'a@b.co', password: 'x' })).status, 501);
  const inbox = await get('/api/mail/messages?folder=inbox');
  assert.equal(inbox.total, 8); assert.deepEqual(inbox.counts, { unread: 4, pending: 2 }); assert.ok(inbox.items.every(i => i.snippet && i.snippet.length <= 141 && !/\n/.test(i.snippet)), 'every row has a one-line preview'); assert.ok(inbox.items.every(i => /示例|Sample/.test(i.subject)), 'every sample message says it is a sample');
  assert.equal((await get('/api/mail/messages?folder=pending')).total, 2); assert.equal((await get('/api/mail/messages?folder=inbox&query=' + encodeURIComponent('londonlash'))).total, 2);
  const opened = await get('/api/mail/message?box=inbox&uid=13'); assert.equal(opened.message.attachments.length, 1); assert.equal((await get('/api/mail/messages?folder=unread')).total, 3);
  assert.equal((await post('/api/mail/attachment/save', { box: 'inbox', uid: 13, index: 0 })).status, 501);
  assert.equal((await post('/api/mail/send', { to: '', subject: 's', text: 't' })).status, 400); assert.equal((await post('/api/mail/send', { to: 'nope', subject: 's', text: 't' })).status, 400);
  const draft = (await post('/api/mail/drafts/save', { to: 'charlotte@londonlashpro.example', subject: 'd' })).body.draft;
  const sent = await post('/api/mail/send', { to: 'Charlotte <charlotte@londonlashpro.example>', subject: 'PI', text: 'hello', draftId: draft.id, fromName: 'Kris' });
  assert.equal(sent.status, 200); assert.deepEqual(sent.body.recipients, ['charlotte@londonlashpro.example']);
  assert.equal((await get('/api/mail/messages?folder=sent')).items[0].subject, 'PI'); assert.equal((await get('/api/mail/drafts')).items.length, 0);
  assert.deepEqual((await get('/api/mail/correspondence?addresses=charlotte@londonlashpro.example')).items.map(i => i.box), ['sent', 'inbox', 'inbox', 'sent']);
  await post('/api/mail/trash', { box: 'inbox', uid: 13 }); assert.equal((await get('/api/mail/messages?folder=inbox')).total, 7);
  assert.equal((await post('/api/mail/bulk/start', { subject: 's', text: 't', recipients: [] })).status, 400);
  const bulk = await post('/api/mail/bulk/start', { subject: 's', text: 't', recipients: [{ address: 'a@b.example', name: 'A', customer: 'Co' }, { address: 'c@d.example' }] });
  assert.deepEqual([bulk.body.batch.status, bulk.body.batch.total, bulk.body.batch.sent], ['done', 2, 2]); assert.equal((await get('/api/mail/bulk')).items.length, 1);
  assert.equal((await get('/api/mail/bulk/batch?id=' + bulk.body.batch.id)).batch.items[0].status, 'sent'); assert.equal((await sandbox.fetch('/api/mail/bulk/batch?id=nope')).status, 404);
  assert.equal((await post('/api/mail-account/settings', { senderName: 'K', signature: 'sig' })).body.account.signature, 'sig'); assert.equal((await get('/api/mail-account')).account.signature, 'sig');
  // 新接口：收件箱概况、批量标记与删除、带附件的草稿、模板、会话用的邮件头
  const state = await get('/api/mail/status'); assert.deepEqual([typeof state.unread, typeof state.pending, typeof state.uidNext], ['number', 'number', 'number']);
  assert.equal((await post('/api/mail/flags', { box: 'inbox', uids: [8, 9], seen: false, pending: true })).body.count, 2); assert.equal((await get('/api/mail/status')).pending, state.pending + 1, 'uid 8 was already pending, uid 3 is new');
  const beforeTrash = (await get('/api/mail/messages?folder=inbox')).total; assert.equal((await post('/api/mail/trash', { box: 'inbox', uids: [9, 10] })).body.count, 2); assert.equal((await get('/api/mail/messages?folder=inbox')).total, beforeTrash - 2);
  const threaded = (await get('/api/mail/messages?folder=inbox')).items; assert.equal(threaded.find(i => i.uid === 6).references, '<demo-5@lai-trial.example>'); assert.equal(threaded.find(i => i.uid === 7).inReplyTo, '');
  const filed = (await post('/api/mail/drafts/save', { subject: 'f', attachments: [{ filename: 'a.txt', contentType: 'text/plain', contentBase64: 'aGk=' }] })).body.draft; assert.deepEqual(filed.attachments, [{ filename: 'a.txt', contentType: 'text/plain', size: 3 }]);
  assert.deepEqual((await get('/api/mail/draft?id=' + filed.id)).attachments, [{ filename: 'a.txt', contentType: 'text/plain', contentBase64: 'aGk=' }]); assert.equal((await sandbox.fetch('/api/mail/draft?id=nope')).status, 404);
  assert.equal((await post('/api/mail/templates/save', { name: '', text: 'x' })).status, 400); const made = (await post('/api/mail/templates/save', { name: 'T', subject: 's', text: 'x' })).body.template;
  assert.equal((await post('/api/mail/templates/save', { name: 'T', text: 'y' })).status, 409); assert.deepEqual((await get('/api/mail/templates')).items.map(t => t.name), ['T']);
  await post('/api/mail/templates/delete', { id: made.id }); assert.equal((await get('/api/mail/templates')).items.length, 0);
  assert.equal((await post('/api/mail-account/settings', { senderName: 'K', signature: 'sig', autoCheck: false })).body.account.autoCheck, false);
  await sandbox.fetch('/api/data'); assert.deepEqual(outside, ['/api/data'], 'only non-mail requests pass through; mail requests never reach the network');
});

const BATCH = { id: 'c'.repeat(32), createdAt: '2026-10-06T09:00:00.000Z', finishedAt: '', subject: '新品目录 <2026>', status: 'sending', stopReason: '', total: 2, sent: 1, failed: 0, pending: 1, skipped: 0, text: 'Hi {{姓名}}', attachmentNames: ['目录.pdf'],
  items: [{ address: 'anna@nordic-lamps.example', name: 'Anna', customer: 'Nordic Lamps AB', status: 'sent', error: '', sentAt: '2026-10-06T09:00:02.000Z' }, { address: 'liwei@shenzhen-parts.example', name: '', customer: '深圳配件', status: 'pending', error: '' }] };

test('bulk mail is a compose page that picks customers, previews the personalised text, and only sends after a second confirming click', async () => {
  let fail = true;
  const customers = { 'Nordic Lamps AB': { email: 'anna@nordic-lamps.example', contact: 'Anna Berg' }, '深圳配件': { contacts: [{ contact: '王磊', email: 'wanglei@shenzhen-parts.example' }, { contact: '李伟', email: 'liwei@shenzhen-parts.example' }] }, 'Gulf <b>': { email: 'omar@gulf.example' }, 'No Mail Co': {} };
  const h = harness({ customers, account: { ...ACCOUNT, signature: 'Kris\nLai <Trading>' }, routes: {
    '/api/mail/bulk/start': ({ reply }) => fail ? reply(409, { ok: false, code: 'busy', message: '上一批群发还在发送' }) : reply(200, { ok: true, batch: { ...BATCH, text: undefined, items: undefined } }),
    '/api/mail/bulk/batch': ({ reply }) => reply(200, { ok: true, batch: { ...BATCH, status: 'done', sent: 2, pending: 0, items: BATCH.items.map(i => ({ ...i, status: 'sent', sentAt: '2026-10-06T09:00:04.000Z' })) } }) } });
  try {
    await h.mail.select('bulk');
    await h.act('bulk-new');
    assert.equal(h.dialog, null); assert.match(h.page, /<h1>新建群发<\/h1>/); assert.match(h.page, /看不到其他收件人/); assert.match(h.page, /已选 0 \/ 3 位客户/); assert.match(h.page, /data-mail-action="bulk-preview"/); assert.doesNotMatch(h.page, /compose-draft|name="to"/);
    assert.deepEqual([...h.page.matchAll(/data-mail-action="bulk-toggle" data-name="([^"]+)"[^>]*>.*?mail-bulk-address">([^<]*)</g)].map(m => m.slice(1)).sort(), [['Gulf &lt;b&gt;', 'omar@gulf.example'], ['Nordic Lamps AB', 'Anna Berg · anna@nordic-lamps.example'], ['深圳配件', '王磊 · wanglei@shenzhen-parts.example']]);
    const f = h.form('mail-compose-form').elements;
    assert.equal(h.editor.html, '<div><br></div><div><br></div><div class="lai-signature"><div>Kris</div><div>Lai &lt;Trading&gt;</div></div>', 'the signature is prefilled, escaped');
    await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-error').textContent, '请至少选择一位客户');
    h.act('bulk-all'); assert.equal(h.node('mail-bulk-count').textContent, '已选 3 / 3 位客户'); assert.equal([...h.node('mail-bulk-recipients').innerHTML.matchAll(/aria-checked="true"/g)].length, 3);
    h.act('bulk-none'); h.act('bulk-toggle', { name: 'Nordic Lamps AB' });
    await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-error').textContent, '请填写主题');
    f.subject.value = '{{公司}} 新品目录'; h.editor.html = '<div><br></div>'; await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-error').textContent, '请填写正文');
    h.editor.html = '<div>Hi {{ 姓名 }}，这是给<b>{{公司}}</b>的目录。</div>';
    h.act('bulk-preview'); assert.equal(h.node('mail-bulk-preview').hidden, false);
    assert.equal(h.node('mail-bulk-preview').textContent, '收件人：Anna Berg <anna@nordic-lamps.example>\n主题：Nordic Lamps AB 新品目录\n\nHi Anna Berg，这是给Nordic Lamps AB的目录。\n');
    h.act('bulk-toggle', { name: '深圳配件' }); assert.equal(h.node('mail-bulk-count').textContent, '已选 2 / 3 位客户');
    await h.submit('mail-compose-form');
    assert.equal(h.node('mail-compose-submit').textContent, '确认向 2 位客户分别发送'); assert.equal(h.calls('/api/mail/bulk/start').length, 0, 'the first click only asks for confirmation');
    h.act('bulk-toggle', { name: 'Gulf <b>' }); assert.equal(h.node('mail-compose-submit').textContent, '发送', 'changing the recipients cancels the pending confirmation');
    await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-submit').textContent, '确认向 3 位客户分别发送'); h.act('bulk-toggle', { name: 'Gulf <b>' });
    await h.submit('mail-compose-form'); await h.submit('mail-compose-form');
    assert.equal(h.node('mail-compose-error').textContent, '上一批群发还在发送'); assert.equal(h.mail.composing(), true); assert.equal(h.node('mail-compose-submit').textContent, '发送'); assert.equal(h.node('mail-compose-submit').disabled, false);
    assert.equal(await h.mail.select('inbox'), false); assert.match(h.node('mail-compose-error').textContent, /离开后不会保存。再点一次「返回」放弃/); assert.equal(h.calls('/api/mail/drafts/save').length, 0, 'bulk mail is never silently turned into a draft');
    fail = false; await h.submit('mail-compose-form'); await h.submit('mail-compose-form');
    const started = h.calls('/api/mail/bulk/start').at(-1).payload; started.recipients.sort((a, b) => a.address.localeCompare(b.address));
    assert.deepEqual({ ...started, html: undefined }, { subject: '{{公司}} 新品目录', text: 'Hi {{ 姓名 }}，这是给{{公司}}的目录。\n', html: undefined, fromName: '', attachments: [],
      recipients: [{ customer: 'Nordic Lamps AB', name: 'Anna Berg', address: 'anna@nordic-lamps.example' }, { customer: '深圳配件', name: '王磊', address: 'wanglei@shenzhen-parts.example' }] });
    assert.match(started.html, /^<div style="[^"]+"><div>Hi \{\{ 姓名 \}\}，这是给<b>\{\{公司\}\}<\/b>的目录。<\/div><\/div>$/);
    assert.equal(h.mail.composing(), false); assert.equal(h.toasts.at(-1), '已开始向 2 位客户发送');
    assert.deepEqual(h.calls('/api/mail/bulk/batch').at(-1).query, { id: 'c'.repeat(32) }); assert.match(h.page, /<h1>新品目录 &lt;2026&gt;<\/h1>/); assert.match(h.page, /已发 2 \/ 共 2/);
  } finally { h.dispose(); }
});

test('the bulk box lists batches, follows a sending batch until it finishes, and can stop it', async () => {
  let reads = 0, cancelled = false;
  const h = harness({ routes: {
    '/api/mail/bulk': ({ reply }) => reply(200, { ok: true, items: [{ ...BATCH, items: undefined, text: undefined }, { ...BATCH, id: 'd'.repeat(32), subject: 'Old', status: 'stopped', stopReason: '发信登录失败，已停止', sent: 0, failed: 1, pending: 0, skipped: 1 }] }),
    '/api/mail/bulk/batch': ({ reply }) => { reads++; return reply(200, { ok: true, batch: reads < 3 && !cancelled ? BATCH : { ...BATCH, status: cancelled ? 'cancelled' : 'done', stopReason: cancelled ? '已手动停止' : '', sent: cancelled ? 1 : 2, pending: 0, skipped: cancelled ? 1 : 0, items: [BATCH.items[0], { ...BATCH.items[1], status: cancelled ? 'skipped' : 'failed', error: cancelled ? '已手动停止' : '收件人被拒绝 <x>' }] } }); },
    '/api/mail/bulk/cancel': ({ reply }) => { cancelled = true; return reply(200, { ok: true }); } } });
  try {
    await h.mail.select('bulk');
    assert.match(h.page, /<h1>群发箱（2）<\/h1>/);
    assert.deepEqual([...h.page.matchAll(/data-mail-action="bulk-open" data-id="(\w)\w+"><span class="mail-row-top"><span class="mail-dot"><\/span><span class="mail-row-who"><span class="mail-bulk-tag (\w+)">([^<]+)<\/span> ([^<]+)</g)].map(m => m.slice(1)), [['c', 'sending', '发送中', '已发 1 / 共 2'], ['d', 'stopped', '已停止', '已发 0 / 共 2 · 失败 1 · 未发 1']]);
    await h.act('bulk-open', { id: 'c'.repeat(32) });
    assert.match(h.page, /正在逐封发送/); assert.match(h.page, /data-mail-action="bulk-cancel"/); assert.match(h.page, /mail-item-status pending">待发送</); assert.match(h.page, /mail-item-status sent">已发送</);
    assert.match(h.page, /data-mail-action="customer-open" data-name="Nordic Lamps AB"/); assert.match(h.page, /附件 1 个/); assert.match(h.page, /Hi \{\{姓名\}\}/);
    for (let i = 0; i < 50 && reads < 3; i++) await new Promise(resolve => setTimeout(resolve, 5));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reads, 3, 'polling stops once the batch is no longer sending'); assert.match(h.page, /mail-bulk-tag done">已完成</); assert.match(h.page, /mail-item-status failed">失败</); assert.match(h.page, /收件人被拒绝 &lt;x&gt;/); assert.doesNotMatch(h.page, /bulk-cancel|正在逐封发送/);
    const listReads = h.calls('/api/mail/bulk').length; await h.act('bulk-back'); assert.match(h.page, /<h1>群发箱（2）<\/h1>/);
    await new Promise(resolve => setTimeout(resolve, 30)); assert.ok(h.calls('/api/mail/bulk').length > listReads + 1, 'the list keeps refreshing while a batch is sending');
    reads = 0; await h.act('bulk-open', { id: 'c'.repeat(32) }); await h.act('bulk-cancel');
    assert.deepEqual(h.calls('/api/mail/bulk/cancel').at(-1).payload, { id: 'c'.repeat(32) }); assert.match(h.page, /已手动停止/); assert.match(h.page, /mail-item-status skipped">未发送</);
    const before = reads; h.setActive(false); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(reads, before);
  } finally { h.dispose(); }
});

test('写邮件 from the customer pages opens the compose page for one customer and bulk mail for several, then returns', async () => {
  const back = [];
  const h = harness({ active: false, customers: { 'Nordic Lamps AB': { email: 'anna@nordic-lamps.example', contact: 'Anna Berg' }, '深圳配件': { email: 'liwei@shenzhen-parts.example' }, 'No Mail Co': {} } });
  try {
    await h.mail.composeFor(['Nordic Lamps AB'], false, () => back.push('customer'));
    assert.deepEqual(h.requests.map(r => r.route), ['/api/mail-account'], 'the binding is read first, without loading any mail');
    assert.deepEqual(h.opened, ['mail:inbox'], 'the app is asked to show the mail page'); assert.equal(h.mounted.length, 0); assert.equal(h.mail.composeDirty(), false, 'a compose page that is not shown yet never blocks the navigation');
    h.setActive(true); await h.mail.select('inbox');
    assert.match(h.page, /<h1>写信<\/h1>/); assert.equal(h.form('mail-compose-form').elements.to.value, 'Anna Berg <anna@nordic-lamps.example>'); assert.equal(h.calls('/api/mail/messages').length, 0);
    await h.act('compose-close'); assert.deepEqual(back, ['customer'], 'closing goes back to where the user came from'); assert.equal(h.mail.composing(), false);
    await h.mail.composeFor(['No Mail Co']); assert.equal(h.toasts.at(-1), '这位客户还没有填写邮箱'); assert.equal(h.mail.composing(), false);
    await h.mail.composeFor(['No Mail Co', 'Nordic Lamps AB', '深圳配件', 'Nordic Lamps AB'], false, () => back.push('list'));
    assert.equal(h.toasts.at(-1), '1 位客户没有填写邮箱，已略过'); assert.match(h.page, /<h1>新建群发<\/h1>/); assert.match(h.page, /已选 2 \/ 2 位客户/);
    await h.act('compose-close'); assert.deepEqual(back, ['customer', 'list']);
    await h.mail.composeFor([]); await h.mail.composeFor(['No Mail Co', 'Unknown']); assert.equal(h.toasts.at(-1), '选中的客户都没有填写邮箱');
  } finally { h.dispose(); }
  const away = harness({ active: false, customers: { A: { email: 'a@x.example' }, B: { email: 'b@x.example' } }, routes: { '/api/mail/bulk/start': ({ reply }) => reply(200, { ok: true, batch: { ...BATCH, items: undefined } }), '/api/mail/bulk/batch': ({ reply }) => reply(200, { ok: true, batch: { ...BATCH, status: 'done' } }) } });
  try {
    await away.mail.composeFor(['A', 'B']); away.setActive(true); await away.mail.select('inbox');
    const f = away.form('mail-compose-form').elements; f.subject.value = 's'; away.editor.html = '<div>t</div>';
    await away.submit('mail-compose-form'); await away.submit('mail-compose-form');
    assert.deepEqual(away.calls('/api/mail/bulk/batch').at(-1).query, { id: 'c'.repeat(32) }); assert.match(away.page, /<h1>新品目录/, 'the batch that was just started is shown');
  } finally { away.dispose(); }
  const unbound = harness({ account: null, active: false });
  try { await unbound.mail.composeFor(['Nordic Lamps AB']); assert.equal(unbound.toasts.at(-1), '请先绑定邮箱'); assert.equal(unbound.dialog.type, 'mail-bind'); } finally { unbound.dispose(); }
  const broken = harness({ active: false, routes: { '/api/mail-account': ({ reply }) => reply(503, { ok: false, message: 'down' }) } });
  try { await broken.mail.composeFor(['Nordic Lamps AB']); assert.match(broken.toasts.at(-1), /无法读取邮箱绑定状态/); assert.equal(broken.dialog, null); } finally { broken.dispose(); }
});

test('sender name and signature are saved in mailbox settings and added to new mail and replies, but not twice to drafts', async () => {
  let saved = null;
  const h = harness({ routes: { '/api/mail-account/settings': ({ payload, reply }) => payload.signature === 'fail' ? reply(503, { ok: false, message: 'storage unavailable' }) : (saved = payload, reply(200, { ok: true, available: true, account: { ...ACCOUNT, ...payload } })),
    '/api/mail/drafts': ({ reply }) => reply(200, { ok: true, items: [{ id: 'a'.repeat(32), to: 'a@b.example', subject: 's', text: 'draft body', html: '<div>draft <b>body</b></div>', updatedAt: '2026-10-06T09:00:00.000Z' }] }) } });
  try {
    await h.mail.select();
    await h.act('compose'); assert.equal(h.editor.html, '<div><br></div>', 'no signature yet'); await h.act('compose-close');
    h.act('account'); assert.match(h.dialog.body, /id="mail-settings-name"/); assert.match(h.dialog.body, /id="mail-settings-signature"/); assert.match(h.dialog.body, /id="mail-settings-autocheck" checked> 自动检查新邮件/);
    h.node('mail-settings-autocheck').checked = true; h.node('mail-settings-name').value = 'Kris'; h.node('mail-settings-signature').value = 'fail'; await h.act('settings-save'); assert.equal(h.node('mail-account-error').textContent, 'storage unavailable');
    h.node('mail-settings-signature').value = 'Kris <Sales>\nLai Trading'; await h.act('settings-save');
    assert.deepEqual(saved, { senderName: 'Kris', signature: 'Kris <Sales>\nLai Trading', autoCheck: true }); assert.equal(h.toasts.at(-1), '已保存'); assert.equal(h.mail.account().signature, 'Kris <Sales>\nLai Trading');
    h.act('account'); assert.match(h.dialog.body, /value="Kris"/); assert.match(h.dialog.body, />\nKris &lt;Sales&gt;\nLai Trading<\/textarea>/);
    await h.act('compose'); assert.equal(h.editor.html, '<div><br></div><div><br></div><div class="lai-signature"><div>Kris &lt;Sales&gt;</div><div>Lai Trading</div></div>'); assert.equal(h.form('mail-compose-form').elements.fromName.value, 'Kris');
    await h.act('compose-close'); assert.equal(h.calls('/api/mail/drafts/save').length, 0, 'a message holding only the signature is not saved as a draft');
    await h.act('open', { box: 'inbox', uid: '4' }); await h.act('reply');
    assert.match(h.editor.html, /^<div><br><\/div><div><br><\/div><div class="lai-signature"><div>Kris &lt;Sales&gt;<\/div><div>Lai Trading<\/div><\/div><div><br><\/div><div>在 .* 写道：<\/div><blockquote>/, 'the signature sits above the quoted message'); await h.act('compose-close');
    await h.mail.select('drafts'); await h.act('draft-open', { id: 'a'.repeat(32) }); assert.equal(h.editor.html, '<div>draft <b>body</b></div>', 'a reopened draft does not get a second signature');
  } finally { h.dispose(); }
});

test('a message read once is shown again without another download; refresh re-reads it; reopening an unread one tells the mailbox', async () => {
  const h = harness({ routes: { '/api/mail/message': ({ query, reply }) => reply(200, { ok: true, message: { ...MESSAGE, uid: Number(query.uid), subject: 'uid ' + query.uid } }) } });
  try {
    await h.mail.select();
    await h.act('open', { box: 'inbox', uid: '4' }); await h.act('open', { box: 'inbox', uid: '3' }); await h.act('open', { box: 'inbox', uid: '4' });
    assert.deepEqual(h.calls('/api/mail/message').map(r => r.query.uid), ['4', '3'], 'the second visit to a message comes from memory'); assert.match(h.page, /mail-reader-subject">uid 4</);
    assert.equal(h.calls('/api/mail/flags').length, 0, 'an already-read message needs no flag change');
    await h.act('refresh'); assert.equal(h.calls('/api/mail/message').length, 3, 'refresh always asks the mailbox again');
    await h.act('row-read', { box: 'inbox', uid: '4' });
    assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 4, seen: false }); assert.match(h.page, /mail-reader-empty/, 'marking the open message unread closes it'); assert.match(h.page, /<div class="mail-row unread" role="listitem"><button[^>]*data-uid="4"/); assert.match(h.mail.subnav(), /data-mail-folder="unread"[^>]*>.*?mail-count">1</);
    await h.act('open', { box: 'inbox', uid: '4' });
    assert.equal(h.calls('/api/mail/message').length, 3); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 4, seen: true }, 'the mailbox is told it was read again');
    await h.act('row-read', { box: 'inbox', uid: '3' }); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 3, seen: false }); assert.match(h.page, /mail-reader-subject">uid 4</, 'marking another row leaves the open message alone');
    await h.act('row-read', { box: 'inbox', uid: '3' }); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 3, seen: true });
  } finally { h.dispose(); }
});

test('keyboard shortcuts move through the list and act on the open message, but never while typing, composing or in a dialog', async () => {
  const h = harness({ routes: { '/api/mail/message': ({ query, reply }) => reply(200, { ok: true, message: { ...MESSAGE, uid: Number(query.uid), subject: 'uid ' + query.uid } }), '/api/mail/flags': ({ reply }) => reply(200, { ok: true }) } });
  const settle = () => new Promise(resolve => setTimeout(resolve, 5));
  try {
    await h.mail.select();
    assert.equal(h.key('r').result, false, 'nothing is open yet'); assert.equal(h.key('x').event.prevented, false);
    assert.equal(h.key('ArrowDown', { tagName: 'INPUT' }).result, undefined, 'keys typed into a field are left alone'); assert.equal(h.calls('/api/mail/message').length, 0);
    let pressed = h.key('ArrowDown'); assert.equal(pressed.event.prevented, true); await settle();
    assert.equal(h.calls('/api/mail/message').at(-1).query.uid, '4', 'down selects the first message'); assert.match(h.page, /mail-reader-subject">uid 4</);
    h.key('j'); await settle(); assert.match(h.page, /mail-reader-subject">uid 3</);
    h.key('ArrowDown'); await settle(); assert.equal(h.calls('/api/mail/message').length, 2, 'the last message stays selected');
    h.key('k'); await settle(); assert.match(h.page, /mail-reader-subject">uid 4</); assert.equal(h.calls('/api/mail/message').length, 2, 'going back uses the copy in memory');
    h.key('s'); await settle(); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 4, pending: true });
    h.key('Delete'); assert.equal(h.dialog.type, 'mail-confirm');
    assert.equal(h.key('ArrowDown').result, undefined, 'shortcuts wait while a dialog is open'); h.act('delete-confirm'); await settle();
    h.key('ArrowDown'); await settle(); h.key('r'); await settle();
    assert.equal(h.mail.composing(), true); assert.match(h.page, /<h1>回复<\/h1>/);
    assert.equal(h.key('ArrowDown').result, undefined, 'shortcuts are off on the compose page'); await h.act('compose-close');
    h.key('Escape'); assert.match(h.page, /mail-reader-empty/);
    h.key('c'); await settle(); assert.match(h.page, /<h1>写信<\/h1>/); await h.act('compose-close');
    assert.equal(h.key('ArrowDown', {}).result, true); h.setActive(false); assert.equal(h.key('ArrowDown').result, undefined, 'and off on other pages');
  } finally { h.dispose(); }
});

test('deleting from the list asks first, then shows the next message; deleting another row keeps the open one', async () => {
  let inbox = [{ ...INBOX[0] }, { ...INBOX[1] }, { ...INBOX[1], uid: 2, subject: 'Third' }];
  const h = harness({ routes: {
    '/api/mail/messages': ({ reply }) => reply(200, { ok: true, page: 1, pageSize: 50, total: inbox.length, items: inbox.map(i => ({ ...i })), counts: { unread: 1, pending: 1 } }),
    '/api/mail/message': ({ query, reply }) => reply(200, { ok: true, message: { ...MESSAGE, uid: Number(query.uid), subject: 'uid ' + query.uid } }),
    '/api/mail/trash': ({ payload, reply }) => { inbox = inbox.filter(i => i.uid !== payload.uid); return reply(200, { ok: true }); } } });
  try {
    await h.mail.select(); await h.act('open', { box: 'inbox', uid: '3' });
    h.act('row-delete', { box: 'inbox', uid: '4' }); assert.match(h.dialog.body, /删除「样品寄送确认」/); assert.equal(h.calls('/api/mail/trash').length, 0);
    await h.act('delete-confirm'); assert.deepEqual(h.calls('/api/mail/trash').at(-1).payload, { box: 'inbox', uid: 4 }); assert.match(h.page, /mail-reader-subject">uid 3</, 'the message being read stays open'); assert.doesNotMatch(h.page, /data-uid="4"/);
    h.act('delete'); await h.act('delete-confirm');
    assert.deepEqual(h.calls('/api/mail/trash').at(-1).payload, { box: 'inbox', uid: 3 }); assert.match(h.page, /mail-reader-subject">uid 2</, 'the next message in the list is shown'); assert.equal(h.calls('/api/mail/message').at(-1).query.uid, '2');
    h.act('delete'); await h.act('delete-confirm'); assert.match(h.page, /「收件箱」里没有邮件/); assert.match(h.page, /mail-reader-empty/);
  } finally { h.dispose(); }
});

test('the contact panel shows who the message is with, their recent mail, and can be hidden', async () => {
  let asked = 0;
  const other = { box: 'sent', uid: 9, from: self, to: [li], cc: [], subject: 'Earlier <reply>', date: '2026-10-01T08:00:00.000Z', seen: true, pending: false };
  const h = harness({ routes: {
    '/api/mail/correspondence': ({ reply }) => { asked++; return reply(200, { ok: true, items: [{ ...INBOX[0] }, other] }); },
    '/api/mail/message': ({ query, reply }) => reply(200, { ok: true, message: query.uid === '7' ? { ...MESSAGE, uid: 7, from: { name: 'New Lead', address: 'lead@unknown.example' }, cc: [], to: [self] } : { ...MESSAGE, uid: Number(query.uid), box: query.box } }) } });
  try {
    await h.mail.select(); await h.act('open', { box: 'inbox', uid: '4' });
    assert.deepEqual(h.calls('/api/mail/correspondence').at(-1).query, { addresses: 'liwei@shenzhen-parts.example,wanglei@shenzhen-parts.example' }, 'all of the customer’s addresses are searched');
    const panel = /<aside class="mail-contact"[\s\S]*<\/aside>/.exec(h.page)[0];
    assert.match(panel, /<strong>深圳配件<\/strong>/); assert.match(panel, /data-mail-action="customer-open" data-name="深圳配件"/); assert.match(panel, /data-mail-action="contact-compose" data-to="liwei@shenzhen-parts\.example"/);
    assert.deepEqual([...panel.matchAll(/class="mail-contact-item" data-mail-action="open" data-box="(\w+)" data-uid="(\d+)">.*?mail-contact-subject">([^<]*)</g)].map(m => m.slice(1)), [['sent', '9', 'Earlier &lt;reply&gt;']], 'the message on screen is not listed again');
    await h.act('open', { box: 'inbox', uid: '3' }); await h.act('open', { box: 'inbox', uid: '4' }); assert.equal(asked, 1, 'recent mail for the same contact is not fetched again for every message');
    await h.act('open', { box: 'sent', uid: '9' }); assert.deepEqual(h.calls('/api/mail/message').at(-1).query, { box: 'sent', uid: '9' }, 'a recent message opens from the panel');
    await h.act('contact-compose', { to: 'liwei@shenzhen-parts.example' }); assert.equal(h.form('mail-compose-form').elements.to.value, 'liwei@shenzhen-parts.example'); await h.act('compose-close');
    await h.act('open', { box: 'inbox', uid: '7' });
    const stranger = /<aside class="mail-contact"[\s\S]*<\/aside>/.exec(h.page)[0];
    assert.match(stranger, /<strong>New Lead<\/strong>/); assert.match(stranger, /还不在客户资料里/); assert.doesNotMatch(stranger, /customer-open/); assert.equal(h.calls('/api/mail/correspondence').at(-1).query.addresses, 'lead@unknown.example');
    assert.match(h.page, /data-mail-action="contact-toggle" aria-pressed="true"/);
    await h.act('contact-toggle'); assert.match(h.page, /mail-split reading contact-on/, 'without a wide window the panel starts hidden, so the first click shows it');
    await h.act('contact-toggle'); assert.match(h.page, /mail-split reading contact-off/); assert.match(h.page, /data-mail-action="contact-toggle" aria-pressed="false"/);
  } finally { h.dispose(); }
  const failing = harness({ routes: { '/api/mail/correspondence': ({ reply }) => reply(502, { ok: false, message: '无法连接邮箱服务器' }) } });
  try { await failing.mail.select(); await failing.act('open', { box: 'inbox', uid: '4' }); assert.match(failing.page, /mail-reader-subject">样品寄送确认</, 'the message itself still shows'); assert.match(failing.page, /读取往来邮件失败：无法连接邮箱服务器/); }
  finally { failing.dispose(); }
});

// ---- 会话、多选、新邮件检查、模板、草稿附件、群发筛选、客户详情里的往来邮件 ----
const T1 = { box: 'inbox', uid: 11, from: anna, to: [self], cc: [], subject: 'Order 88', date: '2026-10-01T08:00:00.000Z', seen: true, pending: false, hasAttachment: false, messageId: '<t1@x>', inReplyTo: '', references: '', snippet: 'first' };
const T2 = { box: 'inbox', uid: 12, from: li, to: [self], cc: [], subject: 'Other', date: '2026-10-02T08:00:00.000Z', seen: false, pending: false, hasAttachment: false, messageId: '<o1@x>', inReplyTo: '', references: '', snippet: 'unrelated' };
const T3 = { box: 'inbox', uid: 13, from: anna, to: [self], cc: [], subject: 'Re: Order 88', date: '2026-10-03T08:00:00.000Z', seen: false, pending: true, hasAttachment: true, messageId: '<t3@x>', inReplyTo: '<t2@x>', references: '<t1@x> <t2@x>', snippet: 'third' };
const SENT2 = { box: 'sent', uid: 5, from: self, to: [anna], cc: [], subject: 'Re: Order 88', date: '2026-10-02T09:00:00.000Z', seen: true, pending: false, messageId: '<t2@x>', inReplyTo: '<t1@x>', references: '<t1@x>', snippet: 'my reply' };
const threadRoutes = (inbox = [T3, T2, T1]) => { const box = inbox.map(i => ({ ...i })); return { box, routes: {
  '/api/mail/messages': ({ reply }) => reply(200, { ok: true, page: 1, pageSize: 50, total: box.length, items: box.map(i => ({ ...i })), counts: { unread: box.filter(i => !i.seen).length, pending: box.filter(i => i.pending).length } }),
  '/api/mail/message': ({ query, reply }) => { const found = [...box, SENT2].find(i => i.box === query.box && String(i.uid) === query.uid); return reply(200, { ok: true, message: { ...MESSAGE, ...found, attachments: [], text: 'body ' + query.uid } }); },
  '/api/mail/correspondence': ({ reply }) => reply(200, { ok: true, items: [{ ...T3 }, { ...SENT2 }, { ...T1 }] }),
  '/api/mail/flags': ({ payload, reply }) => { for (const item of box) if ((payload.uids || [payload.uid]).includes(item.uid)) { if (typeof payload.seen === 'boolean') item.seen = payload.seen; if (typeof payload.pending === 'boolean') item.pending = payload.pending; } return reply(200, { ok: true }); },
  '/api/mail/trash': ({ payload, reply }) => { for (const uid of payload.uids || [payload.uid]) { const at = box.findIndex(i => i.uid === uid); if (at >= 0) box.splice(at, 1); } return reply(200, { ok: true }); } } }; };
const rowsIn = page => [...page.matchAll(/<div class="mail-row ([^"]*)" role="listitem">([\s\S]*?)<\/div>/g)].map(m => ({ cls: m[1].trim().split(/\s+/).filter(Boolean), html: m[2], uid: (/data-uid="(\d+)"/.exec(m[2]) || [])[1], who: (/mail-row-who">([^<]*)</.exec(m[2]) || [])[1], count: (/mail-thread-count"[^>]*>(\d+)</.exec(m[2]) || [])[1] }));

test('messages are grouped into conversations by their reply headers only, keeping list order', () => {
  const group = items => Mail.groupThreads(items).map(g => g.map(i => i.uid));
  assert.deepEqual(group([T3, T2, T1]), [[13, 11], [12]], 'a reply joins the message it references even when the one in between is elsewhere');
  assert.deepEqual(group([T3, SENT2, T2, T1]), [[13, 5, 11], [12]]);
  assert.deepEqual(group([{ ...T1, uid: 1, messageId: '' }, { ...T1, uid: 2, messageId: '' }, { ...T1, uid: 3, messageId: '<same@x>', subject: 'Order 88' }, { ...T2, uid: 4, messageId: '<other@x>', subject: 'Order 88' }]), [[1], [2], [3], [4]], 'same subject or missing ids never merge messages');
  assert.deepEqual(group([]), []); assert.deepEqual(group([{ box: 'inbox', uid: 9 }]), [[9]]);
  assert.deepEqual(group([{ box: 'inbox', uid: 1, messageId: '<a>', references: '<b> junk <c>' }, { box: 'sent', uid: 1, messageId: '<c>' }, { box: 'inbox', uid: 2, messageId: '<d>', inReplyTo: '<b>' }]), [[1, 1, 2]]);
});

test('the list shows one row per conversation with a count; row actions apply to the whole conversation; 逐封 shows every message', async () => {
  const t = threadRoutes();
  const h = harness({ routes: t.routes });
  try {
    await h.mail.select();
    let rows = rowsIn(h.page);
    assert.deepEqual(rows.map(r => [r.uid, r.who, r.count, r.cls.includes('unread')]), [['13', 'Anna Berg', '2', true], ['12', '李伟', undefined, true]]);
    assert.match(rows[0].html, /mail-clip/); assert.match(rows[0].html, /class="mail-pending on"[^>]*aria-pressed="true"/); assert.match(rows[0].html, /aria-label="选择这个会话"/); assert.match(h.page, /data-mail-action="thread-toggle" aria-pressed="true"/);
    await h.act('row-read', { box: 'inbox', uid: '13' });
    assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uids: [13, 11], seen: true }, 'both messages of the conversation are marked in one request');
    assert.equal(rowsIn(h.page)[0].cls.includes('unread'), false); assert.match(h.mail.subnav(), /data-mail-folder="unread"[^>]*>.*?mail-count">1</);
    await h.act('toggle-pending', { box: 'inbox', uid: '13' });
    assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uids: [13, 11], pending: false }); assert.doesNotMatch(h.mail.subnav(), /data-mail-folder="pending"[^>]*>[^/]*mail-count/);
    await h.act('thread-toggle');
    assert.deepEqual(rowsIn(h.page).map(r => [r.uid, r.count]), [['13', undefined], ['12', undefined], ['11', undefined]]); assert.match(h.page, /data-mail-action="thread-toggle" aria-pressed="false"/);
    await h.act('toggle-pending', { box: 'inbox', uid: '11' }); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 11, pending: true }, 'in 逐封 mode a row is one message');
    await h.act('thread-toggle');
    h.act('row-delete', { box: 'inbox', uid: '13' }); assert.match(h.dialog.body, /删除这 2 封邮件？/);
    await h.act('delete-confirm'); assert.deepEqual(h.calls('/api/mail/trash').at(-1).payload, { box: 'inbox', uids: [13, 11] }); assert.equal(h.toasts.at(-1), '2 封邮件已移到「已删除」'); assert.deepEqual(rowsIn(h.page).map(r => r.uid), ['12']);
  } finally { h.dispose(); }
});

test('reading a conversation shows its other messages around the open one, including my replies found in recent mail', async () => {
  const t = threadRoutes();
  const h = harness({ routes: t.routes });
  try {
    await h.mail.select(); await h.act('open', { box: 'inbox', uid: '13' });
    assert.match(h.page, /mail-reader-subject">Re: Order 88<span class="mail-thread-count"[^>]*>3<\/span>/);
    const strips = [...h.page.matchAll(/<div class="mail-thread-strip" aria-label="([^"]+)">([\s\S]*?)<\/div>/g)].map(m => [m[1], [...m[2].matchAll(/data-box="(\w+)" data-uid="(\d+)">.*?mail-thread-who">([^<]*)<.*?mail-thread-snippet">([^<]*)</g)].map(x => x.slice(1))]);
    assert.deepEqual(strips, [['这个会话里更早的邮件', [['inbox', '11', 'Anna Berg', 'first'], ['sent', '5', '我', 'my reply']]]], 'earlier messages, oldest first; the sent reply comes from recent correspondence');
    assert.equal(rowsIn(h.page)[0].cls.includes('selected'), true);
    await h.act('open', { box: 'sent', uid: '5' });
    const around = [...h.page.matchAll(/<div class="mail-thread-strip" aria-label="([^"]+)">/g)].map(m => m[1]);
    assert.deepEqual(around, ['这个会话里更早的邮件', '这个会话里更晚的邮件']); assert.equal(rowsIn(h.page)[0].cls.includes('selected'), false, 'a sent message is not a row of the inbox list');
    await h.act('open', { box: 'inbox', uid: '12' }); assert.doesNotMatch(h.page, /mail-thread-strip/); assert.doesNotMatch(/mail-reader-subject">[^<]*(<span[^>]*>\d+<\/span>)?/.exec(h.page)[0], /mail-thread-count/);
    h.key('ArrowUp'); await new Promise(resolve => setTimeout(resolve, 5)); assert.match(h.page, /mail-reader-subject">Re: Order 88</, 'the keyboard moves by conversation');
    await h.act('toggle-pending', { box: 'inbox', uid: '13', single: '1' }); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 13, pending: false }, 'the star in the reading pane changes only the open message');
  } finally { h.dispose(); }
});

test('messages can be ticked and handled together; the selection clears when the list changes', async () => {
  const t = threadRoutes();
  const h = harness({ routes: t.routes });
  try {
    await h.mail.select(); await h.act('thread-toggle');
    assert.doesNotMatch(h.page, /mail-bulkbar|picking/);
    await h.act('pick', { box: 'inbox', uid: '13' }); await h.act('pick', { box: 'inbox', uid: '12' });
    assert.match(h.page, /mail-split picking/); assert.match(h.page, /<div class="mail-bulkbar"[^>]*><strong>已选 2 封<\/strong>/); assert.deepEqual(rowsIn(h.page).map(r => r.cls.includes('picked')), [true, true, false]); assert.match(rowsIn(h.page)[0].html, /class="mail-check on"[^>]*aria-checked="true"/);
    await h.act('pick', { box: 'inbox', uid: '12' }); assert.match(h.page, /已选 1 封/);
    await h.act('pick-all'); assert.match(h.page, /已选 3 封/);
    await h.act('bulk-read'); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uids: [13, 12, 11], seen: true }); assert.doesNotMatch(h.page, /mail-bulkbar/, 'the selection is cleared after the action'); assert.doesNotMatch(h.mail.subnav(), /data-mail-folder="unread"[^>]*>[^/]*mail-count/);
    await h.act('pick', { box: 'inbox', uid: '12' }); await h.act('bulk-pending'); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 12, pending: true });
    await h.act('open', { box: 'inbox', uid: '12' }); await h.act('pick', { box: 'inbox', uid: '12' }); await h.act('pick', { box: 'inbox', uid: '11' });
    await h.act('bulk-unread'); assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uids: [12, 11], seen: false }); assert.match(h.page, /mail-reader-empty/, 'the open message was marked unread, so it is closed');
    await h.act('pick', { box: 'inbox', uid: '13' }); await h.act('pick', { box: 'inbox', uid: '11' });
    h.act('bulk-delete'); assert.match(h.dialog.body, /删除这 2 封邮件？/); assert.equal(h.calls('/api/mail/trash').length, 0);
    await h.act('delete-confirm'); assert.deepEqual(h.calls('/api/mail/trash').at(-1).payload, { box: 'inbox', uids: [13, 11] }); assert.deepEqual(rowsIn(h.page).map(r => r.uid), ['12']); assert.doesNotMatch(h.page, /mail-bulkbar/);
    await h.act('pick', { box: 'inbox', uid: '12' }); assert.match(h.page, /已选 1 封/);
    await h.mail.select('sent'); assert.doesNotMatch(h.page, /mail-bulkbar/, 'changing folder drops the selection');
    await h.mail.select('inbox'); await h.act('pick', { box: 'inbox', uid: '12' }); await h.act('pick-none'); assert.doesNotMatch(h.page, /mail-bulkbar/);
    await h.act('open', { box: 'inbox', uid: '12' }); h.key('x'); assert.match(h.page, /已选 1 封/, 'x ticks the open message');
  } finally { h.dispose(); }
});

test('the background check updates counts, announces new mail and refreshes the inbox, quietly and only when allowed', async () => {
  let status = { ok: true, unread: 2, pending: 1, total: 3, uidNext: 14 }, fail = false;
  const t = threadRoutes(), badges = [];
  const h = harness({ routes: { ...t.routes, '/api/mail/status': ({ reply }) => fail ? reply(502, { ok: false, message: '无法连接邮箱服务器' }) : reply(200, status) }, ctx: { onCounts: counts => badges.push(counts && counts.unread) } });
  try {
    assert.equal(await h.mail.check(), false, 'nothing is checked before the binding is known'); assert.equal(h.requests.length, 0);
    assert.equal(await h.mail.start(), true); assert.deepEqual(h.requests.map(r => r.route), ['/api/mail-account', '/api/mail/status']); assert.deepEqual(h.mail.counts(), { unread: 2, pending: 1 }); assert.deepEqual(h.toasts, [], 'the first check only sets the baseline');
    await h.mail.select(); const lists = h.calls('/api/mail/messages').length, mounts = h.mounted.length;
    status = { ...status }; assert.equal(await h.mail.check(), true); assert.equal(h.mounted.length, mounts, 'nothing changed, so nothing is redrawn');
    status = { ...status, unread: 4, uidNext: 16 }; await h.mail.check();
    assert.equal(h.toasts.at(-1), '收到 2 封新邮件'); assert.equal(h.calls('/api/mail/messages').length, lists + 1, 'the inbox on screen is re-read');
    status = { ...status, unread: 1 }; await h.mail.check(); assert.equal(h.calls('/api/mail/messages').length, lists + 1, 'a count change alone does not re-read the list'); assert.match(h.mail.subnav(), /data-mail-folder="inbox"[^>]*>.*?mail-count">1</);
    assert.equal(badges.at(-1), 1, 'the shell is told the unread count');
    fail = true; const toasts = h.toasts.length; assert.equal(await h.mail.check(), false); assert.equal(h.toasts.length, toasts, 'a failed check says nothing');
    fail = false; await h.act('compose'); const calls = h.calls('/api/mail/status').length; assert.equal(await h.mail.check(), false); assert.equal(h.calls('/api/mail/status').length, calls, 'no check while writing'); await h.act('compose-close');
    await h.mail.select('sent'); status = { ...status, uidNext: 17 }; const before = h.calls('/api/mail/messages').length; await h.mail.check(); assert.equal(h.toasts.at(-1), '收到 1 封新邮件'); assert.equal(h.calls('/api/mail/messages').length, before, 'another folder is left alone');
  } finally { h.dispose(); }
  const off = harness({ account: { ...ACCOUNT, autoCheck: false } });
  try { await off.mail.start(); assert.deepEqual(off.requests.map(r => r.route), ['/api/mail-account'], 'with auto-check switched off the mailbox is never asked'); off.act('account'); assert.doesNotMatch(off.dialog.body, /id="mail-settings-autocheck" checked/); } finally { off.dispose(); }
  const unbound = harness({ account: null });
  try { assert.equal(await unbound.mail.start(), false); assert.deepEqual(unbound.requests.map(r => r.route), ['/api/mail-account']); } finally { unbound.dispose(); }
});

test('templates can be saved from the message, inserted with the customer filled in, and deleted after a second click', async () => {
  let stored = [];
  const h = harness({ routes: {
    '/api/mail/templates': ({ reply }) => reply(200, { ok: true, items: stored.map(t => ({ ...t })) }),
    '/api/mail/templates/save': ({ payload, reply }) => stored.some(t => t.name === payload.name) ? reply(409, { ok: false, code: 'duplicate', message: '已经有一个叫「' + payload.name + '」的模板，请换个名字' }) : (stored.push({ ...payload, id: String(stored.length + 1).repeat(32) }), reply(200, { ok: true })),
    '/api/mail/templates/delete': ({ payload, reply }) => { stored = stored.filter(t => t.id !== payload.id); return reply(200, { ok: true }); },
    '/api/mail/drafts/save': ({ payload, reply }) => reply(200, { ok: true, draft: { ...payload, id: 'd'.repeat(32) } }) } });
  try {
    await h.mail.select(); await h.act('compose');
    assert.match(h.page, /data-mail-action="template-open"/);
    await h.act('template-open'); assert.equal(h.dialog.type, 'mail-templates'); assert.match(h.dialog.body, /还没有保存过模板/);
    assert.deepEqual([...h.dialog.body.matchAll(/data-mail-action="template-use" data-id="(builtin:\w+)"/g)].map(m => m[1]), Mail.BUILTIN_TEMPLATES.map(t => t.id)); assert.doesNotMatch(h.dialog.body.split('示例模板')[1], /template-delete/, 'built-in templates cannot be deleted');
    await h.act('template-save'); assert.equal(h.node('mail-template-error').textContent, '请给模板起个名字');
    const f = h.form('mail-compose-form').elements; f.subject.value = 'Offer for {{公司}}'; h.editor.html = '<div>Dear {{姓名}}, <b>hello</b></div>';
    h.node('mail-template-name').value = ' 报价 <A> '; await h.act('template-save');
    assert.deepEqual(h.calls('/api/mail/templates/save').at(-1).payload, { name: '报价 <A>', subject: 'Offer for {{公司}}', html: '<div>Dear {{姓名}}, <b>hello</b></div>', text: 'Dear {{姓名}}, hello\n' }); assert.equal(h.toasts.at(-1), '已保存为模板「报价 <A>」');
    assert.match(h.dialog.body, /<strong>报价 &lt;A&gt;<\/strong><span>Offer for \{\{公司\}\}<\/span>/, 'the new template is listed, escaped');
    h.node('mail-template-name').value = '报价 <A>'; await h.act('template-save'); assert.match(h.node('mail-template-error').textContent, /请换个名字/);
    // 发信前拦住没替换的称呼
    f.to.value = 'stranger@x.example'; await h.submit('mail-compose-form'); assert.match(h.node('mail-compose-error').textContent, /还有没替换的 \{\{姓名\}\} 或 \{\{公司\}\}/); assert.equal(h.calls('/api/mail/send').length, 0);
    await h.act('compose-close');
    // 给一位客户写信：模板里的称呼直接换好；主题空着才填。
    await h.mail.composeFor(['Nordic Lamps AB']); await h.act('template-open'); await h.act('template-use', { id: stored[0].id });
    assert.equal(h.form('mail-compose-form').elements.subject.value, 'Offer for Nordic Lamps AB', 'an empty subject takes the template’s, with the company filled in');
    assert.equal(h.editor.html, '<div>Dear Nordic Lamps AB, <b>hello</b></div><div><br></div>', 'the template goes first, the blank line (and any signature) stays after it'); assert.equal(h.dialog, null); assert.equal(h.toasts.at(-1), '已插入模板，称呼已换成 Nordic Lamps AB');
    await h.act('template-open'); await h.act('template-use', { id: 'builtin:quote' });
    assert.match(h.editor.html, /^<div>Dear Nordic Lamps AB,<\/div><div><br><\/div><div>I am following up on the quotation/); assert.equal(h.form('mail-compose-form').elements.subject.value, 'Offer for Nordic Lamps AB', 'a subject that is already there is kept');
    await h.act('compose-close');
    // 收件人不是客户：占位保留并提醒
    await h.act('compose'); h.form('mail-compose-form').elements.to.value = 'x@y.example'; await h.act('template-open'); await h.act('template-use', { id: 'builtin:sample' });
    assert.match(h.editor.html, /^<div>Dear \{\{姓名\}\},<\/div>/); assert.match(h.toasts.at(-1), /记得把 \{\{姓名\}\}、\{\{公司\}\} 改成实际内容/);
    // 删除要点两次
    await h.act('template-open'); await h.act('template-delete', { id: stored[0].id }); assert.equal(h.calls('/api/mail/templates/delete').length, 0); assert.match(h.dialog.body, /再点一次删除/);
    await h.act('template-delete', { id: stored[0].id }); assert.equal(h.calls('/api/mail/templates/delete').length, 1); assert.match(h.dialog.body, /还没有保存过模板/);
  } finally { h.dispose(); }
});

test('a draft is saved and reopened together with its attachments', async () => {
  const stored = { draft: null, files: [] };
  const h = harness({ routes: {
    '/api/mail/drafts/save': ({ payload, reply }) => { stored.draft = { ...payload, attachments: (payload.attachments || stored.files).map(a => ({ filename: a.filename, contentType: a.contentType, size: 4 })), id: 'a'.repeat(32), updatedAt: '2026-10-06T09:00:00.000Z' }; if (payload.attachments) stored.files = payload.attachments; return reply(200, { ok: true, draft: stored.draft }); },
    '/api/mail/drafts': ({ reply }) => reply(200, { ok: true, items: stored.draft ? [{ ...stored.draft }] : [] }),
    '/api/mail/draft': ({ query, reply }) => query.id === 'a'.repeat(32) ? reply(200, { ok: true, draft: { ...stored.draft }, attachments: stored.files }) : reply(404, { ok: false, message: '找不到这份草稿' }),
    '/api/mail/send': ({ reply }) => reply(200, { ok: true, recipients: ['a@b.example'], rejected: [] }) } });
  try {
    await h.mail.select('drafts'); await h.act('compose');
    const f = h.form('mail-compose-form').elements; f.to.value = 'a@b.example'; f.subject.value = 'With file';
    h.node('mail-compose-file').files = [{ name: '报价.pdf', type: 'application/pdf', size: 4, content: '%PDF' }]; h.fire('mail-compose-file', 'change');
    assert.equal(h.mail.composeDirty(), true);
    await h.act('compose-draft'); assert.equal(h.toasts.at(-1), '已存入草稿箱');
    assert.deepEqual(h.calls('/api/mail/drafts/save').at(-1).payload.attachments, [{ filename: '报价.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }]);
    assert.equal(h.mail.composeDirty(), false, 'a saved attachment no longer counts as an unsaved change');
    await h.act('compose-close'); assert.equal(h.calls('/api/mail/drafts/save').length, 1);
    assert.match(h.page, /草稿箱（1）/); assert.match(h.page, /title="带 1 个附件"/);
    await h.act('draft-open', { id: 'a'.repeat(32) });
    assert.deepEqual(h.calls('/api/mail/draft').at(-1).query, { id: 'a'.repeat(32) }); assert.match(h.node('mail-compose-file-list').innerHTML, /报价\.pdf.*4 B/, 'the stored file is back on the compose page');
    h.act('file-remove', { index: '0' }); assert.equal(h.mail.composeDirty(), true, 'removing it is a change');
    h.node('mail-compose-file').files = [{ name: 'slow.txt', type: 'text/plain', size: 2, content: 'ok', slow: true }]; const slow = h.node('mail-compose-file').files[0]; h.fire('mail-compose-file', 'change');
    await h.act('compose-draft'); assert.deepEqual(h.calls('/api/mail/drafts/save').at(-1).payload.attachments, [], 'a file that is still being read is not part of this save (the removed one is gone)');
    assert.equal(h.mail.composeDirty(), false); const saves = h.calls('/api/mail/drafts/save').length;
    assert.equal(await h.mail.leave(), false, 'leaving while a file is still being read is refused, so the file cannot be lost'); assert.equal(h.node('mail-compose-error').textContent, '附件还在读取，请稍等一下再离开。'); assert.equal(h.mail.composing(), true); assert.equal(h.calls('/api/mail/drafts/save').length, saves);
    slow.finish(); assert.equal(h.mail.composeDirty(), true, 'once the file is read it counts as an unsaved change');
    await h.act('compose-draft'); assert.deepEqual(h.calls('/api/mail/drafts/save').at(-1).payload.attachments.map(a => a.filename), ['slow.txt']); assert.equal(h.mail.composeDirty(), false);
    await h.submit('mail-compose-form');
    assert.deepEqual(h.calls('/api/mail/send').at(-1).payload.attachments.map(a => a.filename), ['slow.txt']); assert.equal(h.calls('/api/mail/send').at(-1).payload.draftId, 'a'.repeat(32));
  } finally { h.dispose(); }
  const broken = harness({ routes: { '/api/mail/drafts': ({ reply }) => reply(200, { ok: true, items: [{ id: 'b'.repeat(32), to: '', subject: 's', text: 't', updatedAt: '2026-10-06T09:00:00.000Z' }] }), '/api/mail/draft': ({ reply }) => reply(404, { ok: false, message: '找不到这份草稿' }) } });
  try { await broken.mail.select('drafts'); await broken.act('draft-open', { id: 'b'.repeat(32) }); assert.equal(broken.toasts.at(-1), '打不开这份草稿：找不到这份草稿'); assert.equal(broken.mail.composing(), false); } finally { broken.dispose(); }
});

test('bulk recipients can be narrowed by segment, stage, country and text, and 全选 only adds what is shown', async () => {
  const customers = { A: { email: 'a@x.example' }, B: { email: 'b@x.example' }, C: { email: 'c@x.example' }, D: { email: 'd@x.example' } };
  const rows = [{ name: 'A', group: '重点客户', stage: '已成交', country: '德国' }, { name: 'B', group: '重点客户', stage: '未成交', country: '法国' }, { name: 'C', group: '', stage: '未成交', country: '德国' }, { name: 'D', group: '普通 <客户>', stage: '已成交', country: '' }];
  const h = harness({ customers, ctx: { customerRows: () => rows } });
  const shown = () => [...h.node('mail-bulk-recipients').innerHTML.matchAll(/data-name="([^"]+)"/g)].map(m => m[1]);
  try {
    await h.mail.select('bulk'); await h.act('bulk-new');
    assert.deepEqual([...h.page.matchAll(/<select id="mail-bulk-(\w+)" name="bulk-\w+" aria-label="按([^"]+)筛选">(.*?)<\/select>/g)].map(m => [m[1], m[2], [...m[3].matchAll(/<option value="([^"]*)"/g)].map(o => o[1])]), [['group', '客群', ['', '普通 &lt;客户&gt;', '重点客户']], ['stage', '阶段', ['', '未成交', '已成交']], ['country', '国家', ['', '德国', '法国']]]);
    h.node('mail-bulk-group').value = '重点客户'; h.fire('mail-bulk-group', 'change');
    assert.deepEqual(shown(), ['A', 'B']); assert.equal(h.node('mail-bulk-count').textContent, '已选 0 / 4 位客户（筛选后显示 2 位）');
    await h.act('bulk-all'); assert.equal(h.node('mail-bulk-count').textContent, '已选 2 / 4 位客户（筛选后显示 2 位）');
    h.node('mail-bulk-group').value = ''; h.fire('mail-bulk-group', 'change'); h.node('mail-bulk-country').value = '德国'; h.fire('mail-bulk-country', 'change'); h.node('mail-bulk-stage').value = '未成交'; h.fire('mail-bulk-stage', 'change');
    assert.deepEqual(shown(), ['C']); await h.act('bulk-all'); assert.equal(h.node('mail-bulk-count').textContent, '已选 3 / 4 位客户（筛选后显示 1 位）', 'earlier picks are kept');
    h.node('mail-bulk-filter').value = 'zzz'; h.fire('mail-bulk-filter', 'input'); assert.match(h.node('mail-bulk-recipients').innerHTML, /没有符合筛选条件的客户/);
    h.node('mail-bulk-filter').value = ''; h.fire('mail-bulk-filter', 'input'); h.node('mail-bulk-country').value = ''; h.fire('mail-bulk-country', 'change'); h.node('mail-bulk-stage').value = ''; h.fire('mail-bulk-stage', 'change');
    assert.deepEqual(shown(), ['A', 'B', 'C', 'D']); assert.equal(h.node('mail-bulk-count').textContent, '已选 3 / 4 位客户');
    assert.deepEqual([...h.node('mail-bulk-recipients').innerHTML.matchAll(/aria-checked="(\w+)"/g)].map(m => m[1]), ['true', 'true', 'true', 'false']);
  } finally { h.dispose(); }
  const plain = harness();
  try { await plain.mail.select('bulk'); await plain.act('bulk-new'); assert.doesNotMatch(plain.page, /<select id="mail-bulk-/, 'facets with no values are not shown'); } finally { plain.dispose(); }
});

test('the customer page panel lists mailbox correspondence, opens a message on the mail page and records mail into the activity once', async () => {
  const recorded = new Set(), refreshed = [];
  const t = threadRoutes();
  const make = (extra = {}) => harness({ active: false, routes: t.routes, ...extra, ctx: { recordMail: async (name, item) => { if (item.subject === 'Other') return false; recorded.add(item.messageId); return true; }, isMailRecorded: (name, item) => recorded.has(item.messageId), refreshCustomerPanel: name => refreshed.push(name), ...(extra.ctx || {}) } });
  const h = make();
  try {
    assert.match(h.mail.customerPanel('Nordic Lamps AB'), /正在读取邮箱绑定状态/);
    await h.mail.loadCustomerPanel('Nordic Lamps AB');
    assert.deepEqual(h.requests.map(r => r.route), ['/api/mail-account', '/api/mail/correspondence']); assert.deepEqual(h.calls('/api/mail/correspondence')[0].query, { addresses: 'anna@nordic-lamps.example' }); assert.ok(refreshed.length >= 2, 'the page is told to redraw while loading and when done');
    const html = h.mail.customerPanel('Nordic Lamps AB');
    assert.deepEqual([...html.matchAll(/data-mail-action="panel-open" data-name="Nordic Lamps AB" data-box="(\w+)" data-uid="(\d+)"[^>]*><span class="mail-direction (\w+)">(.)<\/span><span class="lcd-mail-subject">([^<]*)</g)].map(m => m.slice(1)), [['inbox', '13', 'in', '收', 'Re: Order 88'], ['sent', '5', 'out', '发', 'Re: Order 88'], ['inbox', '11', 'in', '收', 'Order 88']]);
    assert.equal([...html.matchAll(/data-mail-action="record"[^>]*>记到动态</g)].length, 3); assert.match(html, /data-feature="写邮件"/); assert.match(html, /最近的 3 封/);
    assert.match(h.mail.customerPanel('深圳配件'), /正在查找往来邮件/, 'another customer never shows this customer’s mail');
    await h.act('record', { name: 'Nordic Lamps AB', box: 'sent', uid: '5' });
    assert.deepEqual([...h.mail.customerPanel('Nordic Lamps AB').matchAll(/data-mail-action="record"[^>]*data-uid="(\d+)"\s+(disabled\s+)?title="[^"]*">([^<]+)</g)].map(m => [m[1], m[3]]), [['13', '记到动态'], ['5', '已记录'], ['11', '记到动态']]);
    await h.mail.loadCustomerPanel('Nordic Lamps AB'); assert.equal(h.calls('/api/mail/correspondence').length, 1, 'a second look within two minutes uses what was already fetched');
    await h.act('panel-reload', { name: 'Nordic Lamps AB' }); assert.equal(h.calls('/api/mail/correspondence').length, 2);
    // 点开：进入邮件页的「客户」页签并打开那一封
    h.act('panel-open', { name: 'Nordic Lamps AB', box: 'sent', uid: '5' }); assert.deepEqual(h.opened, ['mail:inbox']);
    h.setActive(true); await h.mail.select('inbox');
    assert.equal(h.mail.view(), 'customer'); assert.match(h.page, /<h1>Nordic Lamps AB<\/h1>/); assert.deepEqual(h.calls('/api/mail/message').at(-1).query, { box: 'sent', uid: '5' }); assert.match(h.page, /mail-reader-subject">Re: Order 88</);
    assert.match(h.page, /data-mail-action="record" data-name="Nordic Lamps AB" data-box="sent" data-uid="5" disabled[^>]*>已记录</, 'the reading pane shows it is already recorded');
    await h.mail.select('inbox'); assert.equal(h.mail.view(), 'mail', 'the next visit to the mail page is an ordinary one');
  } finally { h.dispose(); }
  const noAddress = make();
  try { await noAddress.mail.loadCustomerPanel('No Mail Co'); assert.match(noAddress.mail.customerPanel('No Mail Co'), /还没有填写邮箱/); assert.equal(noAddress.calls('/api/mail/correspondence').length, 0); } finally { noAddress.dispose(); }
  const unbound = make({ account: null });
  try { await unbound.mail.loadCustomerPanel('Nordic Lamps AB'); assert.match(unbound.mail.customerPanel('Nordic Lamps AB'), /data-mail-action="goto-mail"[\s\S]*还没有绑定邮箱/); } finally { unbound.dispose(); }
  const failing = make({ routes: { '/api/mail/correspondence': ({ reply }) => reply(502, { ok: false, message: '无法连接邮箱服务器 <x>' }) } });
  try { await failing.mail.loadCustomerPanel('Nordic Lamps AB'); assert.match(failing.mail.customerPanel('Nordic Lamps AB'), /读取往来邮件失败：无法连接邮箱服务器 &lt;x&gt;/); } finally { failing.dispose(); }
});

// ---- 独立复查发现的问题，各配一条回归测试 ----
test('review: a refused jump from the customer page is forgotten, not replayed on the next visit to mail', async () => {
  const t = threadRoutes();
  let allow = false;
  const h = harness({ active: false, routes: t.routes, ctx: { openMail: async () => allow } });
  try {
    await h.mail.loadCustomerPanel('Nordic Lamps AB');
    assert.equal(await h.act('panel-open', { name: 'Nordic Lamps AB', box: 'sent', uid: '5' }), false);
    h.setActive(true); await h.mail.select('inbox');
    assert.equal(h.mail.view(), 'mail', 'an ordinary visit: the inbox, not the customer view'); assert.equal(h.calls('/api/mail/message').length, 0, 'and no message is opened (or marked read) behind the user’s back');
    allow = true; h.setActive(false); h.act('panel-open', { name: 'Nordic Lamps AB', box: 'sent', uid: '5' }); await new Promise(resolve => setImmediate(resolve));
    h.setActive(true); await h.mail.select('inbox'); assert.equal(h.mail.view(), 'customer'); assert.equal(h.calls('/api/mail/message').length, 1);
  } finally { h.dispose(); }
});

test('review: in the customer view a row is unread only when a received message is unread, and its button matches what it does', async () => {
  const unseenSent = { ...SENT2, seen: false };
  const h = harness({ routes: { '/api/mail/correspondence': ({ reply }) => reply(200, { ok: true, items: [unseenSent, { ...T1 }] }), '/api/mail/flags': ({ reply }) => reply(200, { ok: true }) } });
  try {
    await h.mail.showView('customer'); await h.act('customer-select', { name: 'Nordic Lamps AB' });
    const row = rowsIn(h.page)[0];
    assert.equal(row.count, '2'); assert.equal(row.cls.includes('unread'), false, 'an unseen copy in Sent does not make the conversation unread'); assert.match(row.html, /data-mail-action="row-read"[^>]*aria-label="标为未读"/);
    await h.act('row-read', { box: 'sent', uid: '5' });
    assert.deepEqual(h.calls('/api/mail/flags').at(-1).payload, { box: 'inbox', uid: 11, seen: false }, 'the button said 标为未读 and that is what was sent');
  } finally { h.dispose(); }
});

test('review: a template is filled in only for a single recipient, and names containing $ are inserted literally', async () => {
  const h = harness({ customers: { ...CUSTOMERS, 'Cash$& Co': { email: 'pay@cash.example', contact: 'Mr $1 <b>' } } });
  try {
    await h.mail.select(); await h.act('compose');
    h.form('mail-compose-form').elements.to.value = 'anna@nordic-lamps.example, liwei@shenzhen-parts.example';
    await h.act('template-open'); await h.act('template-use', { id: 'builtin:sample' });
    assert.match(h.editor.html, /^<div>Dear \{\{姓名\}\},<\/div>/, 'with two recipients nobody’s name is put in'); assert.match(h.toasts.at(-1), /记得把/);
    await h.submit('mail-compose-form'); assert.match(h.node('mail-compose-error').textContent, /还有没替换的/, 'and the message cannot be sent like that');
    await h.act('compose-close'); await h.act('compose');
    const f = h.form('mail-compose-form').elements; f.to.value = 'anna@nordic-lamps.example'; await h.act('compose-cc'); h.form('mail-compose-form').elements.cc.value = 'boss@x.example';
    await h.act('template-open'); await h.act('template-use', { id: 'builtin:sample' }); assert.match(h.editor.html, /^<div>Dear \{\{姓名\}\},<\/div>/, 'a Cc counts as a second reader');
    await h.act('compose-close'); await h.mail.composeFor(['Cash$& Co']);
    assert.equal(h.form('mail-compose-form').elements.to.value, 'Mr $1 <b> <pay@cash.example>', 'a new message never inherits what the previous compose page still shows');
    await h.act('template-open'); await h.act('template-use', { id: 'builtin:sample' });
    assert.match(h.editor.html, /^<div>Dear Mr \$1 &lt;b&gt;,<\/div>.*The samples for Cash\$&amp; Co have been shipped/);
  } finally { h.dispose(); }
});

test('review: the background check ignores overlapping runs, a hidden window, and answers that arrive after the mailbox changed; counts update without a redraw', async () => {
  let release = null, answers = 0;
  const badges = [];
  const h = harness({ routes: {
    '/api/mail/status': ({ reply }) => { answers++; const answer = reply(200, { ok: true, unread: 7, pending: 0, total: 9, uidNext: 20 }); return release === 'hold' ? new Promise(resolve => { release = () => resolve(answer); }) : answer; },
    '/api/mail-account/unbind': ({ reply }) => reply(200, { ok: true, available: true, account: null }) }, ctx: { onCounts: counts => badges.push(counts && counts.unread) } });
  try {
    await h.mail.start(); await h.mail.select(); assert.equal(answers, 1);
    const mounts = h.mounted.length; badges.length = 0;
    release = 'hold'; const first = h.mail.check(); assert.equal(await h.mail.check(), false, 'a second check while one is running does nothing'); assert.equal(answers, 2);
    await h.act('unbind-confirm'); assert.equal(h.mail.account(), null);
    release(); assert.equal(await first, false, 'the late answer belongs to the mailbox that was just unbound');
    assert.equal(h.mail.counts(), null); assert.deepEqual(badges, [null], 'the badge is cleared by the unbind and not brought back');
    release = null;
  } finally { h.dispose(); }
  const quiet = harness({ routes: { '/api/mail/status': ({ reply }) => reply(200, { ok: true, unread: 5, pending: 0, total: 9, uidNext: 20 }) } });
  try {
    await quiet.mail.start(); await quiet.mail.select(); const mounts = quiet.mounted.length, asked = quiet.calls('/api/mail/status').length;
    globalThis.document.hidden = true; assert.equal(await quiet.mail.check(), false); assert.equal(quiet.calls('/api/mail/status').length, asked, 'nothing is asked while the window is hidden'); globalThis.document.hidden = false;
    quiet.form('mail-search-form').elements.query.value = 'half typed';
    assert.equal(await quiet.mail.check(), true); assert.deepEqual(quiet.mail.counts(), { unread: 5, pending: 0 }); assert.equal(quiet.mounted.length, mounts, 'a count change repaints the numbers only: the page (and a half-typed search) is left alone');
    assert.equal(quiet.form('mail-search-form').elements.query.value, 'half typed');
  } finally { quiet.dispose(); }
});

test('review: the mail page loads the inbox even when the binding is still being read for another reason', async () => {
  let release;
  const h = harness({ routes: { '/api/mail-account': ({ reply }) => new Promise(resolve => { release = () => resolve(reply(200, { ok: true, available: true, account: ACCOUNT })); }) } });
  try {
    const starting = h.mail.start();   // 启动时的检查先发出了读取绑定状态的请求
    const entering = h.mail.select(); assert.match(h.page, /正在读取邮箱绑定状态/);
    release(); await starting; await entering;
    assert.equal(h.calls('/api/mail-account').length, 1, 'one request serves both'); assert.equal(h.calls('/api/mail/messages').length, 1); assert.match(h.page, /样品寄送确认/);
  } finally { h.dispose(); }
  const panel = harness({ active: false, routes: { '/api/mail-account': ({ reply }) => new Promise(resolve => { release = () => resolve(reply(200, { ok: true, available: true, account: ACCOUNT })); }) } });
  try {
    const starting = panel.mail.start(); const loading = panel.mail.loadCustomerPanel('Nordic Lamps AB');
    release(); await starting; await loading;
    assert.equal(panel.calls('/api/mail-account').length, 1); assert.equal(panel.calls('/api/mail/correspondence').length, 1); assert.doesNotMatch(panel.mail.customerPanel('Nordic Lamps AB'), /正在读取邮箱绑定状态/);
  } finally { panel.dispose(); }
});

test('review: a reply that carries only In-Reply-To still shows its conversation when opened', async () => {
  const reply2 = { ...T3, references: '', inReplyTo: '<t1@x>' };
  const t = threadRoutes([reply2, T1]);
  const h = harness({ routes: { ...t.routes, '/api/mail/correspondence': ({ reply }) => reply(200, { ok: true, items: [] }),
    '/api/mail/message': ({ query, reply }) => reply(200, { ok: true, message: { ...MESSAGE, box: 'inbox', uid: Number(query.uid), subject: 'Re: Order 88', messageId: '<t3@x>', references: '', attachments: [] } }) } });   // 读信接口这里故意不带 inReplyTo
  try {
    await h.mail.select(); assert.equal(rowsIn(h.page)[0].count, '2');
    await h.act('open', { box: 'inbox', uid: '13' });
    assert.match(h.page, /mail-reader-subject">Re: Order 88<span class="mail-thread-count"[^>]*>2</); assert.match(h.page, /mail-thread-strip[\s\S]*data-uid="11"/);
  } finally { h.dispose(); }
});

test('review: ticks do not survive a page change; a delete that half fails removes what did go and keeps the rest', async () => {
  let failSent = true;
  const pages = { 1: [{ ...T3 }, { ...T2 }], 2: [{ ...T1 }] };
  const h = harness({ routes: {
    '/api/mail/messages': ({ query, reply }) => reply(200, { ok: true, page: Number(query.page), pageSize: 2, total: 3, items: pages[query.page].map(i => ({ ...i })) }),
    '/api/mail/correspondence': ({ reply }) => reply(200, { ok: true, items: [{ ...T3 }, { ...SENT2 }, { ...T1 }].filter(i => !(i.box === 'inbox' && h.calls('/api/mail/trash').some(c => (c.payload.uids || [c.payload.uid]).includes(i.uid) && c.payload.box === 'inbox'))) }),
    '/api/mail/trash': ({ payload, reply }) => payload.box === 'sent' && failSent ? reply(502, { ok: false, message: '无法连接邮箱服务器' }) : reply(200, { ok: true }) } });
  try {
    await h.mail.select(); await h.act('thread-toggle'); await h.act('pick', { box: 'inbox', uid: '13' }); assert.match(h.page, /已选 1 封/);
    await h.act('page-next'); assert.doesNotMatch(h.page, /mail-bulkbar/, 'the tick from page 1 is gone'); await h.act('pick-all'); assert.match(h.page, /已选 1 封/, '全选本页 means this page only');
    await h.act('pick-none'); await h.act('thread-toggle');
    await h.mail.showView('customer'); await h.act('customer-select', { name: 'Nordic Lamps AB' });
    assert.equal(rowsIn(h.page)[0].count, '3');
    h.act('row-delete', { box: 'inbox', uid: '13' }); assert.match(h.dialog.body, /删除这 3 封邮件？/);
    await h.act('delete-confirm');
    assert.match(h.node('mail-confirm-error').textContent, /^2 封已移到「已删除」，其余 1 封没有删掉：无法连接邮箱服务器$/); assert.notEqual(h.dialog, null, 'the dialog stays so the rest can be retried');
    assert.deepEqual(rowsIn(h.page).map(r => [r.uid, r.count]), [['5', undefined]], 'the two that were moved are gone from the list');
    failSent = false; await h.act('delete-confirm'); assert.deepEqual(h.calls('/api/mail/trash').at(-1).payload, { box: 'sent', uid: 5 }, 'the retry only sends what is left'); assert.equal(h.dialog, null);
  } finally { h.dispose(); }
});

test('a loaded list goes to the auto-record hook; a recording redraws the page and a failing hook is ignored', async () => {
  const seen = [];
  const h = harness({ ctx: { autoRecordMails: async (items) => { seen.push(items.map(item => item.uid)); return 2; } } });
  try {
    await h.mail.select();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(seen, [[4, 3]], 'the messages of the loaded list, once');
  } finally { h.dispose(); }
  const broken = harness({ ctx: { autoRecordMails: () => { throw new Error('boom'); } } });
  try {
    await broken.mail.select();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(broken.page, /样品寄送确认/, 'the list still shows');
  } finally { broken.dispose(); }
  const none = harness();
  try { await none.mail.select(); assert.match(none.page, /样品寄送确认/); } finally { none.dispose(); }
});

test('a forwarded draft keeps the attach-original choice and the count after saving and reopening', async () => {
  const { createMailService } = require('../backend/mail-service.js');
  const { accountIdentity } = require('../backend/mail-imap.js');
  const drafts = new Map(), files = new Map();
  let account = ACCOUNT;
  const service = createMailService({ store: {
    readMailAccount: () => account, listMailDrafts: () => [...drafts.values()],
    writeMailDraft: (d, f) => { drafts.set(d.id, d); if (f !== undefined) files.set(d.id, f); }, readMailDraftFiles: id => files.get(id) || [],
  } });
  const message = { ...MESSAGE, accountIdentity: accountIdentity(ACCOUNT) };
  const h = harness({ routes: {
    '/api/mail/message': ({ reply }) => reply(200, { ok: true, message }),
    '/api/mail/drafts/save': ({ payload, reply }) => reply(200, service.saveDraft(payload)),
    '/api/mail/drafts': ({ reply }) => reply(200, service.drafts()),
    '/api/mail/draft': ({ query, reply }) => reply(200, service.getDraft(query)),
    '/api/mail/send': ({ reply }) => reply(200, { ok: true, recipients: ['boss@example.invalid'], rejected: [] }),
  } });
  try {
    await h.mail.select(); await h.act('open', { box: 'inbox', uid: '4' }); await h.act('forward');
    const form = h.form('mail-compose-form').elements;
    form.to.value = 'boss@example.invalid'; form.forwardAttachments.checked = false;
    await h.act('compose-draft');
    const saved = h.calls('/api/mail/drafts/save').at(-1).payload;
    assert.deepEqual([saved.forwardOf, saved.forwardAttachments, saved.forwardCount], [{ box: 'inbox', uid: 4, accountIdentity: message.accountIdentity }, false, 1]);
    const id = [...drafts.keys()][0];
    await h.act('compose-close'); await h.mail.select('drafts'); await h.act('draft-open', { id });
    const reopened = h.form('mail-compose-form').elements;
    assert.ok(reopened.forwardAttachments, 'the checkbox is still there after reopening');
    assert.equal(reopened.forwardAttachments.checked, false);
    reopened.forwardAttachments.checked = true;
    await h.submit('mail-compose-form');
    const sent = h.calls('/api/mail/send').at(-1).payload;
    assert.equal(sent.forwardAttachments, true); assert.equal(sent.forwardOf.accountIdentity, message.accountIdentity);
  } finally { h.dispose(); }
  // 换了邮箱后打开同一份草稿：不再提供“附带原附件”，发出的请求也不带原附件。
  account = { ...ACCOUNT, email: 'other@example-trade.com' };
  const draftId = service.saveDraft({ to: 'boss@example.invalid', subject: 'Fwd', text: 'x', forwardOf: { box: 'inbox', uid: 4, accountIdentity: accountIdentity(ACCOUNT) }, forwardAttachments: true, forwardCount: 1 }).draft.id;
  const other = harness({ account, routes: {
    '/api/mail/drafts': ({ reply }) => reply(200, service.drafts()),
    '/api/mail/draft': ({ query, reply }) => reply(200, service.getDraft(query)),
    '/api/mail/send': ({ reply }) => reply(200, { ok: true, recipients: ['boss@example.invalid'], rejected: [] }),
  } });
  try {
    await other.mail.select('drafts'); await other.act('draft-open', { id: draftId });
    assert.equal(other.form('mail-compose-form').elements.forwardAttachments, undefined);
    assert.match(other.page, /原邮件不在现在绑定的邮箱里/);
    await other.submit('mail-compose-form');
    assert.equal(other.calls('/api/mail/send').at(-1).payload.forwardAttachments, false);
  } finally { other.dispose(); }
});
