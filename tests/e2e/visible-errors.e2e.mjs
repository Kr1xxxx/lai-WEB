// Errors you can see: a failed save writes its message next to the save button (inside the viewport, even in a
// long, scrolled drawer) and puts the cursor on the field that is wrong; empty required fields get a short Chinese
// message from the app instead of the browser's English bubble ("Please fill out this field.").
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => {
  app = await startApp();
  await app.open('customers');
  const ctx = app.page.context().request;
  const state = await (await ctx.get(app.base + '/api/data')).json();
  state.data.laiProducts = [
    { id: 'p-lash', code: 'LASH-01', name: 'Cloud Lash', unit: '盒', fob: '2.5', specs: [] },
    { id: 'p-glue', code: 'GLUE-02', name: 'Lash Glue', unit: '瓶', fob: '', specs: [] },
  ];
  const res = await ctx.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 300) => app.page.waitForTimeout(ms);
// No mailbox is bound in the test data dir, so the workbench's mail requests answer 409; that is not a page error.
const pageErrors = () => app.errors.filter((e) => !/HTTP 409: .*\/api\/mail/.test(e));
const shots = (name) => process.env.LAI_SHOTS && app.page.screenshot({ path: `${process.env.LAI_SHOTS}/${name}.png` });
// Is the element drawn inside the window (and inside its drawer, when it is in one)?
const inView = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const box = el.closest('.drawer')?.getBoundingClientRect() || { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
  return r.height > 0 && r.width > 0 && r.top >= Math.max(0, box.top) && r.bottom <= Math.min(innerHeight, box.bottom) && r.left >= 0 && r.right <= innerWidth;
});
const focused = () => app.page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el?.tagName, name: el?.getAttribute('name') || '', id: el?.id || '', row: el?.closest('[data-item-row]')?.dataset.itemRow ?? null };
});

async function newOrder() {
  const { page } = app;
  await app.open('customers');
  await page.locator('.rail-item[data-rail-menu="交易"]').click();
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("全部订单"))').click();
  await page.locator('.op-page').waitFor();
  await page.locator('[data-biz-action="new-order"]').first().click();
  await page.locator('#biz-order-form').waitFor();
}

test('order drawer: a product line without a product shows the error next to 保存订单 and focuses that line', async () => {
  const { page } = app;
  await newOrder();
  const form = page.locator('#biz-order-form');
  await form.locator('[name="client"]').fill('Lumen Lash Lab');
  await form.locator('[data-biz-action="order-item-add"]').click();
  await form.locator('[data-item-product="0"]').selectOption('p-lash', { force: true });
  await form.locator('[data-item-field="qty"][data-item-index="0"]').fill('10');
  await form.locator('[data-biz-action="order-item-add"]').click();
  await settle();
  // The drawer body is scrolled down to the product lines: the top of the form is out of sight.
  await form.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const before = (await app.readData()).orders?.length || 0;
  await page.locator('button[type=submit][form="biz-order-form"]').click();
  const error = page.locator('#biz-order-error');
  await page.locator('#biz-order-error.visible').waitFor();
  assert.match(await error.innerText(), /产品明细第 2 行还没选产品/);
  assert.equal(await error.evaluate((el) => !!el.closest('.drawer-footer')), true, 'the error sits in the footer');
  assert.equal(await inView(error), true, 'the error is inside the viewport');
  // Only the form area scrolls to the field: the drawer title and footer stay where they are.
  assert.deepEqual(await page.locator('#overlay-root .drawer').evaluate((d) => ({ scrolled: d.scrollTop, head: d.querySelector('.drawer-head').getBoundingClientRect().top >= 0 })), { scrolled: 0, head: true });
  assert.equal(await inView(page.locator('[data-item-row="1"]')), true, 'the bad line is in view');
  const at = await focused();
  assert.notEqual(at.tag, 'BODY');
  assert.equal(at.row, '1', `focus is on the second product line, got ${JSON.stringify(at)}`);
  assert.equal((await app.readData()).orders?.length || 0, before, 'nothing saved');
  await shots('visible-errors-order');
  await page.locator('[data-biz-action="close-editor"]').click();
  assert.deepEqual(pageErrors(), []);
});

test('order drawer: an empty required field gets a Chinese message, no browser bubble, and the cursor', async () => {
  const { page } = app;
  await newOrder();
  const form = page.locator('#biz-order-form');
  assert.equal(await form.evaluate((el) => el.noValidate), true, 'the app checks the form itself');
  assert.equal(await form.locator('[name="client"]').getAttribute('aria-required'), 'true');
  assert.equal(await form.locator('label.field:has([name="client"]) .required').count(), 1, 'required mark');
  await form.locator('[name="client"]').fill('');
  await page.locator('button[type=submit][form="biz-order-form"]').click();
  await page.locator('#biz-order-error.visible').waitFor();
  assert.equal(await page.locator('#biz-order-error').innerText(), '请填写客户名称');
  assert.equal(await inView(page.locator('#biz-order-error')), true);
  assert.deepEqual((await focused()).name, 'client');
  assert.equal(await form.locator('[name="client"]').getAttribute('aria-invalid'), 'true');
  // Typing a value clears the message for that field.
  await form.locator('[name="client"]').fill('Lumen Lash Lab');
  assert.equal(await page.locator('#biz-order-error.visible').count(), 0);
  await page.locator('[data-biz-action="close-editor"]').click();
  assert.deepEqual(pageErrors(), []);
});

