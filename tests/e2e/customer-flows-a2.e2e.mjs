// Browser end-to-end test: 客户设置 A2 in the customer flows — past-time follow-ups, follow-up templates,
// 最近成交时间, pool forecast, move-to-pool reasons, claiming, hidden pool contacts and the daily auto-run.
// Each test starts its own backend and page, then seeds settings through the real save route.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const CS = require('../../src/customer-settings-model.js');
const CT = require('../../src/customer-tools.js');
const LM = require('../../src/modules.js');

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const RULE = { id: 'r30', name: '30天未联系', enabled: true, kind: 'noContact', days: 30, groups: [], startDate: '' };

/** Starts a fresh app, loads the page once (to learn the token) and runs `fn`; always closes the app. */
async function run(fn) {
  const app = await startApp();
  try {
    await app.open('customers');
    await fn(app);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

/** Changes the saved data through the real save route (the page's session cookie authorises it); `fn` gets the data and returns the new data. */
async function seed(app, fn) {
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  state.data = fn(state.data) ?? state.data;
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
}
const reload = async (app) => { await app.page.reload(); await app.page.waitForLoadState('networkidle'); await app.page.locator('.lcd-root, tbody tr, .module-page').first().waitFor(); };
/** Waits until the saved data satisfies `check` (saves are asynchronous). */
async function until(app, check, what) {
  for (let i = 0; i < 60; i++) {
    if (check(await app.readData())) return;
    await app.page.waitForTimeout(100);
  }
  assert.fail('timed out waiting for ' + what);
}
const withCustomer = (data, name, patch) => ({ ...data, customers: { ...data.customers, [name]: { ...data.customers[name], ...patch } } });
const poolRulesInput = (extra = {}) => ({ rules: [RULE], ...extra });

const openDetail = async (app, name) => {
  const { page } = app;
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户列表"))').click();
  await page.locator('tbody tr', { hasText: name }).getByText(name).first().click();
  await page.locator('.lcd-root').waitFor();
};
const gotoCustomer = async (app, name) => {
  await app.page.goto(`${app.base}/trade-order-system.html?customer=${encodeURIComponent(name)}#customers`);
  await app.page.locator('.lcd-root').waitFor();
};
const activityTab = (app) => app.page.locator('.lcd-tabs [data-tab="activity"]').click();
const openPool = async (app) => {
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("公海客户"))').click();
  await app.page.locator('.module-page').waitFor();
};
// Set LAI_SHOT_DIR to also write 1440×900 screenshots of the dialogs for a visual check.
const shot = async (app, file) => {
  if (!process.env.LAI_SHOT_DIR) return;
  await app.page.waitForTimeout(700);
  await app.page.screenshot({ path: `${process.env.LAI_SHOT_DIR}/${file}.png` });
};

test('write follow-up: a past time is saved as chosen, a future time is refused, and the field is gone when the option is off', async () => {
  await run(async (app) => {
    const { page } = app;
    await seed(app, (data) => CS.setFollowupOptions(data, { allowPastTime: true }));
    await reload(app);
    await openDetail(app, 'Northwind Lash Studio');
    await activityTab(app);
    const field = page.locator('#followup-form [name="followupTime"]');
    await page.locator('#followup-text').fill('补一条上周的电话跟进');
    await field.waitFor();
    assert.match(await field.getAttribute('max'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.match(await page.locator('.lcd-followup-time').innerText(), /跟进时间（选填，留空为现在）/);
    // Beyond "now": the browser itself refuses (max); the model refuses too when the check is bypassed.
    await field.fill('2999-01-01T09:00');
    assert.equal(await field.evaluate((el) => el.validity.rangeOverflow), true);
    await field.evaluate((el) => { el.removeAttribute('max'); });
    await page.locator('#followup-form button[type=submit]').click();
    await page.locator('#followup-error.visible').waitFor();
    assert.match(await page.locator('#followup-error').innerText(), /不能晚于现在/);
    assert.equal((await app.readData()).customers['Northwind Lash Studio'].history.length, 0, 'nothing saved');
    // A past time is saved with that time.
    await field.fill('2026-01-05T09:30');
    await page.locator('#followup-form button[type=submit]').click();
    await until(app, (d) => d.customers['Northwind Lash Studio'].history.length === 1, 'the past follow-up');
    const saved = (await app.readData()).customers['Northwind Lash Studio'];
    const expected = new Date('2026-01-05T09:30').toISOString();
    assert.equal(saved.history[0].time, expected);
    assert.equal(saved.lastFollowup, expected);
    // Option off: no field, and a follow-up is saved as before (time = now).
    await seed(app, (data) => CS.setFollowupOptions(data, { allowPastTime: false }));
    await reload(app);
    await openDetail(app, 'Northwind Lash Studio');
    await activityTab(app);
    await page.locator('#followup-text').fill('现在的跟进');
    assert.equal(await page.locator('#followup-form [name="followupTime"]').count(), 0);
    await page.locator('#followup-form button[type=submit]').click();
    await until(app, (d) => d.customers['Northwind Lash Studio'].history.length === 2, 'the follow-up written now');
    const after = (await app.readData()).customers['Northwind Lash Studio'].history[0];
    assert.ok(Math.abs(Date.now() - Date.parse(after.time)) < 60000, 'saved with the current time');
  });
});

test('batch write follow-up: time field and template picker work in the dialog', async () => {
  await run(async (app) => {
    const { page } = app;
    await seed(app, (data) => {
      let next = CS.setFollowupOptions(data, { allowPastTime: true });
      next = CS.addTemplateGroup(next, '开发信');
      next = CS.addTemplate(next, CS.get(next).followup.templates[0].id, '已发开发信，等待回复');
      return next;
    });
    await reload(app);
    await page.locator('tbody tr', { hasText: 'Lumen Lash Lab' }).locator('input[data-select]').check();
    await page.locator('[data-action="batch-followup"]').first().click();
    await page.locator('#batch-followup-form').waitFor();
    await page.locator('#batch-followup-time').waitFor();
    await page.locator('[data-action="followup-templates"]').click();
    await page.locator('.followup-template-popover').waitFor();
    await page.locator('.followup-template-item', { hasText: '已发开发信' }).click();
    assert.equal(await page.locator('#batch-followup-text').inputValue(), '已发开发信，等待回复');
    assert.equal(await page.locator('.followup-template-popover').count(), 0, 'picker closed');
    await page.locator('#batch-followup-time').fill('2026-02-03T08:15');
    await page.locator('button[type=submit][form="batch-followup-form"]').click();
    await page.locator('#batch-followup-form').waitFor({ state: 'detached' });
    const saved = (await app.readData()).customers['Lumen Lash Lab'];
    assert.equal(saved.history[0].time, new Date('2026-02-03T08:15').toISOString());
    assert.match(saved.history[0].text, /已发开发信/);
  });
});

test('templates: the picker inserts a text (appending on a new line), and an empty list offers 去设置', async () => {
  await run(async (app) => {
    const { page } = app;
    await seed(app, (data) => {
      let next = CS.addTemplateGroup(data, '样品');
      const id = CS.get(next).followup.templates[0].id;
      next = CS.addTemplate(next, id, '样品已寄出，请注意查收。');
      return CS.addTemplate(next, id, '请问样品试用后有什么意见？');
    });
    await reload(app);
    await openDetail(app, 'Northwind Lash Studio');
    await activityTab(app);
    await page.locator('[data-action="followup-templates"]').click();
    const picker = page.locator('.followup-template-popover');
    await picker.waitFor();
    assert.match(await picker.innerText(), /样品/);
    await shot(app, 'template-picker');
    await picker.locator('.followup-template-item', { hasText: '样品已寄出' }).click();
    assert.equal(await page.locator('#followup-text').inputValue(), '样品已寄出，请注意查收。');
    assert.equal(await page.locator('.followup-template-popover').count(), 0);
    assert.ok(await page.locator('#followup-form').evaluate((el) => el.classList.contains('has-draft')), 'draft state follows the inserted text');
    await page.locator('[data-action="followup-templates"]').click();
    await picker.locator('.followup-template-item', { hasText: '请问样品' }).click();
    assert.equal(await page.locator('#followup-text').inputValue(), '样品已寄出，请注意查收。\n请问样品试用后有什么意见？');
    // Escape closes the picker without losing the text.
    await page.locator('[data-action="followup-templates"]').click();
    await picker.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.followup-template-popover').count(), 0);
    // No templates: a hint and a way to the settings page.
    await seed(app, (data) => ({ ...data, laiSettings: { ...data.laiSettings, customerSettings: { ...data.laiSettings.customerSettings, followup: { allowPastTime: false, templates: [] } } } }));
    await reload(app);
    await openDetail(app, 'Northwind Lash Studio');
    await activityTab(app);
    await page.locator('[data-action="followup-templates"]').click();
    await picker.waitFor();
    assert.match(await picker.innerText(), /还没有跟进模板/);
    await picker.getByRole('button', { name: '去设置' }).click();
    await page.locator('.cs-page').waitFor();
  });
});

test('detail: 最近成交时间 and the pool forecast notice', async () => {
  await run(async (app) => {
    const { page } = app;
    // The deal must be recent: a fixed date drifts toward the 30-day rule as the calendar moves on.
    const d = new Date(Date.now() - 2 * DAY), dealDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await seed(app, (data) => {
      let next = CT.markAutoRun(CT.setPoolRules(data, poolRulesInput()));
      next = withCustomer(next, 'Bluebell Beauty Supply', { createdAt: ago(25) });
      next = withCustomer(next, 'Maple & Moss Cosmetics', { createdAt: ago(45) });
      next = withCustomer(next, 'Northwind Lash Studio', { createdAt: ago(1) });
      return { ...next, orders: [...(next.orders || []), { id: 'o-deal', num: 'SO-DEAL', client: 'Northwind Lash Studio', amount: 100, currency: 'USD', stage: 'done', createdAt: dealDay, isDraft: false }] };
    });
    await reload(app);
    await openDetail(app, 'Bluebell Beauty Supply');
    const notice = page.locator('[data-pool-forecast]');
    assert.equal((await notice.innerText()).replace(/\s+/g, ''), '还有5天移入公海（规则：30天未联系）');
    await shot(app, 'forecast-notice');
    await openDetail(app, 'Maple & Moss Cosmetics');
    assert.match(await page.locator('[data-pool-forecast]').innerText(), /已符合公海规则「30天未联系」，下次执行时会移入公海/);
    await openDetail(app, 'Northwind Lash Studio');
    assert.equal(await page.locator('[data-pool-forecast]').count(), 0, 'not close to the rule: no notice');
    assert.equal(await page.locator('.lcd-field:has(dt:text-is("最近成交时间")) dd').innerText(), dealDay);
    await openDetail(app, 'Lumen Lash Lab');
    assert.equal(await page.locator('.lcd-field:has(dt:text-is("最近成交时间")) dd').innerText(), '—');
  });
});

test('move to pool: a required reason is asked for, refused when empty, and saved with the customer', async () => {
  await run(async (app) => {
    const { page } = app;
    await seed(app, (data) => CT.markAutoRun(CT.setPoolRules(data, poolRulesInput({ requireReason: true, reasons: ['客户无回复', '信息有误'] }))));
    await reload(app);
    await openDetail(app, 'Lumen Lash Lab');
    await page.locator('[data-action="customer-actions"]').click();
    await page.locator('[data-action="move-current-pool"]').click();
    const reason = page.locator('#transition-reason');
    await reason.waitFor();
    assert.deepEqual(await reason.locator('option').allInnerTexts(), ['请选择原因', '客户无回复', '信息有误'], 'no 不填 option when required');
    await shot(app, 'move-with-reason');
    await page.locator('#confirm-transition').click();
    await page.locator('#workspace-error.visible').waitFor();
    assert.match(await page.locator('#workspace-error').innerText(), /请选择移入公海的原因/);
    assert.notEqual((await app.readData()).customers['Lumen Lash Lab'].laiBucket, 'pool');
    await reason.selectOption('客户无回复', { force: true });
    await page.locator('#confirm-transition').click();
    await page.locator('.lcd-root').waitFor({ state: 'detached' });
    const saved = (await app.readData()).customers['Lumen Lash Lab'];
    assert.equal(saved.laiBucket, 'pool');
    assert.equal(saved.poolReason, '客户无回复');
    assert.equal(saved.history[0].text, '移入公海，原因：客户无回复');
    // Batch move: the same select, with 不填 when the reason is optional.
    await seed(app, (data) => CT.setPoolRules(data, poolRulesInput({ requireReason: false, reasons: ['客户无回复'] })));
    await reload(app);
    await page.locator('tbody tr', { hasText: 'Bluebell Beauty Supply' }).locator('input[data-select]').check();
    await page.locator('[data-action="batch-more"]').first().click();
    await page.locator('[data-action="batch-pool"]').click();
    assert.deepEqual(await page.locator('#transition-reason option').allInnerTexts(), ['不填', '客户无回复']);
    await page.locator('#confirm-transition').click();
    await page.locator('#confirm-transition').waitFor({ state: 'detached' });
    const batch = (await app.readData()).customers['Bluebell Beauty Supply'];
    assert.equal(batch.laiBucket, 'pool');
    assert.equal(batch.history[0].text, '移入公海');
  });
});

test('claim: the dialog picks the owner, shows the quota, and the reclaim block and claim limit refuse', async () => {
  await run(async (app) => {
    const { page } = app;
    await seed(app, (data) => {
      let next = withCustomer(data, 'Maple & Moss Cosmetics', { owner: 'Amy' });
      next = LM.moveCustomers(next, ['Lumen Lash Lab', 'Bluebell Beauty Supply'], 'pool', new Date().toISOString());
      return CT.markAutoRun(CT.setPoolRules(next, { rules: [], reclaimBlockDays: 3, claimLimit: { periodDays: 1, defaultLimit: 1, perOwner: {} } }));
    });
    await reload(app);
    await openPool(app);
    const claim = (name) => page.locator('tbody tr', { hasText: name }).getByRole('button', { name: '领回客户' }).click();
    // The previous owner is blocked for 3 days.
    await claim('Lumen Lash Lab');
    const owner = page.locator('#claim-owner');
    await owner.waitFor();
    assert.equal(await owner.inputValue(), 'Kris', 'defaults to the previous owner');
    assert.equal(await page.locator('#claim-quota').innerText(), '近 1 天已领 0 / 上限 1');
    await shot(app, 'claim-dialog');
    await page.locator('button[type=submit][form="claim-form"]').click();
    await page.locator('#workspace-error.visible').waitFor();
    assert.match(await page.locator('#workspace-error').innerText(), /原跟进人 3 天内不能领回这个客户/);
    // Another owner can claim it.
    await owner.selectOption('Amy', { force: true });
    await page.locator('button[type=submit][form="claim-form"]').click();
    await page.locator('#claim-form').waitFor({ state: 'detached' });
    const claimed = (await app.readData()).customers['Lumen Lash Lab'];
    assert.equal(claimed.laiBucket, 'active');
    assert.equal(claimed.owner, 'Amy');
    assert.equal(claimed.poolClaims.at(-1).owner, 'Amy');
    // The limit is one per day: Amy's second claim is refused.
    await openPool(app);
    await claim('Bluebell Beauty Supply');
    await page.locator('#claim-owner').selectOption('Amy', { force: true });
    assert.equal(await page.locator('#claim-quota').innerText(), '近 1 天已领 1 / 上限 1');
    await page.locator('button[type=submit][form="claim-form"]').click();
    await page.locator('#workspace-error.visible').waitFor();
    assert.match(await page.locator('#workspace-error').innerText(), /Amy 1 天内最多领取 1 位客户，已领 1 位/);
    assert.equal((await app.readData()).customers['Bluebell Beauty Supply'].laiBucket, 'pool');
  });
});

test('hidden pool contacts: the list and detail hide them and editing is blocked', async () => {
  await run(async (app) => {
    const { page } = app;
    await seed(app, (data) => CT.markAutoRun(CT.setPoolRules(LM.moveCustomers(data, ['Maple & Moss Cosmetics'], 'pool', new Date().toISOString()), { rules: [], showPoolContacts: false })));
    await reload(app);
    await openPool(app);
    const row = page.locator('tbody tr', { hasText: 'Maple & Moss Cosmetics' });
    assert.match(await row.innerText(), /已隐藏/);
    assert.doesNotMatch(await row.innerText(), /Owen Fraser/);
    await row.getByRole('button', { name: '查看' }).click();
    await page.locator('.lcd-root').waitFor();
    await page.getByText('公海联系人已隐藏').first().waitFor();
    const text = await page.locator('.lcd-root').innerText();
    assert.doesNotMatch(text, /owen@maplemoss\.example|Owen Fraser/);
    for (const edit of await page.locator('[data-action="edit"]').all()) {
      assert.equal(await edit.isDisabled(), true);
      assert.equal(await edit.getAttribute('title'), '公海客户不能编辑（客户设置 → 公海管理）');
    }
    await shot(app, 'pool-hidden-contacts');
    // Switching the option back shows them again.
    await seed(app, (data) => CT.setPoolRules(data, { rules: [], showPoolContacts: true }));
    await reload(app);
    await openPool(app);
    assert.match(await page.locator('tbody tr', { hasText: 'Maple & Moss Cosmetics' }).innerText(), /Owen Fraser/);
  });
});

test('auto-run: due customers move once per day, and the day is marked even when nothing moved', async () => {
  await run(async (app) => {
    const { page } = app;
    const today = CT.markAutoRun({}).laiSettings.poolRules.lastAutoRun;
    const yesterday = CT.markAutoRun({}, new Date(Date.now() - DAY)).laiSettings.poolRules.lastAutoRun;
    assert.notEqual(today, yesterday);
    await seed(app, (data) => {
      const next = CT.markAutoRun(CT.setPoolRules(data, poolRulesInput()), new Date(Date.now() - DAY));
      return withCustomer(withCustomer(next, 'Bluebell Beauty Supply', { createdAt: ago(60) }), 'Northwind Lash Studio', { createdAt: ago(3) });
    });
    assert.equal((await app.readData()).laiSettings.poolRules.lastAutoRun, yesterday);
    await reload(app);
    await page.locator('#toast.show', { hasText: '按公海规则移入 1 位客户' }).waitFor();
    let data = await app.readData();
    assert.equal(data.customers['Bluebell Beauty Supply'].laiBucket, 'pool');
    assert.equal(data.customers['Bluebell Beauty Supply'].poolReason, '30天未联系');
    assert.notEqual(data.customers['Northwind Lash Studio'].laiBucket, 'pool');
    assert.equal(data.laiSettings.poolRules.lastAutoRun, today);
    // Same day, another customer becomes due: a reload does not run the rules again.
    await seed(app, (state) => withCustomer(state, 'Northwind Lash Studio', { createdAt: ago(90) }));
    await reload(app);
    await page.waitForTimeout(800);
    data = await app.readData();
    assert.notEqual(data.customers['Northwind Lash Studio'].laiBucket, 'pool');
    assert.equal(data.laiSettings.poolRules.lastAutoRun, today);
    // A new day with nothing due: no move, no toast, but the day is marked.
    await seed(app, (state) => withCustomer(CT.markAutoRun(state, new Date(Date.now() - DAY)), 'Northwind Lash Studio', { createdAt: ago(2) }));
    await reload(app);
    await until(app, (d) => d.laiSettings.poolRules.lastAutoRun === today, 'the day to be marked');
    data = await app.readData();
    assert.equal(data.laiSettings.poolRules.lastAutoRun, today);
    assert.equal(await page.locator('#toast.show').count(), 0);
  });
});
