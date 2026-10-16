'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../src/lead-model.js');

const NOW = '2026-10-07T03:00:00.000Z', TODAY = '2026-10-07';
const base = () => ({
  customers: {
    'Acme Trading': { client: 'Acme Trading', email: 'buy@acme.example', emails: ['buy@acme.example', 'boss@acme.example'], owner: 'Amy', source: '展会', history: [{ time: '2026-01-01T00:00:00.000Z', text: '新建客户档案', type: 'operation' }] },
    'Old Co': { client: 'Old Co', laiBucket: 'trash' }
  },
  orders: [{ id: 'o1', client: 'Order Only Ltd' }],
  // 旧的重复提示测试要能建出同名线索，所以这里先设为「判重但允许保存」；拦截规则在后面单独测。
  laiSettings: { defaultOwner: 'Amy', customerSettings: { leadDedupe: { name: 'allow', website: 'allow', email: 'allow', phone: 'allow' } } },
  untouched: { keep: true }
});
const add = (state, id, fields, now = NOW) => L.upsert(state, id, { name: 'Lead ' + id, ...fields }, { now });
const get = (state, id) => L.list(state).find(item => item.id === id);

test('a new lead starts as 新线索 with cleaned fields, and nothing else in the saved data is touched', () => {
  const before = base(), snapshot = JSON.stringify(before);
  const next = add(before, 'a', { name: '  Ａcme   Lash ', email: ' hi@lash.example ', owner: ' amy ', nextFollow: '2026-10-10', source: '官网询盘' });
  assert.equal(JSON.stringify(before), snapshot, 'input state is not mutated');
  assert.deepEqual(next.untouched, { keep: true });
  assert.equal(next.customers, before.customers, 'customers untouched by a plain save');
  const lead = get(next, 'a');
  assert.equal(lead.name, 'Acme Lash', 'full-width letters and repeated spaces are normalised');
  assert.equal(lead.email, 'hi@lash.example');
  assert.equal(lead.owner, 'amy');
  assert.equal(lead.status, 'new');
  assert.equal(lead.createdAt, NOW);
  assert.deepEqual(lead.history, []);
  assert.equal(lead.trashed, false);
});

test('saving is refused with a reason for a missing name, a bad email, a bad date, an over-long field, a duplicate id and a missing lead', () => {
  const state = add(base(), 'a');
  assert.throws(() => L.upsert(state, 'b', { name: '   ' }), /请填写线索名称/);
  assert.throws(() => L.upsert(state, 'b', { name: 'X', email: 'not-an-email' }), /邮箱格式不正确/);
  assert.throws(() => L.upsert(state, 'b', { name: 'X', nextFollow: '2026-02-30' }), /有效的下次跟进日期/);
  assert.throws(() => L.upsert(state, 'b', { name: 'X', phone: '1'.repeat(41) }), /电话最多 40 个字/);
  assert.throws(() => L.upsert(state, 'a', { name: 'X' }), /线索已存在/);
  assert.throws(() => L.upsert(state, 'zz', { name: 'X' }, { mustExist: true }), /线索不存在/);
  assert.throws(() => L.upsert(state, '', { name: 'X' }), /找不到这条线索/);
  assert.throws(() => L.upsert({ laiLeads: 'broken' }, 'b', { name: 'X' }), /格式异常/);
});

test('editing keeps status, history, creation time and unknown fields; 未分配 means no owner', () => {
  let state = add(base(), 'a', { owner: 'Amy' });
  state = { ...state, laiLeads: state.laiLeads.map(item => ({ ...item, futureField: { x: 1 } })) };
  state = L.addFollowup(state, 'a', { text: 'called' }, { now: '2026-10-07T04:00:00.000Z' });
  const edited = L.upsert(state, 'a', { name: 'Renamed', owner: '未分配' }, { mustExist: true, now: '2026-10-07T05:00:00.000Z' });
  const lead = get(edited, 'a');
  assert.equal(lead.name, 'Renamed');
  assert.equal(lead.owner, '');
  assert.equal(lead.status, 'following');
  assert.equal(lead.createdAt, NOW);
  assert.equal(lead.history.length, 1);
  assert.deepEqual(lead.futureField, { x: 1 });
  assert.equal(lead.updatedAt, '2026-10-07T05:00:00.000Z');
});

