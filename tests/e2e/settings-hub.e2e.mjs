// Browser end-to-end test: 设置中心 (every entry opens its real settings), 设置 (default entry values and the
// colour theme save and persist). The 客户设置 tabs have their own tests (customer-settings*.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('settings-hub'); });
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const openHub = async () => { await app.open('settings-hub'); await app.page.locator('.sh-page').waitFor(); };
const entry = (id) => app.page.locator(`[data-sh-item="${id}"] button`);
const laiSettings = async () => (await app.readData()).laiSettings || {};
const unexpectedErrors = () => app.errors;
const htmlTheme = () => app.page.evaluate(() => document.documentElement.getAttribute('data-theme'));

test('the settings centre lists every group, and its theme entry shows the current theme', async () => {
  const { page } = app;
  await openHub();
  await page.getByRole('heading', { name: '设置中心' }).waitFor();
  assert.deepEqual(await page.locator('.sh-group h3').allInnerTexts(), ['通用', '客户', '商机', '产品和单据', '沟通', '协同', '团队', '邮件']);
  assert.deepEqual(await page.locator('.sh-item strong').allInnerTexts(),
    ['默认录入', '界面配色', '常用导航', '功能开关', '列表字段', '客群管理', '客户设置', '商机设置', '产品设置', '单据模板', '汇率设置', '聊天模板', '任务设置', '目标管理', '邮箱设置']);
  assert.match(await page.locator('[data-sh-item="theme"] .sh-now').innerText(), /粉色/);
  assert.match(await page.locator('[data-sh-item="defaults"] .sh-now').innerText(), /USD/);
  assert.equal(await page.locator('.sh-page [data-feature]').count(), 0, 'no placeholder entries');
  assert.deepEqual(unexpectedErrors(), []);
});

test('the left menu 设置 offers 设置 and 设置中心, and both open without errors', async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.rail-item[data-rail-menu="设置"]').click();
  const center = page.locator('.section-tabs .section-tab:text-is("设置中心")');
  const plain = page.locator('.section-tabs .section-tab:text-is("设置")');
  await center.waitFor();
  await center.click();
  await page.getByRole('heading', { name: '设置中心' }).waitFor();
  await plain.click();
  await page.getByRole('heading', { level: 1, name: '设置', exact: true }).waitFor();
  await page.locator('#biz-settings-form').waitFor();
  assert.deepEqual(unexpectedErrors(), []);
});

// Each entry opens the real setting it names. `ready` waits for something only that destination shows.
const heading = (name) => (page) => page.getByRole('heading', { level: 1, name, exact: true }).waitFor();
const dialog = (name) => (page) => page.locator('.drawer', { hasText: name }).first().waitFor();
const destinations = [
  ['defaults', heading('设置'), (page) => page.locator('#biz-settings-form').waitFor()],
  ['theme', heading('设置'), (page) => page.locator('.theme-options').waitFor()],
  ['favorites', dialog('管理常用')],
  ['columns', dialog('显示字段')],
  ['segments', dialog('管理客群')],
  ['customer-settings', (page) => page.locator('.cs-page').waitFor()],
  ['feature-switch', heading('功能开关')],
  ['flows', heading('商机设置')],
  ['product-settings', heading('产品')],
  ['doc-templates', heading('单据模板')],
  ['rates', heading('汇率设置')],
  ['chat-templates', heading('聊天模板')],
  ['task-settings', heading('任务设置'), (page) => page.locator('.tr-page').waitFor()],
  ['targets', heading('目标管理')],
  ['mail-account', heading('收件箱'), (page) => page.getByText('未绑定邮箱', { exact: true }).waitFor()],
];
for (const [id, ...checks] of destinations) {
  test(`设置中心 entry "${id}" opens its setting without errors`, async () => {
    const { page } = app;
    await openHub();
    await entry(id).click();
    for (const check of checks) await check(page);
    await settle(300);
    assert.deepEqual(unexpectedErrors(), [], id);
  });
}

