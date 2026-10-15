(function (root) {
"use strict";
// 客户设置页的页面文字（HTML）。只生成字符串，不碰页面、不保存；点击和保存在 app.js 里接。
const CS = typeof module !== "undefined" && module.exports ? require("./customer-settings-model.js") : root.LaiCustomerSettings;
const identity = (v) => String(v ?? "");

// 页签顺序跟小满一致；每个页签都是真能用的设置。
const TABS = Object.freeze([
  { id: "groups", label: "客户分组", note: "最多两级。客户编辑里的“客户分组”下拉用这里的分组；可限定哪些跟进人能用。" },
  { id: "stages", label: "客户阶段", note: "客户编辑里的“客户阶段”下拉用这里的列表。改名会同步改到客户身上；还有客户在用的阶段不能删除。" },
  { id: "types", label: "客户类型", note: "客户编辑里的“客户类型”下拉用这里的列表。改名会同步改到客户身上；还有客户在用的类型不能删除。" },
  { id: "pool", label: "公海管理", note: "客户久没联系或久没成交，就自动移入公海；这里也管领取、领回和移入原因。" },
  { id: "follow", label: "客户跟进规则", note: "决定哪些动作算“最近联系”、哪些算“最近跟进”。改了以后，公海规则按新算法算天数，改前可先到「公海管理」看哪些客户会被移走。" },
  { id: "deal", label: "客户成交规则", note: "决定怎样算“成交”。改了以后，公海规则按新算法算天数，改前可先到「公海管理」看哪些客户会被移走。" },
  { id: "blacklist", label: "建档黑名单", note: "黑名单里的邮箱不能用来新建客户、批量建档、导入，也不能加到客户的联系人上。" },
  { id: "caps", label: "客户上限", note: "限制每位跟进人名下最多有多少位客户（不含公海和回收站）。新建、重新分配、导入、从公海领回都会检查。" },
  { id: "sources", label: "来源设置", note: "线索、客户、商机共用的来源名单：最多两级，可以隐藏、排序。填来源时下拉里只出现没隐藏的。" },
  { id: "dedupe", label: "判重设置", note: "新建或修改客户时，哪些资料不能和别的客户相同。公司名称固定不能重复。" },
  { id: "duplicates", label: "客户查重", note: "选择“客户查重”页里，每位疑似重复的客户后面显示哪些资料，方便核对该留哪个。" },
  { id: "activity", label: "动态设置", note: "往来邮件可以自动记到客户动态里，不用手动记。" },
  { id: "followup", label: "写跟进设置", note: "写跟进时能不能填过去的时间，以及常用的跟进模板。" },
  { id: "layout", label: "布局设置", note: "客户详情页左右两栏哪边宽。" },
]);

function nav(tab, E) {
  return `<nav class="cs-nav" aria-label="客户设置">${TABS.map((t) => `<button type="button" data-cs-tab="${t.id}" class="${t.id === tab ? "active" : ""}"${t.id === tab ? ' aria-current="page"' : ""}>${E(t.label)}</button>`).join("")}</nav>`;
}
// 新规则默认从今天起算，免得一打开就把老客户整批移走。
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const field = (label, content, hint) => `<label class="cs-field"><span>${label}</span>${content}${hint ? `<em>${hint}</em>` : ""}</label>`;
const empty = (text) => `<div class="cs-empty">${text}</div>`;

// 阶段和类型：同一种“可改名、可排序的名单”
function namedList(kind, items, useOf, ui, E) {
  const label = kind === "stages" ? "阶段" : "类型";
  const rows = items.map((name, index) => {
    const used = useOf(name);
    const editing = ui.editing && ui.editing.kind === kind && ui.editing.key === name;
    const body = editing
      ? `<form class="cs-inline" data-cs-form="rename-${kind}" data-old="${E(name)}"><input name="name" value="${E(name)}" maxlength="20" aria-label="${label}名称" autocomplete="off"><button type="submit" class="primary">保存</button><button type="button" data-cs-cancel>取消</button></form>`
      : `<strong>${E(name)}</strong><span class="cs-use">${used ? `${used} 位客户在用` : "没有客户在用"}</span>`;
    const buttons = editing ? "" : `<span class="cs-row-actions"><button type="button" data-cs-move="${kind}" data-name="${E(name)}" data-delta="-1" aria-label="上移"${index === 0 ? " disabled" : ""}>↑</button><button type="button" data-cs-move="${kind}" data-name="${E(name)}" data-delta="1" aria-label="下移"${index === items.length - 1 ? " disabled" : ""}>↓</button><button type="button" data-cs-edit="${kind}" data-key="${E(name)}">改名</button><button type="button" data-cs-delete="${kind}" data-key="${E(name)}">删除</button></span>`;
    return `<li class="cs-row">${body}${buttons}</li>`;
  }).join("");
  return `<form class="cs-add" data-cs-form="add-${kind}"><input name="name" placeholder="新${label}名称" maxlength="20" aria-label="新${label}名称" autocomplete="off"><button type="submit" class="primary">添加</button></form>${items.length ? `<ul class="cs-list">${rows}</ul>` : empty(`还没有${label}`)}`;
}

function groupsTab(state, ui, E) {
  const groups = CS.get(state).groups;
  const rows = groups.map((g) => {
    const who = g.members === "all" ? "全部跟进人可用" : `限 ${g.members.length ? g.members.map(E).join("、") : "（没选人）"}`;
    const children = g.children.map((c) => {
      const path = `${g.name}${CS.SEP}${c.name}`;
      const used = CS.groupUse(state, path);
      return `<li class="cs-row cs-child"><strong>${E(c.name)}</strong><span class="cs-use">${used ? `${used} 位客户在用` : "没有客户在用"}</span><span class="cs-row-actions"><button type="button" data-cs-group-edit="${E(c.id)}">改名</button><button type="button" data-cs-delete="group" data-key="${E(c.id)}">删除</button></span></li>`;
    }).join("");
    const used = CS.groupUse(state, g.name);
    return `<li class="cs-group"><div class="cs-row"><strong>${E(g.name)}</strong><span class="cs-use">${E(who)}${g.children.length && g.childRequired ? " · 必须选到子分组" : ""} · ${used ? `${used} 位客户在用` : "没有客户在用"}</span><span class="cs-row-actions"><button type="button" data-cs-group-add="${E(g.id)}">添加子分组</button><button type="button" data-cs-group-edit="${E(g.id)}">编辑</button><button type="button" data-cs-delete="group" data-key="${E(g.id)}">删除</button></span></div>${children ? `<ul class="cs-list cs-children">${children}</ul>` : ""}</li>`;
  }).join("");
  return `<div class="cs-toolbar"><button type="button" class="primary" data-cs-group-add="">新建分组</button></div>${groups.length ? `<ul class="cs-list cs-tree">${rows}</ul>` : empty("还没有分组。点“新建分组”添加，客户编辑里的“客户分组”就能选到它。")}`;
}
function groupForm(state, spec, owners, E) {
  const settings = CS.get(state);
  const parent = spec.parentId ? settings.groups.find((g) => g.id === spec.parentId) : null;
  let current = null;
  let top = null;
  if (spec.id) for (const g of settings.groups) {
    if (g.id === spec.id) { current = g; top = g; }
    else { const c = g.children.find((item) => item.id === spec.id); if (c) { current = c; top = g; } }
  }
  const isChild = !!(current && top && current !== top);
  const topLevel = !parent && !isChild;
  const members = topLevel && current ? current.members : "all";
  const checked = (name) => (members !== "all" && members.includes(name) ? " checked" : "");
  const parts = [
    parent ? `<p class="cs-hint">上级分组：<strong>${E(parent.name)}</strong></p>` : "",
    isChild ? `<p class="cs-hint">上级分组：<strong>${E(top.name)}</strong></p>` : "",
    field("分组名称", `<input name="name" value="${E(current ? current.name : "")}" maxlength="20" required autocomplete="off">`),
  ];
  if (topLevel) {
    parts.push(`<fieldset class="cs-field"><legend>可用的跟进人</legend><label class="check-row"><input type="radio" name="membersMode" value="all"${members === "all" ? " checked" : ""}> 全部跟进人</label><label class="check-row"><input type="radio" name="membersMode" value="some"${members === "all" ? "" : " checked"}> 只限这些人</label><div class="cs-members">${owners.length ? owners.map((o) => `<label class="check-row"><input type="checkbox" name="member" value="${E(o)}"${checked(o)}> ${E(o)}</label>`).join("") : '<span class="cs-hint">还没有跟进人。先在客户里填跟进人。</span>'}</div></fieldset>`);
    if (current && current.children.length) parts.push(`<label class="check-row"><input type="checkbox" name="childRequired"${current.childRequired ? " checked" : ""}> 客户必须选到子分组</label>`);
  }
  return `<form id="cs-group-form" class="drawer-body cs-group-form" data-id="${E(spec.id || "")}" data-parent="${E(spec.parentId || "")}"><div class="error" id="workspace-error" role="alert"></div>${parts.join("")}</form>`;
}

function blacklistTab(state, E) {
  const list = CS.get(state).blacklist;
  return `<form class="cs-add" data-cs-form="add-blacklist"><input name="email" placeholder="完整邮箱，或 @域名，如 @example.com" maxlength="120" aria-label="黑名单邮箱" autocomplete="off"><button type="submit" class="primary">添加</button></form>${list.length ? `<ul class="cs-list">${list.map((entry) => `<li class="cs-row"><strong>${E(entry)}</strong><span class="cs-use">${entry.startsWith("@") ? "整个域名" : "这个邮箱"}</span><span class="cs-row-actions"><button type="button" data-cs-delete="blacklist" data-key="${E(entry)}">移除</button></span></li>`).join("")}</ul>` : empty("黑名单是空的")}`;
}

function capsTab(state, owners, E) {
  const caps = CS.get(state).caps;
  const rows = CS.capRows(state, owners);
  const table = rows.length
    ? `<table class="cs-table"><thead><tr><th>跟进人</th><th>现有客户数</th><th>上限（留空＝跟随默认）</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${E(r.owner)}</td><td>${r.count}${r.effective && r.count >= r.effective ? ' <em class="cs-full">已满</em>' : ""}</td><td><input name="cap:${E(r.owner)}" type="number" min="0" max="${CS.LIMITS.cap}" step="1" value="${r.limit === null ? "" : r.limit}" placeholder="${caps.defaultLimit || "不限"}" aria-label="${E(r.owner)}的客户上限"></td></tr>`).join("")}</tbody></table>`
    : empty("还没有跟进人。客户里填了跟进人后，会列在这里。");
  return `<form class="cs-caps" data-cs-form="caps">${field("默认上限", `<input name="defaultLimit" type="number" min="0" max="${CS.LIMITS.cap}" step="1" value="${caps.defaultLimit}">`, "0 表示不限。每位跟进人可以在下面单独设置。")}${table}<div class="cs-actions"><button type="submit" class="primary">保存</button></div></form>`;
}

function duplicatesTab(state, E) {
  const chosen = new Set(CS.get(state).duplicateFields);
  return `<form class="cs-dup" data-cs-form="duplicates"><fieldset class="cs-field"><legend>每位疑似重复的客户后面显示</legend><div class="cs-checks">${CS.DUPLICATE_FIELDS.map(([key, label]) => `<label class="check-row"><input type="checkbox" name="field" value="${key}"${chosen.has(key) ? " checked" : ""}> ${E(label)}</label>`).join("")}</div></fieldset><p class="cs-hint">这里只决定显示什么，不改变“按相同邮箱或电话判重”的规则。</p><div class="cs-actions"><button type="submit" class="primary">保存</button></div></form>`;
}

function sourcesTab(state, ui, E) {
  const list = CS.get(state).sources;
  const row = (item, path, top, index, count) => {
    const editing = ui.editing && ui.editing.kind === "source" && ui.editing.key === item.id;
    const used = CS.sourceUse(state, path);
    const head = editing
      ? `<form class="cs-inline" data-cs-form="rename-source" data-id="${E(item.id)}"><input name="name" value="${E(item.name)}" maxlength="20" aria-label="来源名称" autocomplete="off"><button type="submit" class="primary">保存</button><button type="button" data-cs-cancel>取消</button></form>`
      : `<strong>${E(item.name)}</strong><span class="cs-use">${item.hidden ? "已隐藏 · " : ""}${used ? `${used} 位客户在用` : "没有客户在用"}</span><span class="cs-row-actions"><button type="button" data-cs-source-move="${E(item.id)}" data-delta="-1" aria-label="上移"${index === 0 ? " disabled" : ""}>↑</button><button type="button" data-cs-source-move="${E(item.id)}" data-delta="1" aria-label="下移"${index === count - 1 ? " disabled" : ""}>↓</button>${top ? `<button type="button" data-cs-source-sub="${E(item.id)}">添加子来源</button>` : ""}<button type="button" data-cs-source-hide="${E(item.id)}" data-hidden="${item.hidden ? "0" : "1"}">${item.hidden ? "显示" : "隐藏"}</button><button type="button" data-cs-edit="source" data-key="${E(item.id)}">改名</button><button type="button" data-cs-delete="source" data-key="${E(item.id)}">删除</button></span>`;
    return head;
  };
  const rows = list.map((t, i) => {
    const kids = t.children.map((c, j) => `<li class="cs-row cs-child">${row(c, CS.sourcePath(t, c), false, j, t.children.length)}</li>`).join("");
    return `<li class="cs-group"><div class="cs-row">${row(t, t.name, true, i, list.length)}</div>${kids ? `<ul class="cs-list cs-children">${kids}</ul>` : ""}</li>`;
  }).join("");
  const adding = ui.editing && ui.editing.kind === "sourcesub" ? list.find((t) => t.id === ui.editing.key) : null;
  const subForm = adding ? `<form class="cs-add" data-cs-form="add-source" data-parent="${E(adding.id)}"><input name="name" placeholder="“${E(adding.name)}”下的新子来源" maxlength="20" aria-label="新子来源名称" autocomplete="off"><button type="submit" class="primary">添加</button><button type="button" data-cs-cancel>取消</button></form>` : "";
  return `<form class="cs-add" data-cs-form="add-source"><input name="name" placeholder="新一级来源名称" maxlength="20" aria-label="新来源名称" autocomplete="off"><button type="submit" class="primary">添加</button></form>${subForm}${list.length ? `<ul class="cs-list cs-tree">${rows}</ul><p class="cs-hint">隐藏后，新建时选不到，但已经在用的客户不受影响。名单里没有的来源仍可以手填。</p>` : empty("还没有来源名单。现在下拉里列的是已经用过的来源；添加后只列这里的。")}`;
}
function dedupeTab(state, ui, E) {
  const sub = ui && ui.dedupeSub === "lead" ? "lead" : "customer";
  const modes = CS.get(state)[sub === "lead" ? "leadDedupe" : "dedupe"];
  const radio = (key, value, text) => `<label class="check-row"><input type="radio" name="dedupe:${key}" value="${value}"${modes[key] === value ? " checked" : ""}> ${text}</label>`;
  const rowsOf = (fields) => fields.map(([key, label]) => `<tr><td>${E(label)}</td><td>${radio(key, "allow", "判重，允许保存")}</td><td>${radio(key, "block", "判重，不允许保存")}</td><td>${radio(key, "off", "不判重")}</td></tr>`).join("");
  const subTab = (id, text) => `<button type="button" role="tab" data-cs-dedupe-sub="${id}" aria-selected="${sub === id}" class="${sub === id ? "active" : ""}">${text}</button>`;
  const tabs = `<div class="cs-subtabs" role="tablist" aria-label="判重对象">${subTab("customer", "新客户与已有客户")}${subTab("lead", "新线索与已有客户")}</div>`;
  const head = '<thead><tr><th>资料</th><th colspan="3">重复时</th></tr></thead>';
  if (sub === "lead") {
    return `${tabs}<form class="cs-dup" data-cs-form="lead-dedupe"><table class="cs-table cs-dedupe">${head}<tbody>${rowsOf(CS.LEAD_DEDUPE_FIELDS)}</tbody></table><p class="cs-hint">新建或修改线索时，按这里的规则和已有客户比对。</p>${saveRow()}</form>`;
  }
  return `${tabs}<form class="cs-dup" data-cs-form="dedupe"><table class="cs-table cs-dedupe">${head}<tbody><tr><td>公司名称</td><td colspan="3">固定：不允许保存</td></tr>${rowsOf(CS.DEDUPE_FIELDS)}</tbody></table><p class="cs-hint">“判重，允许保存”：保存不受影响，重复的客户会出现在“客户查重”页。“判重，不允许保存”：保存时提示和哪位客户相同。只检查这次新增或改过的值，已有的重复不会挡住修改。</p>${saveRow()}</form>`;
}

function layoutTab(state) {
  const layout = CS.get(state).layout;
  const card = (id, title, small) => `<button type="button" class="cs-layout-card${layout === id ? " active" : ""}" data-cs-layout="${id}" aria-pressed="${layout === id}"><span class="cs-layout-pic ${small ? "small-left" : "large-left"}" aria-hidden="true"><i></i><i></i></span><strong>${title}</strong></button>`;
  return `<div class="cs-layouts">${card("left-small", "左小右大", true)}${card("left-large", "左大右小", false)}</div><p class="cs-hint">选中后马上生效，客户详情页下次打开就是这个布局。</p>`;
}

// ---- 公海管理 ----
const poolTools = () => (typeof module !== "undefined" && module.exports ? require("./customer-tools.js") : root.LaiCustomerTools);
const kindText = (kind) => (kind === "noDeal" ? "没有成交" : "没有联系");
const section = (title, hint, inner) => `<section class="cs-section"><h3>${title}</h3>${hint ? `<p class="cs-hint">${hint}</p>` : ""}${inner}</section>`;
const nums = (name, value, min, max, label) => `<input name="${name}" type="number" min="${min}" max="${max}" step="1" value="${value}" aria-label="${label}" required>`;
const saveRow = () => `<div class="cs-actions"><button type="submit" class="primary">保存</button></div>`;

function poolRulesSection(rules, E) {
  const rows = rules.rules.map((r) => `<tr><td><input type="checkbox" data-cs-rule-toggle="${E(r.id)}"${r.enabled ? " checked" : ""} aria-label="启用“${E(r.name)}”"></td><td>${E(r.name)}</td><td>${r.days} 天${kindText(r.kind)}</td><td>${r.groups.length ? r.groups.map(E).join("、") : "全部客户"}</td><td>${r.startDate ? E(r.startDate) : "—"}</td><td><span class="cs-row-actions"><button type="button" data-cs-rule-edit="${E(r.id)}">编辑</button><button type="button" data-cs-rule-delete="${E(r.id)}">删除</button></span></td></tr>`).join("");
  const table = rules.rules.length
    ? `<table class="cs-table cs-rules"><thead><tr><th>启用</th><th>名称</th><th>条件</th><th>适用分组</th><th>开始日期</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
    : empty("还没有规则。点“新建规则”，比如“90 天没有联系就移入公海”。");
  return section("自动移入公海规则", "每天打开来财时自动执行一次已启用的规则；也可以点“立即执行”。", `<div class="cs-toolbar"><button type="button" class="primary" data-cs-rule-edit="">新建规则</button></div>${table}`);
}
function poolPreviewSection(state, rules, ui, E) {
  const CT = poolTools();
  const list = CT.poolCandidates(state);
  const soon = CT.poolReminders(state);
  const anyOn = rules.rules.some((r) => r.enabled);
  const confirming = ui.editing && ui.editing.kind === "poolrun";
  const table = list.length
    ? `<table class="cs-table"><thead><tr><th>客户</th><th>跟进人</th><th>规则</th><th>天数</th></tr></thead><tbody>${list.slice(0, 20).map((c) => `<tr><td>${E(c.name)}</td><td>${E(c.owner)}</td><td>${E(c.ruleName)}</td><td>${c.days} 天</td></tr>`).join("")}</tbody></table>${list.length > 20 ? `<p class="cs-hint">还有 ${list.length - 20} 位…</p>` : ""}`
    : empty(anyOn ? "现在没有符合规则的客户" : "还没有启用的规则，所以不会有客户被移入公海");
  const run = confirming
    ? `<div class="cs-confirm" role="alert"><span>将把 <strong>${list.length}</strong> 位客户移入公海，确定吗？</span><button type="button" class="primary" data-cs-pool-run-ok>确定移入</button><button type="button" data-cs-cancel>取消</button></div>`
    : `<div class="cs-actions"><button type="button" class="primary" data-cs-pool-run>立即执行</button></div>`;
  let soonBox;
  if (!rules.remindDays) soonBox = '<p class="cs-hint">提前提醒已关闭。</p>';
  else if (!soon.length) soonBox = empty(`未来 ${rules.remindDays} 天内没有客户会被移入公海`);
  else soonBox = `<table class="cs-table"><thead><tr><th>客户</th><th>规则</th><th>还有几天</th></tr></thead><tbody>${soon.slice(0, 20).map((c) => `<tr><td>${E(c.name)}</td><td>${E(c.ruleName)}</td><td>还有 ${c.dueInDays} 天</td></tr>`).join("")}</tbody></table>${soon.length > 20 ? `<p class="cs-hint">还有 ${soon.length - 20} 位…</p>` : ""}`;
  return section("现在符合规则的客户", "按已启用的规则算出来的，点“立即执行”会把他们移入公海。", `${table}${run}`)
    + section("即将移入公海", "", soonBox);
}
function claimTable(rules, owners, E) {
  const names = [...new Set([...owners, ...Object.keys(rules.claimLimit.perOwner)])];
  if (!names.length) return "";
  return `<table class="cs-table"><thead><tr><th>跟进人</th><th>每人上限（留空＝跟随默认）</th></tr></thead><tbody>${names.map((o) => `<tr><td>${E(o)}</td><td><input name="claim:${E(o)}" type="number" min="0" max="100000" step="1" value="${Object.hasOwn(rules.claimLimit.perOwner, o) ? rules.claimLimit.perOwner[o] : ""}" placeholder="${rules.claimLimit.defaultLimit || "不限"}" aria-label="${E(o)}的领取上限"></td></tr>`).join("")}</tbody></table>`;
}
function poolTab(state, ui, owners, E) {
  const rules = poolTools().poolRules(state);
  const white = rules.whitelist;
  const free = owners.filter((o) => !white.includes(o));
  const whitelist = `<form class="cs-add" data-cs-form="pool-white-add"><select name="owner" aria-label="选择跟进人"${free.length ? "" : " disabled"}>${free.length ? free.map((o) => `<option value="${E(o)}">${E(o)}</option>`).join("") : '<option value="">没有可选的跟进人</option>'}</select><button type="submit" class="primary"${free.length ? "" : " disabled"}>加入白名单</button></form>${white.length ? `<ul class="cs-list">${white.map((o) => `<li class="cs-row"><strong>${E(o)}</strong><span class="cs-use">名下的客户不会被移入公海</span><span class="cs-row-actions"><button type="button" data-cs-pool-white-remove="${E(o)}">移除</button></span></li>`).join("")}</ul>` : '<p class="cs-hint">白名单是空的。</p>'}`;
  const reasons = `<label class="check-row"><input type="checkbox" data-cs-pool-require${rules.requireReason ? " checked" : ""}> 移入公海时必须填写原因</label><form class="cs-add" data-cs-form="pool-reason-add"><input name="reason" placeholder="新原因（20 字以内）" maxlength="20" aria-label="新原因" autocomplete="off"><button type="submit" class="primary">添加</button></form>${rules.reasons.length ? `<ul class="cs-list">${rules.reasons.map((r) => `<li class="cs-row"><strong>${E(r)}</strong><span class="cs-row-actions"><button type="button" data-cs-pool-reason-remove="${E(r)}">删除</button></span></li>`).join("")}</ul>` : '<p class="cs-hint">还没有原因。添加后，移入公海时可以直接选。</p>'}`;
  return [
    poolRulesSection(rules, E),
    poolPreviewSection(state, rules, ui, E),
    section("提前提醒", "填 0 表示不提醒。客户详情页会提示还有几天移入公海。", `<form class="cs-inline-form" data-cs-form="pool-remind"><label>提前 ${nums("remindDays", rules.remindDays, 0, 30, "提前提醒天数")} 天提醒</label><button type="submit" class="primary">保存</button></form>`),
    section("白名单", "白名单里的跟进人，名下的客户不会被自动移入公海。", whitelist),
    section("这些客户不移", "", `<form class="cs-dup" data-cs-form="pool-skip"><label class="check-row"><input type="checkbox" name="skipOpenOrders"${rules.skipOpenOrders ? " checked" : ""}> 有进行中订单（报价、定金、生产中、尾款）的客户</label><label class="check-row"><input type="checkbox" name="skipFollowed"${rules.skipFollowed ? " checked" : ""}> 已设为关注的客户</label>${field("带这些标签的客户（用逗号隔开）", `<input name="skipTags" value="${E(rules.skipTags.join("，"))}" maxlength="200" autocomplete="off">`)}${saveRow()}</form>`),
    section("领回限制", "填 0 表示不限。", `<form class="cs-inline-form" data-cs-form="pool-reclaim"><label>原跟进人 ${nums("reclaimBlockDays", rules.reclaimBlockDays, 0, 365, "领回限制天数")} 天内不能领回同一个客户</label><button type="submit" class="primary">保存</button></form>`),
    section("领取上限", "填 0 表示不限。下面可以给每个人单独设置。", `<form class="cs-claim" data-cs-form="pool-claim"><div class="cs-inline-form"><label>每 ${nums("periodDays", rules.claimLimit.periodDays, 1, 365, "统计天数")} 天，每人最多领 ${nums("defaultLimit", rules.claimLimit.defaultLimit, 0, 100000, "默认领取上限")} 位</label></div>${claimTable(rules, owners, E)}${saveRow()}</form>`),
    section("公海联系人", "隐藏后公海客户也不能编辑。", `<form class="cs-dup" data-cs-form="pool-contacts"><label class="check-row"><input type="radio" name="showPoolContacts" value="show"${rules.showPoolContacts ? " checked" : ""}> 显示</label><label class="check-row"><input type="radio" name="showPoolContacts" value="hide"${rules.showPoolContacts ? "" : " checked"}> 隐藏</label>${saveRow()}</form>`),
    section("移入公海原因", "", reasons),
  ].join("");
}
function ruleForm(state, id, E) {
  const settings = CS.get(state);
  const rule = poolTools().poolRules(state).rules.find((r) => r.id === id) || { name: "", kind: "noContact", days: 90, groups: [], startDate: todayLocal(), enabled: true };
  const paths = [];
  for (const g of settings.groups) { paths.push([g.name, g.name]); for (const c of g.children) paths.push([`${g.name}${CS.SEP}${c.name}`, `　${c.name}`]); }
  const known = new Set(paths.map(([p]) => p));
  for (const g of rule.groups) if (!known.has(g)) paths.push([g, g]);
  const picks = paths.length ? paths.map(([value, label]) => `<label class="check-row"><input type="checkbox" name="group" value="${E(value)}"${rule.groups.includes(value) ? " checked" : ""}> ${E(label)}</label>`).join("") : '<span class="cs-hint">还没有分组，规则会用在全部客户上。</span>';
  return `<form id="cs-rule-form" class="drawer-body cs-group-form cs-rule-form" data-id="${E(id || "")}"><div class="error" id="workspace-error" role="alert"></div>`
    + field("规则名称", `<input name="name" value="${E(rule.name)}" maxlength="20" required autocomplete="off">`)
    + field("条件", `<select name="kind"><option value="noContact"${rule.kind === "noContact" ? " selected" : ""}>没有联系</option><option value="noDeal"${rule.kind === "noDeal" ? " selected" : ""}>没有成交</option></select>`)
    + field("超过多少天", `<input name="days" type="number" min="1" max="3650" step="1" value="${rule.days}" required>`, "天数从最近一次联系（或成交）算起。")
    + `<fieldset class="cs-field"><legend>适用分组</legend><div class="cs-members cs-flat">${picks}</div><em>不选＝全部客户。选了一级分组，它下面的子分组也算。</em></fieldset>`
    + field("开始日期（可不填）", `<input name="startDate" type="date" value="${E(rule.startDate)}">`, "从这天起算，避免一开启就移走很多老客户。")
    + `<label class="check-row"><input type="checkbox" name="enabled"${rule.enabled ? " checked" : ""}> 启用这条规则</label></form>`;
}

