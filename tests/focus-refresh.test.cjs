const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the shipped async handler, controlling only its persistence/UI boundary.
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const start = app.indexOf('  let focusRefreshInProgress = false;');
const end = app.indexOf('\n  business = window.LaiBusinessUI.create', start);
assert.ok(start >= 0 && end > start);
const source = app.slice(start, end);
function harness({dirty = false, wait = false} = {}) {
  let focus, reads = 0, refreshes = 0, rebuilds = 0, release;
  const original = {orders: [], customers: {Synthetic: {}}, laiSettings: {companyName: 'Old'}};
  const updated = {orders: [], customers: {Synthetic: {}}, laiSettings: {companyName: 'External'}};
  const response = {ok: true, json: async () => ({data: updated, revision: 2})};
  const boundary = {
    window: {addEventListener(event, fn) { assert.equal(event, 'focus'); focus = fn; }},
    nativeWindowBridge: () => true, pending: null, modal: null,
    state: original, revision: 1, mail: {composing:()=>false}, business: {hasDraft: () => dirty},
    followupDrafts: new Map(),
    async fetch() { reads++; return wait ? new Promise(resolve => {release = resolve;}) : response; },
    rebuildRows() {rebuilds++;}, refresh() {refreshes++;},
  };
  vm.createContext(boundary); vm.runInContext(source, boundary);
  return {boundary, original, updated, focus: () => focus(), setDirty(value) {dirty = value;}, release: () => release(response),
    get reads() {return reads;}, get refreshes() {return refreshes;}, get rebuilds() {return rebuilds;}};
}

test('focus does not refresh over an existing unsaved settings draft', async () => {
  const h = harness({dirty: true}); await h.focus();
  assert.equal(h.reads, 0); assert.equal(h.refreshes, 0);
  assert.equal(h.boundary.state, h.original); assert.equal(h.boundary.revision, 1);
});
test('settings edits started while the refresh request is pending keep the visible state and revision', async () => {
  const h = harness({wait: true}); const pending = h.focus();
  assert.equal(h.reads, 1); h.setDirty(true); h.release(); await pending;
  assert.equal(h.refreshes, 0); assert.equal(h.rebuilds, 0);
  assert.equal(h.boundary.state, h.original); assert.equal(h.boundary.revision, 1);
});
test('a followup draft started during refresh is retained rather than overwritten', async () => {
  const h = harness({wait: true}); const pending = h.focus();
  h.boundary.followupDrafts.set('Synthetic', {text: 'Unsaved followup'}); h.release(); await pending;
  assert.equal(h.refreshes, 0); assert.equal(h.boundary.state, h.original);
});
test('cancelling the settings draft allows the next focus to load the newer revision', async () => {
  const h = harness({dirty: true}); await h.focus(); h.setDirty(false); await h.focus();
  assert.equal(h.reads, 1); assert.equal(h.refreshes, 1); assert.equal(h.rebuilds, 1);
  assert.equal(h.boundary.state, h.updated); assert.equal(h.boundary.revision, 2);
});
test('only one focus read is pending, and a failed read releases the guard for retry', async () => {
  const h = harness({wait: true}); const pending = h.focus(); await h.focus(); assert.equal(h.reads, 1);
  h.release(); await pending; assert.equal(h.refreshes, 1);
  h.boundary.fetch = async () => {throw new Error('Synthetic network failure');}; await h.focus();
  h.boundary.fetch = async () => ({ok: true, json: async () => ({data: h.updated, revision: 3})}); await h.focus();
  assert.equal(h.refreshes, 2); assert.equal(h.boundary.revision, 3);
});
test('an older service snapshot cannot roll back the visible customer state', async () => {
  const h = harness(); h.boundary.revision = 3; await h.focus();
  assert.equal(h.reads, 1); assert.equal(h.refreshes, 0);
  assert.equal(h.boundary.state, h.original); assert.equal(h.boundary.revision, 3);
});
test('a successful response with incomplete customer data cannot replace current state', async () => {
  const h = harness();
  h.boundary.fetch = async () => ({ok: true, json: async () => ({data: {orders: null, customers: {}}, revision: 2})});
  await h.focus();
  assert.equal(h.refreshes, 0); assert.equal(h.rebuilds, 0);
  assert.equal(h.boundary.state, h.original); assert.equal(h.boundary.revision, 1);
});

