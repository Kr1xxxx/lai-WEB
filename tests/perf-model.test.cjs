// Speed check for the pure customer-list logic: 10,000 customers with ~10,000 orders.
// Before the orders were grouped by customer this took over a second (customers × orders).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.js');
const S = require('../src/segments.js');

function synthetic(count) {
  const customers = {};
  const orders = [];
  for (let i = 0; i < count; i++) {
    const name = `Synthetic ${i}`;
    customers[name] = { client: name, owner: 'Kris', country: '美国', history: [{ type: 'followup', time: '2026-09-01T10:00:00', text: 'x' }] };
    if (i % 2 === 0) orders.push({ id: `o${i}`, client: name, amount: 100 + i, currency: 'USD', stage: 'done', createdAt: '2026-08-01' });
  }
  return { customers, orders, laiSettings: {} };
}

test('buildCustomers and enrich stay fast with 10,000 customers', () => {
  const state = synthetic(10000);
  const start = performance.now();
  const rows = S.enrich(M.buildCustomers(state), state);
  const ms = performance.now() - start;
  assert.equal(rows.length, 10000);
  assert.equal(rows.find((r) => r.name === 'Synthetic 2').orderCount, 1);
  assert.ok(ms < 1500, `took ${Math.round(ms)} ms`);
});
