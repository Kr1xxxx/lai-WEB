const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/role-model.js');
const M = require('../src/model.js');
const S = require('../src/segments.js');
const CS = require('../src/customer-settings-model.js');
const F = require('../src/customer-fields.js');
const EM = require('../src/export-model.js');
const EUI = require('../src/export-ui.js');

// 客户自定义字段进入列表、筛选、客群和导出（CF-2）。
function build() {
  let state = {
    laiSettings: { defaultOwner: 'Kris' },
    customers: {
      Acme: { client: 'Acme', country: '美国', source: '官网', owner: 'Amy', email: 'a@acme.example', history: [] },
      Beta: { client: 'Beta', country: '法国', source: '展会', owner: 'Amy', email: 'b@beta.example', history: [] },
      Cora: { client: 'Cora', country: '德国', source: '官网', owner: 'Amy', email: 'c@cora.example', history: [] },
    },
    orders: [],
  };
  state = CS.addCustomField(state, { name: '渠道', type: 'select', options: ['线上', '线下', '展会'] });
  state = CS.addCustomField(state, { name: '认证', type: 'multi', options: ['ISO', 'CE', 'FDA'] });
  state = CS.addCustomField(state, { name: '年采购额', type: 'number' });
  state = CS.addCustomField(state, { name: '签约日', type: 'date' });
  state = CS.addCustomField(state, { name: '工厂规模', type: 'text' });
  const id = Object.fromEntries(CS.customFieldSettings(state).customFields.map((f) => [f.name, f.id]));
  const put = (name, custom) => { state = M.upsertCustomer(state, name, { name, custom }); };
  put('Acme', { [id['渠道']]: '线上', [id['认证']]: ['ISO', 'CE'], [id['年采购额']]: '12000', [id['签约日']]: '2026-03-01', [id['工厂规模']]: '200 人' });
  put('Beta', { [id['渠道']]: '线下', [id['认证']]: ['FDA'], [id['年采购额']]: '800', [id['签约日']]: '2026-09-15', [id['工厂规模']]: '30 人' });
  return { state, id, col: (name) => 'custom:' + id[name] };
}
const rowsOf = (state) => S.enrich(M.buildCustomers(state), state);
const names = (rows) => rows.map((row) => row.name);

test('registry: each configured field becomes a custom:<id> column with name, type and options', () => {
  const { state, id, col } = build();
  const list = F.catalogFor(state);
  assert.equal(list.length, F.catalog.length + 5);
  assert.deepEqual(list.slice(0, F.catalog.length), [...F.catalog]);
  const custom = F.customColumns(state);
  assert.deepEqual(custom.map((f) => [f.id, f.label, f.type, f.fieldType]), [
    [col('渠道'), '渠道', 'text', 'select'], [col('认证'), '认证', 'text', 'multi'], [col('年采购额'), '年采购额', 'number', 'number'],
    [col('签约日'), '签约日', 'date', 'date'], [col('工厂规模'), '工厂规模', 'text', 'text'],
  ]);
  assert.deepEqual([...custom[0].options], ['线上', '线下', '展会']);
  assert.equal(custom[0].category, '自定义字段');
  assert.equal(custom[0].customId, id['渠道']);
  assert.equal(F.fieldFor(state, col('渠道')).label, '渠道');
  assert.equal(F.fieldFor(state, 'name').label, '公司名称');
  assert.equal(F.fieldFor(state, 'custom:ghost'), undefined);
  // Cached per settings object; a settings change gives a fresh list, no settings leaves the static catalog alone.
  assert.equal(F.catalogFor(state), F.catalogFor(state));
  assert.equal(F.catalogFor({}), F.catalog);
  assert.equal(F.catalogFor(null), F.catalog);
  const renamed = CS.renameCustomField(state, id['渠道'], '销售渠道');
  assert.equal(F.fieldFor(renamed, col('渠道')).label, '销售渠道');
  assert.equal(F.fieldFor(state, col('渠道')).label, '渠道', 'the old state is untouched');
  assert.equal(F.fieldFor(CS.deleteCustomField(state, id['渠道']), col('渠道')), undefined);
});

