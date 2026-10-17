const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../src/workbench.js');
const B = require('../src/business-model.js');
const OM = require('../src/opportunity-model.js');
const TM = require('../src/team-model.js');
const L = require('../src/modules.js');
const WA = require('../src/whatsapp-ui.js');
const FS = require('../src/feature-switch-model.js');
const { escapeHtml } = require('../src/model.js');

const today = '2026-10-08';
const order = (id, stage, extra = {}) => ({ id, num: 'L-' + id, client: 'Client ' + id, amount: 1000, currency: 'USD', stage, productType: '定制盒', updated: '2026-10-0' + id, ...extra });
const chat = (name, lines) => ({ type: 'chat', channel: 'WhatsApp', time: lines.at(-1).at, contact: lines.at(-1).from, lines: lines.map((l, i) => ({ key: name + i, ...l })) });
const line = (at, dir, text, from = 'Anna') => ({ at, dir, text, from: dir === 'in' ? from : 'Me' });
function build(state, extra = {}) {
  return W.markup({ state, today, hour: 9, me: 'Kris', B, OM, TM, bucket: (c) => L.bucket(c), WA, mail: null, ...extra }, escapeHtml);
}
const base = () => ({
  orders: [order('1', 'quote'), order('2', 'production', { next: '寄产前样' }), order('3', 'shipment', { currency: 'CNY', amount: 5000 }), order('4', 'done'), order('5', 'quote', { isDraft: true })],
  customers: {
    Late: { client: 'Late', owner: 'Mia', nextFollow: '2026-10-05', history: [{ type: 'followup', text: '等报价' }] },
    Now: { client: 'Now', nextFollow: '2026-10-08', history: [] },
    Later: { client: 'Later', nextFollow: '2026-11-01' },
    Gone: { client: 'Gone', nextFollow: '2026-10-01', laiBucket: 'trash' },
  },
  laiTasks: [{ id: 't1', title: '今天的事', date: '2026-10-08' }, { id: 't2', title: '以后的事', date: '2026-10-20' }, { id: 't3', title: '做完了', date: '2026-10-08', done: true }, { id: 't4', title: '早该做的事', date: '2026-10-06' }],
});

// ---------- 问候 ----------
test('the greeting follows the local hour and names the account', () => {
  assert.deepEqual([0, 6, 11, 12, 17, 18, 23].map(W.greeting), ['早上好', '早上好', '早上好', '下午好', '下午好', '晚上好', '晚上好']);
  assert.match(build(base(), { hour: 14, me: 'Mia' }), /<h1 class="k-pageheader-title">下午好，Mia<\/h1>/);
  assert.match(build(base(), { hour: 20, me: '' }), /<h1 class="k-pageheader-title">晚上好<\/h1>/);
  assert.match(build(base()), /10 月 8 日 周四/, 'the date line');
});

test('the one-line summary uses real counts: things to do, overdue follow-ups and the amount still to collect', () => {
  const html = build(base());
  // 逾期跟进 Late、今天到期跟进 Now、早该做的事、今天的事 ＝ 4 件；逾期客户 1 位；待收款：USD 订单 1、2 笔没收完（第 2 笔没付）
  assert.match(html, /今天有 <b class="wb-num">4<\/b> 件事要处理，<b class="wb-num">1<\/b> 位客户跟进逾期，还有 <b class="wb-num">\$2,000<\/b>（另有 1 种币种） 没收回来/);
  const quiet = build({ orders: [], customers: {}, laiTasks: [] });
  assert.match(quiet, /今天没有要紧事/);
  assert.doesNotMatch(quiet, /跟进逾期|没收回来/);
});

