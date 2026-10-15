(function (root) {
"use strict";
// 客户设置：客户分组、客户阶段、客户类型、建档黑名单、客户上限、查重展示字段、详情布局。
// 全是纯函数：输入 state，返回新的 state（或检查结果），不碰界面，也不自己保存。
// 设置存在 state.laiSettings.customerSettings 里；公海规则仍在 state.laiSettings.poolRules（见 customer-tools.js）。

const trim = (v) => String(v ?? "").trim();
const norm = (v) => trim(v).toLowerCase();
const SEP = " / ";

const DEFAULT_STAGES = Object.freeze(["未成单", "付款未到账", "待付尾款.", "已完成", "输单"]);
const DEFAULT_TYPES = Object.freeze([
  "生产商", "原材料供应商", "渠道商", "加盟商", "贸易商", "代理商", "批发商",
  "分销商", "代销商", "零售商", "采购办事处", "采购咨询公司", "出口商", "进口商",
]);
// 查重页每位客户后面可以多显示的资料。country 是原来就有的。
const DUPLICATE_FIELDS = Object.freeze([
  ["customerCode", "客户编号"], ["source", "来源"], ["country", "国家地区"], ["owner", "跟进人"],
  ["createdAt", "创建时间"], ["contact", "联系人"], ["customerStage", "客户阶段"], ["customerType", "客户类型"],
]);
// 判重设置：新建或修改客户时，哪些资料不能和别的客户相同。三种选择：allow 判重但允许保存，block 判重且不允许保存，off 不判重。
const DEDUPE_FIELDS = Object.freeze([
  ["customerCode", "客户编号"], ["email", "邮箱"], ["phone", "联系电话"], ["landline", "座机"],
  ["socialAccount", "社交账号"], ["website", "公司网址"], ["shortName", "简称"], ["companyAddress", "详细地址"], ["alibabaId", "Alibaba会员ID"],
]);
const DEDUPE_MODES = Object.freeze(["allow", "block", "off"]);
const DEFAULT_DEDUPE = Object.freeze({ customerCode: "block", email: "allow", phone: "allow", landline: "off", socialAccount: "off", website: "off", shortName: "off", companyAddress: "off", alibabaId: "off" });
const LIMITS = Object.freeze({ sources: 100, sourceChildren: 30, stages: 30, types: 50, groups: 100, children: 30, blacklist: 500, name: 20, cap: 100000 });

// 哪些动作算“最近联系 / 最近跟进”。
const FOLLOW_ACTIONS = Object.freeze([
  ["followup", "写跟进"], ["mailSent", "发出邮件"], ["mailReceived", "收到邮件"], ["chat", "聊天或电话记录"],
  ["order", "新建或修改订单"], ["opportunity", "新建或修改商机"], ["claim", "从公海领回"],
].map((item) => Object.freeze(item)));
const FOLLOW_KEYS = FOLLOW_ACTIONS.map(([key]) => key);
const DEFAULT_FOLLOW_RULES = Object.freeze({ contact: FOLLOW_KEYS, followup: Object.freeze(["followup", "mailSent", "chat"]) });
const TEMPLATE_LIMITS = Object.freeze({ groups: 30, items: 100, name: 20, text: 500 });

const DEFAULTS = Object.freeze({
  groups: [],
  stages: DEFAULT_STAGES,
  types: DEFAULT_TYPES,
  blacklist: [],
  caps: { defaultLimit: 0, perOwner: {} },
  duplicateFields: ["country"],
  dedupe: DEFAULT_DEDUPE,
  sources: [],
  layout: "left-small",
  followRules: DEFAULT_FOLLOW_RULES,
  dealRule: { by: "order" },
  activity: { autoMail: false, since: "" },
  followup: { allowPastTime: false, templates: [] },
});

const profiles = (state) => (state && state.customers && typeof state.customers === "object" ? state.customers : {});
const bucketOf = (p) => (["pool", "trash"].includes(p && p.laiBucket) ? p.laiBucket : "active");

function cleanName(value, label) {
  const name = trim(value).replace(/\s+/g, " ");
  if (!name) throw new Error(`请填写${label}`);
  if (name.length > LIMITS.name) throw new Error(`${label}最长 ${LIMITS.name} 个字`);
  if (name.includes("/")) throw new Error(`${label}里不能有“/”`);
  return name;
}
const uniqueNames = (list) => {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = trim(item);
    const key = norm(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};
let counter = 0;
const newId = () => `g${Date.now().toString(36)}${(counter++).toString(36)}`;

function normalizeGroups(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const name = trim(raw && raw.name);
    if (!name || name.includes("/") || seen.has(norm(name)) || out.length >= LIMITS.groups) continue;
    seen.add(norm(name));
    const childSeen = new Set();
    const children = [];
    for (const child of Array.isArray(raw.children) ? raw.children : []) {
      const childName = trim(child && child.name);
      if (!childName || childName.includes("/") || childSeen.has(norm(childName)) || children.length >= LIMITS.children) continue;
      childSeen.add(norm(childName));
      children.push({ id: trim(child.id) || newId(), name: childName });
    }
    out.push({
      id: trim(raw.id) || newId(),
      name,
      children,
      childRequired: children.length > 0 && raw.childRequired === true,
      members: raw.members === "all" || !Array.isArray(raw.members) ? "all" : uniqueNames(raw.members),
    });
  }
  return out;
}
function normalizeSources(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const name = trim(raw && raw.name);
    if (!name || name.includes("/") || seen.has(norm(name)) || out.length >= LIMITS.sources) continue;
    seen.add(norm(name));
    const childSeen = new Set();
    const children = [];
    for (const child of Array.isArray(raw.children) ? raw.children : []) {
      const childName = trim(child && child.name);
      if (!childName || childName.includes("/") || childSeen.has(norm(childName)) || children.length >= LIMITS.sourceChildren) continue;
      childSeen.add(norm(childName));
      children.push({ id: trim(child.id) || newId(), name: childName, hidden: child.hidden === true });
    }
    out.push({ id: trim(raw.id) || newId(), name, hidden: raw.hidden === true, children });
  }
  return out;
}
const limitNumber = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= LIMITS.cap ? n : null;
};
function normalizeCaps(raw) {
  const caps = raw && typeof raw === "object" ? raw : {};
  const perOwner = {};
  for (const [owner, value] of Object.entries(caps.perOwner && typeof caps.perOwner === "object" ? caps.perOwner : {})) {
    const n = limitNumber(value);
    if (trim(owner) && n !== null) perOwner[trim(owner)] = n;
  }
  return { defaultLimit: limitNumber(caps.defaultLimit) ?? 0, perOwner };
}
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const DOMAIN_RE = /^@[^\s@,;]+\.[^\s@,;]+$/;
function blacklistEntry(value) {
  const entry = norm(value);
  if (!entry) throw new Error("请填写邮箱");
  if (!EMAIL_RE.test(entry) && !DOMAIN_RE.test(entry)) throw new Error("请填写完整邮箱，或以 @ 开头的整个域名，如 @example.com");
  return entry;
}
function normalizeBlacklist(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    try {
      const entry = blacklistEntry(raw);
      if (!out.includes(entry) && out.length < LIMITS.blacklist) out.push(entry);
    } catch (_) { /* 坏条目丢掉 */ }
  }
  return out;
}