test('entries the module cannot read are hidden but written back unchanged', () => {
  const odd = [null, 'text', { noId: true }, { id: 'keep', name: 'Kept' }];
  const next = add({ laiLeads: odd }, 'a');
  assert.deepEqual(next.laiLeads.slice(1), odd);
  assert.deepEqual(L.list(next).map(item => item.id), ['a', 'keep']);
  // 两条相同 ID：只改第一条。
  const twins = { laiLeads: [{ id: 't', name: 'One' }, { id: 't', name: 'Two' }] };
  assert.deepEqual(L.upsert(twins, 't', { name: 'Changed' }, { mustExist: true }).laiLeads.map(item => item.name), ['Changed', 'Two']);
});

test('a follow-up moves a new lead to 跟进中, records the text first in the history and sets the next date', () => {
  let state = add(base(), 'a', { nextFollow: '2026-10-08' });
  state = L.addFollowup(state, 'a', { text: ' first ' }, { now: '2026-10-07T04:00:00.000Z' });
  assert.equal(get(state, 'a').nextFollow, '2026-10-08', 'an omitted date keeps the planned one');
  state = L.addFollowup(state, 'a', { text: 'second', nextFollow: '' }, { now: '2026-10-08T04:00:00.000Z' });
  const lead = get(state, 'a');
  assert.equal(lead.status, 'following');
  assert.deepEqual(lead.history.map(entry => [entry.text, entry.type]), [['second', 'followup'], ['first', 'followup']]);
  assert.equal(lead.lastFollowAt, '2026-10-08T04:00:00.000Z');
  assert.equal(lead.nextFollow, '', 'an emptied date clears the plan');
  assert.throws(() => L.addFollowup(state, 'a', { text: '  ' }), /请填写跟进内容/);
  assert.throws(() => L.addFollowup(state, 'a', { text: 'x', nextFollow: 'tomorrow' }), /有效的下次跟进日期/);
});

test('invalid needs a reason and blocks follow-ups and conversion; 重新跟进 returns to the status the lead had earned', () => {
  let state = add(add(base(), 'fresh'), 'worked');
  state = L.addFollowup(state, 'worked', { text: 'hi' }, { now: NOW });
  assert.throws(() => L.markInvalid(state, 'fresh', { reason: '' }), /请选择无效原因/);
  state = L.markInvalid(L.markInvalid(state, 'fresh', { reason: '没有需求', note: '明年再说' }), 'worked', { reason: '无法联系' });
  assert.equal(get(state, 'fresh').status, 'invalid');
  assert.equal(get(state, 'fresh').history[0].text, '标记为无效：没有需求（明年再说）');
  assert.throws(() => L.addFollowup(state, 'fresh', { text: 'x' }), /请先点「重新跟进」/);
  assert.throws(() => L.convert(state, 'fresh', { mode: 'new', country: 'US', source: 'x' }), /请先点「重新跟进」/);
  state = L.reopen(L.reopen(state, 'fresh'), 'worked');
  assert.equal(get(state, 'fresh').status, 'new');
  assert.equal(get(state, 'worked').status, 'following');
  assert.equal(get(state, 'fresh').invalidReason, undefined);
  assert.throws(() => L.reopen(state, 'fresh'), /只有无效的线索/);
});

