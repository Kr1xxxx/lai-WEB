'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const W = require('../src/whatsapp-model.js');

const sample = name => fs.readFileSync(path.join(__dirname, '..', 'docs', 'samples', 'whatsapp', name), 'utf8');
const at = (y, m, d, h, mi, s = 0) => new Date(y, m - 1, d, h, mi, s).toISOString();
const summary = result => result.messages.filter(m => !m.system).map(m => `${m.local.slice(0, 16).replace('T', ' ')} ${m.from}: ${m.text}`);

// ---------- formats ----------
test('Android 24h: continuation lines, system notice, media placeholder, emoji', () => {
  const result = W.parseExport(sample('android-24h.txt'));
  assert.equal(result.unknownLines, 0);
  assert.equal(result.systemCount, 1);
  assert.equal(result.messages[0].system, true);
  assert.equal(result.messages[0].from, '');
  assert.match(result.messages[0].text, /end-to-end encrypted/);
  assert.deepEqual(summary(result), [
    '2026-10-12 14:05 Maria Test: Hello, is the lash box still available?',
    '2026-10-12 14:07 Li Wei: Yes, we have stock. How many do you need?',
    '2026-10-12 14:09 Maria Test: About 500 pieces.\nCan you send the price list\nand the MOQ?',
    '2026-10-12 14:10 Maria Test: <Media omitted>',
    '2026-10-13 09:30 Li Wei: Sending it now. 👍',
    '2026-10-13 09:30 Li Wei: Sending it now. 👍',
    '2026-10-13 18:02 Maria Test: Thanks! Will reply tomorrow.',
  ]);
  assert.equal(result.messages[1].at, at(2026, 10, 12, 14, 5)); // first real message (system notice is [0])
  assert.deepEqual(result.senders, [{ name: 'Maria Test', count: 4 }, { name: 'Li Wei', count: 3 }]);
  assert.equal(result.isGroup, false);
  assert.equal(result.count, 7);
  assert.equal(result.range.fromDay, '2026-10-12');
  assert.equal(result.range.toDay, '2026-10-13');
  assert.equal(result.ambiguousDateOrder, false); // 13/10 settles day-first
  assert.equal(result.dayFirst, true);
});

test('Android 12h with US order: month/day inferred from the data', () => {
  const result = W.parseExport(sample('android-12h-us.txt'));
  assert.equal(result.dayFirst, false); // 10/13 cannot be day-first
  assert.equal(result.ambiguousDateOrder, false);
  assert.deepEqual(summary(result).map(line => line.slice(0, 16)), ['2026-10-12 14:05', '2026-10-12 14:07', '2026-10-13 09:30', '2026-10-13 12:01']);
});

test('12-hour clock: 12 AM is midnight, 12 PM is noon, "2:05 pm" and "p.m." both work', () => {
  const result = W.parseExport([
    '15/10/2026, 12:05 am - A: midnight',
    '15/10/2026, 12:05 pm - A: noon',
    '15/10/2026, 2:05 pm - A: afternoon',
    '15/10/2026, 11:59 p.m. - A: late',
  ].join('\n'));
  assert.deepEqual(result.messages.map(m => m.local.slice(11, 16)), ['00:05', '12:05', '14:05', '23:59']);
});

test('iOS: brackets, seconds, U+200E marks, U+202F before AM/PM, attachments kept, encryption notice tagged', () => {
  const text = sample('ios.txt');
  assert.ok(text.includes('‎') && text.includes(' '));
  const result = W.parseExport(text);
  assert.equal(result.unknownLines, 0);
  assert.equal(result.messages.length, 5);
  assert.equal(result.messages[0].system, true);
  assert.equal(result.messages[0].from, '');
  assert.deepEqual(result.messages.slice(1).map(m => [m.from, m.text]), [
    ['Maria Test', 'Good afternoon'],
    ['Li Wei', 'Hello Maria'],
    ['Maria Test', '<attached: 00000012-PHOTO-2026-10-12-14-08-45.jpg>'],
    ['Li Wei', 'Nice photo'],
  ]);
  assert.equal(result.messages[1].at, at(2026, 10, 12, 14, 6, 10));
  assert.equal(result.messages[4].at, at(2026, 10, 12, 14, 9, 0)); // 2:09:00 PM
  assert.ok(result.messages.every(m => !/[‎ ]/.test(m.from + m.text)));
});

test('Chinese Android: 上午/下午, full-width brackets in names, attachment placeholder', () => {
  const result = W.parseExport(sample('chinese-android.txt'));
  assert.equal(result.unknownLines, 0);
  assert.deepEqual(summary(result), [
    '2026-10-12 14:05 玛丽亚（测试）: 你好，请问还有货吗？',
    '2026-10-12 14:07 李伟: 有的，需要多少？',
    '2026-10-13 09:30 玛丽亚（测试）: 大概 500 个\n请发一下报价',
    '2026-10-13 09:31 李伟: <附件：IMG-20261013-WA0001.jpg>',
  ]);
  assert.equal(result.ambiguousDateOrder, false); // year first is unambiguous
});

test('Chinese iOS: [2026/10/12 14:05:33]', () => {
  const result = W.parseExport(sample('chinese-ios.txt'));
  assert.deepEqual(summary(result), ['2026-10-12 14:05 玛丽亚（测试）: 你好', '2026-10-12 14:06 李伟: 你好，请讲']);
  assert.equal(result.messages[0].at, at(2026, 10, 12, 14, 5, 33));
});

