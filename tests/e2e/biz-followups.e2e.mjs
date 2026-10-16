// 线索和商机的跟进 in the real page with the real backend: the opportunity form takes the rate from 汇率设置 (and keeps
// what the user typed), and the lead / opportunity details open WhatsApp and record the chat (lead 跟进, customer 动态).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const O = require('../../src/opportunity-model.js');
const L = require('../../src/lead-model.js');

const CLIENT = 'Wa Follow Ltd';
let app;

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const pageErrors = () => app.errors.filter((e) => !/HTTP 409: .*\/api\/mail\//.test(e));
const go = async (route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(700);
};
const stubOpen = () => app.page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
const opened = () => app.page.evaluate(() => window.__opened);
const closeDialog = async () => { await app.page.locator('[data-action="close-modal"]').first().click(); await settle(300); };
const rate = () => app.page.locator('#opp-form [name="exchangeRate"]');
const setCurrency = async (code) => {
  await app.page.locator('#opp-form [name="currency"]').fill(code);
  await app.page.locator('#opp-form [name="currency"]').press('Tab');
  await settle(200);
};
// The list view has a row per opportunity; its name button opens the detail, whose footer has 编辑商机.
// The board shows one currency at a time, so pick the opportunity's currency first.
const openDetail = async (id, currency = id === 'o-usd' ? 'USD' : 'EUR') => {
  await app.page.locator('#opp-currency').selectOption(currency);
  await settle(300);
  await app.page.locator(`[data-opp-action="detail"][data-id="${id}"]`).first().evaluate((el) => el.click());
  await app.page.locator('.opp-detail').waitFor();
  await settle(200);
};
const openOppForm = async (id) => {
  if (!id) await app.page.locator('[data-opp-action="new"]').first().click();
  else {
    await openDetail(id);
    await app.page.locator(`.drawer [data-opp-action="edit"][data-id="${id}"]`).click();
  }
  await app.page.locator('#opp-form').waitFor();
  await settle(300);
};

async function save(mutate) {
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  state.data = mutate(state.data) || state.data;
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
}

before(async () => {
  app = await startApp({ seed: false });
  await app.open('customers');
  await save((d) => {
    d.customers[CLIENT] = { client: CLIENT, owner: 'Kris', country: '英国', contact: 'Ann Lee', phone: '7700 900123', phoneCountryCode: '+44', contacts: ['Ann Lee'], history: [] };
    d.laiSettings = { ...(d.laiSettings || {}), defaultOwner: 'Kris', rates: { list: [{ code: 'EUR', usd100: 108.5, updatedAt: '2026-10-01' }, { code: 'GBP', usd100: 127, updatedAt: '2026-10-01' }] } };
    const opt = { now: '2026-10-10T04:00:00.000Z', today: '2026-10-10' };
    const fields = { client: CLIENT, contact: 'Ann Lee', amount: '1000', endDate: '2030-01-31', owner: 'Kris' };
    let next = O.upsert(d, 'o-hundred', { ...fields, currency: 'EUR', exchangeRate: '100' }, opt);
    next = O.upsert(next, 'o-own', { ...fields, currency: 'EUR', exchangeRate: '99' }, opt);
    next = O.upsert(next, 'o-usd', { ...fields, currency: 'USD' }, opt);
    next = L.upsert(next, 'lead-wa', { name: 'Phone Lead GmbH', contact: 'Hans', phone: '0151 2345 6789', country: '德国', owner: 'Kris' }, { now: '2026-10-10T04:00:00.000Z' });
    next = L.upsert(next, 'lead-bad', { name: 'No Number Lead', phone: 'ask the office' }, { now: '2026-10-10T05:00:00.000Z' });
    return next;
  });
  await app.open('opportunities');
});
after(async () => { await app?.close(); });

test('a new opportunity takes the rate from 汇率设置 when the currency changes, and USD stays 100', async () => {
  await openOppForm();
  assert.equal(await rate().inputValue(), '100');
  await setCurrency('EUR');
  assert.equal(await rate().inputValue(), '108.5');
  assert.equal(await rate().isEditable(), true, 'still editable');
  await setCurrency('GBP');
  assert.equal(await rate().inputValue(), '127', 'a value we filled is replaced by the next currency\'s rate');
  await setCurrency('USD');
  assert.equal(await rate().inputValue(), '100');
  assert.equal(await rate().isEditable(), false);
  await setCurrency('EUR');
  assert.equal(await rate().inputValue(), '108.5', 'back from USD the table rate returns');
  await rate().fill('105');
  await setCurrency('GBP');
  assert.equal(await rate().inputValue(), '105', 'what the user typed is not overwritten');
  await setCurrency('JPY');
  assert.equal(await rate().inputValue(), '105', 'no table rate for JPY: left alone');
  await closeDialog();
});

test('editing: exactly 100 on a foreign opportunity is filled from the table, another saved value is kept', async () => {
  await openOppForm('o-hundred');
  assert.equal(await rate().inputValue(), '108.5');
  await closeDialog();
  await openOppForm('o-own');
  assert.equal(await rate().inputValue(), '99');
  await setCurrency('GBP');
  assert.equal(await rate().inputValue(), '99');
  await closeDialog();
  await openOppForm('o-usd');
  assert.equal(await rate().inputValue(), '100');
  assert.equal(await rate().isEditable(), false);
  await closeDialog();
});

test('lead detail: a WhatsApp button for a phone that can be dialled; the chat is recorded in the lead 跟进', async () => {
  const { page } = app;
  await go('leads');
  await page.locator('[data-lead-action="open"][data-id="lead-wa"]').first().click();
  await page.locator('.lead-detail').waitFor();
  assert.equal(await page.locator('.lead-detail [data-lead-action="wa"]').count(), 1);
  await closeDialog();
  await page.locator('[data-lead-action="open"][data-id="lead-bad"]').first().click();
  await page.locator('.lead-detail').waitFor();
  assert.equal(await page.locator('.lead-detail [data-lead-action="wa"]').count(), 0, 'not a number: no button');
  await closeDialog();
  await page.locator('[data-lead-action="open"][data-id="lead-wa"]').first().click();
  await page.locator('.lead-detail').waitFor();
  await stubOpen();
  await page.locator('.lead-detail [data-lead-action="wa"]').click();
  await page.locator('#biz-wa-form').waitFor();
  assert.match(await page.locator('#biz-wa-note').innerText(), /\+4915123456789/, 'the lead country supplies the code');
  await page.locator('#biz-wa-text').fill('Hallo, wir senden das Angebot.');
  await page.locator('[data-biz-action="wa-open"]').click();
  await settle();
  const urls = await opened();
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/wa\.me\/4915123456789\?text=/);
  assert.match(await page.locator('.wa-ask').innerText(), /发出去了吗/);
  await page.locator('[data-biz-action="wa-log"]').click();
  await page.locator('.lead-detail').waitFor();
  await settle();
  assert.match(await page.locator('.lead-timeline').innerText(), /WhatsApp 聊天：Hallo, wir senden das Angebot\./);
  const lead = ((await app.readData()).laiLeads || []).find((x) => x.id === 'lead-wa');
  assert.equal(lead.history[0].type, 'followup');
  assert.equal(lead.status, 'following');
  await closeDialog();
});

