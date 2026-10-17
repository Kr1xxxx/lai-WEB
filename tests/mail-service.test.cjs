const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fake = require('./fixtures/fake-mail-servers.cjs');
const sample = require('./fixtures/mail-sample.cjs');
const { createMailService } = require('../backend/mail-service.js');
const smtpClient = require('../backend/mail-smtp.js');
const mime = require('../backend/mail-mime.js');
const imapClient = require('../backend/mail-imap.js');

// 邮件服务对接本机假 IMAP／SMTP 服务器；存储用内存替身。不连接任何真实邮箱。
const me = { name: '', address: 'sales@example-trade.com' };
const SECRET = 'app-password-1';
async function harness(options = {}) {
  const imap = await fake.startImap({ specialUse: options.specialUse, mailboxes: options.mailboxes || sample.mailboxes(me), supportsMove: options.supportsMove !== false, password: options.serverPassword || SECRET, sentName: options.sentName, trashName: options.trashName });
  const smtp = await fake.startSmtp({ reject: options.reject || [], password: options.serverPassword || SECRET, user: me.address });
  let account = options.unbound ? null : { provider: 'zoho', email: me.address, password: SECRET, site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993 };
  const drafts = new Map(); let clock = 0; const revealed = [];
  const draftFiles = new Map(), templates = new Map();
  const store = { listMailBulk: () => [], readMailBulk: () => null, writeMailBulk() {}, readMailAccount: () => account, writeMailAccount: (next) => { account = next; }, listMailDrafts: () => [...drafts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), writeMailDraft: (draft, files) => { drafts.set(draft.id, draft); if (files !== undefined) { if (files.length) draftFiles.set(draft.id, files); else draftFiles.delete(draft.id); } }, deleteMailDraft: (id) => { drafts.delete(id); draftFiles.delete(id); },
    readMailDraftFiles: id => draftFiles.get(id) || [], writeMailDraftFiles: (id, files) => { if (files.length) draftFiles.set(id, files); else draftFiles.delete(id); },
    listMailTemplates: () => [...templates.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), writeMailTemplate: t => templates.set(t.id, t), deleteMailTemplate: id => templates.delete(id) };
  const downloads = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-dl-'));
  let ticks = 0;
  const service = createMailService({ store, endpoints: { imap: imap.endpoint, smtp: smtp.endpoint }, now: () => new Date(Date.UTC(2026, 9, 6, 10, 0, clock++)), downloadsDir: downloads, reveal: file => revealed.push(file), keepAliveMs: options.keepAliveMs || 0, staleCheckMs: options.staleCheckMs ?? 20000, ...(options.operationTimeoutMs ? { operationTimeoutMs: options.operationTimeoutMs } : {}), clock: () => ticks });
  const sentMail = index => mime.parseMessage(smtp.state.sent.at(index).raw);
  return { imap, smtp, service, drafts, draftFiles, templates, downloads, revealed, sentMail, get account() { return account; }, set account(value) { account = value; }, advance(ms) { ticks += ms; },
    box: name => imap.state.boxes.get(name).messages,
    async close() { await service.shutdown(); await imap.close(); await smtp.close(); fs.rmSync(downloads, { recursive: true, force: true }); } };
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
    assert.ok(h.imap.state.commands.some(c => /^UID SEARCH .*样品/.test(c)), 'the non-ASCII term reaches the server intact');
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
    assert.match(message.accountIdentity, /^[0-9a-f]{64}$/); assert.equal(message.accountIdentity, imapClient.accountIdentity(h.account), 'the message says which mailbox it came from');
    assert.deepEqual({ ...message, text: undefined, accountIdentity: undefined }, { box: 'inbox', uid: 4, accountIdentity: undefined, from: { name: '李伟', address: 'liwei@shenzhen-parts.example' }, to: [me], cc: [{ name: '', address: 'purchasing@shenzhen-parts.example' }], replyTo: [], subject: '样品寄送确认 — 10月批次', date: '2026-10-06T02:10:00.000Z', messageId: '<s-9@shenzhen-parts.example>', inReplyTo: '', references: '', text: undefined, html: '',
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
      assert.equal(h.imap.state.commands.some(c => /^(UID )?EXPUNGE/.test(c)), !supportsMove);
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
    assert.deepEqual(result.recipients, ['anna@nordic-lamps.example', 'li@x.example', 'ops@x.example', 'boss@example-trade.com']); assert.equal(result.attachmentCount, 1); assert.match(result.messageId, /^<[^<>@\s]+@example-trade\.com>$/);
    assert.equal(h.smtp.state.sent.length, 1);
    const sent = h.smtp.state.sent[0], mail = await h.sentMail(0);
    assert.equal(sent.from, me.address); assert.deepEqual(sent.recipients, result.recipients); assert.deepEqual(result.rejected, []);
    assert.deepEqual(mail.from, { name: '销售部 Kris', address: me.address }); assert.deepEqual(mail.to, [{ name: 'Anna Berg', address: 'anna@nordic-lamps.example' }, { name: '', address: 'li@x.example' }]); assert.deepEqual(mail.cc, [{ name: 'Ops, Team', address: 'ops@x.example' }]);
    assert.doesNotMatch(sent.raw.toString('latin1'), /boss@example-trade|^Bcc/im, 'Bcc recipients are not written into the message');
    assert.equal(mail.subject, '形式发票 PI-1001'); assert.equal(mail.text.trimEnd(), '你好\n.dot line\n\nBye', 'a leading dot survives the SMTP transfer');
    assert.equal(mail.inReplyTo, '<q-2@nordic-lamps.example>'); assert.equal(mail.references, '<q-1@example-trade.com> <q-2@nordic-lamps.example>'); assert.equal(mail.messageId, result.messageId);
    assert.deepEqual(mail.attachments.map(a => [a.filename, a.contentType, a.content.toString()]), [['PI 发票.txt', 'text/plain', 'hello']]);
    assert.equal(h.account.senderName, '销售部 Kris'); assert.equal(h.account.password, SECRET); assert.equal(h.drafts.size, 0, 'the draft it was sent from is removed');
    await until(() => h.smtp.state.commands.includes('QUIT'));
    assert.deepEqual(h.smtp.state.commands.filter(c => !/^RCPT|^AUTH|^QUIT|^EHLO/.test(c)).map(c => c.split(' ').slice(0, 2).join(' ')), ['MAIL FROM:<sales@example-trade.com>', 'DATA']); assert.ok(h.smtp.state.commands.includes('AUTH LOGIN ***'));
    await h.service.send({ to: 'li@x.example', subject: 'second', text: '' });
    assert.equal((await h.sentMail(1)).from.name, '销售部 Kris', 'the stored sender name is reused');
    assert.equal(h.imap.state.logins, 0, 'sending does not touch the mailbox');
  } finally { await h.close(); }
});