function normalizeFollowList(list, fallback) {
  const out = Array.isArray(list) ? FOLLOW_KEYS.filter((key) => list.includes(key)) : [];
  return out.length ? out : fallback.slice();
}
function normalizeTemplates(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const name = trim(raw && raw.name).replace(/\s+/g, " ");
    if (!name || name.length > TEMPLATE_LIMITS.name || name.includes("/") || seen.has(norm(name)) || out.length >= TEMPLATE_LIMITS.groups) continue;
    seen.add(norm(name));
    const items = [];
    for (const item of Array.isArray(raw.items) ? raw.items : []) {
      const text = trim(item && item.text);
      if (!text || text.length > TEMPLATE_LIMITS.text || items.length >= TEMPLATE_LIMITS.items) continue;
      items.push({ id: trim(item.id) || newId(), text });
    }
    out.push({ id: trim(raw.id) || newId(), name, items });
  }
  return out;
}
const validTime = (v) => { const t = new Date(String(v ?? "").trim().replace(" ", "T")).getTime(); return Number.isFinite(t) && trim(v) ? t : NaN; };
function normalizeActivity(raw) {
  const autoMail = !!(raw && raw.autoMail === true);
  const since = autoMail && Number.isFinite(validTime(raw.since)) ? trim(raw.since) : "";
  return { autoMail, since };
}

// 读取：缺什么补什么，永远返回完整的设置。
// 结果按“设置对象”缓存：状态都是不可变的（每次修改都会产生新对象），所以同一个对象永远得到同一个结果。
// 调用方不要改返回值；要改就复制后再 put。
const settingsCache = new WeakMap();
const MISSING_SETTINGS = {};
function get(state) {
  const stored = state && state.laiSettings && state.laiSettings.customerSettings;
  const key = stored && typeof stored === "object" ? stored : MISSING_SETTINGS;
  let hit = settingsCache.get(key);
  if (!hit) { hit = readSettings(key === MISSING_SETTINGS ? {} : key); settingsCache.set(key, hit); }
  return hit;
}
function readSettings(raw) {
  const stages = uniqueNames(Array.isArray(raw.stages) ? raw.stages : DEFAULT_STAGES).slice(0, LIMITS.stages);
  const types = uniqueNames(Array.isArray(raw.types) ? raw.types : DEFAULT_TYPES).slice(0, LIMITS.types);
  const allowed = new Set(DUPLICATE_FIELDS.map(([key]) => key));
  const duplicateFields = Array.isArray(raw.duplicateFields)
    ? DUPLICATE_FIELDS.map(([key]) => key).filter((key) => raw.duplicateFields.includes(key))
    : DEFAULTS.duplicateFields.filter((key) => allowed.has(key));
  return {
    groups: normalizeGroups(raw.groups),
    stages,
    types,
    blacklist: normalizeBlacklist(raw.blacklist),
    caps: normalizeCaps(raw.caps),
    duplicateFields,
    sources: normalizeSources(raw.sources),
    dedupe: Object.fromEntries(DEDUPE_FIELDS.map(([key]) => [key, raw.dedupe && DEDUPE_MODES.includes(raw.dedupe[key]) ? raw.dedupe[key] : DEFAULT_DEDUPE[key]])),
    layout: raw.layout === "left-large" ? "left-large" : "left-small",
    followRules: {
      contact: normalizeFollowList(raw.followRules && raw.followRules.contact, DEFAULT_FOLLOW_RULES.contact),
      followup: normalizeFollowList(raw.followRules && raw.followRules.followup, DEFAULT_FOLLOW_RULES.followup),
    },
    dealRule: { by: raw.dealRule && raw.dealRule.by === "opportunity" ? "opportunity" : "order" },
    activity: normalizeActivity(raw.activity),
    followup: {
      allowPastTime: !!(raw.followup && raw.followup.allowPastTime === true),
      templates: normalizeTemplates(raw.followup && raw.followup.templates),
    },
  };
}
function put(state, patch) {
  const next = { ...get(state), ...patch };
  return { ...state, laiSettings: { ...(state.laiSettings || {}), customerSettings: next } };
}
const mapCustomers = (state, fn) => {
  const customers = {};
  let changed = false;
  for (const [name, profile] of Object.entries(profiles(state))) {
    const after = fn(profile, name);
    if (after !== profile) changed = true;
    customers[name] = after;
  }
  return changed ? { ...state, customers } : state;
};
const countBy = (state, test) => Object.values(profiles(state)).filter((p) => bucketOf(p) !== "trash" && test(p)).length;
const pushHistory = (profile, text, at) => ({ ...profile, history: [{ time: at, text, type: "operation" }, ...(Array.isArray(profile.history) ? profile.history : [])] });

