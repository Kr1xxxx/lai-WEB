// 商机设置：输单原因、商机类型、字段显示与必填、自定义字段，以及商机来源／来源线索／商机编号。
process.env.TZ = 'Asia/Taipei';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/opportunity-model.js');
const CS = require('../src/customer-settings-model.js');

const NOW = '2026-10-06T04:00:00.000Z', TODAY = '2026-10-06';
const base = {
  laiSettings: {defaultOwner: 'Amy'},
  customers: {'Alpha Co': {owner: 'Amy', contacts: ['Ann', 'Bo'], source: '展会'}, 'Beta Ltd': {owner: 'Bob'}},
  orders: []
};
const input = extra => ({client: 'Beta Ltd', amount: '100', currency: 'USD', endDate: '2026-11-05', owner: 'Amy', stage: 'open', ...extra});
const add = (state, id, extra, now = NOW) => O.upsert(state, id, input(extra), {now, today: now.slice(0, 10)});
const get = (state, id) => O.list(state).find(item => item.id === id);
const lose = (state, id, reason) => O.moveStage(state, id, 'lost', {lostReason: reason, now: NOW});
const withSources = state => {
  let s = CS.addSource(state, {name: '常规获客'});
  const top = CS.get(s).sources[0];
  s = CS.addSource(s, {name: '展会', parentId: top.id});
  s = CS.addSource(s, {name: '熟人介绍', parentId: top.id});
  return CS.addSource(s, {name: '社媒'});
};

// ---------------- 输单原因 ----------------
test('lost reasons: default list is the old fixed one and stays exported for back-compat', () => {
  assert.deepEqual(O.lostReasons(base), [...O.LOST_REASONS]);
  assert.deepEqual(O.lostReasons({}), [...O.LOST_REASONS]);
  assert.equal(O.LOST_REASONS.length, 6);
});

test('lost reasons: add, limits, duplicates (case-insensitive) and stored settings are kept alongside', () => {
  let s = O.addLostReason(base, '客户关系');
  assert.deepEqual(O.lostReasons(s).slice(-2), ['其他', '客户关系']);
  assert.equal(s.laiSettings.defaultOwner, 'Amy', 'other settings are kept');
  assert.equal(base.laiSettings.opportunitySettings, undefined, 'the input state is not changed');
  assert.throws(() => O.addLostReason(s, '  '), /请填写输单原因/);
  assert.throws(() => O.addLostReason(s, '客户关系'), /已经有同名的输单原因/);
  assert.throws(() => O.addLostReason(O.addLostReason(base, 'Price'), 'PRICE'), /已经有同名/);
  assert.throws(() => O.addLostReason(s, '字'.repeat(21)), /不能超过 20 个字/);
  assert.doesNotThrow(() => O.addLostReason(s, '字'.repeat(20)));
  s = base;
  for (let i = 0; i < 24; i++) s = O.addLostReason(s, 'R' + i);
  assert.equal(O.lostReasons(s).length, 30);
  assert.throws(() => O.addLostReason(s, 'one more'), /最多保留 30 个输单原因/);
});

test('lost reasons: rename updates the opportunities that use it, and not their updated time', () => {
  let s = add(base, 'a');
  s = lose(add(s, 'b'), 'b', '价格原因');
  const before = get(s, 'b').updatedAt;
  s = O.renameLostReason(s, '价格原因', '价格太高');
  assert.equal(get(s, 'b').lostReason, '价格太高');
  assert.equal(get(s, 'b').updatedAt, before);
  assert.deepEqual(O.lostReasons(s).slice(0, 2), ['价格太高', '交期原因']);
  assert.throws(() => O.renameLostReason(s, '价格太高', '交期原因'), /已经有同名/);
  assert.throws(() => O.renameLostReason(s, '不存在', 'x'), /不存在/);
  assert.equal(O.renameLostReason(s, '价格太高', '价格太高'), s, 'same name: nothing to do');
  // 只改大小写也行
  assert.equal(O.lostReasons(O.renameLostReason(O.addLostReason(base, 'abc'), 'abc', 'ABC')).at(-1), 'ABC');
});

