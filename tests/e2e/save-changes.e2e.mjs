// Saving sends only the changes (D-019), and falls back to the full save when the changes route is unavailable.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

async function addFollowup(app, text) {
  const { page } = app;
  await page.locator('tbody tr', { hasText: 'Northwind Lash Studio' }).getByText('Northwind Lash Studio').first().click();
  await page.locator('.lcd-root').waitFor();
  await page.locator('.lcd-tabs [data-tab="activity"]').click();
  await page.locator('#followup-text').fill(text);
  await page.locator('#followup-form button[type=submit]').click();
  await page.getByText('已保存到来财').first().waitFor();
}
const noteTexts = async (app) => (await app.readData()).customers['Northwind Lash Studio'].history.map((item) => item.text);

test('a follow-up is saved through the changes route, with a small body', async () => {
  const app = await startApp();
  try {
    const posts = [];
    app.page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/api/save')) posts.push({ url: new URL(request.url()).pathname, bytes: (request.postData() || '').length }); });
    await app.open('customers');
    await addFollowup(app, '只传改动：第一条');
    assert.deepEqual(posts.map((p) => p.url), ['/api/save-changes']);
    assert.ok(posts[0].bytes < 20000, `body was ${posts[0].bytes} bytes`);
    assert.ok((await noteTexts(app)).includes('只传改动：第一条'));
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('when the changes route fails, the full save is used and nothing is lost', async () => {
  const app = await startApp();
  try {
    await app.open('customers');
    await app.page.route('**/api/save-changes', (route) => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'verification failed' }) }));
    const posts = [];
    app.page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/api/save')) posts.push(new URL(request.url()).pathname); });
    await addFollowup(app, '退回整包保存');
    assert.deepEqual(posts, ['/api/save-changes', '/api/save']);
    assert.ok((await noteTexts(app)).includes('退回整包保存'));
  } finally { await app.close(); }
});
