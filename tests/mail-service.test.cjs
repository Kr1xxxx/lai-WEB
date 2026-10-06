const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fake = require('./fixtures/fake-mail-servers.cjs');
const sample = require('./fixtures/mail-sample.cjs');
const { createMailService } = require('../backend/mail-service.js');
const smtpClient = require('../backend/mail-smtp.js');

// 邮件服务对接本机假 IMAP／SMTP 服务器；存储用内存替身。不连接任何真实邮箱。
const me = { name: '', address: 'sales@example-trade.com' };
const SECRET = 'app-password-1';
async function harness(options = {}) {
  const imap = await fake.startImap({ specialUse: options.specialUse, mailboxes: options.mailboxes || sample.mailboxes(me), supportsMove: options.supportsMove !== false, password: options.serverPassword || SECRET, sentName: options.sentName, trashName: options.trashName });
  const smtp = await fake.startSmtp({ reject: options.reject || [], password: options.serverPassword || SECRET, user: me.address });
  let account = options.unbound ? null : { provider: 'zoho', email: me.address, password: SECRET, site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993 };
  const drafts = new Map(); let clock = 0; const revealed = [];
  const store = { readMailAccount: () => account, writeMailAccount: (next) => { account = next; }, listMailDrafts: () => [...drafts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), writeMailDraft: draft => drafts.set(draft.id, draft), deleteMailDraft: id => drafts.delete(id) };
  const downloads = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-dl-'));
  const service = createMailService({ store, connectImap: imap.connect, connectSmtp: smtp.connect, now: () => new Date(Date.UTC(2026, 9, 6, 10, 0, clock++)), downloadsDir: downloads, reveal: file => revealed.push(file) });
  return { imap, smtp, service, drafts, downloads, revealed, get account() { return account; }, set account(value) { account = value; },
    box: name => imap.state.boxes.get(name).messages,
    async close() { await imap.close(); await smtp.close(); fs.rmSync(downloads, { recursive: true, force: true }); } };
}
const until = async (check) => { for (let i = 0; i < 400 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5)); };
const rejects = (promise, status, code, pattern) => assert.rejects(promise, (error) => { assert.equal(error.status, status, error.message); assert.equal(error.code, code); if (pattern) assert.match(error.message, pattern); assert.doesNotMatch(error.message, new RegExp(SECRET)); return true; });

test('folders map to the right mailbox and filter, newest first, with unread and pending counts', async () => {
  const h = await harness();
  try {
    const inbox = await h.service.list({ folder: 'inbox' });
    assert.deepEqual(inbox.items.map(i => [i.uid, i.box, i.from.name || i.from.address, i.subject, i.seen, i.pending, i.hasAttachment]), [
      [5, 'inbox', 'Zoho', 'Your weekly summary', false, false, false], [4, 'inbox', '李伟', '样品寄送确认 — 10月批次', false, false, true], [3, 'inbox', 'Anna Berg', 'Re: Quotation for LED panels', false, true, false],
      [2, 'inbox', 'Design Team', 'Catalogue cover', true, false, false], [1, 'inbox', '王磊', '报价确认', true, false, false]]);
    assert.deepEqual([inbox.total, inbox.page, inbox.pageSize, inbox.counts], [5, 1, 50, { unread: 3, pending: 1 }]);
    assert.equal(inbox.items[1].date, '2026-10-06T02:10:00.000Z'); assert.deepEqual(inbox.items[1].cc, [{ name: '', address: 'purchasing@shenzhen-parts.example' }]);
    assert.deepEqual((await h.service.list({ folder: 'unread' })).items.map(i => i.uid), [5, 4, 3]);
    assert.deepEqual((await h.service.list({ folder: 'pending' })).items.map(i => i.uid), [3]);
    const sent = await h.service.list({ folder: 'sent' });
    assert.deepEqual(sent.items.map(i => [i.box, i.subject, i.to[0].address]), [['sent', 'Quotation for LED panels', 'anna@nordic-lamps.example']]); assert.equal(sent.counts, undefined);
    for (const folder of ['drafts', 'bulk', 'trash', '', undefined, '__proto__', 'INBOX']) await rejects(h.service.list({ folder }), 400, 'invalid_input');
    assert.ok(h.imap.state.commands.every(c => !/^(UID STORE|UID MOVE|SELECT|EXPUNGE|APPEND|DELETE)/.test(c)), 'listing never changes the mailbox');
    await until(() => h.imap.state.commands.filter(c => c === 'LOGOUT').length === h.imap.state.logins);
    assert.equal(h.imap.state.commands.filter(c => c === 'LOGOUT').length, h.imap.state.logins, 'every session logs out');
  } finally { await h.close(); }
});

