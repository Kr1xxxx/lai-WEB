const { mailLibs } = require('./mail-libs.js');

// Zoho 服务器地址、输入校验，以及连接邮箱（IMAP 由开源库 imapflow 实现）。
// 密码不写入日志或错误信息；imapflow 的日志在打包时已关闭。

// 允许连接的服务器固定为 Zoho 的主机，不接受界面指定的主机名。
const SITES = Object.freeze({
  cn: Object.freeze({ label: '中国站（zoho.com.cn）', personal: 'imap.zoho.com.cn', organization: 'imappro.zoho.com.cn', personalDomains: Object.freeze(['zoho.com.cn']) }),
  com: Object.freeze({ label: '国际站（zoho.com）', personal: 'imap.zoho.com', organization: 'imappro.zoho.com', personalDomains: Object.freeze(['zoho.com', 'zohomail.com']) })
});
const ACCOUNT_TYPES = Object.freeze(['auto', 'personal', 'organization']);
const PORT = 993;
const TIMEOUT_MS = 30000;

function mailError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
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

// 服务器返回的文字只取可见字符并截断，避免把异常内容原样显示。
const serverText = text => String(text ?? '').replace(/[^\x20-\x7e一-鿿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);

// 把库抛出的错误换成界面可以直接显示的说明。kind：'收信' 的登录失败与 '发信' 的措辞不同，由调用方决定。
function translate(error, host) {
  if (Number.isInteger(error?.status)) return error;   // 已经是给界面的应答（如 404 找不到邮件），原样传出
  if (error && typeof error.code === 'string' && ['invalid_input', 'auth_failed', 'network', 'timeout', 'tls', 'protocol', 'smtp_rejected', 'imap_no', 'too_large'].includes(error.code)) return error;
  const code = String(error?.code || '');
  if (error?.authenticationFailed) return mailError('auth_failed', '登录被邮箱服务器拒绝。请确认：① 邮箱地址正确；② 填的是应用专用密码而不是登录密码；③ Zoho 邮箱设置里已开启 IMAP 访问；④ 站点与账号类型选择正确。' + (serverText(error.responseText) ? `（服务器回应：${serverText(error.responseText)}）` : ''));
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS') return mailError('network', `找不到邮箱服务器 ${host}。请检查网络，或确认选择的 Zoho 站点是否正确。`);
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ALTNAME|^ETLS$/.test(code)) return mailError('tls', `邮箱服务器 ${host} 的安全证书未通过验证，已中止连接。`);
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT' || /timeout/i.test(code) || /timed? ?out/i.test(String(error?.message || ''))) return mailError('timeout', `邮箱服务器 ${host} 响应超时。请检查网络后重试。`);
  if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE', 'ECONNECTION', 'ESOCKET', 'NoConnection', 'EConnectionClosed', 'ClosedAfterConnectTLS', 'ClosedAfterConnectText'].includes(code)) return mailError('network', `无法连接邮箱服务器 ${host}。请检查网络或防火墙后重试。`);
  if (error?.responseStatus === 'NO' || error?.responseStatus === 'BAD' || typeof error?.responseText === 'string') return mailError('imap_no', '邮箱服务器拒绝了这个请求：' + (serverText(error.responseText) || '未说明原因'));
  return mailError('network', `连接邮箱服务器 ${host} 失败。请稍后重试。`);
}

// 连接参数。endpoint 仅供隔离测试把连接指到本机的假服务器（明文回环），正式使用永远是 TLS 993。
function clientOptions(account, endpoint, extra = {}) {
  const user = normalizeEmail(account.email), pass = normalizePassword(account.password);
  const server = resolveServer({ email: user, site: account.site, accountType: account.accountType });
  const target = endpoint
    ? { host: endpoint.host, port: endpoint.port, secure: false, doSTARTTLS: false }
    : { host: server.host, port: server.port, secure: true, servername: server.host, tls: { minVersion: 'TLSv1.2' } };
  return { server, options: { ...target, auth: { user, pass }, logger: false, disableAutoIdle: true, disableCompression: true, connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: 2 * TIMEOUT_MS, ...extra } };
}

/**
 * 登录验证：登录成功后立即退出，不打开任何文件夹。成功返回 { site, accountType, host, port }；
 * 失败抛出带 code 的错误：invalid_input / auth_failed / network / timeout / tls / protocol。
 */
async function verifyLogin(account, { endpoint } = {}) {
  const { server, options } = clientOptions(account, endpoint, { verifyOnly: true });
  const { ImapFlow } = mailLibs();
  const client = new ImapFlow(options);
  client.on('error', () => {});
  try { await client.connect(); }
  catch (error) { throw translate(error, server.host); }
  finally { try { client.close(); } catch (_) {} }
  return { ...server };
}

module.exports = { verifyLogin, clientOptions, translate, resolveServer, normalizeEmail, normalizePassword, serverText, mailError, SITES, ACCOUNT_TYPES, PORT };
