// 设置 → 本地数据: back up, change the data, restore the backup (two clicks), then restore the automatic
// before-restore backup to get the change back. Real backend, real page, lai-test-* data directory.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const PROBE = 'Restore Probe Trading Co';
let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

async function addCustomer(name) {
  const request = app.page.context().request;
  const loaded = await (await request.get(app.base + '/api/data')).json();
  loaded.data.customers[name] = { client: name, country: 'US', owner: '', contact: 'Probe', email: 'probe@example.com', phone: '', history: [] };
  const res = await request.post(app.base + '/api/save', { data: { state: loaded, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
}
const rows = () => app.page.locator('#biz-restore-list .restore-row');
async function restoreRow(row) {
  const { page } = app;
  await row.getByRole('button', { name: /^恢复到 / }).click();
  const confirm = row.getByRole('button', { name: '确认恢复到这一份' });
  await confirm.waitFor();
  assert.match(await row.innerText(), /现在的数据会先自动备份一份，然后换成这份备份里的数据/);
  assert.equal(await confirm.evaluate((el) => el === document.activeElement), true, 'focus moves to the confirm button');
  await Promise.all([page.waitForEvent('load'), confirm.click()]);
  await page.waitForLoadState('networkidle');
  await page.locator('#biz-backup-status', { hasText: /^已恢复到 .+ 的备份，原来的数据已另存一份$/ }).waitFor();
  await page.getByText(/已恢复到 .+ 的备份，原来的数据已另存一份/).first().waitFor();
}

test('back up, restore it, and restore the before-restore backup', async () => {
  const { page } = app;
  await app.open('settings');
  // The list is loaded (the seed save may already have an automatic backup queued 2 s after it).
  await page.locator('#biz-restore-list :is(.restore-list, .k-empty)').first().waitFor();

  await page.getByRole('button', { name: '立即备份' }).click();
  await rows().filter({ hasText: '手动备份' }).waitFor();
  const initialRows = await rows().count();
  const manualText = await rows().first().innerText();
  assert.match(manualText, /\d+月\d+日 \d{2}:\d{2}/);
  assert.match(manualText, /手动备份/);
  const before = await app.readData();
  const sampleCount = Object.keys(before.customers).length;
  assert.match(manualText, new RegExp(`客户 ${sampleCount} · 订单 0`));

  await addCustomer(PROBE);
  await app.open('settings');
  assert.ok((await app.readData()).customers[PROBE]);

  // Cancel first: nothing happens.
  await rows().first().getByRole('button', { name: /^恢复到 / }).click();
  await page.getByRole('button', { name: '取消恢复' }).click();
  await rows().first().getByRole('button', { name: /^恢复到 / }).waitFor();
  assert.ok((await app.readData()).customers[PROBE]);

  await restoreRow(rows().filter({ hasText: '手动备份' }));
  assert.equal((await app.readData()).customers[PROBE], undefined, 'the customer added after the backup is gone');
  await rows().nth(initialRows).waitFor();
  assert.ok(await rows().count() >= initialRows + 1);
  assert.match(await rows().first().innerText(), /恢复前自动备份/);
  assert.match(await rows().first().innerText(), new RegExp(`客户 ${sampleCount + 1} · 订单 0`));

  // The page was reloaded from /api/data and holds the new revision: a save made right here goes through
  // (a stale revision would answer 409, which the harness records as an error).
  await page.locator('[data-biz-action="set-theme"][data-theme-id="tech"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'tech');
  await page.waitForTimeout(800);
  const afterTheme = await app.readData();
  assert.equal(afterTheme.laiSettings?.theme, 'tech');
  assert.equal(afterTheme.customers[PROBE], undefined);
  await app.open('customers');
  await page.getByText(Object.keys(before.customers)[0]).first().waitFor();
  assert.equal(await page.getByText(PROBE).count(), 0, 'the customer list no longer shows the probe');

  await app.open('settings');
  await restoreRow(rows().filter({ hasText: '恢复前自动备份' }));
  assert.ok((await app.readData()).customers[PROBE], 'restoring the before-restore backup brings the customer back');
  await rows().filter({ hasText: '恢复前自动备份' }).nth(1).waitFor();
  assert.equal(await rows().filter({ hasText: '恢复前自动备份' }).count(), 2);
  await app.open('customers');
  await page.getByText(PROBE).first().waitFor();

  assert.deepEqual(app.errors, []);
});
