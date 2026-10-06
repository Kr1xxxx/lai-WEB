const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('../src/model.js');
require('../src/mail-ui.js');
const Mail = globalThis.LaiMailUI;

// 小型界面替身：记录渲染结果与对话框，按 id 提供表单/提示节点；本机服务由 respond 决定应答。
function harness({ respond, active = true } = {}) {
  const mounted = [], requests = [], toasts = [], nodes = new Map();
  let dialog = null, closed = 0, submit = null;
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { id, textContent: '', disabled: false, isConnected: true, classList: { visible: false, toggle(_, on) { this.visible = on; } } }); return nodes.get(id); };
  const scan = (html) => { for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) node(id); };
  const fields = { email: { value: '' }, password: { value: '' }, site: { value: 'cn' }, accountType: { value: 'auto' } };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => {
    if (id === 'mail-bind-form') return dialog && dialog.type === 'mail-bind' ? { elements: fields, addEventListener: (_, fn) => { submit = fn; } } : null;
    return nodes.get(id) || null;
  } };
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
  const mail = Mail.create({
    escape: escapeHtml, icon: name => `<svg data-icon="${name}"></svg>`,
    mount: (html) => { mounted.push(html); scan(html); },
    request: async (url, payload) => { requests.push({ url, payload }); return respond({ url, payload, reply }); },
    isActive: () => active,
    dialog: (title, body, footer, type) => { dialog = { title, body, footer, type }; scan(body + footer); if (type === 'mail-bind') { fields.email.value = (body.match(/name="email"[^>]*value="([^"]*)"/) || [])[1] || ''; fields.password.value = ''; fields.site.value = (body.match(/<select id="mail-bind-site"[\s\S]*?<option value="(\w+)" selected/) || [])[1]; fields.accountType.value = 'auto'; } },
    closeDialog: () => { closed++; dialog = null; },
    toast: text => toasts.push(text),
  });
  return { mail, mounted, requests, toasts, fields, node, get page() { return mounted.at(-1); }, get dialog() { return dialog; }, get closed() { return closed; },
    submit: () => submit({ preventDefault() {} }), setActive(value) { active = value; }, dispose() { globalThis.document = previousDocument; } };
}
const ACCOUNT = { provider: 'zoho', email: 'sales@example-trade.com', site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993, boundAt: '2026-10-06T10:00:00.000Z', verifiedAt: '2026-10-06T10:00:00.000Z' };
const unbound = ({ reply }) => reply(200, { ok: true, available: true, account: null });
const bound = ({ reply }) => reply(200, { ok: true, available: true, account: ACCOUNT });

test('mail navigation lists the three tabs, split compose button and six folders', () => {
  assert.deepEqual(Mail.folders.map(f => f.label), ['收件箱', '待处理邮件', '未读邮件', '草稿箱', '发件箱', '群发箱']);
  assert.deepEqual(Mail.views.map(v => v.label), ['邮件', '客户', '下属']);
  const h = harness({ respond: unbound });
  try {
    const html = h.mail.subnav();
    assert.deepEqual([...html.matchAll(/data-mail-view="(\w+)" aria-selected="(\w+)"/g)].map(m => m.slice(1)), [['mail', 'true'], ['customer', 'false'], ['team', 'false']]);
    assert.equal([...html.matchAll(/data-mail-folder="/g)].length, 6);
    assert.match(html, /data-feature="写信"/); assert.match(html, /data-feature="写信选项"/);
    assert.ok(html.indexOf('mail-views') < html.indexOf('mail-compose') && html.indexOf('mail-compose') < html.indexOf('mail-folders'));
    for (const excluded of ['文件夹', '标签邮件', '已删除邮件', '垃圾邮件', '追踪信息']) assert.ok(!html.includes(excluded), excluded);
  } finally { h.dispose(); }
});

test('客户 and 下属 tabs explain themselves, hide folders, and never call the service', async () => {
  const h = harness({ respond: bound });
  try {
    h.mail.showView('customer');
    assert.match(h.page, /<h1>客户邮件<\/h1>/); assert.match(h.page, /按客户查看往来邮件/); assert.doesNotMatch(h.page, /data-mail-action/);
    assert.doesNotMatch(h.mail.subnav(), /data-mail-folder/); assert.match(h.mail.subnav(), /data-mail-view="customer" aria-selected="true"/);
    h.mail.showView('team');
    assert.match(h.page, /<h1>下属邮件<\/h1>/); assert.match(h.page, /单机版/);
    assert.equal(h.requests.length, 0);
    h.mail.showView('nope'); assert.equal(h.mail.view(), 'mail');
    h.mail.showView('team'); await h.mail.select('sent');
    assert.equal(h.mail.view(), 'mail'); assert.match(h.page, /<h1>发件箱<\/h1>/);
  } finally { h.dispose(); }
});

test('opening the page reads the binding once and shows the unbound state in every folder', async () => {
  const h = harness({ respond: unbound });
  try {
    const pending = h.mail.select();
    assert.match(h.page, /正在读取邮箱绑定状态/); assert.doesNotMatch(h.page, /data-mail-action="bind"/);
    await pending;
    for (const folder of Mail.folders) {
      await h.mail.select(folder.id);
      assert.ok(h.page.includes(`<h1>${folder.label}</h1>`)); assert.match(h.page, /未绑定邮箱/); assert.match(h.page, /data-mail-action="bind"/);
      assert.equal([...h.mail.subnav().matchAll(/nav-entry active/g)].length, 1);
      assert.match(h.mail.subnav(), new RegExp(`class="nav-entry active" data-mail-folder="${folder.id}"`));
    }
    assert.deepEqual(h.requests, [{ url: '/api/mail-account', payload: undefined }]);
    await h.mail.select('nope'); assert.equal(h.mail.folder(), 'inbox');
  } finally { h.dispose(); }
});

test('a failed status read offers a retry instead of pretending to be unbound', async () => {
  let fail = true;
  const h = harness({ respond: ({ reply }) => fail ? reply(503, { ok: false, message: 'storage unavailable' }) : reply(200, { ok: true, available: true, account: ACCOUNT }) });
  try {
    await h.mail.select();
    assert.match(h.page, /无法读取邮箱绑定状态/); assert.match(h.page, /storage unavailable/); assert.doesNotMatch(h.page, /未绑定邮箱|data-mail-action="bind"/);
    fail = false; await h.mail.action('reload');
    assert.match(h.page, /sales@example-trade\.com/);
    const old = harness({ respond: ({ reply }) => reply(404, { ok: false, message: 'not found' }) });
    try { await old.mail.select(); assert.match(old.page, /请更新应用/); } finally { old.dispose(); }
  } finally { h.dispose(); }
});

test('binding submits to the local service, then shows the bound account without the password', async () => {
  const h = harness({ respond: ({ url, payload, reply }) => url === '/api/mail-account' ? reply(200, { ok: true, available: true, account: null }) : reply(200, { ok: true, available: true, account: { ...ACCOUNT, email: payload.email } }) });
  try {
    await h.mail.select('drafts');
    h.mail.action('bind');
    assert.equal(h.dialog.type, 'mail-bind'); assert.equal(h.dialog.title, '绑定 Zoho 邮箱');
    assert.match(h.dialog.body, /type="password"[^>]*autocomplete="new-password"/); assert.doesNotMatch(h.dialog.body, /name="password"[^>]*value=/);
    assert.match(h.dialog.body, /<option value="cn" selected>/); assert.match(h.dialog.body, /IMAP 访问/); assert.match(h.dialog.body, /应用专用密码/); assert.match(h.dialog.body, /备份文件也会包含/);
    await h.submit();
    assert.equal(h.node('mail-bind-error').textContent, '请填写邮箱地址'); assert.equal(h.requests.length, 1);
    h.fields.email.value = '  sales@example-trade.com '; await h.submit();
    assert.equal(h.node('mail-bind-error').textContent, '请填写应用专用密码'); assert.equal(h.requests.length, 1);
    h.fields.password.value = ' pass with spaces ';
    await h.submit();
    assert.deepEqual(h.requests.at(-1), { url: '/api/mail-account/bind', payload: { email: 'sales@example-trade.com', password: ' pass with spaces ', site: 'cn', accountType: 'auto' } });
    assert.equal(h.closed, 1); assert.deepEqual(h.toasts, ['邮箱已绑定']);
    assert.match(h.page, /<h1>草稿箱<\/h1>/); assert.match(h.page, /已绑定/); assert.match(h.page, /sales@example-trade\.com/); assert.match(h.page, /imappro\.zoho\.com\.cn:993/);
    assert.match(h.page, /还不会读取或发送邮件/); assert.doesNotMatch(h.page, /pass with spaces|未绑定邮箱/);
    for (const action of ['verify', 'bind', 'unbind']) assert.match(h.page, new RegExp(`data-mail-action="${action}"`));
  } finally { h.dispose(); }
});

test('a refused binding keeps the form open with the reason and allows another try', async () => {
  let attempts = 0;
  const h = harness({ respond: ({ url, reply }) => url === '/api/mail-account' ? reply(200, { ok: true, available: true, account: null }) : ++attempts === 1 ? reply(422, { ok: false, code: 'auth_failed', message: '登录被邮箱服务器拒绝。<b>' }) : attempts === 2 ? reply(502, undefined) : reply(200, { ok: true, available: true, account: ACCOUNT }) });
  try {
    await h.mail.select();
    h.mail.action('bind'); h.fields.email.value = 'sales@example-trade.com'; h.fields.password.value = 'wrong';
    await h.submit();
    assert.equal(h.node('mail-bind-error').textContent, '登录被邮箱服务器拒绝。<b>'); assert.equal(h.node('mail-bind-error').classList.visible, true);
    assert.equal(h.closed, 0); assert.equal(h.node('mail-bind-submit').disabled, false); assert.equal(h.node('mail-bind-submit').textContent, '验证并绑定'); assert.equal(h.mail.busy(), false);
    assert.equal(h.mail.account(), null); assert.deepEqual(h.toasts, []);
    await h.submit();
    assert.equal(h.node('mail-bind-error').textContent, '请求失败（502）');
    await h.submit();
    assert.equal(h.closed, 1); assert.equal(h.mail.account().email, 'sales@example-trade.com');
  } finally { h.dispose(); }
});

test('a second submit while verifying is ignored', async () => {
  let release;
  const h = harness({ respond: ({ url, reply }) => url === '/api/mail-account' ? reply(200, { ok: true, available: true, account: null }) : new Promise(resolve => { release = () => resolve(reply(200, { ok: true, available: true, account: ACCOUNT })); }) });
  try {
    await h.mail.select();
    h.mail.action('bind'); h.fields.email.value = 'sales@example-trade.com'; h.fields.password.value = 'p';
    const first = h.submit();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.node('mail-bind-submit').disabled, true); assert.equal(h.node('mail-bind-submit').textContent, '正在验证…');
    await h.submit();
    assert.equal(h.requests.filter(r => r.url.endsWith('/bind')).length, 1);
    release(); await first;
  } finally { h.dispose(); }
});

test('the web trial explains that it cannot connect and disables binding', async () => {
  const h = harness({ respond: ({ reply }) => reply(200, { ok: true, available: false, account: null }) });
  try {
    await h.mail.select();
    h.mail.action('bind');
    assert.match(h.dialog.body, /网页试用版[^<]*无法连接邮箱服务器/); assert.match(h.dialog.footer, /id="mail-bind-submit" disabled/);
    h.fields.email.value = 'a@zoho.com.cn'; h.fields.password.value = 'p'; await h.submit();
    assert.equal(h.requests.length, 1, 'nothing is sent');
  } finally { h.dispose(); }
});

test('re-verify reports success or the failure reason and keeps the binding', async () => {
  let ok = true;
  const h = harness({ respond: ({ url, reply }) => url === '/api/mail-account' ? reply(200, { ok: true, available: true, account: ACCOUNT }) : ok ? reply(200, { ok: true, available: true, account: { ...ACCOUNT, verifiedAt: '2026-10-07T01:02:00.000Z' } }) : reply(422, { ok: false, code: 'auth_failed', message: '登录被邮箱服务器拒绝' }) });
  try {
    await h.mail.select();
    await h.mail.action('verify');
    assert.deepEqual(h.requests.at(-1), { url: '/api/mail-account/verify', payload: {} }); assert.deepEqual(h.toasts, ['验证通过，邮箱连接正常']);
    assert.equal(h.mail.account().verifiedAt, '2026-10-07T01:02:00.000Z'); assert.doesNotMatch(h.page, /disabled/);
    ok = false; await h.mail.action('verify');
    assert.equal(h.node('mail-account-error').textContent, '登录被邮箱服务器拒绝'); assert.match(h.page, /sales@example-trade\.com/); assert.equal(h.mail.account().email, ACCOUNT.email);
    assert.equal(h.toasts.length, 1);
  } finally { h.dispose(); }
});

test('unbinding asks first and only removes the binding after confirmation', async () => {
  const h = harness({ respond: ({ url, reply }) => url.endsWith('/unbind') ? reply(200, { ok: true, available: true, account: null }) : reply(200, { ok: true, available: true, account: ACCOUNT }) });
  try {
    await h.mail.select();
    h.mail.action('unbind');
    assert.equal(h.dialog.type, 'mail-unbind'); assert.match(h.dialog.body, /解除 sales@example-trade\.com 的绑定/); assert.match(h.dialog.body, /密码会一并删除/); assert.match(h.dialog.footer, /data-mail-action="unbind-confirm"/);
    assert.equal(h.requests.length, 1, 'opening the confirmation changes nothing'); assert.equal(h.mail.account().email, ACCOUNT.email);
    await h.mail.action('unbind-confirm');
    assert.deepEqual(h.requests.at(-1), { url: '/api/mail-account/unbind', payload: {} });
    assert.equal(h.mail.account(), null); assert.equal(h.closed, 1); assert.deepEqual(h.toasts, ['已解除绑定']); assert.match(h.page, /未绑定邮箱/);
  } finally { h.dispose(); }
});

test('a result that arrives after leaving the mail page does not redraw another page', async () => {
  const h = harness({ respond: bound });
  try {
    const pending = h.mail.select();
    const count = h.mounted.length; h.setActive(false);
    await pending;
    assert.equal(h.mounted.length, count); assert.equal(h.mail.account().email, ACCOUNT.email);
  } finally { h.dispose(); }
});

test('account details from the service are escaped', async () => {
  const h = harness({ respond: ({ reply }) => reply(200, { ok: true, available: true, account: { ...ACCOUNT, email: '<img src=x onerror=1>@x.com', host: '"><script>' } }) });
  try {
    await h.mail.select();
    assert.doesNotMatch(h.page, /<img|<script/); assert.match(h.page, /&lt;img/);
    h.mail.action('bind'); assert.doesNotMatch(h.dialog.body, /<img/);
    h.mail.action('unbind'); assert.doesNotMatch(h.dialog.body, /<img/);
  } finally { h.dispose(); }
});

test('the page module only talks through the provided request and keeps no credential', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/mail-ui.js'), 'utf8');
  for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'console.']) assert.ok(!source.includes(banned), banned);
  assert.deepEqual([...new Set([...source.matchAll(/"(\/api\/[^"]+)"/g)].map(m => m[1]))].sort(), ['/api/mail-account', '/api/mail-account/bind', '/api/mail-account/unbind', '/api/mail-account/verify']);
});

test('mail module is wired into the template, build and app routing', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const marker of ['<!--MAIL_STYLE-->', '<!--LAI_MAIL_UI-->']) {
    assert.equal(read('src/template.html').split(marker).length, 2, marker);
    assert.ok(read('scripts/build.py').includes(marker), marker);
  }
  const app = read('src/app.js');
  assert.ok(app.includes('["mail", "邮件", "mail"]'));
  for (const hook of ['d.mailFolder', 'd.mailAction', 'd.mailView']) assert.ok(app.includes(hook), hook);
  assert.ok(read('src/template.html').indexOf('<!--LAI_MAIL_UI-->') < read('src/template.html').indexOf('<!--PREVIEW_APP-->'));
  for (const file of ['mail-account.js', 'mail-imap.js']) assert.ok(read('scripts/build.py').includes(`'${file}'`), file + ' is bundled into the app');
});

test('rail flyout lists the same six folders as the mail page', () => {
  const RM = require('../src/rail-menu.js');
  assert.deepEqual(RM.menuFor('邮件', {}).map(row => [row.label, row.kind, row.target]), Mail.folders.map(f => [f.label, 'mail', f.id]));
  assert.equal(RM.sectionFor('mail'), null);
});
