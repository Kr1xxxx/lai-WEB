// 沟通 (WhatsApp, D-023) in the real page with the real backend: import an exported chat (preview, confirm, dedupe,
// undo), click-to-chat with a stubbed window.open, scope for a 业务 account, and the permission switches.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { root, startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const R = require('../../src/role-model.js');
const FIXTURE = (name) => path.join(root, 'docs/samples/whatsapp', name);

const MARIA = 'Maria Test Trading';
const DAN = 'Amy Buyer Ltd';
let app;

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const pageErrors = () => app.errors.filter((e) => !/HTTP 409: .*\/api\/mail\//.test(e));
const go = async (route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(600);
};
const openCustomer = async (name) => {
  const url = new URL(app.page.url());
  url.searchParams.set('customer', name);
  url.searchParams.set('n', String(Date.now())); // the same URL with another hash would not reload the page
  url.hash = 'customers';
  await app.page.goto(url.toString());
  await app.page.waitForLoadState('networkidle');
  await app.page.locator('.lcd-root').waitFor();
};
const switchTo = async (label) => {
  await app.page.locator('[data-action="profile-menu"]').click();
  await app.page.locator('.popover.account-menu [data-lai-switch-member]', { hasText: label }).click();
  await app.page.locator('#toast.show', { hasText: '已切换到' }).waitFor();
  await settle();
};
const setSelect = (selector, value) => app.page.evaluate(([sel, val]) => {
  const el = document.querySelector(sel);
  el.value = val;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [selector, value]);
const toast = async (pattern) => {
  const node = app.page.locator('#toast.show', { hasText: pattern });
  await node.waitFor();
  return node.innerText();
};
const chatEntries = async (name) => ((await app.readData()).customers[name]?.history || []).filter((h) => h.type === 'chat');
const lineCount = (entries) => entries.reduce((sum, e) => sum + (e.lines || []).length, 0);
const stubOpen = () => app.page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });

async function save(mutate) {
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  state.data = mutate(state.data) || state.data;
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
}

before(async () => {
  app = await startApp();
  await app.open('customers');
  await save((data) => {
    data.customers[MARIA] = { client: MARIA, owner: 'Kris', country: '英国', contact: 'Maria Test', phone: '7700 900123', phoneCountryCode: '+44', contacts: ['Maria Test'], history: [] };
    data.customers[DAN] = { client: DAN, owner: 'Amy', country: '美国', contact: 'Dan Cole', phone: '415 555 0100', phoneCountryCode: '+1', contacts: ['Dan Cole'], history: [] };
    data.laiSettings = {
      ...(data.laiSettings || {}), defaultOwner: 'Kris',
      roles: { roles: [], members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current: 'm-kris' },
    };
  });
  await app.open('chats');
});
after(async () => { await app?.close(); });

test('沟通 is in the rail with 聊天记录 and 聊天模板, and the empty page explains how to start', async () => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="沟通"]').hover();
  const flyout = page.locator('.rail-flyout');
  await flyout.waitFor();
  const text = await flyout.innerText();
  assert.ok(text.includes('聊天记录') && text.includes('聊天模板'), text);
  assert.ok(!text.includes('功能入口已保留'));
  await page.mouse.move(700, 500);
  assert.equal(await page.locator('.k-pageheader .k-pageheader-title').innerText(), '聊天记录');
  const body = await page.locator('.wa-page').innerText();
  assert.ok(body.includes('还没有聊天记录'), body);
  assert.equal(await page.locator('.rail-item.active').getAttribute('data-rail-menu'), '沟通');
  // kit look (D-028): the section tabs sit in the page header, one primary button, the empty state is a k-empty
  assert.equal(await page.locator('.k-pageheader > .section-tabs').count(), 1, '聊天记录／聊天模板 tabs in the header');
  assert.equal(await page.locator('.main .k-btn--primary').count(), 1);
  assert.equal(await page.locator('.k-pageheader .k-btn--primary[data-chat-action="whatsapp"]').count(), 1);
  assert.equal(await page.locator('.wa-page .k-empty .k-empty-title').innerText(), '还没有聊天记录');
});

