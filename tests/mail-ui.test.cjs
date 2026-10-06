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
  { box: 'inbox', uid: 4, from: li, to: [self], cc: [{ name: '', address: 'purchasing@shenzhen-parts.example' }], subject: '样品寄送确认', date: '2026-10-06T02:10:00.000Z', seen: false, pending: false, hasAttachment: true },
  { box: 'inbox', uid: 3, from: anna, to: [self], cc: [], subject: 'Re: Quotation <b>', date: '2026-10-05T14:20:00.000Z', seen: true, pending: true, hasAttachment: false },
];
const MESSAGE = { box: 'inbox', uid: 4, from: li, to: [self, { name: 'Ops', address: 'ops@example-trade.com' }], cc: [{ name: '', address: 'purchasing@shenzhen-parts.example' }], replyTo: [], subject: '样品寄送确认', date: '2026-10-06T02:10:00.000Z', messageId: '<s-9@shenzhen-parts.example>', references: '<s-8@x>', text: '您好，\n样品已寄出。', html: '', attachments: [{ index: 0, filename: '装箱单 <1>.pdf', contentType: 'application/pdf', size: 2048 }], seen: true, pending: false };
const CUSTOMERS = { 'Nordic Lamps AB': { email: 'Anna@Nordic-Lamps.example' }, '深圳配件': { contacts: [{ email: 'liwei@shenzhen-parts.example' }, { email: 'wanglei@shenzhen-parts.example' }, { email: 'bad' }] }, 'No Mail Co': {}, 'Archived Co': { email: 'old@x.example', laiBucket: 'trash' } };

function harness({ routes = {}, account = ACCOUNT, available = true, active = true, customers = CUSTOMERS, favoriteHeart } = {}) {
  const mounted = [], requests = [], toasts = [], opened = [], nodes = new Map(), submitters = new Map(), listeners = new Map();
  let dialog = null, closed = 0, forms = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { id, textContent: '', innerHTML: '', disabled: false, isConnected: true, value: '', files: [], classList: { visible: false, toggle(_, on) { this.visible = on; } }, addEventListener(type, fn) { listeners.set(id + ':' + type, fn); } }); return nodes.get(id); };
  const scan = (html) => {
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) node(id);
    for (const match of html.matchAll(/<form\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)) {
      const elements = {};
      for (const [, attrs] of match[2].matchAll(/<input\b([^>]*)>/g)) { const name = (/\bname="([^"]+)"/.exec(attrs) || [])[1]; if (name) elements[name] = { value: decode((/\bvalue="([^"]*)"/.exec(attrs) || [])[1]), checked: /\bchecked\b/.test(attrs) }; }
      for (const [, attrs, inner] of match[2].matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) elements[(/\bname="([^"]+)"/.exec(attrs))[1]] = { value: decode(inner) };
      for (const [, attrs, inner] of match[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) elements[(/\bname="([^"]+)"/.exec(attrs))[1]] = { value: (/<option value="([^"]*)" selected/.exec(inner) || /<option value="([^"]*)"/.exec(inner) || [])[1] };
      forms.set(match[1], { elements, addEventListener: (type, fn) => submitters.set(match[1], fn) });
    }
  };
  const previous = { document: globalThis.document, FileReader: globalThis.FileReader };
  globalThis.document = { getElementById: id => forms.get(id) || nodes.get(id) || null, querySelectorAll: () => [] };
  globalThis.FileReader = class { readAsDataURL(file) { if (file.fail) return this.onerror(); const done = () => { this.result = 'data:' + file.type + ';base64,' + Buffer.from(file.content).toString('base64'); this.onload(); }; if (file.slow) file.finish = done; else done(); } };
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
  const defaults = {
    '/api/mail-account': () => reply(200, { ok: true, available, account }),
    '/api/mail/messages': () => reply(200, { ok: true, folder: 'inbox', page: 1, pageSize: 50, total: INBOX.length, items: INBOX.map(item => ({ ...item })), counts: { unread: 1, pending: 1 } }),
    '/api/mail/message': () => reply(200, { ok: true, message: { ...MESSAGE } }),
    '/api/mail/drafts': () => reply(200, { ok: true, items: [] }),
    '/api/mail/correspondence': () => reply(200, { ok: true, items: [] }),
  };
  const mail = Mail.create({
    escape: escapeHtml, icon: name => `<svg data-icon="${name}"></svg>`,
    mount: (html) => { forms = new Map([...forms].filter(([id]) => dialog && id.startsWith('mail-') && !id.startsWith('mail-search'))); mounted.push(html); scan(html); },
    request: async (url, payload) => { const [route, queryString = ''] = url.split('?'); const query = Object.fromEntries(new URLSearchParams(queryString)); payload = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)); requests.push({ route, query, payload }); const handler = routes[route] || defaults[route]; return handler ? handler({ query, payload, reply }) : reply(200, { ok: true }); },
    isActive: () => active, favoriteHeart,
    dialog: (title, body, footer, type) => { dialog = { title, body, footer, type }; scan(body + footer); },
    closeDialog: () => { closed++; dialog = null; },
    toast: text => toasts.push(text),
    getCustomers: () => customers, isArchived: profile => profile.laiBucket === 'trash', openCustomer: name => opened.push(name),
  });
  const element = (dataset) => ({ dataset });
  return { mail, mounted, requests, toasts, opened, node, get page() { return mounted.at(-1); }, get dialog() { return dialog; }, get closed() { return closed; },
    form: id => forms.get(id), submit: id => submitters.get(id)({ preventDefault() {} }), fire: (id, type) => listeners.get(id + ':' + type)(), act: (name, dataset = {}) => mail.action(name, false, element(dataset)),
    calls: route => requests.filter(r => r.route === route), setActive(value) { active = value; },
    dispose() { globalThis.document = previous.document || { getElementById: () => null, querySelectorAll: () => [] }; globalThis.FileReader = previous.FileReader; } };
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
    h.act('compose'); assert.deepEqual(h.toasts, ['请先绑定邮箱']); assert.equal(h.dialog.type, 'mail-bind');
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
    await h.mail.select('bulk'); assert.match(h.page, /群发还没有做/);
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
    assert.match(h.page, /<h1>样品寄送确认<\/h1>/); assert.match(h.page, /李伟 &lt;liwei@shenzhen-parts\.example&gt;/); assert.match(h.page, /Ops &lt;ops@example-trade\.com&gt;/); assert.match(h.page, /<dt>抄送<\/dt><dd>purchasing@/);
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
    await h.act('back'); assert.match(h.page, /<h1>收件箱/); assert.doesNotMatch(h.page.match(/<div class="mail-row [^"]*"/)[0], /unread/);
  } finally { h.dispose(); }
});