test('lost reasons: moving up and down, and the ends', () => {
  const s = O.moveLostReason(base, '交期原因', -1);
  assert.deepEqual(O.lostReasons(s).slice(0, 2), ['交期原因', '价格原因']);
  assert.deepEqual(O.lostReasons(O.moveLostReason(s, '交期原因', 1)).slice(0, 2), ['价格原因', '交期原因']);
  assert.throws(() => O.moveLostReason(base, '价格原因', -1), /第一个/);
  assert.throws(() => O.moveLostReason(base, '其他', 1), /最后一个/);
});

test('lost reasons: delete is blocked while opportunities use it, and one reason must remain', () => {
  let s = lose(add(base, 'a'), 'a', '价格原因');
  s = lose(add(s, 'b'), 'b', '价格原因');
  assert.throws(() => O.removeLostReason(s, '价格原因'), /还有 2 个商机用了这个原因，先改掉它们/);
  const t = O.removeLostReason(s, '交期原因');
  assert.ok(!O.lostReasons(t).includes('交期原因'));
  assert.equal(O.choiceUse(s, 'reasons', '价格原因'), 2);
  let one = base;
  for (const reason of O.lostReasons(base).slice(1)) one = O.removeLostReason(one, reason);
  assert.deepEqual(O.lostReasons(one), ['价格原因']);
  assert.throws(() => O.removeLostReason(one, '价格原因'), /至少保留 1 个输单原因/);
});

test('lost reasons: the configured list drives the lost step, and unknown stored reasons keep working', () => {
  let s = add(base, 'a');
  assert.throws(() => lose(s, 'a', '客户关系'), /请选择输单原因/);
  s = O.addLostReason(s, '客户关系');
  s = lose(s, 'a', '客户关系');
  assert.equal(get(s, 'a').lostReason, '客户关系');
  // 设置里没有的老原因：商机照常显示、别的修改不受影响
  const old = {...s, laiOpportunities: s.laiOpportunities.map(item => ({...item, lostReason: '早已删掉的原因'}))};
  const edited = O.upsert(old, 'a', {note: 'hi'}, {now: NOW, today: TODAY, mustExist: true});
  assert.equal(get(edited, 'a').lostReason, '早已删掉的原因');
  const report = O.analysis(old, {}, TODAY);
  assert.deepEqual(report.lostReasons.map(row => row.reason), ['未填写']);
  assert.deepEqual(O.analysis(s, {}, TODAY).lostReasons.map(row => row.reason), ['客户关系']);
});

test('malformed settings are not overwritten', () => {
  assert.throws(() => O.addLostReason({laiSettings: {opportunitySettings: []}}, 'x'), /格式异常/);
  assert.throws(() => O.addLostReason({laiSettings: 'oops'}, 'x'), /格式异常/);
  assert.deepEqual(O.lostReasons({laiSettings: {opportunitySettings: {lostReasons: 'x'}}}), [...O.LOST_REASONS]);
  assert.deepEqual(O.lostReasons({laiSettings: {opportunitySettings: {lostReasons: ['a', 'A', '', 5, ' b ']}}}), ['a', 'b']);
  assert.deepEqual(O.lostReasons({laiSettings: {opportunitySettings: {lostReasons: []}}}), [...O.LOST_REASONS], 'an empty stored list falls back to the default');
});