const activityStart = app.indexOf('  async function refreshActivity(pointerActivated = false) {');
const activityEnd = app.indexOf('\n  function switchDetailTab(', activityStart);
assert.ok(activityStart >= 0 && activityEnd > activityStart);
const activitySource = app.slice(activityStart, activityEnd);
function activityHarness() {
  let release, rebuilds = 0, rendered = 0;
  const original = {orders: [], customers: {Synthetic: {history: []}}};
  const updated = {orders: [], customers: {Synthetic: {history: [{text: 'New'}]}}};
  const document = {body: {}, activeElement: null};
  const makeButton = () => ({disabled: false, classList: {add() {}, remove() {}}, focus() {document.activeElement = this;}});
  const button = makeButton();
  document.activeElement = button;
  let visibleButton = button;
  const results = {setAttribute() {}, removeAttribute() {}};
  const label = {textContent: '', isConnected: false};
  const boundary = {
    document, activityRefreshInProgress: false, tab: 'activity', currentName: 'Synthetic',
    pending: null, modal: null, state: original, revision: 1,
    $: selector => ({"[data-action='refresh-activity']": visibleButton, '#activity-results': results,
      '#activity-refresh-status': label})[selector],
    toast() {}, setTimeout() {},
    fetch: () => new Promise(resolve => {release = (ok = true) => resolve({ok, json: async () => ({data: updated, revision: 2})});}),
    rebuildRows() {rebuilds++;}, allCustomerRows: () => [{name: 'Synthetic'}],
    replaceDetailBody() {rendered++;}, list() {},
  };
  vm.createContext(boundary);
  vm.runInContext(`${activitySource}\nthis.runRefresh = refreshActivity;`, boundary);
  return {boundary, original, updated, run: () => boundary.runRefresh(), release: () => release(), fail: () => release(false),
    get visibleButton() {return visibleButton;},
    replaceVisibleButton: () => { visibleButton = makeButton(); },
    get rebuilds() {return rebuilds;}, get rendered() {return rendered;}};
}
test('an activity response is discarded after navigating away from its customer', async () => {
  const h = activityHarness(); const pending = h.run();
  h.boundary.tab = 'info'; h.boundary.currentName = 'Other'; h.release(); await pending;
  assert.equal(h.boundary.state, h.original); assert.equal(h.boundary.revision, 1);
  assert.equal(h.rebuilds, 0); assert.equal(h.rendered, 0);
});
test('an activity response is discarded after leaving and reopening the same activity view', async () => {
  const h = activityHarness(); const pending = h.run();
  h.boundary.tab = 'info';
  h.replaceVisibleButton();
  h.boundary.tab = 'activity';
  h.release(); await pending;
  assert.equal(h.boundary.state, h.original); assert.equal(h.boundary.revision, 1);
  assert.equal(h.rebuilds, 0); assert.equal(h.rendered, 0);
});
test('an activity response cannot overwrite state after an editor opens', async () => {
  const h = activityHarness(); const pending = h.run();
  h.boundary.modal = 'edit'; h.release(); await pending;
  assert.equal(h.boundary.state, h.original); assert.equal(h.boundary.revision, 1);
  assert.equal(h.rebuilds, 0); assert.equal(h.rendered, 0);
});
test('an activity response updates the visible customer when the view is unchanged', async () => {
  const h = activityHarness(); const pending = h.run(); h.release(); await pending;
  assert.equal(h.boundary.state, h.updated); assert.equal(h.boundary.revision, 2);
  assert.equal(h.rebuilds, 1); assert.equal(h.rendered, 1);
});

test('an activity keyboard failure returns focus to the existing retry button', async () => {
  const h = activityHarness(); const pending = h.run();
  h.boundary.document.activeElement = h.boundary.document.body;
  h.fail(); await pending;
  assert.equal(h.visibleButton.disabled, false);
  assert.equal(h.boundary.document.activeElement, h.visibleButton);
  assert.equal(h.boundary.revision, 1); assert.equal(h.boundary.state, h.original);
});
test('a canceled activity response does not claim keyboard focus in a reopened view', async () => {
  const h = activityHarness(); const pending = h.run();
  h.replaceVisibleButton();
  h.boundary.document.activeElement = h.boundary.document.body;
  h.release(); await pending;
  assert.equal(h.boundary.document.activeElement, h.boundary.document.body);
  assert.equal(h.rendered, 0); assert.equal(h.boundary.state, h.original);
});

const refreshStart=app.indexOf('  function refresh() {');
const refreshEnd=app.indexOf('\n  function companyDisplayLayoutFromPanel(',refreshStart);
const routeRefreshSource=app.slice(refreshStart,refreshEnd);
test('focus refresh keeps the empty favorites page instead of rendering the previous business route',async()=>{
  const h=harness();let favorites=0,business=0;
  Object.assign(h.boundary,{activeRoute:'favorites',business:{hasDraft:()=>false,refresh:()=>business++},showFavoritesHome:()=>favorites++});
  vm.runInContext(routeRefreshSource,h.boundary);await h.focus();
  assert.equal(h.boundary.revision,2);assert.equal(h.rebuilds,1);assert.equal(favorites,1);assert.equal(business,0);
});
test('route refresh continues to dispatch mail, customer detail, list and business pages',()=>{
  const calls=[];const ctx={activeRoute:'mail',currentName:'Synthetic',customerScreen:'pool',mail:{refresh:()=>calls.push('mail')},business:{refresh:()=>calls.push('business')},showFavoritesHome:()=>calls.push('favorites'),detail:(name,reload)=>calls.push([name,reload]),showCustomerScreen:screen=>calls.push(screen)};
  vm.createContext(ctx);vm.runInContext(routeRefreshSource+'\nthis.runRefresh=refresh;',ctx);
  ctx.runRefresh();ctx.activeRoute='customers';ctx.runRefresh();ctx.currentName='';ctx.runRefresh();ctx.activeRoute='analysis';ctx.runRefresh();
  assert.deepEqual(calls,['mail',['Synthetic',true],'pool','business']);
});
