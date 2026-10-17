// 导出 in the real page with the real backend: the 导出 button on the customer, order and opportunity lists, the
// dialog (范围 / 列 / 格式 / preview), real downloads read back with SheetJS, a 本人 account exporting only its own rows,
// a role that hides fields getting no such column, an account without the export permission seeing no button, and the
// web trial (no download, 复制表格).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('../../vendor/sheetjs-0.20.3/xlsx.full.min.js');
const B = require('../../src/business-model.js');
const O = require('../../src/opportunity-model.js');
const NOW = '2026-10-01T00:00:00.000Z';

const EXPORT_PERMS = ['customer.view', 'customer.export', 'order.view', 'order.export', 'opp.view', 'opp.export'];
const perms = (keys) => Object.fromEntries(keys.map((key) => [key, true]));
const roles = [
  { id: 'exporter', name: '可导出', scope: 'self', perms: perms(EXPORT_PERMS), v: 2 },
  { id: 'masked', name: '隐藏字段', scope: 'self', perms: perms(EXPORT_PERMS), v: 2, fields: { customer: { 'contact.email': 'hidden', 'contact.phone': 'hidden' }, opp: { contact: 'hidden' } } },
];
const members = [
  { id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' },
  { id: 'm-ben', name: 'Ben', roleId: 'exporter' }, { id: 'm-cy', name: 'Cy', roleId: 'masked' },
];
const buyerOf = { Kris: 'Northwind Lash Studio', Ben: 'Maple & Moss Cosmetics', Cy: 'Lumen Lash Lab' };
const contactOf = { Kris: 'Avery Brooks', Ben: 'Owen Fraser', Cy: 'Greta Vogel' };
const ownerOf = { Kris: ['Northwind Lash Studio', 'Bluebell Beauty Supply'], Ben: ['Maple & Moss Cosmetics'], Cy: ['Lumen Lash Lab'] };

async function start(current = 'm-kris') {
  const app = await startApp();
  // Headless Chromium in a non-UTF-8 locale reports every Chinese download name as "download", so the name given to
  // <a download> is recorded here and compared instead.
  await app.page.addInitScript(() => {
    window.__downloads = [];
    const click = HTMLElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) window.__downloads.push(this.getAttribute('download')); return click.call(this); };
  });
  await app.open('customers');
  const request = app.page.context().request;
  const loaded = await (await request.get(app.base + '/api/data')).json();
  let data = loaded.data;
  for (const [owner, names] of Object.entries(ownerOf)) for (const name of names) {
    data.customers[name].owner = owner;
    data.customers[name].email = `${name.slice(0, 4).toLowerCase().replace(/\W/g, '')}@buyer.test`;
  }
  data.laiSettings = { ...(data.laiSettings || {}), defaultOwner: 'Kris', roles: { roles, members, current } };
  for (const owner of ['Kris', 'Ben', 'Cy']) {
    const id = owner.toLowerCase();
    data = B.upsertOrder(data, `order-${id}`, { num: `SO-${owner}`, client: buyerOf[owner], country: 'US', productType: 'Lash', amount: '100', currency: 'USD', paidAmount: '0', stage: 'quote', createdAt: '2026-10-01', owner, isDraft: false, items: [{ code: 'P1', name: 'Lash', model: 'M1', qty: '2', price: '50' }] });
    data = O.upsert(data, `opp-${id}`, { name: `${owner} Deal`, client: buyerOf[owner], contact: contactOf[owner], amount: '10', currency: 'USD', owner, stage: 'open', endDate: '2026-11-05' }, { now: NOW, today: '2026-10-01' });
  }
  const res = await request.post(app.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
  return app;
}
const settle = (app, ms = 400) => app.page.waitForTimeout(ms);
const go = async (app, route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(app, 600);
};
const PAGES = { customer: 'customers', order: 'order-list', opp: 'opportunities' };
const exportButton = (app, kind) => app.page.locator(`[data-export-kind="${kind}"]`);
const openDialog = async (app, kind) => {
  if (kind !== 'customer') await go(app, PAGES[kind]);
  await exportButton(app, kind).click();
  await app.page.locator('.drawer.export-dialog').waitFor();
};
const dialogText = (app) => app.page.locator('.drawer.export-dialog').innerText();
const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
async function download(app, trigger) {
  const [file] = await Promise.all([app.page.waitForEvent('download'), trigger()]);
  const saved = await file.path();
  return { name: (await app.page.evaluate(() => window.__downloads.at(-1))), path: saved, book: XLSX.read(fs.readFileSync(saved), { type: 'buffer' }) };
}
const rowsOf = (book, sheet = book.SheetNames[0]) => XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1 });
const confirm = (app) => () => app.page.locator('.drawer.export-dialog [data-export-do="download"]').click();