// ============ 客户阶段 ============
function stageUse(state, stage) { return countBy(state, (p) => trim(p.customerStage) === stage); }
function addStage(state, name) {
  const value = cleanName(name, "阶段名称");
  const list = get(state).stages;
  if (list.some((s) => norm(s) === norm(value))) throw new Error("已有同名阶段");
  if (list.length >= LIMITS.stages) throw new Error(`阶段最多 ${LIMITS.stages} 个`);
  return put(state, { stages: [...list, value] });
}
function renameStage(state, oldName, newName, at = new Date().toISOString()) {
  const value = cleanName(newName, "阶段名称");
  const list = get(state).stages;
  if (!list.includes(oldName)) throw new Error("没有找到这个阶段");
  if (value !== oldName && list.some((s) => norm(s) === norm(value))) throw new Error("已有同名阶段");
  const next = put(state, { stages: list.map((s) => (s === oldName ? value : s)) });
  if (value === oldName) return next;
  return mapCustomers(next, (p) => (trim(p.customerStage) === oldName ? pushHistory({ ...p, customerStage: value }, `客户阶段改名：${oldName} → ${value}`, at) : p));
}
function deleteStage(state, name) {
  const list = get(state).stages;
  if (!list.includes(name)) throw new Error("没有找到这个阶段");
  const used = stageUse(state, name);
  if (used) throw new Error(`还有 ${used} 位客户在用“${name}”，先把他们改到别的阶段，或把这个阶段改名`);
  return put(state, { stages: list.filter((s) => s !== name) });
}
function moveItem(state, key, name, delta) {
  if (!["stages", "types"].includes(key)) throw new Error("无法排序");
  const list = get(state)[key].slice();
  const at = list.indexOf(name);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= list.length) return state;
  [list[at], list[to]] = [list[to], list[at]];
  return put(state, { [key]: list });
}

// ============ 客户类型 ============
function typeUse(state, type) { return countBy(state, (p) => trim(p.customerType) === type); }
function addType(state, name) {
  const value = cleanName(name, "类型名称");
  const list = get(state).types;
  if (list.some((s) => norm(s) === norm(value))) throw new Error("已有同名类型");
  if (list.length >= LIMITS.types) throw new Error(`类型最多 ${LIMITS.types} 个`);
  return put(state, { types: [...list, value] });
}
function renameType(state, oldName, newName, at = new Date().toISOString()) {
  const value = cleanName(newName, "类型名称");
  const list = get(state).types;
  if (!list.includes(oldName)) throw new Error("没有找到这个类型");
  if (value !== oldName && list.some((s) => norm(s) === norm(value))) throw new Error("已有同名类型");
  const next = put(state, { types: list.map((s) => (s === oldName ? value : s)) });
  if (value === oldName) return next;
  return mapCustomers(next, (p) => (trim(p.customerType) === oldName ? pushHistory({ ...p, customerType: value }, `客户类型改名：${oldName} → ${value}`, at) : p));
}
function deleteType(state, name) {
  const list = get(state).types;
  if (!list.includes(name)) throw new Error("没有找到这个类型");
  const used = typeUse(state, name);
  if (used) throw new Error(`还有 ${used} 位客户在用“${name}”，先改客户，或把这个类型改名`);
  return put(state, { types: list.filter((s) => s !== name) });
}

