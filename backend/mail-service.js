const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { httpError } = require('./errors.js');
const imap = require('./mail-imap.js');
const client = require('./mail-client.js');
const smtp = require('./mail-smtp.js');
const mime = require('./mail-mime.js');

// 邮件读写服务：列表、阅读、标记、删除、附件、发送、草稿。
// 每次操作单独登录一次、用完退出；不在本机缓存邮件内容（草稿除外）。

const PAGE_SIZE = 50;
const MAX_MESSAGE_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_RECIPIENTS = 50;
const LIST_HEADERS = 'BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID CONTENT-TYPE)]';
// 界面上的文件夹 → 服务器上的邮箱与筛选条件。「待处理」用邮件的星标（\Flagged）表示。
const FOLDERS = Object.freeze({
  inbox: { box: 'inbox', criteria: ['ALL'] },
  unread: { box: 'inbox', criteria: ['UNSEEN'] },
  pending: { box: 'inbox', criteria: ['FLAGGED'] },
  sent: { box: 'sent', criteria: ['ALL'] },
});
const BOXES = Object.freeze({
  inbox: { fixed: 'INBOX' },
  sent: { flag: '\\sent', names: ['Sent', 'Sent Items', 'Sent Messages', 'Sent Mail', '已发送'] },
  trash: { flag: '\\trash', names: ['Trash', 'Deleted Items', 'Deleted Messages', '已删除'] },
});

