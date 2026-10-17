// 商机 in the real page with the real backend: create, move through the stages, win and lose, edit the amount,
// filters / sort / list view, archive and delete, the order made from a won opportunity, the totals on the board,
// 商机分析 and 工作台, and persistence after a reload. Test data: docs/samples customers.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await addTeammate('Amy'); await openBoard(); });
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const opps = async () => (await app.readData()).laiOpportunities || [];
const oppOf = async (client) => (await opps()).find((o) => o.client === client);
const card = (client) => app.page.locator('.opp-card', { hasText: client });
const column = (id) => app.page.locator(`[data-opp-drop="${id}"]`);
const clean = (text) => text.replace(/\s+/g, ' ').trim();
// 金额卡片：名称、个数（「3 个」）、金额；summary() 去掉个数只比金额，counts() 只看个数。整数金额不带「.00」。
const statsText = async () => clean(await app.page.locator('.opp-stats').innerText());
const summary = async () => (await statsText()).replace(/ \d+ 个(?= [A-Z]{3} )/g, '');

// 负责人只能从下拉里选：先把 Amy 加进团队成员（管理员仍是当前账号）。
async function addTeammate(name) {
  const loaded = await (await app.api('/api/data')).json();
  const settings = loaded.data.laiSettings || {};
  const me = settings.defaultOwner || '管理员';
  const members = [{ id: 'm-me', name: me, roleId: 'admin' }, ...['Kris', name].filter((n) => n !== me).map((n) => ({ id: `m-${n}`, name: n, roleId: 'sales' }))];
  loaded.data.laiSettings = { ...settings, roles: { ...(settings.roles || {}), members, current: 'm-me' } };
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: loaded, baseRevision: loaded.revision }) });
  assert.equal(saved.status, 200, await saved.text());
}

async function openBoard() {
  await app.open('customers');
  await app.page.locator('.rail-item[data-rail-menu="商机"]').click();
  await app.page.locator('.opp-page').waitFor();
}

// Fills the 新建商机 form: pick the customer and owner from their dropdowns, then the other fields.
async function createOpp({ client, owner, amount, end = '2030-01-31', currency }) {
  const { page } = app;
  await page.locator('[data-opp-action="new"]').first().click();
  await page.locator('#opp-form').waitFor();
  await settle();
  const full = await page.locator('#opp-client option', { hasText: client }).first().getAttribute('value');
  await page.locator('#opp-form [name="client"]').selectOption(full, { force: true });
  await page.waitForFunction(() => document.querySelector('#opp-form select[name="contact"]')?.options.length > 1);
  await settle(300);
  await page.locator('#opp-form [name="owner"]').selectOption(owner, { force: true });
  if (currency) await page.locator('#opp-form [name="currency"]').fill(currency);
  await page.locator('#opp-form [name="amount"]').fill(String(amount));
  await page.locator('#opp-form [name="endDate"]').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, end);
  await page.locator('#opp-form select[name="contact"]').selectOption({ index: 1 }, { force: true });
  await page.locator('button[type="submit"][form="opp-form"], #opp-form button[type="submit"]').first().click();
  await page.locator('#opp-form').waitFor({ state: 'detached' });
  await settle(500);
}

// Opens the ⋮ menu of the card and clicks one entry; the menu closes after the move.
async function moveTo(client, stageId) {
  await card(client).first().locator('.opp-card-menu').click();
  await app.page.locator(`[data-opp-action="move"][data-stage="${stageId}"]`).click();
  await settle(600);
}

