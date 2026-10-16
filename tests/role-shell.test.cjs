// 角色权限在客户页面上的用法：没有权限的按钮和页签不画出来。账号切换和页面范围由 tests/e2e/roles-customers.e2e.mjs 覆盖。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/role-model.js');
const List = require('../src/customer-list-ui.js');
const SettingsUI = require('../src/customer-settings-ui.js');
const M = require('../src/model.js');

const row = { name: 'Acme', country: '美国', tags: [], owner: 'Kris', orderCount: 0, orders: [], history: [], followed: false };
const listHtml = (can, selected = new Set()) => List.render({
  rows: [row], p: { items: [row], total: 1, page: 1, pageCount: 1 }, filters: { group: 'all', field: 'name', query: '', owner: '' },
  selected, pageSize: 20, segments: [], groupTab: 'groups', expanded: new Set(), team: 'team', icon: () => '', escape: M.escapeHtml, tableMarkup: () => '<table></table>', can,
});

test('the customer list hides 新建客户 and the batch actions the role lacks', () => {
  const none = () => false;
  const html = listHtml(none, new Set(['Acme']));
  assert.doesNotMatch(html, /data-action="new"/);
  assert.doesNotMatch(html, /data-action="create-menu"/);
  assert.doesNotMatch(html, /data-action="batch-followup"/);
  assert.doesNotMatch(html, /data-action="batch-edit-field"/);
  const all = listHtml(() => true, new Set(['Acme']));
  assert.match(all, /data-action="batch-followup"/);
  assert.match(all, /data-action="batch-edit-field"/);
  assert.match(listHtml(() => true), /data-action="new"/);
  assert.match(listHtml(() => true), /data-action="create-menu"/);
  // Without a permission checker (older callers) nothing is hidden.
  assert.match(listHtml(undefined), /data-action="new"/);
});

test('the customer detail has no edit or merge entry for a role without those permissions', () => {
  const D = require('../src/customer-detail-ui.js');
  const state = { customers: { Acme: { client: 'Acme', owner: 'Amy' } }, orders: [], laiSettings: { roles: { roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'customer.view': true } }], members: [{ id: 'a', name: 'Kris', roleId: 'admin' }, { id: 'b', name: 'Amy', roleId: 'sales' }], current: 'b' } } };
  const customer = M.buildCustomers(state)[0];
  globalThis.LaiRoleModel = R;
  try {
    const limited = D.render(customer, { state, escape: M.escapeHtml });
    assert.doesNotMatch(limited, /data-action="edit"/);
    assert.doesNotMatch(limited, /data-feature="合并客户"/);
    assert.doesNotMatch(limited, /data-action="add-contact"/);
    const admin = D.render(customer, { state: { ...state, laiSettings: { roles: { ...state.laiSettings.roles, current: 'a' } } }, escape: M.escapeHtml });
    assert.match(admin, /data-action="edit"/);
    assert.match(admin, /data-feature="合并客户"/);
    assert.match(admin, /data-action="add-contact"/);
  } finally {
    delete globalThis.LaiRoleModel;
  }
});

test('the customer settings page hides the tabs and shortcut a role has no permission for', () => {
  const s = { customers: {}, orders: [], laiSettings: {} };
  const full = SettingsUI.markup(s, { tab: 'groups' }, M.escapeHtml, []);
  assert.match(full, /data-cs-tab="dedupe"/);
  assert.match(full, /data-cs-tab="sources"/);
  assert.match(full, /data-lai-route="settings"/);
  const limited = SettingsUI.markup(s, { tab: 'dedupe', hiddenTabs: ['dedupe', 'sources'], canOpenSettings: false }, M.escapeHtml, []);
  assert.doesNotMatch(limited, /data-cs-tab="dedupe"/);
  assert.doesNotMatch(limited, /data-cs-tab="sources"/);
  assert.doesNotMatch(limited, /data-lai-route="settings"/);
  assert.match(limited, /data-cs-panel="groups"/, 'a hidden tab falls back to the first one');
});

test('app.js guards every customer action handler, not just the buttons', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const body = (name) => {
    const start = app.search(new RegExp(`  (async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    return app.slice(start, start + 700);
  };
  const guards = {
    batchFollowupDialog: 'customer.batchFollow', mergeDialog: 'customer.merge', batchCreateDialog: 'customer.create', batchTagsDialog: 'customer.edit',
    batchFieldDialog: 'customer.edit', tagManagerDialog: 'customer.edit', scheduleDialog: 'customer.edit', importCustomers: 'customer.import', saveImport: 'customer.import',
    transitionDialog: 'customer.toPool', claimDialog: 'pool.claim', editForm: 'customer.create', follow: 'customer.unfollow', batchOwnerDialog: 'customer.removeOwner',
  };
  for (const [fn, key] of Object.entries(guards)) assert.match(body(fn), new RegExp(`["']${key.replace('.', '\\.')}["']`), `${fn} checks ${key}`);
  assert.match(body('batchOwnerDialog'), /customer\.reassign/);
  assert.match(body('transitionDialog'), /customer\.trash/);
  assert.match(body('editForm'), /pool\.edit/);
});
