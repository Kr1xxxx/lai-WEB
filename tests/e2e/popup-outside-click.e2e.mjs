// Browser end-to-end test: clicking outside closes info popups, but not popups where the user is filling something in.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

const drawer = (page) => page.locator('#overlay-root .drawer');
const clickOutside = (page) => page.mouse.click(5, 450);

test('an information popup closes when you click outside it', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.topbar button.app-version').click();
  await drawer(page).waitFor();
  await clickOutside(page);
  await drawer(page).waitFor({ state: 'detached' });
});

test('the new-customer form stays open when you click outside it', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.topbar [data-action="new"]').click();
  await drawer(page).waitFor();
  await page.locator('#overlay-root .drawer input:not([type="hidden"])').first().fill('测试公司');
  await clickOutside(page);
  await page.waitForTimeout(400);
  assert.equal(await drawer(page).count(), 1, 'the form was closed by an outside click');
  assert.equal(await page.locator('#overlay-root .drawer input:not([type="hidden"])').first().inputValue(), '测试公司');
});

test('pressing inside a popup and releasing outside does not close it', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.topbar button.app-version').click();
  await drawer(page).waitFor();
  const box = await drawer(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(5, 450);
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(await drawer(page).count(), 1);
});

test('pressing outside and releasing inside a popup does not close it', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.topbar button.app-version').click();
  await drawer(page).waitFor();
  const box = await drawer(page).boundingBox();
  await page.mouse.move(5, 450);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(await drawer(page).count(), 1);
});
