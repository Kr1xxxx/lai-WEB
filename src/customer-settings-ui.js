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
  { id: "blacklist", label: "建档黑名单", note: "黑名单里的邮箱不能用来新建客户、批量建档、导入，也不能加到客户的联系人上。" },
  { id: "caps", label: "客户上限", note: "限制每位跟进人名下最多有多少位客户（不含公海和回收站）。新建、重新分配、导入、从公海领回都会检查。" },
  { id: "duplicates", label: "客户查重", note: "选择“客户查重”页里，每位疑似重复的客户后面显示哪些资料，方便核对该留哪个。" },
  { id: "layout", label: "布局设置", note: "客户详情页左右两栏哪边宽。" },
]);

function nav(tab, E) {
  return `<nav class="cs-nav" aria-label="客户设置">${TABS.map((t) => `<button type="button" data-cs-tab="${t.id}" class="${t.id === tab ? "active" : ""}"${t.id === tab ? ' aria-current="page"' : ""}>${E(t.label)}</button>`).join("")}</nav>`;
}
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

function layoutTab(state) {
  const layout = CS.get(state).layout;
  const card = (id, title, small) => `<button type="button" class="cs-layout-card${layout === id ? " active" : ""}" data-cs-layout="${id}" aria-pressed="${layout === id}"><span class="cs-layout-pic ${small ? "small-left" : "large-left"}" aria-hidden="true"><i></i><i></i></span><strong>${title}</strong></button>`;
  return `<div class="cs-layouts">${card("left-small", "左小右大", true)}${card("left-large", "左大右小", false)}</div><p class="cs-hint">选中后马上生效，客户详情页下次打开就是这个布局。</p>`;
}

function body(tab, state, ui, owners, E) {
  const settings = CS.get(state);
  if (tab === "groups") return groupsTab(state, ui, E);
  if (tab === "stages") return namedList("stages", settings.stages, (n) => CS.stageUse(state, n), ui, E);
  if (tab === "types") return namedList("types", settings.types, (n) => CS.typeUse(state, n), ui, E);
  if (tab === "blacklist") return blacklistTab(state, E);
  if (tab === "caps") return capsTab(state, owners, E);
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
    ["公海规则", 'data-action="pool-rules"'], ["客户回收站", 'data-lai-screen="trash"'], ["来财设置", 'data-lai-route="settings"'],
    ["恢复默认字段", 'data-action="restore-table-defaults"'],
  ].map(([label, attr]) => `<button type="button" ${attr}>${E(label)}</button>`).join("");
  return `<div class="pagebar"><div class="page-tabs"><h1>客户设置</h1></div></div><section class="cs-shortcuts" aria-label="常用入口">${shortcuts}</section><section class="cs-page">${nav(tab, E)}<div class="cs-panel" data-cs-panel="${tab}"><h2>${E(meta.label)}</h2><p class="cs-note">${E(meta.note)}</p><div class="cs-error error" id="cs-error" role="alert"></div>${body(tab, state, ui, owners, E)}</div></section>`;
}

const api = { TABS, markup, groupForm };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.LaiCustomerSettingsUI = api;
})(typeof window !== "undefined" ? window : globalThis);
