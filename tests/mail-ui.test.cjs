const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('../src/model.js');
require('../src/mail-ui.js');
const Mail = globalThis.LaiMailUI;

function create() {
  const mounted = [];
  const mail = Mail.create({ escape: escapeHtml, icon: name => `<svg data-icon="${name}"></svg>`, mount: html => mounted.push(html) });
  return { mail, mounted };
}

test('mail navigation lists exactly the six confirmed folders', () => {
  assert.deepEqual(Mail.folders.map(f => f.label), ['收件箱', '待处理邮件', '未读邮件', '草稿箱', '发件箱', '群发箱']);
  const { mail } = create();
  const html = mail.subnav();
  assert.equal([...html.matchAll(/data-mail-folder="/g)].length, 6);
  for (const excluded of ['文件夹', '标签邮件', '已删除邮件', '垃圾邮件', '追踪信息', '下属']) assert.ok(!html.includes(excluded), excluded);
});

test('every folder shows the unbound-mailbox empty state and marks itself active', () => {
  const { mail, mounted } = create();
  for (const folder of Mail.folders) {
    mail.select(folder.id);
    const html = mounted.at(-1);
    assert.ok(html.includes(`<h1>${folder.label}</h1>`));
    assert.ok(html.includes('未绑定邮箱'));
    assert.match(mail.subnav(), new RegExp(`class="nav-entry active" data-mail-folder="${folder.id}"`));
    assert.equal([...mail.subnav().matchAll(/nav-entry active/g)].length, 1);
  }
});

test('unknown folder falls back to inbox', () => {
  const { mail } = create();
  mail.select('sent');
  mail.select('nope');
  assert.equal(mail.folder(), 'inbox');
  mail.select('sent');
  mail.select();
  assert.equal(mail.folder(), 'inbox');
});

test('compose and bind stay reserved entries; skeleton has no form, network or storage access', () => {
  const { mail } = create();
  const html = mail.subnav() + mail.page();
  assert.match(html, /data-feature="写信"/);
  assert.match(html, /data-feature="绑定邮箱"/);
  assert.ok(!/<form|<input|<textarea/.test(html));
  const source = fs.readFileSync(path.join(__dirname, '../src/mail-ui.js'), 'utf8');
  for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'smtp', 'imap', '/api/']) assert.ok(!source.includes(banned), banned);
});

test('mail module is wired into the template, build and app routing', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const marker of ['<!--MAIL_STYLE-->', '<!--LAI_MAIL_UI-->']) {
    assert.equal(read('src/template.html').split(marker).length, 2, marker);
    assert.ok(read('scripts/build.py').includes(marker), marker);
  }
  const app = read('src/app.js');
  assert.ok(app.includes('["mail", "邮件", "mail"]'));
  assert.ok(app.indexOf('<!--LAI_MAIL_UI-->') < 0);
  assert.ok(read('src/template.html').indexOf('<!--LAI_MAIL_UI-->') < read('src/template.html').indexOf('<!--PREVIEW_APP-->'));
});