// ---- 客户跟进规则、成交规则、动态设置 ----
function followTab(state, E) {
  const rules = CS.get(state).followRules;
  const group = (name, label, hint) => `<fieldset class="cs-field"><legend>${label}</legend><div class="cs-checks">${CS.FOLLOW_ACTIONS.map(([key, text]) => `<label class="check-row"><input type="checkbox" name="${name}" value="${key}"${rules[name].includes(key) ? " checked" : ""}> ${E(text)}</label>`).join("")}</div><em>${hint}</em></fieldset>`;
  return `<form class="cs-dup" data-cs-form="follow">${group("contact", "算作“最近联系”", "最近联系时间决定公海规则里“多少天没有联系”。")}${group("followup", "算作“最近跟进”", "最近跟进时间显示在客户列表和详情里。")}${saveRow()}</form>`;
}
function dealTab(state) {
  const by = CS.get(state).dealRule.by;
  const radio = (value, text) => `<label class="check-row"><input type="radio" name="dealBy" data-cs-deal="${value}"${by === value ? " checked" : ""}> ${text}</label>`;
  return `<div class="cs-dup">${radio("order", "按订单（发货或完成的订单）")}${radio("opportunity", "按商机（赢单的商机）")}</div><p class="cs-hint">决定公海规则里“多少天没有成交”和客户详情里的“最近成交时间”。选中后马上生效。</p>`;
}
const stamp = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
function activityTab(state, E) {
  const a = CS.get(state).activity;
  return `<label class="check-row"><input type="checkbox" data-cs-activity${a.autoMail ? " checked" : ""}> 自动把和客户联系人的往来邮件记到客户动态</label>${a.autoMail && a.since ? `<p class="cs-hint">从 ${E(stamp(a.since))} 起自动记录</p>` : ""}<p class="cs-hint">只记打开这个开关以后的邮件；同一封邮件只记一次。</p>`;
}