// ============ 客户分组（最多两级） ============
const pathOf = (parent, child) => (child ? `${parent}${SEP}${child}` : parent);
const groupPaths = (groups) => groups.flatMap((g) => [g.name, ...g.children.map((c) => pathOf(g.name, c.name))]);
function groupUse(state, path) {
  return countBy(state, (p) => {
    const value = trim(p.previewGroup);
    return value === path || value.startsWith(path + SEP);
  });
}
function addGroup(state, { name, parentId = "", members = "all" } = {}) {
  const value = cleanName(name, "分组名称");
  const groups = get(state).groups.map((g) => ({ ...g, children: g.children.slice() }));
  if (parentId) {
    const parent = groups.find((g) => g.id === parentId);
    if (!parent) throw new Error("没有找到上级分组");
    if (parent.children.some((c) => norm(c.name) === norm(value))) throw new Error("同一个上级下已有同名分组");
    if (parent.children.length >= LIMITS.children) throw new Error(`一个分组下最多 ${LIMITS.children} 个子分组`);
    parent.children.push({ id: newId(), name: value });
  } else {
    if (groups.some((g) => norm(g.name) === norm(value))) throw new Error("已有同名分组");
    if (groups.length >= LIMITS.groups) throw new Error(`一级分组最多 ${LIMITS.groups} 个`);
    groups.push({ id: newId(), name: value, children: [], childRequired: false, members: members === "all" || !Array.isArray(members) ? "all" : uniqueNames(members) });
  }
  return put(state, { groups });
}
function findGroup(groups, id) {
  for (const g of groups) {
    if (g.id === id) return { top: g, child: null };
    const child = g.children.find((c) => c.id === id);
    if (child) return { top: g, child };
  }
  return null;
}
function editGroup(state, id, { name, members, childRequired } = {}, at = new Date().toISOString()) {
  const groups = get(state).groups.map((g) => ({ ...g, children: g.children.map((c) => ({ ...c })) }));
  const hit = findGroup(groups, id);
  if (!hit) throw new Error("没有找到这个分组");
  let next = state;
  if (hit.child) {
    const value = name === undefined ? hit.child.name : cleanName(name, "分组名称");
    if (value !== hit.child.name && hit.top.children.some((c) => c.id !== id && norm(c.name) === norm(value))) throw new Error("同一个上级下已有同名分组");
    const from = pathOf(hit.top.name, hit.child.name);
    hit.child.name = value;
    next = put(state, { groups });
    const to = pathOf(hit.top.name, value);
    if (from !== to) {
      next = mapCustomers(next, (p) => (trim(p.previewGroup) === from ? pushHistory({ ...p, previewGroup: to }, `客户分组改名：${from} → ${to}`, at) : p));
    }
    return next;
  }
  const oldName = hit.top.name;
  const value = name === undefined ? oldName : cleanName(name, "分组名称");
  if (value !== oldName && groups.some((g) => g.id !== id && norm(g.name) === norm(value))) throw new Error("已有同名分组");
  hit.top.name = value;
  if (members !== undefined) hit.top.members = members === "all" || !Array.isArray(members) ? "all" : uniqueNames(members);
  if (childRequired !== undefined) hit.top.childRequired = hit.top.children.length > 0 && childRequired === true;
  next = put(state, { groups });
  if (value !== oldName) {
    next = mapCustomers(next, (p) => {
      const current = trim(p.previewGroup);
      if (current === oldName) return pushHistory({ ...p, previewGroup: value }, `客户分组改名：${oldName} → ${value}`, at);
      if (current.startsWith(oldName + SEP)) return pushHistory({ ...p, previewGroup: value + current.slice(oldName.length) }, `客户分组改名：${oldName} → ${value}`, at);
      return p;
    });
  }
  return next;
}
function deleteGroup(state, id) {
  const groups = get(state).groups.map((g) => ({ ...g, children: g.children.slice() }));
  const hit = findGroup(groups, id);
  if (!hit) throw new Error("没有找到这个分组");
  const path = hit.child ? pathOf(hit.top.name, hit.child.name) : hit.top.name;
  const used = groupUse(state, path);
  if (used) throw new Error(`还有 ${used} 位客户在“${path}”里，先把他们移到别的分组`);
  if (hit.child) {
    hit.top.children = hit.top.children.filter((c) => c.id !== id);
    if (!hit.top.children.length) hit.top.childRequired = false;
    return put(state, { groups });
  }
  return put(state, { groups: groups.filter((g) => g.id !== id) });
}
// 编辑客户时可选的分组：一级、二级；限定成员的分组只给这些跟进人用。已选的值总是保留。
function groupChoices(state, owner = "", current = "") {
  const out = [];
  for (const g of get(state).groups) {
    if (g.members !== "all" && owner && !g.members.includes(owner) && trim(current) !== g.name && !trim(current).startsWith(g.name + SEP)) continue;
    out.push({ value: g.name, label: g.name, depth: 0 });
    for (const c of g.children) out.push({ value: pathOf(g.name, c.name), label: c.name, depth: 1 });
  }
  const now = trim(current);
  if (now && !out.some((item) => item.value === now)) out.push({ value: now, label: now, depth: 0, legacy: true });
  return out;
}
// 保存前检查：值必须是设置里有的分组；有子分组且要求必选时，不能只选一级。
function checkGroup(state, value, owner = "", previous = "") {
  const path = trim(value);
  if (!path || path === trim(previous)) return;
  const groups = get(state).groups;
  const [top, child] = path.split(SEP);
  const g = groups.find((item) => item.name === top);
  if (!g) return; // 手动客群的名字由客群管理那边检查
  if (child !== undefined && !g.children.some((c) => c.name === child)) throw new Error(`“${path}”不是现有的分组`);
  if (g.members !== "all" && owner && !g.members.includes(owner)) throw new Error(`分组“${g.name}”只对指定的跟进人开放`);
  if (child === undefined && g.children.length && g.childRequired) throw new Error(`分组“${g.name}”要求选到子分组`);
}
const isConfiguredGroup = (state, value) => {
  const path = trim(value);
  return !!path && groupPaths(get(state).groups).includes(path);
};