test('paging walks back from the newest message', async () => {
  const mailboxes = { INBOX: Array.from({ length: 120 }, (_, i) => ({ message: { from: { name: '', address: `p${i}@x.example` }, to: [me], subject: `Message ${i + 1}`, date: '2026-10-01T00:00:00Z', text: 'x' }, flags: ['\\Seen'] })) };
  const h = await harness({ mailboxes });
  try {
    const first = await h.service.list({ folder: 'inbox' }), second = await h.service.list({ folder: 'inbox', page: '2' }), third = await h.service.list({ folder: 'inbox', page: 3 }), beyond = await h.service.list({ folder: 'inbox', page: 9 });
    assert.deepEqual([first.items.length, first.items[0].uid, first.items[49].uid, first.total], [50, 120, 71, 120]);
    assert.deepEqual([second.items[0].uid, second.items[49].uid], [70, 21]); assert.deepEqual([third.items.length, third.items[0].uid, third.items.at(-1).uid], [20, 20, 1]);
    assert.deepEqual(beyond.items, []); assert.equal((await h.service.list({ folder: 'inbox', page: 'abc' })).page, 1); assert.equal((await h.service.list({ folder: 'inbox', page: -4 })).page, 1);
  } finally { await h.close(); }
});

test('search matches subject, sender or recipient, including non-ASCII text', async () => {
  const h = await harness();
  try {
    assert.deepEqual((await h.service.list({ folder: 'inbox', query: '样品' })).items.map(i => i.uid), [4]);
    assert.ok(h.imap.state.commands.some(c => /^UID SEARCH CHARSET UTF-8 ALL OR OR SUBJECT "样品" FROM "样品" TO "样品"$/.test(c)), 'non-ASCII terms are sent as UTF-8 literals');
    assert.deepEqual((await h.service.list({ folder: 'inbox', query: ' anna ' })).items.map(i => i.uid), [3]);
    assert.deepEqual((await h.service.list({ folder: 'unread', query: 'quotation' })).items.map(i => i.uid), [3]);
    assert.deepEqual((await h.service.list({ folder: 'inbox', query: 'nothing-matches' })).items, []);
    assert.deepEqual((await h.service.list({ folder: 'inbox', query: 'x" OR ALL "' })).items, [], 'quotes in the query stay inside the search term');
    await rejects(h.service.list({ folder: 'inbox', query: 'a\r\nL9 LOGOUT' }), 400, 'invalid_input');
  } finally { await h.close(); }
});