// ---------- 今天先做：合并和排序 ----------
const queueInput = () => ({
  today,
  follow: [
    ['Today Co', { owner: 'Amy', nextFollow: '2026-10-08', history: [] }],
    ['Late 1', { owner: 'Amy', nextFollow: '2026-10-07', history: [{ text: '寄了样品' }] }],
    ['Late 3', { owner: 'Amy', nextFollow: '2026-10-05', history: [] }],
    ['Later', { nextFollow: '2026-10-09' }],
    ['No date', {}],
  ],
  tasks: [
    { id: 'a', title: '今天任务', date: '2026-10-08' },
    { id: 'b', title: '逾期两天的任务', date: '2026-10-06' },
    { id: 'c', title: '明天', date: '2026-10-09' },
    { id: 'd', title: '做完', date: '2026-10-08', done: true },
    { id: 'e', title: '没日期' },
  ],
  chats: [
    { name: 'Old Chat', waiting: true, contact: 'Ann', lastText: 'older', lastAt: '2026-10-06T10:00:00' },
    { name: 'New Chat', waiting: true, contact: 'Bo', lastText: 'newer', lastAt: '2026-10-07T10:00:00' },
    { name: 'Answered', waiting: false, contact: 'Cy', lastText: 'ok', lastAt: '2026-10-07T12:00:00' },
  ],
  mails: [
    { subject: 'Read mail', seen: true, from: { name: 'X' }, date: '2026-10-07T08:00:00' },
    { subject: 'Older unread', seen: false, from: { name: 'Y' }, date: '2026-10-06T08:00:00' },
    { subject: 'Newer unread', seen: false, from: { name: 'Z', address: 'z@e.example' }, date: '2026-10-07T08:00:00' },
  ],
});

test('今天先做 merges four sources and orders them: overdue, then 等你回复, then due today, then unread mail', () => {
  const q = W.queue(queueInput());
  assert.deepEqual(q.rows.map((r) => `${r.kind}:${r.tag}:${r.title}`), [
    'follow:逾期 3 天:跟进 Late 3',
    'task:逾期 2 天:逾期两天的任务',
    'follow:逾期 1 天:跟进 Late 1',
    'waiting:等你回复:New Chat 发来 WhatsApp 消息',
    'waiting:等你回复:Old Chat 发来 WhatsApp 消息',
    'follow:今天到期:跟进 Today Co',
    'task:今天到期:今天任务',
    'mail:未读邮件:Newer unread',
    'mail:未读邮件:Older unread',
  ]);
  assert.equal(q.overdueCustomers, 2, 'only customers count as 逾期跟进 in the summary');
  assert.equal(q.shown.length, 8, 'nine rows, the list is cut at eight');
  assert.equal(q.more, 1);
});

test('the queue never lists future follow-ups, finished tasks, tasks without a date, answered chats or mail already read', () => {
  const text = JSON.stringify(W.queue(queueInput()).rows.map((r) => r.title));
  for (const gone of ['Later', 'No date', '明天', '做完', '没日期', 'Answered', 'Read mail']) assert.ok(!text.includes(gone), gone);
});

