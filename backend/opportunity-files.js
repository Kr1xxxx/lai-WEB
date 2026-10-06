'use strict';
// 商机附件：文件存在应用数据目录的 attachments/opportunities/<商机>/ 下（和订单、客户的附件同一个根目录，
// 所以备份会一并复制）。商机里只记名称、大小、类型和 /attachments/... 地址，保存由前端随商机一起提交。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { httpError } = require('./errors.js');

const MAX_BYTES = 20 * 1024 * 1024;
const URL_PREFIX = '/attachments/opportunities/';
// 与 src/opportunity-model.js 的 BLOCKED_EXTENSIONS 保持一致（tests/opportunity-files.test.cjs 核对）。
const BLOCKED_EXTENSIONS = ['app', 'bat', 'bin', 'cmd', 'com', 'command', 'csh', 'deb', 'dll', 'dmg', 'exe', 'jar', 'ksh', 'lnk', 'msi', 'pif', 'pkg', 'ps1', 'rpm', 'run', 'scr', 'sh', 'terminal', 'tool', 'vbs', 'workflow', 'zsh'];
// 只有这些图片可以在页面里直接预览；SVG 里可能带脚本，一律按下载处理。
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const KNOWN_TYPES = { ...IMAGE_TYPES, pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip' };

const fail = (status, code, message) => httpError(status, message, { code });

function safeName(value) {
  let name = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '').replace(/[\\/]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim();
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
  const chars = [...name];
  if (chars.length > 120) name = [...name.slice(0, name.length - extension.length)].slice(0, 120 - [...extension].length).join('') + extension;
  return name;
}
const extensionOf = name => { const match = /\.([A-Za-z0-9]{1,12})\s*$/.exec(String(name || '')); return match ? match[1].toLowerCase() : ''; };
// 存到磁盘上的文件名只留安全字符，原名另外记在商机里；这样名字里的奇怪字符不会影响路径。
function diskName(name) {
  const extension = extensionOf(name);
  const stem = (extension ? name.slice(0, name.length - extension.length - 1) : name).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 60).trim() || 'file';
  return `${crypto.randomBytes(5).toString('hex')}-${stem}${extension ? '.' + extension : ''}`;
}
function folderName(id) {
  const text = String(id ?? '');
  if (!text || text.length > 200) throw fail(400, 'invalid_input', '商机编号无效');
  const clean = text.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60);
  return clean === text ? clean : `${clean}-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 10)}`;
}

function createOpportunityFiles({ attachmentsDir, downloadsDir, reveal = () => {} }) {
  const root = path.resolve(attachmentsDir, 'opportunities');

  function resolve(fileUrl) {
    const text = String(fileUrl ?? '');
    if (!text.startsWith(URL_PREFIX) || text.includes('?') || text.includes('#')) throw fail(400, 'invalid_input', '附件地址无效');
    let relative;
    try { relative = decodeURIComponent(text.slice(URL_PREFIX.length)); } catch (_) { throw fail(400, 'invalid_input', '附件地址无效'); }
    const target = path.resolve(root, relative);
    // 必须是 opportunities/<文件夹>/<文件> 两层，且不能跳出这个目录。
    if (!target.startsWith(root + path.sep) || path.relative(root, target).split(path.sep).length !== 2 || relative.includes('\u0000')) throw fail(400, 'invalid_input', '附件地址无效');
    return target;
  }
  const urlOf = (folder, file) => URL_PREFIX + encodeURIComponent(folder) + '/' + encodeURIComponent(file);

  // body：整个文件的字节（调用方已限制长度）。
  function upload({ id, name, type, body }) {
    const clean = safeName(name);
    if (!clean) throw fail(400, 'invalid_input', '文件名不能为空');
    if (BLOCKED_EXTENSIONS.includes(extensionOf(clean))) throw fail(400, 'blocked_type', `「${clean}」是可执行或安装类文件，出于安全不能作为附件`);
    if (!Buffer.isBuffer(body) || body.length === 0) throw fail(400, 'invalid_input', `「${clean}」是空文件`);
    if (body.length > MAX_BYTES) throw fail(413, 'too_large', `「${clean}」超过 20 MB，请压缩后再传`);
    const folder = folderName(id), directory = path.join(root, folder);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = diskName(clean);
    try { fs.writeFileSync(path.join(directory, file), body, { flag: 'wx', mode: 0o600 }); }
    catch (error) { throw fail(500, 'save_failed', '文件保存失败：' + (error.code || '未知原因')); }
    const known = KNOWN_TYPES[extensionOf(clean)];
    return { ok: true, file: { name: clean, size: body.length, type: String(type || '').slice(0, 100).replace(/[^\x21-\x7e ]/g, '') || (known || 'application/octet-stream').split(';')[0], fileUrl: urlOf(folder, file) } };
  }

  // 读取：图片按图片类型内联返回（页面里预览），其他一律按下载返回；类型由扩展名决定，不信任上传时的类型。
  function read(fileUrl) {
    const target = resolve(fileUrl);
    let stat;
    try { stat = fs.statSync(target); } catch (_) { throw fail(404, 'not_found', '找不到这个文件，可能已被移动或删除'); }
    if (!stat.isFile()) throw fail(404, 'not_found', '找不到这个文件');
    const extension = extensionOf(target), image = IMAGE_TYPES[extension];
    const display = path.basename(target).replace(/^[0-9a-f]{10}-/, '');
    return {
      body: fs.readFileSync(target),
      type: image || KNOWN_TYPES[extension] || 'application/octet-stream',
      headers: {
        'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(display)}`,
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
      }
    };
  }

  // 另存到「下载」文件夹并在访达里显示。name 是商机里记的名称（可能被改过名）。
  function saveCopy({ fileUrl, name }) {
    const source = resolve(fileUrl);
    if (!fs.existsSync(source)) throw fail(404, 'not_found', '找不到这个文件，可能已被移动或删除');
    fs.mkdirSync(downloadsDir, { recursive: true });
    const clean = safeName(name) || path.basename(source).replace(/^[0-9a-f]{10}-/, '');
    const extension = path.extname(clean), stem = clean.slice(0, clean.length - extension.length);
    for (let attempt = 0; attempt < 500; attempt++) {
      const target = path.join(downloadsDir, attempt ? `${stem} (${attempt})${extension}` : clean);
      try { fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o600); }
      catch (error) { if (error.code === 'EEXIST') continue; throw fail(500, 'save_failed', '保存失败：' + (error.code || '未知原因')); }
      try { reveal(target); } catch (_) {}
      return { ok: true, file: target, filename: path.basename(target) };
    }
    throw fail(500, 'save_failed', '保存失败：同名文件太多');
  }

  // 删除一批文件；已经不存在的算成功（可以重复调用）。最后清掉空文件夹。
  function remove(fileUrls) {
    const urls = Array.isArray(fileUrls) ? fileUrls : [];
    if (urls.length > 200) throw fail(400, 'invalid_input', '一次删除的文件太多');
    const targets = urls.map(resolve);
    let removed = 0;
    for (const target of targets) {
      try { fs.rmSync(target); removed += 1; } catch (error) { if (error.code !== 'ENOENT') throw fail(500, 'delete_failed', '删除文件失败：' + (error.code || '未知原因')); }
      try { fs.rmdirSync(path.dirname(target)); } catch (_) {}
    }
    return { ok: true, removed };
  }

  return { upload, read, saveCopy, remove, MAX_BYTES };
}

module.exports = { createOpportunityFiles, BLOCKED_EXTENSIONS, MAX_BYTES };
