// 商机 detail drawer and attachments in the real page with the real backend.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp } from './harness.mjs';

let app, tmp;
before(async () => {
  app = await startApp();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lai-test-att-'));
  await app.open('customers');
  await app.page.locator('.rail-item[data-rail-menu="商机"]').click();
  await app.page.waitForTimeout(600);
});
after(async () => { await app?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);

test('a new opportunity is saved and opens in the detail drawer', async () => {
  const { page } = app;
  await page.locator('[data-opp-action="new"]').first().click();
  await settle();
  await page.locator('#opp-form [name="client"]').selectOption('Lumen Lash Lab', { force: true });
  await page.waitForFunction(() => document.querySelector('#opp-form select[name="contact"]')?.options.length > 1);
  await settle(300);
  await page.locator('#opp-form [name="owner"]').selectOption('Kris', { force: true });
  await page.locator('#opp-form [name="amount"]').fill('1200');
  await page.locator('#opp-form [name="endDate"]').evaluate((el) => { el.value = '2030-01-31'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#opp-form select[name="contact"]').selectOption({ index: 1 });
  await page.locator('button[type="submit"][form="opp-form"], #opp-form button[type="submit"]').first().click();
  await settle(700);
  await page.locator('.opp-card-name').first().click();
  await page.locator('.opp-detail').waitFor({ timeout: 5000 });
  assert.match(await page.locator('.opp-detail').innerText(), /Lumen Lash Lab/);
});

test('a file is attached, previewed as listed, survives a reload, and can be deleted', async () => {
  const { page } = app;
  const file = path.join(tmp, 'quote.txt');
  fs.writeFileSync(file, 'price list');
  await page.locator('#opp-attach-input').setInputFiles(file);
  await page.locator('[data-att]').first().waitFor({ timeout: 8000 });
  assert.match(await page.locator('#opp-attach').innerText(), /quote\.txt/);
  const saved = (await app.readData()).laiOpportunities || [];
  assert.equal(saved[0]?.attachments?.length, 1, 'metadata saved with the opportunity');
  assert.match(saved[0].attachments[0].fileUrl, /^\/attachments\/opportunities\//);
  await app.open('customers');
  await page.locator('.rail-item[data-rail-menu="商机"]').click();
  await settle(700);
  await page.locator('.opp-card-name').first().click();
  await page.locator('[data-att]').first().waitFor({ timeout: 5000 });
  await page.locator('[data-attach-action="delete"]').first().click();
  await settle();
  const confirm = page.locator('[data-attach-action="delete"]').first();
  if (await confirm.count()) await confirm.click();
  await settle(700);
  assert.equal(await page.locator('[data-att]').count(), 0);
  assert.equal(((await app.readData()).laiOpportunities || [])[0]?.attachments?.length || 0, 0);
  assert.deepEqual(app.errors, []);
});
