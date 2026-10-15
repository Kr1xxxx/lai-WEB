// Speed check: with 5,000 synthetic customers the list, a customer page and a save must stay quick.
// The limits are about 3x the numbers measured on a normal laptop, so only a real slowdown (such as the old
// customers × orders loop) trips them. For the full table at 1k–15k customers run `node tests/e2e/perf-customers.mjs`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measure } from './perf-customers.mjs';

test('5,000 customers: first load, open a customer and save a follow-up stay within budget', async () => {
  const r = await measure(5000);
  assert.equal(r.errors, 0);
  assert.ok(r.loadMs < 6000, `first load ${r.loadMs} ms`);
  assert.ok(r.searchMs < 1500, `search ${r.searchMs} ms`);
  assert.ok(r.sortMs < 1500, `sort ${r.sortMs} ms`);
  assert.ok(r.detailMs < 3000, `open a customer ${r.detailMs} ms`);
  assert.ok(r.pageSaveMs < 5000, `save a follow-up ${r.pageSaveMs} ms`);
  assert.ok(r.apiSaveMs < 3000, `full save request ${r.apiSaveMs} ms`);
  assert.ok(r.apiDeltaMs < 1500, `changes-only save request ${r.apiDeltaMs} ms`);
  assert.ok(r.deltaKB < 50, `changes-only save size ${r.deltaKB} KB`);
});

test('a 25 MB save (about 20,000 customers) is accepted', async () => {
  const r = await measure(20000, { pageChecks: false });
  assert.ok(r.apiSaveMs < 10000, `save request ${r.apiSaveMs} ms`);
});
