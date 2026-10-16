// 汇率设置 (R1) in the real page with the real backend: the page sits under 交易, set EUR, the customer's converted
// total drives the level, editing the rate changes legacy orders but not an order saved with a snapshot, delete is
// blocked while EUR is used, and a 业务 account cannot open the page.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const CLIENT = 'Rate Test GmbH';
let app;

// No mailbox is bound in the test data dir, so the mail badge requests answer 409; that is not a page error.
const pageErrors = () => app.errors.filter((e) => !/HTTP 409: .*\/api\/mail\//.test(e));
const settle = (ms = 400) => app.page.waitForTimeout(ms);
const data = () => app.readData();
const go = async (route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(600);
};
const toast = (pattern) => app.page.locator('#toast.show', { hasText: pattern }).waitFor();
const levelOf = async () => {
  await app.open('customers');
  const link = app.page.locator(`.company-link[data-open="${CLIENT}"]`);
  await link.waitFor();
  const badge = link.locator('xpath=preceding-sibling::span[contains(@class,"level-icon")]');
  return (await badge.count()) ? badge.getAttribute('aria-label') : '';
};
const row = (code) => app.page.locator(`[data-rate-row="${code}"]`);

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
    d.customers[CLIENT] = { client: CLIENT, owner: 'Kris', country: '德国', history: [] };
    // An order saved before rates existed: no usdRate snapshot, so it follows the table.
    d.orders = [{ id: 'legacy-eur', num: 'R-OLD', client: CLIENT, amount: 48000, paidAmount: 0, currency: 'EUR', stage: 'quote', createdAt: '2026-09-01', orderMonth: '2026-09', isDraft: false }];
    d.laiSettings = {
      ...(d.laiSettings || {}), defaultOwner: 'Kris',
      roles: { roles: [], members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current: 'm-kris' },
    };
  });
});
after(async () => { await app?.close(); });

test('汇率设置 is under 交易; with no rates the EUR customer has no level, and only USD is listed with EUR as 未设置', async () => {
  assert.equal(await levelOf(), '', 'no EUR rate: the level stays unknown, as before');
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="交易"]').click();
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("汇率设置"))').click();
  await page.locator('.rate-page').waitFor();
  assert.match(await page.locator('.pagebar h1').innerText(), /汇率设置/);
  assert.match(await row('USD').innerText(), /100/);
  assert.match(await row('EUR').innerText(), /未设置/);
  assert.match(await page.locator('.rate-note').innerText(), /改汇率不会改已经保存的订单。/);
  assert.deepEqual(pageErrors(), []);
});

test('setting EUR converts the customer total: 48,000 EUR × 110 / 100 = 52,800 USD → B级', async () => {
  const { page } = app;
  await page.locator('#rate-add-form [name="code"]').fill('eur');
  await page.locator('#rate-add-form [name="usd100"]').fill('110');
  await page.locator('#rate-add-form button[type="submit"]').click();
  await toast('已保存');
  assert.match(await row('EUR').innerText(), /110/);
  assert.deepEqual((await data()).laiSettings.rates.list.map((r) => [r.code, r.usd100]), [['EUR', 110]]);
  // Bad input stays on the page and is not saved.
  await page.locator('#rate-add-form [name="code"]').fill('GB');
  await page.locator('#rate-add-form [name="usd100"]').fill('1');
  await page.locator('#rate-add-form button[type="submit"]').click();
  await page.locator('#rate-error.visible', { hasText: '3 个英文字母' }).waitFor();
  assert.equal((await data()).laiSettings.rates.list.length, 1);
  assert.equal(await levelOf(), '客户等级：B级翡翠客户');
  assert.deepEqual(pageErrors(), []);
});

test('a new EUR order keeps its rate snapshot; editing the rate moves only the legacy order', async () => {
  const { page } = app;
  await go('order-list');
  await page.locator('[data-biz-action="new-order"]').first().click();
  const form = page.locator('#biz-order-form');
  await form.waitFor();
  await form.locator('[name="num"]').fill('R-NEW');
  await form.locator('[name="client"]').fill(CLIENT);
  await form.locator('[name="amount"]').fill('1000');
  await form.locator('[name="currency"]').selectOption('EUR', { force: true });
  const draft = form.locator('[name="isDraft"]');
  if (await draft.count()) await draft.setChecked(false, { force: true });
  await page.locator('button[type=submit][form="biz-order-form"]').click();
  await form.waitFor({ state: 'detached' });
  const fresh = (await data()).orders.find((o) => o.num === 'R-NEW');
  assert.equal(fresh.usdRate, 110);

  await go('rates');
  await row('EUR').locator('[data-rate-action="edit"]').click();
  const input = row('EUR').locator('input[name="usd100"]');
  await input.fill('90');
  await input.press('Enter');
  await input.waitFor({ state: 'detached' });
  assert.match(await row('EUR').innerText(), /90/);
  const saved = await data();
  assert.equal(saved.laiSettings.rates.list[0].usd100, 90);
  assert.equal(saved.orders.find((o) => o.num === 'R-NEW').usdRate, 110, 'the saved order keeps its snapshot');
  assert.equal(Object.hasOwn(saved.orders.find((o) => o.num === 'R-OLD'), 'usdRate'), false);
  // 48,000 × 0.9 + 1,000 × 1.1 = 44,300 USD over two orders → C级.
  assert.equal(await levelOf(), '客户等级：C级白金客户');
  assert.deepEqual(pageErrors(), []);
});

test('EUR cannot be deleted while orders use it', async () => {
  const { page } = app;
  await go('rates');
  await row('EUR').locator('[data-rate-action="delete"]').click();
  await page.locator('#rate-error.visible', { hasText: '在用 EUR，不能删除' }).waitFor();
  assert.equal((await data()).laiSettings.rates.list.length, 1);
  assert.deepEqual(pageErrors(), []);
});

test('a 业务 account does not see 汇率设置 and cannot open it by address', async () => {
  const { page } = app;
  await page.locator('[data-action="profile-menu"]').click();
  await page.locator('.popover.account-menu [data-lai-switch-member]', { hasText: 'Amy' }).click();
  await toast('已切换到');
  await settle();
  await page.locator('.rail-item[data-rail-menu="交易"]').hover();
  await page.locator('.rail-flyout').waitFor();
  assert.doesNotMatch(await page.locator('.rail-flyout').innerText(), /汇率设置/);
  await app.open('rates');
  await settle(600);
  assert.equal(await page.locator('.rate-page').count(), 0);
  assert.match(await page.locator('#app').innerText(), /没有“设置管理·汇率设置”权限/);
  assert.deepEqual(pageErrors(), []);
});