test('enrich puts custom values on the rows under custom:<id>; customers without a value stay empty', () => {
  const { state, col } = build();
  const rows = Object.fromEntries(rowsOf(state).map((row) => [row.name, row]));
  assert.equal(rows.Acme[col('渠道')], '线上');
  assert.deepEqual(rows.Acme[col('认证')], ['ISO', 'CE']);
  assert.equal(rows.Acme[col('年采购额')], 12000);
  assert.equal(rows.Beta[col('签约日')], '2026-09-15');
  assert.equal(col('渠道') in rows.Cora, false);
  // Without any configured field rows are as before.
  const plain = { customers: { A: { client: 'A', history: [] } }, orders: [] };
  assert.ok(!Object.keys(S.enrich(M.buildCustomers(plain), plain)[0]).some((key) => key.startsWith('custom:')));
});

test('columns: custom ids survive normalizeColumns with the state, are dropped without it or after deletion', () => {
  const { state, id, col } = build();
  const order = ['name', 'email', col('渠道'), col('年采购额')];
  assert.deepEqual(F.normalizeColumns({ order }, state).order, order);
  assert.deepEqual(F.normalizeColumns({ order }).order, ['name', 'email'], 'unknown without the state');
  const deleted = CS.deleteCustomField(state, id['渠道']);
  assert.deepEqual(F.normalizeColumns({ order }, deleted).order, ['name', 'email', col('年采购额')]);
  assert.deepEqual(F.normalizeColumns({ order, frozen: [col('渠道')] }, state).frozen, ['name', col('渠道')]);
});

test('sort by custom columns: text, number (numeric not alphabetical), date, multi; empty values last', () => {
  const { state, col } = build();
  const rows = rowsOf(state);
  const sorted = (field, dir) => names(F.sortRows(rows, field, dir, state));
  assert.deepEqual(sorted(col('年采购额'), 'asc'), ['Beta', 'Acme', 'Cora']);
  assert.deepEqual(sorted(col('年采购额'), 'desc'), ['Acme', 'Beta', 'Cora']);
  assert.deepEqual(sorted(col('签约日'), 'asc'), ['Acme', 'Beta', 'Cora']);
  assert.deepEqual(sorted(col('签约日'), 'desc'), ['Beta', 'Acme', 'Cora']);
  assert.deepEqual(sorted(col('渠道'), 'asc').slice(2), ['Cora']);
  assert.deepEqual(sorted(col('认证'), 'asc'), ['Beta', 'Acme', 'Cora'], 'a multi value sorts by its joined text (FDA before ISO、CE)');
  // Not knowing the field (no state) leaves the order alone.
  assert.deepEqual(names(F.sortRows(rows, col('年采购额'), 'asc')), names(rows));
});

test('quick filter: choice fields match the whole option; text contains; an unknown custom field finds nothing', () => {
  const { state, col } = build();
  const rows = rowsOf(state);
  const quick = (field, query) => names(F.filter(rows, { field, query }, state));
  assert.deepEqual(quick(col('渠道'), '线上'), ['Acme']);
  assert.deepEqual(quick(col('认证'), 'ISO'), ['Acme']);
  assert.deepEqual(quick(col('认证'), 'is'), [], 'a part of an option is not the option');
  assert.deepEqual(quick(col('工厂规模'), '200'), ['Acme']);
  assert.deepEqual(quick('custom:ghost', 'x'), []);
  assert.deepEqual(names(F.filter(rows, { field: col('渠道'), query: '' }, state)), names(rows), 'an empty value filters nothing');
  // A stale quick field (the field was deleted) falls back to 公司名称 instead of hiding every row.
  const cleaned = F.sanitizeFilters(state, { field: 'custom:ghost', query: 'Acme' });
  assert.equal(cleaned.field, 'name');
  assert.equal(F.sanitizeFilters(state, { field: col('渠道'), query: '线上' }).field, col('渠道'));
});