test('reading returns decoded content, marks the message read, and hides nothing it should show', async () => {
  const h = await harness();
  try {
    const { message } = await h.service.read({ box: 'inbox', uid: '4' });
    assert.deepEqual({ ...message, text: undefined }, { box: 'inbox', uid: 4, from: { name: '李伟', address: 'liwei@shenzhen-parts.example' }, to: [me], cc: [{ name: '', address: 'purchasing@shenzhen-parts.example' }], replyTo: [], subject: '样品寄送确认 — 10月批次', date: '2026-10-06T02:10:00.000Z', messageId: '<s-9@shenzhen-parts.example>', references: '', text: undefined, html: '',
      attachments: [{ index: 0, filename: '装箱单 2026-10.pdf', contentType: 'application/pdf', size: 31 }, { index: 1, filename: 'photo.png', contentType: 'image/png', size: sample.png.length }], seen: true, pending: false });
    assert.equal(message.text, '您好，\n\n样品已于今天寄出，附件是装箱单。\n\n李伟');
    assert.ok(h.imap.state.message('INBOX', 4).flags.has('\\Seen')); assert.deepEqual((await h.service.list({ folder: 'inbox' })).counts, { unread: 2, pending: 1 });
    const before = h.imap.state.commands.length; await h.service.read({ box: 'inbox', uid: 4 });
    assert.ok(!h.imap.state.commands.slice(before).some(c => c.startsWith('UID STORE')), 'an already-read message is not stored again');
    const html = (await h.service.read({ box: 'inbox', uid: 2 })).message;
    assert.match(html.html, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="cover">/); assert.match(html.html, /https:\/\/tracker\.example\/pixel\.gif/, 'remote references are left for the page to block, not fetched here');
    assert.deepEqual(html.attachments, [], 'an image shown inline is not listed again as an attachment');
    assert.equal((await h.service.read({ box: 'inbox', uid: 1 })).message.text.trim(), '你好，报价如下');
    assert.equal((await h.service.read({ box: 'inbox', uid: 3 })).message.pending, true);
    assert.equal((await h.service.read({ box: 'sent', uid: 6 })).message.subject, 'Quotation for LED panels');
    await rejects(h.service.read({ box: 'inbox', uid: 999 }), 404, 'not_found');
    for (const bad of [{ box: 'trash', uid: 1 }, { box: 'INBOX', uid: 1 }, { box: 'inbox', uid: 0 }, { box: 'inbox', uid: '1,2' }, { box: 'inbox', uid: '1:*' }, { box: 'inbox' }, {}, undefined]) await rejects(h.service.read(bad), 400, 'invalid_input');
  } finally { await h.close(); }
});

test('pending and unread marks are stored on the server', async () => {
  const h = await harness();
  try {
    await h.service.flags({ box: 'inbox', uid: 5, pending: true });
    assert.deepEqual([...h.imap.state.message('INBOX', 5).flags], ['\\Flagged']);
    await h.service.flags({ box: 'inbox', uid: 5, seen: true, pending: false });
    assert.deepEqual([...h.imap.state.message('INBOX', 5).flags], ['\\Seen']);
    await h.service.flags({ box: 'inbox', uid: 5, seen: false });
    assert.deepEqual([...h.imap.state.message('INBOX', 5).flags], []);
    for (const bad of [{ box: 'inbox', uid: 5 }, { box: 'inbox', uid: 5, seen: 'yes' }, { box: 'trash', uid: 5, seen: true }, { box: 'inbox', uid: 'x', seen: true }]) await rejects(h.service.flags(bad), 400, 'invalid_input');
  } finally { await h.close(); }
});

test('deleting moves the message to the trash folder, with or without server MOVE support', async () => {
  for (const supportsMove of [true, false]) {
    const h = await harness({ supportsMove, trashName: supportsMove ? 'Trash' : 'Deleted Items' });
    try {
      await h.service.trash({ box: 'inbox', uid: 4 });
      assert.deepEqual(h.box('INBOX').map(m => m.uid), [1, 2, 3, 5], 'only the chosen message leaves the inbox');
      const trash = h.box(supportsMove ? 'Trash' : 'Deleted Items');
      assert.equal(trash.length, 1); assert.match(trash[0].raw.toString(), /s-9@shenzhen-parts/);
      assert.equal(h.imap.state.commands.some(c => c === 'EXPUNGE'), !supportsMove);
      await h.service.trash({ box: 'sent', uid: 6 }); assert.equal(h.box('Sent').length, 0); assert.equal(trash.length, 2);
      await rejects(h.service.trash({ box: 'trash', uid: 1 }), 400, 'invalid_input');
    } finally { await h.close(); }
  }
});

