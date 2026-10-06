const test = require('node:test');
const assert = require('node:assert/strict');
const mime = require('../backend/mail-mime.js');
const sample = require('./fixtures/mail-sample.cjs');
const me = { name: '', address: 'sales@example-trade.com' };

test('encoded header words decode across charsets and split characters', () => {
  assert.equal(mime.decodeWords('Re: =?UTF-8?B?5oql5Lu3?= =?UTF-8?B?5Y2V?= ok =?gbk?Q?=C4=E3=BA=C3?='), 'Re: 报价单 ok 你好');
  const bytes = Buffer.from('报价单', 'utf8');
  assert.equal(mime.decodeWords(`=?UTF-8?B?${bytes.subarray(0, 4).toString('base64')}?=\r\n =?UTF-8?B?${bytes.subarray(4).toString('base64')}?=`), '报价单', 'a character split across two words survives');
  assert.equal(mime.decodeWords('=?ISO-8859-1?Q?Caf=E9_au_lait?='), 'Café au lait');
  assert.equal(mime.decodeWords('plain subject'), 'plain subject');
  assert.equal(mime.decodeWords('=?x-unknown-charset?B?aGk=?='), 'hi', 'unknown charset falls back instead of throwing');
  assert.equal(mime.decodeWords('a =?UTF-8?B?5L2g?= b'), 'a 你 b');
});

test('address lists keep quoted commas, decode names and drop invalid entries', () => {
  assert.deepEqual(mime.parseAddressList('"Li, Wei" <Li@Example.com>, =?UTF-8?B?5byg5LiJ?= <zs@x.cn>; plain@y.org (comment), undisclosed-recipients:;, bad, <a@b.co>'),
    [{ name: 'Li, Wei', address: 'li@example.com' }, { name: '张三', address: 'zs@x.cn' }, { name: '', address: 'plain@y.org' }, { name: '', address: 'a@b.co' }]);
  assert.deepEqual(mime.parseAddressList(''), []); assert.deepEqual(mime.parseAddressList(undefined), []);
  assert.deepEqual(mime.parseAddressList('"a\\"b" <q@x.io>'), [{ name: 'a"b', address: 'q@x.io' }]);
});

test('parameters decode quoted, extended and continued forms', () => {
  assert.deepEqual(mime.parseParameterized('Attachment; filename*0*=UTF-8\'\'%E6%8A%A5; filename*1*=%E4%BB%B7.pdf; x="a;b"'), { value: 'attachment', params: { x: 'a;b', filename: '报价.pdf' } });
  assert.deepEqual(mime.parseParameterized('text/plain; charset="gb2312"; format=flowed'), { value: 'text/plain', params: { charset: 'gb2312', format: 'flowed' } });
  assert.equal(mime.parseParameterized("attachment; filename*=gbk''%C4%E3%BA%C3.txt").params.filename, '你好.txt');
  assert.deepEqual(mime.parseParameterized(''), { value: '', params: {} });
});

test('a legacy-charset message without transfer encoding is read correctly', () => {
  const parsed = mime.parseMessage(sample.gbkMessage(me));
  assert.equal(parsed.subject, '报价确认'); assert.deepEqual(parsed.from, { name: '王磊', address: 'wanglei@shenzhen-parts.example' });
  assert.equal(parsed.text.trim(), '你好，报价如下'); assert.equal(parsed.date, '2026-10-04T03:30:00.000Z'); assert.deepEqual(parsed.attachments, []);
});

