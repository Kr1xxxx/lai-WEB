// Merge policy (docs/DECISIONS.md D-014): which pull requests merge on their own and which wait for the owner.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = () => import(path.join(__dirname, '../scripts/classify-pr.mjs'));
const file = (p, added = 5, deleted = 0, status = 'M') => ({ path: p, added, deleted, status });

test('small wording, styling and fix changes merge on their own', async () => {
  const { classify } = await load();
  const result = classify({ files: [file('src/business.css', 6, 2), file('src/app.js', 4, 4), file('docs/HANDOFF.md', 3, 1)], uiDiff: '+  gap: 8px;\n-  gap: 6px;', labels: [] });
  assert.deepEqual(result, { size: 'small', reasons: [] });
});

test('docs, tests, browser checks and acceptance scripts are small', async () => {
  const { classify } = await load();
  const files = [file('docs/handoff-log.md', 40), file('tests/e2e/new.e2e.mjs', 120), file('scripts/web-trial/leads-check.cjs', 30), file('scripts/order-workflow-acceptance.mjs', 10)];
  assert.equal(classify({ files, uiDiff: '', labels: [] }).size, 'small');
});

test('app shell, backend, dependencies, CI, scripts and the rulebook wait for the owner', async () => {
  const { classify } = await load();
  for (const p of ['native/Sources/LaiNative/main.swift', 'backend/storage.js', 'vendor/squire/squire-raw.js', 'assets/AppIcon.icns', 'package.json', 'source-manifest.json',
    '.github/workflows/ci.yml', '.gitignore', 'scripts/build.py', 'scripts/web-trial/rebuild.py', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'docs/DECISIONS.md']) {
    assert.equal(classify({ files: [file(p)], uiDiff: '', labels: [] }).size, 'big', p);
  }
});

test('data storage changes inside the page wait for the owner', async () => {
  const { classify } = await load();
  const run = (uiDiff) => classify({ files: [file('src/app.js')], uiDiff, labels: [] }).size;
  assert.equal(run("+  localStorage.setItem(KEY, value);"), 'big');
  assert.equal(run("-  body: JSON.stringify({ state, baseRevision })"), 'big');
  assert.equal(run('@@ -1 +1 @@ localStorage context line'), 'small', 'hunk headers do not count');
});

test('more than the line limit of src/ waits for the owner; tests do not count', async () => {
  const { classify, UI_LINE_LIMIT } = await load();
  const run = (files) => classify({ files, uiDiff: '', labels: [] }).size;
  assert.equal(run([file('src/app.js', UI_LINE_LIMIT, 0)]), 'small');
  assert.equal(run([file('src/app.js', UI_LINE_LIMIT, 1)]), 'big');
  assert.equal(run([file('tests/x.test.cjs', 900)]), 'small');
});

test('deleting app files, loosening tests or the major label waits for the owner', async () => {
  const { classify } = await load();
  const run = (files, labels = []) => classify({ files, uiDiff: '', labels }).size;
  assert.equal(run([file('src/old.js', 0, 20, 'D')]), 'big');
  assert.equal(run([file('tests/a.test.cjs', 2, 30)]), 'big');
  assert.equal(run([file('tests/a.test.cjs', 5, 12)]), 'small');
  assert.equal(run([file('src/app.js', 3, 1)], ['major']), 'big');
});

test('handoff check: app changes need docs/HANDOFF.md, docs-only changes do not', async () => {
  const { checkHandoff } = await import(path.join(__dirname, '../scripts/check-handoff.mjs'));
  assert.deepEqual(checkHandoff(['src/app.js']), { touchesApp: true, ok: false });
  assert.deepEqual(checkHandoff(['backend/server.js', 'docs/HANDOFF.md']), { touchesApp: true, ok: true });
  assert.deepEqual(checkHandoff(['docs/handoff-log.md', 'tests/model.test.cjs']), { touchesApp: false, ok: true });
  assert.equal(checkHandoff(['scripts/build.py']).ok, false);
});
