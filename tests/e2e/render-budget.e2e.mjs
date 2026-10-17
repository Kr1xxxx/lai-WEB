// Render budget: the page frame (topbar, left rail, sub-navigation) is drawn once and stays; switching pages and
// re-drawing a page only replace what is inside <main>. Focus stays where the user was after a tick, a filter
// change or Enter in the quick search, and typing in the order search only redraws the order rows.
// Test data: docs/samples customers plus invented orders (RB-…).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp, sampleCustomers } from './harness.mjs';

let app;
const CUSTOMERS = Object.keys(sampleCustomers());
const ORDERS = Array.from({ length: 30 }, (_, i) => ({
  id: `rb-${i}`, num: `RB-${String(i + 1).padStart(3, '0')}`, client: CUSTOMERS[i % CUSTOMERS.length], country: '美国',
  createdAt: '2026-09-01', orderMonth: '2026-09', currency: 'USD', stage: 'quote', amount: 1000 + i, paidAmount: 0, isDraft: false, owner: 'Kris',
}));

before(async () => {
  app = await startApp();
  const state = await (await app.api('/api/data')).json();
  state.data.orders = [...(state.data.orders || []), ...ORDERS];
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, 'seeding orders');
  await app.open('customers');
  await app.page.locator('.customer-table tbody tr').first().waitFor();
});
after(async () => { await app?.close(); });
// No mailbox is bound in the test data dir, so the mail requests (the 工作台 mail card) answer 409; that is not a page error.
const pageErrors = (target = app) => target.errors.filter((e) => !/HTTP 409: .*\/api\/mail/.test(e));

