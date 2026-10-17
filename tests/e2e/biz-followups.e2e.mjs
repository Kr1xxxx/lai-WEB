// 商机的跟进 in the real page with the real backend: the opportunity form takes the rate from 汇率设置 (and keeps
// what the user typed), and the opportunity detail opens WhatsApp and records the chat in the customer 动态.
// (The 线索 half went with the leads module, D-030.)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const O = require('../../src/opportunity-model.js');

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
    d.laiSettings = { ...(d.laiSettings || {}), defaultOwner: 'Kris', whatsapp: { templates: [{ id: 'g1', name: '报价', items: [{ id: 't1', text: '你好 {{姓名}}，{{公司}} 的报价来了' }] }] }, rates: { list: [{ code: 'EUR', usd100: 108.5, updatedAt: '2026-10-01' }, { code: 'GBP', usd100: 127, updatedAt: '2026-10-01' }] } };
    const opt = { now: '2026-10-10T04:00:00.000Z', today: '2026-10-10' };
    const fields = { client: CLIENT, contact: 'Ann Lee', amount: '1000', endDate: '2030-01-31', owner: 'Kris' };
    let next = O.upsert(d, 'o-hundred', { ...fields, currency: 'EUR', exchangeRate: '100' }, opt);
    next = O.upsert(next, 'o-own', { ...fields, currency: 'EUR', exchangeRate: '99' }, opt);
    next = O.upsert(next, 'o-usd', { ...fields, currency: 'USD' }, opt);
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

test('opportunity detail: WhatsApp for the linked contact\'s phone; the chat is recorded in the customer 动态', async () => {
  const { page } = app;
  await go('opportunities');
  await page.locator('.opp-page').waitFor();
  await openDetail('o-usd');
  const button = page.locator('.opp-detail [data-opp-action="wa"]');
  assert.equal(await button.count(), 1);
  await stubOpen();
  await button.click();
  await page.locator('#wa-dlg-form').waitFor();
  assert.match(await page.locator('#wa-dlg-note').innerText(), /\+447700900123/);
  // the same dialog as customers: the customer is fixed and the chat templates are offered
  assert.equal(await page.locator('#wa-dlg-customer').count(), 0, 'the customer is fixed, no customer picker');
  assert.ok((await page.locator('#wa-dlg-template option').count()) > 1, 'the chat templates are listed');
  await page.locator('#wa-dlg-template').selectOption({ index: 1 });
  assert.equal(await page.locator('#wa-dlg-text').inputValue(), `你好 Ann Lee，${CLIENT} 的报价来了`, 'the template takes the contact and the customer');
  await page.locator('#wa-dlg-text').fill('Quote sent.');
  await page.locator('[data-chat-action="dlg-open"]').click();
  await settle();
  assert.match((await opened())[0], /^https:\/\/wa\.me\/447700900123\?text=Quote/);
  await page.locator('[data-chat-action="dlg-log"]').click();
  await settle(600);
  const chats = ((await app.readData()).customers[CLIENT].history || []).filter((h) => h.type === 'chat');
  assert.equal(chats.length, 1);
  assert.equal(chats[0].chatRef.src, 'link');
  assert.equal(chats[0].chatRef.peer, '+447700900123');
  assert.equal(chats[0].lines[0].text, 'Quote sent.');
  assert.deepEqual(pageErrors(), []);
});