test('a message that cannot be opened says why and returns to the list', async () => {
  const h = harness({ routes: { '/api/mail/message': ({ reply }) => reply(404, { ok: false, code: 'not_found', message: '这封邮件已经不在邮箱里了' }) } });
  try {
    await h.mail.select(); await h.act('open', { box: 'inbox', uid: '4' });
    assert.match(h.page, /无法打开这封邮件/); assert.match(h.page, /已经不在邮箱里了/);
    await h.act('back'); assert.match(h.page, /<h1>收件箱/);
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

test('reply, reply-all and forward prefill the right recipients, subject, quote and thread ids', async () => {
  const h = harness();
  try {
    await h.mail.select(); await h.act('open', { box: 'inbox', uid: '4' });
    h.act('reply'); let f = h.form('mail-compose-form').elements;
    assert.equal(h.dialog.title, '回复'); assert.equal(f.to.value, '李伟 <liwei@shenzhen-parts.example>'); assert.equal(f.cc.value, ''); assert.equal(f.subject.value, 'Re: 样品寄送确认');
    assert.match(f.text.value, /^\n\n在 2026-10-06 \d\d:10，李伟 <liwei@shenzhen-parts\.example> 写道：\n> 您好，\n> 样品已寄出。$/);
    await h.act('compose-close'); assert.equal(h.calls('/api/mail/drafts/save').length, 0, 'an untouched reply is not saved as a draft'); assert.equal(h.closed, 1);
    h.act('reply-all'); f = h.form('mail-compose-form').elements;
    assert.equal(f.to.value, '李伟 <liwei@shenzhen-parts.example>'); assert.equal(f.cc.value, 'Ops <ops@example-trade.com>, purchasing@shenzhen-parts.example', 'own address is left out');
    f.text.value = '好的'; await h.submit('mail-compose-form');
    const sent = h.calls('/api/mail/send').at(-1).payload;
    assert.equal(sent.inReplyTo, '<s-9@shenzhen-parts.example>'); assert.equal(sent.references, '<s-8@x> <s-9@shenzhen-parts.example>'); assert.equal(sent.forwardOf, null);
    h.act('forward'); f = h.form('mail-compose-form').elements;
    assert.equal(h.dialog.title, '转发'); assert.equal(f.to.value, ''); assert.equal(f.subject.value, 'Fwd: 样品寄送确认'); assert.match(f.text.value, /转发的邮件[\s\S]*发件人：李伟[\s\S]*主题：样品寄送确认[\s\S]*您好，/);
    assert.match(h.dialog.body, /name="forwardAttachments" checked> 附带原邮件的 1 个附件/);
    f.to.value = 'boss@example-trade.com'; f.forwardAttachments.checked = false; await h.submit('mail-compose-form');
    const forwarded = h.calls('/api/mail/send').at(-1).payload;
    assert.deepEqual(forwarded.forwardOf, { box: 'inbox', uid: 4 }); assert.equal(forwarded.forwardAttachments, false); assert.equal(forwarded.inReplyTo, '');
  } finally { h.dispose(); }
  const again = harness({ routes: { '/api/mail/message': ({ reply }) => reply(200, { ok: true, message: { ...MESSAGE, subject: 'RE: already', replyTo: [{ name: '', address: 'reply-here@x.example' }] } }) } });
  try { await again.mail.select(); await again.act('open', { box: 'inbox', uid: '4' }); again.act('reply'); const f = again.form('mail-compose-form').elements; assert.equal(f.subject.value, 'RE: already'); assert.equal(f.to.value, 'reply-here@x.example'); }
  finally { again.dispose(); }
});

test('composing validates, attaches files, sends once and reports the result', async () => {
  let attempt = 0;
  const h = harness({ routes: { '/api/mail/send': ({ reply }) => ++attempt === 1 ? reply(422, { ok: false, code: 'smtp_rejected', message: '收件人 gone@x.example 被发信服务器拒绝，整封邮件没有发出' }) : new Promise(resolve => setImmediate(() => resolve(reply(200, { ok: true, recipients: ['a@b.example', 'c@d.example'] })))) } });
  try {
    await h.mail.select('sent');
    h.act('compose'); const f = h.form('mail-compose-form').elements;
    assert.equal(h.dialog.type, 'mail-compose'); assert.match(h.dialog.body, /value="sales@example-trade\.com" disabled/);
    await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-error').textContent, '请至少填写一位收件人');
    f.to.value = 'a@b.example'; await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-error').textContent, '主题和正文不能都为空'); assert.equal(h.calls('/api/mail/send').length, 0);
    h.node('mail-compose-file').files = [{ name: '报价.pdf', type: 'application/pdf', size: 4, content: '%PDF' }, { name: 'huge.bin', type: '', size: 11 * 1024 * 1024, content: '' }, { name: 'slow.txt', type: 'text/plain', size: 2, content: 'ok', slow: true }, { name: 'broken.txt', type: 'text/plain', size: 1, fail: true }];
    const slow = h.node('mail-compose-file').files[2];
    h.fire('mail-compose-file', 'change');
    assert.match(h.node('mail-compose-file-list').innerHTML, /报价\.pdf[\s\S]*slow\.txt/); assert.doesNotMatch(h.node('mail-compose-file-list').innerHTML, /huge\.bin|broken\.txt/);
    f.subject.value = 'Hello'; f.text.value = 'Body'; f.cc.value = 'c@d.example'; f.fromName.value = ' Kris ';
    await h.submit('mail-compose-form'); assert.equal(h.node('mail-compose-error').textContent, '附件还在读取，请稍候再发送'); assert.equal(h.calls('/api/mail/send').length, 0);
    slow.finish(); h.act('file-remove', { index: '1' }); assert.doesNotMatch(h.node('mail-compose-file-list').innerHTML, /slow\.txt/);
    await h.submit('mail-compose-form');
    assert.match(h.node('mail-compose-error').textContent, /gone@x\.example/); assert.equal(h.closed, 0); assert.equal(h.node('mail-compose-submit').disabled, false); assert.equal(h.node('mail-compose-submit').textContent, '发送');
    const first = h.submit('mail-compose-form'); await h.submit('mail-compose-form');
    assert.equal(h.node('mail-compose-submit').textContent, '正在发送…'); await first;
    assert.equal(h.calls('/api/mail/send').length, 2, 'a second click while sending is ignored');
    assert.deepEqual(h.calls('/api/mail/send').at(-1).payload, { to: 'a@b.example', cc: 'c@d.example', bcc: '', subject: 'Hello', text: 'Body', inReplyTo: '', references: '', forwardOf: null, fromName: 'Kris', forwardAttachments: true, attachments: [{ filename: '报价.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }] });
    assert.equal(h.closed, 1); assert.equal(h.toasts.at(-1), '邮件已发送给 2 位收件人'); assert.equal(h.mail.account().senderName, 'Kris'); assert.equal(h.mail.composing(), false);
    assert.equal(h.calls('/api/mail/messages').length, 2, 'the sent folder is re-read after sending');
  } finally { h.dispose(); }
});

test('closing an edited message saves it as a draft; drafts can be reopened, sent and deleted', async () => {
  const stored = [];
  let failSave = false;
  const h = harness({ routes: {
    '/api/mail/drafts/save': ({ payload, reply }) => { if (failSave) return reply(503, { ok: false, message: 'storage unavailable' }); const draft = { ...payload, id: payload.id || 'a'.repeat(32), updatedAt: '2026-10-06T09:00:00.000Z' }; stored.splice(0, stored.length, draft); return reply(200, { ok: true, draft }); },
    '/api/mail/drafts': ({ reply }) => reply(200, { ok: true, items: stored.map(d => ({ ...d })) }),
    '/api/mail/drafts/delete': ({ reply }) => { stored.length = 0; return reply(200, { ok: true }); },
    '/api/mail/send': ({ reply }) => reply(200, { ok: true, recipients: ['a@b.example'] }) } });
  try {
    await h.mail.select('drafts'); assert.match(h.page, /草稿箱是空的/); assert.match(h.page, /只保存在这台电脑上/);
    h.act('compose'); await h.act('compose-close'); assert.equal(stored.length, 0, 'an empty message is just closed'); assert.equal(h.closed, 1);
    h.act('compose'); let f = h.form('mail-compose-form').elements; f.to.value = 'a@b.example'; f.subject.value = '报价 <1>';
    failSave = true; await h.act('compose-close');
    assert.match(h.node('mail-compose-error').textContent, /草稿保存失败：storage unavailable 再点一次「取消」将放弃这封信/); assert.equal(h.closed, 1, 'the window stays open when the draft could not be saved'); assert.equal(h.mail.composing(), true);
    failSave = false; await h.act('compose-draft'); assert.equal(h.toasts.at(-1), '已存入草稿箱'); assert.equal(h.mail.composing(), true);
    assert.deepEqual(h.calls('/api/mail/drafts/save').at(-1).payload, { to: 'a@b.example', cc: '', bcc: '', subject: '报价 <1>', text: '', inReplyTo: '', references: '', forwardOf: null });
    f.text.value = 'more'; await h.act('compose-close');
    assert.equal(h.calls('/api/mail/drafts/save').at(-1).payload.id, 'a'.repeat(32), 'the same draft is updated, not duplicated'); assert.equal(h.closed, 2); assert.equal(h.mail.composing(), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(h.page, /草稿箱（1）/); assert.match(h.page, /发给 a@b\.example/); assert.match(h.page, /报价 &lt;1&gt;/);
    h.act('draft-open', { id: 'a'.repeat(32) }); f = h.form('mail-compose-form').elements;
    assert.equal(h.dialog.title, '继续写信'); assert.deepEqual([f.to.value, f.subject.value, f.text.value], ['a@b.example', '报价 <1>', 'more']);
    await h.act('compose-close'); assert.equal(h.calls('/api/mail/drafts/save').length, 3, 'reopening without changes does not save again');
    h.act('draft-open', { id: 'a'.repeat(32) }); await h.submit('mail-compose-form');
    assert.equal(h.calls('/api/mail/send').at(-1).payload.draftId, 'a'.repeat(32)); assert.equal(h.calls('/api/mail/send').at(-1).payload.id, undefined);
    stored.push({ id: 'b'.repeat(32), to: '', subject: '', text: 'x', updatedAt: '2026-10-06T09:00:00.000Z' }); await h.act('refresh'); assert.match(h.page, /（未填收件人）/); assert.match(h.page, /（无主题）/);
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
    h.act('customer-compose'); assert.equal(h.form('mail-compose-form').elements.to.value, 'anna@nordic-lamps.example'); await h.act('compose-close');
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
    h.act('compose'); assert.deepEqual(h.toasts, ['网页试用版无法收发邮件']);
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
  assert.deepEqual([...new Set([...source.matchAll(/"(\/api\/[^"?]+)"/g)].map(m => m[1]))].sort(), ['/api/mail-account', '/api/mail-account/bind', '/api/mail-account/unbind', '/api/mail-account/verify', '/api/mail/attachment/save', '/api/mail/correspondence', '/api/mail/drafts', '/api/mail/drafts/delete', '/api/mail/drafts/save', '/api/mail/flags', '/api/mail/message', '/api/mail/messages', '/api/mail/send', '/api/mail/trash']);
  for (const marker of ['<!--MAIL_STYLE-->', '<!--LAI_MAIL_UI-->']) { assert.equal(read('src/template.html').split(marker).length, 2, marker); assert.ok(read('scripts/build.py').includes(marker), marker); }
  const app = read('src/app.js');
  assert.ok(app.includes('["mail", "邮件", "mail"]')); for (const hook of ['d.mailFolder', 'd.mailAction', 'd.mailView', 'modal === "mail-compose" && !confirmed']) assert.ok(app.includes(hook), hook);
  for (const file of ['mail-account.js', 'mail-imap.js', 'mail-client.js', 'mail-smtp.js', 'mail-mime.js', 'mail-service.js']) assert.ok(read('scripts/build.py').includes(`'${file}'`), file + ' is bundled into the app');
  const RM = require('../src/rail-menu.js');
  assert.deepEqual(RM.menuFor('邮件', {}).map(row => [row.label, row.kind, row.target]), Mail.folders.map(f => [f.label, 'mail', f.id]));
});

test('the web trial sample mailbox is labelled as a sample everywhere and never claims a real send', async () => {
  const h = harness({ account: { ...ACCOUNT, email: 'demo@lai-trial.example', demo: true, host: '', port: 0 }, available: false, routes: { '/api/mail/send': ({ reply }) => reply(200, { ok: true, recipients: ['a@b.example'] }) } });
  try {
    await h.mail.select();
    assert.match(h.page, /mail-demo-tag[^>]*>示例邮箱 · 不会真的发信</); assert.match(h.page, /样品寄送确认/);
    h.act('account'); assert.match(h.dialog.body, /示例邮箱（网页试用版）/); assert.match(h.dialog.body, /不会真的发出/); assert.doesNotMatch(h.dialog.body, /data-mail-action="(verify|unbind|bind)"|已绑定/);
    h.act('compose'); const f = h.form('mail-compose-form').elements; f.to.value = 'a@b.example'; f.subject.value = 'x'; await h.submit('mail-compose-form');
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
  assert.equal(inbox.total, 4); assert.deepEqual(inbox.counts, { unread: 3, pending: 1 }); assert.ok(inbox.items.every(i => /示例|Sample/.test(i.subject)), 'every sample message says it is a sample');
  assert.equal((await get('/api/mail/messages?folder=pending')).total, 1); assert.equal((await get('/api/mail/messages?folder=inbox&query=' + encodeURIComponent('样品'))).total, 1);
  const opened = await get('/api/mail/message?box=inbox&uid=5'); assert.equal(opened.message.attachments.length, 1); assert.equal((await get('/api/mail/messages?folder=unread')).total, 2);
  assert.equal((await post('/api/mail/attachment/save', { box: 'inbox', uid: 5, index: 0 })).status, 501);
  assert.equal((await post('/api/mail/send', { to: '', subject: 's', text: 't' })).status, 400); assert.equal((await post('/api/mail/send', { to: 'nope', subject: 's', text: 't' })).status, 400);
  const draft = (await post('/api/mail/drafts/save', { to: 'anna@nordic-lamps.example', subject: 'd' })).body.draft;
  const sent = await post('/api/mail/send', { to: 'Anna <anna@nordic-lamps.example>', subject: 'PI', text: 'hello', draftId: draft.id, fromName: 'Kris' });
  assert.equal(sent.status, 200); assert.deepEqual(sent.body.recipients, ['anna@nordic-lamps.example']);
  assert.equal((await get('/api/mail/messages?folder=sent')).items[0].subject, 'PI'); assert.equal((await get('/api/mail/drafts')).items.length, 0);
  assert.deepEqual((await get('/api/mail/correspondence?addresses=anna@nordic-lamps.example')).items.map(i => i.box), ['sent', 'inbox', 'sent']);
  await post('/api/mail/trash', { box: 'inbox', uid: 5 }); assert.equal((await get('/api/mail/messages?folder=inbox')).total, 3);
  await sandbox.fetch('/api/data'); assert.deepEqual(outside, ['/api/data'], 'only non-mail requests pass through; mail requests never reach the network');
});
