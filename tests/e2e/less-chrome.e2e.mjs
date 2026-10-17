// Less chrome, more table:
// - menus with three or fewer entries (线索, 商机 …) hide the sub-navigation column and show their entries as tabs
//   in the page header, reachable with the keyboard and marked with aria-current;
// - customers and mail keep their sub-navigation;
// - under 1366px the customer group tree (客群) starts collapsed, so at 1280x800 the table shows 7+ columns;
//   the user's own open/close choice is remembered.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

// No mailbox is set up in the test data, so the mail page's own 409 is expected.
const unexpectedErrors = () => app.errors.filter((error) => !/HTTP 409: .*\/api\/mail\//.test(error));
const tabs = () => app.page.locator('#app > main.main :is(.pagebar, .k-pageheader) .section-tabs .section-tab');
const tabState = () => tabs().evaluateAll((els) => els.map((el) => [el.textContent.trim(), el.getAttribute('aria-current')]));
const subnavHidden = () => app.page.locator('#app-subnav').evaluate((el) => el.hidden && getComputedStyle(el).display === 'none');

test('线索 and 商机 hide the sub-navigation column; their entries are header tabs that work with mouse and keyboard', async () => {
  const { page } = app;
  await app.open('customers');
  assert.equal(await subnavHidden(), false, 'customers keep their sub-navigation');

  await page.locator('.rail-item[data-rail-menu="线索"]').click();
  await page.waitForFunction(() => location.hash === '#leads');
  assert.equal(await subnavHidden(), true, '线索: no sub-navigation column');
  assert.deepEqual(await tabState(), [['线索列表', 'page'], ['线索回收站', null]]);
  assert.equal(await page.locator('.section-tabs').getAttribute('aria-label'), '线索');
  await tabs().nth(1).click();
  await page.waitForFunction(() => location.hash === '#lead-trash');
  assert.deepEqual(await tabState(), [['线索列表', null], ['线索回收站', 'page']]);
  // Keyboard: Tab reaches the tabs, Enter opens one.
  await tabs().nth(0).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash === '#leads');
  assert.deepEqual(await tabState(), [['线索列表', 'page'], ['线索回收站', null]]);

  await page.locator('.rail-item[data-rail-menu="商机"]').click();
  await page.locator('.opp-page').waitFor();
  assert.equal(await subnavHidden(), true, '商机: no sub-navigation column');
  assert.deepEqual(await tabState(), [['商机看板', 'page'], ['商机分析', null], ['商机设置', null]]);
  await tabs().nth(2).focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => location.hash === '#opp-flows');
  assert.deepEqual(await tabState(), [['商机看板', null], ['商机分析', null], ['商机设置', 'page']]);
  // The main area starts right after the rail when the column is hidden.
  const rail = await page.locator('#app > nav.rail').boundingBox();
  const main = await page.locator('#app > main.main').boundingBox();
  assert.ok(main.x - (rail.x + rail.width) < 24, `main starts next to the rail (gap ${main.x - rail.x - rail.width}px)`);

  // Mail and a menu with more entries (交易) keep the column; the dashboard has neither column nor tabs.
  await page.locator('.rail-item[data-rail-menu="交易"]').click();
  await page.waitForFunction(() => location.hash === '#order-list');
  assert.equal(await subnavHidden(), false, '交易 keeps its sub-navigation');
  assert.equal(await page.locator('.section-tabs').count(), 0);
  await page.locator('.rail-item[data-lai-route="mail"]').click();
  await page.waitForFunction(() => location.hash.startsWith('#mail'));
  assert.equal(await subnavHidden(), false, 'mail keeps its folders');
  await page.locator('.rail-item[data-lai-route="dashboard"]').click();
  await page.waitForFunction(() => location.hash === '#dashboard');
  assert.equal(await subnavHidden(), true);
  assert.equal(await page.locator('.section-tabs').count(), 0, 'one entry: no tabs');
  assert.deepEqual(unexpectedErrors(), []);
});

// Columns whose header is fully visible inside the table area (the checkbox and 操作 columns count).
const visibleColumns = () => app.page.evaluate(() => {
  const wrap = document.querySelector('main.main .table-wrap').getBoundingClientRect();
  return [...document.querySelectorAll('main.main .table-wrap thead th')].filter((th) => {
    const box = th.getBoundingClientRect();
    return box.width > 0 && box.left >= wrap.left - 1 && box.right <= wrap.right + 1;
  }).length;
});
const groupsCollapsed = () => app.page.locator('main.main .panel').evaluate((el) => el.classList.contains('groups-collapsed'));
async function openCustomers(width, height) {
  await app.page.setViewportSize({ width, height });
  await app.open('customers');
  await app.page.locator('main.main.customer-main .customer-table').waitFor();
}

test('at 1280x800 the group tree starts collapsed and the customer table shows at least 7 columns; the choice is remembered', async () => {
  const { page } = app;
  await page.evaluate(() => localStorage.removeItem('lai.customerGroupsCollapsed'));
  await openCustomers(1280, 800);
  assert.equal(await groupsCollapsed(), true, 'collapsed by default under 1366px');
  const toggle = page.locator('button[data-action="collapse-groups"]');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  const columns = await visibleColumns();
  assert.ok(columns >= 7, `7 or more visible columns at 1280 (got ${columns})`);

  // Open it: it stays open after a reload.
  await toggle.click();
  assert.equal(await groupsCollapsed(), false);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await openCustomers(1280, 800);
  assert.equal(await groupsCollapsed(), false, 'the user opened it: it stays open');

  // Close it with the keyboard: it stays closed, even in a wide window.
  await page.locator('button[data-action="collapse-groups"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await groupsCollapsed(), true);
  await openCustomers(1440, 900);
  assert.equal(await groupsCollapsed(), true, 'the user closed it: it stays closed at 1440');

  // Without a saved choice, a wide window starts with the tree open.
  await page.evaluate(() => localStorage.removeItem('lai.customerGroupsCollapsed'));
  await openCustomers(1440, 900);
  assert.equal(await groupsCollapsed(), false, 'open by default at 1440');
  assert.deepEqual(unexpectedErrors(), []);
});
