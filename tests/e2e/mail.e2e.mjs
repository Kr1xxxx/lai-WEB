// Browser end-to-end test: the mail page (bind, receive, read, customer link, write and send, settings, unbind)
// against the local fake IMAP/SMTP servers from tests/fixtures. No real mail account is ever used (D-004).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const fake = require('../fixtures/fake-mail-servers.cjs');

const me = { name: '', address: 'sales@example-trade.com' };
const PASSWORD = 'app-password-1';
const owen = { name: 'Owen Fraser', address: 'owen@maplemoss.example' };
const stranger = { name: 'Anna Berg', address: 'anna@nordic-lamps.example' };
const evilHtml = '<p>Hello, the sample list is <b>ready for review</b>.</p>'
  + '<script>document.title="pwned";window.__pwned=1</script>'
  + '<img src="x" onerror="document.title=\'pwned\';window.__pwned=1" alt="broken">'
  + '<a href="javascript:window.__pwned=1">click me</a>';
// The mail routes answer 409 (not bound) / 422 (login refused) on purpose in some steps; those are not page errors.
// The browser also logs every time it blocks something inside the sandboxed mail frame; those are the point of the test.
const expectedHttp = /HTTP (409|422)/;
const blockedInFrame = /Blocked script execution in 'about:srcdoc'|Refused to load the image/;

let app, imap, smtp;
before(async () => {
  imap = await fake.startImap({
    password: PASSWORD,
    mailboxes: {
      INBOX: [
        { message: { from: owen, to: [me], subject: 'Re: Sample order for lipstick', date: '2026-10-06T08:00:00Z', text: 'Hello, the sample list is ready for review.', html: evilHtml, messageId: '<e2e-1@maplemoss.example>' }, flags: [] },
        { message: { from: stranger, to: [me], subject: 'Quotation request LED panels', date: '2026-10-05T14:20:00Z', text: 'Please send your best price.', messageId: '<e2e-2@nordic-lamps.example>' }, flags: ['\\Seen'] },
      ],
    },
  });
  smtp = await fake.startSmtp({ user: me.address, password: PASSWORD });
  app = await startApp({ env: { LAI_MAIL_TEST_ENDPOINTS: `${imap.port},${smtp.port}` } });
  await app.open('mail');
});
after(async () => {
  await app?.close();
  await imap?.close();
  await smtp?.close();
});

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const rows = () => app.page.locator('.mail-list .mail-row');
const rowOf = (subject) => rows().filter({ hasText: subject });
const unexpectedErrors = () => app.errors.filter((e) => !expectedHttp.test(e) && !blockedInFrame.test(e));
const account = async () => (await (await app.api('/api/mail-account')).json()).account;
const submitCompose = () => app.page.locator('button[type=submit][form="mail-compose-form"]').first().click();

async function openBindDialog() {
  await app.page.locator('[data-mail-action="bind"]').first().click();
  await app.page.locator('#mail-bind-form').waitFor();
}
async function fillBind(password) {
  await app.page.locator('#mail-bind-email').fill(me.address);
  await app.page.locator('#mail-bind-password').fill(password);
  await app.page.locator('#mail-bind-submit').click();
}

test('before binding, the mail page asks to bind an account', async () => {
  const { page } = app;
  await page.getByText('未绑定邮箱', { exact: true }).waitFor();
  await page.getByText('绑定 Zoho 邮箱后，可在这里收发邮件').waitFor();
  // Writing a mail without an account does not open an editor, it asks to bind first.
  await page.locator('[data-mail-action="compose"]').first().click();
  await page.locator('#mail-bind-form').waitFor();
  assert.equal(await page.locator('#mail-compose-form').count(), 0);
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByText('未绑定邮箱', { exact: true }).waitFor();
  assert.deepEqual(unexpectedErrors(), []);
});