test('converting to a new customer creates the profile from the lead, requires country and source, and leaves a trace on both sides', () => {
  let state = add(base(), 'a', { name: 'Nova Beauty', contact: 'Ann', email: 'ann@nova.example', phone: '+1 555', website: 'nova.example', product: 'lashes', note: 'met at fair', owner: 'Bo', nextFollow: '2026-10-20' });
  state = L.addFollowup(state, 'a', { text: 'sent quote' }, { now: NOW });
  assert.throws(() => L.convert(state, 'a', { mode: 'new', source: '展会' }), /请输入国家地区/);
  assert.throws(() => L.convert(state, 'a', { mode: 'new', country: 'US' }), /请输入客户来源/);
  const failed = (() => { try { L.convert(state, 'a', { mode: 'new', country: '' }); } catch { return state; } })();
  assert.equal(get(failed, 'a').status, 'following', 'a refused conversion changes nothing');
  const next = L.convert(state, 'a', { mode: 'new', name: 'Nova Beauty Inc', country: 'US', source: '展会', owner: 'Cy' }, { now: '2026-10-09T00:00:00.000Z' });
  const profile = next.customers['Nova Beauty Inc'];
  assert.deepEqual([profile.country, profile.source, profile.owner, profile.contact, profile.email, profile.phone, profile.website, profile.productType, profile.note, profile.nextFollow],
    ['US', '展会', 'Cy', 'Ann', 'ann@nova.example', '+1 555', 'nova.example', 'lashes', 'met at fair', '2026-10-20']);
  assert.equal(profile.history[0].text, '由线索转入：Nova Beauty（线索阶段有 1 条跟进记录，可在线索列表查看）');
  assert.equal(profile.history.at(-1).text, '新建客户档案');
  const lead = get(next, 'a');
  assert.deepEqual([lead.status, lead.convertedTo, lead.convertedAt, lead.nextFollow], ['converted', 'Nova Beauty Inc', '2026-10-09T00:00:00.000Z', '']);
  assert.equal(lead.history[0].text, '转为客户：Nova Beauty Inc');
  assert.equal(next.customers['Acme Trading'], state.customers['Acme Trading'], 'other customers untouched');
  assert.throws(() => L.convert(next, 'a', { mode: 'new', country: 'US', source: 'x' }), /已转为客户「Nova Beauty Inc」/);
  assert.throws(() => L.addFollowup(next, 'a', { text: 'x' }), /请到客户资料里写跟进/);
  assert.throws(() => L.markInvalid(next, 'a', { reason: '其他' }), /不能标记为无效/);
});

test('a name that already belongs to a customer cannot create a second record; linking an existing customer only adds a history line', () => {
  const state = add(base(), 'a', { name: 'acme trading', email: 'new@acme.example' });
  assert.throws(() => L.convert(state, 'a', { mode: 'new', country: 'US', source: '展会' }), /客户名称已存在/);
  assert.throws(() => L.convert(state, 'a', { mode: 'existing', existing: 'Nobody' }), /请从列表中选择一个已有客户/);
  assert.throws(() => L.convert(state, 'a', { mode: 'existing', existing: 'Old Co' }), /在回收站里/);
  assert.throws(() => L.convert(state, 'a', { mode: 'existing', existing: 'Order Only Ltd' }), /请从列表中选择一个已有客户/, 'a name known only from orders has no profile to link');
  const next = L.convert(state, 'a', { mode: 'existing', existing: 'ACME TRADING' }, { now: NOW });
  assert.deepEqual(Object.keys(next.customers), ['Acme Trading', 'Old Co']);
  const profile = next.customers['Acme Trading'];
  assert.equal(profile.email, 'buy@acme.example', 'the customer keeps its own details');
  assert.equal(profile.history.length, 2);
  assert.equal(profile.history[0].text, '由线索转入：acme trading');
  assert.equal(get(next, 'a').convertedTo, 'Acme Trading');
  assert.equal(get(next, 'a').history[0].text, '转为客户：Acme Trading（关联已有客户）');
});

test('possible duplicates: same name or email as a customer or as another open lead; converted and trashed leads do not count', () => {
  let state = add(base(), 'byName', { name: 'ACME  trading' });
  state = add(state, 'byEmail', { name: 'Someone', email: 'BOSS@acme.example' });
  state = add(state, 'twinA', { name: 'Twin', email: 'a@twin.example' });
  state = add(state, 'twinB', { name: 'Other', email: 'A@twin.example' });
  state = add(state, 'clean', { name: 'Unique Co' });
  const dup = id => L.detail(state, id, TODAY).duplicate;
  assert.deepEqual(dup('byName'), { customer: 'Acme Trading', leads: [] });
  assert.deepEqual(dup('byEmail'), { customer: 'Acme Trading', leads: [] });
  assert.deepEqual(dup('twinA'), { customer: '', leads: ['Other'] });
  assert.deepEqual(dup('clean'), { customer: '', leads: [] });
  assert.deepEqual(L.convertDefaults(state, 'byName'), { mode: 'existing', existing: 'Acme Trading', name: 'ACME trading', country: '', source: '', owner: 'Amy' });
  assert.equal(L.convertDefaults(state, 'clean').mode, 'new');
  state = L.setTrashed(state, 'twinB', true);
  assert.deepEqual(dup('twinA').leads, [], 'a trashed twin is ignored');
  state = L.convert(state, 'byName', { mode: 'existing', existing: 'Acme Trading' });
  assert.deepEqual(dup('byName'), { customer: '', leads: [] }, 'a converted lead is no longer flagged');
});

