const test = require('node:test');
const assert = require('node:assert/strict');
const CS = require('../src/customer-settings-model.js');
const UI = require('../src/customer-settings-ui.js');
const M = require('../src/model.js');
const L = require('../src/modules.js');
const S = require('../src/segments.js');
const I = require('../src/customer-import.js');

const T = '2026-10-09T08:00:00.000Z';
const base = () => ({
  orders: [],
  customers: {
    Acme: { client: 'Acme', country: '美国', owner: 'Kris', customerStage: '未成单', customerType: '贸易商', previewGroup: '重点 / A类', history: [] },
    Beta: { client: 'Beta', country: '英国', owner: 'Kris', history: [] },
    Pooled: { client: 'Pooled', country: '法国', owner: '', laiBucket: 'pool', laiPreviousOwner: 'Kris', history: [] },
    Gone: { client: 'Gone', country: '法国', owner: 'Kris', laiBucket: 'trash', history: [] },
  },
  laiSettings: {},
});
const frozen = (state) => JSON.stringify(state);

test('defaults: the five existing stages, the 14 types, nothing blocked, no cap, only country on the duplicates page', () => {
  const s = CS.get({});
  assert.deepEqual(s.stages, ['未成单', '付款未到账', '待付尾款.', '已完成', '输单']);
  assert.equal(s.types.length, 14);
  assert.deepEqual([s.groups, s.blacklist], [[], []]);
  assert.deepEqual(s.caps, { defaultLimit: 0, perOwner: {} });
  assert.deepEqual(s.duplicateFields, ['country']);
  assert.equal(s.layout, 'left-small');
});

test('stages: names are trimmed and unique, order can change, input state is never modified', () => {
  const s0 = base();
  const before = frozen(s0);
  let s = CS.addStage(s0, '  试样中 ');
  assert.equal(frozen(s0), before);
  assert.equal(CS.get(s).stages.at(-1), '试样中');
  assert.throws(() => CS.addStage(s, '试样中'), /同名/);
  assert.throws(() => CS.addStage(s, '  '), /请填写/);
  assert.throws(() => CS.addStage(s, 'a/b'), /不能有/);
  s = CS.moveItem(s, 'stages', '试样中', -1);
  assert.deepEqual(CS.get(s).stages.slice(-2), ['试样中', '输单']);
  assert.equal(CS.moveItem(s, 'stages', '未成单', -1), s, 'moving the first one up changes nothing');
});

test('stages: renaming follows the customers (with a history line); deleting one in use is refused', () => {
  const s0 = base();
  const renamed = CS.renameStage(s0, '未成单', '待报价', T);
  assert.equal(renamed.customers.Acme.customerStage, '待报价');
  assert.match(renamed.customers.Acme.history[0].text, /客户阶段改名：未成单 → 待报价/);
  assert.equal(renamed.customers.Beta.history.length, 0);
  assert.throws(() => CS.deleteStage(s0, '未成单'), /1 位客户在用/);
  assert.deepEqual(CS.get(CS.deleteStage(s0, '输单')).stages.includes('输单'), false);
  assert.equal(CS.stageUse(s0, '未成单'), 1);
});

test('types: add, rename (customers follow), delete only when unused', () => {
  const s0 = base();
  assert.throws(() => CS.deleteType(s0, '贸易商'), /1 位客户在用/);
  const renamed = CS.renameType(s0, '贸易商', '经销贸易商', T);
  assert.equal(renamed.customers.Acme.customerType, '经销贸易商');
  assert.ok(CS.get(CS.deleteType(s0, '零售商')).types.every((t) => t !== '零售商'));
  assert.throws(() => CS.addType(s0, '贸易商'), /同名/);
});

