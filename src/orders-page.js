/* 全部订单页面，用统一组件（src/ui-kit.css，D-028）：页头 .k-pageheader、表格 .k-table、阶段徽标 .k-badge、翻页 .k-pager、空状态 .k-empty。
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

  // 订单阶段用徽标表示：报价、定金、生产中是中性灰，尾款提醒收钱（黄），已发货是主色，已完成是绿色。
  const STAGE_TONES = Object.freeze({ balance: "warning", shipment: "primary", done: "success" });
  const stageBadge = (E, id, label) => `<span class="k-badge k-badge--${STAGE_TONES[id] || "neutral"}">${E(label)}</span>`;
  const COLUMNS = 11;

  function row(o, stages, E, can = () => true) {
    const code = o.currency || "USD";
    const received = ["shipment", "done"].includes(o.stage) ? Number(o.amount || 0) : Number(o.paidAmount || 0);
    const due = Math.max(0, Number(o.amount || 0) - received);
    const label = stages.find((s) => s.id === o.stage)?.label || o.stage || "—";
    const ship = [o.carrier, o.trackingNumber].filter(Boolean).join(" ") || "—";
    return `<tr class="op-row" data-order-row="${E(o.id)}">`
      + `<td class="op-num"><button type="button" class="op-link" data-biz-order="${E(o.id)}">${E(o.num || "未编号")}</button>${o.isDraft ? '<span class="k-badge k-badge--neutral">草稿</span>' : ""}</td>`
      + `<td class="op-client"><button type="button" class="op-link" data-biz-customer="${E(o.client)}">${E(o.client)}</button><small>${E(o.country || "—")}</small></td>`
      + `<td><span class="op-cell op-clamp">${E(o.productType || "—")}</span></td>`
      + `<td class="k-num op-strong">${E(money(o.amount, code))}</td>`
      + `<td class="k-num">${E(money(received, code))}</td>`
      + `<td class="k-num${due > 0 ? " op-due" : ""}">${E(money(due, code))}</td>`
      + `<td>${stageBadge(E, o.stage, label)}</td>`
      + `<td class="op-date">${E(day(o.createdAt || o.updated).slice(5) || "—")}</td>`
      + `<td><span class="op-cell">${E(o.owner || "—")}</span></td>`
      + `<td class="op-ship"><span>${E(ship)}</span><small>${E(o.next || "—")}</small></td>`
      + `<td class="op-acts"><button type="button" class="k-btn k-btn--ghost k-btn--sm" data-biz-order="${E(o.id)}">${can("order.edit") ? "编辑" : "查看"}</button>${can("order.delete") ? `<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-biz-action="archive-order" data-id="${E(o.id)}">归档</button>` : ""}</td>`
      + `</tr>`;
  }

  // 表格里的订单行（没有订单时是空状态）。搜索框打字时只换这一段和下面的合计、页码，不重画整页。
  function rowsMarkup(input, escape) {
    const E = escape || ((s) => String(s));
    const can = typeof input.can === "function" ? input.can : () => true;
    return input.items.map((o) => row(o, input.stages, E, can)).join("")
      || `<tr class="op-none"><td colspan="${COLUMNS}"><div class="k-empty"><p class="k-empty-title">没有符合条件的订单</p><span>${can("order.create") ? "调整筛选条件，或新建一笔订单。" : "调整筛选条件再看。"}</span></div></td></tr>`;
  }
  // 表格下方：筛选后的订单数和翻页。
  function footMarkup(input) {
    const { total, page, pages } = input;
    return `<div class="op-foot"><span class="op-total">共 ${total} 笔订单 · 已完成按订单全额计已收款</span><nav class="k-pager" aria-label="翻页"><button type="button" data-biz-action="prev" aria-label="上一页"${page <= 1 ? " disabled" : ""}>‹</button><button type="button" aria-current="page" aria-label="第 ${page} 页">${page}</button><span>/ ${pages}</span><button type="button" data-biz-action="next" aria-label="下一页"${page >= pages ? " disabled" : ""}>›</button></nav></div>`;
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
    const trashRows = trash.map((t) => `<tr class="op-trash-row"><td class="op-strong">${E(t.num)}</td><td><span class="op-cell">${E(t.client)}</span></td><td class="k-num">${E(money(t.amount, t.currency || "USD"))}</td><td>${stageBadge(E, t.stage, stages.find((s) => s.id === t.stage)?.label || t.stage || "—")}</td><td class="op-date">归档时间 ${E(day(t.trashedAt) || "—")}</td><td class="op-acts">${can("order.edit") ? `<button type="button" class="k-btn k-btn--sm" data-biz-action="restore-order" data-id="${E(t.id)}">恢复订单</button>` : ""}</td></tr>`).join("");
    const trashBody = trashRows ? `<div class="op-scroll"><table class="k-table op-trash-table"><tbody>${trashRows}</tbody></table></div>` : '<div class="k-empty"><span>回收站是空的。</span></div>';
    const plus = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    return `<div class="op-page">`
      + `<header class="k-pageheader"><div class="k-pageheader-text"><h1 class="k-pageheader-title">全部订单</h1><span class="k-pageheader-desc">有效订单 ${sum.valid} 笔 · 草稿 ${sum.drafts} 笔 · 未完成 ${sum.open} 笔</span></div><div class="k-pageheader-actions">${input.exportable && can("order.export") ? '<button type="button" class="k-btn" data-export-kind="order">导出</button>' : ""}${can("team.view") ? '<button type="button" class="k-btn" data-lai-route="analysis">经营统计</button>' : ""}${can("order.create") ? `<button type="button" class="k-btn k-btn--primary" data-biz-action="new-order">${plus}新建订单</button>` : ""}</div></header>`
      + `<section class="k-card op-list"><div class="op-filters"><input class="k-input op-search" id="biz-search" type="search" aria-label="搜索订单" placeholder="订单号、客户、物流单号…" value="${E(filters.search)}">`
      + `<select class="k-select-trigger op-filter" id="biz-stage" aria-label="订单阶段">${option(E, "", "全部阶段", filters.stage)}${stages.map((s) => option(E, s.id, s.label, filters.stage)).join("")}</select>`
      + `<select class="k-select-trigger op-filter" id="biz-currency" aria-label="订单币种">${option(E, "", "全部币种", filters.currency)}${currencies.map((c) => option(E, c, c, filters.currency)).join("")}</select>`
      + `<select class="k-select-trigger op-filter" id="biz-period" aria-label="时间">${PERIODS.map(([v, t]) => option(E, v, t, filters.period)).join("")}</select>`
      + `<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-biz-action="clear-filters">清除筛选</button><span class="op-legend">阶段：${stageLine}</span></div>`
      + `<div class="op-scroll" id="biz-order-scroll"><table class="k-table op-table"><thead><tr><th>订单编号</th><th>客户名称</th><th>产品</th><th class="k-num">订单金额</th><th class="k-num">已收款</th><th class="k-num">待收款</th><th>订单阶段</th><th>创建日期</th><th>跟进人</th><th>物流 · 下一步</th><th class="op-acts">操作</th></tr></thead><tbody>${rows}</tbody></table></div>`
      + footMarkup(input) + `</section>`
      + `<section class="k-card op-trash"><div class="k-card-head"><h2 class="k-card-title">订单回收站</h2><span class="k-card-desc">${trash.length} 笔 · 已归档订单可恢复 · 不计入统计</span></div>${trashBody}</section>`
      + `</div>`;
  }

  return { PERIODS, inPeriod, summary, markup, rowsMarkup, footMarkup };
});
