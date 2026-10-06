const imap = require('./mail-imap.js');
const { mailLibs } = require('./mail-libs.js');

// 发信：由开源库 nodemailer 通过 Zoho 的发信服务器（TLS 465）提交。只在用户点击发送时调用。
// 主机固定，不接受界面指定；密码不写入日志或错误信息。

const HOSTS = Object.freeze({
  cn: Object.freeze({ personal: 'smtp.zoho.com.cn', organization: 'smtppro.zoho.com.cn' }),
  com: Object.freeze({ personal: 'smtp.zoho.com', organization: 'smtppro.zoho.com' })
});
const PORT = 465;
const TIMEOUT_MS = 60000;

function resolveServer(account) {
  const resolved = imap.resolveServer(account);
  return { host: HOSTS[resolved.site][resolved.accountType], port: PORT };
}

function translate(error, host) {
  const code = String(error?.code || ''), reply = imap.serverText(error?.response || error?.message);
  if (code === 'EAUTH' || code === 'ENOAUTH') return imap.mailError('auth_failed', '发信登录失败。请确认应用专用密码仍然有效，并且 Zoho 账号允许通过 SMTP 发信。' + (imap.serverText(error?.response) ? `（服务器回应：${imap.serverText(error.response)}）` : ''));
  if (code === 'EENVELOPE') {
    const rejected = Array.isArray(error.rejected) ? error.rejected.map(String) : [];
    return imap.mailError('smtp_rejected', rejected.length ? `收件人 ${rejected.join('、')} 被发信服务器拒绝，邮件没有发出：${reply}` : `发信服务器不接受这封邮件的发件人或收件人：${reply}`, { rejected });
  }
  if (code === 'EMESSAGE' || (Number(error?.responseCode) >= 500 && Number(error?.responseCode) < 600)) return imap.mailError('smtp_rejected', '发信服务器没有接受这封邮件：' + reply);
  if (code === 'ETIMEDOUT') return imap.mailError('timeout', `发信服务器 ${host} 响应超时。邮件可能没有发出，请到 Zoho 的已发送里确认后再决定是否重发。`);
  if (code === 'EPROTOCOL') return imap.mailError('protocol', '发信服务器的应答异常，已中止。');
  return imap.translate(error, host);
}

/**
 * 发送一封邮件。mail：{ from:{name,address}, to, cc, bcc（均为 [{name,address}]）, subject, text, html, attachments:[{filename, contentType, content}], inReplyTo, references, date }。
 * 返回 { messageId, accepted, rejected }。服务器只拒绝其中部分收件人时，邮件仍会发给其余收件人，被拒的列在 rejected 里。
 */
async function send({ account, mail }, { endpoint } = {}) {
  const server = resolveServer(account);
  const user = imap.normalizeEmail(account.email), pass = imap.normalizePassword(account.password);
  const target = endpoint
    ? { host: endpoint.host, port: endpoint.port, secure: false, ignoreTLS: true }
    : { host: server.host, port: server.port, secure: true, tls: { servername: server.host, minVersion: 'TLSv1.2' } };
  const transport = mailLibs().createTransport({ ...target, auth: { user, pass }, authMethod: 'LOGIN', name: 'lai.local', logger: false, disableFileAccess: true, disableUrlAccess: true, connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: 2 * TIMEOUT_MS });
  const address = item => (item.name ? { name: item.name, address: item.address } : item.address);
  try {
    const info = await transport.sendMail({
      from: address(mail.from), to: (mail.to || []).map(address), cc: (mail.cc || []).map(address), bcc: (mail.bcc || []).map(address),
      subject: mail.subject || '', text: mail.text || '', ...(mail.html ? { html: mail.html } : {}),
      attachments: (mail.attachments || []).map(item => ({ filename: item.filename, content: item.content, contentType: item.contentType || 'application/octet-stream', ...(item.cid ? { cid: item.cid, contentDisposition: 'inline' } : {}) })),
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}), ...(mail.references ? { references: mail.references } : {}), ...(mail.date ? { date: mail.date } : {}),
    });
    return { messageId: info.messageId || '', accepted: (info.accepted || []).map(String), rejected: (info.rejected || []).map(String) };
  } catch (error) { throw translate(error, server.host); }
  finally { try { transport.close(); } catch (_) {} }
}

module.exports = { send, resolveServer, HOSTS, PORT };