// ---------------- 商机类型 ----------------
test('types: defaults, CRUD, rename propagation, in-use delete blocked, validation on save', () => {
  assert.deepEqual(O.typeChoices(base), ['新客户商机', '老客户复购', '样品单']);
  let s = O.addType(base, '代理商机');
  assert.equal(O.typeChoices(s).at(-1), '代理商机');
  assert.throws(() => O.addType(s, '样品单'), /已经有同名的商机类型/);
  assert.throws(() => O.addType(s, ''), /请填写商机类型/);
  assert.throws(() => O.addType(s, 'x'.repeat(21)), /不能超过 20 个字/);
  s = add(s, 'a', {type: '样品单'});
  assert.equal(get(s, 'a').type, '样品单');
  assert.throws(() => O.removeType(s, '样品单'), /还有 1 个商机用了这个类型，先改掉它们/);
  s = O.renameType(s, '样品单', '打样');
  assert.equal(get(s, 'a').type, '打样');
  assert.deepEqual(O.typeChoices(O.moveType(s, '打样', -1)).slice(0, 3), ['新客户商机', '打样', '老客户复购']);
  s = O.removeType(s, '代理商机');
  assert.ok(!O.typeChoices(s).includes('代理商机'));
  assert.throws(() => add(s, 'b', {type: '随便写'}), /商机类型“随便写”不在类型名单里/);
  // 类型可以删光（不是必填时）
  let none = base;
  for (const type of O.typeChoices(base)) none = O.removeType(none, type);
  assert.deepEqual(O.typeChoices(none), []);
  assert.equal(get(add(none, 'c'), 'c').type, undefined);
  let many = base;
  for (let i = 0; i < 27; i++) many = O.addType(many, 'T' + i);
  assert.throws(() => O.addType(many, 'more'), /最多保留 30 个商机类型/);
});

test('types: a type already stored on an opportunity can stay even if it left the list', () => {
  let s = add(base, 'a', {type: '样品单'});
  s = {...s, laiSettings: {...s.laiSettings, opportunitySettings: {types: ['新客户商机']}}};
  const edited = O.upsert(s, 'a', {note: 'x', type: '样品单'}, {now: NOW, mustExist: true});
  assert.equal(get(edited, 'a').type, '样品单');
  assert.throws(() => O.upsert(s, 'a', {type: '别的'}, {now: NOW, mustExist: true}), /不在类型名单里/);
  assert.equal(get(O.upsert(s, 'a', {type: ''}, {now: NOW, mustExist: true}), 'a').type, undefined, 'clearing is allowed');
});

// ---------------- 系统字段显示与必填 ----------------
test('system fields: fixed ones cannot change; configurable ones default to shown and optional', () => {
  const rows = O.fieldRows(base), byId = Object.fromEntries(rows.map(row => [row.id, row]));
  for (const id of ['client', 'name', 'amount', 'stage', 'endDate', 'owner', 'flow', 'lostReason']) assert.deepEqual([byId[id].show, byId[id].required, byId[id].showLocked, byId[id].requiredLocked], [true, true, true, true], id);
  assert.deepEqual([byId.number.show, byId.number.required, byId.number.requiredLocked], [true, false, true]);
  assert.deepEqual(['contact', 'collaborators', 'sources', 'type', 'leadId', 'exchangeRate', 'tags', 'note', 'products'], rows.filter(row => row.mode === 'config' || row.mode === 'rate').map(row => row.id));
  assert.deepEqual([byId.contact.required, byId.exchangeRate.required, byId.sources.required, byId.note.required], [true, true, false, false], 'contact and rate keep today\'s behaviour by default');
  assert.deepEqual([byId.exchangeRate.showLocked, byId.exchangeRate.requiredLocked], [true, false]);
  assert.throws(() => O.setField(base, 'client', {required: false}), /不能修改/);
  assert.throws(() => O.setField(base, 'number', {show: false}), /不能修改/);
  assert.throws(() => O.setField(base, 'nope', {}), /不能修改/);
  assert.throws(() => O.setField(base, 'exchangeRate', {show: false}), /一直显示/);
});

