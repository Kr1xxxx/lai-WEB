const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/workbench.js');
const B = require('../src/business-model.js');
const OM = require('../src/opportunity-model.js');
const TM = require('../src/team-model.js');
const L = require('../src/modules.js');
const { escapeHtml } = require('../src/model.js');

const today = '2026-10-08';
const order = (id, stage, extra = {}) => ({ id, num: 'L-' + id, client: 'Client ' + id, amount: 1000, currency: 'USD', stage, productType: '定制盒', updated: '2026-10-0' + id, ...extra });
function build(state, mail) {
  return W.markup({ state, today, B, OM, TM, bucket: (c) => L.bucket(c), mail }, escapeHtml);
}
const base = () => ({
  orders: [order('1', 'quote'), order('2', 'production', { next: '寄产前样' }), order('3', 'shipment', { currency: 'CNY', amount: 5000 }), order('4', 'done'), order('5', 'quote', { isDraft: true })],
  customers: {
    Late: { client: 'Late', owner: 'Mia', nextFollow: '2026-10-05', history: [{ type: 'followup', text: '等报价' }] },
    Now: { client: 'Now', nextFollow: '2026-10-08', history: [] },
    Later: { client: 'Later', nextFollow: '2026-11-01' },
    Gone: { client: 'Gone', nextFollow: '2026-10-01', laiBucket: 'trash' },
  },
  laiTasks: [{ id: 't1', title: '今天的事', date: '2026-10-08' }, { id: 't2', title: '以后的事', date: '2026-10-20' }, { id: 't3', title: '做完了', date: '2026-10-08', done: true }],
});

test('the workbench has the six counters from the design, counting drafts and finished work correctly', () => {
  const html = build(base(), { unread: 3, pending: 5 });
  const stat = (label) => new RegExp(`<span>${label}</span><strong class="wb-num"[^>]*>(\\d+)</strong><small[^>]*>([^<]*)</small>`).exec(html);
  assert.equal(stat('有效订单')[1], '4', '草稿不算');
  assert.equal(stat('未完成订单')[1], '3');
  assert.equal(stat('未完成订单')[2], '1 笔已发货待完成');
  assert.equal(stat('待跟进客户')[1], '2', '回收站里的客户不算，下次跟进还没到的不算');
  assert.equal(stat('待跟进客户')[2], '1 位已逾期');
  assert.equal(stat('待办任务')[1], '2');
  assert.equal(stat('待办任务')[2], '今天到期 1 项');
  assert.equal(stat('未读邮件')[1], '3');
  assert.equal(stat('未读邮件')[2], '待处理 5 封');
});

test('the 订单进度 list shows the step bar with the current stage lit and the next step text', () => {
  const html = build(base(), null);
  const row = /data-biz-order="2"[\s\S]*?<\/button>/.exec(html)[0];
  assert.match(row, /生产中（第 3 \/ 6 步）/);
  assert.equal((row.match(/<i class="on">/g) || []).length, 3);
  assert.match(row, /下一步：寄产前样/);
  assert.doesNotMatch(html, /data-biz-order="4"/, '已完成的订单不在进度里');
  assert.doesNotMatch(html, /data-biz-order="5"/, '草稿不在进度里');
  assert.match(html, /未完成订单 3 笔/);
  assert.match(html, /订单阶段：报价 → 定金 → 生产中 → 尾款 → 已发货 → 已完成/);
});

test('the money overview is per currency with a paid-share bar and never converts currencies', () => {
  const html = build(base(), null);
  assert.match(html, /<b>USD<\/b><span>3 笔<\/span>/);
  assert.match(html, /<b>CNY<\/b><span>1 笔<\/span><span class="wb-num">¥5,000<\/span><span class="wb-num wb-paid">¥5,000<\/span>/);
  assert.match(html, /style="width:100%"/);
});