// ============ 建档黑名单 ============
function addBlacklist(state, value) {
  const entry = blacklistEntry(value);
  const list = get(state).blacklist;
  if (list.includes(entry)) throw new Error("已在黑名单里");
  if (list.length >= LIMITS.blacklist) throw new Error(`黑名单最多 ${LIMITS.blacklist} 条`);
  return put(state, { blacklist: [...list, entry] });
}
function removeBlacklist(state, value) {
  return put(state, { blacklist: get(state).blacklist.filter((entry) => entry !== norm(value)) });
}
function blacklistHit(state, email) {
  const value = norm(email);
  if (!EMAIL_RE.test(value)) return "";
  const list = get(state).blacklist;
  if (!list.length) return "";
  const domain = value.slice(value.indexOf("@"));
  return list.find((entry) => entry === value || entry === domain) || "";
}
// 只拦“新增的”邮箱：已有客户本来就有的邮箱，后来才进黑名单，不影响他继续编辑。
function assertEmailsAllowed(state, emails, existing = []) {
  const had = new Set((existing || []).map(norm));
  for (const email of emails || []) {
    const value = norm(email);
    if (!value || had.has(value)) continue;
    const hit = blacklistHit(state, value);
    if (hit) throw new Error(`邮箱“${trim(email)}”在建档黑名单里（${hit}），不能新建或加到客户上`);
  }
}

// ============ 客户上限 ============
const ownerOf = (p) => trim(p && p.owner);
function limitFor(state, owner) {
  const who = trim(owner);
  if (!who) return 0;
  const caps = get(state).caps;
  return Object.hasOwn(caps.perOwner, who) ? caps.perOwner[who] : caps.defaultLimit;
}
function ownerCount(state, owner, exclude = []) {
  const who = trim(owner);
  const skip = new Set(exclude);
  return Object.entries(profiles(state)).filter(([name, p]) => !skip.has(name) && bucketOf(p) === "active" && ownerOf(p) === who).length;
}
// adding：要新增给这位跟进人的客户数。0 表示不限。
function assertCanTake(state, owner, adding = 1, exclude = []) {
  const who = trim(owner);
  const limit = limitFor(state, who);
  if (!who || !limit || adding <= 0) return;
  const count = ownerCount(state, who, exclude);
  if (count + adding > limit) throw new Error(`“${who}”名下已有 ${count} 位客户，上限是 ${limit}，不能再增加 ${adding} 位`);
}
function capRows(state, owners) {
  const caps = get(state).caps;
  return uniqueNames(owners).map((owner) => ({ owner, count: ownerCount(state, owner), limit: Object.hasOwn(caps.perOwner, owner) ? caps.perOwner[owner] : null, effective: limitFor(state, owner) }));
}
function setCaps(state, { defaultLimit, perOwner } = {}) {
  const current = get(state).caps;
  const next = { defaultLimit: current.defaultLimit, perOwner: { ...current.perOwner } };
  if (defaultLimit !== undefined) {
    const n = limitNumber(defaultLimit);
    if (n === null) throw new Error(`默认上限请填 0–${LIMITS.cap} 之间的整数（0 表示不限）`);
    next.defaultLimit = n;
  }
  for (const [owner, value] of Object.entries(perOwner || {})) {
    const who = trim(owner);
    if (!who) continue;
    if (value === null || value === "" || value === undefined) { delete next.perOwner[who]; continue; }
    const n = limitNumber(value);
    if (n === null) throw new Error(`“${who}”的上限请填 0–${LIMITS.cap} 之间的整数（0 表示不限）`);
    next.perOwner[who] = n;
  }
  return put(state, { caps: next });
}

