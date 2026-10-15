'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../src/lead-model.js');
const U = require('../src/lead-ui.js');
const RM = require('../src/rail-menu.js');
const { escapeHtml } = require('../src/model.js');

const ui = U.create(escapeHtml, L);
const TODAY = '2026-10-07';
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function sample() {
  let state = { customers: { 'Acme Trading': { client: 'Acme Trading', email: 'buy@acme.example' } }, orders: [], laiSettings: { customerSettings: { leadDedupe: { name: 'allow', website: 'allow', email: 'allow', phone: 'allow' } } } };
  const add = (id, fields, now) => { state = L.upsert(state, id, fields, { now }); };
  add('open', { name: 'Open <b>Lead</b>', contact: 'Ann', email: 'ann@x.example', owner: 'Amy', source: '展会', product: 'lashes', nextFollow: '2026-10-01', note: 'line1\n<script>' }, '2026-10-01T00:00:00.000Z');
  add('worked', { name: 'Worked Lead', nextFollow: TODAY }, '2026-10-02T00:00:00.000Z');
  state = L.addFollowup(state, 'worked', { text: 'talked <i>price</i>' }, { now: '2026-10-05T00:00:00.000Z' });
  add('dup', { name: 'acme trading' }, '2026-10-03T00:00:00.000Z');
  add('gone', { name: 'Gone Lead' }, '2026-10-04T00:00:00.000Z');
  state = L.markInvalid(state, 'gone', { reason: '没有需求' });
  add('won', { name: 'Won Lead' }, '2026-10-05T00:00:00.000Z');
  state = L.convert(state, 'won', { mode: 'new', country: 'US', source: '展会' }, { now: '2026-10-06T00:00:00.000Z' });
  return state;
}
const rowOf = (html, id) => html.split('<tr').find(part => part.includes(`data-id="${id}"`)) || '';

