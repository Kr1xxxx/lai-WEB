/* 全部订单页面（设计画布 Orders.dc.html 的实现）。
   纯函数：给定订单数据返回 HTML 字符串，不碰 DOM、不发请求，所以能直接用 node 测试。
   所有配色都用这一个订单页（D-029 去掉了小满主题的旧订单表）。
   所有按钮和输入框沿用原来的 data-biz-* 属性和 id，点击、筛选、归档、恢复的处理代码不用改。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiOrdersPage = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const PERIODS = Object.freeze([["", "全部时间"], ["month", "本月"], ["lastMonth", "上月"], ["quarter", "本季度"], ["year", "今年"]]);
  // 完整的时间（带 Z 或时区）按本机日历日算，不按 UTC 日；只有日期的原样使用。
  const day = (value) => {
    const source = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(source)) return source.slice(0, 10);
    const parsed = new Date(source.replace(" ", "T"));
    const pad = (n) => String(n).padStart(2, "0");
    return Number.isNaN(parsed.getTime()) ? source.slice(0, 10) : `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  };
  const num = (value) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (value, code) => `${num(value)} ${code || "USD"}`;

  // 订单日期是否落在所选时间段内；today 是 yyyy-mm-dd。没有日期的订单只在“全部时间”里出现。
  function inPeriod(value, period, today) {
    if (!period) return true;
    const d = day(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const [y, m] = today.split("-").map(Number);
    const [dy, dm] = d.split("-").map(Number);
    if (period === "month") return dy === y && dm === m;
    if (period === "lastMonth") return m === 1 ? dy === y - 1 && dm === 12 : dy === y && dm === m - 1;
    if (period === "quarter") return dy === y && Math.ceil(dm / 3) === Math.ceil(m / 3);
    if (period === "year") return dy === y;
    return true;
  }

  function summary(orders) {
    const real = orders.filter((o) => !o.isDraft);
    return { valid: real.length, drafts: orders.length - real.length, open: real.filter((o) => o.stage !== "done").length };
  }

  const option = (E, value, title, current) => `<option value="${E(value)}"${String(value) === String(current) ? " selected" : ""}>${E(title)}</option>`;

  function row(o, stages, E, can = () => true) {
    const ids = stages.map((s) => s.id);
    const step = ids.indexOf(o.stage) + 1;
    const code = o.currency || "USD";
    const received = ["shipment", "done"].includes(o.stage) ? Number(o.amount || 0) : Number(o.paidAmount || 0);
    const due = Math.max(0, Number(o.amount || 0) - received);
    const label = stages[step - 1]?.label || o.stage || "—";
    const bar = ids.map((_, i) => `<i${i < step ? ' class="on"' : ""}></i>`).join("");
    const ship = [o.carrier, o.trackingNumber].filter(Boolean).join(" ") || "—";
    return `<div class="op-row" role="row" data-order-row="${E(o.id)}">`
      + `<span class="op-num"><button type="button" class="op-link" data-biz-order="${E(o.id)}">${E(o.num || "未编号")}</button>${o.isDraft ? "<em>草稿</em>" : ""}</span>`
      + `<span class="op-client"><button type="button" class="op-link op-plain" data-biz-customer="${E(o.client)}">${E(o.client)}</button><small>${E(o.country || "—")}</small></span>`
      + `<span>${E(o.productType || "—")}</span>`
      + `<span class="op-money op-bold">${E(money(o.amount, code))}</span>`
      + `<span class="op-money">${E(money(received, code))}</span>`
      + `<span class="op-money${due > 0 ? " op-due" : ""}">${E(money(due, code))}</span>`
      + `<span class="op-stage"><b>${E(label)}</b><span class="op-bar" aria-hidden="true">${bar}</span></span>`
      + `<span>${E(day(o.createdAt || o.updated).slice(5) || "—")}</span>`
      + `<span>${E(o.owner || "—")}</span>`
      + `<span class="op-ship"><span>${E(ship)}</span><small>${E(o.next || "—")}</small></span>`
      + `<span class="op-acts"><button type="button" class="op-mini" data-biz-order="${E(o.id)}">${can("order.edit") ? "编辑" : "查看"}</button>${can("order.delete") ? `<button type="button" class="op-mini" data-biz-action="archive-order" data-id="${E(o.id)}">归档</button>` : ""}</span>`
      + `</div>`;
  }

  // 表格里的订单行（没有订单时是空状态）。搜索框打字时只换这一段和下面的合计、页码，不重画整页。
  function rowsMarkup(input, escape) {
    const E = escape || ((s) => String(s));
    const can = typeof input.can === "function" ? input.can : () => true;
    return input.items.map((o) => row(o, input.stages, E, can)).join("")
      || `<div class="op-empty"><strong>没有符合条件的订单</strong><span>${can("order.create") ? "调整筛选条件，或新建一笔订单。" : "调整筛选条件再看。"}</span></div>`;
  }
  // 表格下方：筛选后的订单数和翻页。
  function footMarkup(input) {
    const { total, page, pages } = input;
    return `<div class="op-foot"><span class="op-sub">共 ${total} 笔订单 · 已完成按订单全额计已收款</span><div class="op-pages"><button type="button" class="op-btn" data-biz-action="prev" aria-label="上一页"${page <= 1 ? " disabled" : ""}>‹</button><span class="op-page-now">${page}</span><span class="op-sub">/ ${pages}</span><button type="button" class="op-btn" data-biz-action="next" aria-label="下一页"${page >= pages ? " disabled" : ""}>›</button></div></div>`;
  }

  // input：{ items（当前页的订单）, all（全部订单，用来算汇总）, total（筛选后的订单数）, filters:{search,stage,currency,period}, stages, currencies, page, pages, trash, can }
  // can(key)：当前账号有没有这个权限（角色预览用）；没传时什么都显示。
  function markup(input, escape) {
    const E = escape || ((s) => String(s));
    const { all, filters, stages, currencies, trash } = input;
    const can = typeof input.can === "function" ? input.can : () => true;
    const sum = summary(all);
    const stageLine = stages.map((s) => E(s.label)).join(" → ");
    const rows = rowsMarkup(input, E);
    const trashRows = trash.map((t) => `<div class="op-trash-row"><b>${E(t.num)}</b><span>${E(t.client)}</span><span class="op-money op-bold">${E(money(t.amount, t.currency || "USD"))}</span><span>${E(stages.find((s) => s.id === t.stage)?.label || t.stage || "—")}</span><small>归档时间 ${E(day(t.trashedAt) || "—")}</small>${can("order.edit") ? `<button type="button" class="op-mini op-restore" data-biz-action="restore-order" data-id="${E(t.id)}">恢复订单</button>` : ""}</div>`).join("")
      || '<div class="op-empty op-empty-small"><span>回收站是空的。</span></div>';
    return `<div class="op-page">`
      + `<div class="op-top"><h1>全部订单</h1><span class="op-sub">有效订单 ${sum.valid} 笔 · 草稿 ${sum.drafts} 笔 · 未完成 ${sum.open} 笔</span><div class="op-top-actions">${input.exportable && can("order.export") ? '<button type="button" class="op-btn" data-export-kind="order">导出</button>' : ""}${can("team.view") ? '<button type="button" class="op-btn" data-lai-route="analysis">经营统计</button>' : ""}${can("order.create") ? '<button type="button" class="op-btn op-primary" data-biz-action="new-order"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>新建订单</button>' : ""}</div></div>`
      + `<section class="op-card op-list"><div class="op-filters"><input class="op-input op-search" id="biz-search" type="search" aria-label="搜索订单" placeholder="订单号、客户、物流单号…" value="${E(filters.search)}">`
      + `<select class="op-input" id="biz-stage" aria-label="订单阶段">${option(E, "", "全部阶段", filters.stage)}${stages.map((s) => option(E, s.id, s.label, filters.stage)).join("")}</select>`
      + `<select class="op-input" id="biz-currency" aria-label="订单币种">${option(E, "", "全部币种", filters.currency)}${currencies.map((c) => option(E, c, c, filters.currency)).join("")}</select>`
      + `<select class="op-input" id="biz-period" aria-label="时间">${PERIODS.map(([v, t]) => option(E, v, t, filters.period)).join("")}</select>`
      + `<button type="button" class="op-btn op-ghost" data-biz-action="clear-filters">清除筛选</button><span class="op-sub op-legend">阶段：${stageLine}</span></div>`
      + `<div class="op-scroll" id="biz-order-scroll"><div class="op-table" role="table"><div class="op-head op-grid" role="row"><span>订单编号</span><span>客户名称</span><span>产品</span><span class="op-r">订单金额</span><span class="op-r">已收款</span><span class="op-r">待收款</span><span>订单阶段</span><span>创建日期</span><span>跟进人</span><span>物流 · 下一步</span><span>操作</span></div>${rows}</div></div>`
      + footMarkup(input) + `</section>`
      + `<section class="op-card op-trash"><div class="op-trash-head"><h2>订单回收站</h2><span class="op-sub">${trash.length} 笔 · 已归档订单可恢复 · 不计入统计</span></div>${trashRows}</section>`
      + `</div>`;
  }

  return { PERIODS, inPeriod, summary, markup, rowsMarkup, footMarkup };
});
