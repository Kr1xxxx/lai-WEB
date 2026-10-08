(function (root) {
  "use strict";
  const fields = [
    ["name", "公司名称"],
    ["email", "邮箱"],
    ["tag", "客户标签"],
    ["group", "客户分组"],
    ["alibabaIdentity", "阿里买家身份"],
    ["country", "国家地区"],
    ["source", "客户来源"],
    ["stage", "客户阶段"],
    ["customerStars", "客户星级"],
    ["followed", "是否关注"],
  ];
  function render(o) {
    const {
      rows,
      p,
      filters,
      selected,
      pageSize,
      segments,
      groupTab,
      expanded,
      team,
      icon,
      escape: E,
      countryLabel = (country) => country,
      tableMarkup,
    } = o;
    const option = (v, l, current) =>
      `<option value="${E(v)}" ${v === current ? "selected" : ""}>${E(l)}</option>`;
    const feature = (name, label = name) =>
      `<button type="button" data-feature="${E(name)}">${E(label)}</button>`;
    const group = (id, name, count, indent = false) =>
      `<button class="group-row ${filters.group === id ? "active" : ""} ${indent ? "nested" : ""}" data-group="${E(id)}" title="${E(name)}"><span>${E(name)}</span><small>${count ?? "—"}</small></button>`;
    const branch = (id, name, count, content) => {
      const open = expanded.has(id);
      const heading = id === "won"
        ? `<div class="group-row tree-heading won-tree-heading${filters.group === id ? " active" : ""}"><button type="button" class="tree-toggle" data-expand="${id}" aria-controls="group-branch-${id}" aria-expanded="${open}" aria-label="展开或收起成交客户分层"><i aria-hidden="true">${open ? "▾" : "▸"}</i></button><button type="button" class="won-tree-title" data-group="${id}" data-toggle-branch="${id}" aria-controls="group-branch-${id}" aria-expanded="${open}" title="${E(name)}"><span>${E(name)}</span><small>${count ?? "—"}</small></button></div>`
        : `<button class="group-row tree-heading" data-expand="${id}" aria-controls="group-branch-${id}" aria-expanded="${open}"><i>${open ? "▾" : "▸"}</i><span>${E(name)}</span><small>${count ?? "—"}</small></button>`;
      return `${heading}<div id="group-branch-${id}" class="group-branch-content${open ? " expanded" : ""}" aria-hidden="${!open}"${open ? "" : " inert"}><div>${content}</div></div>`;
    };
    const manual = segments.filter((s) => !s.archived && s.kind === "manual"),
      rules = segments.filter((s) => !s.archived && s.kind === "rules");
    const grouped = manual
      .map((s) =>
        group(
          "segment:" + s.id,
          s.name,
          rows.filter((r) => (s.members || []).includes(r.name)).length,
          true,
        ),
      )
      .join("");
    const countryEntries = [
      ...new Set(rows.map((c) => c.country).filter(Boolean)),
    ].sort();
    const soldCountryCounts = new Map();
    for (const row of rows) {
      if (!(row.orderCount > 0) || !row.country) continue;
      const label = countryLabel(row.country);
      if (!label || label === "—") continue;
      soldCountryCounts.set(label, (soldCountryCounts.get(label) || 0) + 1);
    }
    const soldCountryEntries = [...soldCountryCounts.keys()].sort();
    const groupHeading = groupTab === "ai" ? "" : `<div class="group-title group-list-heading"><strong>客群列表</strong><button class="text-button" data-feature="客群帮助" aria-label="客群帮助">${icon("help")}</button><button class="text-button group-settings" data-action="manage-segments" aria-label="管理客群">${icon("settings")}</button></div>`;
    const groupBody =
      groupTab === "ai"
        ? `<div class="ai-groups"><div class="group-title"><strong>AI 监控客群</strong><button class="text-button" data-feature="AI监控客群帮助" aria-label="AI监控客群帮助">${icon("help")}</button></div>${["重点待跟进", "谈单中客户", "客户资料有更新", "沉睡客户盘活"].map((t) => `<button class="group-row" data-feature="${t}"><span>${t}</span><small>—</small></button>`).join("")}<div class="group-title"><strong>AI 自定义客群</strong><button class="text-button" data-feature="AI自定义客群帮助" aria-label="AI自定义客群帮助">${icon("help")}</button><button class="text-button group-settings" data-feature="新建AI客群" aria-label="新建AI客群">${icon("plus")}</button></div>${["今年累计成交订单金额", "今年累计赢单商机金额", "今年赢单商机金额同比", "今年成交订单金额同比"].map((t) => `<button class="group-row" data-feature="${t}"><span>${t}</span><small>—</small></button>`).join("")}</div>`
        : `${group("all", "全部客户", rows.length)}${branch("won", "❤️成交客户分层", rows.filter((c) => c.orderCount).length, group("won", "成交客户", rows.filter((c) => c.orderCount).length, true) + group("due", "待收款客户", rows.filter((c) => c.due > 0).length, true))}${branch("lapsed", "即将流失客户（超过45天未复购）", o.lapsedCount ?? 0, group("lapsed", "超过45天未复购", o.lapsedCount ?? 0, true))}<button class="group-row tree-heading" data-feature="平均大额商机"><i>▸</i><span>平均大额商机</span><small>—</small></button>${group("followed", "我的关注", rows.filter((c) => c.followed).length)}${branch("manual", "分组", rows.length, grouped + '<button class="text-button new-group" data-action="new-manual">＋ 新建分组</button>')}${branch("new", "未成交客户", rows.filter((c) => !c.orderCount).length, group("new", "全部未成交客户", rows.filter((c) => !c.orderCount).length, true))}${branch("countries", "各国已成交客户", [...soldCountryCounts.values()].reduce((sum, count) => sum + count, 0), soldCountryEntries.map((country) => group("country:" + country, country, soldCountryCounts.get(country), true)).join(""))}${["2022年成交客户", "2022年未成交客户", "阿里静默客户", "2023年未成交客户", "阿里买家身份", "未成交客户公司资料不全", "已成交客户公司资料不全"].map((t) => `<button class="group-row tree-heading" data-feature="${t}"><i>▸</i><span>${t}</span><small>—</small></button>`).join("")}${rules.map((s) => group("segment:" + s.id, s.name, o.ruleCounts?.[s.id] ?? 0)).join("")}<div class="group-extra"><button class="text-button" data-action="new-segment">＋ 新建条件客群</button>${group("followup", "待跟进客户", o.followupCount)}</div>`;
    const current =
      segments.find((s) => filters.group === "segment:" + s.id)?.name ||
      {
        all: "全部客户",
        won: "成交客户",
        new: "未成交客户",
        followed: "我的关注",
        lapsed: "即将流失客户",
        due: "待收款客户",
        followup: "待跟进客户",
      }[filters.group] ||
      (filters.group.startsWith("country:") ? filters.group.slice(8) : "客户列表");
    const active = (value) =>
      value !== undefined && value !== null && String(value).trim() !== "";
    const activeCount = [
      active(filters.query) || (filters.quickCountries || []).length > 0,
      ...[
        "name", "email", "tag", "customerGroup", "alibabaIdentity",
        "country", "owner", "source", "stage", "level", "customerStars",
        "followed",
      ].map((key) => active(filters[key])),
    ].filter(Boolean).length + (o.advancedSpec?.rules?.length || 0);
    const toolbar = selected.size
      ? `<div class="replica-batch"><button data-action="select-all-filtered">跨页全选</button><span>已选 <b>${selected.size}</b> 个</span><button class="text-button" data-action="clear-selection" aria-label="取消选择">×</button><span class="batch-divider"></span>${feature("写邮件")}${feature("一键营销")}<button type="button" data-action="batch-tags">设置标签</button><button type="button" data-action="batch-edit-field">编辑字段</button>${feature("发送WhatsApp")}<button data-action="batch-followup">写跟进</button><button data-action="batch-schedule">新建日程</button><button data-action="add-members">移动至分组</button><button data-action="batch-more">更多 ⌄</button></div>`
      : `<div class="replica-tools"><div class="list-heading"><strong>${E(current)}</strong><span>${p.total.toLocaleString()} 个客户</span>${filters.group.startsWith("segment:") ? `<button class="text-button" data-edit-segment="${E(filters.group.slice(8))}">编辑</button>` : ""}</div><div class="quick-filter"><select data-searchable="inline" id="search-field" aria-label="快捷筛选字段">${fields.map(([v, l]) => option(v, l, filters.field)).join("")}</select><div class="quick-value"><input id="search" aria-label="快捷筛选值" placeholder="${["name", "email", "tag"].includes(filters.field) ? "请输入" : "请选择"}" value="${E(filters.query)}" ${filters.field === "country" ? 'list="country-values"' : ""}><datalist id="country-values">${countryEntries.map((c) => `<option value="${E(c)}">`).join("")}</datalist>${filters.query ? '<button data-action="clear-query" aria-label="清除筛选值">×</button>' : ""}</div><button class="text-button filter-trigger" data-action="filter" aria-label="筛选${activeCount ? `，${activeCount} 个条件` : ""}">${icon("filter")}${activeCount ? `<span class="filter-count" aria-hidden="true">${activeCount}</span>` : ""}</button>${activeCount ? `<span class="active-filters"><span class="filter-count-label">${activeCount} 个筛选条件</span><button class="text-button" data-action="reset-all">清空</button></span>` : ""}<span class="tool-divider"></span><button class="text-button" data-action="table-options" aria-label="表格设置">${icon("settings")}</button></div></div>`;
    const windowStart = p.pageCount <= 5 || p.page <= 3 ? 1 :
      p.page >= p.pageCount - 2 ? p.pageCount - 2 : p.page - 1;
    const windowEnd = p.pageCount <= 5 ? p.pageCount :
      p.page <= 3 ? 3 : p.page >= p.pageCount - 2 ? p.pageCount : p.page + 1;
    const visiblePages = new Set([1, p.pageCount]);
    for (let number = windowStart; number <= windowEnd; number++) visiblePages.add(number);
    const pages = [];
    let previousPage = 0;
    for (const number of [...visiblePages].sort((a, b) => a - b)) {
      if (previousPage && number - previousPage === 2) pages.push(previousPage + 1);
      else if (previousPage && number - previousPage > 2) pages.push(null);
      pages.push(number);
      previousPage = number;
    }
    const emptyMarkup = o.globalSearch?.query?.trim()
      ? `<div class="global-search-empty"><svg viewBox="0 0 88 78" fill="none" aria-hidden="true"><circle cx="40" cy="42" r="34" stroke="var(--ink-400)" stroke-width="1.3"/><circle cx="40" cy="34" r="11" fill="var(--ink-200)"/><path d="M17 62c4-11 12-16 23-16s19 5 23 16c-6 9-15 14-23 14s-17-5-23-14Z" fill="var(--ink-200)"/><circle cx="68" cy="15" r="12" fill="var(--brand-500)" stroke="#fff" stroke-width="2"/><path d="M68 9v12M62 15h12" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg><span>Hi~ 马上添加客户，体验先进的客户管理系统吧</span><div class="global-search-empty-actions"><button type="button" data-action="new">新建客户</button>${o.importEnabled ? '<button type="button" data-action="import-customers">导入客户</button>' : ''}</div></div>`
      : `<div class="empty"><div class="empty-box" aria-hidden="true"><svg viewBox="0 0 72 64" fill="none"><path d="M17 5h41v29H17z" fill="#fff" stroke="var(--ink-400)" stroke-width="1.5"/><path d="M20 18h26" stroke="var(--ink-200)" stroke-width="1.5"/><path d="M8 19h23l7 7h26l-5 31H12L8 19Z" fill="var(--brand-100)"/><path d="M8 19h23l7 7h26" stroke="var(--ink-400)" stroke-width="1.5"/><path d="M11 31h52l-5 26H15l-4-26Z" fill="var(--ink-100)"/><path d="M19 38h25v7H19z" fill="var(--brand-500)"/></svg></div><span>暂无数据</span></div>`;
    return `<div class="pagebar replica-pagebar"><div class="page-tabs"><h1>客户列表</h1><span class="title-divider"></span><div class="owner-switch"><button data-team="mine" class="${team === "mine" ? "active" : ""}">我的客户</button><button data-team="team" class="${team === "team" ? "active" : ""}">团队客户</button></div><select data-searchable="true" id="customer-owner" aria-label="选择部门或业务员">${option("", "选择部门或业务员", filters.owner)}${[...new Set(rows.map((c) => c.owner).filter(Boolean))].map((v) => option(v, v, filters.owner)).join("")}</select></div><div class="page-actions"><button class="text-button" data-feature="WhatsApp" aria-label="WhatsApp">${icon("chat")}</button><button class="text-button" data-feature="客户助手" aria-label="客户助手">${icon("bot")}</button><div class="split-new"><button class="primary" data-action="new">新建客户</button><button class="primary" data-action="create-menu" aria-label="更多新建方式">⌄</button></div></div></div><section class="panel replica-panel ${o.groupsCollapsed ? "groups-collapsed" : ""} without-banner"><aside class="groups"><div class="groups-viewport" aria-hidden="${Boolean(o.groupsCollapsed)}"${o.groupsCollapsed ? " inert" : ""}><div class="groups-content"><div class="group-tabs"><button class="${groupTab === "groups" ? "active" : ""}" data-group-tab="groups">客群</button><button class="${groupTab === "ai" ? "active" : ""}" data-group-tab="ai">AI 客群 <span class="new-badge">新</span></button></div>${groupHeading}<div class="group-scroll">${groupBody}</div></div></div><button class="collapse-groups" data-action="collapse-groups" aria-label="${o.groupsCollapsed ? "展开客群" : "收起客群"}" aria-expanded="${!o.groupsCollapsed}"><span class="collapse-groups-glyph">${o.groupsCollapsed ? "›" : "‹"}</span></button></aside><div class="list-area">${toolbar}<div class="table-wrap">${tableMarkup(p)}${p.total ? "" : emptyMarkup}</div><footer class="pagination"><span>共${p.total}条</span><div class="pages"><button data-action="prev" ${p.page <= 1 ? "disabled" : ""} aria-label="上一页">‹</button>${pages.map((n) => n === null ? '<span aria-hidden="true">…</span>' : `<button data-page="${n}" class="${n === p.page ? "current" : ""}"${n === p.page ? ' aria-current="page"' : ""}>${n}</button>`).join("")}<button data-action="next" ${p.page >= p.pageCount ? "disabled" : ""} aria-label="下一页">›</button><select id="page-size" aria-label="每页条数">${[20, 50, 100].map((n) => option(String(n), n + " 条/页", String(pageSize))).join("")}</select><label class="page-jump">跳至 <input id="page-jump" type="number" min="1" max="${p.pageCount}" aria-label="跳至页码"> 页</label></div></footer></div></section>`;
  }
  function fitPagination(panel) {
    const pagination = panel?.querySelector(".pagination");
    const size = pagination?.querySelector(".pages > .lai-select-trigger");
    const total = pagination?.querySelector(":scope > span");
    if (!size || !total) return;
    // Measure the complete layout first. Reset and collapse in the same task,
    // so a previous narrow state can expand without painting an intermediate state.
    pagination.classList.remove("is-size-collapsed");
    const bounds = pagination.getBoundingClientRect();
    if (!bounds.width) return;
    pagination.classList.toggle(
      "is-size-collapsed",
      total.getBoundingClientRect().left < bounds.left - 0.5,
    );
  }
  let paginationObserver = null;
  function observePagination(panel) {
    paginationObserver?.disconnect();
    paginationObserver = null;
    const pagination = panel?.querySelector(".pagination");
    if (!pagination) return;
    fitPagination(panel);
    paginationObserver = new root.ResizeObserver((_entries, observer) => {
      if (!pagination.isConnected) {
        observer.disconnect();
        // A detached list must never disconnect an observer for a newer list.
        if (paginationObserver === observer) paginationObserver = null;
        return;
      }
      fitPagination(panel);
    });
    paginationObserver.observe(pagination);
  }
  const api = { render, fields, observePagination };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiCustomerList = api;
})(typeof window !== "undefined" ? window : globalThis);