// ============ 来源设置 ============
// 线索来源、客户来源、商机来源共用一份名单：最多两级，可以隐藏、排序。子来源写成“上级 / 子级”。
function sourcePath(parent, child) { return child ? `${parent.name}${SEP}${child.name}` : parent.name; }
function sourceChoices(state) {
  const list = get(state).sources;
  if (!list.length) return null;
  const out = [];
  for (const top of list) {
    if (top.hidden) continue;
    const kids = top.children.filter((c) => !c.hidden);
    if (!kids.length) out.push(top.name);
    for (const c of kids) out.push(sourcePath(top, c));
  }
  return out;
}
const copySources = (state) => get(state).sources.map((t) => ({ ...t, children: t.children.map((c) => ({ ...c })) }));
function findSource(list, id) {
  for (const top of list) {
    if (top.id === id) return { top, child: null };
    const child = top.children.find((c) => c.id === id);
    if (child) return { top, child };
  }
  return null;
}
function sourceUse(state, path) {
  return countBy(state, (p) => { const v = trim(p.source); return v === path || v.startsWith(path + SEP); });
}
function addSource(state, { name, parentId = "" } = {}) {
  const value = cleanName(name, "来源名称");
  const list = copySources(state);
  if (parentId) {
    const parent = list.find((t) => t.id === parentId);
    if (!parent) throw new Error("没有找到上级来源");
    if (parent.children.some((c) => norm(c.name) === norm(value))) throw new Error("同一个上级下已有同名来源");
    if (parent.children.length >= LIMITS.sourceChildren) throw new Error(`一个来源下最多 ${LIMITS.sourceChildren} 个子来源`);
    parent.children.push({ id: newId(), name: value, hidden: false });
  } else {
    if (list.some((t) => norm(t.name) === norm(value))) throw new Error("已有同名来源");
    if (list.length >= LIMITS.sources) throw new Error(`一级来源最多 ${LIMITS.sources} 个`);
    list.push({ id: newId(), name: value, hidden: false, children: [] });
  }
  return put(state, { sources: list });
}
function renameSource(state, id, name, at = new Date().toISOString()) {
  const value = cleanName(name, "来源名称");
  const list = copySources(state);
  const hit = findSource(list, id);
  if (!hit) throw new Error("没有找到这个来源");
  const siblings = hit.child ? hit.top.children.filter((c) => c.id !== id) : list.filter((t) => t.id !== id);
  if (siblings.some((x) => norm(x.name) === norm(value))) throw new Error(hit.child ? "同一个上级下已有同名来源" : "已有同名来源");
  const from = hit.child ? sourcePath(hit.top, hit.child) : hit.top.name;
  (hit.child || hit.top).name = value;
  const to = hit.child ? sourcePath(hit.top, hit.child) : hit.top.name;
  let next = put(state, { sources: list });
  if (from !== to) {
    const swap = (v) => (trim(v) === from ? to : trim(v).startsWith(from + SEP) ? to + trim(v).slice(from.length) : null);
    next = mapCustomers(next, (p) => { const v = swap(p.source); return v === null ? p : pushHistory({ ...p, source: v }, `客户来源改名：${from} → ${to}`, at); });
  }
  return next;
}
function setSourceHidden(state, id, hidden) {
  const list = copySources(state);
  const hit = findSource(list, id);
  if (!hit) throw new Error("没有找到这个来源");
  (hit.child || hit.top).hidden = !!hidden;
  return put(state, { sources: list });
}
function moveSource(state, id, delta) {
  const list = copySources(state);
  const hit = findSource(list, id);
  if (!hit) throw new Error("没有找到这个来源");
  const arr = hit.child ? hit.top.children : list;
  const from = arr.findIndex((x) => x.id === id);
  const to = from + (delta < 0 ? -1 : 1);
  if (to < 0 || to >= arr.length) return state;
  [arr[from], arr[to]] = [arr[to], arr[from]];
  return put(state, { sources: list });
}
function deleteSource(state, id) {
  const list = copySources(state);
  const hit = findSource(list, id);
  if (!hit) throw new Error("没有找到这个来源");
  const path = hit.child ? sourcePath(hit.top, hit.child) : hit.top.name;
  const used = sourceUse(state, path);
  if (used) throw new Error(`还有 ${used} 位客户的来源是“${path}”，先改掉他们的来源，或者把它隐藏`);
  if (hit.child) hit.top.children = hit.top.children.filter((c) => c.id !== id);
  return put(state, { sources: hit.child ? list : list.filter((t) => t.id !== id) });
}

// ============ 查重展示、详情布局 ============
function setDuplicateFields(state, keys) {
  const valid = DUPLICATE_FIELDS.map(([key]) => key);
  const list = valid.filter((key) => (keys || []).includes(key));
  return put(state, { duplicateFields: list });
}
// 判重设置
function setDedupe(state, modes) {
  const next = {};
  for (const [key, label] of DEDUPE_FIELDS) {
    const mode = modes && modes[key];
    if (!DEDUPE_MODES.includes(mode)) throw new Error(`请选择“${label}”的判重方式`);
    next[key] = mode;
  }
  return put(state, { dedupe: next });
}
const dedupeKey = (key, value) => {
  const text = trim(value);
  if (key === "phone" || key === "landline") { const digits = text.replace(/\D/g, ""); return digits.length >= 6 ? digits : ""; }
  return text.toLowerCase();
};
// 一位客户资料里某个判重字段的全部取值（主联系人 + 其他联系人）。
function dedupeValues(profile, key) {
  const p = profile || {};
  const extras = Array.isArray(p.extraContacts) ? p.extraContacts : [];
  const lists = { email: [p.email, ...(Array.isArray(p.emails) ? p.emails : [])], phone: [p.phone, ...(Array.isArray(p.phones) ? p.phones : [])], socialAccount: [p.socialAccount] };
  const own = key in lists ? lists[key] : [p[key]];
  const more = ["email", "phone", "socialAccount"].includes(key) ? extras.map((c) => c && c[key]) : [];
  return [...new Set([...own, ...more].map((v) => dedupeKey(key, v)).filter(Boolean))];
}
// 保存前检查：只看这次新增或改动的值，老数据里已有的重复不挡住修改。
function assertNotDuplicate(state, nextProfile, previousProfiles, selfName) {
  const modes = get(state).dedupe;
  const had = Array.isArray(previousProfiles) ? previousProfiles : [previousProfiles];
  for (const [key, label] of DEDUPE_FIELDS) {
    if (modes[key] !== "block") continue;
    const old = new Set(had.flatMap((p) => dedupeValues(p, key)));
    const fresh = dedupeValues(nextProfile, key).filter((v) => !old.has(v));
    if (!fresh.length) continue;
    for (const [name, other] of Object.entries(profiles(state))) {
      if (name === selfName || bucketOf(other) === "trash") continue;
      const mine = new Set(dedupeValues(other, key));
      const hit = fresh.find((v) => mine.has(v));
      if (hit) throw new Error(`${label}和已有客户「${name}」相同，不能保存`);
    }
  }
}
function duplicateValue(state, name, key) {
  const p = profiles(state)[name] || {};
  const text = (v) => trim(v);
  if (key === "contact") return text(p.contact || (Array.isArray(p.contacts) ? p.contacts[0] : ""));
  if (key === "createdAt") return text(p.createdAt).slice(0, 10);
  if (key === "owner") return text(p.owner);
  return text(p[key]);
}
function setLayout(state, layout) {
  if (!["left-small", "left-large"].includes(layout)) throw new Error("布局只能是左小右大或左大右小");
  return put(state, { layout });
}

