const tls = require('node:tls');
const imap = require('./mail-imap.js');

// 收信用的 IMAP 会话：登录后按需执行命令，用完即退出。只连接 mail-imap.js 里固定的 Zoho 主机。
// 密码不写入日志或错误信息。

const MAX_LITERAL = 40 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 45000;

function clientError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}
const quote = value => '"' + String(value).replace(/[\\"]/g, '\\$&') + '"';
const isAscii = value => /^[\x20-\x7e]*$/.test(value);
// 命令参数：ASCII 用引号字符串，其余用字面量（由 run 按协议分步发送）。
const astring = value => isAscii(String(value)) ? quote(value) : Buffer.from(String(value), 'utf8');
const visible = text => String(text).replace(/[^\x20-\x7e一-鿿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

// 把一条应答（文字片段与字面量交替）拆成嵌套列表：字符串为原子/引号串，Buffer 为字面量，数组为括号列表。
function tokenize(parts) {
  const root = [], stack = [root];
  const push = token => stack[stack.length - 1].push(token);
  for (const part of parts) {
    if (Buffer.isBuffer(part)) { push(part); continue; }
    let i = 0;
    while (i < part.length) {
      const char = part[i];
      if (char === ' ') { i++; continue; }
      if (char === '(') { const list = []; push(list); stack.push(list); i++; continue; }
      if (char === ')') { if (stack.length > 1) stack.pop(); i++; continue; }
      if (char === '"') {
        let value = ''; i++;
        while (i < part.length && part[i] !== '"') { if (part[i] === '\\' && i + 1 < part.length) i++; value += part[i++]; }
        i++; push({ quoted: value }); continue;
      }
      let atom = '', bracket = 0;
      while (i < part.length) {
        const c = part[i];
        if (c === '[') bracket++;
        else if (c === ']') bracket = Math.max(0, bracket - 1);
        else if (!bracket && (c === ' ' || c === '(' || c === ')')) break;
        atom += c; i++;
      }
      push(atom);
    }
  }
  return root;
}
const tokenText = token => token === undefined || token === null ? '' : Buffer.isBuffer(token) ? token.toString('latin1') : typeof token === 'object' && !Array.isArray(token) ? token.quoted : Array.isArray(token) ? '' : String(token);
const tokenBytes = token => Buffer.isBuffer(token) ? token : Buffer.from(tokenText(token), 'latin1');

function open(account, options = {}) {
  const server = imap.resolveServer(account);
  const connect = options.connect || (() => tls.connect({ host: server.host, port: server.port, servername: server.host, minVersion: 'TLSv1.2' }));
  const timeoutMs = options.timeoutMs || COMMAND_TIMEOUT_MS;

  return new Promise((resolveOpen, rejectOpen) => {
    let socket, buffer = Buffer.alloc(0), closed = false, failure = null, counter = 0;
    let waiting = null;       // { resolve, reject } 等待下一条完整应答
    const queue = [];         // 已解析、未被取走的应答
    let parts = [], needLiteral = -1;

    const fail = (error) => {
      if (failure) return;
      failure = error; closed = true;
      try { socket?.destroy(); } catch (_) {}
      if (waiting) { const pending = waiting; waiting = null; pending.reject(error); }
    };
    const deliver = (response) => {
      if (waiting) { const pending = waiting; waiting = null; pending.resolve(response); }
      else queue.push(response);
    };
    const pump = () => {
      for (;;) {
        if (needLiteral >= 0) {
          if (buffer.length < needLiteral) return;
          parts.push(Buffer.from(buffer.subarray(0, needLiteral)));
          buffer = buffer.subarray(needLiteral); needLiteral = -1;
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) { if (buffer.length > 1024 * 1024) fail(clientError('protocol', '邮箱服务器的应答异常，已中止。')); return; }
        const line = buffer.toString('latin1', 0, end);
        buffer = buffer.subarray(end + 2);
        const literal = /\{(\d+)\}$/.exec(line);
        if (literal) {
          const size = Number(literal[1]);
          if (size > MAX_LITERAL) return fail(clientError('too_large', '这封邮件太大，无法在来财里打开。'));
          parts.push(line.slice(0, literal.index)); needLiteral = size;
          continue;
        }
        parts.push(line);
        const done = parts; parts = [];
        deliver(done);
      }
    };
    const next = () => new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      if (failure) return reject(failure);
      const timer = setTimeout(() => { waiting = null; fail(clientError('timeout', `邮箱服务器 ${server.host} 响应超时。请检查网络后重试。`)); reject(failure); }, timeoutMs);
      waiting = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
    });
    const write = data => { if (failure) throw failure; socket.write(data); };

    // 执行一条命令。segments 里的 Buffer 作为字面量发送（等待服务器的 + 续传提示）。
    async function run(segments, { allowNo = false } = {}) {
      const tag = 'L' + (++counter);
      let line = tag;
      const untagged = [];
      for (const segment of segments) {
        if (!Buffer.isBuffer(segment)) { line += ' ' + segment; continue; }
        write(`${line} {${segment.length}}\r\n`);
        for (;;) {
          const response = await next();
          const head = typeof response[0] === 'string' ? response[0] : '';
          if (head.startsWith('+')) break;
          if (head.startsWith(tag + ' ')) throw clientError('imap_no', '邮箱服务器拒绝了这个请求：' + visible(head.slice(tag.length + 1)));
          untagged.push(response);
        }
        write(segment); line = '';
      }
      write(line + '\r\n');
      for (;;) {
        const response = await next();
        const head = typeof response[0] === 'string' ? response[0] : '';
        if (head.startsWith(tag + ' ')) {
          const status = head.slice(tag.length + 1);
          if (/^OK/i.test(status)) return { ok: true, text: status, untagged };
          if (allowNo && /^NO/i.test(status)) return { ok: false, text: status, untagged };
          throw clientError('imap_no', '邮箱服务器拒绝了这个请求：' + visible(status.replace(/^(NO|BAD)\s*/i, '')));
        }
        if (/^\* BYE/i.test(head)) { fail(clientError('protocol', '邮箱服务器中断了连接：' + (visible(head.slice(5)) || '请稍后重试'))); throw failure; }
        untagged.push(response);
      }
    }
    async function close() {
      if (closed) return;
      closed = true;
      try { socket.end(`L${++counter} LOGOUT\r\n`); } catch (_) {}
      setTimeout(() => { try { socket.destroy(); } catch (_) {} }, 2000).unref?.();
    }

    try { socket = connect(server); } catch (error) { return rejectOpen(imap.networkError(error, server.host)); }
    socket.on('data', (chunk) => { buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk; pump(); });
    socket.on('error', error => fail(imap.networkError(error, server.host)));
    socket.on('close', () => { if (!closed) fail(clientError('network', `邮箱服务器 ${server.host} 提前断开了连接。请稍后重试。`)); });

    (async () => {
      const greeting = await next();
      const head = typeof greeting[0] === 'string' ? greeting[0] : '';
      if (/^\* BYE/i.test(head)) throw clientError('protocol', '邮箱服务器暂时拒绝连接：' + (visible(head.slice(5)) || '请稍后重试'));
      if (!/^\* OK/i.test(head)) throw clientError('protocol', '邮箱服务器的应答不是 IMAP 服务，已中止。');
      const user = imap.normalizeEmail(account.email), secret = imap.normalizePassword(account.password);
      const login = await run(['LOGIN', quote(user), astring(secret)], { allowNo: true }).catch((error) => {
        if (error.code === 'imap_no') throw clientError('auth_failed', '邮箱登录失败。应用专用密码可能已失效或被撤销，请在邮件页重新验证或更换邮箱。');
        throw error;
      });
      if (!login.ok) throw clientError('auth_failed', '邮箱登录失败。应用专用密码可能已失效或被撤销，请在邮件页重新验证或更换邮箱。');
      return { run, close, server };
    })().then(resolveOpen, (error) => { fail(error); rejectOpen(error); });
  });
}

// ---- 在会话之上的常用操作 ----

async function listMailboxes(session) {
  const result = await session.run(['LIST', '""', '"*"']);
  const boxes = [];
  for (const response of result.untagged) {
    const tokens = tokenize(response);
    if (tokens[0] !== '*' || String(tokens[1]).toUpperCase() !== 'LIST') continue;
    const flags = (Array.isArray(tokens[2]) ? tokens[2] : []).map(flag => tokenText(flag).toLowerCase());
    boxes.push({ name: tokenText(tokens[4]), flags });
  }
  return boxes;
}

async function select(session, mailbox, readOnly = true) {
  const result = await session.run([readOnly ? 'EXAMINE' : 'SELECT', astring(mailbox)]);
  let exists = 0;
  for (const response of result.untagged) {
    const match = typeof response[0] === 'string' && /^\* (\d+) EXISTS/i.exec(response[0]);
    if (match) exists = Number(match[1]);
  }
  return { exists };
}

// criteria：字符串或 Buffer 片段；含非 ASCII 时自动声明 UTF-8。
async function search(session, criteria) {
  const utf8 = criteria.some(Buffer.isBuffer);
  const result = await session.run(['UID', 'SEARCH', ...(utf8 ? ['CHARSET', 'UTF-8'] : []), ...criteria]);
  const uids = [];
  for (const response of result.untagged) {
    const match = typeof response[0] === 'string' && /^\* SEARCH(.*)$/i.exec(response[0]);
    if (match) for (const uid of match[1].trim().split(/\s+/)) if (/^\d+$/.test(uid)) uids.push(Number(uid));
  }
  return [...new Set(uids)].sort((a, b) => a - b);
}

async function fetch(session, uids, items) {
  if (!uids.length) return [];
  const result = await session.run(['UID', 'FETCH', uids.join(','), items]);
  const messages = [];
  for (const response of result.untagged) {
    const tokens = tokenize(response);
    if (tokens[0] !== '*' || String(tokens[2]).toUpperCase() !== 'FETCH' || !Array.isArray(tokens[3])) continue;
    const data = {}, list = tokens[3];
    for (let i = 0; i + 1 < list.length; i += 2) {
      const key = String(list[i]).toUpperCase();
      if (key === 'UID') data.uid = Number(tokenText(list[i + 1]));
      else if (key === 'FLAGS') data.flags = (Array.isArray(list[i + 1]) ? list[i + 1] : []).map(flag => tokenText(flag).toLowerCase());
      else if (key === 'RFC822.SIZE') data.size = Number(tokenText(list[i + 1]));
      else if (key === 'INTERNALDATE') data.internalDate = tokenText(list[i + 1]);
      else if (key.startsWith('BODY[')) data.body = tokenBytes(list[i + 1]);
    }
    if (Number.isInteger(data.uid)) messages.push(data);
  }
  return messages;
}

async function store(session, uid, operation, flags) {
  await session.run(['UID', 'STORE', String(uid), operation, '(' + flags.join(' ') + ')']);
}

async function move(session, uid, target) {
  const moved = await session.run(['UID', 'MOVE', String(uid), astring(target)], { allowNo: true }).catch((error) => { if (error.code === 'imap_no') return { ok: false }; throw error; });
  if (moved.ok) return;
  await session.run(['UID', 'COPY', String(uid), astring(target)]);
  await store(session, uid, '+FLAGS.SILENT', ['\\Deleted']);
  await session.run(['EXPUNGE']);
}

module.exports = { open, listMailboxes, select, search, fetch, store, move, astring, tokenize, clientError };
