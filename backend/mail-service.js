const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { httpError } = require('./errors.js');
const imap = require('./mail-imap.js');
const client = require('./mail-client.js');
const smtp = require('./mail-smtp.js');
const mime = require('./mail-mime.js');

// 邮件读写服务：列表、阅读、标记、删除、附件、发送、草稿、群发。
// 协议与解析交给开源库（imapflow、nodemailer、postal-mime，见 vendor/mail-libs），这里只做来财自己的业务规则。
// 登录邮箱后连接会留一小会儿（keepAliveMs），接下来的操作直接复用，不用每点一下都重新登录；闲置到时间就退出。
// 不在本机缓存邮件内容（草稿、模板与群发记录除外）。

const PAGE_SIZE = 50;
const MAX_MESSAGE_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_RECIPIENTS = 50;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_BATCH = 200;        // 一次批量标记／删除最多多少封
const MAX_TEMPLATES = 200;
const STALE_CHECK_MS = 20000; // 连接闲了这么久再用之前，先问服务器一声它还在不在
const OPERATION_TIMEOUT_MS = 120000; // 一次操作最多等这么久；超时就放弃这条连接
// 界面上的文件夹 → 服务器上的邮箱与筛选条件。「待处理」用邮件的星标（\Flagged）表示。
const FOLDERS = Object.freeze({
  inbox: { box: 'inbox', query: { all: true } },
  unread: { box: 'inbox', query: { seen: false } },
  pending: { box: 'inbox', query: { flagged: true } },
  sent: { box: 'sent', query: { all: true } },
});
const BOXES = Object.freeze({
  inbox: { fixed: 'INBOX' },
  sent: { flag: '\\sent', names: ['Sent', 'Sent Items', 'Sent Messages', 'Sent Mail', '已发送'] },
  trash: { flag: '\\trash', names: ['Trash', 'Deleted Items', 'Deleted Messages', '已删除'] },
});

