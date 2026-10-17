// 订单自定义字段 in the real page with the real backend: add fields in 设置 → 订单字段, fill them on a new order, see them in
// the order (and in the read-only view of an account that cannot edit), find them in the export columns, edit an old order
// whose new required field is empty, then delete a field (the value stays in the data but is not shown or exported).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const FM = require('../../src/field-model.js');

let app;
before(async () => {
  app = await startApp();
  // An order made before any custom field exists (saved straight into the data, as an older version would).
  const state = await (await app.api('/api/data')).json();
  state.data.laiSettings = { ...(state.data.laiSettings || {}), defaultOwner: 'Kris' };
  state.data.orders.push({ id: 'old-order', num: 'OLD-001', client: 'Northwind Lash Studio', country: '美国', currency: 'USD', stage: 'quote', amount: 500, paidAmount: 0, createdAt: '2026-09-01', orderMonth: '2026-09', owner: 'Kris', isDraft: false });
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 450) => app.page.waitForTimeout(ms);
const stored = async () => await app.readData();
const go = async (route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(700);
};
const form = () => app.page.locator('#biz-order-form');
const fields = async () => (await stored()).laiSettings.fieldSettings.order.customFields;
const idOf = async (name) => (await fields()).find((field) => field.name === name).id;
async function addField({ name, type, options = '', required = false }) {
  const add = app.page.locator('[data-of-cf-form="add"]');
  await add.locator('[name="name"]').fill(name);
  await add.locator('[name="type"]').selectOption(type);
  if (options) await add.locator('[name="options"]').fill(options);
  if (required) await add.locator('[name="required"]').check();
  await add.locator('button[type="submit"]').click();
  await settle();
}
const submitOrder = async () => { await app.page.locator('button[type="submit"][form="biz-order-form"]').click(); await settle(700); };
const closeDialog = async () => { await app.page.locator('[data-action="close-modal"]').first().click(); await settle(); };
const openOrder = async (num) => {
  await app.page.locator('[data-order-row]', { hasText: num }).locator('.op-link').first().click();
  await form().waitFor();
};

test('设置 has an 订单字段 section; fields of every type are added, renamed, reordered', async () => {
  const { page } = app;
  await go('settings');
  await page.locator('[data-of-section="custom"]').waitFor();
  assert.match(await page.locator('[data-of-section="custom"] h3').innerText(), /订单字段（0\/30）/);
  assert.equal(await page.locator('#biz-settings-form [name="orderPrefix"]').count(), 1, 'the old settings form is still there');
  await addField({ name: '合同号', type: 'text' });
  await addField({ name: '采购量', type: 'number' });
  await addField({ name: '付款方式', type: 'select', options: 'TT，信用证' });
  await addField({ name: '包装', type: 'multi', options: '纸箱，托盘，木箱' });
  await addField({ name: '交货日', type: 'date' });
  assert.deepEqual((await fields()).map((f) => [f.name, f.type, f.required]), [['合同号', 'text', false], ['采购量', 'number', false], ['付款方式', 'select', false], ['包装', 'multi', false], ['交货日', 'date', false]]);
  assert.equal(await page.locator('[data-of-cf-field]').count(), 5);
  // A name that is already on the order form is refused, and the message shows.
  await addField({ name: '订单金额', type: 'text' });
  assert.match(await page.locator('#of-error').innerText(), /同名/);
  assert.equal((await fields()).length, 5);
  // Rename and move.
  const rename = page.locator('input[data-of-cf-rename]').nth(4);
  await rename.fill('交货日期');
  await rename.press('Enter');
  await settle();
  assert.equal((await fields())[4].name, '交货日期');
  await page.locator('[data-of-cf="up"]').nth(4).click();
  await settle();
  assert.deepEqual((await fields()).slice(3).map((f) => f.name), ['交货日期', '包装']);
  await page.locator('[data-of-cf="down"]').nth(3).click();
  await settle();
  assert.deepEqual((await fields()).slice(3).map((f) => f.name), ['包装', '交货日期']);
  // Options: add one to the select field.
  const option = page.locator('[data-of-cf-form="option"]').first();
  await option.locator('[name="option"]').fill('预付');
  await option.locator('button[type="submit"]').click();
  await settle();
  assert.deepEqual((await fields())[2].options, ['TT', '信用证', '预付']);
  assert.deepEqual(app.errors, []);
});

// The 订单字段 section sits under the 默认录入 form on one page: a change there redraws only the section, so text typed above
// and not saved yet stays, the page does not jump to the top, half-typed text in the add form survives a refused name, and a
// rename followed at once by a click on ↑ saves both (one after the other, no "正在保存" clash).
test('changing order fields leaves the rest of the settings page alone', async () => {
  const { page } = app;
  await go('settings');
  await page.locator('[data-of-section="custom"]').waitFor();
  const owner = page.locator('#biz-settings-form [name="defaultOwner"]');
  await owner.fill('还没保存的人');
  const scrollTop = () => page.evaluate(() => document.querySelector('.settings-layout').scrollTop);
  await page.evaluate(() => { const box = document.querySelector('.settings-layout'); box.scrollTop = document.querySelector('[data-of-section="custom"]').offsetTop - box.offsetTop; });
  assert.ok((await scrollTop()) > 100, 'the section is further down the page');
  const add = page.locator('[data-of-cf-form="add"]');
  await add.locator('[name="name"]').fill('币种');
  await add.locator('[name="options"]').fill('写了一半');
  await add.locator('button[type="submit"]').click();
  await settle();
  assert.match(await page.locator('#of-error').innerText(), /同名/);
  assert.equal(await add.locator('[name="name"]').inputValue(), '币种', 'a refused name stays in the box');
  assert.equal(await add.locator('[name="options"]').inputValue(), '写了一半');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'name', 'the cursor is back in the name box');
  await add.locator('[name="name"]').fill('唛头');
  await add.locator('[name="options"]').fill('');
  await add.locator('button[type="submit"]').click();
  await settle();
  assert.equal((await fields()).at(-1).name, '唛头');
  assert.equal(await add.locator('[name="name"]').inputValue(), '', 'a saved name leaves an empty box for the next one');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'name');
  assert.equal(await page.locator('#of-error').innerText(), '');
  // Rename, then click ↑ straight away.
  const id = await idOf('唛头');
  await page.locator(`[data-of-cf-rename="${id}"]`).fill('唛头要求');
  const up = page.locator(`[data-of-cf="up"][data-id="${id}"]`);
  await up.hover(); // Playwright scrolls the button into view here, not in the measured part
  const top = await scrollTop();
  assert.ok(top > 100);
  await up.click();
  await settle(900);
  assert.deepEqual((await fields()).slice(-2).map((f) => f.name), ['唛头要求', '交货日期']);
  assert.equal(await page.locator('#of-error').innerText(), '');
  // The rest of the page is as it was.
  assert.equal(await owner.inputValue(), '还没保存的人', 'unsaved text above is kept');
  assert.notEqual((await stored()).laiSettings.defaultOwner, '还没保存的人', 'and was not saved by the field changes');
  assert.ok(Math.abs((await scrollTop()) - top) < 5, `the page did not jump (${top} → ${await scrollTop()})`);
  // Clean up for the next tests: drop the unsaved text and the extra field.
  await page.locator('[data-biz-action="discard-settings"]').click();
  await settle(300);
  const remove = page.locator(`[data-of-cf="delete"][data-id="${id}"]`);
  await remove.click();
  await settle(200);
  await remove.click();
  await settle();
  assert.equal((await fields()).length, 5);
  assert.deepEqual(app.errors, []);
});