test('the theme switch (粉色 / 橙色 / 科技蓝) takes effect at once and survives a reload', async () => {
  const { page } = app;
  await app.open('settings');
  await page.locator('.theme-options').waitFor();
  assert.deepEqual(await page.locator('.theme-option strong').allInnerTexts(), ['粉色（默认）', '橙色', '科技蓝']);
  const seen = {};
  for (const [id, name] of [['orange', '橙色'], ['tech', '科技蓝'], ['pink', '粉色（默认）']]) {
    const option = page.locator(`.theme-option[data-theme-id="${id}"]`);
    await option.click();
    await page.waitForFunction((theme) => document.documentElement.getAttribute('data-theme') === theme || (theme === 'pink' && !document.documentElement.getAttribute('data-theme')), id);
    assert.equal(await option.getAttribute('aria-pressed'), 'true', name);
    assert.equal(await option.locator('.theme-state').innerText(), '使用中');
    assert.equal(await page.locator('.theme-option[aria-pressed="true"]').count(), 1);
    await settle(700);
    assert.equal((await laiSettings()).theme, id, 'theme saved to the backend');
    seen[id] = await page.evaluate(() => getComputedStyle(document.querySelector('.theme-option.selected .pv-nav')).backgroundColor);
  }
  assert.equal(new Set(Object.values(seen)).size, 3, 'each theme paints differently: ' + JSON.stringify(seen));
  // Reload on 科技蓝 and on 橙色: the choice is still there, in the page and in the hub.
  for (const [id, name] of [['tech', '科技蓝'], ['orange', '橙色']]) {
    await page.locator(`.theme-option[data-theme-id="${id}"]`).click();
    await settle(700);
    await page.reload();
    await page.locator('.theme-options').waitFor();
    assert.equal(await htmlTheme(), id, `${name} still applied after reload`);
    assert.equal(await page.locator('.theme-option[aria-pressed="true"]').getAttribute('data-theme-id'), id);
    await openHub();
    assert.match(await page.locator('[data-sh-item="theme"] .sh-now').innerText(), new RegExp(name));
    await app.open('settings');
  }
  assert.deepEqual(unexpectedErrors(), []);
});

test('default entry values (company, order prefix, currency, owner) save and persist', async () => {
  const { page } = app;
  await app.open('settings');
  const form = page.locator('#biz-settings-form');
  await form.locator('[name="company:name"]').fill('深圳测试贸易有限公司');
  await form.locator('[name=orderPrefix]').fill('TST');
  await form.locator('[name=defaultCurrency]').selectOption('EUR');
  await form.locator('[name=defaultOwner]').fill('王小明');
  await form.locator('button[type=submit]').click();
  await settle(900);
  const saved = await laiSettings();
  assert.equal(saved.docTemplates.company.name, '深圳测试贸易有限公司');
  assert.equal('companyName' in saved, false, 'the old separate field is no longer written');
  assert.equal(saved.orderPrefix, 'TST');
  assert.equal(saved.defaultCurrency, 'EUR');
  assert.equal(saved.defaultOwner, '王小明');
  await page.reload();
  await form.waitFor();
  assert.equal(await form.locator('[name="company:name"]').inputValue(), '深圳测试贸易有限公司');
  assert.equal(await form.locator('[name=orderPrefix]').inputValue(), 'TST');
  assert.equal(await form.locator('[name=defaultCurrency]').inputValue(), 'EUR');
  assert.equal(await form.locator('[name=defaultOwner]').inputValue(), '王小明');
  // The hub reflects the new values.
  await openHub();
  assert.match(await page.locator('[data-sh-item="defaults"] .sh-now').innerText(), /TST · EUR/);
  assert.deepEqual(unexpectedErrors(), []);
});

test('取消修改 throws away unsaved changes in the default entry form', async () => {
  const { page } = app;
  await app.open('settings');
  const form = page.locator('#biz-settings-form');
  await form.locator('[name=defaultOwner]').fill('不会保存的人');
  await page.getByRole('button', { name: '取消修改' }).click();
  await settle(400);
  assert.equal(await form.locator('[name=defaultOwner]').inputValue(), '王小明');
  assert.equal((await laiSettings()).defaultOwner, '王小明');
  assert.deepEqual(unexpectedErrors(), []);
});

test('an order prefix with illegal characters is not saved', async () => {
  const { page } = app;
  const before = (await laiSettings()).orderPrefix;
  await app.open('settings');
  const form = page.locator('#biz-settings-form');
  await form.locator('[name=orderPrefix]').fill('订单 #1');
  await form.locator('button[type=submit]').click();
  await settle(700);
  assert.equal((await laiSettings()).orderPrefix, before, 'the invalid prefix was not stored');
  assert.deepEqual(unexpectedErrors(), []);
});

test('the 设置 page has 立即备份 but no Mac-only 打开数据目录; a 501 from the backend says backup is not available in the trial', async () => {
  const { page } = app;
  await app.open('settings');
  await page.locator('[data-biz-action="backup"]').waitFor();
  assert.equal(await page.locator('[data-biz-action="open-folder"]').count(), 0);
  assert.equal(await page.getByText('打开数据目录').count(), 0);
  assert.equal(await page.getByText('这台电脑').count(), 0, 'no "this computer" wording on the page');
  await page.route('**/api/manual-backup', (route) => route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'not implemented' }) }));
  await page.locator('[data-biz-action="backup"]').click();
  await page.locator('#biz-backup-status', { hasText: '试用版不能备份' }).waitFor();
  await page.unroute('**/api/manual-backup');
  // The faked 501 is the only error the page may log here.
  assert.deepEqual(unexpectedErrors().filter((e) => !/^HTTP 501: .*\/api\/manual-backup$/.test(e)), []);
});
