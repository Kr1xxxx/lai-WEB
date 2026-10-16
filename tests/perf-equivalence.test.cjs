// 性能改动（缓存 / 按客户分组 / 公海规则只算一次）不能改变结果：
// 下面用固定种子的随机数据，和照旧算法写的参考实现逐项对比。
const test = require("node:test");
const assert = require("node:assert/strict");
const CS = require("../src/customer-settings-model.js");
const T = require("../src/customer-tools.js");
const M = require("../src/model.js");

let seed = 20261009;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (list) => list[Math.floor(rnd() * list.length)];
const NOW = new Date("2026-10-01T08:00:00.000Z");
const stamp = () => {
  const d = new Date(NOW.getTime() - Math.floor(rnd() * 500) * 86400000);
  const k = rnd();
  if (k < 0.15) return d.toISOString().slice(0, 10);
  if (k < 0.3) return d.toISOString().slice(0, 19).replace("T", " ");
  if (k < 0.35) return "not a date";
  if (k < 0.4) return "";
  return d.toISOString();
};

function dataset() {
  const customers = {};
  const orders = [];
  const opps = [];
  const N = 200;
  const types = ["followup", "email", "chat", "call", "operation", "mail", null, undefined];
  for (let i = 0; i < N; i++) {
    const name = `客户${i}`;
    const history = [];
    const n = Math.floor(rnd() * 12);
    for (let j = 0; j < n; j++) {
      const type = pick(types);
      if (type === null) { history.push(null); continue; }
      const item = { type, subtype: pick(["sent", "received", undefined]), text: "x" };
      if (rnd() < 0.7) item.time = stamp(); else item.date = stamp();
      if (type === "chat" && rnd() < 0.5) {
        if (rnd() < 0.7) item.lastSentAt = stamp();
        if (rnd() < 0.7) item.lastReceivedAt = stamp();
      }
      history.push(item);
    }
    const p = { owner: pick(["Kris", "Mia", "", "Zed"]), history, previewGroup: pick(["A", "A / 子", "B", ""]), createdAt: stamp() };
    if (rnd() < 0.3) p.lastFollowup = stamp();
    if (rnd() < 0.3) p.lastWrittenFollowup = stamp();
    if (rnd() < 0.3) p.lastContact = stamp();
    if (rnd() < 0.3) p.lastPrivatePoolEntry = stamp();
    if (rnd() < 0.3) p.opportunityLastWonDate = pick([stamp(), " 2026-02-02 "]);
    if (rnd() < 0.05) p.laiBucket = pick(["pool", "trash"]);
    if (rnd() < 0.1) p.previewFollowed = true;
    if (rnd() < 0.1) p.tags = ["跳过"];
    customers[name] = p;
  }
  for (let i = 0; i < 500; i++) {
    const o = { id: `o${i}`, client: rnd() < 0.05 ? `只在订单${i % 4}` : `客户${Math.floor(rnd() * N)}`, amount: pick([0, 100, 250]), createdAt: stamp(), stage: pick(["quote", "deposit", "production", "balance", "shipment", "done"]) };
    if (rnd() < 0.4) o.updated = stamp();
    if (rnd() < 0.3) o.shippedAt = stamp();
    if (rnd() < 0.15) o.isDraft = true;
    orders.push(o);
  }
  for (let i = 0; i < 150; i++) {
    const o = { id: `p${i}`, client: pick([` 客户${Math.floor(rnd() * N)} `, `客户${Math.floor(rnd() * N)}`]), createdAt: stamp() };
    if (rnd() < 0.6) o.updatedAt = stamp();
    opps.push(o);
  }
  return { customers, orders, laiOpportunities: opps };
}