test('system fields: required ones are checked on save with 请填写XX', () => {
  let s = O.setField(base, 'note', {required: true});
  assert.throws(() => add(s, 'a'), /请填写备注/);
  assert.equal(get(add(s, 'a', {note: 'ok'}), 'a').note, 'ok');
  for (const [id, label] of [['collaborators', '协同跟进人'], ['tags', '商机标签'], ['products', '关联产品'], ['type', '商机类型'], ['leadId', '来源线索'], ['sources', '商机来源']]) {
    assert.throws(() => add(O.setField(base, id, {required: true}), 'a'), new RegExp(`请填写${label}`), id);
  }
  // 联系人：客户有联系人才要选（和原来一样）；设成不必填后可以不选
  assert.throws(() => add(base, 'c', {client: 'Alpha Co'}), /请选择关联联系人/);
  const optional = O.setField(base, 'contact', {required: false});
  assert.equal(get(add(optional, 'c', {client: 'Alpha Co'}), 'c').contact, '');
  assert.equal(get(add(base, 'd'), 'd').contact, '', 'a customer without contacts is fine');
  // 汇率：设成不必填后，外币留空按 100 记录
  assert.throws(() => add(base, 'e', {currency: 'EUR', exchangeRate: ''}), /汇率/);
  assert.equal(get(add(O.setField(base, 'exchangeRate', {required: false}), 'e', {currency: 'EUR', exchangeRate: ''}), 'e').exchangeRate, 100);
});

test('system fields: hiding keeps existing values, skips the required check, and the form data may leave them out', () => {
  let s = add(O.setField(base, 'note', {required: true}), 'a', {note: '很重要', tags: 'vip', collaborators: 'Bob', client: 'Alpha Co', contact: 'Bo'});
  s = O.setField(s, 'note', {show: false});
  assert.throws(() => O.setField(s, 'note', {required: true}), /隐藏的字段不能设为必填/);
  assert.equal(O.fieldRows(s).find(row => row.id === 'note').required, false, 'a hidden field is never required');
  // 隐藏后编辑别的内容：备注原样保留，也不会因为必填挡住保存
  let t = O.upsert(s, 'a', {amount: '200'}, {now: NOW, mustExist: true});
  assert.equal(get(t, 'a').note, '很重要');
  // 即使表单里（旧页面）还传了值，隐藏的字段也不改
  t = O.upsert(s, 'a', {note: '偷偷改'}, {now: NOW, mustExist: true});
  assert.equal(get(t, 'a').note, '很重要');
  for (const id of ['tags', 'collaborators', 'contact']) s = O.setField(s, id, {show: false});
  t = O.upsert(s, 'a', {amount: '300', tags: 'x', collaborators: 'Zed', contact: ''}, {now: NOW, mustExist: true});
  assert.deepEqual([get(t, 'a').tags, get(t, 'a').collaborators, get(t, 'a').contact], [['vip'], ['Bob'], 'Bo']);
  // 换客户时旧联系人不能留给新客户
  t = O.upsert(s, 'a', {client: 'Beta Ltd'}, {now: NOW, mustExist: true});
  assert.equal(get(t, 'a').contact, '');
  // 显示回来：必填状态还是原来的
  const back = O.setField(O.setField(base, 'note', {required: true}), 'note', {show: false});
  assert.equal(O.fieldMap(O.setField(back, 'note', {show: true})).note.required, true);
  // 隐藏后新建：不检查、没有值
  const created = add(O.setField(O.setField(base, 'sources', {required: true}), 'sources', {show: false}), 'z');
  assert.equal(get(created, 'z').sources, undefined);
});