test('forwarding re-attaches the original files only when asked and only from the same mailbox', async () => {
  const h = await harness();
  try {
    const { accountIdentity } = (await h.service.read({ box: 'inbox', uid: 4 })).message;
    const forwardOf = { box: 'inbox', uid: 4, accountIdentity };
    await h.service.send({ to: 'boss@example-trade.com', subject: 'Fwd: 样品', text: 'fyi', forwardOf, forwardAttachments: true, attachments: [{ filename: 'note.txt', contentBase64: Buffer.from('n').toString('base64') }] });
    assert.deepEqual((await h.sentMail(0)).attachments.map(a => [a.filename, a.size]), [['note.txt', 1], ['装箱单 2026-10.pdf', 31], ['photo.png', sample.png.length]]);
    await h.service.send({ to: 'boss@example-trade.com', subject: 'Fwd: 样品', text: 'fyi', forwardOf, forwardAttachments: false });
    assert.deepEqual((await h.sentMail(1)).attachments, []);
    await h.service.send({ to: 'boss@example-trade.com', subject: 'Fwd: 样品', text: 'fyi', forwardOf });
    assert.deepEqual((await h.sentMail(2)).attachments, [], 'without an explicit yes the original files stay out');
    await rejects(h.service.send({ to: 'boss@example-trade.com', subject: 'x', text: 'y', forwardOf: { ...forwardOf, uid: 999 }, forwardAttachments: true }), 404, 'not_found'); assert.equal(h.smtp.state.sent.length, 3);
    await h.service.send({ to: 'boss@example-trade.com', subject: 'x', text: 'y', forwardOf: { box: 'elsewhere', uid: 4 }, forwardAttachments: true });
    assert.deepEqual((await h.sentMail(3)).attachments, [], 'an invalid reference is ignored, not trusted');
    // 来源不明（旧草稿）或属于别的邮箱：拒绝发送，不会把别的邮箱的附件发出去。
    await rejects(h.service.send({ to: 'boss@example-trade.com', subject: 'x', text: 'y', forwardOf: { box: 'inbox', uid: 4 }, forwardAttachments: true }), 409, 'forward_source_changed', /别的邮箱/);
    await rejects(h.service.send({ to: 'boss@example-trade.com', subject: 'x', text: 'y', forwardOf: { ...forwardOf, accountIdentity: 'a'.repeat(64) }, forwardAttachments: true }), 409, 'forward_source_changed');
    assert.equal(h.smtp.state.sent.length, 4);
  } finally { await h.close(); }
});

test('a forwarded draft keeps its source mailbox, its choice and the file count; another mailbox cannot use it', async () => {
  const h = await harness();
  try {
    const { accountIdentity } = (await h.service.read({ box: 'inbox', uid: 4 })).message;
    const saved = h.service.saveDraft({ to: 'boss@example-trade.com', subject: 'Fwd: 样品', text: 'fyi', forwardOf: { box: 'inbox', uid: 4, accountIdentity }, forwardAttachments: true, forwardCount: 2 }).draft;
    assert.deepEqual([saved.forwardOf, saved.forwardAttachments, saved.forwardCount], [{ box: 'inbox', uid: 4, accountIdentity }, true, 2]);
    let opened = h.service.getDraft({ id: saved.id }).draft;
    assert.deepEqual([opened.forwardAttachments, opened.forwardCount, opened.sourceUnavailable], [true, 2, false]);
    await h.service.send({ ...opened, draftId: saved.id }); await h.smtp.state.parsing;
    assert.equal((await h.sentMail(0)).attachments.length, 2);
    const again = h.service.saveDraft({ to: 'boss@example-trade.com', subject: 'Fwd again', text: 'fyi', forwardOf: { box: 'inbox', uid: 4, accountIdentity }, forwardAttachments: true, forwardCount: 2 }).draft;
    h.account = { ...h.account, email: 'other@example-trade.com' };
    opened = h.service.getDraft({ id: again.id }).draft;
    assert.deepEqual([opened.forwardAttachments, opened.forwardCount, opened.sourceUnavailable], [false, 2, true]);
    await rejects(h.service.send({ ...opened, forwardAttachments: true }), 409, 'forward_source_changed');
    assert.equal(h.smtp.state.sent.length, 1, 'nothing left for the other mailbox');
  } finally { await h.close(); }
});

