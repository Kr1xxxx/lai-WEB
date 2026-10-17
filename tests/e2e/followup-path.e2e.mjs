// 写跟进 in one click: the workbench 写跟进 opens the customer on 动态 with the follow-up box open and the cursor in
// it; saving clears and closes the box, puts the new record on top, says 已保存跟进 and keeps the focus on the page.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const NAME = 'Bluebell Beauty Supply';
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

let app;
before(async () => {
  app = await startApp();
  await app.open('customers');
  const ctx = app.page.context().request;
  const state = await (await ctx.get(app.base + '/api/data')).json();
  state.data.customers[NAME] = {
    ...state.data.customers[NAME], nextFollow: today,
    history: [{ type: 'followup', subtype: 'quick', time: '2026-01-05 09:00:00', text: '电话沟通，客户确认下周打款。' }],
  };
  const res = await ctx.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
});
after(async () => { await app?.close(); });

const settle = (ms = 300) => app.page.waitForTimeout(ms);
// No mailbox is bound in the test data dir, so the workbench's mail requests answer 409; that is not a page error.
const pageErrors = () => app.errors.filter((e) => !/HTTP 409: .*\/api\/mail/.test(e));
const shots = (name) => process.env.LAI_SHOTS && app.page.screenshot({ path: `${process.env.LAI_SHOTS}/${name}.png` });
const active = () => app.page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id || '', action: document.activeElement?.dataset?.action || '' }));

test('a customer opened from the list starts on 动态', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('tbody tr', { hasText: 'Lumen Lash Lab' }).locator('.company-link').first().click();
  await page.locator('.lcd-root').waitFor();
  assert.equal(await page.locator('.lcd-tabs button.active').getAttribute('data-tab'), 'activity');
  assert.equal(await page.locator('#followup-form').count(), 1);
  assert.deepEqual(pageErrors(), []);
});

test('workbench 写跟进 → 动态 with the box focused; type, save, the record is on top and focus stays on the page', async () => {
  const { page } = app;
  await app.open('dashboard');
  const act = page.locator(`.wb-act[data-biz-followup][data-biz-customer="${NAME}"]`);
  await act.waitFor();
  assert.equal((await act.innerText()).trim(), '写跟进');
  await act.click();
  await page.locator('.lcd-root').waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'followup-text', null, { timeout: 5000 });
  assert.equal(await page.locator('.lcd-tabs button.active').getAttribute('data-tab'), 'activity');
  // The box is open: its footer with 保存跟进 is shown.
  assert.equal(await page.locator('#followup-form .lcd-followup-footer').isVisible(), true);
  await shots('followup-path-open');

  const text = '已寄出样品，等客户反馈颜色。';
  await page.keyboard.type(text);
  await page.locator('#followup-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === '已保存跟进', null, { timeout: 5000 });
  await settle(300);
  const saved = (await app.readData()).customers[NAME].history;
  assert.ok(saved.some((h) => h.text === text), 'stored by the backend');
  // The new record is the first one in the timeline.
  const first = page.locator('#activity-results .lcd-timeline article').first();
  assert.match(await first.innerText(), new RegExp(text));
  // The box is cleared and closed; the cursor is back on 写跟进, not lost on the page.
  assert.equal(await page.locator('#followup-text').inputValue(), '');
  const at = await active();
  assert.notEqual(at.tag, 'BODY');
  assert.equal(at.action, 'write-followup');
  assert.equal(await page.locator('#followup-form .lcd-followup-footer').isVisible(), false);
  await shots('followup-path-saved');
  assert.deepEqual(pageErrors(), []);
});

test('an empty follow-up is refused with a Chinese message and the cursor stays in the box', async () => {
  const { page } = app;
  await page.locator('.lcd-followup-label [data-action="write-followup"]').click();
  await page.waitForFunction(() => document.activeElement?.id === 'followup-text');
  const before = (await app.readData()).customers[NAME].history.length;
  await page.locator('#followup-form button[type="submit"]').click();
  await page.locator('#followup-error.visible').waitFor();
  assert.equal(await page.locator('#followup-error').innerText(), '请填写跟进内容');
  assert.equal((await active()).id, 'followup-text');
  assert.equal((await app.readData()).customers[NAME].history.length, before);
  assert.deepEqual(pageErrors(), []);
});