test('the list counts every status under the current search and filters, then shows the chosen status in the chosen order', () => {
  let state = base();
  state = add(state, 'n1', { name: 'Alpha', owner: 'Amy', source: '展会', nextFollow: '2026-10-01' }, '2026-10-01T00:00:00.000Z');
  state = add(state, 'n2', { name: 'Beta', owner: 'amy', source: '官网询盘', nextFollow: TODAY, product: 'mink lashes' }, '2026-10-02T00:00:00.000Z');
  state = add(state, 'f1', { name: 'Gamma', owner: '', source: '展会', nextFollow: '2026-12-01' }, '2026-10-03T00:00:00.000Z');
  state = L.addFollowup(state, 'f1', { text: 'talked' }, { now: '2026-10-05T00:00:00.000Z' });
  state = add(state, 'i1', { name: 'Delta', owner: 'Bo', nextFollow: '2026-09-01' }, '2026-10-04T00:00:00.000Z');
  state = L.markInvalid(state, 'i1', { reason: '其他' });
  state = L.setTrashed(add(state, 't1', { name: 'Trashed' }), 't1', true);
  const all = L.page(state, {}, TODAY);
  assert.deepEqual(all.counts, { all: 4, new: 2, following: 1, converted: 0, invalid: 1 });
  assert.deepEqual(all.rows.map(row => row.name), ['Delta', 'Gamma', 'Beta', 'Alpha'], 'newest first by default');
  assert.equal(all.total, 4);
  assert.equal(all.trashCount, 1);
  assert.deepEqual(all.owners.map(name => name.toLowerCase()), ['amy', 'bo'], 'owner spellings that differ only by case are one person');
  assert.equal(all.hasUnassigned, true);
  assert.deepEqual(all.rows.map(row => [row.name, row.overdue, row.dueToday]), [['Delta', false, false], ['Gamma', false, false], ['Beta', false, true], ['Alpha', true, false]], 'an invalid lead is never overdue');
  assert.equal(all.dueCount, 2);
  assert.deepEqual(L.page(state, { status: 'new', sort: 'name-asc' }, TODAY).rows.map(row => row.name), ['Alpha', 'Beta']);
  assert.deepEqual(L.page(state, { owner: 'AMY' }, TODAY).counts, { all: 2, new: 2, following: 0, converted: 0, invalid: 0 });
  assert.deepEqual(L.page(state, { owner: '未分配' }, TODAY).rows.map(row => row.name), ['Gamma']);
  assert.deepEqual(L.page(state, { source: '展会' }, TODAY).rows.map(row => row.name), ['Gamma', 'Alpha']);
  assert.deepEqual(L.page(state, { search: 'MINK' }, TODAY).rows.map(row => row.name), ['Beta']);
  assert.deepEqual(L.page(state, { due: true }, TODAY).rows.map(row => row.name), ['Beta', 'Alpha']);
  assert.deepEqual(L.page(state, { sort: 'nextFollow-asc' }, TODAY).rows.map(row => row.name), ['Alpha', 'Beta', 'Gamma', 'Delta'], 'leads without a planned date go last');
  assert.deepEqual(L.page(state, { status: 'nonsense', sort: 'nonsense' }, TODAY).filters, { status: 'all', search: '', owner: '', source: '', due: false, sort: 'createdAt-desc' });
});

