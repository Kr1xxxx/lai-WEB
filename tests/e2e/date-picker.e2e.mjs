// Browser end-to-end test: date fields show one Chinese calendar and still hand the form a normal YYYY-MM-DD value.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('the new-order date field opens a Chinese calendar and writes YYYY-MM-DD back to the form', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.rail-item', { hasText: '交易' }).first().click();
  await page.getByRole('button', { name: /新建订单/ }).first().click();
  const trigger = page.locator('#overlay-root .lai-date-trigger').first();
  await trigger.waitFor();
  assert.equal(await page.locator('#overlay-root input[type="date"]:not(.lai-date-native)').count(), 0, 'no system date control is left on screen');
  await trigger.click();
  const calendar = page.locator('.flatpickr-calendar.open');
  await calendar.waitFor();
  await calendar.getByText('周一', { exact: true }).waitFor();
  assert.equal((await calendar.locator('.flatpickr-weekday').first().innerText()).trim(), '周一', 'the week starts on Monday');
  await calendar.getByRole('button', { name: '今天' }).click();
  assert.equal(await trigger.inputValue(), localToday());
  assert.equal(await page.locator('#overlay-root input.lai-date-native').first().inputValue(), localToday());
  assert.deepEqual(app.errors, []);
});

test('the date range on the opportunities toolbar filters by the chosen day without a page error', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.rail-item', { hasText: '商机' }).first().click();
  const from = page.locator('.opp-range .lai-date-trigger').first();
  await from.waitFor();
  await from.click();
  await page.locator('.flatpickr-calendar.open').getByRole('button', { name: '今天' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.opp-range .lai-date-trigger').first().inputValue(), localToday(), 'the chosen day survives the page redraw');
  assert.deepEqual(app.errors, []);
});