test('groups: two levels only, renames follow customers, delete is refused while in use', () => {
  let s = CS.addGroup(base(), { name: '重点' });
  const top = CS.get(s).groups[0];
  s = CS.addGroup(s, { name: 'A类', parentId: top.id });
  assert.throws(() => CS.addGroup(s, { name: 'A类', parentId: top.id }), /同名/);
  assert.throws(() => CS.addGroup(s, { name: 'x', parentId: 'nope' }), /没有找到/);
  assert.deepEqual(CS.groupPaths(CS.get(s).groups), ['重点', '重点 / A类']);
  const child = CS.get(s).groups[0].children[0];
  assert.throws(() => CS.deleteGroup(s, child.id), /1 位客户在“重点 \/ A类”里/);
  assert.throws(() => CS.deleteGroup(s, top.id), /1 位客户/);
  const renamed = CS.editGroup(s, top.id, { name: '核心' }, T);
  assert.equal(renamed.customers.Acme.previewGroup, '核心 / A类');
  const childRenamed = CS.editGroup(renamed, child.id, { name: 'S类' }, T);
  assert.equal(childRenamed.customers.Acme.previewGroup, '核心 / S类');
  const moved = { ...childRenamed, customers: { ...childRenamed.customers, Acme: { ...childRenamed.customers.Acme, previewGroup: '' } } };
  assert.deepEqual(CS.get(CS.deleteGroup(moved, child.id)).groups[0].children, []);
});

test('groups: members limit who can use a group; required child blocks a top-level pick', () => {
  let s = CS.addGroup(base(), { name: '重点', members: ['Mia'] });
  const top = CS.get(s).groups[0];
  s = CS.addGroup(s, { name: 'A类', parentId: top.id });
  s = CS.editGroup(s, top.id, { childRequired: true });
  assert.deepEqual(CS.groupChoices(s, 'Kris', '').map((c) => c.value), []);
  assert.deepEqual(CS.groupChoices(s, 'Mia', '').map((c) => c.value), ['重点', '重点 / A类']);
  assert.deepEqual(CS.groupChoices(s, 'Kris', '重点 / A类').map((c) => c.value), ['重点', '重点 / A类'], 'the current value is kept');
  assert.throws(() => CS.checkGroup(s, '重点 / A类', 'Kris', ''), /只对指定的跟进人开放/);
  assert.throws(() => CS.checkGroup(s, '重点', 'Mia', ''), /要求选到子分组/);
  assert.throws(() => CS.checkGroup(s, '重点 / Z类', 'Mia', ''), /不是现有的分组/);
  assert.doesNotThrow(() => CS.checkGroup(s, '重点 / A类', 'Mia', ''));
  assert.doesNotThrow(() => CS.checkGroup(s, '重点', 'Kris', '重点'), 'an unchanged value is never re-checked');
  assert.doesNotThrow(() => CS.checkGroup(s, '手动客群', 'Kris', ''), 'manual segment names are checked elsewhere');
});

test('the editor group picker accepts configured groups and still rejects unknown names', () => {
  let s = CS.addGroup(base(), { name: '重点' });
  s = { ...s, previewSegments: [{ id: 'm1', name: '手动', kind: 'manual', members: ['Beta'] }] };
  const picked = S.setEditorGroup(s, 'Beta', '重点', '');
  assert.equal(picked.customers.Beta.previewGroup, '重点');
  assert.deepEqual(picked.previewSegments[0].members, [], 'leaving the manual group removes the member');
  assert.throws(() => S.setEditorGroup(s, 'Beta', '不存在', ''), /手动分组/);
  assert.equal(S.setEditorGroup(s, 'Beta', '手动', '').customers.Beta.previewGroup, '');
});

test('blacklist: whole emails and @domains, case-insensitive, bad entries refused', () => {
  let s = CS.addBlacklist(base(), 'Bad@Example.com');
  s = CS.addBlacklist(s, '@spam.test');
  assert.deepEqual(CS.get(s).blacklist, ['bad@example.com', '@spam.test']);
  assert.throws(() => CS.addBlacklist(s, 'bad@example.com'), /已在黑名单/);
  assert.throws(() => CS.addBlacklist(s, 'spam.test'), /完整邮箱/);
  assert.equal(CS.blacklistHit(s, 'BAD@example.com'), 'bad@example.com');
  assert.equal(CS.blacklistHit(s, 'x@SPAM.test'), '@spam.test');
  assert.equal(CS.blacklistHit(s, 'ok@example.com'), '');
  assert.deepEqual(CS.get(CS.removeBlacklist(s, '@SPAM.test')).blacklist, ['bad@example.com']);
});