test('a refused login shows a plain Chinese reason and nothing is bound', async () => {
  const { page } = app;
  await openBindDialog();
  await fillBind('wrong-password');
  await page.waitForFunction(() => document.querySelector('#mail-bind-error')?.textContent.trim().length > 0);
  const text = await page.locator('#mail-bind-error').innerText();
  assert.match(text, /登录被邮箱服务器拒绝/);
  assert.match(text, /应用专用密码/);
  assert.doesNotMatch(text, /AUTHENTICATIONFAILED|Error:|undefined|wrong-password/, 'no technical text or password in the message');
  assert.equal(await page.locator('#mail-bind-submit').innerText(), '验证并绑定', 'the button is usable again');
  assert.equal(await account(), null, 'still unbound');
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByText('未绑定邮箱', { exact: true }).waitFor();
  assert.deepEqual(unexpectedErrors(), []);
});

test('binding with the right password fills the inbox with the received mails', async () => {
  const { page } = app;
  await openBindDialog();
  await fillBind(PASSWORD);
  await rowOf('Re: Sample order for lipstick').waitFor();
  await rowOf('Quotation request LED panels').waitFor();
  assert.equal(await rows().count(), 2);
  assert.match(await rowOf('Re: Sample order for lipstick').innerText(), /Owen Fraser/);
  assert.match(await rowOf('Quotation request LED panels').innerText(), /Anna Berg/);
  assert.ok(await rowOf('Re: Sample order for lipstick').evaluate((el) => el.classList.contains('unread')), 'unread mail is marked');
  assert.ok(!(await rowOf('Quotation request LED panels').evaluate((el) => el.classList.contains('unread'))), 'seen mail is not');
  // The password is never readable by the page and never enters the business data.
  const status = await (await app.api('/api/mail-account')).text();
  assert.match(status, /sales@example-trade\.com/);
  assert.doesNotMatch(status, new RegExp(PASSWORD));
  assert.doesNotMatch(JSON.stringify(await app.readData()), new RegExp(PASSWORD));
});

test('a mail from a customer address is linked to that customer, a stranger is not', async () => {
  const { page } = app;
  const known = rowOf('Re: Sample order for lipstick');
  assert.equal(await known.locator('.mail-customer-chip').innerText(), 'Maple & Moss Cosmetics');
  assert.equal(await rowOf('Quotation request LED panels').locator('.mail-customer-chip').count(), 0);
  await known.locator('.mail-customer-chip').click();
  await page.getByText('客户详情', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByText('owen@maplemoss.example').first().waitFor();
  await app.open('mail');
  await rowOf('Re: Sample order for lipstick').waitFor();
});

// The customer filter sits in the sub-navigation, which keeps its elements when the mail page redraws
// (app.js renderShell): it must be bound once, not once per redraw, and still filter after redraws.
test('the 往来邮件 customer filter is bound once and still filters after the page redraws', async () => {
  const { page } = app;
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-mail-view="customer"]').click();
    await page.locator('#mail-customer-filter').waitFor();
    await page.locator('[data-mail-view="mail"]').click();
    await rowOf('Re: Sample order for lipstick').waitFor();
  }
  await page.locator('[data-mail-view="customer"]').click();
  const filter = page.locator('#mail-customer-filter');
  await filter.waitFor();
  const cdp = await page.context().newCDPSession(page);
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.getElementById("mail-customer-filter")' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  await cdp.detach();
  assert.equal(listeners.filter((l) => l.type === 'input').length, 1, 'one input listener on the filter');
  const all = await page.locator('.mail-customers [data-name]').count();
  assert.ok(all > 1);
  await filter.fill('maple');
  assert.deepEqual(await page.locator('.mail-customers [data-name]:not([hidden])').evaluateAll((els) => els.map((el) => el.dataset.name)), ['Maple & Moss Cosmetics']);
  await filter.fill('');
  assert.equal(await page.locator('.mail-customers [data-name]:not([hidden])').count(), all);
  await page.locator('[data-mail-view="mail"]').click();
  await rowOf('Re: Sample order for lipstick').waitFor();
});

