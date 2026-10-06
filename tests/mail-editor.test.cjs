const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 编辑器模块在没有浏览器的环境里能测的部分：工具栏标记、文字与 HTML 的互转、缺少净化库时的退路。
// 真实的净化（DOMPurify）与编辑（Squire）是第三方库，在浏览器走查里验证。
const source = fs.readFileSync(path.join(__dirname, '../src/mail-editor.js'), 'utf8');
const load = (globals = {}) => { const sandbox = { ...globals }; sandbox.window = sandbox; vm.runInNewContext(source, sandbox); return sandbox.LaiMailEditor; };

test('the toolbar offers the formatting commands as plain buttons and selects', () => {
  const html = load().toolbar();
  assert.deepEqual([...html.matchAll(/data-editor-command="([\w-]+)"/g)].map(m => m[1]), ['bold', 'italic', 'underline', 'strike', 'ul', 'ol', 'quote', 'unquote', 'link', 'image', 'clear', 'undo', 'redo', 'link-apply', 'link-cancel']);
  assert.deepEqual([...html.matchAll(/data-editor-select="(\w+)"/g)].map(m => m[1]), ['size', 'color']);
  assert.match(html, /<span class="mail-editor-link" hidden>/); assert.match(html, /<input type="file" accept="image\/png,image\/jpeg,image\/gif,image\/webp" data-editor-image hidden>/);
  assert.equal([...html.matchAll(/<button type="button"/g)].length, [...html.matchAll(/<button/g)].length, 'no toolbar button can submit the compose form');
});

test('text converts to escaped html lines and back', () => {
  const editor = load();
  assert.equal(editor.textToHtml('a <b>\n\n"c" & d'), '<div>a &lt;b&gt;</div><div><br></div><div>&quot;c&quot; &amp; d</div>');
  assert.equal(editor.htmlToText('<div>a &lt;b&gt;</div><div><br></div><p>x&nbsp;&amp; y</p><blockquote>q</blockquote>'), 'a <b>\n\nx & y\nq');
});

test('without the sanitizer, html is reduced to text instead of being trusted', () => {
  const editor = load();
  assert.equal(editor.clean('<p>Hello <b>there</b></p><script>alert(1)</script><img src=x onerror=alert(2)>'), '<div>Hello there</div><div>alert(1)</div>');
  const calls = [];
  const withPurify = load({ DOMPurify: { sanitize: (html, options) => { calls.push(options); return 'SAFE:' + html.length; } } });
  assert.equal(withPurify.clean('<p>x</p>'), 'SAFE:8');
  assert.ok(calls[0].FORBID_TAGS.includes('form') && calls[0].FORBID_TAGS.includes('iframe') && calls[0].FORBID_TAGS.includes('style'), 'forms, frames and style blocks are dropped from quoted mail');
});

test('the vendored editor and sanitizer are the released files, with their licenses beside them', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '../vendor', file), 'utf8');
  assert.match(read('dompurify/purify.min.js').slice(0, 200), /DOMPurify 3\.\d+\.\d+/); assert.match(read('dompurify/LICENSE'), /Apache License|Mozilla Public License/);
  assert.match(read('squire/squire-raw.js'), /window\.Squire = Squire;/); assert.match(read('squire/LICENSE'), /MIT|Permission is hereby granted/);
  const readme = read('mail-libs/README.md');
  for (const name of ['imapflow', 'nodemailer', 'postal-mime', 'libmime', 'iconv-lite']) { assert.match(readme, new RegExp('\\| ' + name + ' \\| \\d')); assert.match(read('mail-libs/LICENSES.txt'), new RegExp('^' + name + ' \\d', 'm')); }
  assert.match(readme, /`[0-9a-f]{40}`/, 'each library is pinned to an exact commit');
  const libs = require('../backend/mail-libs.js').mailLibs();
  assert.deepEqual(Object.keys(libs).sort(), ['ImapFlow', 'MailComposer', 'PostalMime', 'createTransport']);
});