test('the queue shows at most 8 rows and says how many are left; the limit can be changed', () => {
  const follow = Array.from({ length: 12 }, (_, i) => [`C${String(i).padStart(2, '0')}`, { nextFollow: '2026-10-01', history: [] }]);
  const q = W.queue({ today, follow, tasks: [], chats: [], mails: [] });
  assert.equal(W.QUEUE_LIMIT, 8);
  assert.equal(q.rows.length, 12);
  assert.equal(q.shown.length, 8);
  assert.equal(q.more, 4);
  assert.equal(W.queue({ today, follow, limit: 3 }).shown.length, 3);
  const html = build({ orders: [], customers: Object.fromEntries(follow), laiTasks: [] });
  assert.equal((html.match(/class="wb-row wb-q /g) || []).length, 8);
  assert.match(html, /还有 4 件没列出/);
  assert.match(html, /今天有 <b class="wb-num">12<\/b> 件事要处理/);
});

test('each queue row has one action that opens the right place', () => {
  const html = build({ ...base(), customers: { Late: base().customers.Late } }, { mail: { items: [{ subject: 'Hi', seen: false, from: { name: 'Emma' }, date: '2026-10-07T09:00:00' }] } });
  assert.match(html, /<button type="button" class="k-btn k-btn--sm wb-act" data-biz-customer="Late" data-biz-followup>写跟进<\/button>/);
  assert.match(html, /<button type="button" class="k-btn k-btn--sm wb-act" data-biz-edit-task="t4">看任务<\/button>/);
  assert.match(html, /<button type="button" class="k-btn k-btn--sm wb-act" data-biz-go="mail:unread">打开<\/button>/);
  const chatState = { ...base(), customers: { 'Wa Co': { owner: 'Kris', history: [chat('wa', [line('2026-10-07T10:00:00', 'in', 'Can you ship?')])] } } };
  assert.match(build(chatState), /<button type="button" class="k-btn k-btn--sm wb-act" data-biz-chat="Wa Co">回复<\/button>/);
  assert.match(build(chatState), /等你回复/);
});

test('task rows keep the tick box that completes a task, and name the owner only when the account sees other people\'s work', () => {
  const state = { ...base(), laiTasks: [{ id: 'x1', title: '寄样', date: '2026-10-08', owner: 'Amy' }] };
  const html = build(state);
  assert.match(html, /data-biz-task="x1"/);
  assert.doesNotMatch(html, /待办 · Amy/, 'a 只看本人 account does not need the name');
  assert.match(build(state, { showOwner: true }), /待办 · Amy/);
  assert.doesNotMatch(build({ ...base(), laiTasks: [{ id: 'd', title: '做完了', date: '2026-10-08', done: true }] }), /data-biz-task=/);
});

test('empty queue: 今天没有要紧事 with a 添加任务 button', () => {
  const html = build({ orders: [], customers: {}, laiTasks: [] });
  assert.match(html, /<p class="k-empty-title">今天没有要紧事<\/p>/);
  assert.match(html, /<div class="k-empty"><p class="k-empty-title">[\s\S]*class="k-btn k-btn--sm wb-again" data-biz-action="new-task">添加任务/);
});

test('mail rows join the queue only after the list is read, and the page says while it waits', () => {
  assert.match(build(base(), { mail: null }), /正在读取邮件/);
  const loaded = build({ orders: [], customers: {}, laiTasks: [] }, { mail: { items: [{ subject: 'Quote <b>', seen: false, from: { name: 'Emma' }, date: '2026-10-07T09:12:00' }] } });
  assert.match(loaded, /未读邮件/);
  assert.match(loaded, /Quote &lt;b&gt;/);
  assert.doesNotMatch(loaded, /今天没有要紧事/);
  assert.match(build(base(), { mail: { error: true } }), /暂时读不到邮件/);
});

// ---------- 订单走到哪了 ----------
test('orderLine: unfinished orders sit at their stage, drafts are left out, 已完成 only counts', () => {
  const orders = [order('1', 'quote'), order('2', 'deposit'), order('3', 'deposit', { currency: 'EUR', amount: 500 }), order('4', 'done'), order('5', 'done', { amount: 200 }), order('6', 'quote', { isDraft: true }), order('7', 'mystery')];
  const line = W.orderLine(orders, B.stages);
  assert.deepEqual(line.stations.map((s) => [s.id, s.count]), [['quote', 1], ['deposit', 2], ['production', 0], ['balance', 0], ['shipment', 0], ['done', 2]]);
  assert.equal(line.liveCount, 3, 'the order with an unknown stage and the draft are not on the line');
  assert.equal(line.fillTo, 1, 'the line is filled up to the last stage that has an order');
  const done = line.stations.at(-1);
  assert.deepEqual(done.cards, []);
  assert.deepEqual([...done.totals], [['USD', 1200]]);
  assert.deepEqual([...line.liveTotals], [['USD', 2000], ['EUR', 500]], 'amounts per currency, never converted');
  assert.deepEqual(W.orderLine([order('1', 'done')], B.stages).stations.map((s) => s.count), [0, 0, 0, 0, 0, 1]);
  assert.equal(W.orderLine([order('1', 'done')], B.stages).fillTo, -1, 'only finished orders: nothing to fill');
  assert.equal(W.orderLine([], B.stages).total, 0);
});

test('orderLine: a stage shows 3 cards, the most recently changed first, and counts the rest', () => {
  const orders = ['1', '2', '3', '4', '5'].map((id) => order(id, 'production', { updated: '2026-10-0' + id }));
  const station = W.orderLine(orders, B.stages).stations[2];
  assert.equal(W.STAGE_CARD_LIMIT, 3);
  assert.deepEqual(station.cards.map((o) => o.id), ['5', '4', '3']);
  assert.equal(station.more, 2);
  assert.equal(station.count, 5);
});

test('the order line markup: stations in the stage order of business-model, cards open the order, 还有 N 笔 filters the list, 已完成 has no cards', () => {
  const orders = ['1', '2', '3', '4', '5'].map((id) => order(id, 'production', { updated: '2026-10-0' + id, next: id === '5' ? '很长的下一步'.repeat(12) : '' }));
  orders.push(order('9', 'done', { amount: 2500 }), order('8', 'quote', { client: 'A <b>' }));
  const html = build({ ...base(), orders });
  const labels = [...html.matchAll(/<h3>([^<]+?) <span class="wb-num">(\d+)<\/span><\/h3>/g)].map((m) => `${m[1]}${m[2]}`);
  assert.deepEqual(labels, B.stages.map((s) => s.label + ({ quote: 1, production: 5, done: 1 }[s.id] || 0)));
  assert.equal((html.match(/data-biz-order=/g) || []).length, 4, 'one card for 报价 and three for 生产中; none for 已完成');
  assert.match(html, /data-biz-order="5"/);
  assert.doesNotMatch(html, /data-biz-order="9"/);
  assert.match(html, /<button type="button" class="k-btn k-btn--ghost k-btn--sm wb-omore" data-biz-stage="production">还有 2 笔 ›<\/button>/);
  assert.match(html, /已完成 1 笔，USD 2,500/);
  assert.match(html, /A &lt;b&gt;/);
  assert.match(html, /还没写下一步/);
  assert.match(html, /很长的下一步(?:很长的下一步){4,}…/, 'a long next step is shortened in the text, not clipped by CSS');
  // fill: stations 2..3 (index 1..2) draw the left half, 1..2 draw the right half; the line stops at 生产中
  const cls = (id) => new RegExp(`<li class="([^"]*)" data-stage="${id}"`).exec(html)[1].split(' ');
  assert.ok(cls('production').includes('fl') && !cls('production').includes('fr'));
  assert.ok(cls('quote').includes('fr') && !cls('quote').includes('fl'));
  assert.ok(!cls('balance').includes('fl'));
  assert.ok(cls('done').includes('fin'));
});

test('the order line is hidden without order.view, and says so when there are no orders', () => {
  const can = (key) => key !== 'order.view';
  const none = build(base(), { can });
  assert.doesNotMatch(none, /订单走到哪了|data-biz-order=|data-biz-stage=/);
  assert.match(build({ orders: [], customers: {}, laiTasks: [] }), /还没有订单。新建订单后/);
});

// ---------- 钱和目标 ----------
test('钱和目标: this month\'s 成交 against the company target, 已收款 and 待收款 from the order totals, two small bars', () => {
  let state = { ...base(), orders: [order('1', 'quote', { amount: 3000, createdAt: '2026-10-02' }), order('2', 'shipment', { amount: 1000, createdAt: '2026-10-03' }), order('3', 'deposit', { amount: 2000, paidAmount: 500, createdAt: '2026-09-02' })] };
  state = TM.setTarget(state, { metric: 'amount', period: '2026-10', scope: 'company', currency: 'USD', value: 8000 });
  state = TM.setTarget(state, { metric: 'records', period: '2026-10', scope: 'company', value: 30 });
  const m = W.moneySummary({ state, today, B, TM, seeOrders: true, seeTeam: true });
  assert.equal(m.currency, 'USD');
  assert.deepEqual(m.deal, { actual: 4000, target: 8000, pct: 50, reached: false });
  assert.equal(m.collected, 1500, '已发货的按全额，其他按已收金额');
  assert.equal(m.due, 4500);
  assert.equal(m.dueOrders, 2);
  assert.equal(m.collectedPct, 25);
  assert.deepEqual(m.bars.map((b) => [b.label, b.target]), [['跟进记录', 30], ['新建客户', null]]);
  const html = build(state);
  assert.match(html, /本月成交/);
  assert.match(html, /\$4,000 <span class="wb-sub">\/ 目标 \$8,000<\/span>/);
  assert.match(html, /已收款（25%）/);
  assert.match(html, /待收款，2 笔订单/);
  assert.match(html, /<i style="width:50%">/);
  assert.match(html, /<em class="wb-num">0 \/ 30<\/em>/);
  assert.match(html, /<em class="wb-num">0 位（没设目标）<\/em>/);
});

test('钱和目标: no target says so; several currencies are never converted, only counted with a link to 经营统计', () => {
  const state = { ...base() };
  assert.match(build(state), /本月还没设目标/);
  const html = build(state);
  assert.match(html, /另有 1 种币种，各币种分别统计、不折算/);
  assert.match(html, /到经营统计看/);
  assert.equal(W.moneySummary({ state, today, B, TM, seeOrders: true, seeTeam: true }).currency, 'USD', 'three USD orders against one CNY order');
});

test('钱和目标: the main currency is the one with the most orders; then the bigger total; then the code', () => {
  const pick = (orders) => W.moneySummary({ state: { orders, laiSettings: { defaultCurrency: 'GBP' } }, today, B, TM, seeOrders: true, seeTeam: false }).currency;
  assert.equal(pick([order('1', 'quote', { amount: 100 }), order('2', 'quote', { amount: 100 }), order('3', 'quote', { amount: 90000, currency: 'CNY' })]), 'USD', 'amounts of different currencies cannot be compared, so counts decide');
  assert.equal(pick([order('1', 'quote', { amount: 100 }), order('2', 'quote', { amount: 300, currency: 'EUR' })]), 'EUR', 'same count: the bigger total');
  assert.equal(pick([order('1', 'quote', { amount: 100 }), order('2', 'quote', { amount: 100, currency: 'EUR' })]), 'EUR', 'still tied: EUR < USD');
  assert.equal(pick([]), 'GBP', 'no orders: the default currency');
});

test('钱和目标 follows permissions: no team data hides the 成交 block and the bars; no order view hides 已收款', () => {
  const noTeam = build(base(), { can: (k) => k !== 'team.view' });
  assert.doesNotMatch(noTeam, /本月成交|wb-mini|经营统计/);
  assert.match(noTeam, /已收款/);
  const noOrders = build(base(), { can: (k) => k !== 'order.view' });
  assert.match(noOrders, /本月成交/);
  assert.doesNotMatch(noOrders, /已收款|待收款/);
  const neither = build(base(), { can: (k) => k !== 'order.view' && k !== 'team.view' });
  assert.doesNotMatch(neither, /钱和目标/);
  const noMoney = build(base(), { can: (k) => k !== 'order.view' });
  assert.doesNotMatch(noMoney, /没收回来/, 'the summary sentence does not mention money the account cannot see');
});

// ---------- 商机 ----------
const oppState = () => {
  const opp = (id, extra) => ({ id, name: 'Opp ' + id, client: 'C', amount: 100, currency: 'USD', ...extra });
  return { ...base(), laiOpportunities: [opp('a', { stage: 'open', amount: 1000 }), opp('b', { stage: 'unpaid', amount: 500 }), opp('c', { stage: 'lost', amount: 200 }), opp('d', { stage: 'done', amount: 300 }), opp('e', { stage: 'open', amount: 50, currency: 'EUR' })] };
};

test('商机: one bar per stage, length follows the amount, won stages are green and lost is grey', () => {
  const html = build(oppState());
  const row = (label) => new RegExp(`<div class="wb-fr ([a-z]*)"><span class="wb-fl">${label}</span><div class="wb-bar"><i style="width:(\\d+)%"></i></div><em class="wb-num">(\\d+) 个</em><em class="wb-num">([^<]+)</em>`).exec(html);
  assert.deepEqual(row('未成单').slice(1), ['', '100', '1', '$1,000']);
  assert.deepEqual(row('付款未到账').slice(1), ['', '50', '1', '$500']);
  assert.deepEqual(row('待付尾款').slice(1), ['won', '0', '0', '$0']);
  assert.deepEqual(row('已完成').slice(1), ['won', '30', '1', '$300']);
  assert.deepEqual(row('输单').slice(1), ['lost', '20', '1', '$200']);
  assert.match(html, /4 个 · \$1,800（不含输单）/);
  assert.match(html, /另有 1 个其他币种的商机/);
});

test('商机: a stage with a card but no amount still draws a sliver; no opportunities says so', () => {
  const state = { ...base(), laiOpportunities: [{ id: 'z', name: 'Z', client: 'C', amount: 0, currency: 'USD', stage: 'open' }, { id: 'y', name: 'Y', client: 'C', amount: 900, currency: 'USD', stage: 'done' }] };
  assert.match(build(state), /未成单<\/span><div class="wb-bar"><i style="width:3%">/);
  assert.match(build(base()), /还没有商机。/);
});

// ---------- 客户来消息 ----------
test('chatSummaries reads the real chat history: waiting means the customer spoke last; the latest inbound line is kept', () => {
  const state = {
    customers: {
      'A Co': { owner: 'Kris', contact: 'Anna', history: [chat('a', [line('2026-10-06T09:00:00', 'in', 'old q'), line('2026-10-07T09:00:00', 'out', 'answer'), line('2026-10-07T10:00:00', 'in', 'thanks!')])] },
      'B Co': { owner: 'Kris', history: [chat('b', [line('2026-10-07T11:00:00', 'in', 'price?', 'Bo'), line('2026-10-07T12:00:00', 'out', 'sent')])] },
      'Hidden Co': { owner: 'Other', history: [chat('h', [line('2026-10-07T13:00:00', 'in', 'secret')])] },
      'No Chat': { history: [{ type: 'note', text: 'n' }] },
    },
  };
  const rows = W.chatSummaries(state, WA, (name, c) => c.owner !== 'Other');
  assert.deepEqual(rows.map((r) => [r.name, r.waiting, r.inText, r.lastText]), [['B Co', false, 'price?', 'sent'], ['A Co', true, 'thanks!', 'thanks!']]);
  assert.equal(rows[0].contact, 'Bo');
  assert.deepEqual(W.chatSummaries(state, null), []);
});

test('客户来消息: WhatsApp lines and mails merged by time, newest first, each with a channel badge, at most 5', () => {
  const chats = [{ name: 'Wa One', contact: 'Ann', inText: 'hello', inAt: '2026-10-07T12:00:00' }, { name: 'Wa Two', contact: 'Bo', inText: 'hi', inAt: '2026-10-05T12:00:00' }];
  const mails = [
    { subject: 'Sub 1', seen: false, from: { name: 'Cy', address: 'cy@known.example' }, date: '2026-10-07T13:00:00' },
    { subject: 'Sub 2', seen: true, from: { address: 'dee@x.example' }, date: '2026-10-06T13:00:00' },
    { subject: 'Sub 3', seen: true, from: { name: 'Ed' }, date: '2026-10-04T13:00:00' },
    { subject: 'Sub 4', seen: true, from: { name: 'Fy' }, date: '2026-10-03T13:00:00' },
  ];
  const items = W.inbox({ chats, mails, customerByEmail: new Map([['cy@known.example', 'Known Co']]) });
  assert.deepEqual(items.map((i) => [i.ch, i.name, i.who]), [['mail', 'Known Co', 'Cy'], ['wa', 'Wa One', 'Ann'], ['mail', 'dee@x.example', ''], ['wa', 'Wa Two', 'Bo'], ['mail', 'Ed', '']]);
  assert.equal(W.INBOX_LIMIT, 5);
  assert.deepEqual(items.map((i) => i.open), [{ type: 'go', value: 'mail:unread' }, { type: 'customer', value: 'Wa One' }, { type: 'go', value: 'mail:inbox' }, { type: 'customer', value: 'Wa Two' }, { type: 'go', value: 'mail:inbox' }]);
  const index = W.emailIndex({ customers: { 'Known Co': { email: 'CY@known.example' }, 'Via Contact': { contacts: [{ email: 'Zed@x.example' }] }, Gone: { email: 'g@x.example', laiBucket: 'trash' } } }, (c) => L.bucket(c));
  assert.equal(index.get('cy@known.example'), 'Known Co');
  assert.equal(index.get('zed@x.example'), 'Via Contact');
  assert.equal(index.has('g@x.example'), false);
});

test('the 客户来消息 card shows the badges and opens the customer or the mail; switches and permissions remove the sources', () => {
  const state = { ...base(), customers: { 'Wa Co': { owner: 'Kris', history: [chat('w', [line('2026-10-07T10:00:00', 'in', 'Need <b>PI</b>', 'Ann')])] } } };
  const mail = { items: [{ subject: 'Re: order', seen: true, from: { name: 'Emma', address: 'emma@x.example' }, date: '2026-10-07T11:00:00' }] };
  const html = build(state, { mail });
  assert.match(html, /<span class="k-badge wb-ch wa" aria-label="WhatsApp">WA<\/span>/);
  assert.match(html, /<span class="k-badge wb-ch ml" aria-label="邮件">邮件<\/span>/);
  assert.match(html, /class="wb-row wb-m" data-biz-customer="Wa Co"/);
  assert.match(html, /class="wb-row wb-m" data-biz-go="mail:inbox"/);
  assert.match(html, /Need &lt;b&gt;PI&lt;\/b&gt;/);
  const noMail = build(state, { mail, can: (k) => k !== 'mail.view' });
  assert.doesNotMatch(noMail, /wb-ch ml|mail:inbox|mail:unread/);
  assert.match(noMail, /wb-ch wa/);
  const noChat = build(state, { mail, can: (k) => k !== 'chat.view' });
  assert.doesNotMatch(noChat, /wb-ch wa|data-biz-chat/);
  assert.match(noChat, /wb-ch ml/);
  const neither = build(state, { mail, can: (k) => k !== 'chat.view' && k !== 'mail.view' });
  assert.doesNotMatch(neither, /客户来消息/);
});

test('module switches: an off module draws no block, no button and no queue rows of its own', () => {
  const state = { ...oppState(), customers: { 'Wa Co': { owner: 'Kris', history: [chat('w', [line('2026-10-07T10:00:00', 'in', 'hello')])] } } };
  const mail = { items: [{ subject: 'Hi', seen: false, from: { name: 'Emma' }, date: '2026-10-07T11:00:00' }] };
  const off = (...ids) => ({ ...state, ...ids.reduce((s, id) => FS.set(s, id, false), {}) });
  const full = build(state, { mail });
  for (const marker of ['商机', 'data-biz-go="opp-new"', 'data-biz-go="mail:inbox"', 'data-biz-chat', 'data-biz-go="analysis"', '本月成交']) assert.ok(full.includes(marker), marker);
  assert.doesNotMatch(build(off('opp'), { mail }), /商机|opp-new|data-biz-go="opportunities"/);
  const noMail = build(off('mail'), { mail });
  assert.doesNotMatch(noMail, /mail:inbox|mail:unread|未读邮件|wb-ch ml/);
  assert.match(noMail, /data-biz-chat/);
  const noChat = build(off('chat'), { mail });
  assert.doesNotMatch(noChat, /data-biz-chat|等你回复|wb-ch wa/);
  const noTeam = build(off('team'), { mail });
  assert.doesNotMatch(noTeam, /本月成交|data-biz-go="analysis"|跟进记录/);
  assert.match(noTeam, /订单走到哪了/);
  assert.match(noTeam, /今天先做/, 'orders and the queue are never switchable');
});

// ---------- 其他 ----------
test('every button the workbench draws is handled by the controller', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
  const state = { ...oppState(), orders: [...['1', '2', '3', '4', '5'].map((id) => order(id, 'production')), order('9', 'done')], customers: { ...base().customers, 'Wa Co': { owner: 'Kris', history: [chat('w', [line('2026-10-07T10:00:00', 'in', 'hello')])] } } };
  const html = build(state, { mail: { items: [{ subject: 'Hi', seen: false, from: { name: 'Emma' }, date: '2026-10-07T11:00:00' }] } });
  for (const go of new Set([...html.matchAll(/data-biz-go="([^"]+)"/g)].map((m) => m[1]))) {
    const key = go.startsWith('mail:') ? 'mail:' : go;
    if (go === 'opp-new' || go.startsWith('mail:')) assert.ok(ui.includes(`"${key}"`), go);
    else assert.ok(/^(order-list|customers|calendar|opportunities|analysis|team-goals)$/.test(go), go);
  }
  for (const action of new Set([...html.matchAll(/data-biz-action="([^"]+)"/g)].map((m) => m[1]))) assert.ok(ui.includes(`action === "${action}"`), action);
  for (const [attr, handler] of [['biz-order', 'd.bizOrder'], ['biz-customer', 'd.bizCustomer'], ['biz-chat', 'd.bizChat'], ['biz-edit-task', 'd.bizEditTask'], ['biz-stage', 'd.bizStage'], ['biz-task', 'e.target.dataset.bizTask']]) {
    assert.ok(html.includes(`data-${attr}=`), `${attr} is drawn`);
    assert.ok(ui.includes(handler), `${attr} is handled`);
  }
  assert.match(ui, /ctx\.openChat \? ctx\.openChat\(d\.bizChat\)/);
});

test('the three top buttons follow permissions and the 商机 switch', () => {
  assert.match(build(base()), /data-biz-action="new-task">添加任务[\s\S]*data-biz-go="opp-new">新建商机[\s\S]*k-btn k-btn--primary" data-biz-action="new-order">新建订单/);
  const none = build(base(), { can: (k) => k !== 'opp.create' && k !== 'order.create' });
  assert.doesNotMatch(none, /opp-new|新建订单/);
  assert.match(none, /添加任务/);
  assert.doesNotMatch(build({ ...base(), ...FS.set({}, 'opp', false) }), /opp-new/);
});

test('names and titles are escaped', () => {
  const state = { orders: [order('1', 'quote', { client: '<img src=x>' })], customers: { '<b>Co</b>': { nextFollow: '2026-10-01', history: [{ text: '<script>1</script>' }] } }, laiTasks: [{ id: 'q"', title: '<i>t</i>', date: '2026-10-08' }] };
  const html = build(state, { me: '<Me>' });
  assert.doesNotMatch(html, /<img src=x>|<script>|<b>Co<\/b>|<i>t<\/i>|<Me>/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test('the markup stays inside .wb and uses the layout classes the CSS and the overlap test rely on', () => {
  const html = build(base());
  assert.match(html, /^<div class="wb">/);
  for (const cls of ['wb-hello', 'wb-grid1', 'wb-queue', 'wb-moneyp', 'wb-orders', 'wb-grid2', 'wb-opp', 'wb-msgs']) assert.ok(html.includes(cls), cls);
  assert.equal((html.match(/class="k-card wb-panel /g) || []).length, 5, 'five panels: queue, money, orders, opportunities, messages');
  for (const part of ['summary', 'queue', 'messages']) assert.ok(html.includes(`data-wb="${part}"`), part + ' can be swapped after the mail list arrives');
});