// ---- 写跟进设置 ----
function followupTab(state, ui, E) {
  const f = CS.get(state).followup;
  const groups = f.templates.map((g, index) => {
    const editing = ui.editing && ui.editing.kind === "tplgroup" && ui.editing.key === g.id;
    const head = editing
      ? `<form class="cs-inline" data-cs-form="tpl-group-rename" data-id="${E(g.id)}"><input name="name" value="${E(g.name)}" maxlength="20" aria-label="分组名称" autocomplete="off"><button type="submit" class="primary">保存</button><button type="button" data-cs-cancel>取消</button></form>`
      : `<strong>${E(g.name)}</strong><span class="cs-use">${g.items.length} 条常用语</span><span class="cs-row-actions"><button type="button" data-cs-tpl-move="${E(g.id)}" data-delta="-1" aria-label="上移"${index === 0 ? " disabled" : ""}>↑</button><button type="button" data-cs-tpl-move="${E(g.id)}" data-delta="1" aria-label="下移"${index === f.templates.length - 1 ? " disabled" : ""}>↓</button><button type="button" data-cs-tpl-add="${E(g.id)}">添加常用语</button><button type="button" data-cs-edit="tplgroup" data-key="${E(g.id)}">改名</button><button type="button" data-cs-delete="tplgroup" data-key="${E(g.id)}">删除</button></span>`;
    const items = g.items.map((i) => `<li class="cs-row cs-child"><span class="cs-tpl-text">${E(i.text)}</span><span class="cs-row-actions"><button type="button" data-cs-tpl-edit="${E(i.id)}" data-tpl-group="${E(g.id)}">编辑</button><button type="button" data-cs-tpl-delete="${E(i.id)}" data-tpl-group="${E(g.id)}">删除</button></span></li>`).join("");
    return `<li class="cs-group"><div class="cs-row">${head}</div>${items ? `<ul class="cs-list cs-children">${items}</ul>` : ""}</li>`;
  }).join("");
  const templates = `<form class="cs-add" data-cs-form="tpl-group-add"><input name="name" placeholder="新分组名称，如 开发信跟进" maxlength="20" aria-label="新模板分组名称" autocomplete="off"><button type="submit" class="primary">添加分组</button></form>${f.templates.length ? `<ul class="cs-list cs-tree">${groups}</ul>` : empty("还没有模板。建好后，写跟进时点“选择模板”就能插入。")}`;
  return section("跟进时间", "", `<label class="check-row"><input type="checkbox" data-cs-allow-past${f.allowPastTime ? " checked" : ""}> 允许填写过去的跟进时间（不能晚于现在）</label>`)
    + section("跟进模板", "按分组放常用的跟进话术。", templates);
}
function tplForm(state, spec, E) {
  const group = CS.get(state).followup.templates.find((g) => g.id === spec.groupId);
  const item = group && spec.itemId ? group.items.find((i) => i.id === spec.itemId) : null;
  return `<form id="cs-tpl-form" class="drawer-body cs-group-form" data-tpl-group="${E(spec.groupId || "")}" data-item="${E(spec.itemId || "")}"><div class="error" id="workspace-error" role="alert"></div>${group ? `<p class="cs-hint">分组：<strong>${E(group.name)}</strong></p>` : ""}<label class="cs-field"><span>常用语</span><textarea name="text" rows="6" maxlength="500" required>${E(item ? item.text : "")}</textarea><em>最多 500 个字。</em></label></form>`;
}