test('trash hides a lead from the list and from editing; only trashed leads can be deleted for good', () => {
  let state = add(add(base(), 'a'), 'b');
  assert.throws(() => L.remove(state, 'a'), /请先把线索移入回收站/);
  state = L.setTrashed(state, 'a', true, { now: NOW });
  assert.deepEqual(L.page(state, {}, TODAY).rows.map(row => row.id), ['b']);
  assert.deepEqual(L.trash(state, TODAY).map(row => [row.id, row.trashed, row.trashedDay]), [['a', true, L.localDay(NOW)]]);
  assert.throws(() => L.upsert(state, 'a', { name: 'X' }, { mustExist: true }), /请先从回收站恢复/);
  assert.throws(() => L.addFollowup(state, 'a', { text: 'x' }), /请先从回收站恢复/);
  assert.throws(() => L.convert(state, 'a', { mode: 'new', country: 'US', source: 'x' }), /请先从回收站恢复/);
  assert.equal(L.setTrashed(state, 'a', true), state, 'trashing twice changes nothing');
  const restored = L.setTrashed(state, 'a', false);
  assert.equal(get(restored, 'a').trashedAt, undefined);
  assert.deepEqual(L.list(L.remove(state, 'a')).map(item => item.id), ['b']);
  assert.throws(() => L.remove(state, 'zz'), /线索不存在/);
});

test('owner and source suggestions come from leads and customers, without duplicates, plus the common sources', () => {
  const state = add(base(), 'a', { owner: 'bo', source: '朋友介绍' });
  assert.deepEqual(L.ownerNames(state), ['Amy', 'bo']);
  const sources = L.sourceNames(state);
  assert.ok(sources.includes('朋友介绍') && sources.includes('官网询盘'));
  assert.equal(sources.filter(name => name === '展会').length, 1);
  assert.deepEqual(L.customerNames(state), ['Acme Trading', 'Order Only Ltd'], 'trashed customers are not offered for linking');
  assert.equal(L.defaults(state).owner, 'Amy');
});

test('the lead scripts load before the business page shell, in the template and in the build script', () => {
  const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.py'), 'utf8');
  const order = text => ['<!--PREVIEW_MODEL-->', '<!--LAI_MODULES-->', '<!--LEAD_MODEL-->', '<!--LEAD_UI-->', '<!--LAI_BUSINESS_UI-->'].map(marker => text.indexOf(marker));
  for (const text of [template, build]) {
    const positions = order(text);
    assert.ok(positions.every(position => position >= 0), 'all markers present');
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  }
  assert.match(build, /\('<!--LEAD_MODEL-->','lead-model\.js','script'\),\('<!--LEAD_UI-->','lead-ui\.js','script'\)/);
});

test('duplicatesOf uses an index: 5000 leads stay fast and match the plain scan', () => {
  const norm = value => String(value ?? '').trim().normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const leads = [];
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; };
  for (let i = 0; i < 5000; i++) {
    leads.push({ id: 'p' + i, name: 'Co ' + rnd(2500), email: rnd(3) ? 'm' + rnd(2500) + '@x.example' : '', status: rnd(10) === 0 ? 'converted' : 'new', trashed: rnd(15) === 0 });
  }
  const state = { ...base(), laiLeads: leads };
  const start = Date.now();
  const rows = L.list(state).map(item => L.duplicatesOf(state, item));
  assert.ok(Date.now() - start < 1000, 'took ' + (Date.now() - start) + ' ms');
  const old = item => L.list(state).filter(o => o.id !== item.id && !o.trashed && L.statusOf(o) !== 'converted' && (norm(o.name) === norm(item.name) || (String(item.email || '').trim() && norm(o.email) === norm(item.email)))).map(o => o.name);
  let withDuplicates = 0;
  for (let n = 0; n < 150; n++) {
    const i = rnd(5000), item = leads[i];
    if (L.statusOf(item) === 'converted') { assert.deepEqual(rows[i].leads, []); continue; }
    assert.deepEqual(rows[i].leads, old(item));
    if (rows[i].leads.length) withDuplicates++;
  }
  assert.ok(withDuplicates > 0, 'sample should include real duplicates');
  const small = { ...base(), laiLeads: [{ id: 'a', name: 'Same Co' }, { id: 'b', name: 'same  co' }] };
  assert.deepEqual(L.duplicatesOf(small, get(small, 'b')).leads, ['Same Co']);
  const moved = { ...small, laiLeads: [{ id: 'a', name: 'Other' }, small.laiLeads[1]] };
  assert.deepEqual(L.duplicatesOf(moved, get(moved, 'b')).leads, []);
});
