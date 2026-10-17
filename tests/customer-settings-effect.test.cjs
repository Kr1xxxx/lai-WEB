// 客户设置里的每一项都要真的起作用（S1）：成交规则按商机、最近跟进、分组改名同步公海规则和客群条件、
// 判重、查重页、客户上限、黑名单多邮箱、大小写。
const test = require("node:test");
const assert = require("node:assert/strict");
const CS = require("../src/customer-settings-model.js");
const M = require("../src/model.js");
const LM = require("../src/modules.js");
const CT = require("../src/customer-tools.js");
const CI = require("../src/customer-import.js");
const S = require("../src/segments.js");

const NOW = new Date("2026-10-16T12:00:00.000Z");
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();
const base = (extra = {}) => ({ orders: [], customers: {}, laiSettings: {}, ...extra });
const rule = (extra = {}) => ({ name: "r", kind: "noContact", days: 90, enabled: true, groups: [], startDate: "", ...extra });
const candidates = (state) => CT.poolCandidates(state, CT.poolRules(state), NOW).map((c) => c.name);
const withCustomerSettings = (state, patch) => ({ ...state, laiSettings: { ...state.laiSettings, customerSettings: { ...(state.laiSettings.customerSettings || {}), ...patch } } });

// ---------- 1. 成交规则“按商机” ----------
test("成交规则按商机：赢单商机算成交日期，90 天没成交的规则不再列出这位客户", () => {
  let s = base({
    customers: { A: { country: "US", owner: "u", createdAt: ago(300) }, B: { country: "US", owner: "u", createdAt: ago(300) } },
    laiOpportunities: [{ id: "o1", client: "A", stage: "done", closedAt: ago(5), createdAt: ago(40), updatedAt: ago(5) }],
  });
  s = CS.setDealRule(s, "opportunity");
  s = CT.savePoolRule(s, rule({ kind: "noDeal" }));
  assert.equal(CS.lastDealDate(s, "A"), CS.lastWonDate(s, "A"));
  assert.match(CS.lastDealDate(s, "A"), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(candidates(s), ["B"], "A 五天前赢单，不该被列出；没有商机的 B 照常列出");
});

test("成交规则按商机：进行中、输单的商机不算；取最晚的赢单；资料上导入的日期作为后备", () => {
  const s = base({
    customers: { A: { country: "US" }, Imported: { country: "US", opportunityLastWonDate: "2026-02-02" } },
    laiOpportunities: [
      { id: "1", client: "A", stage: "open", closedAt: ago(1), createdAt: ago(2) },
      { id: "2", client: "A", stage: "lost", closedAt: ago(2), createdAt: ago(9) },
      { id: "3", client: "A", stage: "balance", closedAt: "2026-07-01T10:00:00.000Z", createdAt: ago(100) },
      { id: "4", client: "A", stage: "done", closedAt: "2026-08-15", createdAt: ago(100) },
    ],
  });
  assert.equal(CS.lastWonDate(s, "A"), "2026-08-15");
  assert.equal(CS.lastWonDate(s, "Imported"), "2026-02-02");
  assert.equal(CS.lastWonDate(s, "Nobody"), "");
  assert.equal(CS.lastDealDate(s, "A"), "", "按订单算时不看商机");
  assert.equal(CS.lastDealDate(CS.setDealRule(s, "opportunity"), "A"), "2026-08-15");
});

test("最近赢单日期这一列读商机，不再只读资料上的字段", () => {
  const s = base({
    customers: { A: { country: "US", owner: "u" } },
    laiOpportunities: [{ id: "1", client: "A", stage: "done", closedAt: "2026-09-10", createdAt: "2026-08-01" }],
  });
  const row = S.enrich(M.buildCustomers(s), s).find((r) => r.name === "A");
  assert.equal(row.lastWonDate, "2026-09-10");
});

// ---------- 2. 最近跟进可以去掉“写跟进” ----------
test("最近跟进：去掉“写跟进”后，资料上的最近跟进时间不再把它带回来", () => {
  let s = base({ customers: { A: {
    country: "US", owner: "u", createdAt: ago(200), lastFollowup: ago(3), lastWrittenFollowup: ago(3),
    history: [{ time: ago(3), text: "x", type: "followup" }, { time: ago(50), text: "m", type: "email", subtype: "sent" }],
  } } });
  const age = (iso) => Math.round((NOW.getTime() - Date.parse(iso)) / 86400000);
  assert.equal(age(CS.contactTimes(s, "A").lastFollowup), 3);
  s = CS.setFollowRules(s, { followup: ["mailSent"] });
  assert.equal(age(CS.contactTimes(s, "A").lastFollowup), 50);
  s = CS.setFollowRules(s, { followup: ["mailSent", "followup"] });
  assert.equal(age(CS.contactTimes(s, "A").lastFollowup), 3, "勾回“写跟进”又算");
});

test("最近跟进：导入的老客户没有任何动态记录时，仍用资料上的时间", () => {
  let s = base({ customers: { Old: { country: "US", lastFollowup: "2026-05-05T00:00:00.000Z", history: [{ time: ago(1), type: "operation", text: "导入客户档案" }] } } });
  s = CS.setFollowRules(s, { followup: ["mailSent"] });
  assert.equal(CS.contactTimes(s, "Old").lastFollowup, "2026-05-05T00:00:00.000Z");
});

// ---------- 3. 分组改名 / 删除 与 公海规则 ----------
test("客户分组改名：公海规则里的分组（含子分组）跟着改，规则不会悄悄失效", () => {
  let s = base({ customers: { A: { country: "US", owner: "u", createdAt: ago(300), previewGroup: "VIP / 美国" } } });
  s = CS.addGroup(s, { name: "VIP" });
  const vip = CS.get(s).groups[0];
  s = CS.addGroup(s, { name: "美国", parentId: vip.id });
  s = CT.savePoolRule(s, rule({ name: "一级", groups: ["VIP"] }));
  s = CT.savePoolRule(s, rule({ name: "子级", groups: ["VIP / 美国", "别的"] }));
  assert.deepEqual(candidates(s), ["A"]);
  s = CS.editGroup(s, vip.id, { name: "重点" });
  assert.deepEqual(CT.poolRules(s).rules.map((r) => r.groups), [["重点"], ["重点 / 美国", "别的"]]);
  assert.deepEqual(candidates(s), ["A"]);
  const child = CS.get(s).groups[0].children[0];
  s = CS.editGroup(s, child.id, { name: "北美" });
  assert.deepEqual(CT.poolRules(s).rules.map((r) => r.groups), [["重点"], ["重点 / 北美", "别的"]]);
  assert.equal(s.customers.A.previewGroup, "重点 / 北美");
});

test("客户分组删除：有公海规则在用就拒绝，并说出规则名", () => {
  let s = base();
  s = CS.addGroup(s, { name: "VIP" });
  s = CT.savePoolRule(s, rule({ name: "三个月没联系", groups: ["VIP"] }));
  const id = CS.get(s).groups[0].id;
  assert.throws(() => CS.deleteGroup(s, id), /公海规则“三个月没联系”在用分组“VIP”/);
  const free = CT.deletePoolRule(s, CT.poolRules(s).rules[0].id);
  assert.equal(CS.get(CS.deleteGroup(free, id)).groups.length, 0);
});

test("删除一级分组时，规则里用的是它的子分组也算在用", () => {
  let s = base();
  s = CS.addGroup(s, { name: "VIP" });
  const id = CS.get(s).groups[0].id;
  s = CS.addGroup(s, { name: "美国", parentId: id });
  s = CT.savePoolRule(s, rule({ name: "子级规则", groups: ["VIP / 美国"] }));
  assert.throws(() => CS.deleteGroup(s, id), /子级规则/);
});

// ---------- 4. 判重：导入、批量建档、批量编辑 ----------
const importMapped = (state, headers, rows) => {
  const parsed = { headers, rows, lineNumbers: rows.map((_, i) => i + 2) };
  return CI.applyImport(state, parsed, CI.suggestMapping(headers), {}, "2026-10-16T00:00:00.000Z");
};
const dedupe = (state, patch) => CS.setDedupe(state, { ...CS.get(state).dedupe, ...patch });

test("导入：按判重设置，不允许保存的跳过并写原因，允许保存的照建，不判重的不查", () => {
  const start = base({ customers: { A: { country: "US", source: "s", customerCode: "C-1", website: "a.com", email: "x@a.com" } } });
  const headers = ["公司名称", "客户编号", "公司网址", "邮箱", "国家地区"];
  const rows = [["N1", "C-1", "", "", "US"], ["N2", "", "A.com", "", "US"], ["N3", "", "", "x@a.com", "US"]];
  // 默认：客户编号不允许，网址不判重，邮箱允许
  let r = importMapped(start, headers, rows);
  assert.deepEqual(r.details.map((d) => d.status), ["skipped", "created", "created"]);
  assert.match(r.details[0].reason, /客户编号和已有客户「A」相同/);
  // 网址改成不允许
  r = importMapped(dedupe(start, { website: "block" }), headers, rows);
  assert.deepEqual(r.details.map((d) => d.status), ["skipped", "skipped", "created"]);
  assert.match(r.details[1].reason, /公司网址和已有客户「A」相同/);
  // 邮箱改成不允许，客户编号不判重
  r = importMapped(dedupe(start, { email: "block", customerCode: "off" }), headers, rows);
  assert.deepEqual(r.details.map((d) => d.status), ["created", "created", "skipped"]);
  assert.match(r.details[2].reason, /邮箱和已有客户「A」相同/);
  assert.equal(r.result.skipped, 1);
});

test("导入：同一个文件里前面刚导入的行也算“别的客户”", () => {
  const start = dedupe(base(), { email: "block" });
  const r = importMapped(start, ["公司名称", "邮箱", "国家地区"], [["N1", "e@a.com", "US"], ["N2", "E@a.com", "US"]]);
  assert.deepEqual(r.details.map((d) => d.status), ["created", "skipped"]);
});

test("导入：电话判重也按 6 位数字起算，和别处一致", () => {
  const start = dedupe(base({ customers: { A: { country: "US", phone: "123456" } } }), { phone: "block" });
  const r = importMapped(start, ["公司名称", "联系电话", "国家地区"], [["N1", "123-456", "US"], ["N2", "12345", "US"]]);
  assert.deepEqual(r.details.map((d) => d.status), ["skipped", "created"]);
});

test("导入：更新同一家公司时，匹配联系人的电话也按 6 位数字", () => {
  const start = base({ customers: { Acme: { country: "US", contact: "Amy", phone: "123456", contacts: ["Amy"], phones: ["123456"] } } });
  const parsed = { headers: ["公司名称", "联系人", "联系电话"], rows: [["Acme", "Bob", "123456"]], lineNumbers: [2] };
  const r = CI.applyImport(start, parsed, { name: 0, contact: 1, phone: 2 }, { duplicate: "update" });
  assert.equal(r.result.contactsAdded, undefined, "同一个电话是同一位联系人，不新增");
});

test("批量建档：按判重设置跳过并写原因；允许保存就照建；不判重就不查", () => {
  const text = "N1,x,e@a.com,,US\nN2,y,e@a.com,,US";
  const start = base({ customers: { A: { country: "US", source: "s", email: "e@a.com" } } });
  let r = CT.batchCreate(start, text, { owner: "u", source: "x" });
  assert.deepEqual(r.created, ["N1", "N2"], "邮箱默认允许保存");
  r = CT.batchCreate(dedupe(start, { email: "block" }), text, { owner: "u", source: "x" });
  assert.deepEqual(r.created, []);
  assert.match(r.skipped[0].reason, /邮箱和已有客户「A」相同/);
  r = CT.batchCreate(dedupe(start, { email: "block" }), "N1,x,f@a.com,,US\nN2,y,f@a.com,,US", { owner: "u", source: "x" });
  assert.deepEqual(r.created, ["N1"]);
  assert.match(r.skipped[0].reason, /邮箱和已有客户「N1」相同/, "这一批里前面建的也算");
  r = CT.batchCreate(dedupe(start, { email: "off" }), text, { owner: "u", source: "x" });
  assert.deepEqual(r.created, ["N1", "N2"]);
});

test("批量编辑：公司网址设为不允许重复时，改成和别人相同会被拒绝", () => {
  const start = dedupe(base({ customers: { A: { country: "US", source: "s", website: "a.com" }, B: { country: "US", source: "s" }, C: { country: "US", source: "s" } } }), { website: "block" });
  assert.throws(() => M.batchEditCustomerField(start, ["B"], "website", "A.com"), /「B」公司网址和已有客户「A」相同/);
  assert.throws(() => M.batchEditCustomerField(start, ["B", "C"], "website", "new.com"), /「C」公司网址和已有客户「B」相同/, "同一批里两位客户改成同一个网址也不行");
  assert.equal(M.batchEditCustomerField(start, ["B"], "website", "b.com").customers.B.website, "b.com");
  assert.equal(M.batchEditCustomerField(start, ["A"], "website", "", true).customers.A.website, "", "清空不受限制");
  const allowed = dedupe(start, { website: "allow" });
  assert.equal(M.batchEditCustomerField(allowed, ["B"], "website", "a.com").customers.B.website, "a.com");
});

// ---------- 5. 查重页、领回时间 ----------
test("客户查重页：邮箱 / 电话选了“不判重”就不再按它们找", () => {
  const s = base({ customers: {
    A: { country: "US", email: "x@a.com", phone: "123456789" },
    B: { country: "US", email: "X@a.com", phone: "123456789" },
  } });
  const types = (dedupeSetting) => LM.findDuplicates(s, dedupeSetting).map((d) => d.type).sort();
  assert.deepEqual(types(undefined), ["电话", "邮箱"], "没传设置的调用方照旧");
  assert.deepEqual(types(CS.get(s).dedupe), ["电话", "邮箱"]);
  assert.deepEqual(types({ ...CS.get(s).dedupe, email: "off" }), ["电话"]);
  assert.deepEqual(types({ ...CS.get(s).dedupe, email: "off", phone: "off" }), []);
});

test("公海：刚领回的客户，即使“最近联系”里没勾“从公海领回”也不会马上又被移走", () => {
  let s = base({ customers: { A: { country: "US", createdAt: ago(300), laiBucket: "pool", laiPreviousOwner: "u", lastPoolEntry: ago(1) } } });
  s = CT.savePoolRule(s, rule({ days: 30 }));
  s = CS.setFollowRules(s, { contact: ["followup", "mailSent", "mailReceived", "chatSent", "chatReceived", "order", "opportunity"] });
  const claimed = LM.moveCustomers(s, ["A"], "active", NOW.toISOString(), { owner: "u" });
  assert.deepEqual(candidates(claimed), []);
  const later = CT.poolCandidates(claimed, CT.poolRules(claimed), new Date(NOW.getTime() + 31 * 86400000)).map((c) => c.name);
  assert.deepEqual(later, ["A"], "过了 30 天没联系照常移入");
});

// ---------- 6. 回收站恢复也算客户上限 ----------
test("从回收站恢复：跟进人名下已满就不能恢复", () => {
  let s = base({ customers: {
    D: { country: "US", owner: "Bob" },
    T: { country: "US", owner: "Bob", laiBucket: "trash", laiPreviousBucket: "active" },
    P: { country: "US", owner: "Bob", laiBucket: "trash", laiPreviousBucket: "pool" },
  } });
  s = CS.setCaps(s, { defaultLimit: 1 });
  assert.throws(() => LM.moveCustomers(s, ["T"], "restore"), /上限是 1/);
  assert.equal(LM.moveCustomers(s, ["P"], "restore").customers.P.laiBucket, "pool", "恢复到公海不占名额");
  s = CS.setCaps(s, { defaultLimit: 2 });
  assert.equal(LM.moveCustomers(s, ["T"], "restore").customers.T.laiBucket, "active");
});

// ---------- 7. 改名同步客群条件、重名 ----------
test("改名：已保存的客群条件里的阶段、分组、来源跟着改", () => {
  let s = base({
    customers: { A: { country: "US", source: "展会 / 德国", customerStage: "未成单", previewGroup: "VIP / 美国", owner: "u" } },
    previewSegments: [
      { id: "r1", name: "阶段客群", kind: "rules", match: "all", rules: [{ field: "stage", op: "eq", value: "未成单" }] },
      { id: "r2", name: "分组客群", kind: "rules", match: "all", rules: [{ field: "group", op: "eq", value: "VIP / 美国" }] },
      { id: "r3", name: "来源客群", kind: "rules", match: "all", rules: [{ field: "source", op: "contains", value: "展会" }] },
      { id: "r4", name: "别的字段", kind: "rules", match: "all", rules: [{ field: "country", op: "eq", value: "VIP / 美国" }] },
    ],
  });
  const members = (state, id) => S.resolveMembers(S.enrich(M.buildCustomers(state), state), state.previewSegments.find((x) => x.id === id)).map((r) => r.name);
  assert.deepEqual(members(s, "r1"), ["A"]);
  s = CS.renameStage(s, "未成单", "待跟进");
  assert.deepEqual(s.previewSegments[0].rules[0].value, "待跟进");
  assert.deepEqual(members(s, "r1"), ["A"], "改名后客群成员不变");
  s = CS.addGroup(s, { name: "VIP" });
  const vip = CS.get(s).groups[0];
  s = CS.addGroup(s, { name: "美国", parentId: vip.id });
  s = CS.editGroup(s, vip.id, { name: "重点" });
  assert.equal(s.previewSegments[1].rules[0].value, "重点 / 美国");
  assert.equal(s.previewSegments[3].rules[0].value, "VIP / 美国", "别的字段的值不动");
  assert.deepEqual(members(s, "r2"), ["A"]);
  s = CS.addSource(s, { name: "展会" });
  const src = CS.get(s).sources[0];
  s = CS.renameSource(s, src.id, "线下展会");
  assert.equal(s.previewSegments[2].rules[0].value, "线下展会", "“包含”条件里写的就是来源名，也跟着改");
});

test("手动客群和客户分组不能重名（两个方向）", () => {
  let s = base({ customers: { A: { country: "US", source: "s", owner: "u" } } });
  s = CS.addGroup(s, { name: "VIP" });
  assert.throws(() => S.upsertSegment(s, "m1", { name: "vip", kind: "manual", members: [] }), /已有同名的客户分组/);
  const ok = S.upsertSegment(s, "m1", { name: "手动一", kind: "manual", members: [] });
  assert.throws(() => CS.addGroup(ok, { name: "手动一" }), /已有同名的手动客群/);
  const other = CS.addGroup(ok, { name: "别的" });
  assert.throws(() => CS.editGroup(other, CS.get(other).groups[1].id, { name: "手动一" }), /已有同名的手动客群/);
  const rules = S.upsertSegment(s, "r1", { name: "VIP", kind: "rules", match: "all", rules: [{ field: "country", op: "eq", value: "US" }] });
  assert.equal(rules.previewSegments.length, 1, "条件客群可以和分组同名（它不进分组下拉）");
});

// ---------- 8. 小问题 ----------
test("建档黑名单：一个格子里有好几个邮箱，每个都检查", () => {
  let s = base();
  s = CS.addBlacklist(s, "bad@x.com");
  s = CS.addBlacklist(s, "@evil.com");
  assert.equal(CS.blacklistHit(s, "ok@y.com;bad@x.com"), "bad@x.com");
  assert.equal(CS.blacklistHit(s, "ok@y.com, a@evil.com"), "@evil.com");
  assert.equal(CS.blacklistHit(s, "Name <BAD@x.com>"), "bad@x.com");
  assert.equal(CS.blacklistHit(s, "ok@y.com ok2@y.com"), "");
  const r = importMapped(s, ["公司名称", "邮箱", "国家地区"], [["N1", "ok@y.com;bad@x.com", "US"], ["N2", "ok@y.com bad@x.com", "US"], ["N3", "fine@y.com", "US"]]);
  assert.deepEqual(r.details.map((d) => d.status), ["skipped", "skipped", "created"]);
  assert.equal(r.details[0].reason, "邮箱在建档黑名单里");
  assert.throws(() => CS.assertEmailsAllowed(s, ["ok@y.com;bad@x.com"]), /bad@x.com/);
  assert.doesNotThrow(() => CS.assertEmailsAllowed(s, ["ok@y.com;bad@x.com"], ["bad@x.com"]), "客户原来就有的不算");
});

test("客户上限：给某位跟进人单独定的上限，名字大小写不同也认", () => {
  let s = base({ customers: { A: { country: "US", owner: "Amy" }, B: { country: "US", owner: "amy" } } });
  s = CS.setCaps(s, { defaultLimit: 5, perOwner: { amy: 2 } });
  assert.equal(CS.limitFor(s, "Amy"), 2);
  assert.equal(CS.limitFor(s, "AMY"), 2);
  assert.equal(CS.limitFor(s, "Bob"), 5);
  assert.throws(() => CS.assertCanTake(s, "Amy", 1), /上限是 2/);
  assert.equal(CS.capRows(s, ["Amy"])[0].limit, 2);
});

test("公海：白名单和“不移走的标签”不分大小写", () => {
  let s = base({ customers: { A: { country: "US", owner: "Amy", createdAt: ago(300), tags: ["VIP"] } } });
  s = CT.savePoolRule(s, rule({ days: 30 }));
  assert.deepEqual(candidates(s), ["A"]);
  assert.deepEqual(candidates(CT.setPoolRules(s, { ...CT.poolRules(s), whitelist: ["amy"] })), []);
  assert.deepEqual(candidates(CT.setPoolRules(s, { ...CT.poolRules(s), skipTags: "vip" })), []);
});

test("保存设置时，本版本不认识的设置项原样保留", () => {
  let s = base();
  s = { ...s, laiSettings: { customerSettings: { futureThing: { a: 1 }, stages: ["甲", "乙"] } } };
  const next = CS.addStage(s, "丙");
  assert.deepEqual(next.laiSettings.customerSettings.futureThing, { a: 1 });
  assert.deepEqual(next.laiSettings.customerSettings.stages, ["甲", "乙", "丙"]);
  assert.deepEqual(CS.get(next).stages, ["甲", "乙", "丙"]);
});