test('blacklist is enforced on create and on adding an email, but an email the customer already had is left alone', () => {
  const s = CS.addBlacklist(CS.addBlacklist(base(), '@spam.test'), 'old@acme.test');
  assert.throws(() => M.upsertCustomer(s, '', { name: 'New Co', country: '美国', source: '展会', email: 'x@spam.test' }, T), /黑名单/);
  assert.throws(() => M.upsertCustomer(s, 'Beta', { name: 'Beta', email: 'y@SPAM.test' }, T), /黑名单/);
  const had = { ...s, customers: { ...s.customers, Beta: { ...s.customers.Beta, email: 'old@acme.test', emails: ['old@acme.test'] } } };
  assert.doesNotThrow(() => M.upsertCustomer(had, 'Beta', { name: 'Beta', email: 'old@acme.test', note: '改备注' }, T));
  assert.doesNotThrow(() => M.upsertCustomer(s, '', { name: 'Fine Co', country: '美国', source: '展会', email: 'ok@fine.test' }, T));
});

test('blacklist is enforced by the import: the row is skipped with a plain reason', () => {
  const s = CS.addBlacklist({ orders: [], customers: {}, laiSettings: {} }, '@spam.test');
  const parsed = { headers: ['公司名称', '联系人昵称', '联系人邮箱', '国家地区'], rows: [['Bad Co', 'Bo', 'bo@spam.test', '法国'], ['Good Co', 'Gus', 'gus@good.test', '法国']], lineNumbers: [2, 3] };
  const out = I.applyImport(s, parsed, I.suggestMapping(parsed.headers), { duplicate: 'skip' }, T);
  assert.deepEqual(Object.keys(out.state.customers), ['Good Co']);
  assert.equal(out.result.skipped, 1);
  assert.match(out.details[0].reason, /黑名单/);
});

test('caps: 0 means unlimited; a limit counts only the owner’s active customers', () => {
  const s0 = base();
  assert.doesNotThrow(() => CS.assertCanTake(s0, 'Kris', 50));
  let s = CS.setCaps(s0, { defaultLimit: 2 });
  assert.equal(CS.ownerCount(s, 'Kris'), 2, 'pool and trash do not count');
  assert.equal(CS.limitFor(s, 'Kris'), 2);
  assert.throws(() => CS.assertCanTake(s, 'Kris', 1), /上限是 2/);
  assert.doesNotThrow(() => CS.assertCanTake(s, 'Mia', 2));
  s = CS.setCaps(s, { perOwner: { Kris: 5, Mia: 1 } });
  assert.doesNotThrow(() => CS.assertCanTake(s, 'Kris', 3));
  assert.throws(() => CS.assertCanTake(s, 'Kris', 4), /上限是 5/);
  s = CS.setCaps(s, { perOwner: { Kris: null } });
  assert.equal(CS.limitFor(s, 'Kris'), 2, 'blank follows the default again');
  assert.throws(() => CS.setCaps(s, { defaultLimit: -1 }), /整数/);
  assert.throws(() => CS.setCaps(s, { defaultLimit: 'abc' }), /整数/);
});

test('caps are enforced on create, owner change, batch assign and taking a customer back from the pool', () => {
  const s = CS.setCaps(base(), { defaultLimit: 2 });
  assert.throws(() => M.upsertCustomer(s, '', { name: 'N', country: '美国', source: '展会', owner: 'Kris' }, T), /上限是 2/);
  assert.doesNotThrow(() => M.upsertCustomer(s, '', { name: 'N', country: '美国', source: '展会', owner: 'Mia' }, T));
  assert.doesNotThrow(() => M.upsertCustomer(s, 'Acme', { name: 'Acme', owner: 'Kris', note: '同一个人，不算新增' }, T), 'editing a customer who already belongs to the owner is fine');
  const withMia = { ...s, customers: { ...s.customers, Mia1: { client: 'Mia1', owner: 'Mia', history: [] } } };
  assert.throws(() => M.batchSetOwner(withMia, ['Mia1'], 'Kris', T), /上限是 2/);
  assert.throws(() => L.moveCustomers(s, ['Pooled'], 'active', T), /上限是 2/);
  const roomy = CS.setCaps(s, { perOwner: { Kris: 3 } });
  const back = L.moveCustomers(roomy, ['Pooled'], 'active', T);
  assert.equal(L.bucket(back.customers.Pooled), 'active');
  assert.equal(back.customers.Pooled.owner, 'Kris');
});