test('four opportunities are created from the board and shown in 未成单 with the totals', async () => {
  const { page } = app;
  assert.equal(await page.locator('.opp-card').count(), 0);
  await createOpp({ client: 'Northwind', owner: 'Kris', amount: 1200, end: '2030-01-31' });
  await createOpp({ client: 'Bluebell', owner: 'Amy', amount: 800, end: '2030-02-15' });
  await createOpp({ client: 'Maple', owner: 'Kris', amount: 3000, end: '2030-03-01' });
  await createOpp({ client: 'Lumen', owner: 'Amy', amount: 500, end: '2030-04-01', currency: 'EUR' });
  const all = await opps();
  assert.equal(all.length, 4);
  assert.deepEqual(all.map((o) => o.client).sort(), ['Bluebell Beauty Supply', 'Lumen Lash Lab', 'Maple & Moss Cosmetics', 'Northwind Lash Studio']);
  assert.deepEqual(new Set(all.map((o) => o.number)).size, 4, 'every opportunity has its own number');
  // The board shows one currency at a time: the three USD ones.
  assert.equal(await column('open').locator('.opp-card').count(), 3);
  assert.match(clean(await page.locator('.opp-count').innerText()), /共 3 个商机/);
  // USD is the board currency; the EUR one is counted apart and never converted.
  const text = await summary();
  assert.ok(text.includes('总销售金额 USD 5,000'), text);
  assert.ok(text.includes('进行中 USD 5,000'), text);
  assert.ok(text.includes('赢单 USD 0'), text);
  assert.ok(text.includes('另有 1 个其他币种的商机'), text);
  assert.match(await statsText(), /总销售金额 3 个 USD 5,000 进行中 3 个 USD 5,000 赢单 0 个 USD 0 输单 0 个 USD 0/);
  const lumen = await oppOf('Lumen Lash Lab');
  assert.deepEqual([lumen.currency, lumen.amount, lumen.stage], ['EUR', 500, 'open']);
  await page.locator('#opp-currency').selectOption('EUR', { force: true });
  await settle();
  assert.equal(await page.locator('.opp-card').count(), 1);
  assert.ok((await summary()).includes('总销售金额 EUR 500'));
  await page.locator('#opp-currency').selectOption('USD', { force: true });
  await settle();
  assert.equal(await page.locator('.opp-card').count(), 3);
  assert.deepEqual(app.errors, []);
});

test('the opportunities are still there after a reload, with their numbers and amounts', async () => {
  const { page } = app;
  await openBoard();
  assert.equal(await page.locator('.opp-card').count(), 3);
  const text = clean(await card('Northwind').innerText());
  for (const part of ['Northwind Lash Studio', '1,200', 'Kris', '截止']) assert.ok(text.includes(part), part + ' in ' + text);
  assert.ok((await opps()).every((o) => /^OPP-\d{8}-\d{3}$/.test(o.number)));
  assert.deepEqual(app.errors, []);
});

test('an opportunity moves through the stages from its menu and the totals follow, with undo', async () => {
  const { page } = app;
  await moveTo('Northwind', 'unpaid');
  assert.equal(await column('unpaid').locator('.opp-card', { hasText: 'Northwind' }).count(), 1);
  assert.equal((await oppOf('Northwind Lash Studio')).stage, 'unpaid');
  assert.ok((await summary()).includes('进行中 USD 5,000'), '付款未到账 is still an open stage');
  await moveTo('Northwind', 'balance');
  assert.equal(await column('balance').locator('.opp-card', { hasText: 'Northwind' }).count(), 1);
  let text = await summary();
  assert.ok(text.includes('进行中 USD 3,800'), text);
  assert.ok(text.includes('赢单 USD 1,200'), text);
  assert.ok(text.includes('总销售金额 USD 5,000'), text);
  assert.match(clean(await column('balance').locator('.opp-stage').innerText()), /待付尾款 1 USD 1,200/);
  // The 撤销 button in the page's one toast takes the move back.
  await page.locator('#toast.show').getByRole('button', { name: '撤销' }).click();
  await settle(600);
  assert.equal((await oppOf('Northwind Lash Studio')).stage, 'unpaid');
  assert.equal(await column('unpaid').locator('.opp-card', { hasText: 'Northwind' }).count(), 1);
  text = await summary();
  assert.ok(text.includes('赢单 USD 0'), text);
  // The card is on its stage again after a reload.
  await openBoard();
  assert.equal(await column('unpaid').locator('.opp-card', { hasText: 'Northwind' }).count(), 1);
  assert.deepEqual(app.errors, []);
});

