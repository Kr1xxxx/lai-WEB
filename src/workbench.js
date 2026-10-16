/* 工作台页面内容（设计画布 Main.dc.html 的实现）。
   纯函数：给定业务数据返回 HTML 字符串，不碰 DOM、不发请求，所以能直接用 node 测试。
   只在新界面（粉色、橙色主题，data-skin="glass"）下使用；小满主题仍用 business-ui.js 里原来的工作台。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiWorkbench = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const SYMBOLS = { USD: "$", CNY: "¥", EUR: "€", GBP: "£", JPY: "¥" };
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  // 目标指标的显示名（与团队数据页一致）。
  const GOAL_LABELS = {
    amount: "成交订单金额", repeat: "复购客户数", newDeal: "成交新客户数", added: "新建客户数", orders: "新建销售订单数",
    records: "跟进记录数", tasksDone: "任务完成数", oppWonAmount: "赢单金额", oppWon: "赢单商机数", oppNew: "新建商机数",
  };
  const GOAL_ORDER = Object.keys(GOAL_LABELS);
  const MONEY_GOALS = new Set(["amount", "oppWonAmount"]);
  const KIND_NAMES = { open: "进行中", won: "赢单", lost: "不计入" };
  const STAGE_COLORS = ["var(--chart-1)", "var(--skin-gold)", "var(--brand-300)", "rgb(var(--skin-ink-rgb))"];

  const day = (value) => String(value || "").slice(0, 10);
  const num = (value) => Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const symbolMoney = (value, code) => (SYMBOLS[code] ? SYMBOLS[code] + num(value) : `${code} ${num(value)}`);
  const daysBetween = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
  const shortDate = (value) => {
    const [, m, d] = day(value).split("-");
    return m && d ? `${Number(m)}月${Number(d)}日` : "未定日期";
  };
  const longToday = (today) => {
    const [y, m, d] = today.split("-").map(Number);
    return `${m}月${d}日 周${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
  };

  function mailTime(value, today) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return local === today ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  // 未读邮件列表：邮件要等接口返回才有，所以单独导出，页面渲染后再填进去。
  function mailRows(items, today, E) {
    return items
      .slice(0, 3)
      .map((item) => {
        const from = item.from ? item.from.name || item.from.address || "未知发件人" : "未知发件人";
        return `<button type="button" class="wb-mail" data-biz-go="mail:unread"><i></i><span><b>${E(from)}</b> · ${E(item.subject || "（无主题）")}</span><em>${E(mailTime(item.date, today))}</em></button>`;
      })
      .join("");
  }

  function markup(input, E) {
    const { state, today, B, OM, TM, bucket, mail } = input;
    // can(key)：当前账号有没有这个权限（角色预览用）；没传时什么都显示。没有查看权限的模块，卡片和数字都不显示。
    const can = typeof input.can === "function" ? input.can : () => true;
    const seeOrders = can("order.view"), seeOpp = can("opp.view"), seeTeam = can("team.view"), seeMail = can("mail.view");
    const orders = state.orders || [];
    const metrics = B.orderMetrics(orders);
    const live = orders.filter((o) => !o.isDraft && o.stage !== "done");
    const shipped = live.filter((o) => o.stage === "shipment").length;
    const tasks = (state.laiTasks || []).filter((t) => !t.done).sort((a, b) => (day(a.date) || "9999").localeCompare(day(b.date) || "9999"));
    const dueToday = tasks.filter((t) => day(t.date) && day(t.date) <= today).length;
    const follow = Object.entries(state.customers || {})
      .filter(([, c]) => bucket(c) !== "trash" && c.nextFollow && day(c.nextFollow) <= today)
      .sort((a, b) => day(a[1].nextFollow).localeCompare(day(b[1].nextFollow)) || a[0].localeCompare(b[0], "zh"));
    const overdue = follow.filter(([, c]) => day(c.nextFollow) < today).length;

    let board = null;
    try {
      board = OM.board(state, {}, today);
    } catch {
      board = null;
    }
    const openColumns = board ? board.columns.filter((c) => c.kind === "open") : [];
    const openCount = openColumns.reduce((n, c) => n + c.count, 0);
    const oppNote = board ? `${board.currency} ${symbolMoney(board.totals.open, board.currency).replace(board.currency + " ", "")}` : "—";

    const unread = mail && Number.isFinite(mail.unread) ? mail.unread : null;
    const pending = mail && Number.isFinite(mail.pending) ? mail.pending : null;

    const stat = (cls, label, value, note, go, extra = "") =>
      `<button type="button" class="wb-stat ${cls}" data-biz-go="${go}"><span>${label}</span><strong class="wb-num"${extra}>${value}</strong><small${extra ? extra.replace("data-wb-mail-count", "data-wb-mail-note") : ""}>${note}</small></button>`;
    const stats = [
      seeOrders && stat("", "有效订单", metrics.count, "全部订单 · 不含草稿", "order-list"),
      seeOrders && stat("wb-gold", "未完成订单", metrics.activeCount, `${shipped} 笔已发货待完成`, "order-list"),
      stat("wb-brand", "待跟进客户", follow.length, `${overdue} 位已逾期`, "customers"),
      stat("", "待办任务", tasks.length, `今天到期 ${dueToday} 项`, "calendar"),
      seeOpp && stat("", "进行中商机", openCount, E(oppNote), "opportunities"),
      seeMail && stat("", "未读邮件", unread === null ? "—" : unread, pending === null ? "收件箱" : `待处理 ${pending} 封`, "mail:unread", ' data-wb-mail-count="1"'),
    ].filter(Boolean).join("");

    // 订单进度：每笔订单 6 格进度条，已到达的阶段点亮。
    const stageIds = B.stages.map((s) => s.id);
    const orderRows = live
      .slice()
      .sort((a, b) => String(b.updated || b.createdAt || "").localeCompare(String(a.updated || a.createdAt || "")))
      .slice(0, 5)
      .map((o) => {
        const step = stageIds.indexOf(o.stage) + 1;
        const label = B.stages[step - 1]?.label || "";
        const bar = stageIds.map((_, i) => `<i${i < step ? ' class="on"' : ""}></i>`).join("");
        return `<button type="button" class="wb-row wb-order" data-biz-order="${E(o.id)}"><span class="wb-who"><b>${E(o.client)}</b><small>${E(o.num || "未编号")} · ${E(o.productType || "—")}</small></span><span class="wb-steps"><span class="wb-bar" aria-hidden="true">${bar}</span><small>${E(label)}（第 ${step} / ${stageIds.length} 步）</small></span><span class="wb-num wb-amount">${E(o.currency || "USD")} ${num(o.amount)}</span><small class="wb-next">下一步：${E(o.next || "未填写")}</small></button>`;
      })
      .join("");
    const orderCard = `<section class="wb-card"><div class="wb-head"><h2>订单进度 <small>未完成订单 ${live.length} 笔</small></h2><button type="button" class="wb-link" data-biz-action="orders">查看全部订单 ›</button></div>${orderRows ? `<div class="wb-scroll"><div class="wb-orders">${orderRows}</div></div>` : '<p class="wb-empty">目前没有未完成的订单。</p>'}<p class="wb-foot">订单阶段：${B.stages.map((s) => s.label).join(" → ")}</p></section>`;

    const moneyRows = metrics.byCurrency
      .map((c) => {
        const pct = c.total > 0 ? Math.floor((c.paid / c.total) * 100) : 0;
        return `<div class="wb-money"><b>${E(c.currency)}</b><span>${c.count} 笔</span><span class="wb-num">${E(symbolMoney(c.total, c.currency))}</span><span class="wb-num wb-paid">${E(symbolMoney(c.paid, c.currency))}</span><span class="wb-num wb-due">${E(symbolMoney(c.due, c.currency))}</span><span class="wb-pct"><span class="wb-track"><i style="width:${pct}%"></i></span><small>${pct}%</small></span></div>`;
      })
      .join("");
    const moneyCard = `<section class="wb-card"><div class="wb-head"><h2>金额概览 <small>按币种分别统计，不折算 · 不含草稿</small></h2>${seeTeam ? '<button type="button" class="wb-link" data-biz-go="analysis">经营统计 ›</button>' : ""}</div>${moneyRows ? `<div class="wb-scroll"><div class="wb-moneys"><div class="wb-money wb-money-head"><span>币种</span><span>订单数</span><span>订单金额</span><span>已收款</span><span>待收款</span><span>已收款占比</span></div>${moneyRows}</div></div>` : '<p class="wb-empty">暂无订单金额。</p>'}<p class="wb-foot">已发货、已完成的订单按全额计入已收款。</p></section>`;

    const tiles = board
      ? board.columns
          .map((c, i) => {
            const color = c.kind === "lost" ? "var(--danger, #b3341f)" : STAGE_COLORS[Math.min(i, STAGE_COLORS.length - 1)];
            return `<div class="wb-tile"><b><i style="background:${color}"></i>${E(c.label)}</b><span class="wb-num">${c.count}<small> 个</small></span><small>${E(symbolMoney(c.amount, board.currency))} · ${KIND_NAMES[c.kind] || ""}</small></div>`;
          })
          .join("")
      : "";
    const oppCard = `<section class="wb-card"><div class="wb-head"><h2>商机阶段 <small>${board ? `${E(board.currency)} · 总销售金额 ${E(symbolMoney(board.totals.total, board.currency))}（不含输单）` : ""}</small></h2><button type="button" class="wb-link" data-biz-go="opportunities">商机看板 ›</button></div>${tiles ? `<div class="wb-tiles">${tiles}</div>` : '<p class="wb-empty">还没有商机。</p>'}</section>`;

    // 待跟进客户（深色卡片）
    const followRows = follow
      .slice(0, 6)
      .map(([name, c]) => {
        const late = daysBetween(day(c.nextFollow), today);
        const when = late > 0 ? `逾期${late}天` : "今天";
        const last = (c.history || []).find((h) => h && h.text && h.type !== "email");
        return `<div class="wb-follow"><span class="wb-num ${late > 0 ? "late" : "today"}">${when}</span><span class="wb-fwho"><button type="button" data-biz-customer="${E(name)}">${E(name)}</button><small>${E(c.owner || "未分配")} · 上次：${E(last ? String(last.text).replace(/\s+/g, " ") : "暂无跟进记录")}</small></span><button type="button" class="wb-write" data-biz-customer="${E(name)}">写跟进</button></div>`;
      })
      .join("");
    const followCard = `<section class="wb-dark"><div class="wb-head"><h2>待跟进客户 <small>截至今天</small></h2><span class="wb-count">${follow.length ? `${follow.length} 位${overdue ? ` · ${overdue} 位已逾期` : ""}` : ""}</span></div>${followRows || '<p class="wb-empty">暂无到期跟进。</p>'}${follow.length > 6 ? `<button type="button" class="wb-more" data-biz-go="customers">还有 ${follow.length - 6} 位，到客户列表查看 ›</button>` : ""}</section>`;

    const taskRows = tasks
      .slice(0, 5)
      .map((t) => {
        const d = day(t.date);
        const label = !d ? "" : d === today ? "今天" : shortDate(d);
        const cls = d && d < today ? "late" : d === today ? "today" : "";
        return `<label class="wb-task"><input type="checkbox" data-biz-task="${E(t.id)}"><span>${E(t.title)}</span><small class="${cls}">${label}</small></label>`;
      })
      .join("");
    const taskCard = `<section class="wb-card"><div class="wb-head"><h2>我的待办 <small>${tasks.length} 项未完成</small></h2><button type="button" class="wb-link" data-biz-action="new-task">添加任务 ›</button></div>${taskRows || '<p class="wb-empty">暂无待办任务。</p>'}</section>`;

    // 本月目标：企业整体目标（团队数据里设置），最多显示 3 条
    let goals = [];
    try {
      const overview = TM.overview(state, today.slice(0, 7));
      for (const metric of GOAL_ORDER)
        for (const g of overview.goals[metric] || []) goals.push({ metric, ...g });
    } catch {
      goals = [];
    }
    const goalColors = ["var(--brand-500)", "var(--chart-2)", "var(--skin-gold)"];
    const goalRows = goals
      .slice(0, 3)
      .map((g, i) => {
        const money = MONEY_GOALS.has(g.metric);
        const name = GOAL_LABELS[g.metric] + (money ? `（${g.currency}）` : "");
        const fmt = (v) => (money ? symbolMoney(v, g.currency) : num(v));
        return `<div class="wb-goal"><div><span>${E(name)}</span><span><b class="wb-num">${E(fmt(g.actual))}</b><small> / ${E(fmt(g.value))}</small></span></div><div class="wb-goalbar"><span class="wb-track"><i style="width:${Math.min(100, g.rate)}%;background:${g.reached ? "var(--skin-gold)" : goalColors[i % goalColors.length]}"></i></span><small>${g.reached ? "已达标" : g.rate + "%"}</small></div></div>`;
      })
      .join("");
    const goalCard = `<section class="wb-card"><div class="wb-head"><h2>本月目标 <small>企业整体</small></h2><button type="button" class="wb-link" data-biz-go="team-goals">目标完成情况 ›</button></div>${goalRows || '<p class="wb-empty">还没有设置本月目标，可以在团队数据里设置。</p>'}</section>`;

    const mailBody = mail && Array.isArray(mail.items) ? mailRows(mail.items, today, E) || '<p class="wb-empty">没有未读邮件。</p>' : '<p class="wb-empty">正在读取邮件…</p>';
    const mailCard = `<section class="wb-card"><div class="wb-head"><h2>未读邮件 <small data-wb-mail-title>${unread === null ? "" : unread + " 封"}</small></h2><button type="button" class="wb-link" data-biz-go="mail:inbox">收件箱 ›</button></div><div data-wb-mails>${mailBody}</div></section>`;

    return `<div class="wb"><div class="wb-top"><h1>工作台</h1><span>查看客户跟进与订单进度 · 截至今天 ${longToday(today)}</span><div><button type="button" data-biz-action="new-task">添加任务</button>${can("opp.create") ? '<button type="button" data-biz-go="opp-new">新建商机</button>' : ""}${can("order.create") ? '<button type="button" class="wb-primary" data-biz-action="new-order">新建订单</button>' : ""}</div></div><section class="wb-stats">${stats}</section><div class="wb-cols"><div class="wb-left">${seeOrders ? orderCard + moneyCard : ""}${seeOpp ? oppCard : ""}</div><div class="wb-right">${followCard}${taskCard}${seeTeam ? goalCard : ""}${seeMail ? mailCard : ""}</div></div></div>`;
  }

  return { markup, mailRows };
});
