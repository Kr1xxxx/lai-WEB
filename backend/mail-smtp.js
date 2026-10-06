const tls = require('node:tls');
const imap = require('./mail-imap.js');

// 发信：通过 Zoho 的发信服务器（TLS 465）提交一封已生成好的邮件。只在用户点击发送时调用。
// 主机固定，不接受界面指定；密码不写入日志或错误信息。

const HOSTS = Object.freeze({
  cn: Object.freeze({ personal: 'smtp.zoho.com.cn', organization: 'smtppro.zoho.com.cn' }),
  com: Object.freeze({ personal: 'smtp.zoho.com', organization: 'smtppro.zoho.com' })
});
const PORT = 465;
const TIMEOUT_MS = 60000;

const smtpError = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const visible = text => String(text).replace(/[^\x20-\x7e一-鿿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

function resolveServer(account) {
  const resolved = imap.resolveServer(account);
  return { host: HOSTS[resolved.site][resolved.accountType], port: PORT };
}

/**
 * 发送。recipients 为信封收件人（含抄送、密送）。任何一个收件人被拒绝都会整封不发，并指出是哪一个。
 * 返回 { accepted: [...] }。
 */
function send({ account, from, recipients, raw }, options = {}) {
  const server = resolveServer(account);
  const connect = options.connect || (() => tls.connect({ host: server.host, port: server.port, servername: server.host, minVersion: 'TLSv1.2' }));
  const timeoutMs = options.timeoutMs || TIMEOUT_MS;
  const user = imap.normalizeEmail(account.email), secret = imap.normalizePassword(account.password);
  const sender = imap.normalizeEmail(from);
  const targets = recipients.map(imap.normalizeEmail);
  if (!targets.length) throw smtpError('invalid_input', '请至少填写一位收件人');

  return new Promise((resolve, reject) => {
    let socket, buffer = '', lines = [], waiting = null, failure = null, done = false;
    const queue = [];
    const fail = (error) => {
      if (failure || done) return;
      failure = error;
      try { socket?.destroy(); } catch (_) {}
      if (waiting) { const pending = waiting; waiting = null; pending.reject(error); }
    };
    const reply = () => new Promise((res, rej) => {
      if (queue.length) return res(queue.shift());
      if (failure) return rej(failure);
      const timer = setTimeout(() => { waiting = null; fail(smtpError('timeout', `发信服务器 ${server.host} 响应超时。邮件可能没有发出，请到 Zoho 的已发送里确认后再决定是否重发。`)); rej(failure); }, timeoutMs);
      waiting = { resolve: value => { clearTimeout(timer); res(value); }, reject: error => { clearTimeout(timer); rej(error); } };
    });
    const command = async (text, expected) => {
      if (text !== null) socket.write(text + '\r\n');
      const answer = await reply();
      if (!expected.includes(answer.code)) throw Object.assign(smtpError('smtp_rejected', visible(answer.text)), { smtpCode: answer.code });
      return answer;
    };
    try { socket = connect(server); } catch (error) { return reject(imap.networkError(error, server.host)); }
    socket.setEncoding?.('latin1');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        const match = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!match) { fail(smtpError('protocol', '发信服务器的应答不是 SMTP 服务，已中止。')); return; }
        lines.push(match[3]);
        if (match[2] === ' ') {
          const answer = { code: Number(match[1]), text: lines.join(' '), lines };
          lines = [];
          if (waiting) { const pending = waiting; waiting = null; pending.resolve(answer); } else queue.push(answer);
        }
      }
      if (buffer.length > 65536) fail(smtpError('protocol', '发信服务器的应答异常，已中止。'));
    });
    socket.on('error', error => fail(imap.networkError(error, server.host)));
    socket.on('close', () => fail(smtpError('network', `发信服务器 ${server.host} 提前断开了连接。`)));

    (async () => {
      await command(null, [220]).catch((error) => { throw error.code === 'smtp_rejected' ? smtpError('protocol', '发信服务器暂时拒绝连接：' + error.message) : error; });
      await command('EHLO lai.local', [250]);
      const token = Buffer.from(`\u0000${user}\u0000${secret}`, 'utf8').toString('base64');
      await command('AUTH PLAIN ' + token, [235]).catch((error) => {
        if (error.code === 'smtp_rejected') throw smtpError('auth_failed', '发信登录失败。请确认应用专用密码仍然有效，并且 Zoho 账号允许通过 SMTP 发信。' + (error.message ? `（服务器回应：${error.message}）` : ''));
        throw error;
      });
      await command(`MAIL FROM:<${sender}>`, [250]).catch((error) => { throw error.code === 'smtp_rejected' ? smtpError('smtp_rejected', `发信服务器不接受发件人 ${sender}：${error.message}`) : error; });
      for (const target of targets)
        await command(`RCPT TO:<${target}>`, [250, 251]).catch((error) => { throw error.code === 'smtp_rejected' ? smtpError('smtp_rejected', `收件人 ${target} 被发信服务器拒绝，整封邮件没有发出：${error.message}`) : error; });
      await command('DATA', [354]);
      // 行首的点按协议加倍，结尾以单独一行的点结束。
      const body = raw.toString('latin1').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..').replace(/(\r\n)?$/, '\r\n');
      socket.write(Buffer.from(body, 'latin1'));
      await command('.', [250]).catch((error) => { throw error.code === 'smtp_rejected' ? smtpError('smtp_rejected', '发信服务器没有接受这封邮件：' + error.message) : error; });
      done = true;
      try { socket.end('QUIT\r\n'); } catch (_) {}
      setTimeout(() => { try { socket.destroy(); } catch (_) {} }, 2000).unref?.();
      return { accepted: targets };
    })().then(resolve, (error) => { fail(error); reject(error); });
  });
}

module.exports = { send, resolveServer, HOSTS, PORT };