// ---------------- 自定义字段 ----------------
const field = (state, input, id) => O.addCustomField(state, input, id ? {id} : {});
test('custom fields: add with every type, validation of name, type, options, limits', () => {
  let s = field(base, {name: '付款日期', type: 'date'}, 'pd');
  s = field(s, {name: '支付方式', type: 'multi', options: 'T/T\nL/C，PayPal', required: 'on'}, 'pm');
  s = field(s, {name: '折扣', type: 'number'}, 'dc');
  s = field(s, {name: '说明', type: 'textarea'}, 'tx');
  s = field(s, {name: '评级', type: 'select', options: ['A', 'B', 'a']}, 'gr');
  s = field(s, {name: '代号', type: 'text'}, 'cd');
  assert.deepEqual(O.customFields(s).map(f => [f.id, f.name, f.type, f.options, f.required]), [
    ['pd', '付款日期', 'date', [], false], ['pm', '支付方式', 'multi', ['T/T', 'L/C', 'PayPal'], true], ['dc', '折扣', 'number', [], false],
    ['tx', '说明', 'textarea', [], false], ['gr', '评级', 'select', ['A', 'B'], false], ['cd', '代号', 'text', [], false]]);
  assert.throws(() => field(s, {name: '', type: 'text'}), /请填写字段名称/);
  assert.throws(() => field(s, {name: 'x'.repeat(21), type: 'text'}), /不能超过 20 个字/);
  assert.throws(() => field(s, {name: '付款日期', type: 'text'}), /已经有同名的字段/);
  assert.throws(() => field(s, {name: ' 付款日期 ', type: 'text'}), /已经有同名的字段/);
  assert.throws(() => field(s, {name: '商机来源', type: 'text'}), /已经有同名的字段/, 'system labels are taken too');
  assert.throws(() => field(s, {name: '新', type: 'bogus'}), /请选择字段类型/);
  assert.throws(() => field(s, {name: '新', type: 'select', options: ''}), /请至少填写一个选项/);
  assert.throws(() => field(s, {name: '新', type: 'select', options: Array.from({length: 51}, (_, i) => 'o' + i)}), /最多 50 个选项/);
  assert.doesNotThrow(() => field(s, {name: '新', type: 'select', options: Array.from({length: 50}, (_, i) => 'o' + i)}));
  assert.throws(() => field(s, {name: '新', type: 'select', options: ['y'.repeat(31)]}), /每个选项不能超过 30 个字/);
  let many = base;
  for (let i = 0; i < 30; i++) many = field(many, {name: 'F' + i, type: 'text'});
  assert.throws(() => field(many, {name: 'F30', type: 'text'}), /最多添加 30 个自定义字段/);
  assert.equal(O.customFields(many).length, 30);
});

test('custom fields: rename, required, options, move, delete', () => {
  let s = field(field(base, {name: 'A', type: 'select', options: 'x\ny'}, 'a'), {name: 'B', type: 'text'}, 'b');
  s = O.updateCustomField(s, 'a', {name: '字段甲', required: true, options: 'x\ny\nz'});
  assert.deepEqual(O.customFields(s)[0], {id: 'a', name: '字段甲', type: 'select', options: ['x', 'y', 'z'], required: true});
  assert.throws(() => O.updateCustomField(s, 'b', {name: '字段甲'}), /已经有同名/);
  assert.doesNotThrow(() => O.updateCustomField(s, 'a', {name: '字段甲'}), 'keeping its own name is fine');
  assert.throws(() => O.updateCustomField(s, 'b', {options: 'q'}), /没有选项/);
  assert.throws(() => O.updateCustomField(s, 'zz', {name: 'q'}), /不存在/);
  assert.deepEqual(O.customFields(O.moveCustomField(s, 'b', -1)).map(f => f.id), ['b', 'a']);
  assert.throws(() => O.moveCustomField(s, 'a', -1), /第一个/);
  assert.throws(() => O.moveCustomField(s, 'b', 1), /最后一个/);
  assert.deepEqual(O.customFields(O.removeCustomField(s, 'a')).map(f => f.id), ['b']);
  assert.throws(() => O.removeCustomField(s, 'zz'), /不存在/);
  // 看不懂的条目写回时原样留着
  const odd = {...s, laiSettings: {...s.laiSettings, opportunitySettings: {...s.laiSettings.opportunitySettings, customFields: [...s.laiSettings.opportunitySettings.customFields, {id: 'weird', type: 'future'}]}}};
  assert.deepEqual(O.customFields(odd).map(f => f.id), ['a', 'b']);
  assert.ok(O.removeCustomField(odd, 'b').laiSettings.opportunitySettings.customFields.some(entry => entry.id === 'weird'));
});

