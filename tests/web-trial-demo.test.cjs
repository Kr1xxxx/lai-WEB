const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const OM = require('../src/opportunity-model.js');
const TM = require('../src/team-model.js');
const B = require('../src/business-model.js');

function sandbox(stored) {
  const store = new Map(stored || []);
  const ctx = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    LaiOpportunityModel: OM, LaiTeamModel: TM, LaiBusinessModel: B,
    Response, URLSearchParams, Promise, JSON, Date, fetch: async () => { throw new Error('unexpected network call'); },
  };
  ctx.window = ctx;
  return { ctx: vm.createContext(ctx), store };
}
const run = (ctx, file) => vm.runInContext(read(file), ctx, { filename: file });

async function inbox(ctx, box = 'inbox') {
  const response = await ctx.fetch(`/api/mail/messages?folder=${box}`);
  return (await response.json()).items;
}

test('the demo mailbox is only eyelash companies from the US and Europe, with a USD 50,000 order among them', async () => {
  const { ctx } = sandbox();
  run(ctx, 'scripts/web-trial/mail-demo.js');
  const items = await inbox(ctx);
  assert.ok(items.length >= 8, '要有足够多的邮件');
  assert.ok(items.some((m) => /USD 50,000/.test(m.subject) && m.from.address === 'charlotte@londonlashpro.example'));
  assert.ok(items.filter((m) => !m.seen).length >= 4);
  for (const m of items) assert.match(m.from.address, /\.example$/, '示例邮箱都用 .example 域名，不会撞到真实公司');
  assert.ok((await inbox(ctx, 'sent')).length >= 4);
  assert.ok(!items.some((m) => /LED|downlight|lamp/i.test(m.subject)), '旧的灯具示例已经换掉');
});

test('every demo sender is a demo customer, so the mail page links each message to a customer', async () => {
  const { ctx, store } = sandbox();
  run(ctx, 'scripts/web-trial/mail-demo.js');
  run(ctx, 'scripts/web-trial/demo-seed.js');
  const data = JSON.parse(store.get('lai-web-trial-v1')).data;
  const emails = new Set(Object.values(data.customers).map((c) => c.email));
  const senders = new Set((await inbox(ctx)).map((m) => m.from.address).filter((a) => a !== 'procurement@londonlashpro.example'));
  for (const address of senders) assert.ok(emails.has(address), address + ' 没有对应的示例客户');
  assert.ok(Object.hasOwn(data.customers, 'London Lash Pro'));
});

test('the seed fills the workbench: orders in several stages, a USD 50,000 deal, follow-ups and goals', () => {
  const { ctx, store } = sandbox();
  run(ctx, 'scripts/web-trial/demo-seed.js');
  const saved = JSON.parse(store.get('lai-web-trial-v1'));
  const data = saved.data;
  assert.equal(saved.revision, 1);
  assert.deepEqual(Object.keys(data.customers).length, 7);
  assert.ok(new Set(data.orders.map((o) => o.stage)).size >= 5, '订单分布在多个阶段');
  assert.ok(data.orders.every((o) => o.currency === 'USD' && o.paidAmount <= o.amount));
  const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // 示例数据按本地日期生成，测试也按本地日期比，不受时区影响
  const board = OM.board(data, {}, localDay(new Date()));
  assert.ok(board.columns.find((c) => c.id === 'open').count >= 4);
  assert.ok(data.laiOpportunities.some((o) => o.amount === 50000 && o.client === 'London Lash Pro'));
  assert.equal(data.laiTasks, undefined, 'no demo tasks: 协同 is gone (D-031)');
  const today = new Date();
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const goals = TM.overview(data, month).goals;
  assert.ok(goals.amount?.[0].actual > 0, '本月金额目标有进度');
  const late = Object.values(data.customers).filter((c) => c.nextFollow <= localDay(today));
  assert.ok(late.length >= 3, '待跟进客户里有今天到期和已逾期的');
});