// Watches #app: records every removed child and remembers the frame elements as they are now.
async function watchApp(page) {
  await page.evaluate(() => {
    const app = document.getElementById('app');
    window.__removed = [];
    window.__frame = {
      topbar: document.querySelector('#app > header.topbar'),
      rail: document.querySelector('#app > nav.rail'),
      subnav: document.querySelector('#app > #app-subnav'),
      main: document.querySelector('#app > main.main'),
    };
    window.__observer?.disconnect();
    window.__observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.removedNodes) window.__removed.push(node.nodeType === 1 ? `${node.tagName.toLowerCase()}.${node.className}` : '#text');
    });
    window.__observer.observe(app, { childList: true });
  });
}
const frameState = (page) => page.evaluate(() => ({
  removedFrame: window.__removed.filter((name) => /^(header\.topbar|nav\.rail|aside\.subnav|main\.main)/.test(name)),
  same: Object.fromEntries(Object.entries(window.__frame).map(([key, el]) => [key, el === document.querySelector({ topbar: '#app > header.topbar', rail: '#app > nav.rail', subnav: '#app > #app-subnav', main: '#app > main.main' }[key])])),
}));
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName, id: el.id, select: el.dataset?.select ?? null, trigger: el.classList.contains('lai-select-trigger') ? el.previousElementSibling?.id : null } : null;
});
// Event listeners bound directly on the frame elements (not through document): with the frame kept, a page that
// binds a listener on every draw would pile them up, so the total must not grow with navigation.
async function frameListeners(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const n = await page.evaluate(() => {
      window.__frameEls = [...document.querySelectorAll('#app > header.topbar, #app > header.topbar *, #app > nav.rail, #app > nav.rail *, #app > #app-subnav, #app > #app-subnav *')];
      return window.__frameEls.length;
    });
    let total = 0;
    for (let i = 0; i < n; i++) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__frameEls[${i}]` });
      total += (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length;
    }
    return total;
  } finally {
    await cdp.detach();
  }
}

test('switching pages from the left rail keeps the topbar, rail and sub-navigation elements', async () => {
  const { page } = app;
  const listenersAtStart = await frameListeners(page);
  await watchApp(page);
  const visits = [
    ['.rail-item[data-lai-route="dashboard"]', '#dashboard'],
    ['.rail-item[data-lai-route="order-list"]', '#order-list'],
    ['.rail-item[data-lai-route="opportunities"]', '#opportunities'],
    ['.rail-item[data-rail-menu="客户"]', '#customers'],
  ];
  for (const [selector, hash] of visits) {
    await page.locator(selector).click();
    await page.waitForFunction((h) => location.hash === h, hash);
    await page.waitForTimeout(200);
    const state = await frameState(page);
    assert.deepEqual(state.removedFrame, [], `${hash}: no frame element removed`);
    assert.deepEqual(state.same, { topbar: true, rail: true, subnav: true, main: true }, `${hash}: the same frame elements`);
    // The rail highlight and the sub-navigation follow the page.
    assert.equal(await page.locator('.rail-item.active').count(), 1, `${hash}: one highlighted rail entry`);
  }
  assert.equal(await page.locator('#app-subnav').isHidden(), false, 'customers show the sub-navigation');
  await page.locator('.rail-item[data-lai-route="dashboard"]').click();
  await page.waitForFunction(() => document.querySelector('#app-subnav').hidden);
  assert.equal(await page.locator('main.main.customer-main').count(), 0, 'customer-main is only on the customer pages');
  await page.locator('.rail-item[data-rail-menu="客户"]').click();
  await page.locator('main.main.customer-main .customer-table').waitFor();
  assert.equal(await page.locator('#app > .subnav-restore').count(), 1, 'the customer pages keep their expand button');
  assert.deepEqual((await frameState(page)).same, { topbar: true, rail: true, subnav: true, main: true });
  for (const selector of ['.rail-item[data-lai-route="mail"]', '.rail-item[data-lai-route="order-list"]', '.rail-item[data-rail-menu="客户"]']) {
    await page.locator(selector).click();
    await page.waitForTimeout(300);
  }
  await page.locator('main.main.customer-main .customer-table').waitFor();
  assert.equal(await frameListeners(page), listenersAtStart, 'no listeners piled up on the kept frame elements');
  assert.deepEqual(pageErrors(), []);
});

test('ticking a customer, changing a filter and Enter in the quick search keep the focus there', async () => {
  const { page } = app;
  await page.locator('.customer-table tbody tr').first().waitFor();
  await watchApp(page);
  const second = page.locator('.customer-table tbody tr:nth-child(2) input[type=checkbox]');
  const name = await second.getAttribute('data-select');
  await second.click();
  await page.waitForTimeout(100);
  assert.deepEqual(await focused(page), { tag: 'INPUT', id: '', select: name, trigger: null }, 'focus stays on the ticked checkbox');
  assert.equal(await page.locator(`.customer-table input[data-select="${name}"]`).isChecked(), true);
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  assert.equal(await page.locator(`.customer-table input[data-select="${name}"]`).isChecked(), false, 'Space on the kept focus unticks it again');
  assert.deepEqual(await focused(page), { tag: 'INPUT', id: '', select: name, trigger: null });

  const search = page.locator('#search');
  await search.fill(CUSTOMERS[3].slice(0, 5));
  await search.press('Enter');
  await page.waitForTimeout(100);
  assert.deepEqual(await focused(page), { tag: 'INPUT', id: 'search', select: null, trigger: null }, 'focus stays in the quick search after Enter');
  assert.equal(await page.locator('#search').inputValue(), CUSTOMERS[3].slice(0, 5));
  assert.equal(await page.locator('.customer-table tbody tr').count(), 1, 'the list is filtered');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#search').inputValue(), CUSTOMERS[3].slice(0, 4), 'typing goes on in the same box');
  await page.locator('#search').fill('');
  await page.locator('#search').press('Enter');
  await page.locator('.customer-table tbody tr:nth-child(2)').waitFor();

  // A filter dropdown (page size): after choosing, focus is back on the dropdown.
  const pageSize = page.locator('#page-size + .lai-select-trigger');
  assert.equal(await pageSize.count(), 1, 'the page-size dropdown is there');
  {
    await pageSize.click();
    await page.locator('.lai-select-menu .lai-select-option').nth(1).click();
    await page.waitForTimeout(100);
    assert.deepEqual(await focused(page), { tag: 'BUTTON', id: (await focused(page)).id, select: null, trigger: 'page-size' }, 'focus is back on the page-size dropdown');
  }
  const state = await frameState(page);
  assert.deepEqual(state.removedFrame, [], 'no frame element removed');
  assert.deepEqual(state.same, { topbar: true, rail: true, subnav: true, main: true });
  assert.deepEqual(pageErrors(), []);
});

test('typing in the order search redraws only the rows: no dropped characters, the caret stays', async () => {
  const { page } = app;
  await page.locator('.rail-item[data-lai-route="order-list"]').click();
  await page.locator('#biz-search').waitFor();
  await watchApp(page);
  await page.evaluate(() => {
    window.__wrapper = document.querySelector('main.main > .op-page, main.main > .pagebar');
    window.__mainChanges = 0;
    new MutationObserver((records) => { window.__mainChanges += records.filter((r) => r.removedNodes.length).length; }).observe(document.querySelector('main.main'), { childList: true });
    window.__input = document.getElementById('biz-search');
  });
  assert.equal(await page.locator('[data-order-row]').count(), 20, 'first page of 30 orders');
  const text = CUSTOMERS[3].slice(0, 12);
  assert.equal(text.length, 12);
  await page.locator('#biz-search').click();
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    sameInput: window.__input === document.getElementById('biz-search'),
    focus: document.activeElement === window.__input,
    value: window.__input.value,
    caret: window.__input.selectionStart,
    sameWrapper: window.__wrapper === document.querySelector('main.main > .op-page, main.main > .pagebar'),
    mainChanges: window.__mainChanges,
  }));
  assert.deepEqual(after, { sameInput: true, focus: true, value: text, caret: 12, sameWrapper: true, mainChanges: 0 });
  const expected = ORDERS.filter((o) => o.client.toLowerCase().includes(text.toLowerCase())).length;
  assert.ok(expected > 0 && expected < 20);
  assert.equal(await page.locator('[data-order-row]').count(), expected, 'the table shows only the matching orders');
  for (const client of await page.locator('[data-order-row] [data-biz-customer]').allInnerTexts()) assert.equal(client, CUSTOMERS[3]);
  assert.match(await page.locator('.op-foot').innerText(), new RegExp(`共 ${expected} 笔订单`));
  // Typing in the middle keeps the caret where it was.
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('x', { delay: 30 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#biz-search').evaluate((el) => [el.value, el.selectionStart].join('|')), `${text[0]}x${text.slice(1)}|2`);
  assert.equal(await page.locator('[data-order-row]').count(), 0);
  assert.match(await page.locator('.op-list').innerText(), /没有符合条件的订单/);
  await page.locator('#biz-search').fill('');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-order-row]').count(), 20);
  const state = await frameState(page);
  assert.deepEqual(state.removedFrame, [], 'neither #app nor main was replaced while typing');
  assert.deepEqual(state.same, { topbar: true, rail: true, subnav: true, main: true });
  assert.deepEqual(pageErrors(), []);
});

test('小满 colours (classic skin): a theme change redraws the frame once, then the order search redraws only the table rows', async () => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="设置"]').click();
  await page.locator('[data-biz-action="set-theme"][data-theme-id="xiaoman"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.skin === 'classic');
  await watchApp(page);
  await page.locator('.rail-item[data-lai-route="order-list"]').click();
  await page.locator('#biz-order-scroll tbody').waitFor();
  assert.equal((await frameState(page)).same.rail, false, 'the theme change redraws the whole frame once');
  await watchApp(page);
  await page.evaluate(() => {
    window.__mainChanges = 0;
    new MutationObserver((records) => { window.__mainChanges += records.filter((r) => r.removedNodes.length).length; }).observe(document.querySelector('main.main'), { childList: true });
    window.__input = document.getElementById('biz-search');
  });
  assert.equal(await page.locator('#biz-order-scroll tbody tr').count(), 20);
  const text = CUSTOMERS[1].slice(0, 8);
  await page.locator('#biz-search').click();
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(400);
  const expected = ORDERS.filter((o) => o.client.includes(text)).length;
  assert.equal(await page.locator('#biz-order-scroll tbody tr').count(), expected);
  assert.match(await page.locator('footer.pagination').innerText(), new RegExp(`共 ${expected} 笔订单`));
  assert.deepEqual(await page.evaluate(() => ({ same: window.__input === document.getElementById('biz-search'), focus: document.activeElement === window.__input, value: window.__input.value, mainChanges: window.__mainChanges })), { same: true, focus: true, value: text, mainChanges: 0 });
  await page.locator('#biz-search').fill('zzz-none');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#biz-order-scroll tbody tr').count(), 0);
  assert.equal(await page.locator('#biz-order-scroll > .empty').count(), 1, 'one empty-state note');
  await page.locator('#biz-search').fill('');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#biz-order-scroll > .empty').count(), 0);
  assert.equal(await page.locator('#biz-order-scroll tbody tr').count(), 20);
  const state = await frameState(page);
  assert.deepEqual(state.removedFrame, []);
  assert.deepEqual(state.same, { topbar: true, rail: true, subnav: true, main: true });
  assert.deepEqual(pageErrors(), []);
});