test('a new order shows the fields, refuses a missing required one, and saves cleaned values', async () => {
  const { page } = app;
  // 合同号 becomes required in the settings.
  await go('settings');
  const contract = await idOf('合同号');
  await page.locator(`[data-of-cf-required="${contract}"]`).check();
  await settle();
  assert.equal((await fields())[0].required, true);
  await go('order-list');
  await page.locator('[data-biz-action="new-order"]').first().click();
  await form().waitFor();
  assert.equal(await form().locator('[data-order-custom]').count(), 5);
  assert.deepEqual((await form().locator('[data-order-custom]').allInnerTexts()).map((t) => t.split('\n')[0].trim()), ['合同号 *', '采购量', '付款方式', '包装', '交货日期']);
  const qty = await idOf('采购量'), pay = await idOf('付款方式'), pack = await idOf('包装'), due = await idOf('交货日期');
  await form().locator('[name="client"]').fill('Northwind Lash Studio');
  await form().locator('[name="amount"]').fill('1000');
  await form().locator(`[name="custom.${qty}"]`).fill('1200');
  await form().locator(`[name="custom.${pay}"]`).selectOption('信用证');
  await form().locator(`input[name="custom.${pack}"][value="纸箱"]`).check();
  await form().locator(`input[name="custom.${pack}"][value="托盘"]`).check();
  await form().locator(`[name="custom.${due}"]`).fill('2026-12-01');
  // The browser's own check stops an empty required field; with it off, the app's message shows.
  assert.equal(await form().locator(`[name="custom.${contract}"]`).getAttribute('required'), '');
  await form().evaluate((el) => { el.noValidate = true; });
  await submitOrder();
  assert.match(await page.locator('#biz-order-error').innerText(), /请填写合同号/);
  await form().locator(`[name="custom.${contract}"]`).fill('HT-2026-01');
  await form().locator(`[name="custom.${qty}"]`).fill('12,00');
  await submitOrder();
  assert.match(await page.locator('#biz-order-error').innerText(), /请填写数字/);
  await form().locator(`[name="custom.${qty}"]`).fill('1200');
  await submitOrder();
  await form().waitFor({ state: 'detached' });
  const created = (await stored()).orders.find((o) => o.client === 'Northwind Lash Studio' && o.id !== 'old-order');
  assert.deepEqual(created.custom, { [contract]: 'HT-2026-01', [qty]: 1200, [pay]: '信用证', [pack]: ['纸箱', '托盘'], [due]: '2026-12-01' });
  assert.equal(created.amount, 1000);
});

