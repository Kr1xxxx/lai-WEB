// Browser end-to-end tests: real backend + real page, driven by mouse and keyboard.
// Run: npm run test:e2e   (see AGENTS.md for installing Playwright outside package.json)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const settle = (ms = 300) => app.page.waitForTimeout(ms);
const listRows = () => app.page.locator('tbody tr');

test('customer list shows the sample customers with their main contact', async () => {
  const { page } = app;
  await page.getByText('Northwind Lash Studio').first().waitFor();
  assert.equal(await listRows().count(), 4);
  const row = listRows().filter({ hasText: 'Northwind Lash Studio' });
  await assert.doesNotReject(row.getByText('Avery Brooks').waitFor({ timeout: 2000 }), 'main contact column shows the contact name');
  assert.deepEqual(app.errors, []);
});

test('searching by company name narrows the list', async () => {
  const { page } = app;
  const box = page.getByPlaceholder('请输入').first();
  await box.fill('Lumen');
  await box.press('Enter');
  await settle();
  assert.equal(await listRows().count(), 1);
  await listRows().first().getByText('Lumen Lash Lab').waitFor();
  await box.fill('');
  await box.press('Enter');
  await settle();
  assert.equal(await listRows().count(), 4);
});

test('clicking a company opens its detail with the contact', async () => {
  const { page } = app;
  await listRows().filter({ hasText: 'Maple & Moss Cosmetics' }).getByText('Maple & Moss Cosmetics').click();
  await page.getByText('客户详情', { exact: true }).first().waitFor({ timeout: 5000 });
  // The email is not a list column, so finding it proves the detail view opened for this customer.
  await page.getByText('owen@maplemoss.example').first().waitFor({ timeout: 5000 });
  assert.deepEqual(app.errors, []);
});

test('a heart marks a menu entry as 常用 and it survives a reload', async () => {
  const { page } = app;
  await app.open('customers');
  const row = page.locator('.subnav .nav-row:has(.nav-label:text-is("公海客户"))');
  const heart = row.locator('.nav-heart');
  await row.waitFor();
  assert.equal(await heart.evaluate((el) => getComputedStyle(el).opacity), '0', 'heart hidden until hover');
  await row.hover();
  await settle();
  assert.equal(await heart.evaluate((el) => getComputedStyle(el).opacity), '1', 'heart shows on hover');
  await heart.click();
  await settle(600);
  assert.ok(await heart.evaluate((el) => el.classList.contains('is-favorite')));
  assert.deepEqual((await app.readData()).laiSettings?.favoriteNav, ['screen:pool'], 'favorite saved to the backend');
  await page.reload();
  await row.waitFor();
  assert.ok(await heart.evaluate((el) => el.classList.contains('is-favorite')), 'still favorite after reload');
  assert.deepEqual(app.errors, []);
});

test('a new customer filled in the form is saved and listed after a reload', async () => {
  const { page } = app;
  await app.open('customers');
  await page.getByRole('button', { name: '新建客户' }).first().click();
  await page.locator('#ce-name').fill('Orchid Test Beauty');
  await page.locator('#ce-country').fill('美国');
  await page.getByRole('option', { name: '美国', exact: true }).click();
  await page.locator('#ce-source').fill('官网');
  await page.keyboard.press('Enter');
  await page.locator('#ce-contact-0').fill('Iris Monroe');
  await page.locator('#ce-email-0').fill('iris@orchidtest.example');
  await page.locator('#ce-phone-0').fill('2125550199');
  await page.getByRole('button', { name: '确 定' }).click();
  await settle(1000);
  const saved = (await app.readData()).customers['Orchid Test Beauty'];
  assert.ok(saved, 'customer stored by the backend');
  assert.equal(saved.country, '美国');
  assert.equal(saved.source, '官网');
  assert.equal(saved.contact, 'Iris Monroe');
  assert.equal(saved.email, 'iris@orchidtest.example');
  await page.reload();
  await page.getByText('Orchid Test Beauty').first().waitFor();
  assert.equal(await listRows().count(), 5);
  assert.deepEqual(app.errors, []);
});
