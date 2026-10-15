// Synthetic customers/orders for speed checks. Every name, email and phone is invented (.example, 555);
// never put real customer data here (D-005).
const COUNTRIES = ['美国', '英国', '加拿大', '德国', '法国', '澳大利亚', '日本', '巴西', '阿联酋', '南非'];
const OWNERS = ['Kris', 'Mia', 'Leo', 'Zoe'];
const STAGES = ['quote', 'deposit', 'production', 'balance', 'shipment', 'done'];

// Small deterministic random generator so every run measures the same data.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** `count` customers; ~40% have 1-4 orders, every customer has 0-8 follow-up notes and 1-3 contacts. */
export function syntheticData(count, { seed = 7 } = {}) {
  const rand = rng(seed + count);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const day = 86400000;
  const now = Date.now();
  const customers = {};
  const orders = [];
  for (let i = 0; i < count; i++) {
    const name = `Synthetic Trading ${String(i + 1).padStart(5, '0')}`;
    const contacts = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, k) => `Contact ${i + 1}-${k + 1}`);
    const history = Array.from({ length: Math.floor(rand() * 9) }, (_, k) => ({
      type: 'followup', subtype: 'quick', time: new Date(now - Math.floor(rand() * 400) * day - k * 3600000).toISOString().slice(0, 19),
      text: `跟进记录 ${k + 1}：确认报价和交期，客户说下周回复。`, contact: contacts[0], owner: pick(OWNERS),
    }));
    customers[name] = {
      client: name, country: pick(COUNTRIES), owner: pick(OWNERS), contact: contacts[0], contacts,
      emails: contacts.map((_, k) => `c${i + 1}-${k + 1}@synthetic${i + 1}.example`), phones: contacts.map((_, k) => `+1 555 ${String(i).padStart(4, '0')} ${k}`),
      createdAt: new Date(now - Math.floor(rand() * 700) * day).toISOString(), history,
      lastFollowup: history[0]?.time,
    };
    if (rand() < 0.4) {
      for (let k = 0, n = 1 + Math.floor(rand() * 4); k < n; k++) {
        const created = new Date(now - Math.floor(rand() * 500) * day);
        orders.push({ id: `perf-o-${i}-${k}`, num: `PF-${i}-${k}`, client: name, country: customers[name].country, createdAt: created.toISOString().slice(0, 10), orderMonth: created.toISOString().slice(0, 7), currency: 'USD', stage: pick(STAGES), amount: 500 + Math.floor(rand() * 20000), paidAmount: 0, isDraft: false });
      }
    }
  }
  return { customers, orders };
}
