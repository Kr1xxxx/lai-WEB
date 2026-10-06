const test = require('node:test');
const assert = require('node:assert/strict');
const mime = require('../backend/mail-mime.js');
const sample = require('./fixtures/mail-sample.cjs');
const { rawMessage } = require('./fixtures/fake-mail-servers.cjs');
const me = { name: '', address: 'sales@example-trade.com' };

// 解析本身由开源库 postal-mime 完成（它有自己的测试）；这里测来财整理结果的那一层，以及几种常见的真实形态确实读得出来。

test('a legacy-charset message without transfer encoding is read correctly', async () => {
  const parsed = await mime.parseMessage(sample.gbkMessage(me));
  assert.equal(parsed.subject, '报价确认'); assert.deepEqual(parsed.from, { name: '王磊', address: 'wanglei@shenzhen-parts.example' });
  assert.equal(parsed.text.trim(), '你好，报价如下'); assert.equal(parsed.date, '2026-10-04T03:30:00.000Z'); assert.deepEqual(parsed.attachments, []);
});

test('multipart messages yield text, html, attachments and inline images in the shape the app uses', async () => {
  const inline = await mime.parseMessage(sample.inlineImageMessage(me));
  assert.match(inline.html, /cid:cover@x/); assert.equal(inline.text.trim(), 'Cover draft:', 'text is derived from html when there is no plain part, without script content');
  assert.deepEqual(inline.attachments.map(a => ({ ...a, content: a.content.equals(sample.png) })), [{ index: 0, filename: 'cover.png', contentType: 'image/png', size: sample.png.length, inline: true, contentId: 'cover@x', content: true }]);
  const raw = await rawMessage({ from: { name: '张三', address: 'A@Zoho.com.cn' }, to: [{ name: 'Li, Wei', address: 'li@example.com' }, { name: '', address: 'x@y.org' }], cc: [{ name: 'C "Q"', address: 'c@y.org' }], subject: '报价单 Quotation — 很长很长的标题用来测试折行是否正确',
    date: '2026-10-06T10:00:00Z', text: '你好\n.dot\nBye', html: '<b>你好</b>', messageId: '<m1@zoho.com.cn>', inReplyTo: '<abc@x>', references: ['<1@x>', '<abc@x>'], attachments: [{ filename: '报价 v1.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }, { filename: 'data.bin', content: Buffer.alloc(300, 65) }] });
  const parsed = await mime.parseMessage(raw);
  assert.deepEqual({ ...parsed, attachments: undefined }, { from: { name: '张三', address: 'a@zoho.com.cn' }, to: [{ name: 'Li, Wei', address: 'li@example.com' }, { name: '', address: 'x@y.org' }], cc: [{ name: 'C "Q"', address: 'c@y.org' }], replyTo: [],
    subject: '报价单 Quotation — 很长很长的标题用来测试折行是否正确', date: '2026-10-06T10:00:00.000Z', messageId: '<m1@zoho.com.cn>', inReplyTo: '<abc@x>', references: '<1@x> <abc@x>', text: '你好\n.dot\nBye', html: '<b>你好</b>', attachments: undefined });
  assert.deepEqual(parsed.attachments.map(a => [a.index, a.filename, a.contentType, a.size, a.inline, a.content.subarray(0, 4).toString()]), [[0, '报价 v1.pdf', 'application/pdf', 4, false, '%PDF'], [1, 'data.bin', 'application/octet-stream', 300, false, 'AAAA']]);
});

test('list headers give sender, recipients, subject, time and an attachment hint', async () => {
  const headers = await mime.parseHeaders(Buffer.from('From: =?UTF-8?B?5byg5LiJ?= <A@b.co>\r\nTo: "Li, Wei" <li@x.co>, undisclosed-recipients:;, Team: p@q.io, r@s.io;\r\nCc: bad, <c@d.co>\r\nSubject: =?UTF-8?B?5oql5Lu3?=\r\n =?UTF-8?B?5Y2V?=\r\nDate: Mon, 05 Oct 2026 09:00:00 +0800\r\nMessage-ID: <x@y>\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n'));
  assert.deepEqual(headers, { from: { name: '张三', address: 'a@b.co' }, to: [{ name: 'Li, Wei', address: 'li@x.co' }, { name: '', address: 'p@q.io' }, { name: '', address: 'r@s.io' }], cc: [{ name: '', address: 'c@d.co' }], replyTo: [], subject: '报价单', date: '2026-10-05T01:00:00.000Z', messageId: '<x@y>', inReplyTo: '', references: '', hasAttachment: true });
  assert.equal((await mime.parseHeaders(Buffer.from('Subject: plain\r\nContent-Type: text/plain\r\n\r\n'))).hasAttachment, false);
  for (const empty of [Buffer.alloc(0), undefined, null]) assert.deepEqual(await mime.parseHeaders(empty), { from: { name: '', address: '' }, to: [], cc: [], replyTo: [], subject: '', date: '', messageId: '', inReplyTo: '', references: '', hasAttachment: false });
});

test('hostile or broken messages cannot hang, crash or escape the downloads folder', async () => {
  let nested = 'Content-Type: text/plain\r\n\r\ndeep';
  for (let i = 0; i < 40; i++) nested = `Content-Type: multipart/mixed; boundary=b${i}\r\n\r\n--b${i}\r\n${nested}\r\n--b${i}--`;
  await assert.doesNotReject(mime.parseMessage(Buffer.from(nested)));
  const many = 'Content-Type: multipart/mixed; boundary=x\r\n\r\n' + '--x\r\nContent-Type: application/octet-stream\r\n\r\nA\r\n'.repeat(1000) + '--x--';
  assert.ok((await mime.parseMessage(Buffer.from(many))).attachments.length <= 200);
  for (const raw of [Buffer.alloc(0), Buffer.from('no headers at all'), Buffer.from('Content-Type: multipart/mixed; boundary=zz\r\n\r\n--zz\r\nno end'), Buffer.from([0xff, 0xfe, 0x00, 0x01])]) await assert.doesNotReject(mime.parseMessage(raw));
  const evil = await mime.parseMessage(Buffer.from('Content-Type: application/x-sh\r\nContent-Disposition: attachment; filename="../../../.ssh/authorized_keys"\r\n\r\nx'));
  assert.equal(evil.attachments[0].filename, '_.._.._.ssh_authorized_keys');
  for (const name of ['..', '/', '\u0000', 'a\r\nb:c', 'con/..\\x']) assert.doesNotMatch(mime.safeFilename(name), /[\\/\u0000-\u001f]|^\./, JSON.stringify(name));
  assert.equal(mime.safeFilename(''), 'attachment');
  const untyped = await mime.parseMessage(Buffer.from('Content-Type: multipart/mixed; boundary=q\r\n\r\n--q\r\nContent-Type: bad type!\r\nContent-Disposition: attachment\r\n\r\nx\r\n--q--'));
  assert.deepEqual(untyped.attachments.map(a => [a.filename, a.contentType]), [['attachment-1', 'application/octet-stream']]);
});

test('addresses are normalised and html falls back to readable text', () => {
  assert.deepEqual(mime.addresses([{ name: ' A  B ', address: 'X@Y.io' }, { name: 'g', group: [{ name: '', address: 'm@n.io' }] }, { address: 'bad' }, null, { address: 'a b@c.io' }]), [{ name: 'A B', address: 'x@y.io' }, { name: '', address: 'm@n.io' }]);
  assert.deepEqual(mime.addresses(undefined), []);
  assert.equal(mime.htmlToText('<style>p{}</style><p>Hi <b>there</b></p><script>x()</script><div>a &amp; b&nbsp;&lt;c&gt;</div><br>end'), 'Hi there\na & b <c>\n\nend');
});
