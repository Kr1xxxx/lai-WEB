// Browser end-to-end walkthroughs for the features in docs/features.json that had no browser check yet:
// customer edit, follow-ups, segments, pool/duplicates, customer tools, workbench, calendar, business stats,
// team targets and backup. Each test starts its own backend with the sample customers (docs/samples).
// Set LAI_SHOT_DIR to also write 1440×900 screenshots.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

async function run(fn, { hash = 'customers', seed = true } = {}) {
  const app = await startApp({ seed });
  try {
    await app.open(hash);
    await fn(app);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
}
const shot = async (app, file) => {
  if (!process.env.LAI_SHOT_DIR) return;
  await app.page.waitForTimeout(500);
  await app.page.screenshot({ path: `${process.env.LAI_SHOT_DIR}/${file}.png` });
};
async function until(app, check, what) {
  for (let i = 0; i < 80; i++) {
    if (check(await app.readData())) return;
    await app.page.waitForTimeout(100);
  }
  assert.fail('timed out waiting for ' + what);
}
/** Changes saved data through the real save route; `fn` gets the data and returns the new data. */
async function seedData(app, fn) {
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  state.data = fn(state.data) ?? state.data;
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
}
const reload = async (app) => { await app.page.reload(); await app.page.waitForLoadState('networkidle'); await app.page.waitForTimeout(300); };
const gotoCustomer = async (app, name) => {
  await app.page.goto(`${app.base}/trade-order-system.html?customer=${encodeURIComponent(name)}#customers`);
  await app.page.locator('.lcd-root').waitFor();
};
const subnav = (app, label) => app.page.locator(`.subnav .nav-row:has(.nav-label:text-is("${label}"))`);

test('customer-edit: website and a contact phone are changed, nothing else is lost after a reload', async () => {
  await run(async (app) => {
    const { page } = app;
    await seedData(app, (data) => {
      data.customers['Northwind Lash Studio'].legacyNote = 'kept-by-test';
      return data;
    });
    await gotoCustomer(app, 'Northwind Lash Studio');
    const before = (await app.readData()).customers['Northwind Lash Studio'];
    await page.locator('.lcd-pill', { hasText: '编辑' }).first().click();
    await page.locator('#ce-name').waitFor();
    await page.locator('#ce-website').fill('https://northwindlash.example');
    await page.locator('#ce-phone-0').fill('2125550188');
    await shot(app, 'customer-edit');
    await page.getByRole('button', { name: '确 定' }).click();
    await until(app, (d) => d.customers['Northwind Lash Studio'].website === 'https://northwindlash.example', 'website saved');
    await reload(app);
    const after = (await app.readData()).customers['Northwind Lash Studio'];
    assert.equal(after.website, 'https://northwindlash.example');
    assert.ok(JSON.stringify(after).includes('2125550188'), 'new phone saved');
    assert.equal(after.legacyNote, 'kept-by-test', 'unknown old field kept');
    assert.equal(after.country, before.country);
    assert.equal(after.email, before.email);
    assert.equal(after.contact, before.contact);
    assert.equal(Object.keys(await app.readData().then((d) => d.customers)).length, 4);
  });
});

test('followups: a written follow-up shows in 动态 and the follow-up date shows in detail and list', async () => {
  await run(async (app) => {
    const { page } = app;
    await gotoCustomer(app, 'Northwind Lash Studio');
    await page.locator('.lcd-tabs [data-tab="activity"]').click();
    const text = '电话沟通了新款睫毛样品';
    await page.locator('#followup-text').fill(text);
    await page.locator('#followup-form button[type=submit]').click();
    await until(app, (d) => d.customers['Northwind Lash Studio'].history.length === 1, 'the follow-up saved');
    const saved = (await app.readData()).customers['Northwind Lash Studio'];
    assert.equal(saved.history[0].text ?? saved.history[0].content ?? saved.history[0].note, text);
    assert.ok(Math.abs(Date.now() - Date.parse(saved.lastFollowup)) < 60000, 'last follow-up date is now');
    await page.locator('.lcd-root').getByText(text).first().waitFor();
    await shot(app, 'followups-activity');
    // Detail: 资料 tab shows the 最近跟进时间 as today.
    await page.locator('.lcd-tabs [data-tab="info"]').click();
    const today = new Date().toLocaleDateString('sv');
    const detailText = await page.locator('.lcd-root').innerText();
    assert.ok(detailText.includes(today), 'detail shows today as the follow-up date');
    // List: the row of this customer carries today's date, the others do not.
    await reload(app);
    await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户列表"))').click();
    await page.locator('tbody tr').first().waitFor();
    const rowText = await page.locator('tbody tr', { hasText: 'Northwind Lash Studio' }).innerText();
    const other = await page.locator('tbody tr', { hasText: 'Lumen Lash Lab' }).innerText();
    assert.ok(rowText.includes(today), 'list row shows the new date: ' + rowText);
    assert.ok(!other.includes(today), 'other rows are unchanged');
    await shot(app, 'followups-list');
  });
});

test('segments: a country-rule segment and a manual group are created and their counts match the list', async () => {
  await run(async (app) => {
    const { page } = app;
    await page.locator('[data-action="new-segment"]').first().click();
    await page.locator('#segment-form').waitFor();
    await page.locator('#segment-form input[name="name"]').fill('美国重点客户');
    await page.locator('#segment-form [data-rule-prop="value"]').first().fill('美国');
    await page.locator('#match-preview', { hasText: '当前匹配 1 个客户' }).waitFor();
    await shot(app, 'segments-rule');
    await page.locator('button[form="segment-form"]').click();
    await until(app, (d) => JSON.stringify(d).includes('美国重点客户'), 'the segment saved');
    const row = page.locator('.group-row', { hasText: '美国重点客户' });
    await row.waitFor();
    assert.match(await row.innerText(), /1\s*$/, 'sidebar count');
    await row.click();
    await page.locator('.list-heading', { hasText: '美国重点客户' }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.locator('tbody tr', { hasText: 'Northwind Lash Studio' }).waitFor();
    assert.match(await page.locator('.pagination').innerText(), /共1条/);
    assert.match(await page.locator('.list-heading').innerText(), /1 个客户/);
    await shot(app, 'segments-filtered');
    // Manual group: create, add two selected customers, count follows.
    await page.locator('[data-action="new-manual"]').first().click();
    await page.locator('#segment-form').waitFor();
    await page.locator('#segment-form input[name="name"]').fill('样品组');
    await page.locator('button[form="segment-form"]').click();
    await page.locator('.group-row', { hasText: '样品组' }).waitFor();
    await page.locator('.group-row', { hasText: '全部客户' }).first().click();
    await page.locator('tbody tr', { hasText: 'Lumen Lash Lab' }).locator('input[data-select]').check();
    await page.locator('tbody tr', { hasText: 'Bluebell Beauty Supply' }).locator('input[data-select]').check();
    await page.locator('[data-action="add-members"]').first().click();
    await page.locator('#membership-form').waitFor();
    await page.locator('button[form="membership-form"]').click();
    const group = page.locator('.group-row', { hasText: '样品组' });
    await group.filter({ hasText: /2\s*$/ }).waitFor();
    await group.click();
    await page.locator('.list-heading', { hasText: '样品组' }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 2);
    assert.match(await page.locator('.pagination').innerText(), /共2条/);
    await shot(app, 'segments-manual');
  });
});

test('pool-trash-duplicates: a customer moves to 公海 and back, and 客户查重 lists two customers with one email', async () => {
  await run(async (app) => {
    const { page } = app;
    // Move Lumen to the pool from the list.
    await page.locator('tbody tr', { hasText: 'Lumen Lash Lab' }).locator('input[data-select]').check();
    await page.locator('[data-action="batch-more"]').first().click();
    await page.locator('[data-action="batch-pool"]').click();
    await page.locator('#confirm-transition').click();
    await page.locator('#confirm-transition').waitFor({ state: 'detached' });
    await until(app, (d) => d.customers['Lumen Lash Lab'].laiBucket === 'pool', 'moved to the pool');
    assert.equal(await page.locator('tbody tr', { hasText: 'Lumen Lash Lab' }).count(), 0, 'gone from the list');
    assert.equal(await page.locator('tbody tr').count(), 3);
    await subnav(app, '公海客户').click();
    await page.locator('.module-page').waitFor();
    await page.locator('.module-page tbody tr', { hasText: 'Lumen Lash Lab' }).waitFor();
    await shot(app, 'pool-with-customer');
    // Claim it back.
    await page.locator('.module-page tbody tr', { hasText: 'Lumen Lash Lab' }).locator('[data-customer-transition="active"]').click();
    await page.locator('#claim-form').waitFor();
    await page.locator('button[form="claim-form"]').click();
    await until(app, (d) => d.customers['Lumen Lash Lab'].laiBucket !== 'pool', 'claimed back');
    await subnav(app, '客户列表').click();
    await page.locator('tbody tr', { hasText: 'Lumen Lash Lab' }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 4);

    // Two new customers with one email show up in 客户查重.
    const addCustomer = async (name, email, phone) => {
      await page.getByRole('button', { name: '新建客户' }).first().click();
      await page.locator('#ce-name').fill(name);
      await page.locator('#ce-country').fill('美国');
      await page.getByRole('option', { name: '美国', exact: true }).click();
      await page.locator('#ce-source').fill('官网');
      await page.keyboard.press('Enter');
      await page.locator('#ce-contact-0').fill('Dana Reed');
      await page.locator('#ce-email-0').fill(email);
      await page.locator('#ce-phone-0').fill(phone);
      await page.getByRole('button', { name: '确 定' }).click();
      await until(app, (d) => d.customers[name], name + ' saved');
    };
    await addCustomer('Twin One Beauty', 'twin@sharedmail.example', '2125550201');
    await addCustomer('Twin Two Beauty', 'twin@sharedmail.example', '2125550202');
    await subnav(app, '客户查重').click();
    const card = page.locator('.duplicate-card');
    await card.first().waitFor();
    assert.equal(await card.count(), 1, 'only the shared email is a duplicate');
    const text = await card.first().innerText();
    assert.match(text, /twin@sharedmail\.example/);
    assert.match(text, /Twin One Beauty/);
    assert.match(text, /Twin Two Beauty/);
    assert.ok(!text.includes('Northwind'));
    await shot(app, 'duplicates');
  });
});

test('customer-tools: merge two customers, rename a tag, and bulk create customers', async () => {
  await run(async (app) => {
    const { page } = app;
    await seedData(app, (data) => {
      data.customers['Bluebell Beauty Supply'].tags = ['重点', '批发'];
      data.customers['Maple & Moss Cosmetics'].tags = ['重点'];
      data.customers['Maple & Moss Cosmetics'].history = [{ time: new Date().toISOString(), text: '旧的跟进记录' }];
      return data;
    });
    await reload(app);

    // Merge: keep Bluebell, Maple & Moss is folded into it.
    await page.locator('tbody tr', { hasText: 'Bluebell Beauty Supply' }).locator('input[data-select]').check();
    await page.locator('tbody tr', { hasText: 'Maple & Moss Cosmetics' }).locator('input[data-select]').check();
    await page.locator('[data-action="batch-more"]').first().click();
    await page.locator('[data-action="batch-merge"]').click();
    await page.locator('#merge-form').waitFor();
    await page.locator('#merge-form input[name="primary"][value="Bluebell Beauty Supply"]').check();
    await page.locator('#merge-preview', { hasText: '并入' }).waitFor();
    await shot(app, 'customer-tools-merge');
    await page.locator('button[form="merge-form"]').click();
    await until(app, (d) => !d.customers['Maple & Moss Cosmetics'], 'the merged customer removed');
    const merged = (await app.readData()).customers['Bluebell Beauty Supply'];
    assert.ok(merged, 'kept customer stays');
    assert.ok(JSON.stringify(merged.history).includes('旧的跟进记录'), 'follow-ups moved over');
    assert.ok(JSON.stringify(merged).includes('owen@maplemoss.example'), 'contact moved over');
    await page.locator('tbody tr').first().waitFor();
    assert.equal(await page.locator('tbody tr').count(), 3);

    // Tag manager: rename 重点 to 核心客户.
    await subnav(app, '客户设置').click();
    await page.locator('[data-action="tag-manager"]').first().click();
    const manager = page.locator('.tag-manager');
    await manager.waitFor();
    await manager.locator('.tag-row', { hasText: '重点' }).getByRole('button', { name: '改名' }).click();
    await manager.locator('.tag-rename-input').fill('核心客户');
    await shot(app, 'customer-tools-tags');
    await manager.getByRole('button', { name: '保存' }).click();
    await until(app, (d) => d.customers['Bluebell Beauty Supply'].tags.includes('核心客户'), 'tag renamed');
    assert.ok(!(await app.readData()).customers['Bluebell Beauty Supply'].tags.includes('重点'));
    assert.ok((await app.readData()).customers['Bluebell Beauty Supply'].tags.includes('批发'), 'other tags untouched');
    // The tag manager stays open after a rename; 完成 closes it.
    await manager.locator('.tag-row', { hasText: '核心客户' }).waitFor();
    await page.locator('#overlay-root').getByRole('button', { name: '完成' }).click();
    await manager.waitFor({ state: 'detached' });

    // Bulk create from pasted lines.
    await subnav(app, '客户列表').click();
    await page.locator('[data-action="create-menu"]').first().click();
    await page.locator('[data-action="batch-create"]').click();
    await page.locator('#batch-create-form').waitFor();
    await page.locator('#batch-create-form textarea[name="text"]').fill('Cedar Lash Co，Mia Chen，mia@cedarlash.example，+1 555 0161，美国\nDelta Brow GmbH，Jan Ruf，jan@deltabrow.example，+49 30 5550 0162，德国');
    await page.locator('button[form="batch-create-form"]').click();
    await until(app, (d) => d.customers['Cedar Lash Co'] && d.customers['Delta Brow GmbH'], 'bulk customers saved');
    const created = (await app.readData()).customers['Cedar Lash Co'];
    assert.equal(created.country, '美国');
    assert.equal(created.email, 'mia@cedarlash.example');
    await page.locator('#batch-create-result', { hasText: '已建档 2 位' }).waitFor();
    // Once the list is empty, 完成 is a plain close button (the emptied textarea is no longer required).
    await page.locator('button[data-action="close-modal"]', { hasText: '完成' }).click();
    await page.locator('#batch-create-form').waitFor({ state: 'detached' });
    await subnav(app, '客户列表').click();
    await page.locator('tbody tr', { hasText: 'Delta Brow GmbH' }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 5);
    await shot(app, 'customer-tools-bulk');
  });
});

// ---- orders, tasks, stats and team data (the order form itself is walked here only to feed the pages under test) ----
const rail = (app, label) => app.page.locator('.rail-item', { hasText: label }).first().click();
const goTo = async (app, label, entry) => {
  await rail(app, label);
  if (entry) await subnav(app, entry).click();
  await app.page.waitForTimeout(500);
};
const pageText = async (app) => (await app.page.locator('#app > *:not(.rail):not(.subnav)').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
async function createOrder(app, o) {
  const { page } = app;
  await goTo(app, '交易');
  await page.getByRole('button', { name: /新建订单/ }).first().click();
  const form = page.locator('#biz-order-form');
  await form.waitFor();
  await form.locator('[name=num]').fill(o.num);
  await form.locator('[name=client]').fill(o.client);
  await form.locator('[name=amount]').fill(String(o.amount));
  await form.locator('[name=currency]').selectOption(o.currency, { force: true });
  if (o.stage) await form.locator('[name=stage]').selectOption(o.stage, { force: true });
  if (o.paid) await form.locator('[name=paidAmount]').fill(String(o.paid));
  if (o.draft) await form.locator('[name=isDraft]').check();
  await page.getByRole('button', { name: '保存订单' }).click();
  await form.waitFor({ state: 'detached' });
}
async function addTask(app, title) {
  const { page } = app;
  await page.locator('[data-biz-action="new-task"]').first().click();
  await page.locator('#biz-task-form').waitFor();
  await page.locator('#biz-task-form [name=title]').fill(title);
  await page.locator('button[form="biz-task-form"]').click();
  await page.locator('#biz-task-form').waitFor({ state: 'detached' });
}
const statValue = (app, label) => app.page.locator('.wb-stat', { hasText: label }).locator('.wb-num').innerText();

test('workbench: the numbers follow a new order and a new task', async () => {
  await run(async (app) => {
    const { page } = app;
    await goTo(app, '工作台');
    assert.equal(await statValue(app, '有效订单'), '0');
    assert.equal(await statValue(app, '待办任务'), '0');
    await shot(app, 'workbench-empty');
    await createOrder(app, { num: 'WB-001', client: 'Northwind Lash Studio', amount: 100, currency: 'USD', stage: '定金', paid: 40 });
    await createOrder(app, { num: 'WB-002', client: 'Lumen Lash Lab', amount: 999, currency: 'USD', draft: true });
    await goTo(app, '工作台');
    assert.equal(await statValue(app, '有效订单'), '1', 'the draft is not counted');
    assert.equal(await statValue(app, '未完成订单'), '1');
    await page.locator('.wb-order', { hasText: 'WB-001' }).waitFor();
    await addTask(app, '寄样品给 Northwind');
    assert.equal(await statValue(app, '待办任务'), '1');
    assert.match(await page.locator('.wb-stat', { hasText: '待办任务' }).innerText(), /今天到期 1 项/);
    await page.locator('.wb-task', { hasText: '寄样品给 Northwind' }).waitFor();
    await shot(app, 'workbench-after');
    // Completing the task from the workbench lowers the count again.
    await page.locator('.wb-task', { hasText: '寄样品给 Northwind' }).locator('input[type=checkbox]').check({ force: true });
    await until(app, (d) => (d.laiTasks || []).some((t) => t.done), 'task done saved');
    await page.waitForTimeout(300);
    assert.equal(await statValue(app, '待办任务'), '0');
    // The workbench asks for unread mail; with no mailbox bound the backend answers 409 and the card says so.
    await page.getByText('请先在邮件页绑定邮箱').first().waitFor();
    for (let i = app.errors.length - 1; i >= 0; i--) if (/^HTTP 409: .*\/api\/mail\/messages\?folder=unread/.test(app.errors[i])) app.errors.splice(i, 1);
  });
});

test('calendar-tasks: switch month, select a day, create, complete a task', async () => {
  await run(async (app) => {
    const { page } = app;
    await goTo(app, '协同');
    const month = page.locator('#biz-month');
    const first = await month.inputValue();
    assert.match(first, /^\d{4}-\d{2}$/);
    await page.locator('[data-biz-action="month-prev"]').click();
    const prev = await month.inputValue();
    assert.notEqual(prev, first);
    await page.locator('[data-biz-action="month-next"]').click();
    assert.equal(await month.inputValue(), first, 'next brings the month back');
    assert.equal(await page.locator('.calendar-day').count() >= 28, true);
    // Create a task for today and see it on the calendar.
    await addTask(app, '电话回访 Lumen');
    const today = new Date().toLocaleDateString('sv');
    const day = page.locator(`.calendar-day[data-biz-day="${today}"]`);
    await day.locator('.calendar-event', { hasText: '电话回访 Lumen' }).waitFor();
    await day.click();
    await page.locator('.calendar-agenda h3', { hasText: today }).waitFor();
    const item = page.locator('.agenda-item', { hasText: '电话回访 Lumen' });
    await item.waitFor();
    assert.match(await item.innerText(), /待办任务/);
    await shot(app, 'calendar-task');
    // Another day shows nothing.
    const other = page.locator('.calendar-day').filter({ hasNot: page.locator('.calendar-event') }).first();
    await other.click();
    await page.locator('.small-empty', { hasText: '暂无日程' }).waitFor();
    await day.click();
    // Edit the task and mark it done.
    await item.click();
    await page.locator('#biz-task-form').waitFor();
    await page.locator('#biz-task-form [name=done]').check();
    await page.locator('button[form="biz-task-form"]').click();
    await until(app, (d) => (d.laiTasks || []).some((t) => t.title === '电话回访 Lumen' && t.done), 'task done saved');
    await reload(app);
    assert.equal((await app.readData()).laiTasks.find((t) => t.title === '电话回访 Lumen').done, true);
    await shot(app, 'calendar-done');
  }, { hash: 'customers' });
});

test('business-stats: totals per currency, drafts left out', async () => {
  await run(async (app) => {
    const { page } = app;
    await createOrder(app, { num: 'ST-001', client: 'Northwind Lash Studio', amount: 100, currency: 'USD', stage: '定金', paid: 40 });
    await createOrder(app, { num: 'ST-002', client: 'Lumen Lash Lab', amount: 200, currency: 'EUR', stage: '已完成' });
    await createOrder(app, { num: 'ST-003', client: 'Bluebell Beauty Supply', amount: 999, currency: 'USD', draft: true });
    await goTo(app, '团队数据', '经营统计');
    await page.getByText('金额概览').first().waitFor();
    const rows = await page.locator('table').first().locator('tbody tr').allInnerTexts();
    const clean = rows.map((r) => r.replace(/\s+/g, ' ').trim());
    assert.equal(clean.length, 2, 'one row per currency: ' + clean.join(' / '));
    assert.ok(clean.some((r) => /^EUR 1 200\.00 EUR 200\.00 EUR 0\.00 EUR$/.test(r)), clean.join(' / '));
    assert.ok(clean.some((r) => /^USD 1 100\.00 USD 40\.00 USD 60\.00 USD$/.test(r)), clean.join(' / '));
    const text = await pageText(app);
    assert.ok(!text.includes('999'), 'the draft is not in any total');
    assert.match(text, /定金 1/);
    assert.match(text, /已完成 1/);
    assert.match(text, /Lumen Lash Lab 1 200\.00 EUR/);
    assert.match(text, /Northwind Lash Studio 1 100\.00 USD/);
    await shot(app, 'business-stats');
  });
});

test('team-data: a monthly target is saved and its completion follows a new order', async () => {
  await run(async (app) => {
    const { page } = app;
    await goTo(app, '团队数据', '目标完成情况');
    await page.locator('[data-team-target]').first().click();
    await page.locator('#biz-target-form').waitFor();
    assert.equal(await page.locator('#biz-target-form [name=metric]').inputValue(), 'amount');
    await page.locator('#biz-target-form [name=value]').fill('1000');
    await shot(app, 'team-target-form');
    await page.locator('button[form="biz-target-form"]').click();
    await page.locator('#biz-target-form').waitFor({ state: 'detached' });
    await page.getByText('完成率 0%').first().waitFor();
    await goTo(app, '团队数据', '目标管理');
    assert.match(await pageText(app), /共 1 个/);
    assert.match(await pageText(app), /企业整体 成交订单金额 1,?000/);
    await createOrder(app, { num: 'TG-001', client: 'Northwind Lash Studio', amount: 250, currency: 'USD', stage: '已完成' });
    await goTo(app, '团队数据', '目标完成情况');
    await page.getByText('完成率 25%').first().waitFor();
    await shot(app, 'team-goals');
    assert.deepEqual(app.errors, []);
  });
});

test('backup: 立即备份 writes a backup, and the data is unchanged after a reload', async () => {
  await run(async (app) => {
    const { page } = app;
    await seedData(app, (data) => {
      data.laiTasks = [{ id: 't-keep', title: '备份前的任务', date: '2026-10-16', done: false }];
      return data;
    });
    const before = await app.readData();
    await goTo(app, '设置', '设置');
    await page.locator('[data-biz-action="backup"]').waitFor();
    await shot(app, 'backup-page');
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/manual-backup')),
      page.locator('[data-biz-action="backup"]').click(),
    ]);
    assert.equal(response.status(), 200);
    const body = await response.json();
    assert.equal(body.ok, true, JSON.stringify(body));
    await page.getByText('备份完成').first().waitFor();
    await page.getByText('备份已保存到来财数据目录。').first().waitFor();
    await shot(app, 'backup-done');
    await reload(app);
    assert.deepEqual(await app.readData(), before, 'saved data is the same after the backup and a reload');
    await goTo(app, '客户', '客户列表');
    await page.locator('tbody tr', { hasText: 'Northwind Lash Studio' }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 4);
  });
});
