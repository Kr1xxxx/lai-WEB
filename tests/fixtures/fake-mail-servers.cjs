'use strict';
// 测试用的本机假邮件服务器（IMAP 与 SMTP，明文回环连接）。只实现来财用到的命令，邮件全部是合成内容。
const net = require('node:net');
const mime = require('../../backend/mail-mime.js');

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const track = (server) => {
  const sockets = new Set();
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  return () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); });
};

function rawMessage({ from, to, cc, subject, date, text, html, attachments = [], extraHeaders = [], messageId }) {
  const built = mime.buildMessage({ from, to: to || [], cc: cc || [], subject, text: text || '', attachments, date: new Date(date), messageId });
  if (!html && !extraHeaders.length) return built.raw;
  if (!html) return Buffer.concat([Buffer.from(extraHeaders.join('\r\n') + '\r\n'), built.raw]);
  const head = built.raw.toString('latin1').split('\r\n\r\n')[0].split('\r\n').filter(line => !/^Content-/i.test(line) && !/^ filename/i.test(line));
  const boundary = 'alt-boundary-1';
  const lines = [...extraHeaders, ...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    '--' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '', (text || '').replace(/=/g, '=3D'),
    '--' + boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(html, 'utf8').toString('base64'),
    '--' + boundary + '--', ''];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

function tokens(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === ' ') { i++; continue; }
    if (text[i] === '"') { let value = ''; i++; while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; value += text[i++]; } i++; out.push(value); continue; }
    let atom = '';
    while (i < text.length && text[i] !== ' ') atom += text[i++];
    out.push(atom);
  }
  return out;
}

