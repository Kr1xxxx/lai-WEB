'use strict';
// The page's backup warning (src/app.js updateBackupNotice): ported from the 1.4.127 branch. The code between
// `let backupWarning` and `async function rebaseAfterConflict(` runs here with small stand-ins for the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { appSource } = require('./helpers/source.cjs');
const app = appSource();

function harness(request, manualBackup) {
  const notices = new Map(), timers = new Map(), toasts = [];
  let sequence = 0;
  const context = {
    Date, toasts,
    fetch: (url, options) => url === '/api/manual-backup' ? manualBackup(options) : request(url, options),
    toast: text => toasts.push(text),
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: {
      getElementById: id => notices.get(id),
      createElement() {
        const handlers = {}, button = { disabled: false, addEventListener(type, fn) { handlers[type] = fn; } };
        return { hidden: false, handlers, button, setAttribute() {}, querySelector: selector => selector === 'button' ? button : null };
      },
      body: { appendChild(node) { notices.set(node.id, node); } },
    },
  };
  vm.runInNewContext(app.slice(app.indexOf('  let backupWarning'), app.indexOf('  async function rebaseAfterConflict(')), context);
  return {
    update: result => context.updateBackupNotice(result), timers, notices, toasts,
    notice: () => notices.get('backup-warning'),
    async tick() {
      assert.equal(timers.size, 1, 'one status check should be waiting');
      const [id, timer] = [...timers][0]; timers.delete(id); await timer.fn();
    },
  };
}

test('a background backup failure becomes a warning in plain Chinese, never the raw error', async () => {
  let requests = 0;
  const h = harness(async url => {
    assert.equal(url, '/api/backup-status'); requests++;
    return { ok: true, json: async () => ({ backup: { ok: false, message: 'Synthetic ENOSPC disk failure', pending: true, nextAttemptAt: Date.now() + 60000 } }) };
  });
  h.update({ ok: true, pending: true, nextAttemptAt: Date.now() + 2000 });
  assert.equal(h.notice(), undefined, 'no warning while the backup is only waiting');
  await h.tick();
  assert.equal(requests, 1);
  assert.equal(h.notice().hidden, false);
  assert.match(h.notice().innerHTML, /备份没有成功，数据已保存。/);
  assert.match(h.notice().innerHTML, />重试</);
  assert.doesNotMatch(h.notice().innerHTML, /Synthetic|ENOSPC/);
  assert.equal(h.timers.size, 1, 'it keeps checking while the backup is still due');
  h.update({ ok: true, pending: false, lastSuccessfulAt: Date.now() });
  assert.equal(h.notice().hidden, true);
  assert.equal(h.timers.size, 0);
});

test('the retry button makes a backup and clears the warning when it works', async () => {
  let result = { ok: false, message: 'Synthetic failure', pending: true, nextAttemptAt: Date.now() + 60000 };
  const h = harness(async () => { throw new Error('unused'); }, async options => { assert.equal(options.method, 'POST'); return { json: async () => result }; });
  h.update(result);
  assert.equal(h.notice().hidden, false);
  await h.notice().handlers.click();
  assert.equal(h.notice().hidden, false); assert.equal(h.toasts.at(-1), '备份还是没有成功，请稍后再试');
  result = { ok: true, pending: false, lastSuccessfulAt: Date.now() };
  await h.notice().handlers.click();
  assert.equal(h.notice().hidden, true); assert.equal(h.toasts.at(-1), '备份已完成');
  assert.equal(h.notice().button.disabled, false);
});

test('a failed status read keeps the warning and schedules another read', async () => {
  const h = harness(async () => { throw new Error('Synthetic unavailable service'); });
  h.update({ ok: false, message: 'Backup failed', pending: true, nextAttemptAt: Date.now() });
  await h.tick();
  assert.equal(h.notice().hidden, false);
  assert.equal(h.timers.size, 1);
});

test('an older status reply cannot override a later successful backup', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  h.update({ ok: true, pending: true, nextAttemptAt: Date.now() });
  const inFlight = h.tick();
  h.update({ ok: true, pending: false, lastSuccessfulAt: Date.now() });
  finish({ ok: true, json: async () => ({ backup: { ok: false, message: 'Old failure', pending: true } }) });
  await inFlight;
  assert.equal(h.timers.size, 0);
  assert.equal(h.notice(), undefined);
});