test('custom values: cleaned by type and stored on the opportunity as custom[fieldId]', () => {
  let s = base;
  for (const [id, type, options] of [['t', 'text'], ['x', 'textarea'], ['n', 'number'], ['d', 'date'], ['s', 'select', 'A\nB'], ['m', 'multi', 'P\nQ\nR']]) s = field(s, {name: '字段' + id, type, options}, id);
  s = add(s, 'o', {custom: {t: '  hello ', x: 'a\nb', n: '12.50', d: '2026-12-01', s: 'a', m: ['P', 'r', 'P']}});
  assert.deepEqual(get(s, 'o').custom, {t: 'hello', x: 'a\nb', n: 12.5, d: '2026-12-01', s: 'A', m: ['P', 'R']});
  assert.throws(() => add(s, 'p', {custom: {n: '-1'}}), /“字段n”请填写数字/);
  assert.throws(() => add(s, 'p', {custom: {n: '1,000'}}), /“字段n”请填写数字/);
  assert.throws(() => add(s, 'p', {custom: {d: '2026-02-30'}}), /“字段d”请选择有效的日期/);
  assert.throws(() => add(s, 'p', {custom: {s: 'C'}}), /“字段s”的选项“C”不在选项里/);
  assert.throws(() => add(s, 'p', {custom: {m: ['P', 'Z']}}), /“字段m”的选项“Z”不在选项里/);
  assert.throws(() => add(s, 'p', {custom: {t: 'x'.repeat(201)}}), /不能超过 200 个字/);
  assert.throws(() => add(s, 'p', {custom: {x: 'x'.repeat(2001)}}), /不能超过 2000 个字/);
  // 没传 custom：原样保留；传了空：清掉
  const kept = O.upsert(s, 'o', {amount: '5'}, {now: NOW, mustExist: true});
  assert.deepEqual(get(kept, 'o').custom, get(s, 'o').custom);
  const cleared = O.upsert(s, 'o', {custom: {t: '', n: '', m: []}}, {now: NOW, mustExist: true});
  assert.deepEqual(get(cleared, 'o').custom, {x: 'a\nb', d: '2026-12-01', s: 'A'});
  // 选项后来被改掉：已经存着的值可以留着，新值不行
  const trimmed = O.updateCustomField(s, 's', {options: 'B'});
  assert.equal(get(O.upsert(trimmed, 'o', {custom: {s: 'A'}, note: 'z'}, {now: NOW, mustExist: true}), 'o').custom.s, 'A');
  assert.throws(() => add(trimmed, 'p', {custom: {s: 'A'}}), /不在选项里/);
  // 不认识的字段 ID 忽略
  assert.equal(get(add(s, 'q', {custom: {nope: 'x'}}), 'q').custom, undefined);
  assert.equal(get(add(base, 'r'), 'r').custom, undefined, 'no custom fields: nothing stored');
});

test('custom values: required fields are enforced, delete only removes the setting', () => {
  let s = field(field(base, {name: '付款方式', type: 'select', options: 'T/T\nL/C', required: true}, 'pay'), {name: '备注二', type: 'text'}, 'n2');
  assert.throws(() => add(s, 'a'), /请填写付款方式/);
  s = add(s, 'a', {custom: {pay: 'T/T', n2: 'keep me'}});
  assert.equal(O.customUse(s, 'pay'), 1);
  assert.equal(O.customUse(s, 'n2'), 1);
  assert.equal(O.customRows(s, get(s, 'a')).map(row => `${row.name}=${row.value}`).join('|'), '付款方式=T/T|备注二=keep me');
  s = O.removeCustomField(s, 'n2');
  assert.deepEqual(get(s, 'a').custom, {pay: 'T/T', n2: 'keep me'}, 'opportunity data is untouched');
  assert.deepEqual(O.customRows(s, get(s, 'a')).map(row => row.name), ['付款方式'], 'but no longer shown');
  // 编辑时其他字段的值还在
  const edited = O.upsert(s, 'a', {amount: '9', custom: {pay: 'L/C'}}, {now: NOW, mustExist: true});
  assert.deepEqual(get(edited, 'a').custom, {pay: 'L/C', n2: 'keep me'});
  // 必填字段后来才加：老商机编辑时要补上
  const later = field(base, {name: '新必填', type: 'text', required: true}, 'late');
  const old = add(base, 'old');
  assert.throws(() => O.upsert({...later, laiOpportunities: old.laiOpportunities}, 'old', {amount: '1'}, {now: NOW, mustExist: true}), /请填写新必填/);
  // 归档、换阶段不走表单检查
  assert.doesNotThrow(() => O.setArchived({...later, laiOpportunities: old.laiOpportunities}, 'old', true));
});