test('advanced filter and segment rules: choice, number, date and text operators', () => {
  const { state, col } = build();
  const rows = rowsOf(state);
  const by = (field, op, value, match = 'all') => names(S.filterByRules(rows, { match, rules: [{ field, op, value }] }, new Date('2026-10-01'), state));
  assert.deepEqual(by(col('渠道'), 'in', '线上，展会'), ['Acme'], 'full-width commas work');
  assert.deepEqual(by(col('渠道'), 'in', '线上, 线下'), ['Acme', 'Beta']);
  assert.deepEqual(by(col('渠道'), 'notIn', '线上'), ['Beta'], 'a customer with no value is not a "not in"');
  assert.deepEqual(by(col('认证'), 'containsAny', 'FDA, CE'), ['Acme', 'Beta']);
  assert.deepEqual(by(col('认证'), 'containsAll', 'ISO,CE'), ['Acme']);
  assert.deepEqual(by(col('认证'), 'containsAll', 'ISO,FDA'), []);
  assert.deepEqual(by(col('渠道'), 'empty', ''), ['Cora']);
  assert.deepEqual(by(col('认证'), 'notEmpty', ''), ['Acme', 'Beta']);
  assert.deepEqual(by(col('年采购额'), 'gte', '1000'), ['Acme']);
  assert.deepEqual(by(col('年采购额'), 'lte', '800'), ['Beta']);
  assert.deepEqual(by(col('签约日'), 'after', '2026-06-01'), ['Beta']);
  assert.deepEqual(by(col('签约日'), 'before', '2026-06-01'), ['Acme']);
  assert.deepEqual(by(col('签约日'), 'olderDays', '100'), ['Acme']);
  assert.deepEqual(by(col('工厂规模'), 'contains', '人'), ['Acme', 'Beta']);
  assert.deepEqual(by(col('工厂规模'), 'notContains', '200'), ['Beta']);
  assert.deepEqual(names(S.filterByRules(rows, { match: 'any', rules: [
    { field: col('渠道'), op: 'in', value: '线下' }, { field: col('年采购额'), op: 'gte', value: '10000' }] }, new Date(), state)), ['Acme', 'Beta']);
  assert.deepEqual(names(S.filterByRules(rows, { match: 'all', rules: [
    { field: col('渠道'), op: 'in', value: '线下' }, { field: 'country', op: 'eq', value: '法国' }] }, new Date(), state)), ['Beta']);
});

test('segment rules validate against the field type and need the state to know custom fields', () => {
  const { state, col } = build();
  const rows = rowsOf(state);
  const rules = (rule) => ({ match: 'all', rules: [rule] });
  assert.throws(() => S.filterByRules(rows, rules({ field: col('渠道'), op: 'in', value: 'x' })), /未知的客群条件字段/);
  assert.throws(() => S.filterByRules(rows, rules({ field: col('渠道'), op: 'contains', value: 'x' }), new Date(), state), /不支持此条件运算/);
  assert.throws(() => S.filterByRules(rows, rules({ field: col('认证'), op: 'in', value: 'ISO' }), new Date(), state), /不支持此条件运算/);
  assert.throws(() => S.filterByRules(rows, rules({ field: col('渠道'), op: 'in', value: ' ， ' }), new Date(), state), /请填写条件值/);
  assert.throws(() => S.filterByRules(rows, rules({ field: col('年采购额'), op: 'gte', value: 'abc' }), new Date(), state), /有效数字/);
  assert.throws(() => S.filterByRules(rows, rules({ field: col('签约日'), op: 'after', value: 'soon' }), new Date(), state), /有效日期/);
  assert.deepEqual(S.operatorsFor(state, col('渠道')), ['in', 'notIn', 'empty', 'notEmpty']);
  assert.deepEqual(S.operatorsFor(state, col('认证')), ['containsAny', 'containsAll', 'empty', 'notEmpty']);
  assert.deepEqual(S.operatorsFor(state, col('年采购额')), ['eq', 'neq', 'gte', 'lte', 'empty', 'notEmpty']);
  assert.deepEqual(S.operatorsFor(state, 'country'), ['eq', 'neq', 'contains', 'notContains', 'empty', 'notEmpty']);
  assert.deepEqual(S.operatorsFor(state, 'custom:ghost'), []);
  assert.equal(S.catalogFor(state).length, S.catalog.length + 5);
  assert.equal(S.catalogFor({}), S.catalog);
});