test('admin: 导出 on the customer list, the dialog, a real .xlsx download, 已选的 and 全部字段', async () => {
  const app = await start('m-kris');
  try {
    const { page } = app;
    await exportButton(app, 'customer').waitFor();
    await exportButton(app, 'customer').click();
    await page.locator('.drawer.export-dialog').waitFor();
    let text = await dialogText(app);
    for (const part of ['导出客户', '范围', '当前筛选结果（4 条）', '全部我能看到的（4 条）', '按列表字段设置', '全部字段', 'Excel（.xlsx）', 'CSV', '表里有客户联系方式，请妥善保管。']) assert.ok(text.includes(part), part);
    assert.ok(!text.includes('已选的'), 'no selection yet');
    assert.equal(await page.locator('.export-table tbody tr').count(), 4);
    await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/export-dialog.png` : undefined });

    const first = await download(app, confirm(app));
    assert.equal(first.name, `来财-客户-${today()}.xlsx`);
    const rows = rowsOf(first.book);
    assert.equal(rows.length, 5, 'header + 4 customers');
    assert.ok(rows[0].includes('公司名称') && rows[0].includes('其他联系人'));
    await page.locator('#toast.show', { hasText: '已导出 4 位客户' }).waitFor();
    assert.equal(await page.locator('.drawer.export-dialog').count(), 0, 'the dialog closes after exporting');

    // One ticked row: 已选的 appears, is the default, and exports just that customer.
    await page.locator('tbody tr input[type=checkbox]').first().check();
    await exportButton(app, 'customer').click();
    await page.locator('.drawer.export-dialog').waitFor();
    text = await dialogText(app);
    assert.ok(text.includes('已选的（1 条）'));
    assert.equal(await page.locator('input[name="export-scope"]:checked').getAttribute('value'), 'selected');
    await page.locator('input[name="export-columns"][value="all"]').check();
    await page.locator('input[name="export-scope"][value="selected"]').check();
    const second = await download(app, confirm(app));
    const wide = rowsOf(second.book);
    assert.equal(wide.length, 2);
    assert.ok(wide[0].length > rowsOf(first.book)[0].length, '全部字段 has more columns than the list setting');
    assert.ok(wide[0].includes('邮箱') && wide[0].includes('跟进人'));
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('admin: orders (with 产品明细) and opportunities download; CSV has a BOM and the header first', async () => {
  const app = await start('m-kris');
  try {
    await openDialog(app, 'order');
    assert.ok((await dialogText(app)).includes('导出订单'));
    assert.ok((await dialogText(app)).includes('全部我能看到的（3 条）'));
    const orders = await download(app, confirm(app));
    assert.equal(orders.name, `来财-订单-${today()}.xlsx`);
    assert.deepEqual(orders.book.SheetNames, ['订单', '产品明细']);
    assert.equal(rowsOf(orders.book, '订单').length, 4);
    const items = rowsOf(orders.book, '产品明细');
    assert.deepEqual(items[0], ['订单号', '产品编号', '名称', '型号', '数量', '单价']);
    assert.equal(items.length, 4);
    assert.deepEqual(items[1].slice(1), ['P1', 'Lash', 'M1', 2, 50]);

    await openDialog(app, 'opp');
    const opps = await download(app, confirm(app));
    assert.equal(opps.name, `来财-商机-${today()}.xlsx`);
    assert.equal(rowsOf(opps.book).length, 4);
    assert.ok(rowsOf(opps.book)[0].includes('联系人'));

    await openDialog(app, 'opp');
    assert.ok((await dialogText(app)).includes('导出商机'));
    await app.page.locator('input[name="export-format"][value="csv"]').check();
    const oppCsv = await download(app, confirm(app));
    assert.equal(oppCsv.name, `来财-商机-${today()}.csv`);
    const csv = fs.readFileSync(oppCsv.path, 'utf8');
    assert.ok(csv.startsWith('﻿编号,'), 'BOM then the header');
    assert.equal(csv.split('\r\n').length, 4);
    assert.equal(await exportButton(app, 'lead').count(), 0, 'no lead export any more (D-030)');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('a 本人 account exports only its own rows, in the filtered and the all-visible scope', async () => {
  const app = await start('m-ben');
  try {
    await exportButton(app, 'customer').waitFor();
    await exportButton(app, 'customer').click();
    await app.page.locator('.drawer.export-dialog').waitFor();
    const text = await dialogText(app);
    assert.ok(text.includes('当前筛选结果（1 条）') && text.includes('全部我能看到的（1 条）'));
    await app.page.locator('input[name="export-scope"][value="all"]').check();
    const customers = await download(app, confirm(app));
    const rows = rowsOf(customers.book);
    assert.equal(rows.length, 2);
    assert.ok(JSON.stringify(rows).includes('Maple') && !JSON.stringify(rows).includes('Northwind') && !JSON.stringify(rows).includes('Lumen'));

    for (const [kind, own, others] of [['order', 'SO-Ben', ['SO-Kris', 'SO-Cy']], ['opp', 'Ben', ['Kris', 'Cy']]]) {
      await openDialog(app, kind);
      await app.page.locator('input[name="export-scope"][value="all"]').check();
      const file = await download(app, confirm(app));
      const flat = JSON.stringify(rowsOf(file.book));
      assert.equal(rowsOf(file.book).length, 2, kind);
      assert.ok(flat.includes(own), kind);
      for (const other of others) assert.ok(!flat.includes(other), `${kind}: ${other}`);
    }
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('a role that hides email, phone and contact gets no such column, in the file or the preview', async () => {
  const app = await start('m-cy');
  try {
    await openDialog(app, 'customer');
    await app.page.locator('input[name="export-columns"][value="all"]').check();
    const heads = await app.page.locator('.export-table th').allInnerTexts();
    assert.ok(heads.includes('公司名称') && heads.includes('主要联系人') && !heads.includes('邮箱') && !heads.includes('联系电话'), heads.join('|'));
    assert.ok(!(await app.page.locator('.export-preview').innerText()).includes('buyer.test'));
    const customers = await download(app, confirm(app));
    const header = rowsOf(customers.book)[0];
    assert.ok(header.includes('公司名称') && !header.includes('邮箱') && !header.includes('联系电话'));
    assert.ok(!JSON.stringify(rowsOf(customers.book)).includes('buyer.test'));

    await openDialog(app, 'opp');
    const opps = await download(app, confirm(app));
    assert.ok(!rowsOf(opps.book)[0].includes('联系人'));
    assert.ok(!JSON.stringify(rowsOf(opps.book)).includes('Greta Vogel'));
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('业务 without the export permission sees no 导出 button on any list, and a hand-made click opens nothing', async () => {
  const app = await start('m-amy');
  try {
    await app.page.locator('tbody tr').first().waitFor({ state: 'attached' }).catch(() => {});
    assert.equal(await exportButton(app, 'customer').count(), 0);
    for (const kind of ['order', 'opp']) {
      await go(app, PAGES[kind]);
      assert.equal(await exportButton(app, kind).count(), 0, kind);
      await app.page.evaluate((k) => { const b = document.createElement('button'); b.dataset.exportKind = k; document.body.appendChild(b); b.click(); b.remove(); }, kind);
      await settle(app, 200);
      assert.equal(await app.page.locator('.drawer.export-dialog').count(), 0, kind);
    }
    await go(app, 'customers');
    await app.page.evaluate(() => { const b = document.createElement('button'); b.dataset.exportKind = 'customer'; document.body.appendChild(b); b.click(); b.remove(); });
    await settle(app, 200);
    assert.equal(await app.page.locator('.drawer.export-dialog').count(), 0);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('web trial: no download; 复制表格 copies tab-separated text, with the Ctrl+C hint when the clipboard refuses', async () => {
  const app = await start('m-kris');
  try {
    const { page } = app;
    await page.addInitScript(() => {
      window.LaiWebTrial = {};
      window.__copied = [];
      window.__allowCopy = true;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text) => (window.__allowCopy ? (window.__copied.push(text), Promise.resolve()) : Promise.reject(new Error('refused'))) } });
    });
    await app.open('customers');
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await exportButton(app, 'customer').click();
    await page.locator('.drawer.export-dialog').waitFor();
    const text = await dialogText(app);
    assert.ok(text.includes('网页试用版不能下载文件。'));
    assert.equal(await page.locator('[data-export-do="download"]').count(), 0);
    assert.equal(await page.locator('input[name="export-format"]').count(), 0);
    await page.locator('[data-export-do="copy"]', { hasText: '复制表格' }).click();
    await page.locator('#toast.show', { hasText: '已复制 4 位客户' }).waitFor();
    const copied = await page.evaluate(() => window.__copied);
    assert.equal(copied.length, 1);
    const lines = copied[0].split('\n');
    assert.equal(lines.length, 5);
    assert.ok(lines[0].split('\t').includes('公司名称'));

    await page.evaluate(() => { window.__allowCopy = false; });
    await page.locator('[data-export-do="copy"]').click();
    const box = page.locator('.export-copybox');
    await box.waitFor({ state: 'visible' });
    assert.ok((await box.innerText()).includes('请按 Ctrl+C（苹果电脑按 Cmd+C）复制'));
    assert.ok((await box.locator('textarea').inputValue()).startsWith('公司名称'));
    assert.equal(downloads, 0);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