// ============ 最近联系 / 最近跟进 怎么算 ============
function setFollowRules(state, { contact, followup } = {}) {
  const current = get(state).followRules;
  const pick = (list, label) => {
    if (list === undefined) return null;
    const out = Array.isArray(list) ? FOLLOW_KEYS.filter((key) => list.includes(key)) : [];
    if (!out.length) throw new Error(`请至少选一项“算作${label}”的动作`);
    return out;
  };
  const c = pick(contact, "最近联系");
  const f = pick(followup, "最近跟进");
  return put(state, { followRules: { contact: c || current.contact, followup: f || current.followup } });
}
// 按客户名分好组再查：状态不可变，所以按数组对象缓存，不用每位客户都扫一遍全部订单 / 商机。
const orderGroups = new WeakMap();
const opportunityGroups = new WeakMap();
const NO_ITEMS = [];
function groupByClient(list, clientOf) {
  const groups = new Map();
  for (const item of list) {
    if (!item) continue;
    const client = clientOf(item);
    const bucket = groups.get(client);
    if (bucket) bucket.push(item); else groups.set(client, [item]);
  }
  return groups;
}
function ordersOf(state, name) {
  const list = state && Array.isArray(state.orders) ? state.orders : null;
  if (!list) return NO_ITEMS;
  let groups = orderGroups.get(list);
  if (!groups) { groups = groupByClient(list, (o) => o.client); orderGroups.set(list, groups); }
  return groups.get(name) || NO_ITEMS;
}
// 商机存在 state.laiOpportunities（opportunity-model.js），用 client 对应客户，取 createdAt 和 updatedAt。
function opportunitiesOf(state, name) {
  const list = state && Array.isArray(state.laiOpportunities) ? state.laiOpportunities : null;
  if (!list) return NO_ITEMS;
  let groups = opportunityGroups.get(list);
  if (!groups) { groups = groupByClient(list, (o) => trim(o.client)); opportunityGroups.set(list, groups); }
  return groups.get(name) || NO_ITEMS;
}
function latestOf(values) {
  let best = "";
  let bestTime = NaN;
  for (const v of values) {
    const t = validTime(v);
    if (Number.isFinite(t) && (!Number.isFinite(bestTime) || t > bestTime)) { best = typeof v === "string" ? v : new Date(t).toISOString(); bestTime = t; }
  }
  return best;
}
// 每个动作的最近时间（和 latestOf 对该动作所有时间的结果完全一样），历史只走一遍。
function latestByAction(state, name) {
  const profile = profiles(state)[name] || {};
  const history = Array.isArray(profile.history) ? profile.history : [];
  const lists = { followup: [], mailSent: [], mailReceived: [], chat: [] };
  for (const h of history) {
    if (!h) continue;
    const at = h.time || h.date;
    if (h.type === "followup") lists.followup.push(at);
    else if (h.type === "email") (h.subtype === "sent" ? lists.mailSent : lists.mailReceived).push(at);
    else if (h.type === "chat" || h.type === "call") lists.chat.push(at);
  }
  // 资料上存的跟进时间也算（导入的老客户可能只有它，没有跟进记录）。
  lists.followup.push(profile.lastFollowup, profile.lastWrittenFollowup);
  const order = [];
  for (const o of ordersOf(state, name)) if (!o.isDraft) order.push(o.createdAt, o.updated);
  const opportunity = [];
  for (const item of opportunitiesOf(state, name)) opportunity.push(item.createdAt, item.updatedAt);
  return {
    followup: latestOf(lists.followup),
    mailSent: latestOf(lists.mailSent),
    mailReceived: latestOf(lists.mailReceived),
    chat: latestOf(lists.chat),
    order: latestOf(order),
    opportunity: latestOf(opportunity),
    claim: latestOf([profile.lastPrivatePoolEntry]),
  };
}
function contactTimes(state, name) {
  const rules = get(state).followRules;
  const profile = profiles(state)[name] || {};
  const latest = latestByAction(state, name);
  const calc = (keys, legacy) => latestOf([...keys.map((key) => latest[key] || ""), legacy]);
  return { lastContact: calc(rules.contact, profile.lastContact), lastFollowup: calc(rules.followup, profile.lastFollowup) };
}

// ============ 成交怎么算 ============
function setDealRule(state, by) {
  if (!["order", "opportunity"].includes(by)) throw new Error("请选择成交的算法");
  return put(state, { dealRule: { by } });
}
function lastDealDate(state, name) {
  const profile = profiles(state)[name] || {};
  if (get(state).dealRule.by === "opportunity") return trim(profile.opportunityLastWonDate);
  return latestOf(ordersOf(state, name)
    .filter((o) => !o.isDraft && ["shipment", "done"].includes(o.stage))
    .map((o) => o.shippedAt || o.createdAt));
}

// ============ 动态自动记录 ============
function setActivity(state, { autoMail } = {}, at = new Date().toISOString()) {
  const current = get(state).activity;
  if (autoMail === undefined) return put(state, { activity: current });
  const on = autoMail === true;
  return put(state, { activity: { autoMail: on, since: on ? (current.autoMail && current.since ? current.since : at) : current.since } });
}
function autoMailSince(state) {
  const a = get(state).activity;
  return a.autoMail ? a.since : "";
}