test('a 客群 on a custom field saves, tags customers in 客群 and follows later value changes', () => {
  const { state, id, col } = build();
  const saved = S.upsertSegment(state, 'seg1', { name: '线上客户', kind: 'rules', match: 'all', rules: [{ field: col('渠道'), op: 'in', value: '线上' }] });
  assert.deepEqual(names(S.resolveMembers(rowsOf(saved), saved.previewSegments[0], undefined, saved)), ['Acme']);
  assert.deepEqual(rowsOf(saved).find((row) => row.name === 'Acme').segments, ['线上客户']);
  assert.deepEqual(rowsOf(saved).find((row) => row.name === 'Beta').segments, []);
  const changed = M.upsertCustomer(saved, 'Beta', { name: 'Beta', custom: { [id['渠道']]: '线上' } });
  assert.deepEqual(names(S.resolveMembers(rowsOf(changed), changed.previewSegments[0], undefined, changed)).sort(), ['Acme', 'Beta']);
  assert.throws(() => S.upsertSegment(state, 'seg2', { name: '坏', kind: 'rules', rules: [{ field: 'custom:ghost', op: 'eq', value: 'x' }] }), /未知的客群条件字段/);
});

test('deleting a custom field used by a 客群 is blocked and names the 客群; archived ones count; unused fields delete', () => {
  const { state, id, col } = build();
  let next = S.upsertSegment(state, 'seg1', { name: '线上客户', kind: 'rules', match: 'all', rules: [{ field: col('渠道'), op: 'in', value: '线上' }] });
  next = S.upsertSegment(next, 'seg2', { name: '大客户', kind: 'rules', match: 'all', rules: [{ field: col('年采购额'), op: 'gte', value: '1000' }, { field: col('渠道'), op: 'notIn', value: '线下' }] });
  assert.throws(() => CS.deleteCustomField(next, id['渠道']), /客群「线上客户」「大客户」的条件用到了这个字段/);
  assert.throws(() => CS.deleteCustomField(next, id['年采购额']), /客群「大客户」/);
  assert.equal(CS.customFieldSettings(CS.deleteCustomField(next, id['认证'])).customFields.length, 4, 'an unused field still deletes');
  // Archiving does not free the field (restoring would break the 客群).
  const archived = S.archiveSegment(next, 'seg1');
  assert.throws(() => CS.deleteCustomField(archived, id['渠道']), /客群「线上客户」/);
  // Remove the conditions and the field can go; stored values stay on the customers.
  const edited = S.upsertSegment(S.upsertSegment(next, 'seg1', { name: '线上客户', kind: 'rules', rules: [{ field: 'country', op: 'eq', value: '美国' }] }),
    'seg2', { name: '大客户', kind: 'rules', rules: [{ field: 'country', op: 'eq', value: '美国' }] });
  const gone = CS.deleteCustomField(edited, id['渠道']);
  assert.equal(CS.customFieldSettings(gone).customFields.some((f) => f.id === id['渠道']), false);
  assert.equal(gone.customers.Acme.custom[id['渠道']], '线上');
  assert.equal(next.previewSegments.length, 2, 'the failed delete changed nothing');
});

