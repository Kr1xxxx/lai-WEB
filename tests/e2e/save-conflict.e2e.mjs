// A save that meets a version conflict (another window saved first): the page re-applies its change when the
// records it touched did not change elsewhere, and otherwise keeps the typed text and says which customer changed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const NAME = 'Northwind Lash Studio', OTHER = 'Bluebell Beauty Supply';

// Another window saves first: a full save through the same local service, made from inside the page.
async function saveElsewhere(app, name, note) {
  const status = await app.page.evaluate(async ({ name, note }) => {
    const snapshot = await (await fetch('/api/data', { cache: 'no-store' })).json();
    snapshot.data.customers[name] = { ...snapshot.data.customers[name], remark: note };
    const response = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: snapshot, baseRevision: snapshot.revision }) });
    return response.status;
  }, { name, note });
  assert.equal(status, 200);
}
async function openActivity(app) {
  const { page } = app;
  await page.locator('tbody tr', { hasText: NAME }).getByText(NAME).first().click();
  await page.locator('.lcd-root').waitFor();
  await page.locator('.lcd-tabs [data-tab="activity"]').click();
}
const texts = async (app) => (await app.readData()).customers[NAME].history.map((item) => item.text);
// The page's own 409 is expected here; every other failed request is still an error.
const unexpected = (app) => app.errors.filter((line) => !/^HTTP 409: .*\/api\/save-changes$/.test(line));

test('a change to another customer elsewhere does not stop the save: both are kept', async () => {
  const app = await startApp();
  try {
    await app.open('customers');
    await openActivity(app);
    await saveElsewhere(app, OTHER, '别处的修改');
    const responses = [];
    app.page.on('response', (response) => { if (response.url().endsWith('/api/save-changes')) responses.push(response.status()); });
    await app.page.locator('#followup-text').fill('冲突后自动重试');
    await app.page.locator('#followup-form button[type=submit]').click();
    await app.page.getByText('已保存跟进').first().waitFor();
    assert.deepEqual(responses, [409, 200], 'one conflict, then one retry');
    const data = await app.readData();
    assert.ok(data.customers[NAME].history.some((item) => item.text === '冲突后自动重试'));
    assert.equal(data.customers[OTHER].remark, '别处的修改', 'the other window\'s change is not overwritten');
    assert.deepEqual(unexpected(app), []);
  } finally { await app.close(); }
});

test('the same customer changed elsewhere: the typed text stays, the page names the customer, nothing is overwritten', async () => {
  const app = await startApp();
  try {
    await app.open('customers');
    await openActivity(app);
    await saveElsewhere(app, NAME, '别处改了这位客户');
    await app.page.locator('#followup-text').fill('我写的跟进');
    await app.page.locator('#followup-form button[type=submit]').click();
    const message = app.page.locator('#followup-form [role=alert], #followup-form .error').filter({ hasText: `客户「${NAME}」刚在别处改过` }).first();
    await message.waitFor();
    assert.match(await message.textContent(), /你的修改还没有保存/);
    assert.equal(await app.page.locator('#followup-text').inputValue(), '我写的跟进', 'the typed text is still there');
    let data = await app.readData();
    assert.equal(data.customers[NAME].remark, '别处改了这位客户');
    assert.equal((await texts(app)).includes('我写的跟进'), false);
    await app.page.screenshot({ path: process.env.LAI_E2E_SHOTS ? `${process.env.LAI_E2E_SHOTS}/save-conflict.png` : undefined }).catch(() => {});
    // Saving again now works on top of the newest data and keeps the other change.
    await app.page.locator('#followup-form button[type=submit]').click();
    await app.page.getByText('已保存跟进').first().waitFor();
    data = await app.readData();
    assert.equal(data.customers[NAME].remark, '别处改了这位客户');
    assert.ok((await texts(app)).includes('我写的跟进'));
    assert.deepEqual(unexpected(app), []);
  } finally { await app.close(); }
});