// ---------------- 商机来源 ----------------
test('sources: multi-select validated against the shared list; unknown new values are rejected, existing ones may stay', () => {
  const s0 = withSources(base);
  assert.deepEqual(O.sourceList(s0), ['常规获客 / 展会', '常规获客 / 熟人介绍', '社媒']);
  assert.deepEqual(O.sourceList(base), null);
  let s = add(s0, 'a', {sources: ['社媒', '常规获客 / 展会', '社媒']});
  assert.deepEqual(get(s, 'a').sources, ['社媒', '常规获客 / 展会']);
  assert.throws(() => add(s0, 'b', {sources: ['抖音']}), /商机来源“抖音”不在来源名单里/);
  assert.throws(() => add(base, 'b', {sources: ['社媒']}), /商机来源“社媒”不在来源名单里/, 'no list at all: nothing can be picked');
  // 来源从名单里隐藏或改名后，商机上原来的仍可保留
  const hidden = CS.setSourceHidden(s, CS.get(s).sources.find(item => item.name === '社媒').id, true);
  const same = O.upsert(hidden, 'a', {note: 'x', sources: ['社媒', '常规获客 / 展会']}, {now: NOW, mustExist: true});
  assert.deepEqual(get(same, 'a').sources, ['社媒', '常规获客 / 展会']);
  assert.throws(() => O.upsert(hidden, 'a', {sources: ['社媒', '常规获客 / 展会', '抖音']}, {now: NOW, mustExist: true}), /“抖音”/);
  // 不传：原样保留；传空：清掉
  assert.deepEqual(get(O.upsert(s, 'a', {amount: '1'}, {now: NOW, mustExist: true}), 'a').sources, ['社媒', '常规获客 / 展会']);
  assert.equal(get(O.upsert(s, 'a', {sources: []}, {now: NOW, mustExist: true}), 'a').sources, undefined);
  // 字符串也行（逗号分隔），大小写按名单里的写法
  assert.deepEqual(get(add(s0, 'c', {sources: '社媒'}), 'c').sources, ['社媒']);
});

test('sources: a new opportunity from a customer is prefilled with the customer source when it is on the list', () => {
  const s = withSources(base);
  assert.deepEqual(O.sourcesFromCustomer(s, 'Alpha Co'), [], '「展会」is stored as 常规获客 / 展会, the bare name is not on the list');
  const t = {...s, customers: {...s.customers, 'Alpha Co': {...s.customers['Alpha Co'], source: '常规获客 / 展会'}}};
  assert.deepEqual(O.sourcesFromCustomer(t, 'Alpha Co'), ['常规获客 / 展会']);
  assert.deepEqual(O.sourcesFromCustomer(t, 'Beta Ltd'), []);
  assert.deepEqual(O.sourcesFromCustomer(t, 'Nobody'), []);
  assert.deepEqual(O.sourcesFromCustomer(base, 'Alpha Co'), []);
});

// ---------------- 来源线索 ----------------
test('lead link: only live leads can be picked; the name shows in detail; deleted leads are labelled', () => {
  const s0 = {...base, laiLeads: [{id: 'L1', name: 'Zed Lashes'}, {id: 'L2', name: 'Trash Co', trashed: true}, {id: 'L3', name: 'Acme'}]};
  assert.deepEqual(O.leadChoices(s0).map(lead => lead.name), ['Acme', 'Zed Lashes']);
  let s = add(s0, 'a', {leadId: 'L1'});
  assert.equal(get(s, 'a').leadId, 'L1');
  assert.equal(O.detailOf(s, 'a', TODAY).leadName, 'Zed Lashes');
  assert.throws(() => add(s0, 'b', {leadId: 'L2'}), /来源线索不存在或已在回收站/);
  assert.throws(() => add(s0, 'b', {leadId: 'nope'}), /来源线索不存在/);
  const gone = {...s, laiLeads: []};
  assert.equal(O.detailOf(gone, 'a', TODAY).leadName, '（已删除的线索）');
  assert.equal(get(O.upsert(gone, 'a', {note: 'x', leadId: 'L1'}, {now: NOW, mustExist: true}), 'a').leadId, 'L1', 'the stored link may stay');
  assert.equal(O.detailOf(add(s0, 'c'), 'c', TODAY).leadName, '');
});