test('a card dragged to another column changes its stage', async () => {
  const { page } = app;
  await card('Bluebell').first().dragTo(column('unpaid'));
  await settle(700);
  assert.equal(await column('unpaid').locator('.opp-card', { hasText: 'Bluebell' }).count(), 1);
  assert.equal((await oppOf('Bluebell Beauty Supply')).stage, 'unpaid');
  await card('Bluebell').first().dragTo(column('open'));
  await settle(700);
  assert.equal(await column('open').locator('.opp-card', { hasText: 'Bluebell' }).count(), 1);
  assert.equal((await oppOf('Bluebell Beauty Supply')).stage, 'open');
  assert.deepEqual(app.errors, []);
});

test('winning an opportunity moves it to 已完成, counts it as won, and its order is made from the menu', async () => {
  const { page } = app;
  await moveTo('Maple', 'done');
  assert.equal(await column('done').locator('.opp-card', { hasText: 'Maple' }).count(), 1);
  const text = await summary();
  assert.ok(text.includes('赢单 USD 3,000'), text);
  assert.ok(text.includes('进行中 USD 2,000'), text);
  // 生成订单 opens the order form with the opportunity filled in; saving it links the order to the card.
  await card('Maple').first().locator('.opp-card-menu').click();
  await page.locator('[data-opp-action="order"]').click();
  const form = page.locator('#biz-order-form');
  await form.waitFor();
  assert.equal(await form.locator('[name="client"]').inputValue(), 'Maple & Moss Cosmetics');
  assert.equal(await form.locator('[name="amount"]').inputValue(), '3000');
  const num = await form.locator('[name="num"]').inputValue();
  await form.locator('[name="isDraft"]').setChecked(false, { force: true });
  await page.locator('button[type=submit][form="biz-order-form"]').click();
  await form.waitFor({ state: 'detached' });
  await settle(600);
  const data = await app.readData();
  const order = data.orders.find((o) => o.num === num);
  assert.equal(order.client, 'Maple & Moss Cosmetics');
  assert.equal(order.amount, 3000);
  assert.equal(data.laiOpportunities.find((o) => o.client === 'Maple & Moss Cosmetics').orderId, order.id);
  await openBoard();
  await card('Maple').first().getByRole('button', { name: '查看关联订单' }).waitFor();
  // A linked opportunity cannot make a second order.
  await card('Maple').first().locator('.opp-card-menu').click();
  assert.equal(await page.locator('[data-opp-action="order"]').count(), 0);
  await page.keyboard.press('Escape');
  assert.deepEqual(app.errors, []);
});

test('the order list and the workbench count the new order and the opportunities', async () => {
  const { page } = app;
  await page.locator('.rail-item', { hasText: '工作台' }).first().click();
  await page.locator('.wb').waitFor();
  // The order made from Maple's opportunity is the one unfinished order, drawn as a card on the order line.
  assert.equal(await page.locator('.wb-ocard').count(), 1);
  assert.match(clean(await page.locator('.wb-orders .wb-ph').innerText()), /1 笔未完成/);
  // The 商机 block uses the board data: one currency (USD) with its stages, the EUR opportunity counted apart, never converted.
  const opp = clean(await page.locator('.wb-opp').innerText());
  assert.match(opp, /3 个 · \$5,000（不含输单）/);
  assert.match(opp, /另有 1 个其他币种的商机/);
  for (const part of ['未成单', '付款未到账', '待付尾款', '已完成', '输单']) assert.ok(opp.includes(part), part);
  assert.match(clean(await page.locator('.wb-fr', { hasText: '已完成' }).innerText()), /已完成 1 个 \$3,000/);
  assert.match(clean(await page.locator('.wb-fr', { hasText: '付款未到账' }).innerText()), /付款未到账 1 个 \$1,200/);
  assert.equal(await page.locator('.wb-fr.won').count(), 2, 'the won stages are drawn green');
  // The workbench asks for the mailbox, and no mailbox is set up in this test.
  assert.deepEqual(app.errors.filter((e) => !e.includes('/api/mail/')), []);
  app.errors.length = 0;
});