test('opportunity detail: WhatsApp for the linked contact\'s phone; the chat is recorded in the customer 动态', async () => {
  const { page } = app;
  await go('opportunities');
  await page.locator('.opp-page').waitFor();
  await openDetail('o-usd');
  const button = page.locator('.opp-detail [data-opp-action="wa"]');
  assert.equal(await button.count(), 1);
  await stubOpen();
  await button.click();
  await page.locator('#biz-wa-form').waitFor();
  assert.match(await page.locator('#biz-wa-note').innerText(), /\+447700900123/);
  await page.locator('#biz-wa-text').fill('Quote sent.');
  await page.locator('[data-biz-action="wa-open"]').click();
  await settle();
  assert.match((await opened())[0], /^https:\/\/wa\.me\/447700900123\?text=Quote/);
  await page.locator('[data-biz-action="wa-log"]').click();
  await settle(600);
  const chats = ((await app.readData()).customers[CLIENT].history || []).filter((h) => h.type === 'chat');
  assert.equal(chats.length, 1);
  assert.equal(chats[0].chatRef.src, 'link');
  assert.equal(chats[0].chatRef.peer, '+447700900123');
  assert.equal(chats[0].lines[0].text, 'Quote sent.');
  assert.deepEqual(pageErrors(), []);
});
