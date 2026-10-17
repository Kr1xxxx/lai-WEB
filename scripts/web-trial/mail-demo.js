/* 来财Lai 网页试用版：示例邮箱。网页里连不到真实邮箱，这里用一组虚构的示例邮件模拟本机邮件接口，
   让邮件页的列表、阅读、回复、写信、草稿、客户往来可以试用。写信只会放进示例的发件箱，不会发出任何邮件；刷新页面后恢复原样。
   接口形状对照 backend/mail-service.js。发布试用版时把本文件作为一个 <script> 放在数据替身脚本之后。 */
(function (root) {
  'use strict';
  var ME = 'demo@lai-trial.example', nextUid = 100, nextDraft = 1;
  var account = {provider: 'zoho', email: ME, site: 'cn', accountType: 'organization', host: '', port: 0, boundAt: '2026-10-01T01:00:00.000Z', verifiedAt: '2026-10-01T01:00:00.000Z', demo: true};
  function person(name, address) { return {name: name, address: address}; }
  var me = person('', ME);
  // 示例客户：美国和欧洲的大型睫毛公司（虚构，邮箱域名都是 .example）。对应的客户资料由 demo-seed.js 放进试用数据，邮件页会自动认出这些发件人。
  var charlotte = person('Charlotte Hughes', 'charlotte@londonlashpro.example'), oliver = person('Oliver Grant', 'procurement@londonlashpro.example');
  var madison = person('Madison Cole', 'madison@velvetlashco.example'), lena = person('Lena Fischer', 'lena.fischer@nordlash.example');
  var camille = person('Camille Laurent', 'camille@maisondescils.example'), daniel = person('Daniel Ortiz', 'daniel@lashluxe.example');
  var giulia = person('Giulia Romano', 'giulia@bellaciglia.example'), sanne = person('Sanne de Vries', 'sanne@lashlab.example');
  function hoursAgo(n) { return new Date(Date.now() - n * 3600000).toISOString(); }
  var messages = [
    {box: 'inbox', uid: 13, from: charlotte, to: [me], cc: [oliver], subject: '[Sample] PO LLP-2410-01 — USD 50,000 Q4 order, please send the PI', date: hoursAgo(1), seen: false, pending: true,
      text: 'Hi team,\n\nThe samples were approved by our studio leads last week, so we would like to place our Q4 order now:\n\n1. Classic Mink Volume lashes 0.07 C-curl — 4,000 trays x USD 4.20 = USD 16,800\n2. Premade Fans 10D — 3,000 trays x USD 5.60 = USD 16,800\n3. Easy-Fan self-fanning 0.05 — 2,000 trays x USD 4.80 = USD 9,600\n4. Private-label lash glue 10 ml — 6,800 pcs x USD 1.00 = USD 6,800\n\nTotal: USD 50,000.00\n\nTerms as before: 30% deposit by TT on the PI, balance before shipment. We need delivery to our London warehouse by 15 November, so production should start this week.\n\nPlease send the proforma invoice today and we will release the deposit tomorrow morning.\n\nKind regards,\nCharlotte Hughes\nHead of Buying — London Lash Pro', html: '', attachments: [{index: 0, filename: 'PO-LLP-2410-01.pdf', contentType: 'application/pdf', size: 186400}], messageId: '<demo-13@londonlashpro.example>', inReplyTo: '<demo-5@lai-trial.example>', references: '<demo-5@lai-trial.example>'},
    {box: 'inbox', uid: 12, from: daniel, to: [me], cc: [], subject: '[Sample] Balance USD 21,300 wired today — please release shipment LLD-0917', date: hoursAgo(3), seen: false, pending: false,
      text: 'Hello,\n\nWe have just wired the balance of USD 21,300 for order LLD-0917 (total USD 42,600). The bank confirmation is attached.\n\nPlease release the shipment and send us the tracking number as soon as it is booked. Our Miami warehouse is expecting two pallets and the Black Friday campaign starts on the 20th, so we cannot afford a delay.\n\nThe next PO will be bigger — we are opening three new studios in Texas.\n\nBest,\nDaniel Ortiz\nPurchasing Director — Lash Luxe Distribution', html: '', attachments: [{index: 0, filename: 'wire-confirmation.pdf', contentType: 'application/pdf', size: 98304}], messageId: '<demo-12@lashluxe.example>', inReplyTo: '<demo-3@lai-trial.example>', references: '<demo-3@lai-trial.example>'},
    {box: 'inbox', uid: 11, from: madison, to: [me], cc: [], subject: '[Sample] Re: Holiday forecast — we are doubling our Q4 volume', date: hoursAgo(5), seen: false, pending: false,
      text: 'Hi,\n\nGood news: pre-orders for our holiday kits are running at twice last year. Wave 1 is the USD 38,600 order you already have in production. For wave 2 we are planning around USD 41,000 for the first week of December.\n\nCan you hold production capacity for us from 10 November? We would sign a volume commitment if you can guarantee the slot.\n\nThanks!\nMadison Cole\nFounder — Velvet Lash Co.', html: '', attachments: [], messageId: '<demo-11@velvetlashco.example>', inReplyTo: '<demo-4@lai-trial.example>', references: '<demo-4@lai-trial.example>'},
    {box: 'inbox', uid: 10, from: lena, to: [me], cc: [], subject: '[Sample] Re-order: 3 SKUs, USD 27,400 — and exclusivity for DACH?', date: hoursAgo(9), seen: false, pending: false,
      text: 'Dear team,\n\nThe last shipment sold through in six weeks. Please prepare a re-order for the same three SKUs: USD 27,400 in total, delivery to Berlin before the end of November.\n\nSeparately, we are talking to two salon chains in Austria and Switzerland. If we commit to a minimum of USD 120,000 for 2027, would you give us exclusivity for the DACH region? Please send your terms.\n\nBest regards,\nLena Fischer\nManaging Director — NordLash Studio GmbH', html: '', attachments: [], messageId: '<demo-10@nordlash.example>', inReplyTo: '<demo-2@lai-trial.example>', references: '<demo-2@lai-trial.example>'},
    {box: 'inbox', uid: 9, from: camille, to: [me], cc: [], subject: '[Sample] Samples approved — trial order USD 18,000, then 10 SKUs', date: hoursAgo(22), seen: true, pending: false,
      text: 'Bonjour,\n\nOur lash artists tested all twelve sample trays this week and the feedback is excellent: the 0.05 D-curl volume fans are the best we have seen at this price.\n\nWe would like to start with a trial order of USD 18,000 (six SKUs). If the quality holds, we plan to move our full range, about ten SKUs, to you from January.\n\nPlease confirm the lead time and send the quotation.\n\nCordialement,\nCamille Laurent\nDirectrice des achats — Maison des Cils', html: '', attachments: [], messageId: '<demo-9@maisondescils.example>'},
    {box: 'inbox', uid: 8, from: giulia, to: [me], cc: [], subject: '[Sample] 2027 annual supply agreement — target USD 180,000', date: hoursAgo(30), seen: true, pending: true,
      text: 'Dear all,\n\nBella Ciglia is expanding to 14 stores next year. We would like to move to an annual supply agreement with quarterly call-offs, with a planning figure of USD 180,000 for 2027.\n\nCould you send a draft agreement with volume-tier pricing, and confirm that you can hold stock of our private-label trays? I am in Milan all week and happy to do a video call.\n\nGrazie,\nGiulia Romano\nCEO — Bella Ciglia Srl', html: '', attachments: [], messageId: '<demo-8@bellaciglia.example>'},
    {box: 'inbox', uid: 7, from: sanne, to: [me], cc: [], subject: '[Sample] Q4 forecast and new private-label tray design', date: hoursAgo(50), seen: true, pending: false,
      text: 'Hi,\n\nOur Q4 forecast is up 35% on Q3, so please plan for about USD 30,000 across the October and November call-offs. I have also attached the new tray design for our private-label range — can your team confirm the print specs?\n\nThanks,\nSanne de Vries\nOperations Lead — Lash Lab Amsterdam', html: '', attachments: [{index: 0, filename: 'tray-design-v3.pdf', contentType: 'application/pdf', size: 512000}], messageId: '<demo-7@lashlab.example>'},
    {box: 'inbox', uid: 6, from: charlotte, to: [me], cc: [], subject: '[Sample] Re: Quotation — Q4 lash range', date: hoursAgo(76), seen: true, pending: false,
      text: 'Hi,\n\nThank you for the quotation. The pricing works for us and the volume discount is appreciated. I am taking it to our directors on Monday — expect a PO from us shortly.\n\nCharlotte', html: '', attachments: [], messageId: '<demo-6@londonlashpro.example>', inReplyTo: '<demo-5@lai-trial.example>', references: '<demo-5@lai-trial.example>'},
    {box: 'sent', uid: 5, from: me, to: [charlotte], cc: [oliver], subject: '[Sample] Quotation — Q4 lash range', date: hoursAgo(100), seen: true, pending: false,
      text: 'Dear Charlotte,\n\nPlease find our Q4 quotation attached.\n\nClassic Mink Volume 0.07 — USD 4.20 / tray\nPremade Fans 10D — USD 5.60 / tray\nEasy-Fan 0.05 — USD 4.80 / tray\nPrivate-label lash glue 10 ml — USD 1.00 / pc\n\nLead time 25 days after deposit. Orders above USD 40,000 ship free to London.\n\nBest regards', html: '', attachments: [{index: 0, filename: 'Quotation-LLP-Q4.pdf', contentType: 'application/pdf', size: 154600}], messageId: '<demo-5@lai-trial.example>'},
    {box: 'sent', uid: 4, from: me, to: [madison], cc: [], subject: '[Sample] PI VLC-2409 — USD 38,600 holiday kit lashes', date: hoursAgo(60), seen: true, pending: false,
      text: 'Hi Madison,\n\nThe proforma invoice for wave 1 is attached: USD 38,600, 30% deposit due now. Production starts as soon as it lands.\n\nBest regards', html: '', attachments: [{index: 0, filename: 'PI-VLC-2409.pdf', contentType: 'application/pdf', size: 142000}], messageId: '<demo-4@lai-trial.example>'},
    {box: 'sent', uid: 3, from: me, to: [daniel], cc: [], subject: '[Sample] Order LLD-0917 — balance invoice USD 21,300', date: hoursAgo(80), seen: true, pending: false,
      text: 'Hi Daniel,\n\nProduction of LLD-0917 is complete and quality-checked. The balance invoice (USD 21,300) is attached; we ship as soon as it is settled.\n\nBest regards', html: '', attachments: [], messageId: '<demo-3@lai-trial.example>'},
    {box: 'sent', uid: 2, from: me, to: [lena], cc: [], subject: '[Sample] Price list and delivery schedule — November', date: hoursAgo(120), seen: true, pending: false,
      text: 'Dear Lena,\n\nPlease find the updated price list. The November delivery slots are open until the 5th.\n\nBest regards', html: '', attachments: [], messageId: '<demo-2@lai-trial.example>'}
  ];
  var drafts = [], draftFiles = {}, templates = [], nextTemplate = 1;
  messages.forEach(function (m) { if (!m.inReplyTo) { m.inReplyTo = ''; m.references = ''; } });
  function json(status, body) { return new Response(JSON.stringify(body), {status: status, headers: {'Content-Type': 'application/json'}}); }
  function bad(message) { return json(400, {ok: false, code: 'invalid_input', message: message}); }
  function snippet(m) { var flat = String(m.text || String(m.html || '').replace(/<[^>]+>/g, ' ')).split('\n').filter(function (line) { return !/^\s*>/.test(line); }).join(' ').replace(/\s+/g, ' ').trim(); return flat.length > 140 ? flat.slice(0, 140) + '…' : flat; }
  function summary(m) { return {box: m.box, uid: m.uid, from: m.from, to: m.to, cc: m.cc, subject: m.subject, messageId: m.messageId, date: m.date, size: (m.text || '').length, seen: m.seen, pending: m.pending, answered: false, hasAttachment: m.attachments.length > 0, snippet: snippet(m), inReplyTo: m.inReplyTo || '', references: m.references || ''}; }
  function uidList(body) { return (Array.isArray(body.uids) ? body.uids : [body.uid]).map(Number); }
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
    if (path.indexOf('/api/mail-account/') === 0) return json(501, {ok: false, message: '网页试用版无法连接真实邮箱，所以不能绑定。'});
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
    if (path === '/api/mail/status') { var c = counts(); return json(200, {ok: true, unread: c.unread, pending: c.pending, total: messages.filter(function (x) { return x.box === 'inbox'; }).length, uidNext: nextUid}); }
    if (path === '/api/mail/drafts' && method === 'GET') return json(200, {ok: true, items: drafts.slice().sort(function (a, b) { return b.updatedAt.localeCompare(a.updatedAt); })});
    if (path === '/api/mail/draft') {
      var wanted = drafts.filter(function (d) { return d.id === query.get('id'); })[0];
      return wanted ? json(200, {ok: true, draft: wanted, attachments: draftFiles[wanted.id] || []}) : json(404, {ok: false, code: 'not_found', message: '找不到这份草稿'});
    }
    if (path === '/api/mail/templates' && method === 'GET') return json(200, {ok: true, items: templates.slice().reverse()});
    if (method !== 'POST') return json(404, {ok: false, message: 'not found'});
    if (path === '/api/mail/flags') {
      var targets = uidList(body).map(function (uid) { return find(body.box, uid); });
      if (targets.some(function (t) { return !t; })) return json(404, {ok: false, code: 'not_found', message: '这封邮件已经不在邮箱里了。'});
      targets.forEach(function (target) {
        if (typeof body.seen === 'boolean') target.seen = body.seen;
        if (typeof body.pending === 'boolean') target.pending = body.pending;
      });
      return json(200, {ok: true, count: targets.length});
    }
    if (path === '/api/mail/trash') { var gone = uidList(body); messages = messages.filter(function (m) { return !(m.box === body.box && gone.indexOf(m.uid) >= 0); }); return json(200, {ok: true, count: gone.length}); }
    if (path === '/api/mail/attachment/save') return json(501, {ok: false, message: '网页试用版里的附件是示例，不能保存。在 Mac 应用里会保存到「下载」文件夹。'});
    if (path === '/api/mail/drafts/save') {
      var draft = {id: body.id || ('demo' + String(nextDraft++)), to: body.to || '', cc: body.cc || '', bcc: body.bcc || '', subject: body.subject || '', text: body.text || '', html: body.html || '', inReplyTo: body.inReplyTo || '', references: body.references || '', forwardOf: body.forwardOf || null, updatedAt: new Date().toISOString()};
      if (Array.isArray(body.attachments)) draftFiles[draft.id] = body.attachments.map(function (a) { return {filename: a.filename, contentType: a.contentType || 'application/octet-stream', contentBase64: a.contentBase64 || ''}; });
      draft.attachments = (draftFiles[draft.id] || []).map(function (a) { return {filename: a.filename, contentType: a.contentType, size: Math.floor(String(a.contentBase64).length * 3 / 4)}; });
      drafts = drafts.filter(function (d) { return d.id !== draft.id; }).concat([draft]);
      return json(200, {ok: true, draft: draft});
    }
    if (path === '/api/mail/drafts/delete') { drafts = drafts.filter(function (d) { return d.id !== body.id; }); delete draftFiles[body.id]; return json(200, {ok: true}); }
    if (path === '/api/mail/templates/save') {
      var name = String(body.name || '').trim();
      if (!name) return bad('请给模板起个名字');
      if (templates.some(function (t) { return t.name === name; })) return json(409, {ok: false, code: 'duplicate', message: '已经有一个叫「' + name + '」的模板，请换个名字'});
      var template = {id: 'demo-template-' + nextTemplate++, name: name, subject: body.subject || '', html: body.html || '', text: body.text || '', updatedAt: new Date().toISOString()};
      templates.push(template);
      return json(200, {ok: true, template: template});
    }
    if (path === '/api/mail/templates/delete') { templates = templates.filter(function (t) { return t.id !== body.id; }); return json(200, {ok: true}); }
    if (path === '/api/mail/send') {
      var to = addresses(body.to), cc = addresses(body.cc), bcc = addresses(body.bcc), everyone = to.concat(cc, bcc);
      if (!everyone.length) return bad('请至少填写一位收件人');
      var wrong = everyone.filter(function (p) { return !p.valid; })[0];
      if (wrong) return bad(wrong.address + ' 不是有效的邮箱地址');
      if (!String(body.subject || '').trim() && !String(body.text || '').trim() && !String(body.html || '').replace(/<[^>]+>/g, '').trim()) return bad('主题和正文不能都为空');
      var strip = function (p) { return {name: p.name, address: p.address}; };
      var original = body.forwardOf && body.forwardAttachments !== false ? find(body.forwardOf.box, body.forwardOf.uid) : null;
      var files = (body.attachments || []).map(function (a, index) { return {index: index, filename: a.filename, contentType: a.contentType || 'application/octet-stream', size: Math.floor(String(a.contentBase64 || '').length * 3 / 4)}; });
      if (original) original.attachments.forEach(function (a) { files.push({index: files.length, filename: a.filename, contentType: a.contentType, size: a.size}); });
      var uid = nextUid++;
      messages.push({box: 'sent', uid: uid, from: {name: body.fromName || '', address: ME}, to: to.map(strip), cc: cc.map(strip), subject: body.subject || '', date: new Date().toISOString(), seen: true, pending: false, text: body.text || '', html: body.html || '', attachments: files, messageId: '<demo-' + uid + '@lai-trial.example>', inReplyTo: body.inReplyTo || '', references: body.references || ''});
      if (body.draftId) { drafts = drafts.filter(function (d) { return d.id !== body.draftId; }); delete draftFiles[body.draftId]; }
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

/* 示例邮箱的群发与设置：群发立刻“完成”，同样不发出任何邮件。 */
(function (root) {
  'use strict';
  var demo = root.LaiWebTrialMailDemo, batches = [], next = 1, inner = root.fetch;
  function json(status, body) { return new Response(JSON.stringify(body), {status: status, headers: {'Content-Type': 'application/json'}}); }
  function summary(b) { return {id: b.id, createdAt: b.createdAt, finishedAt: b.finishedAt, subject: b.subject, status: b.status, stopReason: '', total: b.items.length, sent: b.items.length, failed: 0, pending: 0, skipped: 0}; }
  root.fetch = function (input, init) {
    var url = String(typeof input === 'string' ? input : (input && input.url) || ''), method = String(init && init.method || 'GET').toUpperCase(), body = {};
    var match = /^(?:https?:\/\/[^\/]+)?(\/api\/mail(?:-account\/settings|\/bulk(?:\/[a-z]+)?))(?:\?([^#]*))?$/.exec(url);
    if (!match) return inner.apply(root, arguments);
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (error) { return Promise.resolve(json(400, {ok: false, message: '请求内容无效'})); }
    var path = match[1], account = demo.account();
    if (path === '/api/mail-account/settings') { account.senderName = String(body.senderName || '').trim(); account.signature = String(body.signature || '').trim(); if (typeof body.autoCheck === 'boolean') account.autoCheck = body.autoCheck; return Promise.resolve(json(200, {ok: true, available: false, account: account})); }
    if (path === '/api/mail/bulk' && method === 'GET') return Promise.resolve(json(200, {ok: true, items: batches.map(summary).reverse()}));
    if (path === '/api/mail/bulk/batch') {
      var id = new URLSearchParams(match[2] || '').get('id'), found = batches.filter(function (b) { return b.id === id; })[0];
      return Promise.resolve(found ? json(200, {ok: true, batch: Object.assign(summary(found), {text: found.text, attachmentNames: found.attachmentNames, items: found.items})}) : json(404, {ok: false, message: '找不到这批群发记录'}));
    }
    if (path === '/api/mail/bulk/cancel') return Promise.resolve(json(200, {ok: true}));
    if (path === '/api/mail/bulk/start') {
      var list = Array.isArray(body.recipients) ? body.recipients : [];
      if (!list.length) return Promise.resolve(json(400, {ok: false, code: 'invalid_input', message: '请至少选择一位收件人'}));
      if (!String(body.subject || '').trim() || !(String(body.text || '').trim() || String(body.html || '').replace(/<[^>]+>/g, '').trim())) return Promise.resolve(json(400, {ok: false, code: 'invalid_input', message: '请填写主题和正文'}));
      var now = new Date().toISOString();
      var batch = {id: 'demo-batch-' + next++, createdAt: now, finishedAt: now, subject: body.subject, text: body.text, status: 'done', attachmentNames: (body.attachments || []).map(function (a) { return a.filename; }),
        items: list.map(function (r) { return {address: r.address, name: r.name || '', customer: r.customer || '', status: 'sent', error: '', sentAt: now}; })};
      batches.push(batch);
      return Promise.resolve(json(200, {ok: true, batch: summary(batch)}));
    }
    return Promise.resolve(json(404, {ok: false, message: 'not found'}));
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* 示例商机附件：网页里没有本机服务，这里把文件存在浏览器本地存储里，只为试用上传、预览、改名、删除的流程。
   每个文件不超过 1 MB；刷新后还在，清除浏览器数据后消失；「保存到下载」不会真的保存文件。接口形状对照 backend/opportunity-files.js。 */
(function (root) {
  'use strict';
  var KEY = 'lai-web-trial-oppfiles-v1', MAX = 1024 * 1024, inner = root.fetch, memory = {};
  function load() { try { return JSON.parse(root.localStorage.getItem(KEY) || '{}') || {}; } catch (error) { return memory; } }
  function store(files) { memory = files; try { root.localStorage.setItem(KEY, JSON.stringify(files)); return true; } catch (error) { return false; } }
  function json(status, body) { return new Response(JSON.stringify(body), {status: status, headers: {'Content-Type': 'application/json'}}); }
  function toDataUrl(blob) { return new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { resolve(String(reader.result)); }; reader.onerror = function () { reject(reader.error); }; reader.readAsDataURL(blob); }); }
  function fromDataUrl(url) { var comma = url.indexOf(','), bytes = atob(url.slice(comma + 1)), out = new Uint8Array(bytes.length); for (var i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i); return out; }
  root.fetch = function (input, init) {
    var url = String(typeof input === 'string' ? input : (input && input.url) || '');
    var match = /^(?:https?:\/\/[^\/]+)?(\/api\/opportunity-file(?:\/[a-z]+)?)(?:\?([^#]*))?$/.exec(url);
    if (!match) return inner.apply(root, arguments);
    var path = match[1], query = new URLSearchParams(match[2] || ''), method = String(init && init.method || 'GET').toUpperCase(), files = load();
    if (path === '/api/opportunity-file' && method === 'GET') {
      var entry = files[query.get('url')];
      if (!entry) return Promise.resolve(json(404, {ok: false, code: 'not_found', message: '找不到这个文件，可能已被移动或删除'}));
      return Promise.resolve(new Response(fromDataUrl(entry.data), {status: 200, headers: {'Content-Type': entry.type}}));
    }
    if (path === '/api/opportunity-file/upload' && method === 'POST') {
      var blob = init && init.body, name = query.get('name') || 'file';
      if (!blob || !blob.size) return Promise.resolve(json(400, {ok: false, code: 'invalid_input', message: '「' + name + '」是空文件'}));
      if (blob.size > MAX) return Promise.resolve(json(413, {ok: false, code: 'too_large', message: '「' + name + '」超过 1 MB。网页试用版把文件存在浏览器里，所以限制得更小；Mac 应用里每个文件可以到 20 MB'}));
      return toDataUrl(blob).then(function (data) {
        var id = String(query.get('id') || 'x').replace(/[^A-Za-z0-9_-]+/g, '_'), rand = Math.random().toString(16).slice(2, 12).padEnd(10, '0');
        var fileUrl = '/attachments/opportunities/' + id + '/' + rand + '-' + encodeURIComponent(name), next = load();
        next[fileUrl] = {type: /^image\/(png|jpe?g|gif|webp|bmp)$/.test(blob.type) ? blob.type : 'application/octet-stream', data: data};
        if (!store(next)) return json(507, {ok: false, code: 'save_failed', message: '浏览器的本地存储已满，请先删除一些附件'});
        return json(200, {ok: true, file: {name: name, size: blob.size, type: blob.type || 'application/octet-stream', fileUrl: fileUrl}});
      });
    }
    var body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (error) { return Promise.resolve(json(400, {ok: false, message: '请求内容无效'})); }
    if (path === '/api/opportunity-file/save') return Promise.resolve(json(200, {ok: true, filename: String(body.name || '文件') + '（网页试用版不会真的保存文件）'}));
    if (path === '/api/opportunity-file/delete') {
      var list = Array.isArray(body.fileUrls) ? body.fileUrls : [], remaining = load(), removed = 0;
      list.forEach(function (fileUrl) { if (remaining[fileUrl]) { delete remaining[fileUrl]; removed++; } });
      store(remaining);
      return Promise.resolve(json(200, {ok: true, removed: removed}));
    }
    return Promise.resolve(json(404, {ok: false, message: 'not found'}));
  };
})(typeof window !== 'undefined' ? window : globalThis);