function createMailService({ store, endpoints = {}, now = () => new Date(), downloadsDir = path.join(os.homedir(), 'Downloads'), reveal = () => {}, bulkPauseMs = 1500, keepAliveMs = 0, staleCheckMs = STALE_CHECK_MS, operationTimeoutMs = OPERATION_TIMEOUT_MS, clock = () => Date.now() }) {
  const boxNames = new Map();   // 邮箱账号 → { sent, trash } 的实际名称
  const recent = new Map();     // 最近读过的几封（供保存附件、转发用），只在内存里
  // 要留着连接复用时，连接本身的闲置超时必须比保留时间长，否则库会先把它关掉；单次操作另有超时兜底。
  const imapOptions = { ...(endpoints.imap ? { endpoint: endpoints.imap } : {}), ...(keepAliveMs > 0 ? { socketTimeout: keepAliveMs + 60000 } : {}) };
  const smtpOptions = endpoints.smtp ? { endpoint: endpoints.smtp } : {};

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
  // ---- 邮箱连接：同一个账号只留一条，用完不马上退出 ----
  // generation：解绑或换邮箱时加一。之前开始的登录、重试一律作废，不会把旧账号的连接留下来。
  const pool = { session: null, key: '', timer: null, opening: null, usedAt: 0 };
  let generation = 0;
  const leases = new Map();     // 连接 → 正在用它的操作数
  const accountKey = current => crypto.createHash('sha256').update([current.email, current.password, current.site, current.accountType].join('\u0000')).digest('hex');
  const inUse = session => leases.get(session) || 0;
  const closeQuietly = session => { leases.delete(session); return session.close().catch(() => {}); };
  // 不再把这条连接当作“留着的那条”。还有操作在用它时先不关，等最后一个用完再关。
  async function dropSession(session = pool.session) {
    if (!session) return;
    if (pool.session === session) { pool.session = null; pool.key = ''; clearTimeout(pool.timer); pool.timer = null; }
    if (!inUse(session)) await closeQuietly(session);
  }
  async function acquire(current) {
    const key = accountKey(current), started = generation;
    clearTimeout(pool.timer); pool.timer = null;
    if (pool.session && (pool.key !== key || !pool.session.usable())) await dropSession();
    // 闲了一阵的连接可能已经被服务器断开而这边还不知道：先问一声，不通就重新登录。
    if (pool.session && !inUse(pool.session) && clock() - pool.usedAt >= staleCheckMs) {
      const session = pool.session;
      let alive = false;
      try { await session.noop(); alive = session.usable(); } catch (_) { alive = false; }
      if (!alive) await dropSession(session);
    }
    if (started !== generation) throw fail(409, 'not_bound', '邮箱绑定刚刚变了，请重试');
    if (pool.session && pool.key === key) { leases.set(pool.session, inUse(pool.session) + 1); return { session: pool.session, fresh: false }; }
    if (!pool.opening || pool.opening.key !== key || pool.opening.generation !== started) {
      const promise = client.open(current, imapOptions).then(async (session) => {
        // 登录期间解绑或换了邮箱：这条连接不能用，也不能留。
        if (started !== generation) { await closeQuietly(session); throw fail(409, 'not_bound', '邮箱绑定刚刚变了，请重试'); }
        const previous = pool.session;
        pool.session = session; pool.key = key;
        if (previous && previous !== session && !inUse(previous)) await closeQuietly(previous);
        return session;
      });
      const opening = { key, generation: started, promise };
      pool.opening = opening;
      promise.then(() => {}, () => {}).then(() => { if (pool.opening === opening) pool.opening = null; });
    }
    const session = await pool.opening.promise;
    leases.set(session, inUse(session) + 1);
    return { session, fresh: true };
  }
  function release(session) {
    const left = Math.max(0, inUse(session) - 1);
    if (left) leases.set(session, left); else leases.delete(session);
    pool.usedAt = clock();
    if (pool.session !== session) return left ? undefined : closeQuietly(session);
    if (left) return undefined;
    if (keepAliveMs <= 0) return dropSession(session);
    clearTimeout(pool.timer);
    pool.timer = setTimeout(() => { if (!inUse(session)) dropSession(session).catch(() => {}); }, keepAliveMs);
    if (pool.timer.unref) pool.timer.unref();
    return undefined;
  }
  // 单次操作的超时：到时间还没做完就放弃（连接随后会被丢掉）。
  function limited(work) {
    if (!(operationTimeoutMs > 0)) return work;
    let timer;
    const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(imap.mailError('timeout', '邮箱服务器长时间没有回应，这次操作已放弃，请稍后重试。')), operationTimeoutMs); if (timer.unref) timer.unref(); });
    return Promise.race([work, expired]).finally(() => clearTimeout(timer));
  }
  // retry：复用的连接中途断了时，重新登录再做一次。只读操作和改标记可以重做；移动邮件不重做（可能已经移过去了）。
  async function withSession(task, { retry = true } = {}) {
    const current = account(), started = generation, key = accountKey(current);
    const check = () => { if (started !== generation || !store.readMailAccount() || accountKey(store.readMailAccount()) !== key) throw fail(409, 'account_changed', '邮箱绑定刚刚变了，请重新操作'); };
    for (let attempt = 0; ; attempt++) {
      check();
      let lease = null, again = false;
      try {
        lease = await acquire(current);
        check();
        const result = await limited(task(lease.session, current));
        check();
        return result;
      } catch (error) {
        const dead = !!lease && !lease.session.usable();
        // 超时的连接多半卡住了：直接断开，不等它回话。
        if (lease && error?.code === 'timeout') lease.session.destroy();
        if (lease && (dead || error?.code === 'auth_failed' || error?.code === 'timeout')) await dropSession(lease.session).catch(() => {});
        check();
        again = dead && !lease.fresh && retry && attempt === 0;
        if (!again) throw asHttp(error);
      } finally { if (lease) await release(lease.session); }
    }
  }
  async function resolveBox(session, current, box) {
    const spec = BOXES[box];
    if (!spec) throw fail(400, 'invalid_input', '不支持的邮件文件夹');
    if (spec.fixed) return spec.fixed;
    const key = current.email + '|' + session.server.host;
    if (!boxNames.has(key)) {
      const boxes = await session.listMailboxes();
      const find = target => (boxes.find(item => item.specialUse === target.flag || item.flags.includes(target.flag)) || boxes.find(item => target.names.some(name => name.toLowerCase() === item.name.toLowerCase())) || {}).name || '';
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
  // 一封（uid）或多封（uids 数组）：统一成去重后的编号数组。
  const uidsOf = (request) => {
    if (request.uids === undefined) return [uidOf(request.uid)];
    if (!Array.isArray(request.uids) || !request.uids.length) throw fail(400, 'invalid_input', '没有选中邮件');
    const uids = [...new Set(request.uids.map(uidOf))];
    if (uids.length > MAX_BATCH) throw fail(400, 'invalid_input', `一次最多处理 ${MAX_BATCH} 封邮件`);
    return uids;
  };
  const boxOf = (value) => {
    if (value !== 'inbox' && value !== 'sent') throw fail(400, 'invalid_input', '不支持的邮件文件夹');
    return value;
  };
  async function summary(message, box) {
    const headers = await mime.parseHeaders(message.headers);
    const internal = message.internalDate ? new Date(message.internalDate) : null;
    return {
      box, uid: message.uid, from: headers.from, to: headers.to, cc: headers.cc, subject: headers.subject, messageId: headers.messageId,
      // 会话串联用：这封信回复的是哪一封、它所在的一串邮件的编号。
      inReplyTo: headers.inReplyTo, references: headers.references,
      date: headers.date || (internal && Number.isFinite(internal.getTime()) ? internal.toISOString() : ''), size: message.size,
      seen: message.flags.includes('\\seen'), pending: message.flags.includes('\\flagged'), answered: message.flags.includes('\\answered'),
      hasAttachment: headers.hasAttachment, snippet: await mime.snippet(message.headers, message.preview),
    };
  }
  // 搜索词：主题、发件人、收件人任一包含。
  function queryFilter(query) {
    const text = String(query ?? '').trim().slice(0, 100);
    if (!text) return {};
    if (/[\r\n\u0000]/.test(text)) throw fail(400, 'invalid_input', '搜索内容无效');
    return { or: [{ subject: text }, { from: text }, { to: text }] };
  }
  async function page(session, box, mailbox, query, pageNumber, limit = PAGE_SIZE) {
    return session.withMailbox(mailbox, true, async () => {
      const uids = await session.search(query);
      const start = Math.max(0, uids.length - pageNumber * limit), end = Math.max(0, uids.length - (pageNumber - 1) * limit);
      const messages = await session.fetchSummaries(uids.slice(start, end), { preview: true });
      const items = await Promise.all(messages.map(message => summary(message, box)));
      const counts = box === 'inbox' && limit === PAGE_SIZE ? { unread: (await session.search({ seen: false })).length, pending: (await session.search({ flagged: true })).length } : null;
      return { total: uids.length, items: items.sort((a, b) => b.uid - a.uid), counts };
    });
  }

  async function list({ folder, page: pageValue, query } = {}) {
    const spec = FOLDERS[folder];
    if (!spec) throw fail(400, 'invalid_input', '不支持的邮件文件夹');
    const pageNumber = Math.max(1, Math.min(10000, Number.parseInt(pageValue, 10) || 1));
    const filter = queryFilter(query);
    return withSession(async (session, current) => {
      const mailbox = await resolveBox(session, current, spec.box);
      const result = await page(session, spec.box, mailbox, { ...spec.query, ...filter }, pageNumber);
      return { ok: true, folder, page: pageNumber, pageSize: PAGE_SIZE, total: result.total, items: result.items, ...(result.counts ? { counts: result.counts } : {}) };
    });
  }

  // 收件箱概况：未读数、待处理数、封数，以及“下一封新邮件的编号”（当前最大编号加一）。界面定时来问，用它判断有没有新邮件。
  // 都在打开的收件箱里用搜索和取编号得到，不用 STATUS 命令（对正打开着的文件夹发 STATUS 不合规范，有的服务器会拒绝）。
  async function status() {
    return withSession(session => session.withMailbox('INBOX', true, async () => {
      const total = session.exists();
      const top = total ? await session.top() : 0;
      return { ok: true, unread: (await session.search({ seen: false })).length, pending: (await session.search({ flagged: true })).length, total, uidNext: top + 1 };
    }));
  }

  // 某个客户的往来邮件：收件箱与已发送里与这些地址有关的最近邮件，按时间倒序合并。
  async function correspondence({ addresses } = {}) {
    const list = (Array.isArray(addresses) ? addresses : String(addresses ?? '').split(',')).map(item => String(item).trim()).filter(Boolean);
    let normalized;
    try { normalized = [...new Set(list.map(imap.normalizeEmail))]; } catch (error) { throw asHttp(error); }
    if (!normalized.length || normalized.length > 20) throw fail(400, 'invalid_input', '请提供 1 到 20 个邮箱地址');
    const query = { or: normalized.flatMap(address => [{ from: address }, { to: address }, { cc: address }]) };
    return withSession(async (session, current) => {
      const items = [];
      for (const box of ['inbox', 'sent']) {
        let mailbox;
        try { mailbox = await resolveBox(session, current, box); } catch (error) { if (box === 'sent') continue; throw error; }
        items.push(...(await page(session, box, mailbox, query, 1, 100)).items);
      }
      items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.uid - a.uid);
      return { ok: true, addresses: normalized, items };
    });
  }

  // 在已打开的文件夹里读取一封并解析；最近几封留在内存里供保存附件、转发用。
  async function load(session, current, box, uid) {
    const started = generation;
    const meta = await session.fetchMeta(uid);
    if (!meta) throw fail(404, 'not_found', '这封邮件已经不在邮箱里了，可能已被移动或删除。');
    if (meta.size > MAX_MESSAGE_BYTES) throw fail(413, 'too_large', '这封邮件超过 30 MB，无法在来财里打开，请到 Zoho 邮箱查看。');
    const source = await session.fetchSource(uid);
    if (!source) throw fail(404, 'not_found', '这封邮件已经不在邮箱里了，可能已被移动或删除。');
    const parsed = await mime.parseMessage(source);
    if (started !== generation) throw fail(409, 'account_changed', '邮箱绑定刚刚变了，请重新操作');
    const key = `${imap.accountIdentity(current)}|${box}|${uid}`;
    recent.delete(key); recent.set(key, parsed);
    while (recent.size > 4) recent.delete(recent.keys().next().value);
    return { parsed, flags: meta.flags };
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
    return withSession(async (session, current) => session.withMailbox(await resolveBox(session, current, box), false, async () => {
      const { parsed, flags } = await load(session, current, box, uid);
      if (!flags.includes('\\seen')) await session.addFlags(uid, ['\\Seen']);
      return { ok: true, message: {
        box, uid, accountIdentity: imap.accountIdentity(current), from: parsed.from, to: parsed.to, cc: parsed.cc, replyTo: parsed.replyTo, subject: parsed.subject, date: parsed.date,
        messageId: parsed.messageId, inReplyTo: parsed.inReplyTo, references: parsed.references, text: parsed.text.slice(0, 2 * 1024 * 1024),
        html: inlineImages(parsed.html, parsed.attachments).slice(0, 8 * 1024 * 1024),
        attachments: parsed.attachments.filter(item => !(item.inline && item.contentId && parsed.html.includes('cid:' + item.contentId))).map(({ index, filename, contentType, size }) => ({ index, filename, contentType, size })),
        seen: true, pending: flags.includes('\\flagged'),
      } };
    }));
  }

  // 改已读／待处理标记。可以一次改多封（uids）。
  async function flags(input = {}) {
    const request = input && typeof input === 'object' ? input : {};
    const box = boxOf(request.box), uids = uidsOf(request), { seen, pending } = request;
    if (typeof seen !== 'boolean' && typeof pending !== 'boolean') throw fail(400, 'invalid_input', '没有要修改的标记');
    return withSession(async (session, current) => session.withMailbox(await resolveBox(session, current, box), false, async () => {
      if (typeof seen === 'boolean') await (seen ? session.addFlags : session.removeFlags)(uids, ['\\Seen']);
      if (typeof pending === 'boolean') await (pending ? session.addFlags : session.removeFlags)(uids, ['\\Flagged']);
      return { ok: true, count: uids.length };
    }));
  }

  // 删除＝移到邮箱的「已删除」，不是永久删除，可在 Zoho 里恢复。可以一次删多封（uids）。
  async function trash(input = {}) {
    const request = input && typeof input === 'object' ? input : {};
    const box = boxOf(request.box), uids = uidsOf(request);
    return withSession(async (session, current) => {
      const target = await resolveBox(session, current, 'trash'), source = await resolveBox(session, current, box);
      return session.withMailbox(source, false, async () => { await session.move(uids, target); return { ok: true, count: uids.length }; });
    }, { retry: false });
  }

  async function cachedMessage(box, uid) {
    const current = account(), key = `${imap.accountIdentity(current)}|${box}|${uid}`;
    if (recent.has(key)) return recent.get(key);
    return withSession(async (session, active) => session.withMailbox(await resolveBox(session, active, box), true, async () => (await load(session, active, box, uid)).parsed));
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
    // 按逗号、分号切分（引号里的不切），每一段必须是 地址 或 名字 <地址>。
    const pieces = text.match(/(?:"(?:[^"\\]|\\.)*"|[^,;])+/g) || [];
    const parsed = [];
    for (const piece of pieces.map(item => item.trim()).filter(Boolean)) {
      const match = /^(.*)<([^<>]+)>$/.exec(piece);
      const raw = (match ? match[2] : piece).trim();
      let address;
      try { address = imap.normalizeEmail(raw); } catch (_) { throw fail(400, 'invalid_input', `${label}里的 ${raw.slice(0, 80)} 不是有效的邮箱地址`); }
      parsed.push({ name: match ? match[1].trim().replace(/^"|"$/g, '').replace(/\\(.)/g, '$1').trim().slice(0, 80) : '', address });
    }
    return parsed;
  }
  function cleanDraft(input, id) {
    const request = input && typeof input === 'object' ? input : {};
    const line = (value, max) => String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').slice(0, max);
    const text = String(request.text ?? '').replace(/\u0000/g, '');
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw fail(413, 'too_large', '邮件纯文本正文超过 1 MB，请减少正文（内容未保存或发送）');
    const html = String(request.html ?? '').replace(/\u0000/g, '');
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw fail(413, 'too_large', '邮件正文和内嵌图片合计超过 2 MB，请减少图片或正文后重试（内容未保存或发送）');
    return {
      id, to: line(request.to, 4000), cc: line(request.cc, 4000), bcc: line(request.bcc, 4000), subject: line(request.subject, 500),
      text,
      html,
      inReplyTo: line(request.inReplyTo, 1000), references: line(request.references, 8000),
      forwardOf: request.forwardOf && typeof request.forwardOf === 'object' && (request.forwardOf.box === 'inbox' || request.forwardOf.box === 'sent') && Number.isSafeInteger(Number(request.forwardOf.uid)) ? { box: request.forwardOf.box, uid: Number(request.forwardOf.uid), accountIdentity: /^[0-9a-f]{64}$/.test(request.forwardOf.accountIdentity || '') ? request.forwardOf.accountIdentity : '' } : null,
      forwardAttachments: request.forwardAttachments === true,
      forwardCount: Number.isSafeInteger(request.forwardCount) && request.forwardCount >= 0 ? Math.min(30, request.forwardCount) : 0,
      updatedAt: now().toISOString(),
    };
  }
  const draftId = value => /^[0-9a-f]{32}$/.test(String(value ?? '')) ? String(value) : '';
  const messageIds = value => (String(value ?? '').match(/<[^<>\s]{1,300}>/g) || []).slice(-20);
  // 正文里以 data: 写入的图片（编辑器里粘贴的截图）改成邮件内嵌附件，多数邮箱不显示 data: 图片。
  function embedImages(html) {
    const images = [];
    const out = String(html || '').replace(/(<img\b[^>]*?\bsrc=")data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)(")/gi, (whole, before, type, data, after) => {
      if (images.length >= 20) return whole;
      const cid = `img${images.length + 1}.${crypto.randomBytes(6).toString('hex')}@lai`;
      images.push({ filename: `image-${images.length + 1}.${type.split('/')[1].replace('jpeg', 'jpg')}`, contentType: type.toLowerCase(), content: Buffer.from(data, 'base64'), cid });
      return `${before}cid:${cid}${after}`;
    });
    return { html: out, images };
  }
  function body(draft) {
    const { html, images } = embedImages(draft.html);
    return { html, images, text: draft.text.trim() || !html ? draft.text : mime.htmlToText(html) };
  }

  function uploadedAttachments(request) {
    const attachments = [];
    let bytes = 0;
    for (const item of Array.isArray(request.attachments) ? request.attachments : []) {
      if (!item || typeof item.contentBase64 !== 'string' || !/^[A-Za-z0-9+/=\s]*$/.test(item.contentBase64)) throw fail(400, 'invalid_input', '附件内容无效');
      const content = Buffer.from(item.contentBase64, 'base64');
      bytes += content.length;
      attachments.push({ filename: mime.safeFilename(item.filename), contentType: /^[\w.+-]+\/[\w.+-]+$/.test(String(item.contentType || '')) ? String(item.contentType) : 'application/octet-stream', content });
    }
    return { attachments, bytes };
  }

  async function send(input) {
    const request = input && typeof input === 'object' ? input : {};
    const current = account(), started = generation;
    const to = recipients(request.to, '收件人'), cc = recipients(request.cc, '抄送'), bcc = recipients(request.bcc, '密送');
    const everyone = [...new Set([...to, ...cc, ...bcc].map(item => item.address))];
    if (!everyone.length) throw fail(400, 'invalid_input', '请至少填写一位收件人');
    if (everyone.length > MAX_RECIPIENTS) throw fail(400, 'invalid_input', `一封邮件最多 ${MAX_RECIPIENTS} 位收件人`);
    const draft = cleanDraft(request, '');
    const content = body(draft);
    if (!draft.subject.trim() && !content.text.trim() && !content.images.length) throw fail(400, 'invalid_input', '主题和正文不能都为空');
    const { attachments, bytes: uploaded } = uploadedAttachments(request);
    let bytes = uploaded + content.images.reduce((sum, item) => sum + item.content.length, 0);
    if (draft.forwardOf && draft.forwardAttachments) {
      if (draft.forwardOf.accountIdentity !== imap.accountIdentity(current)) throw fail(409, 'forward_source_changed', '原邮件属于其他邮箱或旧草稿无法确认来源。请取消附带原附件，或在当前邮箱重新选择原邮件');
      const original = await cachedMessage(draft.forwardOf.box, draft.forwardOf.uid).catch((error) => { throw asHttp(error); });
      for (const item of original.attachments) { bytes += item.size; attachments.push({ filename: item.filename, contentType: item.contentType, content: item.content }); }
    }
    if (attachments.length > 30) throw fail(400, 'invalid_input', '附件不能超过 30 个');
    if (bytes > MAX_ATTACHMENT_BYTES) throw fail(413, 'too_large', '附件合计超过 10 MB，无法发送');
    if (started !== generation || imap.accountIdentity(store.readMailAccount()) !== imap.accountIdentity(current)) throw fail(409, 'account_changed', '邮箱绑定刚刚变了，请重新操作');
    const senderName = String(request.fromName ?? current.senderName ?? '').replace(/[\r\n\u0000]+/g, ' ').trim().slice(0, 80);
    let result;
    try {
      result = await smtp.send({ account: current, mail: { from: { name: senderName, address: current.email }, to, cc, bcc, subject: draft.subject, text: content.text, html: content.html, attachments: [...content.images, ...attachments],
        inReplyTo: messageIds(draft.inReplyTo)[0] || '', references: messageIds(draft.references), date: now() } }, smtpOptions);
    } catch (error) { throw asHttp(error); }
    // 发出之后的收尾都不能让用户以为没发出去：失败只忽略。
    try { if (started === generation && senderName !== (current.senderName || '')) store.writeMailAccount({ ...store.readMailAccount(), senderName }); } catch (_) {}
    try { if (draftId(request.draftId)) store.deleteMailDraft(draftId(request.draftId)); } catch (_) {}
    return { ok: true, messageId: result.messageId, recipients: result.accepted, rejected: result.rejected, attachmentCount: attachments.length };
  }

  // 草稿连同附件一起存在本机。列表里只带附件的名字和大小；打开某一份草稿时才把附件内容取出来。
  const fileMeta = item => ({ filename: item.filename, contentType: item.contentType, size: item.content.length });
  function drafts() {
    return { ok: true, items: store.listMailDrafts() };
  }
  function getDraft({ id } = {}) {
    const found = draftId(id) && store.listMailDrafts().find(item => item.id === draftId(id));
    if (!found) throw fail(404, 'not_found', '找不到这份草稿');
    const files = store.readMailDraftFiles ? store.readMailDraftFiles(found.id) : [];
    const sourceUnavailable = !!found.forwardOf && found.forwardOf.accountIdentity !== imap.accountIdentity(store.readMailAccount());
    const draft = { ...found, forwardAttachments: !sourceUnavailable && found.forwardAttachments === true, forwardCount: found.forwardCount || 0, sourceUnavailable };
    return { ok: true, draft, attachments: files.filter(item => item && typeof item.contentBase64 === 'string').map(item => ({ filename: String(item.filename || ''), contentType: String(item.contentType || 'application/octet-stream'), contentBase64: item.contentBase64 })) };
  }
  function saveDraft(input) {
    const request = input && typeof input === 'object' ? input : {};
    const id = draftId(request.id) || crypto.randomBytes(16).toString('hex');
    const draft = cleanDraft(request, id);
    // 没带 attachments 字段（只改了文字）时，原来存着的附件保持不动。
    if (Array.isArray(request.attachments)) {
      const { attachments, bytes } = uploadedAttachments(request);
      if (attachments.length > 30) throw fail(400, 'invalid_input', '附件不能超过 30 个');
      if (bytes > MAX_ATTACHMENT_BYTES) throw fail(413, 'too_large', '附件合计超过 10 MB，无法随草稿保存');
      draft.attachments = attachments.map(fileMeta);
      store.writeMailDraft(draft, attachments.map(item => ({ filename: item.filename, contentType: item.contentType, contentBase64: item.content.toString('base64') })));
    } else {
      const previous = store.listMailDrafts().find(item => item.id === id);
      draft.attachments = previous && Array.isArray(previous.attachments) ? previous.attachments : [];
      store.writeMailDraft(draft);
    }
    return { ok: true, draft };
  }
  function deleteDraft(input) {
    const id = draftId(input?.id);
    if (!id) throw fail(400, 'invalid_input', '草稿编号无效');
    store.deleteMailDraft(id);
    return { ok: true };
  }

  // ---- 模板：常用的主题和正文，写信时插入。只存在这台电脑上 ----
  function templates() {
    return { ok: true, items: store.listMailTemplates() };
  }
  function saveTemplate(input) {
    const request = input && typeof input === 'object' ? input : {};
    const name = String(request.name ?? '').replace(/[\r\n\u0000]+/g, ' ').trim().slice(0, 80);
    if (!name) throw fail(400, 'invalid_input', '请给模板起个名字');
    const content = cleanDraft(request, '');
    if (!content.subject.trim() && !content.text.trim() && !mime.htmlToText(content.html).trim()) throw fail(400, 'invalid_input', '模板的主题和正文不能都为空');
    const existing = store.listMailTemplates();
    const id = draftId(request.id) && existing.some(item => item.id === draftId(request.id)) ? draftId(request.id) : crypto.randomBytes(16).toString('hex');
    if (existing.some(item => item.id !== id && item.name === name)) throw fail(409, 'duplicate', `已经有一个叫「${name}」的模板，请换个名字`);
    if (!existing.some(item => item.id === id) && existing.length >= MAX_TEMPLATES) throw fail(400, 'invalid_input', `模板最多 ${MAX_TEMPLATES} 个，请先删掉不用的`);
    const template = { id, name, subject: content.subject, html: content.html, text: content.text.trim() ? content.text : mime.htmlToText(content.html), updatedAt: content.updatedAt };
    store.writeMailTemplate(template);
    return { ok: true, template };
  }
  function deleteTemplate(input) {
    const id = draftId(input?.id);
    if (!id) throw fail(400, 'invalid_input', '模板编号无效');
    store.deleteMailTemplate(id);
    return { ok: true };
  }

  // ---- 群发：给每位收件人单独发一封（对方看不到其他收件人），逐封记录结果 ----
  const MAX_BULK = 200;
  let bulkRunning = null;
  const bulkCount = (batch, status) => batch.items.filter(item => item.status === status).length;
  const bulkSummary = batch => ({ id: batch.id, createdAt: batch.createdAt, finishedAt: batch.finishedAt || '', subject: batch.subject, status: batch.status, stopReason: batch.stopReason || '',
    total: batch.items.length, sent: bulkCount(batch, 'sent'), failed: bulkCount(batch, 'failed'), pending: bulkCount(batch, 'pending') + bulkCount(batch, 'sending'), uncertain: bulkCount(batch, 'uncertain'), skipped: bulkCount(batch, 'skipped') });
  // 正文和主题里的 {{姓名}}、{{公司}} 换成每位收件人自己的；没有联系人姓名时用公司名。
  const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // 用函数做替换：客户名里的 $ 不会被当成替换记号。
  const personalize = (text, item, asHtml = false) => { const put = value => (asHtml ? escapeHtml(value) : value); return String(text).replace(/\{\{\s*姓名\s*\}\}/g, () => put(item.name || item.customer || '')).replace(/\{\{\s*公司\s*\}\}/g, () => put(item.customer || '')); };
  const failedBatches = new Map(); // A write failure is still visible for this process; durable pre-send checkpoints protect restart.
  const saveBulk = batch => { store.writeMailBulk(batch); failedBatches.delete(batch.id); };
  function settleInterrupted(batch) {
    if (batch.status !== 'sending' || (bulkRunning && bulkRunning.id === batch.id)) return batch;
    for (const item of batch.items) {
      if (item.status === 'sending' || (item.status === 'pending' && batch.checkpointVersion !== 1)) { item.status = 'uncertain'; item.error = '发送结果待核对：应用在 SMTP 提交期间关闭，请核对邮箱后决定是否重发'; }
      else if (item.status === 'pending') { item.status = 'skipped'; item.error = '应用在发送过程中关闭，这一封没有发送'; }
    }
    batch.status = 'interrupted'; batch.stopReason = '应用在发送过程中关闭，请先核对待核对的邮件'; batch.finishedAt = batch.finishedAt || now().toISOString();
    try { saveBulk(batch); } catch (_) { failedBatches.set(batch.id, batch); }
    return batch;
  }
  async function runBulk(batch, current, attachments, senderName) {
    const running = bulkRunning;
    let streak = 0, stopReason = '';
    try {
      for (let index = 0; index < batch.items.length; index++) {
        const item = batch.items[index];
        if (running.cancel) break;
        // This durable marker precedes SMTP: a restart can never call an in-flight message definitely unsent.
        item.status = 'sending';
        try { saveBulk(batch); }
        catch (_) { item.status = 'pending'; stopReason = '发送记录保存失败，已停止；本封尚未提交发送'; break; }
        try {
          const content = body({ text: personalize(batch.text, item), html: personalize(batch.html || '', item, true) });
          await smtp.send({ account: current, mail: { from: { name: senderName, address: current.email }, to: [{ name: item.name, address: item.address }], subject: personalize(batch.subject, item), text: content.text, html: content.html, attachments: [...content.images, ...attachments], date: now() } }, smtpOptions);
          item.status = 'sent'; item.sentAt = now().toISOString(); streak = 0;
        } catch (error) {
          item.status = 'failed'; item.error = String(error?.message || '发送失败').slice(0, 300); streak++;
          if (error?.code === 'auth_failed') stopReason = '发信登录失败，已停止';
          else if (streak >= 5) stopReason = '连续 5 封发送失败，已停止';
        }
        try { saveBulk(batch); }
        catch (_) {
          if (item.status === 'sent') { item.status = 'uncertain'; item.error = 'SMTP 已接受，但发送记录保存失败；发送结果待核对，请勿直接重发'; }
          stopReason = '发送记录保存失败，已停止；请先核对邮箱中的发送结果';
          break;
        }
        if (stopReason) break;
        if (bulkPauseMs && index < batch.items.length - 1 && !running.cancel) await new Promise(resolve => setTimeout(resolve, bulkPauseMs));
      }
    } finally {
      const reason = stopReason || (running.cancel ? '已手动停止' : '');
      for (const item of batch.items) if (item.status === 'pending') { item.status = 'skipped'; item.error = reason || '未发送'; }
      batch.status = stopReason ? 'stopped' : running.cancel ? 'cancelled' : 'done';
      batch.stopReason = reason; batch.finishedAt = now().toISOString();
      try { saveBulk(batch); } catch (_) { failedBatches.set(batch.id, batch); }
      if (bulkRunning === running) bulkRunning = null;
    }
  }
  function bulkStart(input) {
    const request = input && typeof input === 'object' ? input : {};
    const current = account(), started = generation;
    if (bulkRunning) throw fail(409, 'busy', '上一批群发还在发送，请等它结束或先停止');
    const seen = new Set(), items = [];
    const line = (value, max) => String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').trim().slice(0, max);
    for (const entry of Array.isArray(request.recipients) ? request.recipients : []) {
      let address;
      try { address = imap.normalizeEmail(entry && entry.address); } catch (_) { throw fail(400, 'invalid_input', `${line(entry && entry.address, 80) || '（空）'} 不是有效的邮箱地址`); }
      if (seen.has(address)) continue;
      seen.add(address);
      items.push({ address, name: line(entry.name, 80), customer: line(entry.customer, 200), status: 'pending', error: '' });
    }
    if (!items.length) throw fail(400, 'invalid_input', '请至少选择一位收件人');
    if (items.length > MAX_BULK) throw fail(400, 'invalid_input', `一批群发最多 ${MAX_BULK} 位收件人`);
    const draft = cleanDraft(request, '');
    if (!draft.subject.trim()) throw fail(400, 'invalid_input', '请填写主题');
    if (!draft.text.trim() && !mime.htmlToText(draft.html).trim()) throw fail(400, 'invalid_input', '请填写正文');
    const { attachments, bytes } = uploadedAttachments(request);
    if (attachments.length > 30) throw fail(400, 'invalid_input', '附件不能超过 30 个');
    if (bytes > MAX_ATTACHMENT_BYTES) throw fail(413, 'too_large', '附件合计超过 10 MB，无法发送');
    if (started !== generation || imap.accountIdentity(store.readMailAccount()) !== imap.accountIdentity(current)) throw fail(409, 'account_changed', '邮箱绑定刚刚变了，请重新操作');
    const senderName = String(request.fromName ?? current.senderName ?? '').replace(/[\r\n\u0000]+/g, ' ').trim().slice(0, 80);
    const batch = { checkpointVersion: 1, id: crypto.randomBytes(16).toString('hex'), createdAt: now().toISOString(), finishedAt: '', subject: draft.subject, text: draft.text.trim() ? draft.text : mime.htmlToText(draft.html), html: draft.html, attachmentNames: attachments.map(item => item.filename), status: 'sending', stopReason: '', items };
    store.writeMailBulk(batch);
    bulkRunning = { id: batch.id, cancel: false };
    bulkRunning.done = runBulk(batch, current, attachments, senderName).catch(() => {});
    return { ok: true, batch: bulkSummary(batch) };
  }
  function bulkList() {
    return { ok: true, items: store.listMailBulk().map(batch => failedBatches.get(batch.id) || batch).map(settleInterrupted).map(bulkSummary) };
  }
  function bulkGet({ id } = {}) {
    const batch = draftId(id) && (failedBatches.get(draftId(id)) || store.readMailBulk(draftId(id)));
    if (!batch) throw fail(404, 'not_found', '找不到这批群发记录');
    settleInterrupted(batch);
    return { ok: true, batch: { ...bulkSummary(batch), text: batch.text, attachmentNames: batch.attachmentNames || [], items: batch.items } };
  }
  function bulkCancel({ id } = {}) {
    if (bulkRunning && bulkRunning.id === id) bulkRunning.cancel = true;
    return { ok: true };
  }
  const bulkIdle = () => (bulkRunning ? bulkRunning.done : Promise.resolve());

  // 解绑、换邮箱时：忘掉文件夹名称和读过的邮件，停掉群发，并退出还留着的连接。
  function forget() { generation++; boxNames.clear(); recent.clear(); if (bulkRunning) bulkRunning.cancel = true; return dropSession().catch(() => {}); }
  const shutdown = () => dropSession().catch(() => {});
  // 供测试看：现在是不是还留着一条连接。
  const connected = () => !!pool.session;

  return { list, status, correspondence, read, flags, trash, saveAttachment, send, drafts, getDraft, saveDraft, deleteDraft, templates, saveTemplate, deleteTemplate, bulkStart, bulkList, bulkGet, bulkCancel, bulkIdle, forget, shutdown, connected };
}

module.exports = { createMailService, PAGE_SIZE, FOLDERS, MAX_BATCH };
