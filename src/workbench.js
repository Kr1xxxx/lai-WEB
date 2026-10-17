/* 工作台页面内容（所有配色都用这一版，不再分新旧界面）。
   纯函数：给定业务数据返回 HTML 字符串，不碰 DOM、不发请求，所以能直接用 node 测试。
   版面从上到下：问候一行 → 今天先做 + 钱和目标 → 订单走到哪了 → 商机 + 客户来消息。
   用统一组件（src/ui-kit.css，D-028）：页头 .k-pageheader、卡片 .k-card、按钮 .k-btn、状态 .k-badge、空状态 .k-empty；
   这一页自己的排版（网格、行、订单线、进度条）在 business.css 末尾的「kit: 工作台」一节，只用 ui-tokens.css 的变量。
   规则（排序、条数、金额、订单线）记在 VALIDATION.md「工作台」一节。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiWorkbench = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const SYMBOLS = { USD: "$", CNY: "¥", EUR: "€", GBP: "£", JPY: "¥" };
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  // 「今天先做」最多列几行；再多的写「还有 N 件」，处理完上面的会接着显示。
  const QUEUE_LIMIT = 8;
  // 订单线上每个阶段最多画几张订单卡；再多的写「还有 N 笔」。
  const STAGE_CARD_LIMIT = 3;
  // 「客户来消息」列几条。
  const INBOX_LIMIT = 5;
  // 订单卡上「下一步」最多留多少字（卡片里文字一律折行显示、不截断，所以在这里先收短）。
  const NEXT_STEP_CHARS = 36;
  // 排序档位：数字小的在前。逾期 → 等你回复 → 今天到期 → 未读邮件。
  const RANK = Object.freeze({ overdue: 0, waiting: 1, today: 2, mail: 3 });

  // 功能开关：关着的模块（商机、邮件、沟通、团队数据）不画卡片。没有加载功能开关模块时当作都开着。
  const switchOn = (state, module) => {
    let FS = typeof globalThis !== "undefined" ? globalThis.LaiFeatureSwitch : null;
    if (!FS && typeof require === "function") {
      try { FS = require("./feature-switch-model.js"); } catch (_) { FS = null; }
    }
    return !FS || FS.enabled(state, module);
  };
  const day = (value) => String(value || "").slice(0, 10);
  const num = (value) => Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const symbolMoney = (value, code) => (SYMBOLS[code] ? SYMBOLS[code] + num(value) : `${code} ${num(value)}`);
  const daysBetween = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
  const longToday = (today) => {
    const [y, m, d] = today.split("-").map(Number);
    return `${m} 月 ${d} 日 周${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
  };
  const clip = (text, max) => {
    const chars = [...String(text || "").replace(/\s+/g, " ").trim()];
    return chars.length > max ? chars.slice(0, max).join("") + "…" : chars.join("");
  };
  const currencyOf = (order) => String((order && order.currency) || "USD").trim().toUpperCase() || "USD";
  const money = (value, code) => symbolMoney(value, code || "USD");
  // 几个币种各一个数：{USD: 100, EUR: 5} → "USD 100 · EUR 5"（不折算）。
  const moneyMap = (map) => [...map].map(([code, total]) => `${code} ${num(total)}`).join(" · ");

  // 早上好 / 下午好 / 晚上好：按本机小时。0–11 点早上，12–17 点下午，其余晚上。
  function greeting(hour) {
    const h = Number.isFinite(Number(hour)) ? Number(hour) : 9;
    return h < 12 ? "早上好" : h < 18 ? "下午好" : "晚上好";
  }

  // 邮件、聊天时间：今天只写时间，其他写「月日」。value 可以是时间戳字符串或毫秒数。
  function clockOrDate(value, today) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return local === today ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  const mailTime = clockOrDate;

  const mailFrom = (item) => (item && item.from ? item.from.name || item.from.address || "未知发件人" : "未知发件人");

  // ---------- 聊天（WhatsApp）----------
  // 每位看得到的客户一行：最后一条是不是客户发来的（等你回复）、客户最近一条来信。
  // WA 是 whatsapp-ui.js 导出的那组函数（chatEntries、entryLines）；canSee(name, profile) 判断这位客户看不看得到。
  function chatSummaries(state, WA, canSee) {
    if (!WA || typeof WA.chatEntries !== "function" || typeof WA.entryLines !== "function") return [];
    const rows = [];
    for (const [name, profile] of Object.entries((state && state.customers) || {})) {
      if (!profile || typeof profile !== "object") continue;
      if (typeof canSee === "function" && !canSee(name, profile)) continue;
      const entries = WA.chatEntries(profile);
      if (!entries.length) continue;
      const lines = entries.flatMap((entry) => WA.entryLines(entry)).sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
      const last = lines[lines.length - 1];
      if (!last) continue;
      const lastIn = lines.slice().reverse().find((line) => line.dir === "in");
      const lastEntry = entries.slice().sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0))[0] || {};
      const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
      rows.push({
        name,
        contact: clean(lastIn && lastIn.from) || clean(lastEntry.contact) || clean(profile.contact),
        waiting: last.dir === "in",
        lastText: clean(last.text),
        lastAt: last.at || lastEntry.time || "",
        inText: lastIn ? clean(lastIn.text) : "",
        inAt: lastIn ? lastIn.at || "" : "",
        owner: clean(profile.owner),
      });
    }
    return rows.sort((a, b) => (Date.parse(b.lastAt) || 0) - (Date.parse(a.lastAt) || 0) || a.name.localeCompare(b.name, "zh"));
  }

  // ---------- 今天先做 ----------
  // 把三类事合成一条列表，按「逾期 → 等你回复 → 今天到期 → 未读邮件」排。（待办随协同一起去掉了，D-031。）
  //   follow：[[客户名, 客户资料], …]，已经是看得到的、没进回收站的客户
  //   chats：chatSummaries 的结果，只用 waiting 的
  //   mails：邮件列表里的信，没读过的才进来（seen 不是 true）
  //   showOwner：看得到别人的数据时（本部门、全公司），在说明里写负责人
  // 每一行：{kind, rank, tag, tone, title, detail, act:{type, value, label}}；act.type 是 customer｜followup｜chat｜go。
  // followup＝打开客户详情的「动态」，跟进框直接展开、光标在里面（一步就能写）。
  function queue(input) {
    const today = input.today;
    const rows = [];
    const lastNote = (c) => {
      const entry = (c.history || []).find((h) => h && h.text && h.type !== "email");
      return entry ? String(entry.text).replace(/\s+/g, " ").trim() : "暂无跟进记录";
    };
    for (const [name, c] of input.follow || []) {
      const d = day(c.nextFollow);
      if (!d || d > today) continue;
      const late = daysBetween(d, today);
      rows.push({
        kind: "follow", rank: late > 0 ? RANK.overdue : RANK.today, late, sub: 0, t: 0, sortText: name,
        tag: late > 0 ? `逾期 ${late} 天` : "今天到期", tone: late > 0 ? "late" : "today",
        title: `跟进 ${name}`, detail: `${input.showOwner ? (c.owner || "未分配") + " · " : ""}上次：${lastNote(c)}`,
        act: { type: "followup", value: name, label: "写跟进" },
      });
    }
    for (const chat of input.chats || []) {
      if (!chat.waiting) continue;
      rows.push({
        kind: "waiting", rank: RANK.waiting, late: 0, sub: 0, t: -(Date.parse(chat.lastAt) || 0), sortText: chat.name,
        tag: "等你回复", tone: "wait",
        title: `${chat.name} 发来 WhatsApp 消息`,
        detail: [chat.contact, clockOrDate(chat.lastAt, today), chat.lastText ? `“${chat.lastText}”` : ""].filter(Boolean).join(" · "),
        act: { type: "chat", value: chat.name, label: "回复" },
      });
    }
    for (const item of input.mails || []) {
      if (!item || item.seen === true) continue;
      rows.push({
        kind: "mail", rank: RANK.mail, late: 0, sub: 0, t: -(Date.parse(item.date) || 0), sortText: String(item.subject || ""),
        tag: "未读邮件", tone: "mail",
        title: String(item.subject || "（无主题）"),
        detail: [mailFrom(item), clockOrDate(item.date, today)].filter(Boolean).join(" · "),
        act: { type: "go", value: "mail:unread", label: "打开" },
      });
    }
    // 同一档里：逾期天数多的在前，聊天和邮件新的在前，最后按名字。
    rows.sort((a, b) => a.rank - b.rank || b.late - a.late || a.sub - b.sub || a.t - b.t || a.sortText.localeCompare(b.sortText, "zh"));
    const limit = input.limit > 0 ? input.limit : QUEUE_LIMIT;
    return {
      rows,
      shown: rows.slice(0, limit),
      more: Math.max(0, rows.length - limit),
      overdueCustomers: rows.filter((r) => r.kind === "follow" && r.rank === RANK.overdue).length,
    };
  }

  // ---------- 订单走到哪了 ----------
  // 订单线：每个阶段一站。没完成的订单（不含草稿）按阶段放进对应站，每站最多 3 张卡（最近改过的在前），其余写「还有 N 笔」。
  // 已完成站只给笔数和金额。线从第一站画到「有订单的最后一个未完成阶段」。
  function orderLine(orders, stages) {
    const real = (orders || []).filter((o) => o && !o.isDraft);
    const sum = (list) => {
      const by = new Map();
      for (const o of list) {
        const total = Number(o.amount);
        by.set(currencyOf(o), (by.get(currencyOf(o)) || 0) + (Number.isFinite(total) && total > 0 ? total : 0));
      }
      return by;
    };
    const recent = (a, b) => String(b.updated || b.createdAt || "").localeCompare(String(a.updated || a.createdAt || "")) || String(a.id).localeCompare(String(b.id));
    const stations = stages.map((stage, index) => {
      const list = real.filter((o) => o.stage === stage.id);
      const done = stage.id === "done";
      const sorted = list.slice().sort(recent);
      return {
        id: stage.id, label: stage.label, index: index + 1, done, count: list.length, totals: sum(list),
        cards: done ? [] : sorted.slice(0, STAGE_CARD_LIMIT), more: done ? 0 : Math.max(0, list.length - STAGE_CARD_LIMIT),
      };
    });
    let fillTo = -1;
    stations.forEach((s, i) => { if (!s.done && s.count > 0) fillTo = i; });
    const live = real.filter((o) => o.stage !== "done" && stages.some((s) => s.id === o.stage));
    return { stations, fillTo, liveCount: live.length, liveTotals: sum(live), total: real.length };
  }

  // ---------- 钱和目标 ----------
  // 主币种＝订单笔数最多的币种（笔数一样比金额，再按代码）；没有订单时取设置里的默认币种。
  // 本月成交＝团队数据里这个币种的「成交订单金额」，目标＝企业整体的同币种金额目标；已收款、待收款＝金额概览（全部订单，不含草稿）。
  // 其他币种不折算，只说「另有 N 种币种」。
  function moneySummary(input) {
    const { state, today, B, TM, seeOrders, seeTeam } = input;
    const orders = seeOrders ? state.orders || [] : [];
    const metrics = B.orderMetrics(orders);
    // 币种之间不折算，金额大小没法比：主币种按订单笔数排，笔数一样再比金额，再按代码。
    const rows = metrics.byCurrency.slice().sort((a, b) => b.count - a.count || b.total - a.total || a.currency.localeCompare(b.currency));
    let overview = null;
    if (seeTeam) {
      try { overview = TM.overview(state, today.slice(0, 7)); } catch (_) { overview = null; }
    }
    const fallback = String((state.laiSettings && state.laiSettings.defaultCurrency) || "USD").toUpperCase();
    const main = rows[0] ? rows[0].currency : (overview && overview.primaryCurrency) || fallback;
    const mainRow = rows[0] || { currency: main, total: 0, paid: 0, due: 0, count: 0 };
    const dueOrders = orders.filter((o) => !o.isDraft && currencyOf(o) === main && B.orderMetrics([o]).byCurrency[0].due > 0).length;
    const out = {
      currency: main, others: Math.max(0, rows.length - 1),
      collected: mainRow.paid, due: mainRow.due, dueOrders, hasOrders: rows.length > 0,
      collectedPct: mainRow.total > 0 ? Math.floor((mainRow.paid / mainRow.total) * 100) : 0,
      deal: null, bars: [], seeOrders: !!seeOrders, seeTeam: !!seeTeam,
    };
    if (!overview) return out;
    const dealRow = (overview.total.amounts || []).find((x) => x.currency === main);
    const goal = ((overview.goals && overview.goals.amount) || []).find((g) => g.currency === main);
    out.deal = {
      actual: dealRow ? dealRow.total : 0, target: goal ? goal.value : null,
      pct: goal ? goal.rate : null, reached: goal ? goal.reached : false,
    };
    const bar = (metric, label, unit) => {
      const g = ((overview.goals && overview.goals[metric]) || [])[0];
      return { metric, label, unit, actual: g ? g.actual : overview.total[metric] || 0, target: g ? g.value : null, pct: g ? g.rate : null };
    };
    out.bars = [bar("records", "跟进记录", "条"), bar("added", "新建客户", "位")];
    return out;
  }

  // ---------- 客户来消息 ----------
  // 最近几条客户发来的消息：WhatsApp 取每位客户最近一条来信，邮件取收件箱里最近的信；按时间新的在前合在一起。
  // customerByEmail：发件人邮箱 → 客户名（对得上就写客户名）。
  function inbox(input) {
    const items = [];
    for (const chat of input.chats || []) {
      if (!chat.inAt) continue;
      items.push({ ch: "wa", at: Date.parse(chat.inAt) || 0, when: chat.inAt, name: chat.name, who: chat.contact, text: chat.inText, open: { type: "customer", value: chat.name } });
    }
    for (const mail of input.mails || []) {
      if (!mail) continue;
      const address = String((mail.from && mail.from.address) || "").toLowerCase();
      const customer = (input.customerByEmail && address && input.customerByEmail.get(address)) || "";
      const sender = mail.from ? mail.from.name || mail.from.address || "" : "";
      items.push({
        ch: "mail", at: Date.parse(mail.date) || 0, when: mail.date, name: customer || sender || "未知发件人", who: customer ? sender : "",
        text: mail.subject || "（无主题）", open: { type: "go", value: mail.seen === false ? "mail:unread" : "mail:inbox" },
      });
    }
    return items.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name, "zh")).slice(0, input.limit > 0 ? input.limit : INBOX_LIMIT);
  }

  // 发件人邮箱 → 客户名：客户资料里的邮箱和联系人邮箱（不区分大小写）；回收站里的客户不算。
  function emailIndex(state, bucket) {
    const map = new Map();
    for (const [name, c] of Object.entries((state && state.customers) || {})) {
      if (!c || typeof c !== "object" || (typeof bucket === "function" && bucket(c) === "trash")) continue;
      const add = (value) => {
        const v = String(value || "").trim().toLowerCase();
        if (v && !map.has(v)) map.set(v, name);
      };
      add(c.email);
      for (const contact of Array.isArray(c.contacts) ? c.contacts : []) add(contact && contact.email);
    }
    return map;
  }

  // ---------- 页面 ----------
  const attrOf = (act, E) =>
    act.type === "customer" ? `data-biz-customer="${E(act.value)}"`
      : act.type === "followup" ? `data-biz-customer="${E(act.value)}" data-biz-followup`
      : act.type === "chat" ? `data-biz-chat="${E(act.value)}"`
        : `data-biz-go="${E(act.value)}"`;

  // 每张卡片的头：标题、一句说明、右边一个去处（.k-card-head）。
  const cardHead = (id, title, desc, link) =>
    `<div class="k-card-head wb-ph"><h2 class="k-card-title" id="${id}">${title}</h2>${desc ? `<span class="k-card-desc">${desc}</span>` : ""}${link || ""}</div>`;
  // 卡片头右边的去处：小号的透明按钮。
  const goLink = (attr, label) => `<button type="button" class="k-btn k-btn--ghost k-btn--sm wb-link" ${attr}>${label}</button>`;
  // 「今天先做」每行的状态：逾期红、今天到期黄；等你回复、未读邮件只是分类，用灰色。
  const TAG_TONES = Object.freeze({ late: "danger", today: "warning", wait: "neutral", mail: "neutral" });

  function greetingMarkup(input, E, ctx) {
    const { today, can, state } = input;
    const hour = input.hour !== undefined ? input.hour : input.now ? input.now.getHours() : 9;
    const parts = [ctx.todoCount > 0 ? `今天有 <b class="wb-num">${ctx.todoCount}</b> 件事要处理` : "今天没有要紧事"];
    if (ctx.overdue > 0) parts.push(`<b class="wb-num">${ctx.overdue}</b> 位客户跟进逾期`);
    if (ctx.money && ctx.money.seeOrders && ctx.money.due > 0) {
      parts.push(`还有 <b class="wb-num">${E(money(ctx.money.due, ctx.money.currency))}</b>${ctx.money.others ? `（另有 ${ctx.money.others} 种币种）` : ""} 没收回来`);
    }
    const name = input.me ? `，${E(input.me)}` : "";
    const actions = (can("opp.create") && switchOn(state, "opp") ? '<button type="button" class="k-btn" data-biz-go="opp-new">新建商机</button>' : "")
      + (can("order.create") ? '<button type="button" class="k-btn k-btn--primary" data-biz-action="new-order">新建订单</button>' : "");
    return `<header class="k-pageheader wb-hello" data-wb="summary"><div class="k-pageheader-text"><h1 class="k-pageheader-title">${greeting(hour)}${name}</h1><p class="wb-sum"><span class="wb-date">${E(longToday(today))}</span>${parts.join("，")}</p></div><div class="k-pageheader-actions wb-acts">${actions}</div></header>`;
  }

  function queueMarkup(q, E, mailPending) {
    const rows = q.shown
      .map((r) => {
        return `<div class="wb-row wb-q wb-${r.tone}"><span class="k-badge k-badge--${TAG_TONES[r.tone] || "neutral"} wb-tag">${E(r.tag)}</span><span class="wb-who"><b><span class="wb-t">${E(r.title)}</span></b>${r.detail ? `<small class="wb-next">${E(r.detail)}</small>` : ""}</span><button type="button" class="k-btn k-btn--sm wb-act" ${attrOf(r.act, E)}>${E(r.act.label)}</button></div>`;
      })
      .join("");
    const empty = `<div class="k-empty"><p class="k-empty-title">今天没有要紧事</p><span>${mailPending ? "邮件还在读取…" : "逾期和今天到期的跟进、等你回复的聊天、未读邮件会出现在这里"}</span></div>`;
    const tail = q.more > 0 ? `<p class="wb-foot">还有 ${q.more} 件没列出，处理完上面的会接着显示</p>` : "";
    return `<section class="k-card wb-panel wb-queue" data-wb="queue" aria-labelledby="wb-h-queue">${cardHead("wb-h-queue", "今天先做", "逾期的排在最前")}${rows ? `<div class="wb-list">${rows}</div>${tail}` : empty}</section>`;
  }

  function moneyMarkup(m, E) {
    const pct = (value) => Math.max(0, Math.min(100, value));
    const head = cardHead("wb-h-money", "钱和目标", `${E(m.currency)}，不含草稿`, m.seeTeam ? goLink('data-biz-go="analysis"', "经营统计 ›") : "");
    let deal = "";
    if (m.deal) {
      const d = m.deal;
      const goal = d.target === null
        ? '<span class="wb-sub">本月还没设目标</span>'
        : `<span class="wb-sub">/ 目标 ${E(money(d.target, m.currency))}</span>`;
      deal = `<div class="wb-meter"><div class="wb-meter-top"><span>本月成交</span>${d.target === null ? "" : `<span class="k-badge k-badge--${d.reached ? "success" : "neutral"} wb-pct wb-num">${d.reached ? "已达标" : d.pct + "%"}</span>`}</div><div class="wb-big wb-num">${E(money(d.actual, m.currency))} ${goal}</div>${d.target === null ? "" : `<div class="wb-bar" role="img" aria-label="本月成交完成 ${d.pct}%"><i style="width:${pct(d.pct)}%"></i></div>`}</div>`;
    }
    let paid = "";
    if (m.seeOrders) {
      const tail = m.others
        ? `<p class="wb-note">另有 ${m.others} 种币种，各币种分别统计、不折算${m.seeTeam ? goLink('data-biz-go="analysis"', "到经营统计看 ›") : ""}</p>`
        : "";
      paid = m.hasOrders
        ? `<div class="wb-split"><div><b class="wb-num">${E(money(m.collected, m.currency))}</b><span>已收款（${m.collectedPct}%）</span></div><div><b class="wb-num">${E(money(m.due, m.currency))}</b><span>待收款，${m.dueOrders} 笔订单</span></div></div>${tail}`
        : '<div class="k-empty"><span>还没有订单，收款情况会出现在这里。</span></div>';
    }
    const bars = m.bars
      .map((b) => `<div class="wb-mini"><span>${E(b.label)}</span><div class="wb-bar"${b.target === null ? "" : ` role="img" aria-label="${E(b.label)}完成 ${b.pct}%"`}><i style="width:${b.target === null ? 0 : pct(b.pct)}%"></i></div><em class="wb-num">${b.target === null ? `${num(b.actual)} ${E(b.unit)}（没设目标）` : `${num(b.actual)} / ${num(b.target)}`}</em></div>`)
      .join("");
    return `<section class="k-card wb-panel wb-moneyp" aria-labelledby="wb-h-money">${head}<div class="wb-body">${deal}${paid}${bars ? `<div class="wb-minis">${bars}</div>` : ""}</div></section>`;
  }

  function lineMarkup(line, E) {
    const stations = line.stations
      .map((s, i) => {
        const cls = ["wb-stn", s.count > 0 ? "has" : "", s.done && s.count > 0 ? "fin" : "", i > 0 && i <= line.fillTo ? "fl" : "", i < line.fillTo ? "fr" : ""].filter(Boolean).join(" ");
        const dot = s.done && s.count > 0 ? "✓" : String(s.index);
        const cards = s.cards
          .map((o) => {
            const next = clip(o.next, NEXT_STEP_CHARS);
            return `<button type="button" class="wb-ocard" data-biz-order="${E(o.id)}"><b>${E(o.client || "未填客户")}</b><span class="wb-amt wb-num">${E(money(o.amount, currencyOf(o)))}</span><small>${next ? E(next) : "还没写下一步"}</small></button>`;
          })
          .join("");
        const more = s.more > 0 ? `<button type="button" class="k-btn k-btn--ghost k-btn--sm wb-omore" data-biz-stage="${E(s.id)}">还有 ${s.more} 笔 ›</button>` : "";
        const finished = s.done ? (s.count ? `<p class="wb-doneSum">已完成 ${s.count} 笔，${E(moneyMap(s.totals))}</p>` : "") : "";
        return `<li class="${cls}" data-stage="${E(s.id)}"><span class="wb-dot wb-num" aria-hidden="true">${dot}</span><h3>${E(s.label)} <span class="wb-num">${s.count}</span></h3>${cards || more || finished ? `<div class="wb-ocards">${cards}${more}${finished}</div>` : ""}</li>`;
      })
      .join("");
    const sub = line.liveCount ? `${line.liveCount} 笔未完成，共 ${E(moneyMap(line.liveTotals))}` : "没有未完成的订单";
    const body = line.total
      ? `<div class="wb-linescroll"><ol class="wb-track">${stations}</ol></div>`
      : '<div class="k-empty"><span>还没有订单。新建订单后，每一笔会按阶段排在这条线上。</span></div>';
    return `<section class="k-card wb-panel wb-orders" aria-labelledby="wb-h-orders">${cardHead("wb-h-orders", "订单走到哪了", sub, goLink('data-biz-action="orders"', "全部订单 ›"))}${body}</section>`;
  }

  function oppMarkup(board, E) {
    const link = goLink('data-biz-go="opportunities"', "商机看板 ›");
    const none = '<div class="k-empty"><span>还没有商机。</span></div>';
    if (!board) return `<section class="k-card wb-panel wb-opp" aria-labelledby="wb-h-opp">${cardHead("wb-h-opp", "商机", "", link)}${none}</section>`;
    const max = Math.max(0, ...board.columns.map((c) => c.amount));
    const rows = board.columns
      .map((c) => {
        const width = max > 0 ? Math.max(c.count > 0 ? 3 : 0, Math.round((c.amount / max) * 100)) : c.count > 0 ? 3 : 0;
        return `<div class="wb-fr ${c.kind === "won" ? "won" : c.kind === "lost" ? "lost" : ""}"><span class="wb-fl">${E(c.label)}</span><div class="wb-bar"><i style="width:${width}%"></i></div><em class="wb-num">${c.count} 个</em><em class="wb-num">${E(money(c.amount, board.currency))}</em></div>`;
      })
      .join("");
    const other = board.otherCurrencyCount > 0 ? `，另有 ${board.otherCurrencyCount} 个其他币种的商机` : "";
    return `<section class="k-card wb-panel wb-opp" aria-labelledby="wb-h-opp">${cardHead("wb-h-opp", "商机", `${board.count} 个 · ${E(money(board.totals.total, board.currency))}（不含输单）`, link)}${board.count ? `<div class="wb-fun">${rows}<p class="wb-note">条的长短按金额画；绿色是已赢单${E(other)}</p></div>` : none}</section>`;
  }

  function messagesMarkup(feed, E, today) {
    const rows = feed.items
      .map((m) => {
        const badge = m.ch === "wa" ? '<span class="k-badge wb-ch wa" aria-label="WhatsApp">WA</span>' : '<span class="k-badge wb-ch ml" aria-label="邮件">邮件</span>';
        const title = m.who ? `${E(m.name)} · ${E(m.who)}` : E(m.name);
        return `<button type="button" class="wb-row wb-m" ${attrOf(m.open, E)}>${badge}<span class="wb-who"><b class="wb-t">${title}</b><small class="wb-next">${E(clip(m.text, 120))}</small></span><time class="wb-num">${E(clockOrDate(m.when, today))}</time></button>`;
      })
      .join("");
    const say = (text) => `<div class="k-empty"><span>${text}</span></div>`;
    const note = feed.mailPending && !rows ? say("正在读取邮件…") : feed.mailError && !rows ? say("暂时读不到邮件：请先在邮件页绑定邮箱。") : "";
    const tail = feed.mailError && rows ? '<p class="wb-foot">邮件暂时读不到，只列了 WhatsApp。</p>' : "";
    const sources = [feed.seeChat ? "WhatsApp" : "", feed.seeMail ? "邮件" : ""].filter(Boolean).join(" 和 ");
    const go = feed.seeMail ? "mail:inbox" : "";
    return `<section class="k-card wb-panel wb-msgs" data-wb="messages" aria-labelledby="wb-h-msgs">${cardHead("wb-h-msgs", "客户来消息", E(sources), go ? goLink(`data-biz-go="${go}"`, "收件箱 ›") : "")}${rows ? `<div class="wb-list">${rows}</div>${tail}` : note || say("最近没有客户来消息。")}</section>`;
  }

  // input：{ state, today, now?, hour?, me, can, showOwner, B, OM, TM, bucket, mail, WA, canSeeChat }
  //   mail：null（还没读到）｜{unread, pending, items?}｜{error:true}；items 是收件箱里最近的信（带 seen）
  function markup(input, E) {
    const { state, today, B, OM, TM, bucket, mail } = input;
    // can(key)：当前账号有没有这个权限（角色预览用）；没传时什么都显示。没有查看权限的模块，卡片和数字都不显示。
    const can = typeof input.can === "function" ? input.can : () => true;
    const view = { ...input, can };
    const seeOrders = can("order.view"), seeOpp = can("opp.view") && switchOn(state, "opp"), seeTeam = can("team.view") && switchOn(state, "team");
    const seeMail = can("mail.view") && switchOn(state, "mail"), seeChat = can("chat.view") && switchOn(state, "chat");
    const mailItems = seeMail && mail && Array.isArray(mail.items) ? mail.items : [];
    const mailPending = seeMail && !mail;
    const mailError = seeMail && !!(mail && mail.error);

    const follow = Object.entries(state.customers || {}).filter(([, c]) => c && bucket(c) !== "trash" && c.nextFollow);
    const chats = seeChat ? chatSummaries(state, input.WA, input.canSeeChat || ((name, c) => bucket(c) !== "trash")) : [];
    const q = queue({
      today, follow, showOwner: !!input.showOwner,
      chats, mails: mailItems,
    });
    const cash = moneySummary({ state, today, B, TM, seeOrders, seeTeam });
    const showMoney = seeOrders || seeTeam;
    const ctx = { todoCount: q.rows.length, overdue: q.overdueCustomers, money: cash };

    let line = "";
    if (seeOrders) line = lineMarkup(orderLine(state.orders || [], B.stages), E);

    let board = null;
    if (seeOpp) {
      try { board = OM.board(state, {}, today); } catch (_) { board = null; }
    }

    const feed = { items: [], seeChat, seeMail, mailPending, mailError };
    if (seeChat || seeMail) {
      feed.items = inbox({ chats: seeChat ? chats : [], mails: mailItems, customerByEmail: emailIndex(state, bucket) });
    }
    const top = `<div class="wb-grid1">${queueMarkup(q, E, mailPending)}${showMoney ? moneyMarkup(cash, E) : ""}</div>`;
    const bottomParts = [seeOpp ? oppMarkup(board, E) : "", seeChat || seeMail ? messagesMarkup(feed, E, today) : ""].filter(Boolean);
    const bottom = bottomParts.length ? `<div class="wb-grid2${bottomParts.length === 1 ? " wb-one" : ""}">${bottomParts.join("")}</div>` : "";
    return `<div class="wb">${greetingMarkup(view, E, ctx)}${top}${line}${bottom}</div>`;
  }

  return {
    markup, greeting, queue, orderLine, moneySummary, inbox, chatSummaries, emailIndex, clockOrDate,
    QUEUE_LIMIT, STAGE_CARD_LIMIT, INBOX_LIMIT, RANK,
  };
});