test('role gate: a custom field hidden for the role is not a column, filter, sort or rule field; read-only still shows', () => {
  const { state, id, col } = build();
  const asSales = (fields) => {
    const withRole = R.updateRole(state, 'sales', { fields: { customer: fields, pool: {} } });
    return R.switchTo(withRole, R.settings(withRole).members.find((m) => m.name === 'Amy').id);
  };
  const admin = F.gate(state, 'customer');
  assert.equal(admin.hiddenColumns().size, 0);
  assert.equal(admin.hiddenFilters().size, 0);
  assert.equal(admin.columnVisible(col('渠道')), true);

  const sales = asSales({ ['custom.' + id['渠道']]: 'hidden', ['custom.' + id['认证']]: 'read' });
  const gate = F.gate(sales, 'customer');
  assert.equal(gate.columnVisible(col('渠道')), false);
  assert.equal(gate.columnVisible(col('认证')), true, 'read-only is visible');
  assert.equal(gate.columnVisible(col('年采购额')), true);
  assert.ok(gate.hiddenColumns().has(col('渠道')));
  assert.ok(!gate.hiddenColumns().has(col('认证')));
  assert.ok(gate.hiddenFilters().has(col('渠道')));
  assert.ok(!gate.hiddenFilters().has(col('认证')));
  // A hidden quick filter or sort field is dropped, so the result cannot give the value away.
  const cleaned = F.sanitizeFilters(sales, { field: col('渠道'), query: '线上', sortField: col('渠道'), sortDirection: 'asc' });
  assert.equal(cleaned.query, '');
  assert.equal(cleaned.sortField, '');
  assert.equal(F.sanitizeFilters(sales, { field: col('认证'), query: 'ISO', sortField: col('认证'), sortDirection: 'asc' }).sortField, col('认证'));
  // The editor/list save path also keeps the locked value (guardProfile handles custom.*).
  const guarded = F.guardProfile(sales, state.customers.Acme, { ...state.customers.Acme, custom: { ...state.customers.Acme.custom, [id['渠道']]: '线下' } }, 'customer');
  assert.equal(guarded.custom[id['渠道']], '线上');
});

