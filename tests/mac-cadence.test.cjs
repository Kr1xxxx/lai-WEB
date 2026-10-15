// When CI builds the Mac app (docs/DECISIONS.md D-016).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = () => import(path.join(__dirname, '../scripts/mac-cadence.mjs'));
// D-019: desktop builds are paused (PAUSED in the script). The cadence tests below pass paused: false to state
// the rules that apply again when the pause is lifted.
const merge = (n, branch) => `Merge pull request #${n} from Kr1xxxx/${branch}`;

test('only Claude PR merges are counted', async () => {
  const { claudeMerges } = await load();
  assert.equal(claudeMerges([merge(3, 'claude/a'), merge(2, 'codex/b'), 'Merge claude/old into main', merge(1, 'claude/c')]), 2);
});

test('while desktop builds are paused (D-019) nothing builds the Mac app automatically; a manual run still does', async () => {
  const { needsMac, dueAfterMerge, PAUSED } = await load();
  assert.equal(PAUSED, true);
  assert.equal(needsMac({ event: 'pull_request', headRef: 'claude/x', files: ['native/Sources/LaiNative/main.swift'] }), false);
  assert.equal(needsMac({ event: 'pull_request', headRef: 'codex/x', files: ['src/app.js'] }), false);
  assert.equal(needsMac({ event: 'push', headSubject: merge(40, 'claude/x'), mergedCount: 10 }), false);
  assert.equal(dueAfterMerge(10), false);
  assert.equal(needsMac({ event: 'workflow_dispatch' }), true);
});

test('Claude PRs skip the Mac build unless they change the Swift shell or the build script', async () => {
  const { needsMac } = await load();
  assert.equal(needsMac({ event: 'pull_request', headRef: 'claude/x', files: ['src/app.js', 'backend/server.js'], paused: false }), false);
  assert.equal(needsMac({ event: 'pull_request', headRef: 'claude/x', files: ['native/Sources/LaiNative/main.swift'], paused: false }), true);
  assert.equal(needsMac({ event: 'pull_request', headRef: 'claude/x', files: ['scripts/build.py'], paused: false }), true);
});

test('Codex and people keep a Mac build on every PR that changes the app', async () => {
  const { needsMac } = await load();
  assert.equal(needsMac({ event: 'pull_request', headRef: 'codex/x', files: ['src/app.js'], paused: false }), true);
  assert.equal(needsMac({ event: 'pull_request', headRef: 'feature/x', files: ['docs/HANDOFF.md', 'tests/a.test.cjs'], paused: false }), false);
});

test('main builds after every 10th merged Claude PR; manual runs always build', async () => {
  const { needsMac, dueAfterMerge, EVERY } = await load();
  assert.equal(EVERY, 10);
  assert.equal(needsMac({ event: 'push', headSubject: merge(40, 'claude/x'), mergedCount: 10, paused: false }), true);
  assert.equal(needsMac({ event: 'push', headSubject: merge(41, 'claude/x'), mergedCount: 11, paused: false }), false);
  assert.equal(needsMac({ event: 'push', headSubject: merge(42, 'codex/x'), mergedCount: 20, paused: false }), false, 'a Codex merge does not count');
  assert.equal(needsMac({ event: 'workflow_dispatch' }), true);
  assert.deepEqual([9, 10, 11, 20, 0].map((n) => dueAfterMerge(n, false)), [false, true, false, true, false]);
});