test('attachments are saved under a safe unique name inside the downloads folder', async () => {
  const evil = Buffer.from(['From: x@y.example', 'To: ' + me.address, 'Subject: files', 'Content-Type: multipart/mixed; boundary=b', '', '--b', 'Content-Type: text/plain', '', 'see attached',
    '--b', 'Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="../../outside.txt"', '', 'escaped?', '--b', 'Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename=".bashrc"', '', 'dot', '--b--', ''].join('\r\n'));
  const h = await harness({ mailboxes: { INBOX: [...sample.mailboxes(me).INBOX, { message: evil, flags: [] }] } });
  try {
    const first = await h.service.saveAttachment({ box: 'inbox', uid: 4, index: 0 });
    assert.deepEqual(first, { ok: true, file: path.join(h.downloads, '装箱单 2026-10.pdf'), filename: '装箱单 2026-10.pdf' });
    assert.equal(fs.readFileSync(first.file, 'utf8'), '%PDF-1.4 synthetic packing list'); assert.equal(fs.statSync(first.file).mode & 0o077, 0);
    assert.equal((await h.service.saveAttachment({ box: 'inbox', uid: 4, index: 0 })).filename, '装箱单 2026-10 (1).pdf', 'an existing file is never overwritten');
    assert.equal((await h.service.saveAttachment({ box: 'inbox', uid: 4, index: '1' })).filename, 'photo.png'); assert.ok(fs.readFileSync(path.join(h.downloads, 'photo.png')).equals(sample.png));
    assert.deepEqual(h.revealed.map(file => path.basename(file)), ['装箱单 2026-10.pdf', '装箱单 2026-10 (1).pdf', 'photo.png']);
    const escaped = await h.service.saveAttachment({ box: 'inbox', uid: 6, index: 0 }), hidden = await h.service.saveAttachment({ box: 'inbox', uid: 6, index: 1 });
    assert.equal(path.dirname(escaped.file), h.downloads); assert.equal(escaped.filename, '_.._outside.txt'); assert.equal(hidden.filename, 'bashrc');
    assert.ok(!fs.existsSync(path.join(h.downloads, '..', 'outside.txt')) && !fs.existsSync(path.join(h.downloads, '..', '..', 'outside.txt')));
    await rejects(h.service.saveAttachment({ box: 'inbox', uid: 4, index: 7 }), 404, 'not_found'); await rejects(h.service.saveAttachment({ box: 'inbox', uid: 3, index: 0 }), 404, 'not_found');
    assert.ok(fs.readdirSync(h.downloads).every(name => !name.startsWith('.')));
  } finally { await h.close(); }
});

test('customer correspondence merges inbox and sent mail for the given addresses', async () => {
  const h = await harness();
  try {
    const anna = await h.service.correspondence({ addresses: 'anna@nordic-lamps.example' });
    assert.deepEqual(anna.items.map(i => [i.box, i.uid, i.subject]), [['inbox', 3, 'Re: Quotation for LED panels'], ['sent', 6, 'Quotation for LED panels']]);
    const two = await h.service.correspondence({ addresses: ['LiWei@shenzhen-parts.example', 'wanglei@shenzhen-parts.example', 'liwei@shenzhen-parts.example'] });
    assert.deepEqual(two.items.map(i => i.uid), [4, 1]); assert.deepEqual(two.addresses, ['liwei@shenzhen-parts.example', 'wanglei@shenzhen-parts.example']);
    assert.deepEqual((await h.service.correspondence({ addresses: 'purchasing@shenzhen-parts.example' })).items.map(i => i.uid), [4], 'a Cc address counts');
    assert.deepEqual((await h.service.correspondence({ addresses: 'nobody@x.example' })).items, []);
    for (const bad of ['', 'not-an-address', 'a@b.co" OR ALL "', Array.from({ length: 21 }, (_, i) => `a${i}@b.co`), undefined]) await rejects(h.service.correspondence({ addresses: bad }), 400, 'invalid_input');
    assert.ok(h.imap.state.commands.every(c => !/^(UID STORE|UID MOVE|SELECT)/.test(c)));
  } finally { await h.close(); }
});

