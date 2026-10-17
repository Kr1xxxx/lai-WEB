const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../src/business-model.js');
const L = require('../src/modules.js');
const R = require('../src/role-model.js');
const T = require('../src/task-rule-model.js');
const { escapeHtml } = require('../src/model.js');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// The 任务设置 page, registered as LaiExtraPages['task-settings'] and driven through the real business-ui.js registry.
function setup(state, { withRoles = false, withSwitch = false } = {}) {
  const calls = { mount: [], toast: [], saved: [] };
  const listeners = new Map();
  const document = {
    addEventListener(kind, callback) { const list = listeners.get(kind) || []; list.push(callback); listeners.set(kind, list); },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    querySelector(sel) { return sel === '.tr-page' && calls.mount.some((html) => html.includes('tr-page')) ? {} : null; },
  };
  const window = { LaiBusinessModel: B, LaiModules: L, LaiTaskRuleModel: T, ...(withRoles ? { LaiRoleModel: R } : {}), ...(withSwitch ? { LaiFeatureSwitch: require('../src/feature-switch-model.js') } : {}) };
  const context = { window, document, FormData: class {}, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(read('src/business-ui.js'), context);
  vm.runInContext(read('src/task-rule-ui.js'), context);
  const controller = window.LaiBusinessUI.create({
    getState: () => state, escape: escapeHtml, mount: (html) => calls.mount.push(html), dialog() {}, closeDialog() {},
    save: async (next) => { calls.saved.push(next); state = next; }, toast: (message) => calls.toast.push(message), navigate() {}, openCustomer() {},
    isActive: () => true,
  });
  const emit = (kind, event) => { for (const fn of listeners.get(kind) || []) fn(event); };
  const click = (dataset) => ({ target: { closest: (sel) => (sel === '[data-tr-action]' ? { dataset } : null), dataset }, preventDefault() {} });
  const toggle = (type, checked) => ({ target: { dataset: { trToggle: type }, checked, closest: () => null } });
  const field = (type, name, value) => ({ target: { dataset: { trField: name, type }, value, closest: () => null } });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { window, controller, calls, emit, click, toggle, field, flush, getState: () => state, last: () => calls.mount.at(-1) };
}

const seed = () => ({
  customers: {
    Stale: { client: 'Stale', owner: 'Kris', lastFollowup: '2020-01-01', history: [] },
    Quiet: { client: 'Quiet', owner: 'Mia', lastFollowup: '2020-02-01', history: [] },
  },
  orders: [], laiTasks: [], laiOpportunities: [],
  laiSettings: { defaultOwner: 'Kris' },
});

test('the page registers as LaiExtraPages[task-settings]: four rules, all off, with a preview before anything is turned on', () => {
  const h = setup(seed());
  assert.equal(typeof h.window.LaiExtraPages['task-settings'].render, 'function');
  assert.equal(h.window.LaiExtraPages['task-settings'].title, '任务设置');
  h.controller.navigate('task-settings');
  const html = h.last();
  assert.match(html, /<h1>任务设置<\/h1>/);
  for (const type of T.TYPES) assert.ok(html.includes(`data-tr-rule="${type}"`), type);
  assert.equal((html.match(/data-tr-toggle="[a-zA-Z]+"( checked)?/g) || []).filter((x) => x.includes('checked')).length, 0, 'every switch is off');
  assert.equal((html.match(/未开启/g) || []).length, 4);
  assert.match(html, /data-tr-preview="noFollow">现在会生成 <strong>2<\/strong> 个任务/);
  assert.match(html, /value="14" data-tr-field="days" data-type="noFollow"/);
  assert.match(html, /<option value="shipment" selected>已发货<\/option>/);
  assert.match(html, /还没有运行过/);
  assert.match(html, /还没有自动生成的待办/);
  assert.doesNotMatch(html, /回款|待收款/);
});

test('turning a rule on saves once: the rule, lastRun and the new tasks together; one toast, the list and the last run update', async () => {
  const h = setup(seed());
  h.controller.navigate('task-settings');
  h.emit('change', h.toggle('noFollow', true));
  await h.flush();
  assert.equal(h.calls.saved.length, 1);
  const state = h.getState();
  assert.equal(T.rules(state).find((rule) => rule.type === 'noFollow').enabled, true);
  assert.equal(T.config(state).lastRun, T.todayOf(new Date()));
  assert.deepEqual(state.laiTasks.map((task) => task.title).sort(), ['跟进 Quiet', '跟进 Stale']);
  assert.deepEqual(h.calls.toast, ['已生成 2 个待办']);
  assert.match(h.last(), /已开启/);
  assert.match(h.last(), /刚刚生成了 2 个待办/);
  assert.match(h.last(), /data-tr-task="auto-[^"]+"><td>跟进 Stale<\/td><td>Kris<\/td>/);
  assert.match(h.last(), /上次运行：\d{4}-\d{2}-\d{2}/);
  assert.match(h.last(), /data-tr-preview="noFollow">现在会生成 <strong>0<\/strong> 个任务/);
});

test('numbers and the stage are saved on change; a bad number shows the reason and saves nothing', async () => {
  const h = setup(seed());
  h.controller.navigate('task-settings');
  h.emit('change', h.field('noFollow', 'days', '30'));
  await h.flush();
  assert.equal(T.rules(h.getState())[0].days, 30);
  assert.equal(h.getState().laiTasks.length, 0, 'a rule that is off creates nothing when its numbers change');
  h.emit('change', h.field('noFollow', 'days', '0'));
  await h.flush();
  assert.equal(h.calls.saved.length, 1);
  assert.match(h.last(), /id="tr-error" role="alert">没跟进的天数请填 1 到 365 的整数/);
  h.emit('change', h.field('orderStage', 'stage', 'production'));
  await h.flush();
  assert.equal(T.rules(h.getState())[1].stage, 'production');
  assert.match(h.last(), /<option value="production" selected>/);
});

test('删除 on an auto task arms first, then removes it and remembers the key; nothing comes back on the next run', async () => {
  const h = setup(seed());
  h.controller.navigate('task-settings');
  h.emit('change', h.toggle('noFollow', true));
  await h.flush();
  const id = h.getState().laiTasks.find((task) => task.customer === 'Stale').id;
  h.emit('click', h.click({ trAction: 'delete', id }));
  assert.match(h.last(), /data-tr-action="delete" data-id="[^"]+">确认删除/);
  assert.equal(h.calls.saved.length, 1);
  h.emit('click', h.click({ trAction: 'delete', id }));
  await h.flush();
  assert.equal(h.calls.saved.length, 2);
  assert.ok(!h.getState().laiTasks.some((task) => task.id === id));
  assert.deepEqual(T.config(h.getState()).dismissed, ['noFollow|Stale|2020-01-01']);
  assert.equal(T.run(h.getState(), { now: new Date(Date.now() + 86400000 * 3) }).created.length, 0);
});

test('a 业务 account cannot open the page (settings.task is admin-only by default)', () => {
  const state = { ...seed(), customers: { a: { owner: 'Amy' } } };
  const sales = R.switchTo(state, R.settings(state).members.find((m) => m.name === 'Amy').id);
  const h = setup(sales, { withRoles: true });
  h.controller.navigate('task-settings');
  assert.doesNotMatch(h.last(), /data-tr-rule/);
  assert.match(h.last(), /没有权限/);
});

test('the files are wired into the build, the rail, the settings center, and the daily run sits beside the 公海 run in app.js', () => {
  const build = read('scripts/build.py'), template = read('src/template.html');
  for (const [marker, file] of [['TASK_RULE_MODEL', 'task-rule-model.js'], ['TASK_RULE_UI', 'task-rule-ui.js'], ['TASK_RULE_STYLE', 'task-rule.css']]) {
    assert.ok(template.includes(`<!--${marker}-->`), marker);
    assert.ok(build.includes(`('<!--${marker}-->','${file}'`), file);
  }
  assert.ok(template.indexOf('<!--LAI_BUSINESS_MODEL-->') < template.indexOf('<!--TASK_RULE_MODEL-->'));
  assert.ok(template.indexOf('<!--LAI_BUSINESS_UI-->') < template.indexOf('<!--TASK_RULE_UI-->'));
  const RM = require('../src/rail-menu.js');
  assert.equal(RM.sectionFor('task-settings').label, '协同');
  assert.deepEqual(RM.favoritable().filter((row) => row.menu === '协同').map((row) => row.id), ['route:calendar', 'route:task-settings']);
  const Hub = require('../src/settings-hub.js');
  const item = Hub.GROUPS.flatMap((g) => g.items).find((i) => i.id === 'task-settings');
  assert.deepEqual([item.open, item.perm], [['route', 'task-settings'], 'settings.task']);
  const app = read('src/app.js');
  const run = app.slice(app.indexOf('  async function autoRunTaskRules()'), app.indexOf('  // 页面开着跨过零点时也要按规则跑'));
  assert.match(run, /separateCustomerWindow \|\| pending \|\| hasUnsavedWork\(\) \|\| !TR\.due\(state\)/, 'same skip rules as the 公海 run');
  assert.match(run, /await persist\(result\.state\);/, 'customers are untouched, so the default field guard stays on');
  assert.doesNotMatch(run, /toast\(/, 'the daily run never toasts');
  assert.match(app, /poolAutoRunning = false;\s*[^\n]*\n\s*await autoRunTaskRules\(\);/, 'runs after the 公海 run on boot, focus and the 30-minute timer');
});

test('商机 switched off: the 商机快到结束日期 rule shows 商机已关闭, is locked, and nothing runs for it; the other rules still work', async () => {
  const FS = require('../src/feature-switch-model.js');
  const NOW = T.todayOf(new Date());
  const withOpp = () => ({
    ...seed(),
    laiOpportunities: [{ id: 'p1', name: 'Big deal', client: 'Stale', owner: 'Kris', endDate: NOW, flow: 'default', stage: 'open' }],
  });
  // opp on: the rule card is normal
  const on = setup(withOpp(), { withSwitch: true });
  on.controller.navigate('task-settings');
  assert.doesNotMatch(on.last(), /商机已关闭|data-tr-blocked/);
  // opp off, rule saved as on: card is locked and labelled, the saved switch is not touched
  let state = T.setRule(withOpp(), 'oppClose', { enabled: true, days: 7 });
  state = FS.set(state, 'opp', false);
  const h = setup(state, { withSwitch: true });
  h.controller.navigate('task-settings');
  const card = h.last().match(/<section[^>]*data-tr-rule="oppClose"[\s\S]*?<\/section>/)[0];
  assert.match(card, /data-tr-blocked="1"/);
  assert.match(card, /商机已关闭/);
  assert.match(card, /data-tr-toggle="oppClose"[^>]*disabled/);
  assert.match(card, /data-tr-field="days"[^>]*disabled/);
  assert.doesNotMatch(card, /data-tr-toggle="oppClose" checked/);
  assert.doesNotMatch(card, /现在会生成/);
  const noFollow = h.last().match(/<section[^>]*data-tr-rule="noFollow"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(noFollow, /disabled|tr-blocked/, 'other rules are normal');
  // a forged change event for the locked rule does nothing
  h.emit('change', h.toggle('oppClose', false));
  await h.flush();
  assert.equal(h.calls.saved.length, 0);
  assert.equal(T.rules(h.getState()).find((rule) => rule.type === 'oppClose').enabled, true);
  // switching another rule on runs it right away but leaves the blocked rule alone (no 商机 task, rule still on)
  h.emit('change', h.toggle('noFollow', true));
  await h.flush();
  const after = h.getState();
  const autos = after.laiTasks.filter((task) => task.auto).map((task) => task.auto.rule);
  assert.ok(autos.length > 0 && autos.every((rule) => rule === 'noFollow'), JSON.stringify(autos));
  assert.equal(T.rules(after).find((rule) => rule.type === 'oppClose').enabled, true, 'the saved switch stays on');
  // 商机 on again: the rule is live and runs when its turn comes
  const back = FS.set(after, 'opp', true);
  const run = FS.runTaskRules(T, { ...back, laiSettings: { ...back.laiSettings, taskRules: { ...back.laiSettings.taskRules, lastRun: '' } } });
  assert.ok(run.state.laiTasks.some((task) => task.auto && task.auto.rule === 'oppClose'));
});