test('import an exported chat: preview, confirm, shows in the customer 动态 and on the 沟通 page', async () => {
  const { page } = app;
  await go('chats');
  await page.locator('.k-pageheader [data-chat-action="import"]').click();
  // the drawer has the kit shell and the error slot sits in its footer
  await page.locator('.drawer.k-drawer.wa-drawer .k-dialog-foot #wa-import-error.k-error').waitFor({ state: 'attached' });
  assert.equal(await page.locator('.drawer .drawer-head.k-dialog-head').count(), 1);
  await page.locator('#wa-import-file').setInputFiles(FIXTURE('android-24h.txt'));
  await page.locator('.wa-preview').waitFor();
  const preview = await page.locator('.wa-preview').innerText();
  assert.ok(preview.includes('Maria Test') && preview.includes('Li Wei'), preview);
  assert.ok(preview.includes('会更新最近联系时间'), preview);
  assert.equal(await page.locator('#wa-import-confirm').isDisabled(), true, 'cannot confirm before choosing who you are');
  await setSelect('#wa-import-me', 'Li Wei');
  await settle(200);
  // The customer is suggested by contact name; the picker marks it.
  assert.ok((await page.locator('.wa-pick.selected').innerText()).includes(MARIA));
  await page.locator('#wa-import-confirm').click();
  const message = await toast(/已导入 \d+ 条，跳过 \d+ 条重复/);
  assert.match(message, /已导入 [1-9]\d* 条，跳过 0 条重复/);
  const entries = await chatEntries(MARIA);
  assert.ok(entries.length >= 1);
  assert.ok(lineCount(entries) >= 6);
  assert.ok(entries.every((e) => e.channel === 'WhatsApp' && e.chatRef?.src === 'export' && e.chatRef?.importId));
  const log = (await app.readData()).laiChatImports;
  assert.equal(log.length, 1, 'exactly one log row (the model writes it, the page adds none)');
  assert.equal(log[0].customer, MARIA);
  assert.equal(log[0].undone, false);
  assert.equal(log[0].added, lineCount(entries));
  // On the 沟通 page.
  await settle(500);
  const row = page.locator('.wa-row', { hasText: MARIA });
  assert.equal(await row.count(), 1);
  assert.ok((await page.locator('#wa-thread').innerText()).includes('lash box'));
  assert.ok((await page.locator('.wa-imports').innerText()).includes('撤销'));
  // In the customer detail: 动态 › 聊天记录.
  await openCustomer(MARIA);
  await page.locator('.lcd-tabs [data-tab="activity"]').click();
  await page.locator('[data-activity-filter="chat"]').click();
  await settle(400);
  assert.ok((await page.locator('#activity-results').innerText()).includes('WhatsApp 聊天'));
  assert.equal(await page.locator('#activity-results [data-chat-action="log-chat"]').count(), 1);
  assert.equal(await page.locator('#activity-results [data-chat-action="import-chat"]').count(), 1);
  assert.equal(await page.locator('.lcd-activity-record.lcd-chat-record').first().locator('.wa-entry').count(), 1);
  assert.deepEqual(pageErrors(), []);
});

test('importing the same file again skips every line, and 撤销 removes the first import', async () => {
  const { page } = app;
  const before = lineCount(await chatEntries(MARIA));
  await go('chats');
  await page.locator('.k-pageheader [data-chat-action="import"]').click();
  await page.locator('#wa-import-file').setInputFiles(FIXTURE('android-24h.txt'));
  await page.locator('.wa-preview').waitFor();
  await setSelect('#wa-import-me', 'Li Wei');
  await settle(200);
  await page.locator('#wa-import-confirm').click();
  const message = await toast(/已导入 0 条，跳过 \d+ 条重复/);
  assert.match(message, new RegExp(`已导入 0 条，跳过 ${before} 条重复`));
  assert.equal(lineCount(await chatEntries(MARIA)), before, 'nothing added');
  const log = (await app.readData()).laiChatImports;
  assert.equal(log.length, 2);
  assert.equal(log[0].added, 0);
  // Undo the first import (the one that added lines).
  await settle(500);
  const target = page.locator('.wa-imports li', { hasText: `导入 ${before} 条` });
  assert.equal(await target.count(), 1);
  await target.locator('[data-chat-action="undo"]').click();
  await page.locator('[data-chat-action="undo-confirm"]').click();
  await toast(/已撤销这次导入/);
  assert.equal((await chatEntries(MARIA)).length, 0);
  const after = (await app.readData()).laiChatImports;
  assert.equal(after.find((r) => r.added === before).undone, true);
  assert.equal(after.length, 2, 'undo keeps the log rows');
  await settle(400);
  assert.ok((await page.locator('.wa-imports').innerText()).includes('已撤销'));
  assert.deepEqual(pageErrors(), []);
});

test('click-to-chat: WhatsApp pill on the customer opens https://wa.me/... and logs the message to the 动态', async () => {
  const { page } = app;
  await openCustomer(MARIA);
  await stubOpen();
  const pill = page.locator('.lcd-pagebar [data-chat-action="open-wa"]');
  assert.equal(await pill.count(), 1);
  assert.equal(await page.locator('.lcd-pagebar [data-chat-action="open-wa"][data-feature]').count(), 0, 'never data-feature');
  assert.ok((await page.locator('.lcd-contact [data-chat-action="open-wa"]').count()) >= 1, 'icon on the contact card');
  await pill.click();
  await page.locator('#wa-dlg-form').waitFor();
  assert.equal(await page.locator('#wa-dlg-phone').inputValue(), '7700 900123');
  assert.ok((await page.locator('#wa-dlg-note').innerText()).includes('+447700900123'));
  await page.locator('#wa-dlg-text').fill('Hello Maria, price list attached');
  await page.locator('[data-chat-action="dlg-open"]').click();
  await page.locator('.wa-ask').waitFor();
  const opened = await page.evaluate(() => window.__opened);
  assert.deepEqual(opened, ['https://wa.me/447700900123?text=Hello%20Maria%2C%20price%20list%20attached']);
  await page.locator('[data-chat-action="dlg-log"]').click();
  await toast(/已记到客户动态/);
  const entries = await chatEntries(MARIA);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].chatRef.src, 'link');
  assert.equal(entries[0].lines[0].text, 'Hello Maria, price list attached');
  assert.equal(entries[0].lines[0].dir, 'out');
  assert.equal(entries[0].chatRef.peer, '+447700900123');
  // The detail view shows it without a reload.
  await page.locator('.lcd-tabs [data-tab="activity"]').click();
  await page.locator('[data-activity-filter="chat"]').click();
  await settle(300);
  assert.ok((await page.locator('#activity-results').innerText()).includes('WhatsApp 聊天'));
  // A number that cannot be dialled blocks 打开.
  await stubOpen();
  await page.locator('.lcd-pagebar [data-chat-action="open-wa"]').click();
  await page.locator('#wa-dlg-form').waitFor();
  await page.locator('#wa-dlg-phone').fill('12');
  await page.locator('[data-chat-action="dlg-open"]').click();
  assert.ok((await page.locator('#wa-dlg-error').innerText()).includes('号码不对'));
  assert.deepEqual(await page.evaluate(() => window.__opened), []);
  await page.locator('.drawer [data-action="close-modal"]').first().click();
  assert.deepEqual(pageErrors(), []);
});