// ---- 参考实现：照改动前的算法写，逐客户扫全部订单 / 商机 ----
const trim = (v) => String(v ?? "").trim();
const validTime = (v) => { const t = new Date(String(v ?? "").trim().replace(" ", "T")).getTime(); return Number.isFinite(t) && trim(v) ? t : NaN; };
function latestOf(values) {
  let best = ""; let bestTime = NaN;
  for (const v of values) {
    const t = validTime(v);
    if (Number.isFinite(t) && (!Number.isFinite(bestTime) || t > bestTime)) { best = typeof v === "string" ? v : new Date(t).toISOString(); bestTime = t; }
  }
  return best;
}
function refActionTimes(state, name, key) {
  const profile = (state.customers || {})[name] || {};
  const history = Array.isArray(profile.history) ? profile.history : [];
  const pickBy = (test) => history.filter((h) => h && test(h)).map((h) => h.time || h.date);
  if (key === "followup") return [...pickBy((h) => h.type === "followup"), profile.lastFollowup, profile.lastWrittenFollowup];
  if (key === "mailSent") return pickBy((h) => h.type === "email" && h.subtype === "sent");
  if (key === "mailReceived") return pickBy((h) => h.type === "email" && h.subtype !== "sent");
  const dir = (h) => h.type === "chat" && (h.lastSentAt || h.lastReceivedAt);
  if (key === "chatSent") return history.filter((h) => h && (h.type === "chat" || h.type === "call")).flatMap((h) => (dir(h) ? [h.lastSentAt] : [h.time || h.date]));
  if (key === "chatReceived") return history.filter((h) => h && h.type === "chat").map((h) => h.lastReceivedAt);
  if (key === "order") return (state.orders || []).filter((o) => o && o.client === name && !o.isDraft).flatMap((o) => [o.createdAt, o.updated]);
  if (key === "opportunity") return (state.laiOpportunities || []).filter((i) => i && trim(i.client) === name).flatMap((i) => [i.createdAt, i.updatedAt]);
  if (key === "claim") return [profile.lastPrivatePoolEntry];
  return [];
}
function refContactTimes(state, name) {
  const rules = CS.get(state).followRules;
  const profile = (state.customers || {})[name] || {};
  const calc = (keys, legacy) => latestOf([...keys.flatMap((key) => refActionTimes(state, name, key)), legacy]);
  // 取消勾选“写跟进”后，资料上的 lastFollowup 只给没有任何动态记录的老客户用（S1 修复 2）
  const tracked = (Array.isArray(profile.history) ? profile.history : []).some((h) => h && ["followup", "email", "chat", "call"].includes(h.type));
  const legacyFollowup = tracked && !rules.followup.includes("followup") ? "" : profile.lastFollowup;
  return { lastContact: calc(rules.contact, profile.lastContact), lastFollowup: calc(rules.followup, legacyFollowup) };
}
function refLastDeal(state, name) {
  const profile = (state.customers || {})[name] || {};
  // 数据里没有赢单阶段的商机，所以只剩资料上导入的日期；看不懂的值不再原样返回（S1 修复 1）
  if (CS.get(state).dealRule.by === "opportunity") return Number.isFinite(validTime(profile.opportunityLastWonDate)) ? trim(profile.opportunityLastWonDate) : "";
  return latestOf((state.orders || []).filter((o) => o && o.client === name && !o.isDraft && ["shipment", "done"].includes(o.stage)).map((o) => o.shippedAt || o.createdAt));
}
// 公海判断“最近联系”时，领回时间一定算（S1 修复 5）
const refTimes = { lastContact: (s, n) => latestOf([refContactTimes(s, n).lastContact, ((s.customers || {})[n] || {}).lastPrivatePoolEntry]), lastDeal: refLastDeal };