async function startImap({ password = 'app-password-1', mailboxes, supportsMove = true, sentName = 'Sent', trashName = 'Trash', specialUse = true } = {}) {
  const state = {
    password, supportsMove, commands: [], logins: 0, failNext: null,
    boxes: new Map([['INBOX', { flags: [], messages: [] }], [sentName, { flags: specialUse ? ['\\Sent'] : [], messages: [] }], [trashName, { flags: specialUse ? ['\\Trash'] : [], messages: [] }]]),
    nextUid: 1,
    add(box, message, flags = []) { const uid = state.nextUid++; state.boxes.get(box).messages.push({ uid, flags: new Set(flags), raw: Buffer.isBuffer(message) ? message : rawMessage(message), internalDate: '06-Oct-2026 10:00:00 +0000' }); return uid; },
    message(box, uid) { return state.boxes.get(box).messages.find(item => item.uid === uid); },
  };
  for (const [box, list] of Object.entries(mailboxes || {})) for (const item of list) state.add(box, item.message || item, item.flags || []);

  const headerOf = (message) => { const raw = message.raw; const end = raw.indexOf('\r\n\r\n'); return mime.parseHeaderBlock(end < 0 ? raw : raw.subarray(0, end)); };
  const matches = (message, criteria) => {
    const take = () => criteria.shift();
    const evaluate = () => {
      const key = String(take() || '').toUpperCase();
      if (key === 'ALL') return true;
      if (key === 'UNSEEN') return !message.flags.has('\\Seen');
      if (key === 'FLAGGED') return message.flags.has('\\Flagged');
      if (key === 'OR') { const a = evaluate(), b = evaluate(); return a || b; }
      if (['SUBJECT', 'FROM', 'TO', 'CC'].includes(key)) {
        const needle = String(take()).toLowerCase(), headers = headerOf(message);
        return mime.decodeWords(headers.get(key.toLowerCase())).toLowerCase().includes(needle);
      }
      throw new Error('unsupported search key ' + key);
    };
    let result = true;
    while (criteria.length) result = evaluate() && result;
    return result;
  };

  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0), pending = '', literal = -1, selected = null, readOnly = true, authed = false;
    const send = text => socket.write(text);
    const handle = (line) => {
      const space = line.indexOf(' ');
      const tag = line.slice(0, space), rest = line.slice(space + 1);
      const parts = tokens(rest);
      let verb = String(parts.shift() || '').toUpperCase();
      if (verb === 'UID') verb = 'UID ' + String(parts.shift() || '').toUpperCase();
      state.commands.push(verb === 'LOGIN' ? `LOGIN ${parts[0]} ***` : `${verb} ${rest.replace(/^(UID )?\S+ ?/i, '')}`.trim());
      if (state.failNext && state.failNext.verb === verb) { const reply = state.failNext.reply; state.failNext = null; return send(`${tag} ${reply}\r\n`); }
      if (verb === 'LOGOUT') { send(`* BYE bye\r\n${tag} OK\r\n`); return socket.end(); }
      if (verb === 'LOGIN') { state.logins++; if (parts[1] === state.password) { authed = true; return send(`${tag} OK LOGIN completed\r\n`); } return send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`); }
      if (!authed) return send(`${tag} BAD not authenticated\r\n`);
      if (verb === 'LIST') { for (const [name, box] of state.boxes) send(`* LIST (\\HasNoChildren${box.flags.map(flag => ' ' + flag).join('')}) "/" "${name}"\r\n`); return send(`${tag} OK\r\n`); }
      if (verb === 'EXAMINE' || verb === 'SELECT') {
        const box = state.boxes.get(parts[0]);
        if (!box) return send(`${tag} NO no such mailbox\r\n`);
        selected = box; readOnly = verb === 'EXAMINE';
        return send(`* ${box.messages.length} EXISTS\r\n* OK [UIDVALIDITY 1]\r\n${tag} OK [${readOnly ? 'READ-ONLY' : 'READ-WRITE'}] done\r\n`);
      }
      if (!selected) return send(`${tag} BAD no mailbox selected\r\n`);
      if (verb === 'UID SEARCH') {
        const criteria = parts.slice();
        if (String(criteria[0]).toUpperCase() === 'CHARSET') criteria.splice(0, 2);
        const uids = selected.messages.filter(message => matches(message, criteria.slice())).map(message => message.uid);
        return send(`* SEARCH${uids.map(uid => ' ' + uid).join('')}\r\n${tag} OK\r\n`);
      }
      if (verb === 'UID FETCH') {
        const wanted = new Set(parts[0].split(',').map(Number)), items = rest.slice(rest.indexOf('('));
        selected.messages.forEach((message, index) => {
          if (!wanted.has(message.uid)) return;
          const fields = [`UID ${message.uid}`];
          if (/\bFLAGS\b/.test(items)) fields.push(`FLAGS (${[...message.flags].join(' ')})`);
          if (/INTERNALDATE/.test(items)) fields.push(`INTERNALDATE "${message.internalDate}"`);
          if (/RFC822\.SIZE/.test(items)) fields.push(`RFC822.SIZE ${message.raw.length}`);
          socket.write(`* ${index + 1} FETCH (${fields.join(' ')}`);
          if (/BODY\.PEEK\[HEADER\.FIELDS/.test(items)) {
            const end = message.raw.indexOf('\r\n\r\n'), head = Buffer.concat([end < 0 ? message.raw : message.raw.subarray(0, end), Buffer.from('\r\n\r\n')]);
            socket.write(` BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID CONTENT-TYPE)] {${head.length}}\r\n`); socket.write(head);
          } else if (/BODY\.PEEK\[\]/.test(items)) { socket.write(` BODY[] {${message.raw.length}}\r\n`); socket.write(message.raw); }
          socket.write(')\r\n');
        });
        return send(`${tag} OK\r\n`);
      }
      if (verb === 'UID STORE') {
        if (readOnly) return send(`${tag} NO mailbox is read-only\r\n`);
        const message = selected.messages.find(item => item.uid === Number(parts[0]));
        if (message) for (const flag of rest.slice(rest.indexOf('(') + 1, rest.lastIndexOf(')')).split(' ').filter(Boolean)) { if (parts[1].startsWith('+')) message.flags.add(flag); else message.flags.delete(flag); }
        return send(`${tag} OK\r\n`);
      }
      if (verb === 'UID MOVE' || verb === 'UID COPY') {
        if (verb === 'UID MOVE' && !state.supportsMove) return send(`${tag} BAD unknown command\r\n`);
        if (readOnly && verb === 'UID MOVE') return send(`${tag} NO mailbox is read-only\r\n`);
        const target = state.boxes.get(parts[1]), index = selected.messages.findIndex(item => item.uid === Number(parts[0]));
        if (!target) return send(`${tag} NO [TRYCREATE] no such mailbox\r\n`);
        if (index >= 0) { const source = selected.messages[index]; target.messages.push({ ...source, uid: state.nextUid++, flags: new Set(source.flags) }); if (verb === 'UID MOVE') selected.messages.splice(index, 1); }
        return send(`${tag} OK\r\n`);
      }
      if (verb === 'EXPUNGE') { selected.messages = selected.messages.filter(item => !item.flags.has('\\Deleted')); for (const box of state.boxes.values()) if (box.messages !== selected.messages && box === selected) box.messages = selected.messages; return send(`${tag} OK\r\n`); }
      return send(`${tag} BAD unknown command\r\n`);
    };
    send('* OK fake IMAP ready\r\n');
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
        const match = /\{(\d+)\}$/.exec(line);
        if (match) { pending += line.slice(0, match.index); literal = Number(match[1]); send('+ go ahead\r\n'); continue; }
        const full = pending + line; pending = '';
        try { handle(full); } catch (error) { send(`${full.split(' ')[0]} BAD ${error.message}\r\n`); }
      }
    });
  });
  const close = track(server);
  const port = await listen(server);
  return { port, state, connect: () => net.connect(port, '127.0.0.1'), close };
}

async function startSmtp({ user = '', password = 'app-password-1', reject = [] } = {}) {
  const state = { user, password, reject: new Set(reject), sent: [], commands: [], failData: '' };
  const server = net.createServer((socket) => {
    socket.setEncoding('latin1');
    let buffer = '', inData = false, envelope = { from: '', recipients: [] }, authed = false;
    const send = text => socket.write(text + '\r\n');
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
          else { state.sent.push({ ...envelope, raw, parsed: mime.parseMessage(raw) }); send('250 queued'); }
          envelope = { from: '', recipients: [] };
          continue;
        }
        const index = buffer.indexOf('\r\n');
        if (index < 0) return;
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const verb = line.split(/[ :]/)[0].toUpperCase();
        state.commands.push(verb === 'AUTH' ? 'AUTH ***' : line);
        if (verb === 'EHLO') { socket.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 26214400\r\n'); }
        else if (verb === 'AUTH') {
          const [, name, secret] = Buffer.from(line.split(' ')[2] || '', 'base64').toString('utf8').split('\u0000');
          if (secret === state.password && (!state.user || name === state.user)) { authed = true; send('235 ok'); } else send('535 authentication failed');
        }
        else if (!authed && verb !== 'QUIT') send('530 authentication required');
        else if (verb === 'MAIL') { envelope.from = /<([^>]*)>/.exec(line)[1]; send('250 ok'); }
        else if (verb === 'RCPT') { const address = /<([^>]*)>/.exec(line)[1]; if (state.reject.has(address)) send('550 5.1.1 no such user'); else { envelope.recipients.push(address); send('250 ok'); } }
        else if (verb === 'DATA') { inData = true; send('354 go ahead'); }
        else if (verb === 'QUIT') { send('221 bye'); socket.end(); return; }
        else send('502 unknown');
      }
    });
  });
  const close = track(server);
  const port = await listen(server);
  return { port, state, connect: () => net.connect(port, '127.0.0.1'), close };
}

module.exports = { startImap, startSmtp, rawMessage };

// 独立运行：给浏览器检查用，打印端口后保持运行。
if (require.main === module) {
  (async () => {
    const me = { name: '', address: 'sales@example-trade.com' };
    const imap = await startImap({ mailboxes: require('./mail-sample.cjs').mailboxes(me) });
    const smtp = await startSmtp({});
    process.stdout.write(JSON.stringify({ imap: imap.port, smtp: smtp.port }) + '\n');
  })();
}