function body(tab, state, ui, owners, E) {
  const settings = CS.get(state);
  if (tab === "groups") return groupsTab(state, ui, E);
  if (tab === "stages") return namedList("stages", settings.stages, (n) => CS.stageUse(state, n), ui, E);
  if (tab === "types") return namedList("types", settings.types, (n) => CS.typeUse(state, n), ui, E);
  if (tab === "pool") return poolTab(state, ui, owners, E);
  if (tab === "follow") return followTab(state, E);
  if (tab === "deal") return dealTab(state);
  if (tab === "activity") return activityTab(state, E);
  if (tab === "followup") return followupTab(state, ui, E);
  if (tab === "blacklist") return blacklistTab(state, E);
  if (tab === "caps") return capsTab(state, owners, E);
  if (tab === "sources") return sourcesTab(state, ui, E);
  if (tab === "dedupe") return dedupeTab(state, ui, E);
  if (tab === "duplicates") return duplicatesTab(state, E);
  return layoutTab(state);
}

// ui：{tab, editing:{kind,key}|null}；owners：所有出现过的跟进人。
function markup(state, ui = {}, escape = identity, owners = []) {
  const E = escape;
  const tab = TABS.some((t) => t.id === ui.tab) ? ui.tab : TABS[0].id;
  const meta = TABS.find((t) => t.id === tab);
  const shortcuts = [
    ["列表字段设置", 'data-action="settings"'], ["客群管理", 'data-action="manage-segments"'], ["标签管理", 'data-action="tag-manager"'],
    ["客户回收站", 'data-lai-screen="trash"'], ["来财设置", 'data-lai-route="settings"'],
    ["恢复默认字段", 'data-action="restore-table-defaults"'],
  ].map(([label, attr]) => `<button type="button" ${attr}>${E(label)}</button>`).join("");
  return `<div class="pagebar"><div class="page-tabs"><h1>客户设置</h1></div></div><section class="cs-shortcuts" aria-label="常用入口">${shortcuts}</section><section class="cs-page">${nav(tab, E)}<div class="cs-panel" data-cs-panel="${tab}"><h2>${E(meta.label)}</h2><p class="cs-note">${E(meta.note)}</p><div class="cs-error error" id="cs-error" role="alert"></div>${body(tab, state, ui, owners, E)}</div></section>`;
}

const api = { TABS, markup, groupForm, ruleForm, tplForm };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.LaiCustomerSettingsUI = api;
})(typeof window !== "undefined" ? window : globalThis);