test('opening the order again shows the saved values; clearing the required field is refused', async () => {
  const { page } = app;
  const created = (await stored()).orders.find((o) => o.custom);
  await openOrder(created.num);
  const contract = await idOf('合同号'), qty = await idOf('采购量'), pay = await idOf('付款方式'), pack = await idOf('包装'), due = await idOf('交货日期');
  assert.equal(await form().locator(`[name="custom.${contract}"]`).inputValue(), 'HT-2026-01');
  assert.equal(await form().locator(`[name="custom.${qty}"]`).inputValue(), '1200');
  assert.equal(await form().locator(`[name="custom.${pay}"]`).inputValue(), '信用证');
  assert.equal(await form().locator(`input[name="custom.${pack}"][value="纸箱"]`).isChecked(), true);
  assert.equal(await form().locator(`input[name="custom.${pack}"][value="木箱"]`).isChecked(), false);
  assert.equal(await form().locator(`[name="custom.${due}"]`).inputValue(), '2026-12-01');
  assert.equal(await form().locator(`[name="custom.${contract}"]`).getAttribute('required'), null, 'no browser rule when editing');
  await form().locator(`[name="custom.${contract}"]`).fill('');
  await submitOrder();
  assert.match(await page.locator('#biz-order-error').innerText(), /请填写合同号/);
  assert.equal((await stored()).orders.find((o) => o.id === created.id).custom[contract], 'HT-2026-01', 'nothing was saved');
  // Change another value and the multi choice; it saves.
  await form().locator(`[name="custom.${contract}"]`).fill('HT-2026-02');
  await form().locator(`input[name="custom.${pack}"][value="托盘"]`).uncheck();
  await form().locator(`input[name="custom.${pack}"][value="木箱"]`).check();
  await submitOrder();
  await form().waitFor({ state: 'detached' });
  const after = (await stored()).orders.find((o) => o.id === created.id);
  assert.equal(after.custom[contract], 'HT-2026-02');
  assert.deepEqual(after.custom[pack], ['纸箱', '木箱']);
});

test('an old order whose new required field is empty can still be edited and saved', async () => {
  const { page } = app;
  await openOrder('OLD-001');
  const contract = await idOf('合同号');
  assert.equal(await form().locator(`[name="custom.${contract}"]`).getAttribute('required'), null);
  assert.equal(await form().locator(`[name="custom.${contract}"]`).inputValue(), '');
  await form().locator('[name="note"]').fill('老订单，只改备注');
  await submitOrder();
  await form().waitFor({ state: 'detached' });
  const old = (await stored()).orders.find((o) => o.id === 'old-order');
  assert.equal(old.note, '老订单，只改备注');
  assert.equal(old.custom, undefined, 'no empty custom is written');
  // Touching the field and filling it works too.
  await openOrder('OLD-001');
  await form().locator(`[name="custom.${contract}"]`).fill('HT-OLD');
  await submitOrder();
  await form().waitFor({ state: 'detached' });
  assert.deepEqual((await stored()).orders.find((o) => o.id === 'old-order').custom, { [contract]: 'HT-OLD' });
  assert.deepEqual(app.errors, []);
});