test('业务 Amy (本人) only sees her own customers: no match, no chat of another owner, and she can import for her own', async () => {
  const { page } = app;
  // Kris's customer has a chat; Amy must not see it anywhere.
  await save((data) => {
    const entry = { type: 'chat', subtype: 'whatsapp', channel: 'WhatsApp', time: '2026-10-12T14:06:00.000Z', owner: 'Kris', contact: 'Maria Test', text: 'WhatsApp 聊天 1 条\nSECRET-KRIS-LINE', chatRef: { src: 'manual', day: '2026-10-12' }, lastSentAt: '2026-10-12T14:06:00.000Z', lines: [{ at: '2026-10-12T14:06:00.000Z', from: 'Kris', dir: 'out', text: 'SECRET-KRIS-LINE', key: 'secret1' }] };
    data.customers[MARIA].history = [entry, ...(data.customers[MARIA].history || [])];
  });
  await app.open('customers');
  await switchTo('Amy');
  await go('chats');
  const text = await page.locator('.main').innerText();
  assert.ok(!text.includes(MARIA) && !text.includes('SECRET-KRIS-LINE'), text);
  // Importing a file whose sender is "Maria Test": Kris's customer is neither suggested nor in the list.
  await page.locator('.k-pageheader [data-chat-action="import"]').click();
  await page.locator('#wa-import-file').setInputFiles(FIXTURE('ios.txt'));
  await page.locator('.wa-preview').waitFor();
  await setSelect('#wa-import-me', 'Li Wei');
  await settle(200);
  const picks = await page.locator('.wa-picks').innerText();
  assert.ok(!picks.includes(MARIA), picks);
  assert.ok(picks.includes(DAN), picks);
  assert.equal(await page.locator('.wa-pick.selected').count(), 0, 'nothing is auto-picked from another owner');
  await page.locator('.wa-pick', { hasText: DAN }).click();
  await page.locator('#wa-import-confirm').click();
  await toast(/已导入 [1-9]\d* 条/);
  assert.ok((await chatEntries(DAN)).length >= 1);
  assert.ok((await chatEntries(DAN)).every((e) => e.owner === 'Amy'));
  await settle(500);
  const after = await page.locator('.main').innerText();
  assert.ok(after.includes(DAN) && !after.includes(MARIA) && !after.includes('SECRET-KRIS-LINE'));
  // The customer page of Amy's own customer works and Kris's customer is not reachable.
  await openCustomer(DAN);
  assert.equal(await page.locator('.lcd-pagebar [data-chat-action="open-wa"]').count(), 1);
  assert.deepEqual(pageErrors(), []);
});

test('turning 查看聊天记录 off hides the page, the rail menu, the 动态 entries and the filter', async () => {
  const { page } = app;
  await switchTo('Kris');
  await save((data) => {
    const perms = { ...R.settings(data).roles.find((r) => r.id === 'sales').perms };
    delete perms['chat.view'];
    return R.updateRole(data, 'sales', { perms });
  });
  await app.open('customers');
  await switchTo('Amy');
  await go('chats');
  const body = await page.locator('.main').innerText();
  assert.match(body, /没有.*权限/, body);
  assert.ok(!body.includes(DAN));
  // 聊天模板 is also off for 业务, so the whole 沟通 menu leaves the rail.
  assert.equal(await page.locator('.rail-item[data-rail-menu="沟通"]').count(), 0);
  await openCustomer(DAN);
  await page.locator('.lcd-tabs [data-tab="activity"]').click();
  await settle(300);
  assert.equal(await page.locator('[data-activity-filter="chat"]').count(), 0);
  assert.equal(await page.locator('.wa-entry').count(), 0);
  // The other switches still work: chat.send stays on, so the pill is there.
  assert.equal(await page.locator('.lcd-pagebar [data-chat-action="open-wa"]').count(), 1);
  assert.deepEqual(pageErrors(), []);
});
