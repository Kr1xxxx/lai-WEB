const crypto = require('node:crypto');

// 邮件内容的解析与生成。只处理字节与文本，不做任何网络操作。

const CHARSET_ALIASES = { 'gb2312': 'gbk', 'gb_2312-80': 'gbk', 'x-gbk': 'gbk', 'cp936': 'gbk', 'utf8': 'utf-8', 'us-ascii': 'utf-8', 'ascii': 'utf-8', 'ansi_x3.4-1968': 'utf-8', 'ks_c_5601-1987': 'euc-kr', 'cp1252': 'windows-1252', 'latin1': 'windows-1252', 'iso-8859-1': 'windows-1252', 'big5-hkscs': 'big5', 'x-sjis': 'shift_jis', 'cp932': 'shift_jis' };

function decodeBytes(buffer, charset) {
  const name = String(charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  try { return new TextDecoder(CHARSET_ALIASES[name] || name).decode(buffer); }
  catch (_) { return new TextDecoder('utf-8').decode(buffer); }
}
// 未声明编码的文字：是合法 UTF-8 就按 UTF-8，否则按单字节读，避免整段变成乱码符号。
function decodeLoose(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch (_) { return buffer.toString('latin1'); }
}

function decodeQuotedPrintable(buffer, underscoreIsSpace = false) {
  const out = Buffer.alloc(buffer.length);
  let n = 0;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte === 0x3d) {
      if (buffer[i + 1] === 0x0d && buffer[i + 2] === 0x0a) { i += 2; continue; }
      if (buffer[i + 1] === 0x0a) { i += 1; continue; }
      const hex = buffer.toString('latin1', i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out[n++] = parseInt(hex, 16); i += 2; continue; }
      out[n++] = byte;
    } else if (underscoreIsSpace && byte === 0x5f) out[n++] = 0x20;
    else out[n++] = byte;
  }
  return out.subarray(0, n);
}

// =?charset?B?...?= 形式的标题/姓名。相邻的同编码片段先拼接字节再解码，避免把一个汉字拆坏。
function decodeWords(value) {
  const text = String(value ?? '');
  if (!text.includes('=?')) return text;
  const pattern = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;
  let result = '', last = 0, pending = null, match, hadPrevious = false;
  const flush = () => { if (pending) { result += decodeBytes(Buffer.concat(pending.chunks), pending.charset); pending = null; } };
  while ((match = pattern.exec(text))) {
    const between = text.slice(last, match.index);
    const adjacent = hadPrevious && /^\s*$/.test(between);
    const charset = match[1].split('*')[0].toLowerCase();
    const bytes = match[2].toLowerCase() === 'b' ? Buffer.from(match[3], 'base64') : decodeQuotedPrintable(Buffer.from(match[3], 'latin1'), true);
    if (adjacent && pending.charset === charset) pending.chunks.push(bytes);
    else { flush(); if (!adjacent) result += between; pending = { charset, chunks: [bytes] }; }
    hadPrevious = true;
    last = pattern.lastIndex;
  }
  flush();
  return result + text.slice(last);
}

function parseHeaderBlock(buffer) {
  const text = decodeLoose(buffer);
  const headers = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) { current.value += ' ' + line.trim(); continue; }
    const colon = line.indexOf(':');
    if (colon <= 0) { current = null; continue; }
    current = { name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() };
    if (!headers.has(current.name)) headers.set(current.name, []);
    headers.get(current.name).push(current);
  }
  const get = name => (headers.get(name) || [])[0]?.value ?? '';
  return { get, all: name => (headers.get(name) || []).map(item => item.value) };
}