test('sending delivers to every recipient, hides Bcc, threads replies and remembers the sender name', async () => {
  const h = await harness();
  try {
    const saved = h.service.saveDraft({ to: 'anna@nordic-lamps.example', subject: 'PI' }).draft;
    const result = await h.service.send({ to: 'Anna Berg <anna@nordic-lamps.example>; li@x.example', cc: ' "Ops, Team" <ops@x.example>', bcc: 'boss@example-trade.com, ANNA@nordic-lamps.example', subject: '形式发票 PI-1001', text: '你好\n.dot line\n\nBye', fromName: ' 销售部 Kris ',
      inReplyTo: '<q-2@nordic-lamps.example>', references: '<q-1@example-trade.com> <q-2@nordic-lamps.example>', draftId: saved.id, attachments: [{ filename: 'PI 发票.txt', contentType: 'text/plain', contentBase64: Buffer.from('hello').toString('base64') }] });
    assert.deepEqual(result.recipients, ['anna@nordic-lamps.example', 'li@x.example', 'ops@x.example', 'boss@example-trade.com']); assert.equal(result.attachmentCount, 1); assert.match(result.messageId, /^<[0-9a-f]{32}@example-trade\.com>$/);
    assert.equal(h.smtp.state.sent.length, 1);
    const sent = h.smtp.state.sent[0];
    assert.equal(sent.from, me.address); assert.deepEqual(sent.recipients, result.recipients);
    assert.deepEqual(sent.parsed.from, { name: '销售部 Kris', address: me.address }); assert.deepEqual(sent.parsed.to, [{ name: 'Anna Berg', address: 'anna@nordic-lamps.example' }, { name: '', address: 'li@x.example' }]); assert.deepEqual(sent.parsed.cc, [{ name: 'Ops, Team', address: 'ops@x.example' }]);
    assert.doesNotMatch(sent.raw.toString('latin1'), /boss@example-trade|^Bcc/im, 'Bcc recipients are not written into the message');
    assert.equal(sent.parsed.subject, '形式发票 PI-1001'); assert.equal(sent.parsed.text, '你好\n.dot line\n\nBye', 'a leading dot survives the SMTP transfer');
    assert.equal(sent.parsed.inReplyTo, '<q-2@nordic-lamps.example>'); assert.equal(sent.parsed.references, '<q-1@example-trade.com> <q-2@nordic-lamps.example>'); assert.equal(sent.parsed.messageId, result.messageId);
    assert.deepEqual(sent.parsed.attachments.map(a => [a.filename, a.contentType, a.content.toString()]), [['PI 发票.txt', 'text/plain', 'hello']]);
    assert.equal(h.account.senderName, '销售部 Kris'); assert.equal(h.account.password, SECRET); assert.equal(h.drafts.size, 0, 'the draft it was sent from is removed');
    await until(() => h.smtp.state.commands.includes('QUIT'));
    assert.deepEqual(h.smtp.state.commands.filter(c => !/^RCPT|^AUTH/.test(c)), ['EHLO lai.local', 'MAIL FROM:<sales@example-trade.com>', 'DATA', 'QUIT']);
    await h.service.send({ to: 'li@x.example', subject: 'second', text: '' });
    assert.equal(h.smtp.state.sent[1].parsed.from.name, '销售部 Kris', 'the stored sender name is reused');
    assert.equal(h.imap.state.logins, 0, 'sending does not touch the mailbox');
  } finally { await h.close(); }
});