test('opening a mail shows its body without running scripts or onerror', async () => {
  const { page } = app;
  await rowOf('Re: Sample order for lipstick').locator('.mail-row-main').click();
  await page.locator('.mail-reader-subject', { hasText: 'Re: Sample order for lipstick' }).waitFor();
  assert.match(await page.locator('.mail-reader-name').innerText(), /Owen Fraser/);
  assert.match(await page.locator('.mail-reader-address').innerText(), /owen@maplemoss\.example/);
  assert.match(await page.locator('.mail-reader-facts').innerText(), /sales@example-trade\.com/);
  const frame = page.frameLocator('iframe.mail-body-frame');
  await frame.getByText('ready for review').waitFor();
  assert.match(await frame.locator('body').innerText(), /Hello, the sample list is ready for review\./);
  await settle(600);
  assert.notEqual(await page.title(), 'pwned', 'the mail script did not change the page title');
  assert.equal(await page.evaluate(() => window.__pwned ?? null), null, 'the app page was not touched');
  const inner = await (await page.locator('iframe.mail-body-frame').elementHandle()).contentFrame();
  assert.deepEqual(await inner.evaluate(() => [document.title === 'pwned', window.__pwned ?? null]), [false, null], 'nothing ran inside the mail frame');
  const sandbox = await page.locator('iframe.mail-body-frame').getAttribute('sandbox');
  assert.doesNotMatch(sandbox, /allow-scripts|allow-same-origin/, 'the mail frame is sandboxed');
  assert.ok(app.errors.some((e) => /Blocked script execution/.test(e)), 'the browser blocked the script in the mail');
  assert.ok(app.errors.some((e) => /Refused to load the image/.test(e)), 'the browser refused the picture from the onerror tag');
  // Opening it marks it as read on the server.
  await page.waitForFunction(() => !document.querySelector('.mail-row.unread'));
  assert.ok(imap.state.message('INBOX', 1).flags.has('\\Seen'));
  assert.deepEqual(unexpectedErrors(), []);
});

test('writing a mail and sending it reaches the SMTP server', async () => {
  const { page } = app;
  await page.locator('[data-mail-action="compose"]').first().click();
  await page.locator('#mail-compose-form').waitFor();
  await page.locator('#mail-compose-to').fill('buyer@bluebellbeauty.example');
  await page.locator('#mail-compose-subject').fill('Proforma invoice PI-2026-01');
  await page.locator('#mail-compose-fromName').fill('Kris Lai');
  await page.locator('#mail-compose-editor').click();
  await page.keyboard.type('Dear Harriet, please find the proforma invoice attached later today.');
  await submitCompose();
  await page.locator('#mail-compose-form').waitFor({ state: 'detached', timeout: 10000 });
  for (let i = 0; i < 100 && !smtp.state.sent.length; i++) await settle(50);
  assert.equal(smtp.state.sent.length, 1, 'the fake SMTP server received one mail');
  await smtp.state.parsing;
  const mail = smtp.state.sent[0];
  assert.deepEqual(mail.recipients, ['buyer@bluebellbeauty.example']);
  assert.equal(mail.from, me.address);
  assert.equal(mail.parsed.subject, 'Proforma invoice PI-2026-01');
  assert.match(mail.parsed.text, /please find the proforma invoice attached later today/);
  assert.equal(mail.parsed.from.name, 'Kris Lai');
  await rows().first().waitFor();
  assert.equal((await account()).senderName, 'Kris Lai', 'the sender name is remembered for the next mail');
  assert.deepEqual(unexpectedErrors(), []);
});