test('the list shows status tabs with counts, escapes what users typed, and offers the actions that fit each status', () => {
  const state = sample();
  const html = ui.pageMarkup(L.page(state, {}, TODAY), {}, TODAY);
  assert.match(html, /data-lead-status="all" aria-selected="true">全部<b>5<\/b>/);
  assert.match(html, /data-lead-status="new" aria-selected="false">新线索<b>2<\/b>/);
  assert.match(html, /data-lead-status="converted" aria-selected="false">已转客户<b>1<\/b>/);
  assert.match(html, /Open &lt;b&gt;Lead&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Lead<\/b>|<i>price<\/i>/);
  assert.match(rowOf(html, 'open'), /class="lead-row-overdue"/);
  assert.match(rowOf(html, 'open'), /逾期 10-01/);
  assert.match(rowOf(html, 'open'), /data-lead-action="follow"[^>]*>写跟进<\/button><button[^>]*data-lead-action="convert"[^>]*>转为客户/);
  assert.match(rowOf(html, 'worked'), /lead-today">今天/);
  assert.match(rowOf(html, 'worked'), /talked &lt;i&gt;price&lt;\/i&gt;/);
  assert.match(rowOf(html, 'dup'), /可能重复/);
  assert.match(rowOf(html, 'dup'), /title="与客户「Acme Trading」的名称或邮箱相同"/);
  assert.match(rowOf(html, 'gone'), /data-lead-action="reopen"[^>]*>重新跟进/);
  assert.doesNotMatch(rowOf(html, 'gone'), /data-lead-action="(follow|convert)"/);
  assert.match(rowOf(html, 'won'), /data-biz-customer="Won Lead"/);
  assert.doesNotMatch(rowOf(html, 'won'), /data-lead-action="(follow|convert|reopen)"/);
  assert.match(html, /data-lead-action="due" aria-pressed="false">该跟进的<b>2<\/b>/);
  assert.match(ui.headerActions(L.page(state, {}, TODAY)), /回收站<\/button>.*新建线索/);
  assert.match(ui.headerActions({ trashCount: 3 }), /回收站（3）/);
});

test('long lists show one page at a time and say how many are left', () => {
  let state = { customers: {}, orders: [] };
  for (let i = 0; i < U.PAGE + 7; i += 1) state = L.upsert(state, 'l' + i, { name: 'Lead ' + i }, { now: `2026-10-01T00:00:${String(i % 60).padStart(2, '0')}.000Z` });
  const page = L.page(state, {}, TODAY);
  const first = ui.pageMarkup(page, {}, TODAY);
  assert.equal(first.split('<tr').length - 2, U.PAGE);
  assert.match(first, /data-lead-action="more">再显示 7 条（还有 7 条）/);
  const more = ui.pageMarkup(page, { limit: U.PAGE * 2 }, TODAY);
  assert.equal(more.split('<tr').length - 2, U.PAGE + 7);
  assert.doesNotMatch(more, /data-lead-action="more"/);
});

test('empty states say what to do: no leads at all, nothing matching, empty trash', () => {
  const none = ui.pageMarkup(L.page({}, {}, TODAY), {}, TODAY);
  assert.match(none, /还没有线索/);
  assert.match(none, /data-lead-action="new">新建线索/);
  assert.doesNotMatch(none, /<table/);
  const noMatch = ui.pageMarkup(L.page(sample(), { search: 'zzz-nothing' }, TODAY), {}, TODAY);
  assert.match(noMatch, /没有符合条件的线索/);
  assert.doesNotMatch(noMatch, /功能入口已保留/);
  assert.match(ui.trashMarkup([], '', TODAY), /回收站是空的/);
});

test('the trash lists what was removed and arms 彻底删除 only for the lead that was clicked', () => {
  let state = sample();
  state = L.setTrashed(L.setTrashed(state, 'open', true, { now: '2026-10-06T00:00:00.000Z' }), 'gone', true, { now: '2026-10-07T00:00:00.000Z' });
  const html = ui.trashMarkup(L.trash(state, TODAY), 'open', TODAY);
  assert.match(rowOf(html, 'open'), /data-lead-action="restore"[^>]*>恢复<\/button><button[^>]*data-lead-action="delete"[^>]*>再点一次，彻底删除/);
  assert.match(rowOf(html, 'gone'), /data-lead-action="delete"[^>]*>彻底删除<\/button>/);
  assert.match(html, /id="lead-trash-error"/);
});

test('the detail offers follow-up and conversion only while the lead is open, and explains converted and invalid leads', () => {
  const state = sample();
  const open = ui.detailMarkup(L.detail(state, 'open', TODAY), TODAY);
  assert.match(open, /id="lead-follow-form" data-id="open"/);
  for (const action of ['edit', 'convert', 'invalid', 'trash']) assert.match(open, new RegExp(`data-lead-action="${action}" data-id="open"`), action);
  assert.match(open, /跟进逾期 10-01/);
  assert.match(open, /line1\n&lt;script&gt;/, 'the note keeps its line break and is escaped');
  assert.match(open, /还没有记录/);
  const worked = ui.detailMarkup(L.detail(state, 'worked', TODAY), TODAY);
  assert.match(worked, /<li class="is-followup"><time>2026-10-05<\/time><span class="lead-entry-kind">跟进<\/span><p>talked &lt;i&gt;price&lt;\/i&gt;<\/p>/);
  assert.match(worked, /今天该跟进/);
  const won = ui.detailMarkup(L.detail(state, 'won', TODAY), TODAY);
  assert.match(won, /已于 2026-10-06 转为客户 <button[^>]*data-biz-customer="Won Lead"/);
  assert.doesNotMatch(won, /lead-follow-form|data-lead-action="(convert|invalid|reopen)"/);
  assert.match(won, /data-lead-action="edit"/);
  const gone = ui.detailMarkup(L.detail(state, 'gone', TODAY), TODAY);
  assert.match(gone, /已标记为无效：没有需求/);
  assert.match(gone, /data-lead-action="reopen" data-id="gone"[^>]*>重新跟进/);
  assert.doesNotMatch(gone, /lead-follow-form|data-lead-action="(convert|invalid)"/);
  const dup = ui.detailMarkup(L.detail(state, 'dup', TODAY), TODAY);
  assert.match(dup, /与客户「Acme Trading」的名称或邮箱相同。转为客户时可以选择关联到已有客户。/);
  const trashed = ui.detailMarkup(L.detail(L.setTrashed(state, 'open', true), 'open', TODAY), TODAY);
  assert.match(trashed, /data-lead-action="restore"/);
  assert.doesNotMatch(trashed, /lead-follow-form|data-lead-action="(edit|convert|trash)"/);
});

test('a converted lead whose customer was renamed or removed shows the name without a dead link', () => {
  const state = sample();
  const renamed = { ...state, customers: { 'Acme Trading': state.customers['Acme Trading'] } };
  const row = L.detail(renamed, 'won', TODAY);
  assert.equal(row.convertedExists, false);
  assert.doesNotMatch(ui.detailMarkup(row, TODAY), /data-biz-customer="Won Lead"/);
  assert.match(ui.detailMarkup(row, TODAY), /title="该客户已改名或已删除">Won Lead/);
});

test('the forms: required name only when creating; conversion shows and enables only the chosen way in', () => {
  const state = sample();
  const form = ui.formMarkup({ ...L.defaults(state), name: 'A "quoted" name' }, { owners: ['Amy'], sources: ['展会'] });
  assert.match(form, /id="lead-form"/);
  assert.match(form, /name="name" value="A &quot;quoted&quot; name"[^>]*required/);
  assert.equal((form.match(/ required/g) || []).length, 1, 'only the name is required');
  assert.match(form, /<datalist id="lead-owner-list"><option value="Amy">/);
  const row = L.detail(state, 'open', TODAY);
  const fresh = ui.convertMarkup(row, L.convertDefaults(state, 'open'), { customers: ['Acme Trading'], owners: [], sources: [] });
  assert.match(fresh, /id="lead-convert-form" data-id="open"/);
  assert.match(fresh, /name="mode" value="new" checked/);
  assert.match(fresh, /id="lead-convert-new">/);
  assert.match(fresh, /id="lead-convert-existing" hidden>/);
  assert.match(fresh, /name="country" value=""[^>]* required>/);
  assert.match(fresh, /name="existing"[^>]* disabled>/);
  const link = ui.convertMarkup(L.detail(state, 'dup', TODAY), L.convertDefaults(state, 'dup'), { customers: ['Acme Trading'] });
  assert.match(link, /name="mode" value="existing" checked/);
  assert.match(link, /id="lead-convert-new" hidden>/);
  assert.match(link, /name="existing" value="Acme Trading"[^>]* required>/);
  assert.match(link, /name="country"[^>]* disabled>/);
  const invalid = ui.invalidMarkup(row);
  assert.match(invalid, /id="lead-invalid-form" data-id="open"/);
  for (const reason of L.INVALID_REASONS) assert.ok(invalid.includes(`<option value="${reason}">`), reason);
});

test('线索 is a real menu with its own pages, wired into the rail, the page shell and the click and submit handlers', () => {
  assert.deepEqual(RM.menuFor('线索').map(row => [row.label, row.kind, row.target]), [['线索列表', 'route', 'leads'], ['线索回收站', 'route', 'lead-trash']]);
  assert.equal(RM.sectionFor('leads').label, '线索');
  assert.equal(RM.sectionFor('lead-trash').label, '线索');
  const app = read('src/app.js'), shell = read('src/business-ui.js');
  assert.match(app, /\["lead", "线索", "leads"\]/);
  assert.match(app, /leads: "lead", "lead-trash": "folder"/);
  assert.match(shell, /leads: renderLeads,\s+"lead-trash": renderLeadTrash/);
  assert.match(shell, /if \(d\.leadAction && onLeadPage\(\)\) return leadAction\(d\);/);
  for (const id of ['lead-form', 'lead-follow-form', 'lead-convert-form', 'lead-invalid-form']) {
    assert.ok(shell.includes(`"${id}"`), id + ' is accepted by the submit handler');
    assert.ok(shell.includes(`form.id === "${id}"`), id + ' is handled');
  }
  assert.match(shell, /hasDraft: \(\) => !!draft \|\| !!oppDraft \|\| !!leadDraft \|\| settingsDirty/);
});