test('new customer: an empty company name shows 请填写公司名称 in the footer and focuses the name box', async () => {
  const { page } = app;
  await app.open('customers');
  await page.getByRole('button', { name: '新建客户' }).first().click();
  const form = page.locator('#customer-form');
  await form.waitFor();
  assert.equal(await form.evaluate((el) => el.noValidate), true);
  assert.equal(await page.locator('#ce-name').getAttribute('aria-required'), 'true');
  const count = Object.keys((await app.readData()).customers || {}).length;
  // Fill everything else, so the only problem is the name.
  await page.locator('#ce-country').fill('美国');
  await page.getByRole('option', { name: '美国', exact: true }).click();
  await page.locator('#ce-source').fill('官网');
  await page.keyboard.press('Enter');
  await page.locator('#ce-contact-0').fill('Iris Monroe');
  await page.locator('#ce-email-0').fill('iris@orchidtest.example');
  await page.locator('#ce-phone-0').fill('2125550199');
  // Any native bubble would come from an uncancelled "invalid" event: count those.
  await page.evaluate(() => { window.__nativeBubbles = 0; document.addEventListener('invalid', (e) => { if (!e.defaultPrevented) window.__nativeBubbles++; }); });
  await page.getByRole('button', { name: '确 定' }).click();
  const error = page.locator('#form-error');
  await page.locator('#form-error.visible').waitFor();
  assert.equal(await error.innerText(), '请填写公司名称');
  assert.equal(await error.evaluate((el) => !!el.closest('.drawer-footer')), true);
  assert.equal(await inView(error), true);
  assert.equal((await focused()).id, 'ce-name');
  assert.equal(await page.evaluate(() => window.__nativeBubbles), 0, 'no browser bubble');
  assert.equal(Object.keys((await app.readData()).customers || {}).length, count, 'nothing saved');
  await shots('visible-errors-new-customer');
  // Empty required contact fields are refused too, each with its own message.
  await page.locator('#ce-name').fill('Orchid Visible Errors');
  await page.locator('#ce-email-0').fill('');
  await page.getByRole('button', { name: '确 定' }).click();
  await settle();
  assert.equal(await error.innerText(), '请填写邮箱');
  assert.equal((await focused()).id, 'ce-email-0');
  assert.equal(Object.keys((await app.readData()).customers || {}).length, count, 'still nothing saved');
  await page.locator('#ce-email-0').fill('iris@orchidtest.example');
  await page.getByRole('button', { name: '确 定' }).click();
  await settle(1000);
  assert.ok((await app.readData()).customers['Orchid Visible Errors'], 'saved once everything is filled in');
  assert.deepEqual(pageErrors(), []);
});

test('every form that used the browser check still refuses empty required input (task, opportunity, lead, product)', async () => {
  const { page } = app;
  const cases = [
    { route: 'dashboard', open: '[data-biz-action="new-task"]', form: '#biz-task-form', slot: '#biz-task-error', text: '请填写任务名称', field: 'title', clear: '[name="title"]' },
    { route: 'opportunities', open: '[data-biz-action="new-opportunity"], [data-opp-action="new"]', form: '#opp-form', slot: '#opp-error', text: '请填写客户', field: 'client' },
    { route: 'leads', open: '[data-biz-action="new-lead"], [data-lead-action="new"]', form: '#lead-form', slot: '#lead-error', text: '请填写线索名称', field: 'name' },
    { route: 'products', open: '[data-prod-action="new"], [data-biz-action="new-product"]', form: '#product-form', slot: '#product-error', text: '请填写产品名称', field: 'name' },
  ];
  for (const c of cases) {
    await app.open(c.route);
    const opener = page.locator(c.open).first();
    await opener.waitFor({ timeout: 5000 });
    await opener.click();
    const form = page.locator(c.form);
    await form.waitFor();
    assert.equal(await form.evaluate((el) => el.noValidate && el.hasAttribute('data-form-check')), true, c.form);
    const before = JSON.stringify(await app.readData());
    await form.locator(`[name="${c.field}"]`).fill('');
    await page.locator(`button[type=submit][form="${c.form.slice(1)}"]`).click();
    await page.locator(`${c.slot}.visible`).waitFor();
    assert.equal(await page.locator(c.slot).innerText(), c.text, c.form);
    assert.equal(await page.locator(c.slot).evaluate((el) => !!el.closest('.drawer-footer')), true, `${c.form} error in the footer`);
    assert.equal((await focused()).name, c.field, `${c.form} focus`);
    assert.equal(JSON.stringify(await app.readData()), before, `${c.form} saved nothing`);
    await page.locator('#overlay-root [data-action="close-modal"], #overlay-root [data-biz-action="close-editor"]').first().click();
    await settle();
  }
  assert.deepEqual(pageErrors(), []);
});

test('a form without the app check still blocks empty input, with the Chinese message and no bubble', async () => {
  const { page } = app;
  await app.open('customers');
  // A form that keeps the browser check: its invalid event is cancelled (no bubble) and the message is ours.
  const result = await page.evaluate(async () => {
    const form = document.createElement('form');
    form.innerHTML = '<label class="field">客群名称<input name="name" required></label><div class="error" role="alert"></div><button type="submit">保存</button>';
    let submitted = 0;
    form.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    document.querySelector('#app').append(form);
    let bubbles = 0;
    form.querySelector('input').addEventListener('invalid', (e) => { if (!e.defaultPrevented) bubbles++; });
    form.querySelector('button').click();
    await new Promise((r) => setTimeout(r, 50));
    const out = { submitted, bubbles, text: form.querySelector('.error').textContent, focus: document.activeElement === form.querySelector('input') };
    form.remove();
    return out;
  });
  assert.deepEqual(result, { submitted: 0, bubbles: 0, text: '请填写客群名称', focus: true });
});
