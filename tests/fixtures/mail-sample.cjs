'use strict';
// 合成的示例邮件，全部是虚构内容，仅供测试与界面检查。
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function inlineImageMessage(me) {
  const lines = [
    'From: "Design Team" <design@nordic-lamps.example>', `To: ${me.address}`, 'Subject: Catalogue cover', 'Date: Mon, 05 Oct 2026 09:00:00 +0000', 'Message-ID: <inline-1@nordic-lamps.example>', 'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="rel-1"', '',
    '--rel-1', 'Content-Type: text/html; charset=UTF-8', '', '<p>Cover draft:</p><img src="cid:cover@x" alt="cover"><img src="https://tracker.example/pixel.gif"><script>document.title="pwned"</script>',
    '--rel-1', 'Content-Type: image/png; name="cover.png"', 'Content-Transfer-Encoding: base64', 'Content-ID: <cover@x>', 'Content-Disposition: inline; filename="cover.png"', '', png.toString('base64'),
    '--rel-1--', ''];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

function gbkMessage(me) {
  // 你好，报价如下  (GBK)
  const subject = Buffer.from([0xb1, 0xa8, 0xbc, 0xdb, 0xc8, 0xb7, 0xc8, 0xcf]);   // 报价确认
  const body = Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xb1, 0xa8, 0xbc, 0xdb, 0xc8, 0xe7, 0xcf, 0xc2]); // 你好，报价如下
  return Buffer.concat([Buffer.from(['From: =?GBK?B?' + Buffer.from([0xcd, 0xf5, 0xc0, 0xda]).toString('base64') + '?= <wanglei@shenzhen-parts.example>', `To: ${me.address}`,
    'Subject: =?GB2312?B?' + subject.toString('base64') + '?=', 'Date: Sun, 04 Oct 2026 03:30:00 +0000', 'Message-ID: <gbk-1@shenzhen-parts.example>', 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=gb2312', 'Content-Transfer-Encoding: 8bit', '', ''].join('\r\n'), 'latin1'), body, Buffer.from('\r\n')]);
}

function mailboxes(me) {
  const anna = { name: 'Anna Berg', address: 'anna@nordic-lamps.example' };
  const li = { name: '李伟', address: 'liwei@shenzhen-parts.example' };
  return {
    INBOX: [
      { message: gbkMessage(me), flags: ['\\Seen'] },
      { message: inlineImageMessage(me), flags: ['\\Seen'] },
      { message: { from: anna, to: [me], subject: 'Re: Quotation for LED panels', date: '2026-10-05T14:20:00Z', text: 'Hi,\n\nThe price works for us. Please send the proforma invoice.\n\nAnna', html: '<p>Hi,</p><p>The price works for us. Please send the <b>proforma invoice</b>.</p><p>Anna</p>', messageId: '<q-2@nordic-lamps.example>' }, flags: ['\\Flagged'] },
      { message: { from: li, to: [me], cc: [{ name: '', address: 'purchasing@shenzhen-parts.example' }], subject: '样品寄送确认 — 10月批次', date: '2026-10-06T02:10:00Z', text: '您好，\n\n样品已于今天寄出，附件是装箱单。\n\n李伟', attachments: [{ filename: '装箱单 2026-10.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 synthetic packing list') }, { filename: 'photo.png', contentType: 'image/png', content: png }], messageId: '<s-9@shenzhen-parts.example>' }, flags: [] },
      { message: { from: { name: 'Zoho', address: 'noreply@notifications.example' }, to: [me], subject: 'Your weekly summary', date: '2026-10-06T06:00:00Z', text: 'Nothing new this week.', messageId: '<n-1@notifications.example>' }, flags: [] },
    ],
    Sent: [
      { message: { from: me, to: [anna], subject: 'Quotation for LED panels', date: '2026-10-04T08:00:00Z', text: 'Hi Anna,\n\nPlease find our quotation below.\n\nRegards', messageId: '<q-1@example-trade.com>' }, flags: ['\\Seen'] },
    ],
  };
}

module.exports = { mailboxes, png, inlineImageMessage, gbkMessage };