test('forwarding re-attaches the original files unless switched off', async () => {
  const h = await harness();
  try {
    await h.service.send({ to: 'boss@example-trade.com', subject: 'Fwd: 样品', text: 'fyi', forwardOf: { box: 'inbox', uid: 4 }, attachments: [{ filename: 'note.txt', contentBase64: Buffer.from('n').toString('base64') }] });
    assert.deepEqual(h.smtp.state.sent[0].parsed.attachments.map(a => [a.filename, a.size]), [['note.txt', 1], ['装箱单 2026-10.pdf', 31], ['photo.png', sample.png.length]]);
    await h.service.send({ to: 'boss@example-trade.com', subject: 'Fwd: 样品', text: 'fyi', forwardOf: { box: 'inbox', uid: 4 }, forwardAttachments: false });
    assert.deepEqual(h.smtp.state.sent[1].parsed.attachments, []);
    await rejects(h.service.send({ to: 'boss@example-trade.com', subject: 'x', text: 'y', forwardOf: { box: 'inbox', uid: 999 } }), 404, 'not_found'); assert.equal(h.smtp.state.sent.length, 2);
    await h.service.send({ to: 'boss@example-trade.com', subject: 'x', text: 'y', forwardOf: { box: 'elsewhere', uid: 4 } });
    assert.deepEqual(h.smtp.state.sent[2].parsed.attachments, [], 'an invalid reference is ignored, not trusted');
  } finally { await h.close(); }
});

test('nothing is sent when the request is invalid', async () => {
  const h = await harness();
  try {
    const ok = { to: 'a@b.example', subject: 's', text: 't' };
    for (const [change, pattern] of [[{ to: '' }, /至少填写一位收件人/], [{ to: 'not-an-address' }, /收件人/], [{ to: 'a@b.example, broken' }, /收件人/], [{ cc: 'x y' }, /抄送/], [{ bcc: 'a@b' }, /密送/], [{ to: 'a@b.example\r\nBcc: evil@x.io' }, /收件人/],
      [{ subject: '', text: '   ' }, /主题和正文/], [{ to: Array.from({ length: 51 }, (_, i) => `r${i}@b.example`).join(',') }, /最多 50 位/], [{ attachments: [{ filename: 'a', contentBase64: 'not base64 !!' }] }, /附件内容无效/], [{ attachments: [{ filename: 'a' }] }, /附件内容无效/],
      [{ attachments: Array.from({ length: 31 }, () => ({ filename: 'a', contentBase64: 'QQ==' })) }, /30 个/]]) await rejects(h.service.send({ ...ok, ...change }), 400, 'invalid_input', pattern);
    await rejects(h.service.send({ ...ok, attachments: [{ filename: 'big.bin', contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }] }), 413, 'too_large');
    for (const bad of [undefined, null, 'text', []]) await rejects(h.service.send(bad), 400, 'invalid_input');
    assert.equal(h.smtp.state.sent.length, 0); assert.deepEqual(h.smtp.state.commands, [], 'the sending server was never contacted');
    await h.service.send({ ...ok, subject: 'a\r\nBcc: evil@x.io', fromName: 'N\r\nBcc: evil@x.io' });
    assert.deepEqual(h.smtp.state.sent[0].recipients, ['a@b.example']); assert.doesNotMatch(h.smtp.state.sent[0].raw.toString('latin1').split('\r\n\r\n')[0], /^Bcc/m);
  } finally { await h.close(); }
});