test('multipart messages yield text, html, attachments and inline images', () => {
  const inline = mime.parseMessage(sample.inlineImageMessage(me));
  assert.match(inline.html, /cid:cover@x/); assert.equal(inline.text, 'Cover draft:', 'text is derived from html when there is no plain part, without script content');
  assert.equal(inline.attachments.length, 1);
  assert.deepEqual({ ...inline.attachments[0], content: inline.attachments[0].content.equals(sample.png) }, { index: 0, filename: 'cover.png', contentType: 'image/png', size: sample.png.length, inline: true, contentId: 'cover@x', content: true });
  const raw = Buffer.from(['From: a@b.co', 'Subject: x', 'Content-Type: multipart/mixed; boundary=outer', '', 'preamble to ignore', '--outer', 'Content-Type: multipart/alternative; boundary="in ner"', '',
    '--in ner', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'caf=C3=A9 =', 'line=3D1', '--in ner', 'Content-Type: text/html', '', '<b>caf&eacute;</b>', '--in ner--', '',
    '--outer', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="=?UTF-8?B?5oql5Lu3LnBkZg==?="', 'Content-Transfer-Encoding: base64', '', 'JVBE', 'Ri0x', '--outer', 'Content-Type: message/rfc822', '', 'Subject: inner', '', 'body', '--outer--', 'epilogue'].join('\r\n'));
  const parsed = mime.parseMessage(raw);
  assert.equal(parsed.text, 'café line=1'); assert.equal(parsed.html, '<b>caf&eacute;</b>');
  assert.deepEqual(parsed.attachments.map(a => [a.index, a.filename, a.contentType, a.content.toString('latin1')]), [[0, '报价.pdf', 'application/pdf', '%PDF-1'], [1, 'attachment-2.eml', 'message/rfc822', 'Subject: inner\r\n\r\nbody']]);
});

test('hostile or broken structure cannot hang or escape', () => {
  let nested = 'Content-Type: text/plain\r\n\r\ndeep';
  for (let i = 0; i < 40; i++) nested = `Content-Type: multipart/mixed; boundary=b${i}\r\n\r\n--b${i}\r\n${nested}\r\n--b${i}--`;
  assert.doesNotThrow(() => mime.parseMessage(Buffer.from(nested)));
  const many = 'Content-Type: multipart/mixed; boundary=x\r\n\r\n' + '--x\r\nContent-Type: application/octet-stream\r\n\r\nA\r\n'.repeat(1000) + '--x--';
  assert.ok(mime.parseMessage(Buffer.from(many)).attachments.length <= 200);
  assert.doesNotThrow(() => mime.parseMessage(Buffer.alloc(0)));
  assert.doesNotThrow(() => mime.parseMessage(Buffer.from('no headers at all')));
  assert.doesNotThrow(() => mime.parseMessage(Buffer.from('Content-Type: multipart/mixed; boundary=zz\r\n\r\n--zz\r\nno end')));
  const evil = mime.parseMessage(Buffer.from('Content-Type: application/x-sh\r\nContent-Disposition: attachment; filename="../../../.ssh/authorized_keys"\r\n\r\nx'));
  assert.equal(evil.attachments[0].filename, '_.._.._.ssh_authorized_keys');
  for (const name of ['..', '/', '\u0000', 'a\r\nb:c', 'con/..\\x']) assert.doesNotMatch(mime.safeFilename(name), /[\\/\u0000-\u001f]|^\./, JSON.stringify(name));
  assert.equal(mime.safeFilename(''), 'attachment');
});

test('a built message round-trips and never carries injected headers', () => {
  const built = mime.buildMessage({ from: { name: '张三', address: 'a@zoho.com.cn' }, to: [{ name: 'Li, Wei', address: 'li@example.com' }, { name: '', address: 'x@y.org' }], cc: [{ name: 'C "Q"', address: 'c@y.org' }],
    subject: '报价单 Quotation — 很长很长的标题用来测试折行是否正确\r\nBcc: evil@x.io', text: '你好\n.dot\r\nBye', inReplyTo: '<abc@x>\r\nX-Evil: 1', references: '<1@x> <abc@x> junk',
    attachments: [{ filename: '报价 v1.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }, { filename: '../x"\r\n.sh', contentType: 'bad type\r\nX: y', content: Buffer.alloc(300, 65) }], date: new Date('2026-10-06T10:00:00Z') });
  const text = built.raw.toString('utf8');
  assert.match(built.messageId, /^<[0-9a-f]{32}@zoho\.com\.cn>$/);
  const head = text.slice(0, text.indexOf('\r\n\r\n'));
  assert.doesNotMatch(head, /^Bcc:|^X-Evil:|^X:/m, 'no header can be injected through user text');
  assert.doesNotMatch(text, /[^\x00-\x7f]/, 'the wire form is pure ASCII');
  for (const line of text.split('\r\n')) assert.ok(line.length <= 998, 'line length');
  assert.match(head, /^Date: Tue, 06 Oct 2026 10:00:00 \+0000$/m); assert.match(head, /^In-Reply-To: <abc@x>$/m); assert.match(head, /^References: <1@x>\r\n <abc@x>$/m);
  const parsed = mime.parseMessage(built.raw);
  assert.deepEqual(parsed.from, { name: '张三', address: 'a@zoho.com.cn' });
  assert.deepEqual(parsed.to, [{ name: 'Li, Wei', address: 'li@example.com' }, { name: '', address: 'x@y.org' }]); assert.deepEqual(parsed.cc, [{ name: 'C "Q"', address: 'c@y.org' }]);
  assert.equal(parsed.subject, '报价单 Quotation — 很长很长的标题用来测试折行是否正确 Bcc: evil@x.io'); assert.equal(parsed.text, '你好\n.dot\nBye');
  assert.deepEqual(parsed.attachments.map(a => [a.filename, a.contentType, a.size]), [['报价 v1.pdf', 'application/pdf', 4], ['_x_.sh', 'application/octet-stream', 300]]);
  const plain = mime.buildMessage({ from: { name: '', address: 'a@b.co' }, to: [{ name: '', address: 'c@d.co' }], subject: 'Hi', text: 'x' });
  assert.match(plain.raw.toString(), /^From: a@b\.co\r\nTo: c@d\.co\r\nSubject: Hi\r\n/); assert.doesNotMatch(plain.raw.toString(), /multipart/);
});
