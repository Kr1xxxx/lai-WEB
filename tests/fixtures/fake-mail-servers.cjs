'use strict';
// 测试用的本机假邮件服务器（IMAP 与 SMTP，明文回环连接）。只实现来财经由 imapflow／nodemailer 用到的命令，邮件全部是合成内容。
// 它是按协议写的替身，不代表真实的 Zoho：真实服务器的差异这里测不出来。
const net = require('node:net');
const { mailLibs } = require('../../backend/mail-libs.js');

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const track = (server) => {
  const sockets = new Set();
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  return () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); });
};
const address = item => (item.name ? { name: item.name, address: item.address } : item.address);

// 用 nodemailer 的邮件生成器造一封原始邮件。
async function rawMessage({ from, to, cc, subject, date, text, html, attachments = [], messageId, inReplyTo, references }) {
  const { MailComposer } = mailLibs();
  return new MailComposer({ from: address(from), to: (to || []).map(address), cc: (cc || []).map(address), subject, text: text || '', ...(html ? { html } : {}), date: new Date(date), ...(messageId ? { messageId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}), ...(references ? { references } : {}), attachments: attachments.map(item => ({ filename: item.filename, content: item.content, contentType: item.contentType })) }).compile().build();
}

// 把一行命令拆成记号：原子、引号串为字符串，括号为嵌套数组。字面量在读取阶段已并入为引号串。
function tokenize(text) {
  const root = [], stack = [root];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === ' ') { i++; continue; }
    if (char === '(') { const list = []; stack[stack.length - 1].push(list); stack.push(list); i++; continue; }
    if (char === ')') { if (stack.length > 1) stack.pop(); i++; continue; }
    if (char === '"') { let value = ''; i++; while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; value += text[i++]; } i++; stack[stack.length - 1].push(value); continue; }
    let atom = '', depth = 0;
    while (i < text.length) { const c = text[i]; if (c === '[') depth++; else if (c === ']') depth--; else if (!depth && (c === ' ' || c === '(' || c === ')')) break; atom += c; i++; }
    stack[stack.length - 1].push(atom);
  }
  return root;
}
const inSet = (set, uid, max) => String(set).split(',').some((part) => { const [a, b = a] = part.split(':').map(value => value === '*' ? max : Number(value)); return uid >= Math.min(a, b) && uid <= Math.max(a, b); });