test('a mail with no recipient is refused in plain Chinese and nothing is sent', async () => {
  const { page } = app;
  const sentBefore = smtp.state.sent.length;
  await page.locator('[data-mail-action="compose"]').first().click();
  await page.locator('#mail-compose-form').waitFor();
  await page.locator('#mail-compose-subject').fill('No recipient');
  await submitCompose();
  await page.waitForFunction(() => document.querySelector('#mail-compose-error')?.textContent.trim().length > 0);
  const text = await page.locator('#mail-compose-error').innerText();
  assert.match(text, /收件人/);
  assert.doesNotMatch(text, /Error|undefined|invalid_input/);
  assert.equal(smtp.state.sent.length, sentBefore);
  await app.open('mail'); // leaves the unsaved compose page behind
  await rows().first().waitFor();
});

test('a recipient the mail server refuses is reported in plain Chinese and the writing stays', async () => {
  const { page } = app;
  smtp.state.reject.add('nobody@gone.example');
  await page.locator('[data-mail-action="compose"]').first().click();
  await page.locator('#mail-compose-form').waitFor();
  await page.locator('#mail-compose-to').fill('nobody@gone.example');
  await page.locator('#mail-compose-subject').fill('Refused recipient');
  await submitCompose();
  await page.waitForFunction(() => document.querySelector('#mail-compose-error')?.textContent.trim().length > 0);
  const text = await page.locator('#mail-compose-error').innerText();
  assert.match(text, /[一-鿿]/, 'the reason is in Chinese');
  assert.doesNotMatch(text, /^Error|undefined|smtp_rejected|\[object/);
  assert.equal(await page.locator('#mail-compose-subject').inputValue(), 'Refused recipient', 'what was typed is kept');
  assert.ok(!smtp.state.sent.some((m) => m.recipients.includes('nobody@gone.example')));
  await app.open('mail');
  await rows().first().waitFor();
  assert.deepEqual(unexpectedErrors(), []);
});

test('mail settings (sender name and signature) save and persist after a reload', async () => {
  const { page } = app;
  await page.locator('[data-mail-action="account"]').first().click();
  await page.locator('#mail-settings-name').waitFor();
  assert.equal(await page.locator('#mail-settings-name').inputValue(), 'Kris Lai');
  await page.locator('#mail-settings-name').fill('来财销售部');
  await page.locator('#mail-settings-signature').fill('Kris Lai\nExample Trade Co.');
  await page.locator('[data-mail-action="settings-save"]').click();
  await settle(800);
  const saved = await account();
  assert.equal(saved.senderName, '来财销售部');
  assert.equal(saved.signature, 'Kris Lai\nExample Trade Co.');
  await app.open('mail');
  await rows().first().waitFor();
  await page.locator('[data-mail-action="account"]').first().click();
  await page.locator('#mail-settings-name').waitFor();
  assert.equal(await page.locator('#mail-settings-name').inputValue(), '来财销售部');
  assert.match(await page.locator('#mail-settings-signature').inputValue(), /Example Trade Co\./);
  await page.locator('.mail-dialog .k-dialog-foot [data-action="close-modal"]').click();
  assert.deepEqual(unexpectedErrors(), []);
});

test('unbinding asks first, then the mail page is empty and the account is gone', async () => {
  const { page } = app;
  await page.locator('[data-mail-action="account"]').first().click();
  await page.locator('[data-mail-action="unbind"]').click();
  await page.getByText('解除 sales@example-trade.com 的绑定？').waitFor();
  await page.getByRole('button', { name: '取消' }).click();
  assert.equal((await account()).email, me.address, 'cancelling keeps the account');
  await page.locator('[data-mail-action="account"]').first().click();
  await page.locator('[data-mail-action="unbind"]').click();
  await page.locator('[data-mail-action="unbind-confirm"]').click();
  await page.getByText('未绑定邮箱', { exact: true }).waitFor();
  assert.equal(await account(), null);
  assert.equal(await rows().count(), 0);
  await app.open('mail');
  await page.getByText('未绑定邮箱', { exact: true }).waitFor();
  assert.deepEqual(unexpectedErrors(), []);
});
