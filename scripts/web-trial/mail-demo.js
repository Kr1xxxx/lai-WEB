/* 来财Lai 网页试用版：示例邮箱。网页里连不到真实邮箱，这里用一组虚构的示例邮件模拟本机邮件接口，
   让邮件页的列表、阅读、回复、写信、草稿、客户往来可以试用。写信只会放进示例的发件箱，不会发出任何邮件；刷新页面后恢复原样。
   接口形状对照 backend/mail-service.js。发布试用版时把本文件作为一个 <script> 放在数据替身脚本之后。 */
(function (root) {
  'use strict';
  var ME = 'demo@lai-trial.example', nextUid = 100, nextDraft = 1;
  var account = {provider: 'zoho', email: ME, site: 'cn', accountType: 'organization', host: '', port: 0, boundAt: '2026-10-01T01:00:00.000Z', verifiedAt: '2026-10-01T01:00:00.000Z', demo: true};
  function person(name, address) { return {name: name, address: address}; }
  var me = person('', ME), anna = person('Anna Berg', 'anna@nordic-lamps.example'), li = person('李伟', 'liwei@shenzhen-parts.example'), omar = person('Omar Haddad', 'omar@gulf-lighting.example');
  function hoursAgo(n) { return new Date(Date.now() - n * 3600000).toISOString(); }
  var messages = [
    {box: 'inbox', uid: 5, from: li, to: [me], cc: [person('', 'purchasing@shenzhen-parts.example')], subject: '【示例】样品寄送确认 — 10月批次', date: hoursAgo(2), seen: false, pending: false, text: '您好，\n\n样品已于今天寄出，快递单号稍后补发。装箱单见附件。\n\n李伟', html: '', attachments: [{index: 0, filename: '装箱单 2026-10.pdf', contentType: 'application/pdf', size: 48213}], messageId: '<demo-5@shenzhen-parts.example>'},
    {box: 'inbox', uid: 4, from: anna, to: [me], cc: [], subject: '[Sample] Re: Quotation for LED panels', date: hoursAgo(20), seen: false, pending: true, text: 'Hi,\n\nThe price works for us. Please send the proforma invoice for 500 pcs.\n\nBest regards,\nAnna', html: '<p>Hi,</p><p>The price works for us. Please send the <b>proforma invoice</b> for 500 pcs.</p><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Item</th><th>Qty</th><th>Unit price</th></tr><tr><td>LED panel 60×60</td><td>500</td><td>USD 12.40</td></tr></table><p>Best regards,<br>Anna</p>', attachments: [], messageId: '<demo-4@nordic-lamps.example>', references: '<demo-1@lai-trial.example>'},
    {box: 'inbox', uid: 3, from: omar, to: [me], cc: [], subject: '[Sample] Inquiry: 2,000 pcs downlights, CIF Jebel Ali', date: hoursAgo(30), seen: false, pending: false, text: 'Dear Sales,\n\nWe are looking for 2,000 pcs of 12W downlights, CIF Jebel Ali. Please share your best price, MOQ and lead time.\n\nOmar Haddad\nGulf Lighting Trading', html: '', attachments: [], messageId: '<demo-3@gulf-lighting.example>'},
    {box: 'inbox', uid: 2, from: person('Zoho Mail', 'noreply@mail-notice.example'), to: [me], cc: [], subject: '【示例】本周邮箱使用摘要', date: hoursAgo(52), seen: true, pending: false, text: '这是一封示例通知邮件。\n\n本周收到 12 封，发出 7 封。', html: '', attachments: [], messageId: '<demo-2@mail-notice.example>'},
    {box: 'sent', uid: 1, from: me, to: [anna], cc: [], subject: '[Sample] Quotation for LED panels', date: hoursAgo(44), seen: true, pending: false, text: 'Hi Anna,\n\nPlease find our quotation for LED panels below.\n\nLED panel 60×60 — USD 12.40 / pc, MOQ 300 pcs, lead time 25 days.\n\nRegards', html: '', attachments: [], messageId: '<demo-1@lai-trial.example>'}
  ];
  var drafts = [];
  function json(status, body) { return new Response(JSON.stringify(body), {status: status, headers: {'Content-Type': 'application/json'}}); }
  function bad(message) { return json(400, {ok: false, code: 'invalid_input', message: message}); }
  function summary(m) { return {box: m.box, uid: m.uid, from: m.from, to: m.to, cc: m.cc, subject: m.subject, messageId: m.messageId, date: m.date, size: (m.text || '').length, seen: m.seen, pending: m.pending, answered: false, hasAttachment: m.attachments.length > 0}; }
  function addresses(text) {
    var out = [];
    String(text || '').split(/[,;]/).forEach(function (piece) {
      var match = /<([^>]+)>/.exec(piece), address = (match ? match[1] : piece).trim().toLowerCase(), name = match ? piece.slice(0, piece.indexOf('<')).replace(/"/g, '').trim() : '';
      if (address) out.push({name: name, address: address, valid: /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(address)});
    });
    return out;
  }
  function counts() {
    var inbox = messages.filter(function (m) { return m.box === 'inbox'; });
    return {unread: inbox.filter(function (m) { return !m.seen; }).length, pending: inbox.filter(function (m) { return m.pending; }).length};
  }
  function find(box, uid) { for (var i = 0; i < messages.length; i++) if (messages[i].box === box && messages[i].uid === Number(uid)) return messages[i]; return null; }
  function related(m, list) { return [m.from].concat(m.to, m.cc).some(function (p) { return list.indexOf(p.address) >= 0; }); }

  function handle(path, method, query, body) {
    if (path === '/api/mail-account' && method === 'GET') return json(200, {ok: true, available: false, account: account});
    if (path.indexOf('/api/mail-account/') === 0) return json(501, {ok: false, message: '网页试用版无法连接真实邮箱。请在 Mac 上安装的来财应用里绑定。'});
    if (path === '/api/mail/messages') {
      var folder = query.get('folder'), text = String(query.get('query') || '').trim().toLowerCase();
      if (['inbox', 'unread', 'pending', 'sent'].indexOf(folder) < 0) return bad('不支持的邮件文件夹');
      var rows = messages.filter(function (m) {
        if (folder === 'sent') return m.box === 'sent';
        return m.box === 'inbox' && (folder !== 'unread' || !m.seen) && (folder !== 'pending' || m.pending);
      }).filter(function (m) { return !text || [m.subject, m.from.name, m.from.address].concat(m.to.map(function (p) { return p.name + ' ' + p.address; })).join(' ').toLowerCase().indexOf(text) >= 0; });
      rows.sort(function (a, b) { return b.date.localeCompare(a.date); });
      var answer = {ok: true, folder: folder, page: 1, pageSize: 50, total: rows.length, items: rows.map(summary)};
      if (folder !== 'sent') answer.counts = counts();
      return json(200, answer);
    }
    if (path === '/api/mail/correspondence') {
      var list = String(query.get('addresses') || '').toLowerCase().split(',').filter(Boolean);
      return json(200, {ok: true, addresses: list, items: messages.filter(function (m) { return related(m, list); }).sort(function (a, b) { return b.date.localeCompare(a.date); }).map(summary)});
    }
    if (path === '/api/mail/message') {
      var m = find(query.get('box'), query.get('uid'));
      if (!m) return json(404, {ok: false, code: 'not_found', message: '这封邮件已经不在邮箱里了，可能已被移动或删除。'});
      m.seen = true;
      return json(200, {ok: true, message: {box: m.box, uid: m.uid, from: m.from, to: m.to, cc: m.cc, replyTo: [], subject: m.subject, date: m.date, messageId: m.messageId, references: m.references || '', text: m.text, html: m.html, attachments: m.attachments, seen: true, pending: m.pending}});
    }
    if (path === '/api/mail/drafts' && method === 'GET') return json(200, {ok: true, items: drafts.slice().sort(function (a, b) { return b.updatedAt.localeCompare(a.updatedAt); })});
    if (method !== 'POST') return json(404, {ok: false, message: 'not found'});
    if (path === '/api/mail/flags') {
      var target = find(body.box, body.uid);
      if (!target) return json(404, {ok: false, code: 'not_found', message: '这封邮件已经不在邮箱里了。'});
      if (typeof body.seen === 'boolean') target.seen = body.seen;
      if (typeof body.pending === 'boolean') target.pending = body.pending;
      return json(200, {ok: true});
    }
    if (path === '/api/mail/trash') { messages = messages.filter(function (m) { return !(m.box === body.box && m.uid === Number(body.uid)); }); return json(200, {ok: true}); }
    if (path === '/api/mail/attachment/save') return json(501, {ok: false, message: '网页试用版里的附件是示例，不能保存。在 Mac 应用里会保存到「下载」文件夹。'});
    if (path === '/api/mail/drafts/save') {
      var draft = {id: body.id || ('demo' + String(nextDraft++)), to: body.to || '', cc: body.cc || '', bcc: body.bcc || '', subject: body.subject || '', text: body.text || '', inReplyTo: body.inReplyTo || '', references: body.references || '', forwardOf: body.forwardOf || null, updatedAt: new Date().toISOString()};
      drafts = drafts.filter(function (d) { return d.id !== draft.id; }).concat([draft]);
      return json(200, {ok: true, draft: draft});
    }
    if (path === '/api/mail/drafts/delete') { drafts = drafts.filter(function (d) { return d.id !== body.id; }); return json(200, {ok: true}); }
    if (path === '/api/mail/send') {
      var to = addresses(body.to), cc = addresses(body.cc), bcc = addresses(body.bcc), everyone = to.concat(cc, bcc);
      if (!everyone.length) return bad('请至少填写一位收件人');
      var wrong = everyone.filter(function (p) { return !p.valid; })[0];
      if (wrong) return bad(wrong.address + ' 不是有效的邮箱地址');
      if (!String(body.subject || '').trim() && !String(body.text || '').trim()) return bad('主题和正文不能都为空');
      var strip = function (p) { return {name: p.name, address: p.address}; };
      var original = body.forwardOf && body.forwardAttachments !== false ? find(body.forwardOf.box, body.forwardOf.uid) : null;
      var files = (body.attachments || []).map(function (a, index) { return {index: index, filename: a.filename, contentType: a.contentType || 'application/octet-stream', size: Math.floor(String(a.contentBase64 || '').length * 3 / 4)}; });
      if (original) original.attachments.forEach(function (a) { files.push({index: files.length, filename: a.filename, contentType: a.contentType, size: a.size}); });
      var uid = nextUid++;
      messages.push({box: 'sent', uid: uid, from: {name: body.fromName || '', address: ME}, to: to.map(strip), cc: cc.map(strip), subject: body.subject || '', date: new Date().toISOString(), seen: true, pending: false, text: body.text || '', html: '', attachments: files, messageId: '<demo-' + uid + '@lai-trial.example>', references: body.references || ''});
      if (body.draftId) drafts = drafts.filter(function (d) { return d.id !== body.draftId; });
      if (body.fromName !== undefined) account.senderName = body.fromName;
      return json(200, {ok: true, messageId: '<demo-' + uid + '@lai-trial.example>', recipients: everyone.map(function (p) { return p.address; }), attachmentCount: files.length});
    }
    return json(404, {ok: false, message: 'not found'});
  }

  var previousFetch = root.fetch;
  root.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var match = /^(?:https?:\/\/[^\/]+)?(\/api\/mail(?:-account)?(?:\/[^?#]*)?)(?:\?([^#]*))?/.exec(String(url));
    if (!match) return previousFetch.apply(root, arguments);
    var body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (error) { return Promise.resolve(bad('请求内容无效')); }
    try { return Promise.resolve(handle(match[1], String(init && init.method || 'GET').toUpperCase(), new URLSearchParams(match[2] || ''), body || {})); }
    catch (error) { return Promise.resolve(json(500, {ok: false, message: '示例邮箱出错：' + error.message})); }
  };
  root.LaiWebTrialMailDemo = {account: function () { return account; }};
})(typeof window !== 'undefined' ? window : globalThis);