test('moving to 输单 needs a reason; the card then shows it and the lost total counts it apart', async () => {
  const { page } = app;
  await openBoard();
  await card('Bluebell').first().locator('.opp-card-menu').click();
  await page.locator('[data-opp-action="move"][data-stage="lost"]').click();
  await page.locator('#opp-lost-form').waitFor();
  const reasons = await page.locator('#opp-lost-form select[name="lostReason"] option').allInnerTexts();
  assert.ok(reasons.includes('价格原因'), reasons.join(','));
  // Without a reason the form is stopped and nothing is saved.
  await page.locator('button[type="submit"][form="opp-lost-form"]').click();
  await settle(400);
  assert.equal(await page.locator('#opp-lost-form select[name="lostReason"]').evaluate((el) => el.validity.valueMissing), true);
  assert.equal((await oppOf('Bluebell Beauty Supply')).stage, 'open');
  await page.locator('#opp-lost-form select[name="lostReason"]').selectOption('价格原因', { force: true });
  await page.locator('#opp-lost-form [name="lostNote"]').fill('对方嫌贵');
  await page.locator('button[type="submit"][form="opp-lost-form"]').click();
  await settle(700);
  const lost = await oppOf('Bluebell Beauty Supply');
  assert.deepEqual([lost.stage, lost.lostReason, lost.lostNote], ['lost', '价格原因', '对方嫌贵']);
  const lostCard = column('lost').locator('.opp-card', { hasText: 'Bluebell' });
  assert.match(clean(await lostCard.innerText()), /输单原因：价格原因/);
  const text = await summary();
  assert.ok(text.includes('输单 USD 800'), text);
  assert.ok(text.includes('总销售金额 USD 4,200'), 'lost deals are not in the total: ' + text);
  await openBoard();
  assert.match(clean(await column('lost').locator('.opp-card', { hasText: 'Bluebell' }).innerText()), /输单原因：价格原因/);
  assert.deepEqual(app.errors, []);
});

test('editing the amount in the detail drawer changes the card, the totals and the backend', async () => {
  const { page } = app;
  await card('Northwind').first().locator('.opp-card-name').click();
  await page.locator('.opp-detail').waitFor();
  assert.match(clean(await page.locator('.opp-detail').innerText()), /1,200/);
  await page.locator('[data-opp-action="edit"]').click();
  await page.locator('#opp-form').waitFor();
  await settle();
  assert.equal(await page.locator('#opp-form [name="amount"]').inputValue(), '1200');
  await page.locator('#opp-form [name="amount"]').fill('1500');
  await page.locator('button[type="submit"][form="opp-form"], #opp-form button[type="submit"]').first().click();
  await page.locator('#opp-form').waitFor({ state: 'detached' });
  await settle(600);
  assert.equal((await oppOf('Northwind Lash Studio')).amount, 1500);
  const text = await summary();
  assert.ok(text.includes('进行中 USD 1,500'), text);
  assert.ok(text.includes('赢单 USD 3,000'), text);
  assert.match(clean(await card('Northwind').first().innerText()), /1,500/);
  await openBoard();
  assert.match(clean(await card('Northwind').first().innerText()), /1,500/);
  // A bad amount is refused with a message and the old one stays.
  await card('Northwind').first().locator('.opp-card-name').click();
  await page.locator('[data-opp-action="edit"]').click();
  await page.locator('#opp-form').waitFor();
  await settle();
  await page.locator('#opp-form [name="amount"]').fill('abc');
  await page.locator('button[type="submit"][form="opp-form"], #opp-form button[type="submit"]').first().click();
  await settle(500);
  assert.ok(await page.locator('#opp-form').count(), 'the form stays open');
  assert.equal((await oppOf('Northwind Lash Studio')).amount, 1500);
  await page.locator('[data-action="close-modal"]').first().click();
  await page.locator('#opp-form').waitFor({ state: 'detached' });
  assert.deepEqual(app.errors, []);
});