// 公海：照旧的 evaluate（每条规则各算一次时间，所有客户都建一遍）
const time = (v) => { const t = Date.parse(String(v || "").replace(" ", "T")); return Number.isFinite(t) ? t : NaN; };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function refCreation(p) {
  const base = [p.createdAt, ...(Array.isArray(p.history) ? p.history.map((h) => h?.time) : [])].map(time).filter(Number.isFinite);
  return base.length ? Math.min(...base) : NaN;
}
function refEvaluate(state, now, only) {
  const rules = T.poolRules(state);
  const active = rules.rules.filter((r) => r.enabled);
  const open = new Set(["quote", "deposit", "production", "balance"]);
  const white = new Set(rules.whitelist);
  const out = [];
  const matches = (rule, g) => { if (!rule.groups.length) return true; const x = trim(g); return !!x && rule.groups.some((p) => x === p || x.startsWith(`${p} / `)); };
  for (const row of M.buildCustomers(state)) {
    if (only && row.name !== only) continue;
    const p = state.customers[row.name] || {};
    if (["pool", "trash"].includes(p.laiBucket)) continue;
    const owner = trim(row.owner);
    if (!owner || white.has(owner)) continue;
    if (rules.skipFollowed && p.previewFollowed === true) continue;
    if (rules.skipTags.length && M.tags(p.tags).some((t) => rules.skipTags.includes(t))) continue;
    if (rules.skipOpenOrders && (state.orders || []).some((o) => o && o.client === row.name && !o.isDraft && open.has(o.stage))) continue;
    const g = row.group ?? p.previewGroup ?? p.customerGroup;
    const groups = Array.isArray(g) ? g.map(trim) : [trim(g)];
    let best = null;
    for (const rule of active) {
      if (!groups.some((x) => matches(rule, x))) continue;
      let basis = time(rule.kind === "noDeal" ? refTimes.lastDeal(state, row.name) : refTimes.lastContact(state, row.name));
      if (!Number.isFinite(basis)) basis = refCreation(p);
      if (!Number.isFinite(basis)) continue;
      if (rule.startDate) { const [y, m, d] = rule.startDate.split("-").map(Number); basis = Math.max(basis, new Date(y, m - 1, d).getTime()); }
      const days = Math.floor((now.getTime() - basis) / 86400000);
      const dueInDays = rule.days - days;
      if (!best || dueInDays < best.dueInDays) best = { name: row.name, owner, ruleId: rule.id, ruleName: rule.name, kind: rule.kind, days, dueInDays, basis: isoDay(new Date(basis)) };
    }
    if (best) out.push(best);
  }
  return out;
}

const withSettings = (state, settings) => ({ ...state, laiSettings: { ...(state.laiSettings || {}), customerSettings: settings } });
const COMBOS = [
  { followRules: { contact: ["followup", "mailSent", "mailReceived", "chatSent", "chatReceived"], followup: ["followup"] }, dealRule: { by: "order" } },
  { followRules: { contact: ["order", "opportunity", "claim"], followup: ["chatSent", "mailSent"] }, dealRule: { by: "opportunity" } },
  { followRules: { contact: ["followup", "order", "mailReceived", "opportunity"], followup: ["followup", "claim", "order"] }, dealRule: { by: "order" } },
  undefined,
];

test("最近联系 / 最近跟进 / 最近成交：和逐客户扫描的参考算法结果一致", () => {
  const base = dataset();
  const names = [...Object.keys(base.customers), "只在订单0", "只在订单1", "没有这个客户"];
  for (const combo of COMBOS) {
    const state = combo ? withSettings(base, combo) : base;
    for (const name of names) {
      assert.deepEqual(CS.contactTimes(state, name), refContactTimes(state, name), `contactTimes ${name}`);
      assert.equal(CS.lastDealDate(state, name), refLastDeal(state, name), `lastDealDate ${name}`);
    }
  }
});

test("设置缓存：同一份设置得到同一结果，换设置立刻生效，缺设置给默认", () => {
  const base = withSettings(dataset(), {});
  assert.equal(CS.get(base), CS.get(base));
  const changed = CS.setDealRule(base, "opportunity");
  assert.equal(CS.get(changed).dealRule.by, "opportunity");
  assert.equal(CS.get(base).dealRule.by, "order");
  const after = CS.setFollowRules(changed, { contact: ["chatSent"] });
  assert.deepEqual(CS.get(after).followRules.contact, ["chatSent"]);
  assert.notDeepEqual(CS.get(changed).followRules.contact, ["chatSent"]);
  assert.deepEqual(CS.get({}).stages, CS.get(undefined).stages);
});