test('the dark follow-up card marks overdue days and links to the customer', () => {
  const html = build(base(), null);
  assert.match(html, /逾期3天/);
  assert.match(html, /Mia · 上次：等报价/);
  assert.match(html, /<span class="wb-num today">今天<\/span>/);
  assert.match(html, /data-biz-customer="Late"/);
  assert.doesNotMatch(html, /Gone|Later/);
});

test('tasks keep the checkbox hook and sort by date; goals come from the company targets', () => {
  const state = base();
  const withGoal = TM.setTarget(state, { metric: 'amount', period: '2026-10', scope: 'company', currency: 'USD', value: 4000 });
  const html = build(withGoal, null);
  assert.match(html, /data-biz-task="t1"/);
  assert.doesNotMatch(html, /做完了/);
  assert.ok(html.indexOf('今天的事') < html.indexOf('以后的事'));
  assert.match(html, /成交订单金额（USD）/);
  assert.match(html, /\$\d[\d,]* <\/small>|<small> \/ \$4,000<\/small>/);
  assert.match(build(base(), null), /还没有设置本月目标/);
});

test('the opportunity tiles use the flow stages, and the mail card waits for the list', () => {
  const html = build(base(), { unread: 2, pending: 0 });
  assert.match(html, /未成单/);
  assert.match(html, /不计入/);
  assert.match(html, /正在读取邮件/);
  const rows = W.mailRows([{ from: { name: 'Emma' }, subject: 'Hi <b>', date: '2026-10-08T09:12:00' }], today, escapeHtml);
  assert.match(rows, /Emma<\/b> · Hi &lt;b&gt;/);
  assert.match(rows, /09:12/);
});

test('every dashboard button the workbench draws is handled by the controller', () => {
  const fs = require('node:fs'), path = require('node:path');
  const html = build(base(), { unread: 1, pending: 1 });
  const ui = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
  for (const go of new Set([...html.matchAll(/data-biz-go="([^"]+)"/g)].map((m) => m[1]))) {
    const key = go.startsWith('mail:') ? 'mail:' : go;
    if (go === 'opp-new' || go.startsWith('mail:')) assert.ok(ui.includes(`"${key}"`), go);
    else assert.ok(/^(order-list|customers|calendar|opportunities|analysis|team-goals)$/.test(go), go);
  }
  for (const action of new Set([...html.matchAll(/data-biz-action="([^"]+)"/g)].map((m) => m[1]))) assert.ok(ui.includes(`action === "${action}"`), action);
});

test('进行中商机 counts open opportunities in every flow and currency, skipping archived, won and lost ones', () => {
  let state = base();
  state = OM.addFlow(state, { label: '样品单' }, { id: 'fs' });
  const opp = (id, extra) => ({ id, name: 'Opp ' + id, client: 'C', amount: 100, currency: 'USD', stage: 'open', ...extra });
  state.laiOpportunities = [
    opp('a', { amount: 1000 }),
    opp('b', { stage: 'unpaid', amount: 500 }),
    opp('c', { currency: 'EUR', amount: 300 }),
    opp('d', { flow: 'fs', amount: 200 }),
    opp('e', { flow: 'fs', currency: 'CNY', stage: 'unpaid', amount: 700 }),
    opp('f', { stage: 'lost' }),
    opp('g', { stage: 'done' }),
    opp('h', { archived: true }),
  ];
  const pick = (html) => /<span>进行中商机<\/span><strong class="wb-num"[^>]*>(\d+)<\/strong><small[^>]*>([^<]*)<\/small>/.exec(html);
  const m = pick(build(state, null));
  assert.equal(m[1], '5', 'a, b, c, d, e are open and not archived');
  assert.match(m[2], /USD 1,700/);
  assert.match(m[2], /EUR 300/);
  assert.match(m[2], /CNY 700/);
  // No opportunities at all: zero and a dash, no crash.
  const none = pick(build(base(), null));
  assert.equal(none[1], '0');
  assert.equal(none[2], '—');
});