test('a refused recipient, refused login or refused message means nothing was sent and the draft is kept', async () => {
  const h = await harness({ reject: ['gone@x.example'] });
  try {
    const draft = h.service.saveDraft({ to: 'a@b.example', subject: 'keep me' }).draft;
    await rejects(h.service.send({ to: 'a@b.example, gone@x.example', subject: 's', text: 't', draftId: draft.id }), 422, 'smtp_rejected', /gone@x\.example.*没有发出/);
    assert.equal(h.smtp.state.sent.length, 0); assert.equal(h.drafts.size, 1);
    h.smtp.state.failData = '554 5.7.1 message rejected as spam';
    await rejects(h.service.send({ to: 'a@b.example', subject: 's', text: 't', draftId: draft.id }), 422, 'smtp_rejected', /没有接受这封邮件.*spam/);
    assert.equal(h.smtp.state.sent.length, 0); assert.equal(h.drafts.size, 1);
    h.account = { ...h.account, password: 'revoked-password' };
    await assert.rejects(h.service.send({ to: 'a@b.example', subject: 's', text: 't' }), error => error.status === 422 && error.code === 'auth_failed' && /发信登录失败/.test(error.message) && !/revoked-password/.test(error.message));
    await assert.rejects(h.service.list({ folder: 'inbox' }), error => error.status === 422 && error.code === 'auth_failed' && /重新验证/.test(error.message) && !/revoked-password/.test(error.message));
  } finally { await h.close(); }
});

test('every operation needs a bound mailbox, and server failures are reported, not swallowed', async () => {
  const h = await harness({ unbound: true });
  try {
    for (const run of [() => h.service.list({ folder: 'inbox' }), () => h.service.read({ box: 'inbox', uid: 1 }), () => h.service.flags({ box: 'inbox', uid: 1, seen: true }), () => h.service.trash({ box: 'inbox', uid: 1 }), () => h.service.saveAttachment({ box: 'inbox', uid: 1, index: 0 }), () => h.service.correspondence({ addresses: 'a@b.co' })])
      await rejects(run(), 409, 'not_bound');
    await assert.rejects(async () => h.service.send({ to: 'a@b.example', subject: 's', text: 't' }), error => error.status === 409 && error.code === 'not_bound');
    assert.equal(h.imap.state.logins, 0);
    h.account = { provider: 'zoho', email: me.address, password: SECRET, site: 'cn', accountType: 'organization' };
    h.imap.state.failNext = { verb: 'UID SEARCH', reply: 'NO [UNAVAILABLE] try later\u0007' };
    await rejects(h.service.list({ folder: 'inbox' }), 502, 'imap_no', /try later/);
    h.imap.state.failNext = { verb: 'UID STORE', reply: 'NO read-only' };
    await rejects(h.service.flags({ box: 'inbox', uid: 1, seen: false }), 502, 'imap_no');
    assert.equal((await h.service.list({ folder: 'inbox' })).total, 5, 'the next request works again');
  } finally { await h.close(); }
  const flagged = await harness({ sentName: 'Outbox Archive', mailboxes: { INBOX: sample.mailboxes(me).INBOX } });
  try { assert.equal((await flagged.service.list({ folder: 'sent' })).total, 0, 'an oddly named sent folder is found by its server flag'); } finally { await flagged.close(); }
  const named = await harness({ specialUse: false, trashName: 'deleted items' });
  try { assert.equal((await named.service.list({ folder: 'sent' })).total, 1); await named.service.trash({ box: 'inbox', uid: 1 }); assert.equal(named.box('deleted items').length, 1, 'folders without flags are found by common names'); } finally { await named.close(); }
  const missing = await harness({ specialUse: false, sentName: 'Outbox Archive', mailboxes: { INBOX: sample.mailboxes(me).INBOX } });
  try { await rejects(missing.service.list({ folder: 'sent' }), 502, 'protocol', /已发送/); assert.equal((await missing.service.correspondence({ addresses: 'anna@nordic-lamps.example' })).items.length, 1, 'correspondence still shows received mail'); }
  finally { await missing.close(); }
});