// "姓名" <a@b.com>, c@d.com 形式的地址列表。
function parseAddressList(value) {
  const text = String(value ?? '');
  const result = [];
  let name = '', address = '', inQuote = false, inAngle = false, depth = 0, hadAngle = false;
  const push = () => {
    let display = decodeWords(name.trim()).replace(/\s+/g, ' ').trim(), mail = address.trim();
    if (!hadAngle) { mail = name.trim(); display = ''; }
    mail = mail.replace(/^<|>$/g, '').trim().toLowerCase();
    if (/^[^\s@<>"',;]+@[^\s@<>"',;]+$/.test(mail)) result.push({ name: display, address: mail });
    name = ''; address = ''; hadAngle = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuote) { if (char === '\\' && i + 1 < text.length) name += text[++i]; else if (char === '"') inQuote = false; else name += char; continue; }
    if (depth) { if (char === '(') depth++; else if (char === ')') depth--; continue; }
    if (inAngle) { if (char === '>') inAngle = false; else address += char; continue; }
    if (char === '"') inQuote = true;
    else if (char === '(') depth = 1;
    else if (char === '<') { inAngle = true; hadAngle = true; }
    else if (char === ',' || char === ';') push();
    else if (char === ':') name = '';
    else name += char;
  }
  push();
  return result;
}

// Content-Type / Content-Disposition 的主值与参数（含 filename*=UTF-8''… 与分段写法）。
function parseParameterized(value) {
  const parts = [];
  let current = '', inQuote = false;
  for (let i = 0; i < String(value ?? '').length; i++) {
    const char = value[i];
    if (inQuote) { if (char === '\\' && i + 1 < value.length) current += value[++i]; else if (char === '"') inQuote = false; else current += char; }
    else if (char === '"') inQuote = true;
    else if (char === ';') { parts.push(current); current = ''; }
    else current += char;
  }
  parts.push(current);
  const main = parts.shift().trim().toLowerCase();
  const plain = {}, extended = {};
  for (const part of parts) {
    const equals = part.indexOf('=');
    if (equals <= 0) continue;
    const key = part.slice(0, equals).trim().toLowerCase(), raw = part.slice(equals + 1).trim();
    const match = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(key);
    if (!match) continue;
    if (match[2] === undefined && !match[3]) { plain[match[1]] = raw; continue; }
    (extended[match[1]] ||= []).push({ index: Number(match[2] || 0), encoded: !!match[3], raw });
  }
  const params = { ...plain };
  for (const [key, pieces] of Object.entries(extended)) {
    pieces.sort((a, b) => a.index - b.index);
    let charset = 'utf-8';
    const buffers = pieces.map((piece, position) => {
      let raw = piece.raw;
      if (piece.encoded) {
        if (position === 0) { const quote = /^([^']*)'[^']*'(.*)$/.exec(raw); if (quote) { charset = quote[1] || 'utf-8'; raw = quote[2]; } }
        return Buffer.from(raw.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
      }
      return Buffer.from(raw, 'utf8');
    });
    params[key] = decodeBytes(Buffer.concat(buffers), charset);
  }
  return { value: main, params };
}

function splitMessage(buffer) {
  let index = buffer.indexOf('\r\n\r\n'), gap = 4;
  const alt = buffer.indexOf('\n\n');
  if (index < 0 || (alt >= 0 && alt < index)) { index = alt; gap = 2; }
  if (index < 0) return { head: buffer, body: Buffer.alloc(0) };
  return { head: buffer.subarray(0, index), body: buffer.subarray(index + gap) };
}

function decodeTransfer(body, encoding) {
  const kind = String(encoding || '').trim().toLowerCase();
  if (kind === 'base64') return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (kind === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
}

function splitMultipart(body, boundary) {
  const marker = Buffer.from('--' + boundary, 'latin1');
  const parts = [];
  let position = body.indexOf(marker);
  while (position >= 0) {
    let start = position + marker.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    const lineEnd = body.indexOf('\n', start);
    if (lineEnd < 0) break;
    start = lineEnd + 1;
    let next = body.indexOf(marker, start);
    while (next >= 0 && body[next - 1] !== 0x0a) next = body.indexOf(marker, next + 1);
    let end = next < 0 ? body.length : next - 1;
    if (end > start && body[end - 1] === 0x0d) end--;
    if (end >= start) parts.push(body.subarray(start, Math.max(start, end)));
    position = next;
  }
  return parts;
}

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

function summarizeHeaders(headers) {
  const dateValue = headers.get('date');
  const parsedDate = dateValue ? new Date(dateValue) : null;
  return {
    from: parseAddressList(headers.get('from'))[0] || { name: '', address: '' },
    to: parseAddressList(headers.get('to')),
    cc: parseAddressList(headers.get('cc')),
    replyTo: parseAddressList(headers.get('reply-to')),
    subject: decodeWords(headers.get('subject')).replace(/\s+/g, ' ').trim(),
    date: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : '',
    messageId: headers.get('message-id').trim(),
    inReplyTo: headers.get('in-reply-to').trim(),
    references: headers.get('references').trim(),
  };
}

// 解析一封完整邮件。附件内容保留为字节，由调用方决定是否写出。
function parseMessage(raw, { maxDepth = 12, maxParts = 200 } = {}) {
  const top = splitMessage(raw);
  const headers = parseHeaderBlock(top.head);
  const result = { ...summarizeHeaders(headers), text: '', html: '', attachments: [] };
  let count = 0;
  const walk = (head, body, depth, alternative) => {
    if (++count > maxParts) return;
    const type = parseParameterized(head.get('content-type') || 'text/plain');
    const disposition = parseParameterized(head.get('content-disposition'));
    const filename = disposition.params.filename || type.params.name || '';
    if (type.value.startsWith('multipart/') && type.params.boundary && depth < maxDepth) {
      for (const part of splitMultipart(body, type.params.boundary)) {
        const child = splitMessage(part);
        walk(parseHeaderBlock(child.head), child.body, depth + 1, type.value === 'multipart/alternative');
      }
      return;
    }
    const content = decodeTransfer(body, head.get('content-transfer-encoding'));
    const isAttachment = disposition.value === 'attachment' || !!filename || !/^text\/(plain|html)$/.test(type.value);
    if (!isAttachment && type.value === 'text/plain' && !result.text) { result.text = decodeBytes(content, type.params.charset); return; }
    if (!isAttachment && type.value === 'text/html' && !result.html) { result.html = decodeBytes(content, type.params.charset); return; }
    if (!isAttachment && alternative) return;
    const extension = type.value === 'message/rfc822' ? '.eml' : type.value === 'text/plain' ? '.txt' : type.value === 'text/html' ? '.html' : '';
    result.attachments.push({
      index: result.attachments.length,
      filename: safeFilename(decodeWords(filename), 'attachment-' + (result.attachments.length + 1) + extension),
      contentType: /^[\w.+-]+\/[\w.+-]+$/.test(type.value) ? type.value : 'application/octet-stream',
      size: content.length,
      inline: disposition.value === 'inline',
      contentId: head.get('content-id').replace(/^<|>$/g, '').trim(),
      content,
    });
  };
  walk(headers, top.body, 0, false);
  if (!result.text && result.html) result.text = htmlToText(result.html);
  result.text = result.text.replace(/\r\n?/g, '\n');
  return result;
}

// ---- 生成 ----

const isPlainAscii = value => /^[\x20-\x7e]*$/.test(value);
const oneLine = value => String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();

function encodeWord(value) {
  const text = oneLine(value);
  if (isPlainAscii(text) && !text.includes('=?')) return text;
  const words = [];
  let chunk = '';
  for (const char of text) {
    if (Buffer.byteLength(chunk + char, 'utf8') > 45) { words.push(chunk); chunk = ''; }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map(word => '=?UTF-8?B?' + Buffer.from(word, 'utf8').toString('base64') + '?=').join('\r\n ');
}

function formatAddress({ name, address }) {
  const display = oneLine(name);
  if (!display) return address;
  if (isPlainAscii(display)) return '"' + display.replace(/[\\"]/g, '\\$&') + '" <' + address + '>';
  return encodeWord(display) + ' <' + address + '>';
}

const foldList = items => items.join(',\r\n ');
const wrapBase64 = buffer => buffer.toString('base64').replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
const messageIdList = value => (String(value ?? '').match(/<[^<>\s]{1,300}>/g) || []).slice(-20).join(' ');

/**
 * 生成一封待发送的邮件（纯文本正文，可带附件）。Bcc 不写入邮件头。
 * attachments: [{ filename, contentType, content: Buffer }]
 */
function buildMessage({ from, to = [], cc = [], subject = '', text = '', attachments = [], inReplyTo = '', references = '', date = new Date(), messageId }) {
  const domain = from.address.split('@')[1];
  const id = messageId || `<${crypto.randomBytes(16).toString('hex')}@${domain}>`;
  const headers = [
    'From: ' + formatAddress(from),
    ...(to.length ? ['To: ' + foldList(to.map(formatAddress))] : []),
    ...(cc.length ? ['Cc: ' + foldList(cc.map(formatAddress))] : []),
    'Subject: ' + encodeWord(subject),
    'Date: ' + date.toUTCString().replace('GMT', '+0000'),
    'Message-ID: ' + id,
    ...(messageIdList(inReplyTo) ? ['In-Reply-To: ' + messageIdList(inReplyTo)] : []),
    ...(messageIdList(references) ? ['References: ' + messageIdList(references).replace(/ /g, '\r\n ')] : []),
    'MIME-Version: 1.0',
  ];
  const body = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  const textPart = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrapBase64(Buffer.from(body, 'utf8'))];
  let lines;
  if (!attachments.length) lines = [...headers, ...textPart];
  else {
    const boundary = '----lai-' + crypto.randomBytes(12).toString('hex');
    lines = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', '--' + boundary, ...textPart];
    for (const attachment of attachments) {
      const name = safeFilename(attachment.filename);
      const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_');
      const type = /^[\w.+-]+\/[\w.+-]+$/.test(String(attachment.contentType || '')) ? attachment.contentType : 'application/octet-stream';
      lines.push('--' + boundary, `Content-Type: ${type}; name="${ascii}"`, 'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${ascii}";\r\n filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`, '', wrapBase64(attachment.content));
    }
    lines.push('--' + boundary + '--');
  }
  return { messageId: id, raw: Buffer.from(lines.join('\r\n') + '\r\n', 'utf8') };
}

module.exports = { parseMessage, parseHeaderBlock, summarizeHeaders, parseAddressList, parseParameterized, decodeWords, decodeBytes, htmlToText, safeFilename, buildMessage, formatAddress, encodeWord };