test('the customer name on a card opens that customer', async () => {
  const { page } = app;
  await card('Northwind').first().locator('[data-biz-customer]').click();
  await page.getByText('客户详情', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByText('avery@', { exact: false }).first().waitFor({ timeout: 5000 });
  assert.deepEqual(app.errors, []);
});

test('search, owner filter and sort narrow and order the cards; the list view shows the same ones', async () => {
  const { page } = app;
  await openBoard();
  // Three cards in USD that are not archived: Northwind, Bluebell (lost), Maple.
  assert.equal(await page.locator('.opp-card').count(), 3);
  const find = async (text) => { await page.locator('#opp-search').fill(text); await page.locator('#opp-search').press('Enter'); await settle(); };
  await find('maple');
  assert.equal(await page.locator('.opp-card').count(), 1);
  assert.match(clean(await page.locator('.opp-count').innerText()), /共 1 个商机/);
  await find('没有这个');
  assert.equal(await page.locator('.opp-card').count(), 0);
  await find('');
  assert.equal(await page.locator('.opp-card').count(), 3);
  await page.locator('#opp-owner').selectOption('Kris', { force: true });
  await settle();
  assert.equal(await page.locator('.opp-card').count(), 2);
  assert.equal(await page.locator('.opp-card', { hasText: 'Bluebell' }).count(), 0);
  await page.locator('#opp-owner').selectOption('', { force: true });
  await settle();
  // Sort by amount, biggest first: the first card of the page-wide order is the largest.
  await page.locator('[data-opp-view="list"]:visible').first().click();
  await page.locator('.opp-list').waitFor();
  await page.locator('#opp-sort').selectOption('amount-desc', { force: true });
  await settle();
  const names = async () => (await page.locator('.opp-list tbody tr').allInnerTexts()).map(clean);
  let list = await names();
  assert.equal(list.length, 3);
  assert.ok(list[0].includes('Maple') && list[1].includes('Northwind') && list[2].includes('Bluebell'), list.join(' | '));
  await page.locator('#opp-sort').selectOption('amount-asc', { force: true });
  await settle();
  list = await names();
  assert.ok(list[0].includes('Bluebell') && list[2].includes('Maple'), list.join(' | '));
  assert.match(list.join(' '), /OPP-\d{8}-\d{3}/);
  await page.locator('[data-opp-view="board"]:visible').first().click();
  await page.locator('.opp-board').waitFor();
  assert.equal(await page.locator('.opp-card').count(), 3);
  assert.deepEqual(app.errors, []);
});

test('an archived opportunity leaves the default board and comes back with the archive filter', async () => {
  const { page } = app;
  await card('Bluebell').first().locator('.opp-card-menu').click();
  await page.locator('[data-opp-action="archive"]').click();
  await settle(700);
  assert.equal((await oppOf('Bluebell Beauty Supply')).archived, true);
  assert.equal(await page.locator('.opp-card', { hasText: 'Bluebell' }).count(), 0);
  assert.match(clean(await page.locator('.opp-count').innerText()), /共 2 个商机/);
  await page.locator('#opp-archived').selectOption('archived', { force: true });
  await settle();
  assert.equal(await page.locator('.opp-card').count(), 1);
  assert.match(clean(await card('Bluebell').innerText()), /已归档/);
  await page.locator('#opp-archived').selectOption('all', { force: true });
  await settle();
  assert.equal(await page.locator('.opp-card').count(), 3);
  await page.locator('#opp-archived').selectOption('archived', { force: true });
  await settle();
  await card('Bluebell').first().locator('.opp-card-menu').click();
  await page.locator('[data-opp-action="archive"]').click();
  await settle(700);
  assert.equal((await oppOf('Bluebell Beauty Supply')).archived, false);
  await page.locator('#opp-archived').selectOption('active', { force: true });
  await settle();
  assert.equal(await page.locator('.opp-card', { hasText: 'Bluebell' }).count(), 1);
  assert.deepEqual(app.errors, []);
});

test('商机分析 counts the stages, the lost reason and the owners', async () => {
  const { page } = app;
  await page.locator('.section-tabs .section-tab:text-is("商机分析")').click();
  await page.locator('[data-opp-set-tab], .opp-bars').first().waitFor();
  const bars = clean(await page.locator('.opp-bars').innerText());
  assert.match(bars, /未成单 0 个 · 0%/);
  assert.match(bars, /付款未到账 1 个 · 33%/);
  assert.match(bars, /已完成 1 个 · 33%/);
  assert.match(bars, /输单 1 个 · 33%/);
  const body = clean(await page.locator('.opp-page').innerText());
  assert.ok(/价格原因 1 USD 800\.00/.test(body), body);
  assert.ok(body.includes('Kris'), body);
  assert.ok(body.includes('Amy'), body);
  assert.deepEqual(app.errors, []);
});

test('deleting needs a second click, removes the opportunity for good, and the total follows', async () => {
  const { page } = app;
  await page.locator('.section-tabs .section-tab:text-is("商机看板")').click();
  await page.locator('.opp-page').waitFor();
  await card('Bluebell').first().locator('.opp-card-menu').click();
  await page.locator('[data-opp-action="delete"]').click();
  await settle();
  assert.equal(await (await opps()).length, 4, 'the first click only asks');
  assert.match(clean(await page.locator('[data-opp-action="delete"]').innerText()), /再点一次确认删除/);
  await page.locator('[data-opp-action="delete"]').click();
  await settle(700);
  assert.equal((await opps()).some((o) => o.client === 'Bluebell Beauty Supply'), false);
  assert.equal(await page.locator('.opp-card', { hasText: 'Bluebell' }).count(), 0);
  assert.match(clean(await page.locator('.opp-count').innerText()), /共 2 个商机/);
  const text = await summary();
  assert.ok(text.includes('输单 USD 0'), text);
  assert.ok(text.includes('总销售金额 USD 4,500'), text);
  await openBoard();
  assert.equal(await page.locator('.opp-card').count(), 2);
  assert.deepEqual(app.errors, []);
});

test('新建商机: 客户 is a dropdown with a search box; picking a customer fills 关联联系人 and the save keeps it', async () => {
  const { page } = app;
  const before = new Set((await opps()).map((o) => o.id));
  await page.locator('[data-opp-action="new"]').first().click();
  await page.locator('#opp-form').waitFor();
  await settle();
  assert.equal(await page.locator('#opp-form input[name="client"], #opp-client-list, #opp-owner-list').count(), 0, 'no free-typing box for 客户');
  assert.equal(await page.locator('#opp-form select[name="owner"]').count(), 1, '负责人 is a dropdown too');
  await page.locator('#opp-client + .lai-select-trigger').click();
  await page.locator('.lai-select-menu .lai-select-search').fill('Lumen');
  assert.equal(await page.locator('.lai-select-menu .lai-select-option').count(), 1, 'the search narrows the customers');
  await page.locator('.lai-select-menu .lai-select-option', { hasText: 'Lumen Lash Lab' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('#opp-form select[name="contact"] option')].some((o) => o.value === 'Greta Vogel'));
  assert.equal(await page.locator('#opp-client').inputValue(), 'Lumen Lash Lab');
  await page.locator('#opp-form select[name="contact"]').selectOption('Greta Vogel', { force: true });
  await page.locator('#opp-form [name="owner"]').selectOption('Kris', { force: true });
  await page.locator('#opp-form [name="amount"]').fill('321');
  await page.locator('#opp-form [name="endDate"]').evaluate((el) => { el.value = '2030-03-01'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('button[type="submit"][form="opp-form"]').click();
  await page.locator('#opp-form').waitFor({ state: 'detached' });
  await settle(500);
  const made = (await opps()).find((o) => !before.has(o.id));
  assert.ok(made, 'saved');
  assert.equal(made.client, 'Lumen Lash Lab');
  assert.equal(made.contact, 'Greta Vogel');
  assert.equal(made.owner, 'Kris');
  assert.equal(made.amount, 321);
  assert.deepEqual(app.errors, []);
});