test('duplicates tab: only known fields are kept, in catalog order; values come from the profile', () => {
  const s = CS.setDuplicateFields(base(), ['owner', 'bogus', 'country', 'customerType']);
  assert.deepEqual(CS.get(s).duplicateFields, ['country', 'owner', 'customerType']);
  assert.equal(CS.duplicateValue(s, 'Acme', 'customerType'), '贸易商');
  assert.equal(CS.duplicateValue(s, 'Nobody', 'owner'), '');
  assert.deepEqual(CS.get(CS.setDuplicateFields(s, [])).duplicateFields, []);
});

test('layout accepts only the two layouts', () => {
  assert.equal(CS.get(CS.setLayout(base(), 'left-large')).layout, 'left-large');
  assert.throws(() => CS.setLayout(base(), 'center'), /布局/);
  assert.equal(CS.get({ laiSettings: { customerSettings: { layout: 'junk' } } }).layout, 'left-small');
});

test('saved settings that were damaged read back as clean settings', () => {
  const s = CS.get({ laiSettings: { customerSettings: { stages: ['A', 'a', ' ', 'B'], blacklist: ['bad', 'ok@x.test', 'OK@x.test'], groups: [{ name: 'g', children: [{ name: 'c' }, { name: 'c' }], childRequired: true }, { name: 'g' }, { name: 'a/b' }], caps: { defaultLimit: -3, perOwner: { Kris: 'x', Mia: 7 } } } } });
  assert.deepEqual(s.stages, ['A', 'B']);
  assert.deepEqual(s.blacklist, ['ok@x.test']);
  assert.equal(s.groups.length, 1);
  assert.equal(s.groups[0].children.length, 1);
  assert.deepEqual(s.caps, { defaultLimit: 0, perOwner: { Mia: 7 } });
});

test('the settings page markup has seven tabs, escapes names and has no placeholder buttons', () => {
  const E = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let s = CS.addStage(base(), '<b>x');
  for (const tab of UI.TABS.map((t) => t.id)) {
    const html = UI.markup(s, { tab }, E, ['Kris', 'Mia']);
    assert.ok(html.includes(`data-cs-panel="${tab}"`), tab);
    assert.ok(!html.includes('data-feature'), 'no placeholder buttons');
    assert.ok(!html.includes('<b>x'), 'names are escaped');
  }
  assert.equal(UI.TABS.length, 7);
  const caps = UI.markup(s, { tab: 'caps' }, E, ['Kris', 'Mia']);
  assert.ok(caps.includes('name="cap:Kris"') && caps.includes('name="cap:Mia"'));
});

test('every data-cs-* control and form the settings page draws is handled by app.js', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const E = (v) => String(v);
  let s = CS.addGroup(CS.addBlacklist(base(), '@x.test'), { name: '组' });
  const html = UI.TABS.map((t) => UI.markup(s, { tab: t.id, editing: { kind: 'stages', key: '未成单' } }, E, ['Kris'])).join('') +
    UI.markup(s, { tab: 'types', editing: { kind: 'types', key: '贸易商' } }, E, []) + UI.groupForm(s, { id: CS.get(s).groups[0].id }, ['Kris'], E);
  const attrs = new Set([...html.matchAll(/data-(cs-[a-z-]+)/g)].map((m) => m[1]).filter((n) => n !== 'cs-panel' && n !== 'cs-form'));
  const camel = (n) => n.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (const name of attrs) assert.ok(app.includes(`d.${camel(name)}`), `${name} has no handler in app.js`);
  const forms = new Set([...html.matchAll(/data-cs-form="([a-z-]+)"/g)].map((m) => m[1]));
  for (const form of forms) assert.ok(app.includes(`"${form}"`), `form ${form} has no handler in app.js`);
  assert.ok(app.includes('cs-group-form'));
});
