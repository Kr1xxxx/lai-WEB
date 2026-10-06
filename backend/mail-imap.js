const tls = require('node:tls');

// 只做一件事：用 IMAP 登录验证邮箱凭据，成功后立刻退出登录。
// 不选择文件夹、不读取邮件、不发送任何内容。密码不写入日志或错误信息。

// 允许连接的服务器固定为 Zoho 的 IMAP 主机，不接受任意主机名。
const SITES = Object.freeze({
  cn: Object.freeze({ label: '中国站（zoho.com.cn）', personal: 'imap.zoho.com.cn', organization: 'imappro.zoho.com.cn', personalDomains: Object.freeze(['zoho.com.cn']) }),
  com: Object.freeze({ label: '国际站（zoho.com）', personal: 'imap.zoho.com', organization: 'imappro.zoho.com', personalDomains: Object.freeze(['zoho.com', 'zohomail.com']) })
});
const ACCOUNT_TYPES = Object.freeze(['auto', 'personal', 'organization']);
const PORT = 993;
const DEFAULT_TIMEOUT_MS = 20000;

function mailError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!email) throw mailError('invalid_input', '请填写邮箱地址');
  if (email.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email)) throw mailError('invalid_input', '邮箱地址格式不正确');
  return email;
}

function normalizePassword(value) {
  if (typeof value !== 'string' || !value) throw mailError('invalid_input', '请填写应用专用密码');
  if (value.length > 256) throw mailError('invalid_input', '密码过长');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw mailError('invalid_input', '密码中含有无法使用的字符（如换行）');
  return value;
}

// 个人邮箱（@zoho.com.cn 等）与企业域名邮箱使用不同的服务器；auto 按邮箱域名判断。
function resolveServer({ email, site = 'cn', accountType = 'auto' }) {
  if (!Object.hasOwn(SITES, site)) throw mailError('invalid_input', '不支持的 Zoho 站点');
  if (!ACCOUNT_TYPES.includes(accountType)) throw mailError('invalid_input', '不支持的账号类型');
  const domain = normalizeEmail(email).split('@')[1];
  const kind = accountType === 'auto' ? (SITES[site].personalDomains.includes(domain) ? 'personal' : 'organization') : accountType;
  return { site, accountType: kind, host: SITES[site][kind], port: PORT };
}

const quoted = value => '"' + value.replace(/[\\"]/g, '\\$&') + '"';
const isAscii = value => /^[\x20-\x7e]*$/.test(value);
// 服务器返回的文字只取可见字符并截断，避免把异常内容原样显示。
const serverText = line => String(line).replace(/[^\x20-\x7e一-鿿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);

function networkMessage(error, host) {
  const code = String(error?.code || '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return mailError('network', `找不到邮箱服务器 ${host}。请检查网络，或确认选择的 Zoho 站点是否正确。`);
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ECONNRESET' || code === 'EPIPE') return mailError('network', `无法连接邮箱服务器 ${host}。请检查网络或防火墙后重试。`);
  if (code === 'ETIMEDOUT') return mailError('timeout', `连接邮箱服务器 ${host} 超时。请检查网络后重试。`);
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ALTNAME/.test(code)) return mailError('tls', `邮箱服务器 ${host} 的安全证书未通过验证，已中止连接。`);
  return mailError('network', `连接邮箱服务器 ${host} 失败。请稍后重试。`);
}

/**
 * 登录验证。成功返回 { host, port }；失败抛出带 code 的错误：
 * invalid_input / auth_failed / network / timeout / tls / protocol。
 * options.connect 仅供测试替换连接方式。
 */
function verifyLogin({ email, password, site, accountType }, options = {}) {
  const user = normalizeEmail(email);
  const secret = normalizePassword(password);
  const server = resolveServer({ email: user, site, accountType });
  const connect = options.connect || (() => tls.connect({ host: server.host, port: server.port, servername: server.host, minVersion: 'TLSv1.2' }));
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let socket, settled = false, buffer = '', stage = 'greeting';
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.destroy(); } catch (_) {}
      if (error) reject(error); else resolve({ ...server });
    };
    const timer = setTimeout(() => finish(mailError('timeout', `邮箱服务器 ${server.host} 响应超时。请检查网络后重试。`)), timeoutMs);
    const write = text => { try { socket.write(text); } catch (error) { finish(networkMessage(error, server.host)); } };
    const sendLogin = () => {
      if (isAscii(secret)) { stage = 'login'; write(`A1 LOGIN ${quoted(user)} ${quoted(secret)}\r\n`); }
      else { stage = 'literal'; write(`A1 LOGIN ${quoted(user)} {${Buffer.byteLength(secret, 'utf8')}}\r\n`); }
    };
    const onLine = (line) => {
      if (stage === 'greeting') {
        if (/^\* OK/i.test(line)) return sendLogin();
        if (/^\* BYE/i.test(line)) return finish(mailError('protocol', `邮箱服务器暂时拒绝连接：${serverText(line.slice(5)) || '请稍后重试'}`));
        return finish(mailError('protocol', '邮箱服务器的应答不是 IMAP 服务，已中止。'));
      }
      if (stage === 'literal') {
        if (line.startsWith('+')) { stage = 'login'; return write(secret + '\r\n'); }
        if (/^A1 (NO|BAD)/i.test(line)) return finish(mailError('auth_failed', '邮箱服务器拒绝了这个密码格式。请改用应用专用密码。'));
        return;
      }
      if (stage === 'login') {
        if (/^A1 OK/i.test(line)) {
          // 验证通过：礼貌退出登录后关闭，不做任何其他操作。
          settled = true; clearTimeout(timer);
          try { socket.end('A2 LOGOUT\r\n'); } catch (_) {}
          setTimeout(() => { try { socket.destroy(); } catch (_) {} }, 2000).unref?.();
          return resolve({ ...server });
        }
        if (/^A1 (NO|BAD)/i.test(line)) {
          const detail = serverText(line.replace(/^A1 (NO|BAD)\s*/i, ''));
          return finish(mailError('auth_failed', '登录被邮箱服务器拒绝。请确认：① 邮箱地址正确；② 填的是应用专用密码而不是登录密码；③ Zoho 邮箱设置里已开启 IMAP 访问；④ 站点与账号类型选择正确。' + (detail ? `（服务器回应：${detail}）` : '')));
        }
        if (/^\* BYE/i.test(line)) return finish(mailError('protocol', `邮箱服务器中断了连接：${serverText(line.slice(5)) || '请稍后重试'}`));
      }
    };
    try { socket = connect(server); } catch (error) { return finish(networkMessage(error, server.host)); }
    socket.setEncoding?.('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 65536) return finish(mailError('protocol', '邮箱服务器的应答异常，已中止。'));
      let index;
      while (!settled && (index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        onLine(line);
      }
    });
    socket.on('error', error => finish(networkMessage(error, server.host)));
    socket.on('close', () => finish(mailError('network', `邮箱服务器 ${server.host} 提前断开了连接。请稍后重试。`)));
  });
}

module.exports = { verifyLogin, resolveServer, normalizeEmail, normalizePassword, SITES, ACCOUNT_TYPES, PORT };