test('Chinese day parts: 凌晨, 中午, 晚上 and the 年月日 form', () => {
  const result = W.parseExport([
    '2026年10月12日 凌晨12:30 - 甲: 一',
    '2026年10月12日 中午12:30 - 甲: 二',
    '2026年10月12日 中午1:30 - 甲: 三',
    '2026年10月12日 晚上9:30 - 甲: 四',
    '[2026/10/12 下午2:05:33] 乙: 五',
  ].join('\n'));
  assert.deepEqual(result.messages.map(m => m.local.slice(0, 16)), ['2026-10-12T00:30', '2026-10-12T12:30', '2026-10-12T13:30', '2026-10-12T21:30', '2026-10-12T14:05']);
});

test('separators . and -, two-digit years, no comma', () => {
  const dot = W.parseExport('15.10.26, 14:05 - A: x\n16.10.26, 09:00 - B: y');
  assert.deepEqual(dot.messages.map(m => m.local.slice(0, 16)), ['2026-10-15T14:05', '2026-10-16T09:00']);
  const dash = W.parseExport('[15-10-2026 14:05:33] A: x');
  assert.equal(dash.messages[0].local, '2026-10-15T14:05:33');
  const iso = W.parseExport('2026-10-15, 14:05 - A: x');
  assert.equal(iso.messages[0].local, '2026-10-15T14:05:00');
  const old = W.parseExport('15/10/99, 14:05 - A: x');
  assert.equal(old.messages[0].local.slice(0, 4), '1999');
});

test('windows line endings and a BOM', () => {
  const result = W.parseExport('﻿15/10/2026, 14:05 - A: one\r\n15/10/2026, 14:06 - B: two\r\n');
  assert.equal(result.messages.length, 2);
  assert.equal(result.unknownLines, 0);
});

test('group chat: several senders, phone-number senders, and a system line with a colon inside quotes', () => {
  const result = W.parseExport(sample('group.txt'));
  assert.equal(result.isGroup, true);
  assert.deepEqual(result.senders.map(s => s.name), ['+44 7700 900123', 'Li Wei', '+44 7700 900124']);
  assert.equal(result.systemCount, 1);
  const system = result.messages.find(m => m.system);
  assert.match(system.text, /changed the subject from “Lash: Samples”/);
  assert.equal(system.from, '');
  assert.deepEqual(W.peersFromSenders(result.senders), ['+447700900123', '+447700900124']);
});

test('iOS system lines that carry a sender are tagged system, but attachments are not', () => {
  const result = W.parseExport([
    '‎[15/10/2026, 14:05:33] Team: ‎Maria created group “Team”',
    '[15/10/2026, 14:06:00] Maria: ‎<attached: left-side.jpg>',
    '[15/10/2026, 14:07:00] Maria: ‎image omitted',
    '[15/10/2026, 14:08:00] Maria: I added you to the list',
  ].join('\n'));
  assert.deepEqual(result.messages.map(m => !!m.system), [true, false, false, false]);
  assert.equal(result.messages[3].text, 'I added you to the list');
});

test('date order: >12 settles it; a chronological chat settles it; otherwise ambiguous and the option decides', () => {
  assert.equal(W.parseExport('05/06/2026, 10:00 - A: x\n20/06/2026, 10:00 - A: y').dayFirst, true);
  assert.equal(W.parseExport('05/06/2026, 10:00 - A: x\n06/20/2026, 10:00 - A: y').dayFirst, false);
  // 03/04 then 02/05 then 10/05 reads forward only as day-first
  const forward = W.parseExport('03/04/2026, 10:00 - A: x\n02/05/2026, 10:00 - A: y\n10/05/2026, 10:00 - A: z');
  assert.equal(forward.dayFirst, true);
  assert.equal(forward.ambiguousDateOrder, false);
  assert.equal(forward.messages[0].local.slice(0, 10), '2026-04-03');
  // the user's choice does not beat explicit evidence
  assert.equal(W.parseExport('20/06/2026, 10:00 - A: x', { dayFirst: false }).dayFirst, true);

  const text = sample('ambiguous.txt');
  const auto = W.parseExport(text);
  assert.equal(auto.ambiguousDateOrder, true);
  assert.equal(auto.dayFirst, true);
  assert.equal(auto.messages[0].local.slice(0, 10), '2026-06-05');
  const us = W.parseExport(text, { dayFirst: false });
  assert.equal(us.ambiguousDateOrder, true); // still ambiguous, so the page keeps showing the choice
  assert.equal(us.dayFirst, false);
  assert.equal(us.messages[0].local.slice(0, 10), '2026-05-06');
  // same day and month: nothing to decide
  assert.equal(W.parseExport('05/05/2026, 10:00 - A: x').ambiguousDateOrder, false);
});

test('never drops unknown lines silently', () => {
  const stray = W.parseExport('some header junk\n\n15/10/2026, 14:05 - A: x\n15/10/2026, 14:06 hello without a dash\n[15/10/2026, 25:99] A: bad time\nplain continuation\n');
  assert.equal(stray.messages.length, 1);
  assert.equal(stray.unknownLines, 3); // junk before the first message, and two timestamp-like lines that do not parse
  assert.equal(stray.unknownSamples.length, 3);
  assert.equal(stray.messages[0].text, 'x\nplain continuation');
  const nothing = W.parseExport('this is not a chat export\nat all');
  assert.equal(nothing.messages.length, 0);
  assert.equal(nothing.unknownLines, 2);
  assert.equal(nothing.range, null);
  assert.equal(W.parseExport('').messages.length, 0);
  // an impossible date inside a chat is kept as part of the previous message
  const impossible = W.parseExport('15/10/2026, 14:05 - A: x\n31/02/2026, 14:05 - A: y\n');
  assert.equal(impossible.messages.length, 1);
  assert.match(impossible.messages[0].text, /31\/02\/2026/);
});

