'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');

function harness(request) {
  const notices = new Map(), timers = new Map();
  let sequence = 0;
  const context = {
    Date, fetch: request,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: {
      getElementById: id => notices.get(id),
      createElement() {
        const text = {}, button = { addEventListener() {} };
        return { hidden: false, setAttribute() {}, querySelector: selector => selector === 'span' ? text : button };
      },
      body: { appendChild(node) { notices.set(node.id, node); } },
    },
  };
  vm.runInNewContext(app.slice(app.indexOf('  let backupWarning'), app.indexOf('  async function persist(')), context);
  return {
    update: result => context.updateBackupNotice(result), timers, notices,
    async tick() {
      assert.equal(timers.size, 1, 'one bounded status check should be pending');
      const [id, timer] = [...timers][0]; timers.delete(id); await timer.fn();
    },
  };
}

test('pending mail backup is checked later and a background failure becomes a persistent warning', async () => {
  let requests = 0;
  const h = harness(async url => {
    assert.equal(url, '/api/backup-status'); requests++;
    return { ok: true, json: async () => ({ backup: { ok: false, message: 'Synthetic disk failure', pending: true, nextAttemptAt: Date.now() + 60000 } }) };
  });
  h.update({ ok: true, pending: true, nextAttemptAt: Date.now() + 2000 });
  await h.tick();
  assert.equal(requests, 1);
  assert.match(h.notices.get('backup-warning').querySelector('span').textContent, /Synthetic disk failure/);
  assert.equal(h.notices.get('backup-warning').hidden, false);
  assert.equal(h.timers.size, 1);
  h.update({ ok: true, pending: false, lastSuccessfulAt: Date.now() });
  assert.equal(h.notices.get('backup-warning').hidden, true);
  assert.equal(h.timers.size, 0);
});

test('status read failure keeps the last backup warning and schedules another read', async () => {
  const h = harness(async () => { throw new Error('Synthetic unavailable service'); });
  h.update({ ok: false, message: 'Backup failed', pending: true, nextAttemptAt: Date.now() });
  await h.tick();
  assert.equal(h.notices.get('backup-warning').hidden, false);
  assert.equal(h.timers.size, 1);
});

test('an older pending status response cannot override a later successful manual backup', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  h.update({ ok: true, pending: true, nextAttemptAt: Date.now() });
  assert.equal(h.timers.size, 1);
  const inFlight = h.tick();
  h.update({ ok: true, pending: false, lastSuccessfulAt: Date.now() });
  finish({ ok: true, json: async () => ({ backup: { ok: false, message: 'Old failure', pending: true } }) });
  await inFlight;
  assert.equal(h.timers.size, 0);
  assert.equal(h.notices.has('backup-warning'), false);
});