function createMailService({ store, connectImap, connectSmtp, now = () => new Date(), downloadsDir = path.join(os.homedir(), 'Downloads'), reveal = () => {} }) {
  const boxNames = new Map();   // 邮箱账号 → { sent, trash } 的实际名称
  const recent = new Map();     // 最近读过的几封（供保存附件、转发用），只在内存里

  const fail = (status, code, message) => httpError(status, message, { code });
  function asHttp(error) {
    if (Number.isInteger(error?.status)) return error;
    const status = { invalid_input: 400, auth_failed: 422, smtp_rejected: 422, imap_no: 502, protocol: 502, network: 502, tls: 502, timeout: 504, too_large: 413 }[error?.code];
    return status ? httpError(status, error.message, { code: error.code }) : error;
  }
  function account() {
    const found = store.readMailAccount();
    if (!found) throw fail(409, 'not_bound', '还没有绑定邮箱');
    return found;
  }
  async function withSession(task) {
    const current = account();
    let session;
    try {
      session = await client.open(current, connectImap ? { connect: connectImap } : {});
      return await task(session, current);
    } catch (error) { throw asHttp(error); }
    finally { if (session) await session.close().catch(() => {}); }
  }
  async function resolveBox(session, current, box) {
    const spec = BOXES[box];
    if (!spec) throw fail(400, 'invalid_input', '不支持的邮件文件夹');
    if (spec.fixed) return spec.fixed;
    const key = current.email + '|' + current.host;
    if (!boxNames.has(key)) {
      const boxes = await client.listMailboxes(session);
      const find = target => (boxes.find(item => item.flags.includes(target.flag)) || boxes.find(item => target.names.some(name => name.toLowerCase() === item.name.toLowerCase())) || {}).name || '';
      boxNames.set(key, { sent: find(BOXES.sent), trash: find(BOXES.trash) });
    }
    const name = boxNames.get(key)[box];
    if (!name) throw fail(502, 'protocol', box === 'sent' ? '在邮箱里找不到「已发送」文件夹。' : '在邮箱里找不到「已删除」文件夹。');
    return name;
  }
  const uidOf = (value) => {
    const uid = Number(value);
    if (!Number.isSafeInteger(uid) || uid <= 0) throw fail(400, 'invalid_input', '邮件编号无效');
    return uid;
  };
  const boxOf = (value) => {
    if (value !== 'inbox' && value !== 'sent') throw fail(400, 'invalid_input', '不支持的邮件文件夹');
    return value;
  };
  function summary(message, box) {
    const headers = mime.summarizeHeaders(mime.parseHeaderBlock(message.body || Buffer.alloc(0)));
    const type = mime.parseParameterized(mime.parseHeaderBlock(message.body || Buffer.alloc(0)).get('content-type')).value;
    const flags = message.flags || [];
    return {
      box, uid: message.uid, from: headers.from, to: headers.to, cc: headers.cc, subject: headers.subject, messageId: headers.messageId,
      date: headers.date || internalDate(message.internalDate), size: message.size || 0,
      seen: flags.includes('\\seen'), pending: flags.includes('\\flagged'), answered: flags.includes('\\answered'),
      hasAttachment: type === 'multipart/mixed',
    };
  }
  function internalDate(value) {
    const parsed = new Date(String(value || '').replace(/^(\d{1,2})-(\w{3})-(\d{4})/, '$1 $2 $3'));
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  }
  // 搜索词：主题、发件人、收件人任一包含。
  function queryCriteria(query) {
    const text = String(query ?? '').trim().slice(0, 100);
    if (!text) return [];
    if (/[\r\n\u0000]/.test(text)) throw fail(400, 'invalid_input', '搜索内容无效');
    const term = client.astring(text);
    return ['OR', 'OR', 'SUBJECT', term, 'FROM', term, 'TO', term];
  }
  // 与若干邮箱地址有关的邮件（发件人、收件人或抄送中出现）。
  function addressCriteria(addresses) {
    const terms = addresses.map(address => ['OR', 'OR', 'FROM', client.astring(address), 'TO', client.astring(address), 'CC', client.astring(address)]);
    let criteria = terms.pop();
    while (terms.length) criteria = ['OR', ...terms.pop(), ...criteria];
    return criteria;
  }
  async function page(session, box, mailbox, criteria, pageNumber, limit = PAGE_SIZE) {
    await client.select(session, mailbox, true);
    const uids = await client.search(session, criteria);
    const start = Math.max(0, uids.length - pageNumber * limit), end = Math.max(0, uids.length - (pageNumber - 1) * limit);
    const messages = await client.fetch(session, uids.slice(start, end), `(UID FLAGS INTERNALDATE RFC822.SIZE ${LIST_HEADERS})`);
    return { total: uids.length, items: messages.map(message => summary(message, box)).sort((a, b) => b.uid - a.uid) };
  }

  async function list({ folder, page: pageValue, query } = {}) {
    const spec = FOLDERS[folder];
    if (!spec) throw fail(400, 'invalid_input', '不支持的邮件文件夹');
    const pageNumber = Math.max(1, Math.min(10000, Number.parseInt(pageValue, 10) || 1));
    const extra = queryCriteria(query);
    return withSession(async (session, current) => {
      const mailbox = await resolveBox(session, current, spec.box);
      const result = await page(session, spec.box, mailbox, [...spec.criteria, ...extra], pageNumber);
      const counts = spec.box === 'inbox' ? { unread: (await client.search(session, ['UNSEEN'])).length, pending: (await client.search(session, ['FLAGGED'])).length } : null;
      return { ok: true, folder, page: pageNumber, pageSize: PAGE_SIZE, total: result.total, items: result.items, ...(counts ? { counts } : {}) };
    });
  }

  // 某个客户的往来邮件：收件箱与已发送里与这些地址有关的最近邮件，按时间倒序合并。
  async function correspondence({ addresses } = {}) {
    const list = (Array.isArray(addresses) ? addresses : String(addresses ?? '').split(',')).map(item => String(item).trim()).filter(Boolean);
    let normalized;
    try { normalized = [...new Set(list.map(imap.normalizeEmail))]; } catch (error) { throw asHttp(error); }
    if (!normalized.length || normalized.length > 20) throw fail(400, 'invalid_input', '请提供 1 到 20 个邮箱地址');
    return withSession(async (session, current) => {
      const items = [];
      for (const box of ['inbox', 'sent']) {
        let mailbox;
        try { mailbox = await resolveBox(session, current, box); } catch (error) { if (box === 'sent') continue; throw error; }
        items.push(...(await page(session, box, mailbox, addressCriteria(normalized), 1, 100)).items);
      }
      items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.uid - a.uid);
      return { ok: true, addresses: normalized, items };
    });
  }

  async function load(session, current, box, uid) {
    const mailbox = await resolveBox(session, current, box);
    await client.select(session, mailbox, false);
    const [meta] = await client.fetch(session, [uid], '(UID FLAGS RFC822.SIZE)');
    if (!meta) throw fail(404, 'not_found', '这封邮件已经不在邮箱里了，可能已被移动或删除。');
    if (meta.size > MAX_MESSAGE_BYTES) throw fail(413, 'too_large', '这封邮件超过 30 MB，无法在来财里打开，请到 Zoho 邮箱查看。');
    const [full] = await client.fetch(session, [uid], '(UID BODY.PEEK[])');
    if (!full || !full.body) throw fail(404, 'not_found', '这封邮件已经不在邮箱里了，可能已被移动或删除。');
    const parsed = mime.parseMessage(full.body);
    const key = `${current.email}|${box}|${uid}`;
    recent.delete(key); recent.set(key, parsed);
    while (recent.size > 4) recent.delete(recent.keys().next().value);
    return { parsed, flags: meta.flags || [] };
  }
  // 邮件里以 cid: 引用的内嵌图片换成 data: 地址，这样不联网也能显示；其余远程内容由界面拦截。
  function inlineImages(html, attachments) {
    let budget = 6 * 1024 * 1024;
    return String(html || '').replace(/\bcid:([^"'\s>)]+)/gi, (whole, id) => {
      const found = attachments.find(item => item.contentId && item.contentId === id && /^image\/(png|jpe?g|gif|webp|bmp)$/.test(item.contentType));
      if (!found || found.size > 2 * 1024 * 1024 || found.size > budget) return whole;
      budget -= found.size;
      return `data:${found.contentType};base64,${found.content.toString('base64')}`;
    });
  }
  async function read({ box: boxValue, uid: uidValue } = {}) {
    const box = boxOf(boxValue), uid = uidOf(uidValue);
    return withSession(async (session, current) => {
      const { parsed, flags } = await load(session, current, box, uid);
      if (!flags.includes('\\seen')) await client.store(session, uid, '+FLAGS.SILENT', ['\\Seen']);
      return { ok: true, message: {
        box, uid, from: parsed.from, to: parsed.to, cc: parsed.cc, replyTo: parsed.replyTo, subject: parsed.subject, date: parsed.date,
        messageId: parsed.messageId, references: parsed.references, text: parsed.text.slice(0, 2 * 1024 * 1024),
        html: inlineImages(parsed.html, parsed.attachments).slice(0, 8 * 1024 * 1024),
        attachments: parsed.attachments.filter(item => !(item.inline && item.contentId && parsed.html.includes('cid:' + item.contentId))).map(({ index, filename, contentType, size }) => ({ index, filename, contentType, size })),
        seen: true, pending: flags.includes('\\flagged'),
      } };
    });
  }

  async function flags({ box: boxValue, uid: uidValue, seen, pending } = {}) {
    const box = boxOf(boxValue), uid = uidOf(uidValue);
    if (typeof seen !== 'boolean' && typeof pending !== 'boolean') throw fail(400, 'invalid_input', '没有要修改的标记');
    return withSession(async (session, current) => {
      await client.select(session, await resolveBox(session, current, box), false);
      if (typeof seen === 'boolean') await client.store(session, uid, (seen ? '+' : '-') + 'FLAGS.SILENT', ['\\Seen']);
      if (typeof pending === 'boolean') await client.store(session, uid, (pending ? '+' : '-') + 'FLAGS.SILENT', ['\\Flagged']);
      return { ok: true };
    });
  }

  // 删除＝移到邮箱的「已删除」，不是永久删除，可在 Zoho 里恢复。
  async function trash({ box: boxValue, uid: uidValue } = {}) {
    const box = boxOf(boxValue), uid = uidOf(uidValue);
    return withSession(async (session, current) => {
      const target = await resolveBox(session, current, 'trash');
      await client.select(session, await resolveBox(session, current, box), false);
      await client.move(session, uid, target);
      return { ok: true };
    });
  }

  async function cachedMessage(box, uid) {
    const current = account(), key = `${current.email}|${box}|${uid}`;
    if (recent.has(key)) return recent.get(key);
    return withSession(async (session, active) => (await load(session, active, box, uid)).parsed);
  }
  async function saveAttachment({ box: boxValue, uid: uidValue, index } = {}) {
    const box = boxOf(boxValue), uid = uidOf(uidValue);
    const parsed = await cachedMessage(box, uid);
    const attachment = parsed.attachments.find(item => item.index === Number(index));
    if (!attachment) throw fail(404, 'not_found', '找不到这个附件');
    fs.mkdirSync(downloadsDir, { recursive: true });
    const name = mime.safeFilename(attachment.filename), extension = path.extname(name), stem = name.slice(0, name.length - extension.length);
    for (let attempt = 0; attempt < 500; attempt++) {
      const file = path.join(downloadsDir, attempt ? `${stem} (${attempt})${extension}` : name);
      try { fs.writeFileSync(file, attachment.content, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code === 'EEXIST') continue; throw fail(500, 'save_failed', '附件保存失败：' + (error.code || '未知原因')); }
      try { reveal(file); } catch (_) {}
      return { ok: true, file, filename: path.basename(file) };
    }
    throw fail(500, 'save_failed', '附件保存失败：同名文件太多');
  }

  function recipients(value, label) {
    const text = Array.isArray(value) ? value.join(',') : String(value ?? '');
    if (/[\r\n\u0000]/.test(text)) throw fail(400, 'invalid_input', `${label}里有无法使用的字符`);
    const parsed = mime.parseAddressList(text);
    const pieces = text.split(/[,;]/).map(item => item.trim()).filter(Boolean);
    if (parsed.length !== pieces.length && !/["<]/.test(text)) throw fail(400, 'invalid_input', `${label}里有格式不正确的邮箱地址`);
    for (const item of parsed) { try { imap.normalizeEmail(item.address); } catch (_) { throw fail(400, 'invalid_input', `${label}里的 ${item.address} 不是有效的邮箱地址`); } }
    if (text.trim() && !parsed.length) throw fail(400, 'invalid_input', `${label}里有格式不正确的邮箱地址`);
    return parsed;
  }
  function cleanDraft(input, id) {
    const request = input && typeof input === 'object' ? input : {};
    const line = (value, max) => String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').slice(0, max);
    return {
      id, to: line(request.to, 4000), cc: line(request.cc, 4000), bcc: line(request.bcc, 4000), subject: line(request.subject, 500),
      text: String(request.text ?? '').replace(/\u0000/g, '').slice(0, 1024 * 1024),
      inReplyTo: line(request.inReplyTo, 1000), references: line(request.references, 8000),
      forwardOf: request.forwardOf && typeof request.forwardOf === 'object' && (request.forwardOf.box === 'inbox' || request.forwardOf.box === 'sent') && Number.isSafeInteger(Number(request.forwardOf.uid)) ? { box: request.forwardOf.box, uid: Number(request.forwardOf.uid) } : null,
      updatedAt: now().toISOString(),
    };
  }
  const draftId = value => /^[0-9a-f]{32}$/.test(String(value ?? '')) ? String(value) : '';

  async function send(input) {
    const request = input && typeof input === 'object' ? input : {};
    const current = account();
    const to = recipients(request.to, '收件人'), cc = recipients(request.cc, '抄送'), bcc = recipients(request.bcc, '密送');
    const everyone = [...new Set([...to, ...cc, ...bcc].map(item => item.address))];
    if (!everyone.length) throw fail(400, 'invalid_input', '请至少填写一位收件人');
    if (everyone.length > MAX_RECIPIENTS) throw fail(400, 'invalid_input', `一封邮件最多 ${MAX_RECIPIENTS} 位收件人`);
    const draft = cleanDraft(request, '');
    if (!draft.subject.trim() && !draft.text.trim()) throw fail(400, 'invalid_input', '主题和正文不能都为空');
    const attachments = [];
    let bytes = 0;
    for (const item of Array.isArray(request.attachments) ? request.attachments : []) {
      if (!item || typeof item.contentBase64 !== 'string' || !/^[A-Za-z0-9+/=\s]*$/.test(item.contentBase64)) throw fail(400, 'invalid_input', '附件内容无效');
      const content = Buffer.from(item.contentBase64, 'base64');
      bytes += content.length;
      attachments.push({ filename: mime.safeFilename(item.filename), contentType: String(item.contentType || ''), content });
    }
    if (draft.forwardOf && request.forwardAttachments !== false) {
      const original = await cachedMessage(draft.forwardOf.box, draft.forwardOf.uid).catch((error) => { throw asHttp(error); });
      for (const item of original.attachments) { bytes += item.size; attachments.push({ filename: item.filename, contentType: item.contentType, content: item.content }); }
    }
    if (attachments.length > 30) throw fail(400, 'invalid_input', '附件不能超过 30 个');
    if (bytes > MAX_ATTACHMENT_BYTES) throw fail(413, 'too_large', '附件合计超过 10 MB，无法发送');
    const senderName = String(request.fromName ?? current.senderName ?? '').replace(/[\r\n\u0000]+/g, ' ').trim().slice(0, 80);
    const built = mime.buildMessage({ from: { name: senderName, address: current.email }, to, cc, subject: draft.subject, text: draft.text, attachments, inReplyTo: draft.inReplyTo, references: draft.references, date: now() });
    try { await smtp.send({ account: current, from: current.email, recipients: everyone, raw: built.raw }, connectSmtp ? { connect: connectSmtp } : {}); }
    catch (error) { throw asHttp(error); }
    // 发出之后的收尾都不能让用户以为没发出去：失败只忽略。
    try { if (senderName !== (current.senderName || '')) store.writeMailAccount({ ...store.readMailAccount(), senderName }); } catch (_) {}
    try { if (draftId(request.draftId)) store.deleteMailDraft(draftId(request.draftId)); } catch (_) {}
    return { ok: true, messageId: built.messageId, recipients: everyone, attachmentCount: attachments.length };
  }

  function drafts() {
    return { ok: true, items: store.listMailDrafts() };
  }
  function saveDraft(input) {
    const id = draftId(input?.id) || crypto.randomBytes(16).toString('hex');
    const draft = cleanDraft(input, id);
    store.writeMailDraft(draft);
    return { ok: true, draft };
  }
  function deleteDraft(input) {
    const id = draftId(input?.id);
    if (!id) throw fail(400, 'invalid_input', '草稿编号无效');
    store.deleteMailDraft(id);
    return { ok: true };
  }
  function forget() { boxNames.clear(); recent.clear(); }

  return { list, correspondence, read, flags, trash, saveAttachment, send, drafts, saveDraft, deleteDraft, forget };
}

module.exports = { createMailService, PAGE_SIZE, FOLDERS };