test("订单 / 商机分组缓存：换了订单数组就重新分组", () => {
  const base = { customers: { 甲: {} }, orders: [{ client: "甲", stage: "done", createdAt: "2026-01-01T00:00:00.000Z" }], laiOpportunities: [] };
  assert.equal(CS.lastDealDate(base, "甲"), "2026-01-01T00:00:00.000Z");
  const next = { ...base, orders: [...base.orders, { client: "甲", stage: "shipment", createdAt: "2026-03-01T00:00:00.000Z" }] };
  assert.equal(CS.lastDealDate(next, "甲"), "2026-03-01T00:00:00.000Z");
  assert.equal(CS.lastDealDate(base, "甲"), "2026-01-01T00:00:00.000Z");
  const withOpp = { ...next, laiSettings: { customerSettings: { followRules: { contact: ["opportunity"], followup: ["followup"] } } }, laiOpportunities: [{ client: "甲", createdAt: "2026-05-05T00:00:00.000Z" }] };
  assert.equal(CS.contactTimes(withOpp, "甲").lastContact, "2026-05-05T00:00:00.000Z");
});

const RULESETS = [
  { rules: [{ name: "三个月没联系", kind: "noContact", days: 90, enabled: true }, { name: "半年没成交", kind: "noDeal", days: 180, enabled: true }], remindDays: 10 },
  { rules: [{ name: "A 组", kind: "noContact", days: 30, enabled: true, groups: ["A"] }, { name: "B 组", kind: "noDeal", days: 60, enabled: true, groups: ["B"] }, { name: "全部", kind: "noContact", days: 200, enabled: true, startDate: "2026-03-01" }, { name: "关掉的", kind: "noContact", days: 1, enabled: false }], remindDays: 30, skipOpenOrders: false, skipFollowed: false },
  { rules: [{ name: "全部", kind: "noContact", days: 45, enabled: true }], whitelist: ["Zed"], skipTags: ["跳过"], remindDays: 0 },
];

test("公海：候选名单、提醒、单个预测和旧算法完全一致", () => {
  const base = dataset();
  for (const combo of COMBOS) {
    const data = combo ? withSettings(base, combo) : base;
    for (const input of RULESETS) {
      const state = T.setPoolRules(data, input);
      const rules = T.poolRules(state);
      const all = refEvaluate(state, NOW);
      const byDays = (a, b) => b.days - a.days || a.name.localeCompare(b.name, "zh");
      assert.deepEqual(T.poolCandidates(state, rules, NOW), all.filter((c) => c.dueInDays <= 0).sort(byDays));
      const reminders = rules.remindDays
        ? all.filter((c) => c.dueInDays > 0 && c.dueInDays <= rules.remindDays).sort((a, b) => a.dueInDays - b.dueInDays || a.name.localeCompare(b.name, "zh"))
        : [];
      assert.deepEqual(T.poolReminders(state, NOW), reminders);
      // 注入参考的时间算法时，结果也一样
      assert.deepEqual(T.poolCandidates(state, rules, NOW, refTimes), T.poolCandidates(state, rules, NOW));
      const names = [...Object.keys(base.customers), "只在订单0", "没有这个客户"];
      for (const name of names) {
        const hit = refEvaluate(state, NOW, name)[0];
        const expected = !hit || (hit.dueInDays > 0 && hit.dueInDays > rules.remindDays) ? null : { ruleName: hit.ruleName, dueInDays: hit.dueInDays };
        assert.deepEqual(T.poolForecast(state, name, NOW), expected, `poolForecast ${name}`);
        // 只算一位，和在全部名单里找这一位一样
        assert.deepEqual(hit || null, all.find((c) => c.name === name) || null, `evaluate only ${name}`);
      }
    }
  }
});

test("公海：每位客户的最近联系 / 最近成交最多算一次", () => {
  const state = T.setPoolRules(dataset(), RULESETS[1]);
  const seen = new Map();
  const count = (kind) => (s, n) => { const key = `${kind}:${n}`; seen.set(key, (seen.get(key) || 0) + 1); return refTimes[kind === "c" ? "lastContact" : "lastDeal"](s, n); };
  T.poolCandidates(state, T.poolRules(state), NOW, { lastContact: count("c"), lastDeal: count("d") });
  assert.ok(seen.size > 0);
  for (const n of seen.values()) assert.equal(n, 1);
});