async function startImap({ password = 'app-password-1', mailboxes, supportsMove = true, sentName = 'Sent', trashName = 'Trash', specialUse = true } = {}) {
  const { PostalMime } = mailLibs();
  const state = {
    password, supportsMove, commands: [], logins: 0, failNext: null, greeting: null,
    boxes: new Map([['INBOX', { use: '', messages: [] }], [sentName, { use: specialUse ? '\\Sent' : '', messages: [] }], [trashName, { use: specialUse ? '\\Trash' : '', messages: [] }]]),
    nextUid: 1,
    async add(box, message, flags = []) {
      const raw = Buffer.isBuffer(message) ? message : await rawMessage(message);
      const parsed = await PostalMime.parse(raw);
      const list = value => (Array.isArray(value) ? value : value ? [value] : []).flatMap(item => item.group || [item]).map(item => `${item.name || ''} ${item.address || ''}`).join(', ').toLowerCase();
      const uid = state.nextUid++;
      state.boxes.get(box).messages.push({ uid, flags: new Set(flags), raw, internalDate: '06-Oct-2026 10:00:00 +0000', fields: { subject: String(parsed.subject || '').toLowerCase(), from: list(parsed.from), to: list(parsed.to), cc: list(parsed.cc) } });
      return uid;
    },
    message(box, uid) { return state.boxes.get(box).messages.find(item => item.uid === uid); },
  };
  for (const [box, list] of Object.entries(mailboxes || {})) for (const item of list) await state.add(box, item.message || item, item.flags || []);

  const capabilities = () => ['IMAP4rev1', ...(state.supportsMove ? ['MOVE'] : []), 'UIDPLUS', ...(specialUse ? ['SPECIAL-USE'] : [])].join(' ');
  function matches(message, criteria) {
    const list = criteria.slice();
    const term = () => {
      const token = list.shift();
      if (Array.isArray(token)) return matches(message, token);
      const key = String(token || '').toUpperCase();
      if (key === 'ALL') return true;
      if (key === 'SEEN') return message.flags.has('\\Seen');
      if (key === 'UNSEEN') return !message.flags.has('\\Seen');
      if (key === 'FLAGGED') return message.flags.has('\\Flagged');
      if (key === 'UNFLAGGED') return !message.flags.has('\\Flagged');
      if (key === 'NOT') return !term();
      if (key === 'OR') { const a = term(), b = term(); return a || b; }
      if (['SUBJECT', 'FROM', 'TO', 'CC'].includes(key)) return message.fields[key.toLowerCase()].includes(String(list.shift()).toLowerCase());
      throw new Error('unsupported search key ' + key);
    };
    let result = true;
    while (list.length) result = term() && result;
    return result;
  }

  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0), pending = '', literal = -1, selected = null, readOnly = true, authed = false;
    const send = text => { if (!socket.destroyed) socket.write(text); };
    const fetchLine = (message, index, items) => {
      const fields = [`UID ${message.uid}`];
      if (/\bFLAGS\b/.test(items)) fields.push(`FLAGS (${[...message.flags].join(' ')})`);
      if (/INTERNALDATE/.test(items)) fields.push(`INTERNALDATE "${message.internalDate}"`);
      if (/RFC822\.SIZE/.test(items)) fields.push(`RFC822.SIZE ${message.raw.length}`);
      send(`* ${index + 1} FETCH (${fields.join(' ')}`);
      const header = /BODY(?:\.PEEK)?\[HEADER\.FIELDS \(([^)]*)\)\]/i.exec(items);
      if (header) {
        const wanted = header[1].toLowerCase().split(/\s+/), end = message.raw.indexOf('\r\n\r\n'), head = (end < 0 ? message.raw : message.raw.subarray(0, end)).toString('latin1');
        const kept = head.split(/\r\n(?![ \t])/).filter(line => wanted.includes(line.slice(0, line.indexOf(':')).toLowerCase()));
        const data = Buffer.from(kept.join('\r\n') + '\r\n\r\n', 'latin1');
        send(` BODY[HEADER.FIELDS (${header[1]})] {${data.length}}\r\n`); socket.write(data);
      } else if (/BODY(?:\.PEEK)?\[\]/i.test(items)) { send(` BODY[] {${message.raw.length}}\r\n`); socket.write(message.raw); }
      // 正文开头的一段：BODY.PEEK[TEXT]<起点.长度>
      const partial = /BODY(?:\.PEEK)?\[TEXT\]<(\d+)\.(\d+)>/i.exec(items);
      if (partial) {
        const end = message.raw.indexOf('\r\n\r\n'), body = end < 0 ? Buffer.alloc(0) : message.raw.subarray(end + 4);
        const slice = body.subarray(Number(partial[1]), Number(partial[1]) + Number(partial[2]));
        send(` BODY[TEXT]<${partial[1]}> {${slice.length}}\r\n`); socket.write(slice);
      }
      send(')\r\n');
    };
    const handle = (line) => {
      const space = line.indexOf(' ');
      const tag = line.slice(0, space), rest = line.slice(space + 1);
      const parts = tokenize(rest);
      let verb = String(parts.shift() || '').toUpperCase();
      if (verb === 'UID') verb = 'UID ' + String(parts.shift() || '').toUpperCase();
      state.commands.push(verb === 'LOGIN' ? `LOGIN ${parts[0]} ***` : `${verb} ${rest.replace(/^(UID )?\S+ ?/i, '')}`.trim());
      if (state.failNext && state.failNext.verb === verb) { const reply = state.failNext.reply; state.failNext = null; return send(`${tag} ${reply}\r\n`); }
      if (verb === 'CAPABILITY') return send(`* CAPABILITY ${capabilities()}\r\n${tag} OK\r\n`);
      if (verb === 'NOOP') return send(`${tag} OK\r\n`);
      if (verb === 'LOGOUT') { send(`* BYE bye\r\n${tag} OK\r\n`); return socket.end(); }
      if (verb === 'LOGIN') { state.logins++; if (parts[1] === state.password) { authed = true; return send(`${tag} OK [CAPABILITY ${capabilities()}] LOGIN completed\r\n`); } return send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`); }
      if (!authed) return send(`${tag} BAD not authenticated\r\n`);
      if (verb === 'LIST' || verb === 'LSUB') {
        if (parts[1] === '') { send(`* ${verb} (\\Noselect) "/" ""\r\n`); return send(`${tag} OK\r\n`); }
        for (const [name, box] of state.boxes) send(`* ${verb} (\\HasNoChildren${box.use ? ' ' + box.use : ''}) "/" "${name}"\r\n`);
        return send(`${tag} OK\r\n`);
      }
      if (verb === 'STATUS') { const box = state.boxes.get(parts[0]); if (!box) return send(`${tag} NO no such mailbox\r\n`); return send(`* STATUS "${parts[0]}" (MESSAGES ${box.messages.length} UIDNEXT ${state.nextUid} UIDVALIDITY 1 UNSEEN ${box.messages.filter(m => !m.flags.has('\\Seen')).length})\r\n${tag} OK\r\n`); }
      if (verb === 'EXAMINE' || verb === 'SELECT') {
        const box = state.boxes.get(parts[0]);
        if (!box) return send(`${tag} NO no such mailbox\r\n`);
        selected = box; readOnly = verb === 'EXAMINE';
        return send(`* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)] ok\r\n* ${box.messages.length} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] ok\r\n* OK [UIDNEXT ${state.nextUid}] ok\r\n${tag} OK [${readOnly ? 'READ-ONLY' : 'READ-WRITE'}] done\r\n`);
      }
      if (verb === 'CLOSE' || verb === 'UNSELECT') { selected = null; return send(`${tag} OK\r\n`); }
      if (!selected) return send(`${tag} BAD no mailbox selected\r\n`);
      const max = Math.max(0, ...selected.messages.map(message => message.uid));
      if (verb === 'UID SEARCH') {
        const criteria = parts.slice();
        if (String(criteria[0]).toUpperCase() === 'CHARSET') criteria.splice(0, 2);
        const uids = selected.messages.filter(message => matches(message, criteria)).map(message => message.uid);
        return send(`* SEARCH${uids.map(uid => ' ' + uid).join('')}\r\n${tag} OK\r\n`);
      }
      if (verb === 'UID FETCH') {
        const items = rest.slice(rest.indexOf(String(parts[0])) + String(parts[0]).length);
        selected.messages.forEach((message, index) => { if (inSet(parts[0], message.uid, max)) fetchLine(message, index, items); });
        return send(`${tag} OK\r\n`);
      }
      if (verb === 'UID STORE') {
        if (readOnly) return send(`${tag} NO mailbox is read-only\r\n`);
        const operation = String(parts[1]).toUpperCase(), flags = Array.isArray(parts[2]) ? parts[2] : parts.slice(2);
        selected.messages.forEach((message, index) => {
          if (!inSet(parts[0], message.uid, max)) return;
          for (const flag of flags) { if (operation.startsWith('+')) message.flags.add(flag); else if (operation.startsWith('-')) message.flags.delete(flag); }
          if (!operation.includes('.SILENT')) send(`* ${index + 1} FETCH (UID ${message.uid} FLAGS (${[...message.flags].join(' ')}))\r\n`);
        });
        return send(`${tag} OK\r\n`);
      }
      if (verb === 'UID MOVE' || verb === 'UID COPY') {
        if (verb === 'UID MOVE' && !state.supportsMove) return send(`${tag} BAD unknown command\r\n`);
        if (readOnly && verb === 'UID MOVE') return send(`${tag} NO mailbox is read-only\r\n`);
        const target = state.boxes.get(parts[1]);
        if (!target) return send(`${tag} NO [TRYCREATE] no such mailbox\r\n`);
        const moving = selected.messages.filter(message => inSet(parts[0], message.uid, max));
        for (const source of moving) target.messages.push({ ...source, uid: state.nextUid++, flags: new Set(source.flags) });
        if (verb === 'UID MOVE') for (const source of moving) { const index = selected.messages.indexOf(source); selected.messages.splice(index, 1); send(`* ${index + 1} EXPUNGE\r\n`); }
        return send(`${tag} OK\r\n`);
      }
      if (verb === 'EXPUNGE' || verb === 'UID EXPUNGE') {
        if (readOnly) return send(`${tag} NO mailbox is read-only\r\n`);
        for (let index = selected.messages.length - 1; index >= 0; index--) {
          const message = selected.messages[index];
          if (message.flags.has('\\Deleted') && (verb === 'EXPUNGE' || inSet(parts[0], message.uid, max))) { selected.messages.splice(index, 1); send(`* ${index + 1} EXPUNGE\r\n`); }
        }
        return send(`${tag} OK\r\n`);
      }
      state.unknown = (state.unknown || []).concat(line);
      return send(`${tag} BAD unknown command\r\n`);
    };
    send(state.greeting === null ? `* OK [CAPABILITY ${capabilities()}] fake IMAP ready\r\n` : state.greeting);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (literal >= 0) {
          if (buffer.length < literal) return;
          pending += '"' + buffer.subarray(0, literal).toString('utf8').replace(/[\\"]/g, '\\$&') + '"';
          buffer = buffer.subarray(literal); literal = -1;
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.toString('utf8', 0, end);
        buffer = buffer.subarray(end + 2);
        const match = /\{(\d+)(\+?)\}$/.exec(line);
        if (match) { pending += line.slice(0, match.index); literal = Number(match[1]); if (!match[2]) send('+ go ahead\r\n'); continue; }
        const full = pending + line; pending = '';
        try { handle(full); } catch (error) { send(`${full.split(' ')[0]} BAD ${error.message}\r\n`); }
      }
    });
  });
  const close = track(server);
  const port = await listen(server);
  return { port, state, endpoint: { host: '127.0.0.1', port }, close };
}

async function startSmtp({ user = '', password = 'app-password-1', reject = [] } = {}) {
  const { PostalMime } = mailLibs();
  const state = { user, password, reject: new Set(reject), sent: [], commands: [], failData: '', parsing: Promise.resolve() };
  const server = net.createServer((socket) => {
    socket.setEncoding('latin1');
    let buffer = '', inData = false, envelope = { from: '', recipients: [] }, authed = false, login = null;
    const send = text => { if (!socket.destroyed) socket.write(text + '\r\n'); };
    const check = (name, secret) => { if (secret === state.password && (!state.user || name === state.user)) { authed = true; send('235 ok'); } else send('535 authentication failed'); };
    send('220 fake SMTP ready');
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          const raw = Buffer.from(buffer.slice(0, end + 2).replace(/^\.\./gm, '.'), 'latin1');
          buffer = buffer.slice(end + 5); inData = false;
          if (state.failData) { send(state.failData); state.failData = ''; }
          else {
            const entry = { ...envelope, raw, parsed: null };
            state.sent.push(entry);
            state.parsing = state.parsing.then(async () => { entry.parsed = await PostalMime.parse(raw); });
            state.parsing.then(() => send('250 queued'));
          }
          envelope = { from: '', recipients: [] };
          continue;
        }
        const index = buffer.indexOf('\r\n');
        if (index < 0) return;
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (login) {
          const value = Buffer.from(line, 'base64').toString('utf8');
          if (login.step === 'user') { login = { step: 'pass', user: value }; send('334 UGFzc3dvcmQ6'); } else { const name = login.user; login = null; check(name, value); }
          continue;
        }
        const verb = line.split(/[ :]/)[0].toUpperCase();
        state.commands.push(verb === 'AUTH' ? 'AUTH ' + (line.split(' ')[1] || '') + ' ***' : line);
        if (verb === 'EHLO') socket.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 26214400\r\n');
        else if (verb === 'AUTH') {
          const mechanism = String(line.split(' ')[1] || '').toUpperCase();
          if (mechanism === 'PLAIN') { const [, name, secret] = Buffer.from(line.split(' ')[2] || '', 'base64').toString('utf8').split('\u0000'); check(name, secret); }
          else if (mechanism === 'LOGIN') { const first = line.split(' ')[2]; if (first) { login = { step: 'pass', user: Buffer.from(first, 'base64').toString('utf8') }; send('334 UGFzc3dvcmQ6'); } else { login = { step: 'user' }; send('334 VXNlcm5hbWU6'); } }
          else send('504 unsupported mechanism');
        }
        else if (verb === 'RSET') { envelope = { from: '', recipients: [] }; send('250 ok'); }
        else if (verb === 'NOOP') send('250 ok');
        else if (verb === 'QUIT') { send('221 bye'); socket.end(); return; }
        else if (!authed) send('530 authentication required');
        else if (verb === 'MAIL') { envelope.from = /<([^>]*)>/.exec(line)[1]; send('250 ok'); }
        else if (verb === 'RCPT') { const target = /<([^>]*)>/.exec(line)[1]; if (state.reject.has(target)) send('550 5.1.1 no such user'); else { envelope.recipients.push(target); send('250 ok'); } }
        else if (verb === 'DATA') { if (!envelope.recipients.length) send('554 no valid recipients'); else { inData = true; send('354 go ahead'); } }
        else send('502 unknown');
      }
    });
  });
  const close = track(server);
  const port = await listen(server);
  return { port, state, endpoint: { host: '127.0.0.1', port }, close };
}

module.exports = { startImap, startSmtp, rawMessage };
