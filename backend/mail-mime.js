const { mailLibs } = require('./mail-libs.js');

// 邮件解析由开源库 postal-mime 完成；这里只把结果整理成来财用的形状，并提供文件名净化等小工具。

const safeFilename = (value, fallback = 'attachment') => {
  const cleaned = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 150);
  return cleaned || fallback;
};

const htmlToText = html => String(html || '')
  .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// 地址（含群组写法）整理成 [{ name, address }]，地址统一小写，丢掉格式不对的。
function addresses(value) {
  const out = [];
  const visit = (entry) => {
    if (!entry) return;
    if (Array.isArray(entry)) return entry.forEach(visit);
    if (Array.isArray(entry.group)) return entry.group.forEach(visit);
    const address = String(entry.address ?? '').trim().toLowerCase();
    if (/^[^\s@<>"',;]+@[^\s@<>"',;]+$/.test(address)) out.push({ name: String(entry.name ?? '').replace(/\s+/g, ' ').trim(), address });
  };
  visit(value);
  return out;
}
const isoDate = (value) => { const parsed = value ? new Date(value) : null; return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ''; };
const headerValue = (parsed, key) => { const found = (parsed.headers || []).find(item => item.key === key); return found ? String(found.value ?? '') : ''; };
const bytes = (content) => Buffer.isBuffer(content) ? content : typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content instanceof ArrayBuffer ? new Uint8Array(content) : content || []);

function envelope(parsed) {
  return {
    from: addresses(parsed.from)[0] || { name: '', address: '' },
    to: addresses(parsed.to), cc: addresses(parsed.cc), replyTo: addresses(parsed.replyTo),
    subject: String(parsed.subject ?? '').replace(/\s+/g, ' ').trim(),
    date: isoDate(parsed.date),
    messageId: String(parsed.messageId ?? '').trim(), inReplyTo: String(parsed.inReplyTo ?? '').trim(), references: String(parsed.references ?? '').replace(/\s+/g, ' ').trim(),
  };
}

// 只有邮件头时（列表用）：发件人、收件人、主题、时间，以及是否像带附件。
async function parseHeaders(raw) {
  const parsed = await mailLibs().PostalMime.parse(raw && raw.length ? raw : Buffer.from('\r\n'));
  return { ...envelope(parsed), hasAttachment: /^\s*multipart\/mixed\b/i.test(headerValue(parsed, 'content-type')) };
}

// 列表里的正文预览：用邮件头加上正文开头的一小段拼成一封“截断的邮件”，交给同一个解析库处理编码和字符集，
// 再取前面一小段文字。引用的原文（> 开头的行、“写道：”之后的内容）不算进预览。解析不了就返回空串。
const SNIPPET_LENGTH = 140;
async function snippet(headers, partial) {
  if (!partial || !partial.length) return '';
  try {
    const head = Buffer.isBuffer(headers) && headers.length ? headers.toString('latin1').replace(/(\r?\n)+$/, '') + '\r\n\r\n' : '\r\n';
    const parsed = await mailLibs().PostalMime.parse(Buffer.concat([Buffer.from(head, 'latin1'), bytes(partial)]));
    const text = String(parsed.text ?? '').trim() || htmlToText(parsed.html);
    const lines = [];
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
      if (/^\s*>/.test(line)) continue;
      if (/(写道|wrote)\s*[:：]\s*$/i.test(line) || /^-{2,}\s*(转发的邮件|Forwarded message|Original Message|原始邮件)/i.test(line.trim())) break;
      lines.push(line);
    }
    // 截断处可能留下半个字符，去掉替换符。
    const flat = lines.join(' ').replace(/\ufffd+/g, '').replace(/\s+/g, ' ').trim();
    return flat.length > SNIPPET_LENGTH ? flat.slice(0, SNIPPET_LENGTH).trimEnd() + '…' : flat;
  } catch (_) { return ''; }
}

// 解析一封完整邮件。附件内容保留为字节，由调用方决定是否写出。
async function parseMessage(raw) {
  const parsed = await mailLibs().PostalMime.parse(raw && raw.length ? raw : Buffer.from('\r\n'));
  const html = String(parsed.html ?? '');
  const attachments = (parsed.attachments || []).slice(0, 200).map((item, index) => {
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(String(item.mimeType || '')) ? String(item.mimeType).toLowerCase() : 'application/octet-stream';
    const extension = type === 'message/rfc822' ? '.eml' : type === 'text/plain' ? '.txt' : type === 'text/html' ? '.html' : '';
    const content = bytes(item.content);
    return { index, filename: safeFilename(item.filename, 'attachment-' + (index + 1) + extension), contentType: type, size: content.length, inline: item.disposition === 'inline' || item.related === true, contentId: String(item.contentId ?? '').replace(/^<|>$/g, '').trim(), content };
  });
  return { ...envelope(parsed), text: String(parsed.text ?? '').replace(/\r\n?/g, '\n') || htmlToText(html), html, attachments };
}

module.exports = { parseMessage, parseHeaders, snippet, addresses, htmlToText, safeFilename, SNIPPET_LENGTH };