test('export: custom columns follow the chosen columns and 全部字段, use the right cell types and obey the role gate', () => {
  const { state, id, col } = build();
  const rows = rowsOf(state);
  const chosen = ['name', col('渠道'), col('认证'), col('年采购额'), col('签约日'), col('工厂规模')];
  const sheet = EM.customerRows(rows, { columns: chosen, state, contactsCell: false });
  assert.deepEqual(sheet.header, ['公司名称', '渠道', '认证', '年采购额', '签约日', '工厂规模']);
  const acme = sheet.data[rows.findIndex((row) => row.name === 'Acme')];
  assert.deepEqual(acme, ['Acme', '线上', 'ISO、CE', 12000, '2026-03-01', '200 人']);
  const cora = sheet.data[rows.findIndex((row) => row.name === 'Cora')];
  assert.deepEqual(cora, ['Cora', '', '', '', '', ''], 'blank, not 0');
  // Without the state the custom ids are unknown and left out.
  assert.deepEqual(EM.customerRows(rows, { columns: chosen, contactsCell: false }).header, ['公司名称']);
  // 全部字段 includes them, after the built-in ones.
  const all = EM.customerRows(rows, { state, contactsCell: false });
  assert.deepEqual(all.header.slice(-5), ['渠道', '认证', '年采购额', '签约日', '工厂规模']);
  assert.equal(all.header.length, F.catalog.length + 5);
  // Hidden for the role: not exported, with a list setting or with 全部字段.
  const withRole = R.updateRole(state, 'sales', { fields: { customer: { ['custom.' + id['渠道']]: 'hidden' }, pool: {} } });
  const sales = R.switchTo(withRole, R.settings(withRole).members.find((m) => m.name === 'Amy').id);
  const gate = F.gate(sales, 'customer');
  assert.deepEqual(EM.customerRows(rows, { columns: chosen, state: sales, gate, contactsCell: false }).header, ['公司名称', '认证', '年采购额', '签约日', '工厂规模']);
  assert.ok(!EM.customerRows(rows, { state: sales, gate, contactsCell: false }).header.includes('渠道'));
  // The export dialog passes the state through for both column choices.
  const ctx = { state, gate: F.gate(state, 'customer'), columns: chosen, scopes: { filtered: rows, all: rows } };
  assert.deepEqual(EUI.sheetsFor('customer', rows, ctx, { columns: 'list' })[0].header.slice(0, 3), ['公司名称', '渠道', '认证']);
  assert.ok(EUI.sheetsFor('customer', rows, ctx, { columns: 'all' })[0].header.includes('工厂规模'));
  // A text value that looks like a formula is guarded like any other text cell.
  const formula = M.upsertCustomer(state, 'Cora', { name: 'Cora', custom: { [id['工厂规模']]: '=1+1' } });
  const formulaSheet = EM.customerRows(rowsOf(formula), { columns: ['name', col('工厂规模')], state: formula, contactsCell: false });
  assert.match(EM.toCSV(formulaSheet), /Cora,'=1\+1/);
});

test('performance: 10,000 customers with custom values enrich, sort, filter and match a rule quickly', () => {
  const { state, id, col } = build();
  const customers = {};
  for (let i = 0; i < 10000; i += 1) {
    customers['C' + i] = { client: 'C' + i, country: i % 2 ? '美国' : '法国', owner: 'Amy', history: [],
      custom: { [id['渠道']]: ['线上', '线下', '展会'][i % 3], [id['年采购额']]: i, [id['认证']]: i % 2 ? ['ISO'] : ['CE', 'FDA'] } };
  }
  const big = { ...state, customers };
  const t0 = Date.now();
  const rows = rowsOf(big);
  assert.equal(rows.length, 10000);
  assert.equal(names(F.sortRows(rows, col('年采购额'), 'desc', big))[0], 'C9999');
  assert.equal(F.filter(rows, { field: col('渠道'), query: '线上' }, big).length, 3334);
  assert.equal(S.filterByRules(rows, { match: 'all', rules: [{ field: col('认证'), op: 'containsAny', value: 'ISO' }, { field: col('年采购额'), op: 'gte', value: 9000 }] }, new Date(), big).length, 500);
  assert.ok(Date.now() - t0 < 5000, 'took ' + (Date.now() - t0) + ' ms');
});

test('quick filter list: custom fields come after the built-in ones, choice fields use a dropdown, hidden ones are left out', () => {
  const UI = require('../src/customer-list-ui.js');
  const row = { name: 'A', country: '美国', tags: [], owner: 'Kris', orderCount: 1, orders: [], history: [], followed: false };
  const extra = [{ id: 'custom:c1', label: '渠道', options: ['线上', '线下'] }, { id: 'custom:c2', label: '工厂规模', options: null }, { id: 'custom:c3', label: '认证', options: ['ISO'] }];
  const render = (filters, more = {}) => UI.render({ rows: [row], p: { items: [row], total: 1, page: 1, pageCount: 1 }, filters: { group: 'all', field: 'name', query: '', owner: '', ...filters },
    selected: new Set(), pageSize: 20, segments: [], groupTab: 'groups', expanded: new Set(), team: 'team', icon: (n) => `<svg data-icon="${n}"></svg>`,
    escape: M.escapeHtml, countryLabel: F.countryLabel, tableMarkup: () => '<table></table>', extraQuickFields: extra, ...more });
  const select = (html) => html.match(/<select data-searchable="inline" id="search-field"[^>]*>([\s\S]*?)<\/select>/)[1];
  const labels = (html) => [...select(html).matchAll(/<option [^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(labels(render({})).slice(-4), ['是否关注', '渠道', '工厂规模', '认证']);
  const choice = render({ field: 'custom:c1', query: '线下' }).match(/<div class="quick-value">([\s\S]*?)<\/div>/)[1];
  assert.match(choice, /<select id="search"/);
  assert.match(choice, /<option value="线下" selected>线下<\/option>/);
  assert.doesNotMatch(choice, /<input id="search"/);
  assert.match(render({ field: 'custom:c2' }).match(/<div class="quick-value">([\s\S]*?)<\/div>/)[1], /<input id="search"/, 'a text field keeps the text box');
  assert.ok(!labels(render({}, { hiddenFilterFields: new Set(['custom:c1']) })).includes('渠道'));
  assert.ok(labels(render({}, { extraQuickFields: [] })).every((label) => !['渠道', '认证'].includes(label)));
});