test('local drafts are created, updated, listed newest first and deleted', async () => {
  const h = await harness();
  try {
    assert.deepEqual(h.service.drafts(), { ok: true, items: [] });
    const first = h.service.saveDraft({ to: 'a@b.example\r\nX: y', cc: '', subject: 'One\nTwo', text: 'body\u0000 text', inReplyTo: '<m@x>', forwardOf: { box: 'inbox', uid: '4' }, password: 'nope', extra: 1 }).draft;
    assert.match(first.id, /^[0-9a-f]{32}$/);
    assert.deepEqual(first, { id: first.id, to: 'a@b.example X: y', cc: '', bcc: '', subject: 'One Two', text: 'body text', inReplyTo: '<m@x>', references: '', forwardOf: { box: 'inbox', uid: 4 }, updatedAt: '2026-10-06T10:00:00.000Z' });
    const second = h.service.saveDraft({ subject: 'Second' }).draft;
    const updated = h.service.saveDraft({ id: first.id, subject: 'One (edited)' }).draft;
    assert.equal(updated.id, first.id); assert.deepEqual(h.service.drafts().items.map(d => d.subject), ['One (edited)', 'Second']);
    assert.notEqual(h.service.saveDraft({ id: '../../etc', subject: 'x' }).draft.id, '../../etc');
    assert.deepEqual(h.service.deleteDraft({ id: second.id }), { ok: true }); assert.equal(h.service.drafts().items.some(d => d.id === second.id), false);
    for (const bad of [{}, { id: 'x' }, undefined, { id: first.id.toUpperCase() }]) assert.throws(() => h.service.deleteDraft(bad), error => error.status === 400);
    assert.equal(h.imap.state.logins + h.smtp.state.commands.length, 0, 'drafts never leave this computer');
  } finally { await h.close(); }
});

test('sending servers are fixed per site and account type', () => {
  const server = (email, site, accountType) => smtpClient.resolveServer({ email, site, accountType });
  assert.deepEqual(server('a@zoho.com.cn', 'cn', 'auto'), { host: 'smtp.zoho.com.cn', port: 465 }); assert.deepEqual(server('a@corp.example', 'cn', 'auto'), { host: 'smtppro.zoho.com.cn', port: 465 });
  assert.deepEqual(server('a@zoho.com', 'com', 'auto'), { host: 'smtp.zoho.com', port: 465 }); assert.deepEqual(server('a@corp.example', 'com', 'organization'), { host: 'smtppro.zoho.com', port: 465 });
  assert.throws(() => server('a@corp.example', 'evil.example', 'auto'), { code: 'invalid_input' });
  const source = fs.readFileSync(require.resolve('../backend/mail-smtp.js'), 'utf8') + fs.readFileSync(require.resolve('../backend/mail-client.js'), 'utf8') + fs.readFileSync(require.resolve('../backend/mail-service.js'), 'utf8');
  assert.doesNotMatch(source, /rejectUnauthorized|checkServerIdentity|console\./); assert.equal((source.match(/tls\.connect\(\{ host: server\.host, port: server\.port, servername: server\.host, minVersion: 'TLSv1\.2' \}\)/g) || []).length, 2);
});

test('message lines that start with a dot cross the sending connection unchanged', async () => {
  const smtp = await fake.startSmtp({ user: me.address });
  try {
    const raw = Buffer.from('Subject: dots\r\n\r\n.\r\n..two\r\n.leading\r\nplain\r\n');
    const result = await smtpClient.send({ account: { email: me.address, password: SECRET, site: 'cn', accountType: 'organization' }, from: me.address, recipients: ['A@B.example'], raw }, { connect: smtp.connect });
    assert.deepEqual(result, { accepted: ['a@b.example'] }); assert.equal(smtp.state.sent.length, 1, 'a lone dot does not end the message early');
    assert.equal(smtp.state.sent[0].raw.toString(), raw.toString());
    assert.throws(() => smtpClient.send({ account: { email: me.address, password: SECRET, site: 'cn' }, from: me.address, recipients: [], raw }, { connect: smtp.connect }), { code: 'invalid_input' });
    assert.throws(() => smtpClient.send({ account: { email: me.address, password: SECRET, site: 'cn' }, from: me.address, recipients: ['a@b.example>\r\nRCPT TO:<evil@x.io'], raw }, { connect: smtp.connect }), { code: 'invalid_input' });
  } finally { await smtp.close(); }
});
