// Browser end-to-end test for the 工作台 layout: nothing overlaps, nothing is clipped in the order cards, and the page
// itself never scrolls sideways. The owner asked for exactly this ("注意不要 UI 重叠"). Panels are laid out by a grid, so this
// guards the grid, the order line (it scrolls inside its own panel) and the text that must wrap instead of being cut off.
// Windows: 1024, 1280, 1440, 1680 (plus a narrow 820 where the panels stack); themes: pink, orange, tech.
// Style follows topbar-overlap.e2e.mjs.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
const LONG_NAME = 'Extraordinarily Long Customer Name International Trading Company Limited (Shenzhen Branch)';
const LONG_NEXT = '等客户确认最终的包装设计稿并且安排第三方验货公司到工厂做出货前检查然后再通知财务开具尾款发票';

async function save(mutate) {
  const request = app.page.context().request;
  const state = await (await request.get(app.base + '/api/data')).json();
  state.data = mutate(state.data) || state.data;
  const res = await request.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
}

before(async () => {
  app = await startApp();
  await app.open('customers'); // the first page load sets the session cookie that the API calls below use
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  await save((data) => {
    const names = Object.keys(data.customers);
    names.slice(0, 3).forEach((name, i) => { data.customers[name].nextFollow = day(-(i + 1)); data.customers[name].owner = 'Kris'; });
    names.slice(3, 5).forEach((name) => { data.customers[name].nextFollow = day(0); });
    data.customers['WA Test Co'] = { client: 'WA Test Co', owner: 'Kris', history: [{ type: 'chat', channel: 'WhatsApp', time: iso(3), contact: 'Anna', text: 'WhatsApp 聊天', lines: [{ at: iso(3), from: 'Anna', dir: 'in', text: 'Can you hold the production slot for us until the end of the month?', key: 'e2e-1' }] }] };
    const order = (id, stage, extra = {}) => ({ id: 'wb-' + id, num: 'WB-' + id, client: 'Client ' + id, amount: 1000 + Number(id) * 100, currency: 'USD', stage, productType: '睫毛', createdAt: day(-2), orderMonth: day(0).slice(0, 7), updated: day(-Number(id) % 5), ...extra });
    data.orders = [
      order('1', 'quote', { client: LONG_NAME, next: LONG_NEXT }), order('2', 'quote'),
      ...['3', '4', '5', '6', '7'].map((id) => order(id, 'production', { next: id === '3' ? LONG_NEXT : '寄产前样' })),
      order('8', 'deposit'), order('9', 'balance', { amount: 123456789.5 }), order('10', 'shipment', { currency: 'EUR' }),
      order('11', 'done'), order('12', 'done'),
    ];
    // 待办随协同去掉了（D-031）；今天先做里的长文字改由一位名字很长、上次跟进写得很长的客户来撑。
    data.customers[LONG_NAME] = { client: LONG_NAME, owner: 'Kris', nextFollow: day(0), history: [{ type: 'followup', time: iso(30), text: LONG_NEXT }] };
    data.laiOpportunities = [
      { id: 'wb-o1', name: 'Opp 1', client: 'Opp Co A', amount: 80000, currency: 'USD', stage: 'open' },
      { id: 'wb-o2', name: 'Opp 2', client: 'Opp Co B', amount: 12000, currency: 'USD', stage: 'unpaid' },
      { id: 'wb-o3', name: 'Opp 3', client: 'Opp Co C', amount: 5000, currency: 'USD', stage: 'done' },
      { id: 'wb-o4', name: 'Opp 4', client: 'Opp Co D', amount: 700, currency: 'USD', stage: 'lost' },
    ];
    data.laiTargets = [{ metric: 'amount', period: day(0).slice(0, 7), owner: null, currency: 'USD', value: 50000 }, { metric: 'records', period: day(0).slice(0, 7), owner: null, currency: '', value: 30 }];
    return data;
  });
  await app.open('dashboard');
});
after(async () => { await app?.close(); });