// ============ 写跟进：历史时间、常用语 ============
function setFollowupOptions(state, { allowPastTime } = {}) {
  const current = get(state).followup;
  return put(state, { followup: { ...current, allowPastTime: allowPastTime === undefined ? current.allowPastTime : allowPastTime === true } });
}
function putTemplates(state, templates) {
  return put(state, { followup: { ...get(state).followup, templates } });
}
const copyTemplates = (state) => get(state).followup.templates.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) }));
function addTemplateGroup(state, name) {
  const value = cleanName(name, "分组名称");
  const list = copyTemplates(state);
  if (list.some((g) => norm(g.name) === norm(value))) throw new Error("已有同名分组");
  if (list.length >= TEMPLATE_LIMITS.groups) throw new Error(`分组最多 ${TEMPLATE_LIMITS.groups} 个`);
  list.push({ id: newId(), name: value, items: [] });
  return putTemplates(state, list);
}
function renameTemplateGroup(state, id, name) {
  const list = copyTemplates(state);
  const hit = list.find((g) => g.id === id);
  if (!hit) throw new Error("找不到这个分组");
  const value = cleanName(name, "分组名称");
  if (list.some((g) => g.id !== id && norm(g.name) === norm(value))) throw new Error("已有同名分组");
  hit.name = value;
  return putTemplates(state, list);
}
function deleteTemplateGroup(state, id) {
  const list = copyTemplates(state);
  if (!list.some((g) => g.id === id)) throw new Error("找不到这个分组");
  return putTemplates(state, list.filter((g) => g.id !== id));
}
function moveTemplateGroup(state, id, delta) {
  const list = copyTemplates(state);
  const at = list.findIndex((g) => g.id === id);
  if (at < 0) throw new Error("找不到这个分组");
  const to = at + delta;
  if (to < 0 || to >= list.length) return state;
  [list[at], list[to]] = [list[to], list[at]];
  return putTemplates(state, list);
}
function cleanTemplateText(value) {
  const text = trim(value);
  if (!text) throw new Error("请填写常用语");
  if (text.length > TEMPLATE_LIMITS.text) throw new Error(`常用语最长 ${TEMPLATE_LIMITS.text} 个字`);
  return text;
}
function addTemplate(state, groupId, text) {
  const list = copyTemplates(state);
  const group = list.find((g) => g.id === groupId);
  if (!group) throw new Error("找不到这个分组");
  const value = cleanTemplateText(text);
  if (group.items.length >= TEMPLATE_LIMITS.items) throw new Error(`一个分组最多 ${TEMPLATE_LIMITS.items} 条常用语`);
  group.items.push({ id: newId(), text: value });
  return putTemplates(state, list);
}
function findTemplate(list, groupId, itemId) {
  const group = list.find((g) => g.id === groupId);
  if (!group) throw new Error("找不到这个分组");
  const item = group.items.find((i) => i.id === itemId);
  if (!item) throw new Error("找不到这条模板");
  return { group, item };
}
function editTemplate(state, groupId, itemId, text) {
  const list = copyTemplates(state);
  const { item } = findTemplate(list, groupId, itemId);
  item.text = cleanTemplateText(text);
  return putTemplates(state, list);
}
function deleteTemplate(state, groupId, itemId) {
  const list = copyTemplates(state);
  const { group } = findTemplate(list, groupId, itemId);
  group.items = group.items.filter((i) => i.id !== itemId);
  return putTemplates(state, list);
}
// 写跟进时填的时间：空 = 现在；填了就必须允许历史时间，且不能晚于现在。
function checkFollowupTime(state, value, now = new Date()) {
  const text = trim(value);
  if (!text) return now.toISOString();
  if (!get(state).followup.allowPastTime) throw new Error("现在不允许填写历史跟进时间");
  const t = validTime(text);
  if (!Number.isFinite(t)) throw new Error("跟进时间无效");
  if (t > now.getTime() + 60000) throw new Error("跟进时间不能晚于现在");
  return new Date(t).toISOString();
}

const api = {
  DEFAULTS, DEDUPE_FIELDS, DEFAULT_STAGES, DEFAULT_TYPES, DUPLICATE_FIELDS, LIMITS, SEP,
  get, put,
  addStage, renameStage, deleteStage, stageUse, moveItem,
  addType, renameType, deleteType, typeUse,
  addGroup, editGroup, deleteGroup, groupUse, groupChoices, checkGroup, isConfiguredGroup, groupPaths,
  addBlacklist, removeBlacklist, blacklistHit, assertEmailsAllowed,
  limitFor, ownerCount, assertCanTake, capRows, setCaps,
  sourceChoices, sourcePath, sourceUse, addSource, renameSource, setSourceHidden, moveSource, deleteSource,
  setDuplicateFields, duplicateValue, setLayout, setDedupe, assertNotDuplicate, dedupeValues,
  FOLLOW_ACTIONS, setFollowRules, contactTimes,
  setDealRule, lastDealDate,
  setActivity, autoMailSince,
  setFollowupOptions, addTemplateGroup, renameTemplateGroup, deleteTemplateGroup, moveTemplateGroup,
  addTemplate, editTemplate, deleteTemplate, checkFollowupTime,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.LaiCustomerSettings = api;
})(typeof window !== "undefined" ? window : globalThis);