test('size and count limits', () => {
  assert.throws(() => W.parseExport('x'.repeat(2000), { maxChars: 1000 }), /太大/);
  assert.throws(() => W.parseExport('x'.repeat(3 * 1024 * 1024 + 1)), /太大/);
  const many = Array.from({ length: 20001 }, (_, i) => `15/10/2026, 10:00 - A: m${i}`).join('\n');
  assert.throws(() => W.parseExport(many), /20000/);
  const ok = Array.from({ length: 20000 }, (_, i) => `15/10/2026, 10:00 - A: m${i}`).join('\n');
  assert.equal(W.parseExport(ok).messages.length, 20000);
});

// ---------- zip ----------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files, { descriptor = false, comment = '' } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8'), raw = Buffer.from(file.data);
    const method = file.method ?? 8;
    const packed = method === 0 ? raw : zlib.deflateRawSync(raw);
    const flags = (descriptor ? 8 : 0) | (file.encrypted ? 1 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(descriptor ? 0 : crc32(raw), 14); local.writeUInt32LE(descriptor ? 0 : packed.length, 18); local.writeUInt32LE(descriptor ? 0 : raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const trailer = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (descriptor) { trailer.writeUInt32LE(0x08074b50, 0); trailer.writeUInt32LE(crc32(raw), 4); trailer.writeUInt32LE(packed.length, 8); trailer.writeUInt32LE(raw.length, 12); }
    locals.push(local, name, packed, trailer);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length + trailer.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return new Uint8Array(Buffer.concat([...locals, dir, end, Buffer.from(comment)]));
}

test('readZip: deflated _chat.txt, stored entry, data descriptor, ignores media and macOS junk', async () => {
  const chat = sample('android-24h.txt');
  const deflated = makeZip([{ name: '00000012-PHOTO.jpg', data: 'not text', method: 0 }, { name: '__MACOSX/._chat.txt', data: 'junk' }, { name: '_chat.txt', data: chat }]);
  assert.equal(await W.readZip(deflated), chat);
  assert.equal(await W.readZip(makeZip([{ name: '_chat.txt', data: chat, method: 0 }])), chat);
  assert.equal(await W.readZip(makeZip([{ name: '_chat.txt', data: chat }], { descriptor: true })), chat);
  assert.equal(await W.readZip(makeZip([{ name: '_chat.txt', data: chat }], { comment: 'a zip comment' })), chat);
  const cn = '[2026/10/12 14:05:33] 玛丽亚: 你好 👍\n';
  assert.equal(await W.readZip(makeZip([{ name: 'WhatsApp Chat - 玛丽亚/_chat.txt', data: cn }])), cn);
  assert.equal(await W.readZip(Buffer.from(makeZip([{ name: '_chat.txt', data: chat }]))), chat); // a Node Buffer is fine too
  const result = W.parseExport(await W.readZip(deflated));
  assert.equal(result.count, 7);
});

test('readZip: the single .txt, or the one named like a chat', async () => {
  assert.equal(await W.readZip(makeZip([{ name: 'WhatsApp Chat with Maria.txt', data: 'hello' }, { name: 'a.jpg', data: 'x' }])), 'hello');
  assert.equal(await W.readZip(makeZip([{ name: 'WhatsApp Chat with Maria.txt', data: 'chat' }, { name: 'readme.txt', data: 'other' }])), 'chat');
});

test('readZip: clear Chinese errors for zips it cannot read', async () => {
  await assert.rejects(W.readZip(new Uint8Array([1, 2, 3, 4])), /不是有效的压缩包/);
  await assert.rejects(W.readZip(new Uint8Array(0)), /不是有效的压缩包/);
  await assert.rejects(W.readZip(makeZip([{ name: 'photo.jpg', data: 'x' }])), /没有找到聊天文本/);
  await assert.rejects(W.readZip(makeZip([{ name: 'a.txt', data: 'x' }, { name: 'b.txt', data: 'y' }])), /好几个文本文件/);
  await assert.rejects(W.readZip(makeZip([{ name: '_chat.txt', data: 'x', encrypted: true }])), /有密码/);
  await assert.rejects(W.readZip(makeZip([{ name: '_chat.txt', data: 'x'.repeat(5000) }]), { maxBytes: 1000 }), /太大/);
  // a lying size in the central directory must not allow a bomb either
  const bomb = makeZip([{ name: '_chat.txt', data: 'x'.repeat(200000) }]);
  const view = Buffer.from(bomb);
  const central = view.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  view.writeUInt32LE(10, central + 24);
  await assert.rejects(W.readZip(new Uint8Array(view), { maxBytes: 1000 }), /太大/);
  // unsupported compression method
  const odd = Buffer.from(makeZip([{ name: '_chat.txt', data: 'x' }]));
  odd.writeUInt16LE(12, odd.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
  await assert.rejects(W.readZip(new Uint8Array(odd)), /不支持的压缩方式/);
  // damaged deflate data
  const broken = Buffer.from(makeZip([{ name: '_chat.txt', data: 'hello hello hello hello' }]));
  broken.fill(0xff, 30 + '_chat.txt'.length, 30 + '_chat.txt'.length + 4);
  await assert.rejects(W.readZip(new Uint8Array(broken)), /打不开/);
  // truncated: the central directory is gone
  await assert.rejects(W.readZip(makeZip([{ name: '_chat.txt', data: 'x' }]).subarray(0, 40)), /不是有效的压缩包/);
});

// ---------- entries ----------
const opts = (extra = {}) => ({ me: 'Li Wei', peer: '+447700900123', contact: 'Maria Test', owner: 'Amy', importId: 'imp-1', ...extra });
const baseState = () => ({
  customers: {
    'Lash Co': { client: 'Lash Co', owner: 'Amy', updated: '2026-01-01T00:00:00.000Z', history: [{ time: '2026-10-14T08:00:00.000Z', text: '写了一条跟进', type: 'followup' }, { time: '2026-01-01T00:00:00.000Z', text: '新建客户档案', type: 'operation' }] },
    'Other Co': { client: 'Other Co', history: [] },
    'Trash Co': { client: 'Trash Co', laiBucket: 'trash', history: [] },
  },
  orders: [{ client: 'Orders Only' }],
});

test('buildEntries: one entry per day, newest first, summary text, directions and last times', () => {
  const entries = W.buildEntries(W.parseExport(sample('android-24h.txt')).messages, opts());
  assert.equal(entries.length, 2);
  const [second, first] = entries;
  assert.equal(first.chatRef.day, '2026-10-12');
  assert.equal(second.chatRef.day, '2026-10-13');
  assert.equal(first.type, 'chat');
  assert.equal(first.subtype, 'whatsapp');
  assert.equal(first.channel, 'WhatsApp');
  assert.equal(first.owner, 'Amy');
  assert.equal(first.contact, 'Maria Test');
  assert.deepEqual(first.chatRef, { src: 'export', importId: 'imp-1', peer: '+447700900123', day: '2026-10-12' });
  assert.equal(first.lines.length, 4);
  assert.deepEqual(first.lines.map(line => line.dir), ['in', 'out', 'in', 'in']);
  assert.equal(first.lines[1].from, 'Li Wei');
  assert.equal(first.time, at(2026, 10, 12, 14, 10));
  assert.equal(first.lastSentAt, at(2026, 10, 12, 14, 7));
  assert.equal(first.lastReceivedAt, at(2026, 10, 12, 14, 10));
  assert.match(first.text, /^WhatsApp 聊天 4 条（发出 1，收到 3）\n/);
  assert.match(first.text, /Hello, is the lash box still available\?/);
  assert.ok(first.text.split('\n').slice(1).join('\n').length <= 141);
  assert.equal(second.lastReceivedAt, at(2026, 10, 13, 18, 2));
  assert.equal(second.lines.filter(line => line.dir === 'out').length, 2);
  for (const entry of entries) for (const line of entry.lines) assert.match(line.key, /^[0-9a-z]{6,}$/);
  assert.equal(new Set(entries.flatMap(entry => entry.lines.map(line => line.key))).size, 7);
});

test('buildEntries: "me" can be several names, case and spacing do not matter; nobody marked means all received', () => {
  const messages = W.parseExport('15/10/2026, 10:00 - Li  Wei: a\n15/10/2026, 10:01 - 李伟: b\n15/10/2026, 10:02 - Maria: c').messages;
  const entry = W.buildEntries(messages, opts({ me: ['li wei', '李伟'] }))[0];
  assert.deepEqual(entry.lines.map(line => line.dir), ['out', 'out', 'in']);
  const none = W.buildEntries(messages, opts({ me: '' }))[0];
  assert.deepEqual(none.lines.map(line => line.dir), ['in', 'in', 'in']);
  assert.equal(none.lastSentAt, undefined);
  assert.equal('lastSentAt' in none, false);
});

test('buildEntries: system notices stay out, group chats become whatsappgroup, subtype can be forced', () => {
  const group = W.parseExport(sample('group.txt'));
  const entry = W.buildEntries(group.messages, opts({ me: 'Li Wei', peer: '' }))[0];
  assert.equal(entry.subtype, 'whatsappgroup');
  assert.equal(entry.lines.length, 3);
  assert.equal(W.buildEntries(group.messages, opts({ me: 'Li Wei', subtype: 'whatsapp' }))[0].subtype, 'whatsapp');
  const oneToOne = W.buildEntries(W.parseExport(sample('android-24h.txt')).messages, opts());
  assert.equal(oneToOne.every(item => item.subtype === 'whatsapp'), true);
  assert.equal(oneToOne.flatMap(item => item.lines).some(line => /end-to-end/.test(line.text)), false);
});

test('buildEntries: caps per line and per entry, and a missing import id is refused', () => {
  const long = W.buildEntries(W.parseExport('15/10/2026, 10:00 - Maria: ' + 'a'.repeat(5000)).messages, opts())[0];
  assert.equal(long.lines[0].text.length, 4000);
  assert.ok(long.lines[0].text.endsWith('…'));
  const lines = Array.from({ length: 4500 }, (_, i) => `15/10/2026, 10:00 - Maria: m${i}`).join('\n');
  const entries = W.buildEntries(W.parseExport(lines).messages, opts());
  assert.deepEqual(entries.map(item => item.lines.length), [500, 2000, 2000]);
  assert.equal(entries[0].lines[0].text, 'm4000'); // newest chunk first
  assert.ok(entries.every(item => item.chatRef.day === '2026-10-15'));
  assert.throws(() => W.buildEntries([], { me: 'x' }), /导入编号/);
  assert.deepEqual(W.buildEntries([], opts()), []);
});

test('the same message twice in one minute is kept twice, with different keys', () => {
  const messages = W.parseExport('15/10/2026, 10:00 - Maria: ok\n15/10/2026, 10:00 - Maria: ok\n15/10/2026, 10:00 - Maria: ok').messages;
  const entry = W.buildEntries(messages, opts())[0];
  assert.equal(entry.lines.length, 3);
  assert.equal(new Set(entry.lines.map(line => line.key)).size, 3);
  // keys do not depend on the import or on who "me" is
  const again = W.buildEntries(messages, opts({ importId: 'imp-9', me: 'Maria' }))[0];
  assert.deepEqual(again.lines.map(line => line.key), entry.lines.map(line => line.key));
});

// ---------- merge, re-import, undo ----------
const row = (extra = {}) => ({ id: 'imp-1', at: '2026-10-16T01:00:00.000Z', operator: 'Amy', file: 'WhatsApp Chat with Maria Test.zip', ...extra });

test('mergeImport: adds entries newest-first in the right place, writes the log row, keeps other history', () => {
  const entries = W.buildEntries(W.parseExport(sample('android-24h.txt')).messages, opts());
  const result = W.mergeImport(baseState(), 'Lash Co', entries, row());
  assert.equal(result.added, 7);
  assert.equal(result.skipped, 0);
  const history = result.state.customers['Lash Co'].history;
  assert.deepEqual(history.map(item => item.type), ['followup', 'chat', 'chat', 'operation']); // the follow-up (14 Oct) is newer than both chat days
  assert.deepEqual(history.filter(item => item.type === 'chat').map(item => item.chatRef.day), ['2026-10-13', '2026-10-12']);
  assert.equal(result.state.customers['Lash Co'].updated, '2026-10-16T01:00:00.000Z');
  assert.deepEqual(result.state.laiChatImports, [{ id: 'imp-1', at: '2026-10-16T01:00:00.000Z', operator: 'Amy', customer: 'Lash Co', file: 'WhatsApp Chat with Maria Test.zip', added: 7, skipped: 0, undone: false }]);
  assert.equal(baseState().customers['Lash Co'].history.length, 2);
  assert.deepEqual(result.state.customers['Other Co'], baseState().customers['Other Co']);
  assert.deepEqual(result.state.orders, baseState().orders);
});

test('mergeImport: importing the same file again skips every line; an overlapping export adds only the new ones', () => {
  const messages = W.parseExport(sample('android-24h.txt')).messages;
  const first = W.mergeImport(baseState(), 'Lash Co', W.buildEntries(messages, opts()), row());
  const second = W.mergeImport(first.state, 'Lash Co', W.buildEntries(messages, opts({ importId: 'imp-2' })), row({ id: 'imp-2' }));
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 7);
  assert.equal(second.state.customers['Lash Co'].history.length, first.state.customers['Lash Co'].history.length);
  assert.equal(second.state.customers['Lash Co'], first.state.customers['Lash Co']); // untouched, not even re-written
  assert.deepEqual(second.state.laiChatImports.map(item => [item.id, item.added, item.skipped]), [['imp-2', 0, 7], ['imp-1', 7, 0]]);

  // a later export of the same chat: old lines skipped, the twice-sent message counted per occurrence
  const later = W.parseExport(sample('android-24h.txt') + '14/10/2026, 08:00 - Maria Test: One more\n13/10/2026, 09:30 - Li Wei: Sending it now. 👍\n').messages;
  const third = W.mergeImport(first.state, 'Lash Co', W.buildEntries(later, opts({ importId: 'imp-3' })), row({ id: 'imp-3' }));
  assert.equal(third.skipped, 7);
  assert.equal(third.added, 2); // "One more", plus a third copy of the 09:30 message
  const days = third.state.customers['Lash Co'].history.filter(item => item.type === 'chat' && item.chatRef.importId === 'imp-3');
  assert.deepEqual(days.map(item => [item.chatRef.day, item.lines.length]).sort(), [['2026-10-13', 1], ['2026-10-14', 1]]);
  const partial = days.find(item => item.chatRef.day === '2026-10-13');
  assert.match(partial.text, /^WhatsApp 聊天 1 条（发出 1，收到 0）/); // summary rebuilt from the kept lines
  assert.equal(partial.lastSentAt, partial.time);
});

test('mergeImport: the same message sent twice in a minute survives a re-import of a bigger export', () => {
  const one = W.parseExport('15/10/2026, 10:00 - Maria: ok').messages;
  const two = W.parseExport('15/10/2026, 10:00 - Maria: ok\n15/10/2026, 10:00 - Maria: ok').messages;
  const first = W.mergeImport(baseState(), 'Lash Co', W.buildEntries(one, opts()), row());
  const second = W.mergeImport(first.state, 'Lash Co', W.buildEntries(two, opts({ importId: 'imp-2' })), row({ id: 'imp-2' }));
  assert.equal(second.added, 1);
  assert.equal(second.skipped, 1);
});

test('mergeImport: unknown, trashed customers and an orders-only customer', () => {
  const entries = W.buildEntries(W.parseExport('15/10/2026, 10:00 - Maria: ok').messages, opts());
  assert.throws(() => W.mergeImport(baseState(), 'Nobody', entries, row()), /客户不存在/);
  assert.throws(() => W.mergeImport(baseState(), '__proto__', entries, row()), /客户不存在/);
  assert.throws(() => W.mergeImport(baseState(), 'Trash Co', entries, row()), /回收站/);
  assert.throws(() => W.mergeImport(baseState(), 'Lash Co', [], row()), /没有可导入/);
  const orders = W.mergeImport(baseState(), 'Orders Only', entries, row());
  assert.equal(orders.state.customers['Orders Only'].history.length, 1);
  assert.equal(orders.state.customers['Orders Only'].client, 'Orders Only');
  assert.throws(() => W.mergeImport({ ...baseState(), laiChatImports: 'broken' }, 'Lash Co', entries, row()), /格式异常/);
});

test('mergeImport: caps for lines per import and chat text per customer', () => {
  const big = Array.from({ length: 20001 }, (_, i) => ({ at: at(2026, 10, 12, 10, 0), local: '2026-10-12T10:00:00', from: 'Maria', text: 'm' + i }));
  // build in chunks so buildEntries itself is not the one that refuses
  const lines = big.slice(0, 20000);
  const entries = W.buildEntries(lines, opts());
  const extra = W.buildEntries([big[20000]], opts({ importId: 'imp-x' }));
  assert.throws(() => W.mergeImport(baseState(), 'Lash Co', [...entries, ...extra], row()), /20000/);
  assert.throws(() => W.buildEntries(big, opts()), /20000/);
  assert.equal(W.mergeImport(baseState(), 'Lash Co', entries, row()).added, 20000);

  // per customer 1 MB: 300 lines of 4000 characters
  const text = 'x'.repeat(4000);
  const chunk = n => W.buildEntries(Array.from({ length: n }, (_, i) => ({ at: at(2026, 10, 12, 10, i % 60), local: `2026-10-12T10:${String(i % 60).padStart(2, '0')}:00`, from: 'Maria', text: text + i })), opts({ importId: 'imp-big' }));
  const fits = W.mergeImport(baseState(), 'Lash Co', chunk(250), row({ id: 'imp-big' }));
  assert.equal(fits.added, 250);
  assert.throws(() => W.mergeImport(fits.state, 'Lash Co', W.buildEntries([{ at: at(2026, 10, 20, 10, 0), local: '2026-10-20T10:00:00', from: 'Maria', text: 'y'.repeat(4000) }, ...Array.from({ length: 20 }, (_, i) => ({ at: at(2026, 10, 20, 11, i), local: `2026-10-20T11:${String(i).padStart(2, '0')}:00`, from: 'Maria', text: 'z'.repeat(4000) + i }))], opts({ importId: 'imp-more' })), 'Lash Co', row({ id: 'imp-more' })), /1 MB/);
  // nothing was changed by the failed attempt
  assert.equal(fits.state.customers['Lash Co'].history.length, baseState().customers['Lash Co'].history.length + 1);
});

test('mergeImport keeps at most 200 log rows, newest first', () => {
  let state = baseState();
  for (let i = 0; i < 205; i++) {
    const entries = W.buildEntries(W.parseExport(`15/10/2026, 10:00 - Maria: n${i}`).messages, opts({ importId: `imp-${i}` }));
    state = W.mergeImport(state, 'Lash Co', entries, row({ id: `imp-${i}` })).state;
  }
  assert.equal(state.laiChatImports.length, 200);
  assert.equal(state.laiChatImports[0].id, 'imp-204');
  assert.equal(state.laiChatImports[199].id, 'imp-5');
});

test('undoImport removes the import everywhere by id, even after the customer was renamed; marks the row undone', () => {
  const messages = W.parseExport(sample('android-24h.txt')).messages;
  let state = W.mergeImport(baseState(), 'Lash Co', W.buildEntries(messages, opts()), row()).state;
  const other = W.parseExport('15/10/2026, 10:00 - Pat: hi').messages;
  state = W.mergeImport(state, 'Other Co', W.buildEntries(other, opts({ importId: 'imp-2' })), row({ id: 'imp-2', file: 'b.txt' })).state;
  // the customer is renamed after the import
  const renamed = { ...state, customers: { ...state.customers, 'Lash Company': { ...state.customers['Lash Co'], client: 'Lash Company' } } };
  delete renamed.customers['Lash Co'];
  assert.deepEqual(W.importFootprint(renamed, 'imp-1'), { customers: ['Lash Company'], entries: 2, lines: 7 });
  const undone = W.undoImport(renamed, 'imp-1');
  assert.deepEqual(undone.customers['Lash Company'].history.map(item => item.type), ['followup', 'operation']);
  assert.equal(undone.customers['Other Co'].history.length, 1); // the other import is untouched
  assert.deepEqual(undone.laiChatImports.map(item => [item.id, item.undone]), [['imp-2', false], ['imp-1', true]]);
  assert.equal(undone.laiChatImports[1].customer, 'Lash Co'); // the log keeps what was true at the time
  assert.equal(undone.customers['Lash Company'].updated, renamed.customers['Lash Company'].updated);
  assert.equal(renamed.customers['Lash Company'].history.length, 4); // input state not mutated
  assert.throws(() => W.undoImport(undone, 'imp-1'), /撤销过了/);
  assert.throws(() => W.undoImport(undone, 'imp-zzz'), /找不到/);
  // after an undo the same file can be imported again
  const again = W.mergeImport(undone, 'Lash Company', W.buildEntries(messages, opts({ importId: 'imp-3' })), row({ id: 'imp-3' }));
  assert.equal(again.added, 7);
});

test('undoImport works on a trashed customer and when the log row was lost', () => {
  const entries = W.buildEntries(W.parseExport('15/10/2026, 10:00 - Maria: ok').messages, opts());
  let state = W.mergeImport(baseState(), 'Lash Co', entries, row()).state;
  state = { ...state, laiChatImports: [] };
  const undone = W.undoImport(state, 'imp-1');
  assert.deepEqual(undone.customers['Lash Co'].history.map(item => item.type), ['followup', 'operation']);
  assert.deepEqual(undone.laiChatImports, []);
});

// ---------- manual log, merge of customers ----------
test('logChat adds a one-line outgoing entry (manual or link)', () => {
  const when = at(2026, 10, 16, 9, 30);
  const state = W.logChat(baseState(), 'Lash Co', { text: 'Sent the price list', contact: 'Maria Test', peer: '+447700900123', owner: 'Amy', src: 'link', at: when });
  const entry = state.customers['Lash Co'].history.find(item => item.type === 'chat');
  assert.equal(state.customers['Lash Co'].history[0], entry); // newest
  assert.equal(entry.subtype, 'whatsapp');
  assert.equal(entry.chatRef.src, 'link');
  assert.equal(entry.chatRef.day, '2026-10-16');
  assert.equal(entry.chatRef.peer, '+447700900123');
  assert.equal('importId' in entry.chatRef, false);
  assert.equal(entry.time, when);
  assert.equal(entry.lastSentAt, when);
  assert.equal(entry.lastReceivedAt, undefined);
  assert.equal(entry.lines.length, 1);
  assert.deepEqual({ ...entry.lines[0], key: undefined }, { at: when, from: 'Amy', dir: 'out', text: 'Sent the price list', key: undefined });
  assert.match(entry.text, /^WhatsApp 聊天 1 条（发出 1，收到 0）\nSent the price list$/);
  assert.equal(W.logChat(baseState(), 'Lash Co', { text: 'x', src: 'weird' }).customers['Lash Co'].history[0].chatRef.src, 'manual');
  assert.equal(W.logChat(baseState(), 'Lash Co', { text: 'x' }).customers['Lash Co'].history[0].lines[0].from, '我');
  assert.throws(() => W.logChat(baseState(), 'Lash Co', { text: '  ' }), /写下/);
  assert.throws(() => W.logChat(baseState(), 'Lash Co', { text: 'x'.repeat(4001) }), /太长/);
  assert.throws(() => W.logChat(baseState(), 'Nobody', { text: 'x' }), /客户不存在/);
  assert.throws(() => W.logChat(baseState(), 'Trash Co', { text: 'x' }), /回收站/);
});

test('mergeChatHistory drops duplicate chat lines when two customers are merged', () => {
  const messages = W.parseExport(sample('android-24h.txt')).messages;
  const full = W.buildEntries(messages, opts());
  const a = [...full, { time: '2026-01-01T00:00:00.000Z', text: '新建客户档案', type: 'operation' }];
  // B holds the same chat again (imported on the other customer) plus one new line and an unrelated follow-up
  const extra = W.parseExport(sample('android-24h.txt') + '14/10/2026, 08:00 - Maria Test: One more\n').messages;
  const b = [{ time: '2026-10-14T09:00:00.000Z', text: '跟进', type: 'followup' }, ...W.buildEntries(extra, opts({ importId: 'imp-b' }))];
  const merged = W.mergeChatHistory(a, b);
  const lines = merged.flatMap(item => (item.type === 'chat' ? item.lines : []));
  assert.equal(lines.length, 8); // 7 + "One more"
  assert.equal(new Set(lines.map(line => line.key)).size, 8);
  assert.equal(merged.filter(item => item.type === 'followup').length, 1);
  assert.equal(merged.filter(item => item.type === 'operation').length, 1);
  assert.equal(merged.filter(item => item.type === 'chat').length, 3); // two days from A, the new day from B
  const times = merged.map(item => Date.parse(item.time));
  assert.deepEqual(times, [...times].sort((x, y) => y - x)); // newest first
  assert.equal(W.mergeChatHistory(a, a).length, a.length + 1); // merging identical histories repeats only the non-chat entry
  assert.deepEqual(W.mergeChatHistory(undefined, undefined), []);
  assert.deepEqual(W.mergeChatHistory(a, []).length, a.length);
  // old chat entries without lines pass through untouched
  const legacy = { time: '2026-02-01T00:00:00.000Z', type: 'chat', text: '微信聊过' };
  assert.ok(W.mergeChatHistory([legacy], [legacy]).length === 2);
});

test('a whole flow: file text -> preview -> match -> entries -> merge -> undo', () => {
  const result = W.parseExport(sample('group.txt').replace(/\+44 7700 900124/g, '+44 7700 900123').replace(/Li Wei changed.*\n/, ''));
  const peers = W.peersFromSenders(result.senders);
  const state = baseState();
  state.customers['Lash Co'].phone = '07700 900123';
  state.customers['Lash Co'].country = '英国';
  const match = W.matchCustomers(state, { peers, names: [W.chatNameFromFile('WhatsApp Chat with Maria Test.zip')] });
  assert.equal(match.candidates[0].name, 'Lash Co');
  const entries = W.buildEntries(result.messages, opts({ peer: peers[0] }));
  const merged = W.mergeImport(state, match.candidates[0].name, entries, row());
  assert.equal(merged.added, 3);
  assert.equal(W.undoImport(merged.state, 'imp-1').customers['Lash Co'].history.length, 2);
});

// ---------- 50,000 lines per customer ----------
// Short messages: the 1 MB character cap alone would let a customer collect millions of lines.
const bulkEntries = (count, startMs, tag, perEntry = 2000) => {
  const out = [];
  for (let i = 0; i < count; i += perEntry) {
    const lines = Array.from({ length: Math.min(perEntry, count - i) }, (_, j) => ({ at: new Date(startMs + (i + j) * 1000).toISOString(), from: 'Maria', dir: 'in', text: 'k', key: `${tag}-${i + j}` }));
    out.unshift({ type: 'chat', subtype: 'whatsapp', channel: 'WhatsApp', time: lines.at(-1).at, text: 'x', lastReceivedAt: lines.at(-1).at, lines, chatRef: { src: 'export', importId: tag, peer: '', day: '2026-01-01' } });
  }
  return out;
};
const lineTotal = history => history.reduce((sum, entry) => sum + (entry.type === 'chat' && Array.isArray(entry.lines) ? entry.lines.length : 0), 0);

test('the number of chat lines per customer is capped at 50,000 (import and manual 记一笔)', () => {
  assert.equal(W.LIMITS.customerLines, 50000);
  const full = baseState();
  full.customers['Lash Co'].history = [...bulkEntries(49990, Date.UTC(2026, 0, 1), 'old'), ...full.customers['Lash Co'].history];
  const more = n => W.buildEntries(Array.from({ length: n }, (_, i) => ({ at: at(2026, 10, 20, 10, i % 60, Math.floor(i / 60)), local: `2026-10-20T10:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}`, from: 'Maria', text: `n${i}` })), opts({ importId: 'imp-more' }));
  assert.throws(() => W.mergeImport(full, 'Lash Co', more(20), row({ id: 'imp-more' })), /50000/);
  assert.equal(lineTotal(full.customers['Lash Co'].history), 49990, 'a refused import changes nothing');
  assert.equal(W.mergeImport(full, 'Lash Co', more(10), row({ id: 'imp-more' })).added, 10, 'right up to the cap is fine');
  let state = full;
  for (let i = 0; i < 10; i++) state = W.logChat(state, 'Lash Co', { text: `hi ${i}`, at: at(2026, 10, 21, 9, i) });
  assert.equal(lineTotal(state.customers['Lash Co'].history), 50000);
  assert.throws(() => W.logChat(state, 'Lash Co', { text: 'one more', at: at(2026, 10, 21, 10, 0) }), /已经很多/);
});

test('mergeChatHistoryCapped keeps the newest lines under the cap and reports how many were dropped', () => {
  const a = [...bulkEntries(30001, Date.UTC(2026, 0, 1), 'a'), { time: '2026-01-01T00:00:00.000Z', text: '新建客户档案', type: 'operation' }];
  const b = [{ time: '2026-09-01T00:00:00.000Z', text: '跟进', type: 'followup' }, ...bulkEntries(30000, Date.UTC(2026, 5, 1), 'b')];
  const merged = W.mergeChatHistoryCapped(a, b);
  assert.equal(merged.dropped, 10001);
  assert.equal(lineTotal(merged.history), 50000);
  const keys = new Set(merged.history.flatMap(entry => (entry.lines || []).map(line => line.key)));
  assert.equal([...keys].filter(key => key.startsWith('b-')).length, 30000, 'the newer chat is complete');
  assert.ok(keys.has('a-30000') && keys.has('a-10001') && !keys.has('a-0') && !keys.has('a-10000'), 'the 10,001 oldest lines are the ones dropped');
  assert.equal(merged.history.filter(entry => entry.type === 'followup' || entry.type === 'operation').length, 2, 'other entries stay');
  const times = merged.history.map(entry => Date.parse(entry.time));
  assert.deepEqual(times, [...times].sort((x, y) => y - x), 'still newest first');
  // trimmed entries are summarised again from what is left
  const trimmed = merged.history.find(entry => entry.lines && entry.lines.some(line => line.key === 'a-10001'));
  assert.equal(trimmed.lines[0].key, 'a-10001');
  assert.match(trimmed.text, new RegExp(`WhatsApp 聊天 ${trimmed.lines.length} 条`));
  // below the cap nothing is dropped and the plain wrapper returns the same history
  const small = W.mergeChatHistoryCapped(bulkEntries(10, Date.UTC(2026, 0, 1), 's'), bulkEntries(10, Date.UTC(2026, 2, 1), 't'));
  assert.equal(small.dropped, 0);
  assert.equal(lineTotal(small.history), 20);
  assert.deepEqual(W.mergeChatHistory(a, b), merged.history);
  // the 1 MB character cap applies to a merge too
  const fat = (tag, ms) => [{ type: 'chat', time: new Date(ms + 299000).toISOString(), text: 'x', lines: Array.from({ length: 300 }, (_, i) => ({ at: new Date(ms + i * 1000).toISOString(), from: 'M', dir: 'in', text: 'z'.repeat(4000), key: `${tag}${i}` })) }];
  const chars = W.mergeChatHistoryCapped(fat('p', Date.UTC(2026, 0, 1)), fat('q', Date.UTC(2026, 1, 1)));
  assert.equal(chars.dropped, 600 - Math.floor(W.LIMITS.customerChars / 4000));
  assert.ok(chars.history.every(entry => entry.lines.every(line => !line.key.startsWith('p') || Number(line.key.slice(1)) >= 0)));
  assert.ok(chars.history.flatMap(entry => entry.lines).reduce((sum, line) => sum + line.text.length, 0) <= W.LIMITS.customerChars);
});