const WIDTHS = [820, 1024, 1280, 1440, 1680];
const THEMES = ['pink', 'orange', 'tech', 'studio'];
const real = (errors) => errors.filter((e) => !/\/api\/mail\//.test(e));

// Everything measured inside the page, so a failure names the element.
function measure() {
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}${el.dataset?.stage ? '[' + el.dataset.stage + ']' : ''} "${(el.textContent || '').trim().slice(0, 18)}"`;
  const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const problems = [];
  const overlaps = (name, list) => {
    const boxes = list.map((el) => [el, box(el)]).filter(([, b]) => b.width > 0 && b.height > 0);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i][1], boxes[j][1])) problems.push(`${name}: ${label(boxes[i][0])} overlaps ${label(boxes[j][0])}`);
  };
  const wb = document.querySelector('.wb');
  if (!wb) return { problems: ['the page has no .wb'] };
  // 1. panels (and the greeting block) never intersect
  overlaps('blocks', [...wb.querySelectorAll('.wb-panel, .wb-hello')]);
  // 2. inside the greeting: heading block and the buttons; between the buttons
  overlaps('greeting', [...wb.querySelectorAll('.wb-hello > div, .wb-acts button')].filter((el) => !el.matches('.wb-acts')));
  // 3. queue and message rows: tag, text and button side by side, and the rows themselves
  for (const row of wb.querySelectorAll('.wb-row')) overlaps('row', [...row.children]);
  overlaps('queue rows', [...wb.querySelectorAll('.wb-queue .wb-row')]);
  overlaps('message rows', [...wb.querySelectorAll('.wb-msgs .wb-row')]);
  // 4. order line: stations, their cards and links never intersect; nothing is cut off inside a card
  overlaps('stations', [...wb.querySelectorAll('.wb-stn')]);
  overlaps('order cards', [...wb.querySelectorAll('.wb-ocard, .wb-omore, .wb-doneSum, .wb-stn h3')]);
  for (const card of wb.querySelectorAll('.wb-ocard')) {
    const cb = box(card);
    for (const el of [card, ...card.querySelectorAll('*')]) {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) problems.push(`clipped text in ${label(el)}: scroll ${el.scrollWidth}x${el.scrollHeight} client ${el.clientWidth}x${el.clientHeight}`);
      const b = box(el);
      if (b.right > cb.right + 0.5 || b.left < cb.left - 0.5 || b.bottom > cb.bottom + 0.5 || b.top < cb.top - 0.5) problems.push(`${label(el)} sticks out of its order card`);
      const style = getComputedStyle(el);
      if (style.textOverflow === 'ellipsis' || (style.webkitLineClamp && style.webkitLineClamp !== 'none')) problems.push(`${label(el)} truncates text with an ellipsis`);
    }
  }
  // 5. nothing but the order line sticks out of its panel on the right
  for (const panel of wb.querySelectorAll('.wb-panel')) {
    const pb = box(panel);
    for (const el of panel.querySelectorAll('*')) {
      if (el.closest('.wb-linescroll')) continue;
      const b = box(el);
      if (b.width > 0 && b.right > pb.right + 1) problems.push(`${label(el)} sticks out of ${label(panel)} by ${Math.round(b.right - pb.right)}px`);
    }
  }
  // 6. the page does not scroll sideways; the order line scrolls inside its own panel
  const main = document.querySelector('.main');
  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth + 1) problems.push(`the document scrolls sideways (${doc.scrollWidth} > ${innerWidth})`);
  if (main.scrollWidth > main.clientWidth + 1) problems.push(`.main scrolls sideways (${main.scrollWidth} > ${main.clientWidth})`);
  if (wb.scrollWidth > wb.clientWidth + 1) problems.push(`.wb is wider than its box (${wb.scrollWidth} > ${wb.clientWidth})`);
  const scroller = wb.querySelector('.wb-linescroll');
  const view = { panels: wb.querySelectorAll('.wb-panel').length, cards: wb.querySelectorAll('.wb-ocard').length, scrollsInside: !!scroller && scroller.scrollWidth > scroller.clientWidth + 1, columns: getComputedStyle(wb.querySelector('.wb-grid1')).gridTemplateColumns.split(' ').length };
  return { problems, view };
}

test('the dashboard has real content for the check: five panels, order cards, a "还有 N 笔" link', async () => {
  const { page } = app;
  await page.waitForSelector('.wb .wb-ocard');
  assert.equal(await page.locator('.wb-panel').count(), 5);
  assert.ok(await page.locator('.wb-omore').count() >= 1, 'five orders in 生产中: three cards and a link');
  assert.match(await page.locator('.wb-omore').first().innerText(), /还有 2 笔/);
  assert.match(await page.locator('.wb-hello').innerText(), /早上好|下午好|晚上好/);
});

test('no panels overlap, nothing is clipped in the order cards and the page never scrolls sideways (4 themes, 5 widths)', async () => {
  const { page } = app;
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await page.evaluate((t) => { const html = document.documentElement; html.dataset.theme = t; }, theme);
      await page.waitForTimeout(80);
      const { problems, view } = await page.evaluate(measure);
      assert.deepEqual(problems, [], `${theme} ${width}: ${problems.join(' | ')}`);
      assert.equal(view.panels, 5);
      assert.ok(view.cards >= 8, `${theme} ${width}: the order cards are there`);
      if (width >= 1024) assert.equal(view.columns, 2, `${theme} ${width}: queue and money sit side by side`);
      if (width <= 820) assert.equal(view.columns, 1, `${theme} ${width}: the panels stack in a narrow window`);
      if (width <= 820) assert.equal(view.scrollsInside, true, `${theme} ${width}: the order line scrolls inside its panel`);
    }
  }
  assert.deepEqual(real(app.errors), []);
});

test('long names and next steps wrap inside the order cards (no ellipsis) and the full text is still there', async () => {
  const { page } = app;
  await page.setViewportSize({ width: 1440, height: 900 });
  const cardText = await page.locator('.wb-ocard', { hasText: 'Extraordinarily Long' }).first().innerText();
  assert.ok(cardText.includes(LONG_NAME), 'the whole customer name is in the card');
  assert.match(cardText, /…$/m, 'the next step is shortened with … in the text itself');
  assert.ok(cardText.length < LONG_NAME.length + 80);
});