test('attachments that are programs are not saved to Downloads', async () => {
  const mailboxes = { INBOX: [{ message: { from: { name: '', address: 'x@x.example' }, to: [me], subject: 'Run me', date: '2026-10-01T00:00:00Z', text: 'x', attachments: [{ filename: 'invoice.PDF.exe', contentType: 'application/octet-stream', content: Buffer.from('MZ') }, { filename: 'setup.sh', contentType: 'text/plain', content: Buffer.from('echo') }, { filename: 'ok.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }] }, flags: [] }] };
  const h = await harness({ mailboxes });
  try {
    await h.service.read({ box: 'inbox', uid: 1 });
    await rejects(h.service.saveAttachment({ box: 'inbox', uid: 1, index: 0 }), 400, 'blocked_type', /可执行文件/);
    await rejects(h.service.saveAttachment({ box: 'inbox', uid: 1, index: 1 }), 400, 'blocked_type');
    assert.deepEqual(fs.readdirSync(h.downloads), [], 'nothing was written');
    assert.equal((await h.service.saveAttachment({ box: 'inbox', uid: 1, index: 2 })).filename, 'ok.pdf');
  } finally { await h.close(); }
});

test('oversize text or html is refused with 413 instead of being cut short', async () => {
  const h = await harness();
  try {
    await rejects(h.service.send({ to: 'boss@example-trade.com', subject: 'S', text: 'x'.repeat(1024 * 1024 + 1) }), 413, 'too_large', /1 MB/);
    await rejects(h.service.send({ to: 'boss@example-trade.com', subject: 'S', html: '中'.repeat(800000) }), 413, 'too_large', /2 MB/);
    assert.throws(() => h.service.saveDraft({ subject: 'S', html: '中'.repeat(800000) }), e => e.status === 413);
    assert.throws(() => h.service.saveTemplate({ name: 'T', text: 'x'.repeat(1024 * 1024 + 1) }), e => e.status === 413);
    assert.equal(h.drafts.size, 0); assert.equal(h.templates.size, 0); assert.equal(h.smtp.state.sent.length, 0);
    const exact = h.service.saveDraft({ subject: 'S', text: 'x'.repeat(1024 * 1024) }).draft;
    assert.equal(exact.text.length, 1024 * 1024, 'exactly 1 MB is kept whole');
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

test('refused recipients, a refused login and a refused message are each reported truthfully and the draft is kept', async () => {
  const h = await harness({ reject: ['gone@x.example', 'also-gone@x.example'] });
  try {
    const draft = h.service.saveDraft({ to: 'a@b.example', subject: 'keep me' }).draft;
    await rejects(h.service.send({ to: 'gone@x.example', cc: 'also-gone@x.example', subject: 's', text: 't', draftId: draft.id }), 422, 'smtp_rejected', /gone@x\.example.*邮件没有发出/);
    assert.equal(h.smtp.state.sent.length, 0); assert.equal(h.drafts.size, 1, 'nothing went out, so the draft stays');
    const partial = await h.service.send({ to: 'a@b.example, gone@x.example', subject: 's', text: 't' });
    assert.deepEqual([partial.recipients, partial.rejected], [['a@b.example'], ['gone@x.example']], 'the server took the message for the accepted address and the refused one is reported');
    assert.equal(h.smtp.state.sent.length, 1); assert.deepEqual(h.smtp.state.sent[0].recipients, ['a@b.example']);
    h.smtp.state.failData = '554 5.7.1 message rejected as spam';
    await rejects(h.service.send({ to: 'a@b.example', subject: 's', text: 't', draftId: draft.id }), 422, 'smtp_rejected', /没有接受这封邮件.*spam/);
    assert.equal(h.smtp.state.sent.length, 1); assert.equal(h.drafts.size, 1);
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
    await rejects(h.service.list({ folder: 'inbox' }), 502, 'imap_no', /没有完成「搜索」/);   // not shown as an empty folder
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
    assert.deepEqual(first, { id: first.id, to: 'a@b.example X: y', cc: '', bcc: '', subject: 'One Two', text: 'body text', html: '', inReplyTo: '<m@x>', references: '', forwardOf: { box: 'inbox', uid: 4, accountIdentity: '' }, forwardAttachments: false, forwardCount: 0, updatedAt: '2026-10-06T10:00:00.000Z', attachments: [] });
    const second = h.service.saveDraft({ subject: 'Second' }).draft;
    const updated = h.service.saveDraft({ id: first.id, subject: 'One (edited)' }).draft;
    assert.equal(updated.id, first.id); assert.deepEqual(h.service.drafts().items.map(d => d.subject), ['One (edited)', 'Second']);
    assert.notEqual(h.service.saveDraft({ id: '../../etc', subject: 'x' }).draft.id, '../../etc');
    assert.deepEqual(h.service.deleteDraft({ id: second.id }), { ok: true }); assert.equal(h.service.drafts().items.some(d => d.id === second.id), false);
    for (const bad of [{}, { id: 'x' }, undefined, { id: first.id.toUpperCase() }]) assert.throws(() => h.service.deleteDraft(bad), error => error.status === 400);
    assert.equal(h.imap.state.logins + h.smtp.state.commands.length, 0, 'drafts never leave this computer');
  } finally { await h.close(); }
});

test('a send that finishes after the data was replaced (restore) does not write a bare or foreign account row', async () => {
  const h = await harness();
  try {
    // The account disappears while the message is on its way (a restored backup without a mail account).
    const sending = h.service.send({ to: 'li@x.example', subject: 'during restore', text: 'x', fromName: 'Kris' });
    h.account = null;
    assert.equal((await sending).recipients.length, 1);
    assert.equal(h.account, null, 'no account row made of only a sender name');
    // The account is swapped for another mailbox while sending: the other account keeps its own sender name.
    h.account = { provider: 'zoho', email: me.address, password: SECRET, site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993 };
    const second = h.service.send({ to: 'li@x.example', subject: 'during restore 2', text: 'x', fromName: 'Kris' });
    const other = { provider: 'zoho', email: 'other@example-trade.com', password: 'other', site: 'cn', accountType: 'organization', senderName: 'Other' };
    h.account = other;
    await second;
    assert.deepEqual(h.account, other);
  } finally { await h.close(); }
});

test('sending servers are fixed per site and account type', () => {
  const server = (email, site, accountType) => smtpClient.resolveServer({ email, site, accountType });
  assert.deepEqual(server('a@zoho.com.cn', 'cn', 'auto'), { host: 'smtp.zoho.com.cn', port: 465 }); assert.deepEqual(server('a@corp.example', 'cn', 'auto'), { host: 'smtppro.zoho.com.cn', port: 465 });
  assert.deepEqual(server('a@zoho.com', 'com', 'auto'), { host: 'smtp.zoho.com', port: 465 }); assert.deepEqual(server('a@corp.example', 'com', 'organization'), { host: 'smtppro.zoho.com', port: 465 });
  assert.throws(() => server('a@corp.example', 'evil.example', 'auto'), { code: 'invalid_input' });
});

test('rich text is sent as html with a text alternative; pasted images become inline attachments; dots survive', async () => {
  const h = await harness();
  try {
    const png = sample.png.toString('base64');
    await h.service.send({ to: 'a@b.example', subject: 'rich', text: '', html: `<div style="font-size:14px"><p>Hi <b>Anna</b></p><p>.leading dot</p><p>..two</p><img alt="shot" src="data:image/png;base64,${png}"><img src="https://remote.example/x.png"></div>` });
    const mail = await h.sentMail(0);
    assert.match(mail.html, /<p>Hi <b>Anna<\/b><\/p><p>\.leading dot<\/p><p>\.\.two<\/p><img alt="shot" src="cid:img1\.[0-9a-f]+@lai"><img src="https:\/\/remote\.example\/x\.png">/);
    assert.equal(mail.text.trim(), 'Hi Anna\n.leading dot\n..two', 'a readable text version is derived from the html');
    assert.deepEqual(mail.attachments.map(a => [a.filename, a.contentType, a.inline, a.content.equals(sample.png)]), [['image-1.png', 'image/png', true, true]]); assert.match(mail.html, new RegExp('cid:' + mail.attachments[0].contentId.replace(/\./g, '\\.')));
    await h.service.send({ to: 'a@b.example', subject: 'plain', text: '.\n..two\n.leading\nplain' });
    const plain = await h.sentMail(1);
    assert.equal(plain.text.trimEnd(), '.\n..two\n.leading\nplain', 'a lone dot does not end the message early'); assert.equal(plain.html, '');
    await h.service.send({ to: 'a@b.example', subject: 'both', text: 'my own text', html: '<p>html</p>' });
    assert.equal((await h.sentMail(2)).text.trim(), 'my own text');
    await rejects(h.service.send({ to: 'a@b.example', subject: '', text: ' ', html: '<div><br></div>' }), 400, 'invalid_input', /主题和正文/);
    await assert.rejects(smtpClient.send({ account: { email: me.address, password: 'x\r\ny', site: 'cn' }, mail: { from: me, to: [me] } }, { endpoint: h.smtp.endpoint }), { code: 'invalid_input' });
  } finally { await h.close(); }
});

test('bulk mail sends one personalised message per recipient and records each result', async () => {
  const smtp = await fake.startSmtp({ user: me.address, reject: ['gone@x.example'] });
  const batches = new Map(); let account = { provider: 'zoho', email: me.address, password: SECRET, site: 'cn', accountType: 'organization', senderName: 'Kris' }; let clock = 0;
  const store = { readMailAccount: () => account, writeMailAccount: (next) => { account = next; }, listMailDrafts: () => [], writeMailDraft() {}, deleteMailDraft() {},
    listMailBulk: () => [...batches.values()].map(b => JSON.parse(b)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), readMailBulk: id => batches.has(id) ? JSON.parse(batches.get(id)) : null, writeMailBulk: batch => batches.set(batch.id, JSON.stringify(batch)) };
  const make = () => createMailService({ store, endpoints: { smtp: smtp.endpoint }, now: () => new Date(Date.UTC(2026, 9, 6, 10, 0, clock++)), bulkPauseMs: 0 });
  let service = make();
  try {
    assert.deepEqual(service.bulkList(), { ok: true, items: [] });
    const ok = { subject: '{{公司}} 新品目录', text: 'Hi {{ 姓名 }},\n\n给{{公司}}的目录。', recipients: [{ address: 'Anna@Nordic-Lamps.example', name: 'Anna Berg', customer: 'Nordic Lamps AB' }, { address: 'gone@x.example', name: '', customer: 'Gone Co' }, { address: 'anna@nordic-lamps.example', name: 'dup', customer: 'dup' }, { address: 'li@shenzhen.example', name: '', customer: '' }],
      attachments: [{ filename: '目录.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }] };
    for (const [change, pattern] of [[{ recipients: [] }, /至少选择一位/], [{ recipients: [{ address: 'nope' }] }, /不是有效的邮箱地址/], [{ recipients: [null] }, /不是有效的邮箱地址/], [{ subject: ' ' }, /请填写主题/], [{ text: '\n ' }, /请填写正文/],
      [{ recipients: Array.from({ length: 201 }, (_, i) => ({ address: `r${i}@x.example` })) }, /最多 200 位/], [{ attachments: [{ filename: 'a', contentBase64: '!!' }] }, /附件内容无效/]])
      assert.throws(() => service.bulkStart({ ...ok, ...change }), error => error.status === 400 && pattern.test(error.message), String(pattern));
    assert.equal(smtp.state.sent.length, 0); assert.equal(batches.size, 0, 'a refused request leaves no batch behind');
    const started = service.bulkStart(ok);
    assert.match(started.batch.id, /^[0-9a-f]{32}$/); assert.match(started.batch.createdAt, /^2026-10-06T10:00:\d\d\.000Z$/);
    assert.deepEqual({ ...started.batch, id: undefined, createdAt: undefined }, { id: undefined, createdAt: undefined, finishedAt: '', subject: '{{公司}} 新品目录', status: 'sending', stopReason: '', total: 3, sent: 0, failed: 0, pending: 3, uncertain: 0, skipped: 0 });
    assert.throws(() => service.bulkStart(ok), error => error.status === 409 && error.code === 'busy');
    await service.bulkIdle();
    const done = service.bulkGet({ id: started.batch.id }).batch;
    assert.deepEqual([done.status, done.total, done.sent, done.failed, done.pending, done.skipped, done.stopReason], ['done', 3, 2, 1, 0, 0, '']); assert.deepEqual(done.attachmentNames, ['目录.pdf']); assert.ok(done.finishedAt);
    assert.deepEqual(done.items.map(i => [i.address, i.status]), [['anna@nordic-lamps.example', 'sent'], ['gone@x.example', 'failed'], ['li@shenzhen.example', 'sent']]); assert.match(done.items[1].error, /gone@x\.example 被发信服务器拒绝/);
    const mails = await Promise.all(smtp.state.sent.map(async m => { const mail = await mime.parseMessage(m.raw); return [m.recipients, mail.to, mail.subject, mail.text.trimEnd(), mail.from.name, mail.attachments.map(a => a.filename)]; }));
    assert.deepEqual(mails, [
      [['anna@nordic-lamps.example'], [{ name: 'Anna Berg', address: 'anna@nordic-lamps.example' }], 'Nordic Lamps AB 新品目录', 'Hi Anna Berg,\n\n给Nordic Lamps AB的目录。', 'Kris', ['目录.pdf']],
      [['li@shenzhen.example'], [{ name: '', address: 'li@shenzhen.example' }], '新品目录', 'Hi ,\n\n给的目录。', 'Kris', ['目录.pdf']]], 'each recipient gets their own message and sees nobody else');
    const rich = service.bulkStart({ subject: 'Hi', text: '', html: '<p>Dear {{姓名}} at <b>{{公司}}</b></p>', recipients: [{ address: 'q@x.example', name: 'A <b>&"B"', customer: 'C & <i>Co</i>' }] }); await service.bulkIdle();
    const richMail = await mime.parseMessage(smtp.state.sent.at(-1).raw);
    assert.equal(richMail.html.trim(), '<p>Dear A &lt;b&gt;&amp;&quot;B&quot; at <b>C &amp; &lt;i&gt;Co&lt;/i&gt;</b></p>', 'names are escaped when placed into html'); assert.equal(richMail.text.trim(), 'Dear A <b>&"B" at C & <i>Co</i>');
    assert.equal(service.bulkGet({ id: rich.batch.id }).batch.text, 'Dear {{姓名}} at {{公司}}');
    assert.throws(() => service.bulkStart({ subject: 's', text: '', html: '<div><br></div>', recipients: [{ address: 'q@x.example' }] }), error => error.status === 400 && /请填写正文/.test(error.message));
    assert.equal(service.bulkList().items.at(-1).sent, 2); assert.equal(service.bulkList().items[0].text, undefined, 'the list carries no message bodies');
    for (const bad of [{}, { id: 'x' }, { id: 'f'.repeat(32) }, undefined]) assert.throws(() => service.bulkGet(bad), error => error.status === 404);
    assert.doesNotMatch([...batches.values()].join(''), new RegExp(SECRET));
  } finally { await smtp.close(); }
});

test('bulk mail stops on a login failure or repeated failures, can be cancelled, and never resumes by itself', async () => {
  const recipients = Array.from({ length: 8 }, (_, i) => ({ address: `r${i}@x.example`, name: '', customer: `C${i}` }));
  const setup = async (options) => {
    const smtp = await fake.startSmtp({ user: me.address, ...options });
    const batches = new Map(); let account = { provider: 'zoho', email: me.address, password: options.password ? 'stale' : SECRET, site: 'cn', accountType: 'organization' };
    const store = { readMailAccount: () => account, writeMailAccount() {}, listMailBulk: () => [...batches.values()].map(b => JSON.parse(b)), readMailBulk: id => batches.has(id) ? JSON.parse(batches.get(id)) : null, writeMailBulk: batch => batches.set(batch.id, JSON.stringify(batch)) };
    const make = (pause = 0) => createMailService({ store, endpoints: { smtp: smtp.endpoint }, bulkPauseMs: pause });
    return { smtp, batches, make };
  };
  const auth = await setup({ password: 'something-else' });
  try {
    const service = auth.make(); const { batch } = service.bulkStart({ subject: 's', text: 't', recipients }); await service.bulkIdle();
    const result = service.bulkGet({ id: batch.id }).batch;
    assert.deepEqual([result.status, result.sent, result.failed, result.skipped, result.stopReason], ['stopped', 0, 1, 7, '发信登录失败，已停止']); assert.equal(result.items[1].error, '发信登录失败，已停止'); assert.doesNotMatch(JSON.stringify(result), /stale/);
  } finally { await auth.smtp.close(); }
  const streak = await setup({ reject: recipients.slice(1, 7).map(r => r.address) });
  try {
    const service = streak.make(); const { batch } = service.bulkStart({ subject: 's', text: 't', recipients }); await service.bulkIdle();
    const result = service.bulkGet({ id: batch.id }).batch;
    assert.deepEqual([result.status, result.sent, result.failed, result.skipped, result.stopReason], ['stopped', 1, 5, 2, '连续 5 封发送失败，已停止']); assert.equal(streak.smtp.state.sent.length, 1);
  } finally { await streak.smtp.close(); }
  const cancel = await setup({});
  try {
    const service = cancel.make(40); const { batch } = service.bulkStart({ subject: 's', text: 't', recipients });
    for (let i = 0; i < 400 && cancel.smtp.state.sent.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(service.bulkGet({ id: batch.id }).batch.status, 'sending');
    assert.deepEqual(service.bulkCancel({ id: 'not-this-one' }), { ok: true }); assert.deepEqual(service.bulkCancel({ id: batch.id }), { ok: true }); await service.bulkIdle();
    const result = service.bulkGet({ id: batch.id }).batch;
    assert.equal(result.status, 'cancelled'); assert.equal(result.stopReason, '已手动停止'); assert.ok(result.sent >= 1 && result.sent < 8); assert.equal(result.sent + result.skipped, 8); assert.equal(cancel.smtp.state.sent.length, result.sent);
    // 模拟应用在发送途中关闭：库里留着一批「发送中」，新启动的服务不续发，只标为中断。
    // 旧版本留下的批次没有「发送中」记号：第一封待发的可能正在发，标为待核对，后面的标为没有发送。
    const stale = { id: 'e'.repeat(32), createdAt: '2026-10-06T08:00:00.000Z', finishedAt: '', subject: 'half', text: 't', status: 'sending', stopReason: '', items: [{ address: 'a@x.example', name: '', customer: '', status: 'sent', error: '' }, { address: 'b@x.example', name: '', customer: '', status: 'pending', error: '' }, { address: 'c@x.example', name: '', customer: '', status: 'pending', error: '' }] };
    cancel.batches.set(stale.id, JSON.stringify(stale));
    // 新版本的批次：记着「发送中」的那封是待核对，「待发送」的确实没有发。
    const marked = { ...stale, checkpointVersion: 1, id: 'd'.repeat(32), items: [{ ...stale.items[0] }, { ...stale.items[1], status: 'sending' }, { ...stale.items[2] }] };
    cancel.batches.set(marked.id, JSON.stringify(marked));
    const restarted = cancel.make(); const before = cancel.smtp.state.sent.length;
    for (const id of [stale.id, marked.id]) {
      const listed = restarted.bulkList().items.find(item => item.id === id);
      assert.deepEqual([listed.status, listed.sent, listed.uncertain, listed.skipped, listed.pending], ['interrupted', 1, 1, 1, 0]); assert.match(listed.stopReason, /核对/);
      const items = restarted.bulkGet({ id }).batch.items;
      assert.deepEqual(items.map(i => i.status), ['sent', 'uncertain', 'skipped']); assert.match(items[1].error, /核对/); assert.match(items[2].error, /没有发送/);
      assert.equal(JSON.parse(cancel.batches.get(id)).status, 'interrupted');
    }
    await restarted.bulkIdle(); assert.equal(cancel.smtp.state.sent.length, before, 'nothing is re-sent');
  } finally { await cancel.smtp.close(); }
});

test('lists carry a short decoded preview of each body, without downloading whole messages or marking them read', async () => {
  const h = await harness();
  try {
    const inbox = await h.service.list({ folder: 'inbox' });
    assert.deepEqual(inbox.items.map(i => i.snippet), ['Nothing new this week.', '您好， 样品已于今天寄出，附件是装箱单。 李伟', 'Hi, The price works for us. Please send the proforma invoice. Anna', 'Cover draft:', '你好，报价如下']);
    const fetches = h.imap.state.commands.filter(c => c.startsWith('UID FETCH'));
    assert.ok(fetches.every(c => /BODY\.PEEK\[TEXT\]<0\.4096>/.test(c) && !/BODY(\.PEEK)?\[\]/.test(c)), 'only the first bytes of each body are requested, with PEEK');
    assert.deepEqual((await h.service.list({ folder: 'unread' })).items.map(i => i.uid), [5, 4, 3], 'reading previews leaves unread mail unread');
    // 服务器拒绝取正文开头时，列表照常显示，只是没有预览。
    h.imap.state.failNext = { verb: 'UID FETCH', reply: 'NO partial fetch not supported' };
    const plain = await h.service.list({ folder: 'inbox' });
    assert.deepEqual(plain.items.map(i => [i.uid, i.snippet]), [[5, ''], [4, ''], [3, ''], [2, ''], [1, '']]);
  } finally { await h.close(); }
});

test('previews drop quoted originals, survive truncation and never fail the list', async () => {
  const head = Buffer.from('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n');
  const long = '很好。'.repeat(400);
  const cut = Buffer.from(Buffer.from(long).toString('base64').replace(/(.{76})/g, '$1\r\n')).subarray(0, 4096);
  const text = await mime.snippet(head, cut);
  assert.equal(text.length, mime.SNIPPET_LENGTH + 1); assert.match(text, /^(很好。)+很?好?…$/); assert.doesNotMatch(text, /�/);
  assert.equal(await mime.snippet(Buffer.from('Content-Type: text/plain\r\n\r\n'), Buffer.from('OK, deal.\r\n\r\nOn Mon, Anna wrote:\r\n> old text\r\n> more')), 'OK, deal.');
  assert.equal(await mime.snippet(Buffer.from('Content-Type: text/plain; charset=utf-8\r\n\r\n'), Buffer.from('收到\r\n> 引用\r\n谢谢')), '收到 谢谢');
  assert.equal(await mime.snippet(Buffer.from('Content-Type: text/html\r\n\r\n'), Buffer.from('<style>p{color:red}</style><p>Hello <b>there</b></p><script>x()</script>')), 'Hello there');
  assert.equal(await mime.snippet(Buffer.from('Content-Type: multipart/alternative; boundary="b"\r\n\r\n'), Buffer.from('--b\r\nContent-Type: text/plain\r\n\r\nFirst part only, the rest is cut of')), 'First part only, the rest is cut of');
  assert.equal(await mime.snippet(Buffer.alloc(0), null), ''); assert.equal(await mime.snippet(null, Buffer.from('bare body')), 'bare body');
});

test('a kept-alive connection is reused across operations, checked when stale, replaced when dead, and closed on idle or unbind', async () => {
  const h = await harness({ keepAliveMs: 80 });
  try {
    await h.service.list({ folder: 'inbox' }); await h.service.read({ box: 'inbox', uid: 4 }); await h.service.flags({ box: 'inbox', uid: 4, pending: true }); await h.service.status();
    assert.equal(h.imap.state.logins, 1, 'four operations, one login'); assert.equal(h.service.connected(), true);
    assert.equal(h.imap.state.commands.filter(c => c === 'NOOP').length, 0, 'a connection used a moment ago is not probed');
    await Promise.all([h.service.list({ folder: 'sent' }), h.service.list({ folder: 'unread' }), h.service.read({ box: 'inbox', uid: 3 })]);
    assert.equal(h.imap.state.logins, 1, 'simultaneous requests share the connection');
    h.advance(30000); await h.service.status();
    assert.equal(h.imap.state.commands.filter(c => c === 'NOOP').length, 1, 'after sitting idle the server is asked first'); assert.equal(h.imap.state.logins, 1);
    // 服务器悄悄断开了连接：下一次操作前的探测发现它断了，重新登录，用户看不到错误。删除这种不重做的操作也一样。
    h.imap.dropConnections(); h.advance(30000);
    assert.deepEqual(await h.service.trash({ box: 'inbox', uid: 1 }), { ok: true, count: 1 }); assert.equal(h.imap.state.logins, 2, 'the dead connection was noticed before the move, so the move itself ran once on a fresh login');
    assert.equal(h.box('Trash').length, 1);
    // 命令发出去之后连接才断：只读和改标记的操作重新登录再做一次；
    h.imap.state.dropOn = 'UID SEARCH';
    assert.deepEqual((await h.service.list({ folder: 'pending' })).items.map(i => i.uid), [4, 3]); assert.equal(h.imap.state.logins, 3);
    // 移动邮件不重做（服务器可能已经移了），如实报错。
    h.imap.state.dropOn = 'UID MOVE';
    await rejects(h.service.trash({ box: 'inbox', uid: 2 }), 502, 'imap_no', /没有完成「移动邮件」/); assert.equal(h.imap.state.logins, 3, 'no second login, no second move'); assert.equal(h.imap.state.commands.filter(c => c.startsWith('UID MOVE')).length, 2);
    // 换了密码：旧连接不能接着用。
    h.account = { ...h.account, password: 'changed' };
    await rejects(h.service.list({ folder: 'inbox' }), 422, 'auth_failed'); assert.equal(h.service.connected(), false);
    h.account = { ...h.account, password: SECRET };
    await h.service.list({ folder: 'inbox' }); assert.equal(h.service.connected(), true);
    await new Promise(resolve => setTimeout(resolve, 160));
    assert.equal(h.service.connected(), false, 'the connection is closed once it has been idle for the keep-alive time');
    await until(() => h.imap.state.commands.filter(c => c === 'LOGOUT').length >= 2);
    await h.service.list({ folder: 'inbox' }); assert.equal(h.service.connected(), true);
    await h.service.forget(); assert.equal(h.service.connected(), false, 'unbinding closes the connection at once');
    // 登录还没完成就解绑：这次登录作废，连接不会留下来。
    const pending = h.service.list({ folder: 'inbox' }); await h.service.forget();
    await rejects(pending, 409, 'not_bound'); assert.equal(h.service.connected(), false); await until(() => h.imap.openConnections() === 0); assert.equal(h.imap.openConnections(), 0, 'no connection to the old mailbox is left open');
    // 操作途中解绑并删掉了账号：重试不会拿旧密码再登录。
    await h.service.list({ folder: 'inbox' }); const logins = h.imap.state.logins;
    h.imap.state.dropOn = 'UID SEARCH'; const running = h.service.list({ folder: 'inbox' }); const saved = h.account; h.account = null;
    await rejects(running, 409, 'not_bound'); assert.equal(h.imap.state.logins, logins); h.account = saved;
  } finally { await h.close(); }
});

test('an operation that gets no answer is given up after the time limit and the connection is discarded', async () => {
  const h = await harness({ keepAliveMs: 5000, operationTimeoutMs: 500 });
  try {
    await h.service.list({ folder: 'inbox' }); assert.equal(h.service.connected(), true);
    h.imap.state.stall = 'UID SEARCH';
    await rejects(h.service.list({ folder: 'inbox' }), 504, 'timeout', /长时间没有回应/); assert.equal(h.service.connected(), false);
    h.imap.state.stall = null;
    assert.equal((await h.service.list({ folder: 'inbox' })).total, 5, 'the next operation logs in again and works');
  } finally { await h.close(); }
});

test('the inbox status reports unread, pending and the next uid without touching any message', async () => {
  const h = await harness();
  try {
    assert.deepEqual(await h.service.status(), { ok: true, unread: 3, pending: 1, total: 5, uidNext: 6 });
    assert.ok(h.imap.state.commands.every(c => !/^(UID STORE|UID MOVE|SELECT|UID FETCH|STATUS)/.test(c)), 'status reads no message body, changes nothing, and does not send STATUS for the open folder');
    const before = h.imap.state.nextUid;
    await h.imap.deliver('INBOX', { from: { name: 'New', address: 'new@x.example' }, to: [me], subject: 'Fresh', date: '2026-10-07T01:00:00Z', text: 'hi', messageId: '<fresh@x.example>' });
    const after = await h.service.status();
    assert.deepEqual([after.unread, after.total, after.uidNext], [4, 6, before + 1], 'a newly arrived message moves the next uid');
  } finally { await h.close(); }
  const unbound = await harness({ unbound: true });
  try { await rejects(unbound.service.status(), 409, 'not_bound'); } finally { await unbound.close(); }
});

test('several messages can be marked or deleted in one request, within limits', async () => {
  const h = await harness();
  try {
    assert.deepEqual(await h.service.flags({ box: 'inbox', uids: [5, 4, 4, '3'], seen: true, pending: true }), { ok: true, count: 3 });
    assert.deepEqual(h.box('INBOX').filter(m => m.uid >= 3).map(m => [m.uid, m.flags.has('\\Seen'), m.flags.has('\\Flagged')]), [[3, true, true], [4, true, true], [5, true, true]]);
    assert.equal(h.imap.state.commands.filter(c => c.startsWith('UID STORE')).length, 2, 'one command per flag, not per message');
    assert.deepEqual(await h.service.flags({ box: 'inbox', uids: [5, 4], seen: false }), { ok: true, count: 2 });
    assert.deepEqual(await h.service.trash({ box: 'inbox', uids: [1, 2] }), { ok: true, count: 2 });
    assert.deepEqual(h.box('INBOX').map(m => m.uid), [3, 4, 5]); assert.equal(h.box('Trash').length, 2);
    for (const bad of [{ box: 'inbox', uids: [] }, { box: 'inbox', uids: 'x' }, { box: 'inbox', uids: [1, 0] }, { box: 'inbox', uids: [1, 'a'] }, { box: 'inbox', uids: Array.from({ length: 201 }, (_, i) => i + 1) }]) { await rejects(h.service.trash(bad), 400, 'invalid_input'); await rejects(h.service.flags({ ...bad, seen: true }), 400, 'invalid_input'); }
    assert.equal(h.box('INBOX').length, 3, 'a refused request changes nothing');
  } finally { await h.close(); }
});

test('list rows carry the reply headers used to group conversations', async () => {
  const h = await harness({ mailboxes: { INBOX: [
    { message: { from: { name: 'A', address: 'a@x.example' }, to: [me], subject: 'Order', date: '2026-10-01T00:00:00Z', text: 'one', messageId: '<1@x>' }, flags: [] },
    { message: { from: { name: 'A', address: 'a@x.example' }, to: [me], subject: 'Re: Order', date: '2026-10-02T00:00:00Z', text: 'two', messageId: '<2@x>', inReplyTo: '<1@x>', references: '<1@x>' }, flags: [] }], Sent: [], Trash: [] } });
  try {
    const items = (await h.service.list({ folder: 'inbox' })).items;
    assert.deepEqual(items.map(i => [i.messageId, i.inReplyTo, i.references]), [['<2@x>', '<1@x>', '<1@x>'], ['<1@x>', '', '']]);
  } finally { await h.close(); }
});

test('drafts keep their attachments on this computer; the list carries names only', async () => {
  const h = await harness();
  try {
    const file = { filename: '../报价.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF-1').toString('base64') };
    const saved = h.service.saveDraft({ to: 'a@b.example', subject: 'With file', attachments: [file, { filename: 'n.txt', contentType: 'bad type', contentBase64: Buffer.from('hi').toString('base64') }] }).draft;
    assert.deepEqual(saved.attachments, [{ filename: '_报价.pdf', contentType: 'application/pdf', size: 6 }, { filename: 'n.txt', contentType: 'application/octet-stream', size: 2 }]);
    assert.equal(JSON.stringify(h.service.drafts()).includes(file.contentBase64), false, 'the draft list never carries file contents');
    const opened = h.service.getDraft({ id: saved.id });
    assert.deepEqual(opened.attachments.map(a => [a.filename, a.contentType, Buffer.from(a.contentBase64, 'base64').toString()]), [['_报价.pdf', 'application/pdf', '%PDF-1'], ['n.txt', 'application/octet-stream', 'hi']]);
    const edited = h.service.saveDraft({ id: saved.id, to: 'a@b.example', subject: 'Text only edit' }).draft;
    assert.equal(edited.attachments.length, 2, 'saving without the attachments field keeps the stored files'); assert.equal(h.service.getDraft({ id: saved.id }).attachments.length, 2);
    assert.equal(h.service.saveDraft({ id: saved.id, subject: 'One left', attachments: [file] }).draft.attachments.length, 1); assert.equal(h.service.getDraft({ id: saved.id }).attachments.length, 1);
    assert.equal(h.service.saveDraft({ id: saved.id, subject: 'None', attachments: [] }).draft.attachments.length, 0); assert.equal(h.draftFiles.size, 0);
    assert.throws(() => h.service.saveDraft({ subject: 'big', attachments: [{ filename: 'big.bin', contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }] }), e => e.status === 413);
    assert.throws(() => h.service.saveDraft({ subject: 'bad', attachments: [{ filename: 'x', contentBase64: '***' }] }), e => e.status === 400);
    assert.throws(() => h.service.saveDraft({ subject: 'many', attachments: Array.from({ length: 31 }, () => file) }), e => e.status === 400);
    assert.deepEqual(h.service.drafts().items.map(d => d.subject), ['None'], 'refused saves leave no draft behind');
    h.service.saveDraft({ id: saved.id, subject: 'Send me', to: 'anna@nordic-lamps.example', text: 'see file', attachments: [file] });
    const sending = h.service.getDraft({ id: saved.id });
    await h.service.send({ ...sending.draft, draftId: saved.id, attachments: sending.attachments }); await h.smtp.state.parsing;
    assert.deepEqual((await h.sentMail(-1)).attachments.map(a => a.filename), ['_报价.pdf']); assert.equal(h.drafts.size, 0); assert.equal(h.draftFiles.size, 0, 'sending removes the draft and its files');
    for (const bad of [{}, { id: 'x' }, { id: 'f'.repeat(32) }]) assert.throws(() => h.service.getDraft(bad), e => e.status === 404);
  } finally { await h.close(); }
});

test('templates are saved by name, updated in place, listed newest first and deleted', async () => {
  const h = await harness();
  try {
    assert.deepEqual(h.service.templates(), { ok: true, items: [] });
    const first = h.service.saveTemplate({ name: ' 报价\n跟进 ', subject: 'Quotation for {{公司}}', html: '<p>Dear {{姓名}},</p>', password: 'nope' }).template;
    assert.deepEqual(first, { id: first.id, name: '报价 跟进', subject: 'Quotation for {{公司}}', html: '<p>Dear {{姓名}},</p>', text: 'Dear {{姓名}},', updatedAt: first.updatedAt }); assert.match(first.id, /^[0-9a-f]{32}$/);
    const second = h.service.saveTemplate({ name: 'Second', text: 'plain body' }).template;
    assert.deepEqual(h.service.templates().items.map(t => t.name), ['Second', '报价 跟进']);
    const renamed = h.service.saveTemplate({ id: first.id, name: 'Renamed', subject: 's', text: 't' }).template;
    assert.equal(renamed.id, first.id); assert.deepEqual(h.service.templates().items.map(t => t.name), ['Renamed', 'Second']);
    assert.throws(() => h.service.saveTemplate({ name: 'Second', text: 'dup' }), e => e.status === 409 && /Second/.test(e.message));
    assert.throws(() => h.service.saveTemplate({ name: '  ', text: 'x' }), e => e.status === 400); assert.throws(() => h.service.saveTemplate({ name: 'Empty' }), e => e.status === 400);
    assert.notEqual(h.service.saveTemplate({ id: '../x', name: 'Odd id', text: 'x' }).template.id, '../x');
    assert.deepEqual(h.service.deleteTemplate({ id: second.id }), { ok: true }); assert.equal(h.service.templates().items.some(t => t.id === second.id), false);
    for (const bad of [{}, { id: 'x' }, undefined]) assert.throws(() => h.service.deleteTemplate(bad), e => e.status === 400);
    assert.equal(h.imap.state.logins + h.smtp.state.commands.length, 0, 'templates never leave this computer');
  } finally { await h.close(); }
});

test('bulk stops before handing a message to SMTP when its sending mark cannot be saved', async () => {
  const originalSend = smtpClient.send;
  let accepted = 0, serialized, writes = 0;
  smtpClient.send = async () => { accepted++; return { messageId: '<fake@example.invalid>', accepted: ['x@example.invalid'], rejected: [] }; };
  const store = {
    readMailAccount: () => ({ email: 'account-a@example.invalid' }),
    writeMailBulk: batch => { writes++; if (writes > 1) throw Object.assign(new Error('Synthetic disk full'), { code: 'SQLITE_FULL' }); serialized = JSON.stringify(batch); },
    readMailBulk: () => JSON.parse(serialized), listMailBulk: () => [JSON.parse(serialized)],
  };
  const service = createMailService({ store, bulkPauseMs: 0 });
  try {
    const start = service.bulkStart({ subject: 'Synthetic bulk', text: 'Hello', recipients: [1, 2, 3].map(n => ({ address: `recipient-${n}@example.invalid` })) });
    await service.bulkIdle();
    const batch = service.bulkGet({ id: start.batch.id }).batch;
    assert.equal(accepted, 0, 'nothing reached the sending server');
    assert.equal(batch.status, 'stopped'); assert.match(batch.stopReason, /记录保存失败/);
    assert.deepEqual(batch.items.map(i => i.status), ['skipped', 'skipped', 'skipped']);
    assert.equal(service.bulkList().items[0].status, 'stopped', 'the list shows the failure even though it could not be written');
  } finally { smtpClient.send = originalSend; await service.shutdown(); }
});

test('a message accepted by SMTP whose record cannot be saved is marked for checking, also after a restart', async () => {
  const originalSend = smtpClient.send;
  let accepted = 0, writes = 0, serialized;
  const store = {
    readMailAccount: () => ({ email: 'a@example.invalid' }),
    writeMailBulk: b => { if (++writes > 2) throw Error('Synthetic full disk'); serialized = JSON.stringify(b); },
    readMailBulk: () => JSON.parse(serialized), listMailBulk: () => [JSON.parse(serialized)],
  };
  smtpClient.send = async () => { accepted++; return { accepted: ['q@example.invalid'], rejected: [] }; };
  let service = createMailService({ store, bulkPauseMs: 0 });
  try {
    const result = service.bulkStart({ subject: 'S', text: 'T', recipients: [1, 2, 3].map(n => ({ address: `r${n}@example.invalid` })) });
    await service.bulkIdle();
    const batch = service.bulkGet({ id: result.batch.id }).batch;
    assert.equal(accepted, 1); assert.equal(batch.status, 'stopped'); assert.equal(batch.uncertain, 1); assert.equal(batch.items[0].status, 'uncertain'); assert.equal(batch.skipped, 2);
    await service.shutdown();
    // 重启：库里最后存下的是「发送中」那一刻，那封标为待核对，不会被当成没发。
    service = createMailService({ store });
    const restarted = service.bulkGet({ id: result.batch.id }).batch;
    assert.equal(restarted.items[0].status, 'uncertain'); assert.match(restarted.items[0].error, /核对/);
    assert.deepEqual(restarted.items.slice(1).map(i => i.status), ['skipped', 'skipped']);
    assert.equal(accepted, 1, 'nothing is re-sent');
  } finally { smtpClient.send = originalSend; await service.shutdown(); }
});