test('the export window lists the custom fields as columns with the values', async () => {
  const { page } = app;
  await page.locator('button[data-export-kind="order"]').click();
  await settle();
  const header = await page.locator('.export-table thead th').allInnerTexts();
  assert.deepEqual(header.slice(-5), ['合同号', '采购量', '付款方式', '包装', '交货日期']);
  const rows = await page.locator('.export-table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText)));
  const mine = rows.find((row) => row.includes('Northwind Lash Studio') && row.at(-5) === 'HT-2026-02');
  assert.deepEqual(mine.slice(-5), ['HT-2026-02', '1200', '信用证', '纸箱、木箱', '2026-12-01']);
  const old = rows.find((row) => row.at(-5) === 'HT-OLD');
  assert.deepEqual(old.slice(-4), ['', '', '', '']);
  await closeDialog();
});

test('deleting a field needs a second click; the value stays in the data but leaves the form and the export', async () => {
  const { page } = app;
  await go('settings');
  const qty = await idOf('采购量');
  const remove = page.locator(`[data-of-cf-field="${qty}"] [data-of-cf="delete"]`);
  await remove.click();
  await settle(200);
  assert.equal((await fields()).length, 5, 'the first click only asks');
  await remove.click();
  await settle();
  assert.equal((await fields()).length, 4);
  const created = (await stored()).orders.find((o) => o.custom?.[qty] === 1200);
  assert.ok(created, 'old values stay in the data');
  await go('order-list');
  await openOrder(created.num);
  assert.equal(await form().locator(`[name="custom.${qty}"]`).count(), 0);
  assert.equal(await form().locator('[data-order-custom]').count(), 4);
  // Saving the order again does not drop the deleted field's value.
  await form().locator('[name="note"]').fill('删字段后再保存');
  await submitOrder();
  await form().waitFor({ state: 'detached' });
  assert.equal((await stored()).orders.find((o) => o.id === created.id).custom[qty], 1200);
  await page.locator('button[data-export-kind="order"]').click();
  await settle();
  const header = await page.locator('.export-table thead th').allInnerTexts();
  assert.ok(!header.includes('采购量') && header.includes('合同号'));
  await closeDialog();
  assert.deepEqual(app.errors, []);
});

// An account that may look at orders but not edit them sees the saved values as a plain list: the filled ones and the
// required ones (a required field without a value shows a dash), no inputs.
test('a read-only account sees the filled and required fields as a list', async () => {
  const viewer = await startApp();
  try {
    await viewer.open('customers');
    const request = viewer.page.context().request;
    const loaded = await (await request.get(viewer.base + '/api/data')).json();
    let data = loaded.data;
    for (const [id, name, type] of [['f1', '合同号', 'text'], ['f2', '采购量', 'number'], ['f3', '特殊要求', 'textarea'], ['f4', '备案号', 'text']]) data = FM.addField(data, 'order', { name, type }, { id });
    data = FM.setRequired(data, 'order', 'f4', true);
    data.orders.push({ id: 'o1', num: 'RO-001', client: 'Northwind Lash Studio', currency: 'USD', stage: 'quote', amount: 100, paidAmount: 0, createdAt: '2026-10-01', orderMonth: '2026-10', owner: 'Amy', isDraft: false, custom: { f1: 'HT-7', f2: 30 } });
    data.laiSettings = { ...data.laiSettings, defaultOwner: 'Amy', roles: {
      roles: [{ id: 'viewer', name: '只看', scope: 'all', v: 2, perms: Object.fromEntries(['order.view', 'customer.view'].map((key) => [key, true])) }],
      members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'viewer' }], current: 'm-amy' } };
    const saved = await request.post(viewer.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
    assert.equal(saved.status(), 200, await saved.text());
    await viewer.open('customers');
    const { page } = viewer;
    await page.evaluate(() => { const b = document.createElement('button'); b.dataset.laiRoute = 'order-list'; document.body.appendChild(b); b.click(); b.remove(); });
    await page.waitForTimeout(700);
    await page.locator('[data-order-row]', { hasText: 'RO-001' }).locator('.op-link').first().click();
    await page.locator('#biz-order-form').waitFor();
    const infos = (await page.locator('[data-order-custom-infos] .lead-info').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    assert.deepEqual(infos, ['合同号 HT-7', '采购量 30', '备案号 —']);
    assert.equal(await page.locator('#biz-order-form [data-order-custom]').count(), 0, 'no inputs');
    assert.equal(await page.locator('#biz-order-form [name^="custom."]').count(), 0);
    assert.deepEqual(viewer.errors.filter((error) => !error.includes('/api/mail/')), []);
  } finally { await viewer.close(); }
});