// ---------------- 商机编号 ----------------
test('number: OPP-YYYYMMDD-NNN per creation day, never reused, assigned on create only', () => {
  let s = add(base, 'a');
  s = add(s, 'b');
  s = add(s, 'c', {}, '2026-10-07T04:00:00.000Z');
  assert.deepEqual(['a', 'b', 'c'].map(id => get(s, id).number), ['OPP-20261006-001', 'OPP-20261006-002', 'OPP-20261007-001']);
  s = O.remove(s, 'a');
  s = add(s, 'd');
  assert.equal(get(s, 'd').number, 'OPP-20261006-003', 'the highest stored number plus one');
  const edited = O.upsert(s, 'b', {amount: '77'}, {now: '2026-10-09T00:00:00.000Z', mustExist: true});
  assert.equal(get(edited, 'b').number, 'OPP-20261006-002', 'editing keeps the number');
  // 老商机没有编号：编辑后也不补
  const legacy = {...base, laiOpportunities: [{id: 'old', client: 'Beta Ltd', owner: 'Amy', amount: 5, currency: 'USD', endDate: '2026-11-05', stage: 'open', name: 'n', nameMode: 'custom', createdAt: NOW}]};
  assert.equal(get(O.upsert(legacy, 'old', {amount: '6'}, {now: NOW, mustExist: true}), 'old').number, undefined);
  assert.equal(O.detailOf(legacy, 'old', TODAY).number, '');
  assert.equal(O.nextNumber(legacy, '2026-10-06'), 'OPP-20261006-001');
  // 1000 个以后位数增加但不重复
  assert.equal(O.nextNumber({laiOpportunities: [{id: 'x', number: 'OPP-20261006-999'}]}, '2026-10-06'), 'OPP-20261006-1000');
  // 本地日期：台北时间 10-07 凌晨对应 UTC 10-06
  assert.equal(get(add(base, 'e', {}, '2026-10-06T20:00:00.000Z'), 'e').number, 'OPP-20261007-001');
  // 列表搜索能按编号找
  assert.equal(O.board(add(base, 'f'), {search: 'OPP-20261006-001'}, TODAY).count, 1);
  assert.equal(O.board(add(base, 'f'), {search: 'OPP-20261006-009'}, TODAY).count, 0);
});

// ---------------- 分析：商机来源 ----------------
test('analysis: breakdown by source counts multi-source opportunities under each source, none go under 未填来源', () => {
  let s = withSources(base);
  s = add(s, 'a', {amount: '100', sources: ['社媒', '常规获客 / 展会']});
  s = add(s, 'b', {amount: '50', sources: ['社媒']});
  s = add(s, 'c', {amount: '30'});
  s = add(s, 'd', {amount: '10', currency: 'EUR', exchangeRate: '108', sources: ['社媒']});
  const rows = O.analysis(s, {}, TODAY).sources;
  assert.deepEqual(rows, [{source: '社媒', count: 2, amount: 150}, {source: '常规获客 / 展会', count: 1, amount: 100}, {source: '未填来源', count: 1, amount: 30}]);
  assert.deepEqual(O.analysis(base, {}, TODAY).sources, []);
});

// ---------------- 表单设置汇总 ----------------
test('formSetup gathers what the form needs', () => {
  const s = field(O.setField(withSources(base), 'tags', {show: false}), {name: '评级', type: 'select', options: 'A'}, 'g');
  const setup = O.formSetup({...s, laiLeads: [{id: 'L', name: 'Q'}]});
  assert.equal(setup.fields.tags.show, false);
  assert.deepEqual([setup.reasons.length, setup.types.length, setup.sources.length, setup.leads, setup.customFields.map(f => f.id)], [6, 3, 3, [{id: 'L', name: 'Q'}], ['g']]);
  assert.equal(O.formSetup({}).sources, null);
});