test('the seed runs once and never overwrites the visitor\'s own data', () => {
  const own = { data: { orders: [{ id: 'mine', num: 'X-1', client: 'Mine', amount: 1 }], customers: {}, trashOrders: [], deletedOrders: [] }, revision: 7 };
  const a = sandbox([['lai-web-trial-v1', JSON.stringify(own)]]);
  run(a.ctx, 'scripts/web-trial/demo-seed.js');
  assert.equal(JSON.parse(a.store.get('lai-web-trial-v1')).data.orders[0].id, 'mine');
  const b = sandbox();
  run(b.ctx, 'scripts/web-trial/demo-seed.js');
  const first = b.store.get('lai-web-trial-v1');
  b.store.set('lai-web-trial-v1', JSON.stringify({ data: { orders: [], customers: {} }, revision: 9 }));
  run(b.ctx, 'scripts/web-trial/demo-seed.js');
  assert.equal(JSON.parse(b.store.get('lai-web-trial-v1')).revision, 9, '清空后不会又被放回示例数据');
  assert.ok(first);
  const c = sandbox([['lai-web-trial-v1', JSON.stringify({ data: { orders: [], customers: {}, laiSettings: { theme: 'pink' } }, revision: 3 })]]);
  run(c.ctx, 'scripts/web-trial/demo-seed.js');
  const kept = JSON.parse(c.store.get('lai-web-trial-v1'));
  assert.equal(kept.data.laiSettings.theme, 'pink', '已选的主题保留');
  assert.equal(kept.revision, 3);
  assert.equal(Object.keys(kept.data.customers).length, 7);
});

test('the 测试数据 panel script is valid, every id it looks up is in its own markup, and it only uses the data stand-in API', () => {
  const source = read('scripts/web-trial/data-panel.js');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'data-panel.js' }));
  const looked = [...source.matchAll(/\$\('(lai-web-[a-z-]+)'\)/g)].map((m) => m[1]);
  assert.ok(looked.length >= 8);
  for (const id of new Set(looked)) assert.ok(source.includes(`id="${id}"`), `markup is missing #${id}`);
  const api = new Set([...source.matchAll(/\btrial\.([a-zA-Z]+)/g)].map((m) => m[1]));
  for (const name of api) assert.ok(['persistent', 'stats', 'snapshot', 'restore', 'clear'].includes(name), `unknown API trial.${name}`);
  assert.doesNotMatch(source, /试用数据/, '改名为测试数据');
  assert.doesNotMatch(source, /lai-web-data-button/, '不再有左栏悬浮按钮');
  assert.match(source, /closest\('\[data-action="web-trial-data"\]'\)/, '入口是设置中心里的那一项');
  // every action that replaces data asks for a second click first
  for (const id of ['lai-web-demo', 'lai-web-restore-button', 'lai-web-clear']) assert.match(source, new RegExp(`armed\\(\\$\\('${id}'\\)`));
});

test('the seed carries a few synthetic WhatsApp chats in the shape the 沟通 page reads, for customers that exist', () => {
  const WA = require('../src/whatsapp-model.js');
  const WUI = require('../src/whatsapp-ui.js');
  const { ctx, store } = sandbox();
  run(ctx, 'scripts/web-trial/demo-seed.js');
  const data = JSON.parse(store.get('lai-web-trial-v1')).data;
  const withChat = Object.entries(data.customers).filter(([, c]) => (c.history || []).some((h) => h.type === 'chat'));
  assert.deepEqual(withChat.map(([name]) => name).sort(), ['London Lash Pro', 'Velvet Lash Co.']);
  for (const [name, profile] of withChat) {
    const entries = profile.history.filter((h) => h.type === 'chat');
    assert.ok(entries.length >= 1);
    for (const entry of entries) {
      assert.equal(entry.channel, 'WhatsApp');
      assert.equal(entry.subtype, 'whatsapp');
      assert.ok(entry.lines.length >= 1 && entry.lines.every((l) => l.key && ['in', 'out'].includes(l.dir) && Number.isFinite(Date.parse(l.at))));
      assert.match(entry.text, /^WhatsApp 聊天 \d+ 条（发出 \d+，收到 \d+）/);
      assert.ok(WA.toE164(entry.chatRef.peer), name + ' has a dialable peer');
    }
    assert.ok(profile.history.some((h) => h.type === 'followup'), 'the existing follow-up record is kept');
  }
  const rows = WUI.conversations(data, { canSee: () => true, me: 'Kris' });
  assert.deepEqual(rows.map((r) => r.name).sort(), ['London Lash Pro', 'Velvet Lash Co.']);
  assert.ok(rows.some((r) => r.waiting), 'one chat is waiting for a reply');
  // The data is demo text only: no real-looking addresses or numbers outside the fictional ranges.
  assert.ok(!JSON.stringify(withChat).match(/@(?!.*\.example)/));
});
