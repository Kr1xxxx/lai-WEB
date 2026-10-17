(function (root) {
  "use strict";
  // 沟通 › WhatsApp 页面（D-023）：聊天记录、导入聊天记录、打开 WhatsApp 的对话框、聊天模板，以及客户动态里的聊天条目。
  // 来财自己不收发消息：这里只做点开聊天链接、手动记一笔、导入手机导出的聊天文件。
  //
  // create(ctx) 需要的 ctx（由 app.js 接线时提供；模型函数一律经 ctx.model 调用，测试里可以替换）：
  //   getState()              当前业务数据（customers、laiChatImports、laiSettings.whatsapp ...）
  //   persist(nextState)      保存新数据，返回 Promise；失败时抛错
  //   can(perm)               权限：chat.view / chat.send / chat.import / chat.template
  //   canSeeCustomer(name)    这个账号能不能看到这位客户（本人客户范围、公海）
  //   meName()                当前成员姓名
  //   openCustomer(name)      打开客户详情
  //   toast(msg)              提示
  //   escape(text)            HTML 转义
  //   model                   window.LaiWhatsAppModel（toE164、waLink、renderTemplate、parseExport、readZip、
  //                           buildEntries、mergeImport、undoImport、logChat、matchCustomers）
  //   mount(html)             把页面放进主区域
  //   openExternal(url)       用系统浏览器打开链接（只传 https）
  //   dialog(title, body, footer, type)  抽屉（和邮件页一样），closeDialog()  关闭抽屉
  //   可选：icon(name)、isActive()（页面是否还在显示）、isTrial（网页试用版）、copy(text)（复制到剪贴板）、
  //         now()（测试用）
  // 模型约定：undoImport、logChat 可以返回新数据本身，也可以返回 {state}；matchCustomers 的第三个参数传可见客户名的数组。
  // 页面上的按钮都带 data-chat-action，由 app.js 转给 controller.action(name, pointer, element)。
  const LIMITS = Object.freeze({ groups: 30, items: 100, chars: 500, groupName: 30 });
  const VARIABLES = Object.freeze(["姓名", "公司", "我的名字", "国家"]);
  const TRIAL_BYTES = 300 * 1024;
  const MAX_BYTES = 3 * 1024 * 1024;
  const MAX_SHOWN_LINES = 600;
  const CANCEL = `<button type="button" data-action="close-modal">取消</button>`;
  const EMPTY_TEXT = "还没有聊天记录。可以从手机导出 WhatsApp 聊天后导入，或在客户资料里点 WhatsApp 发起聊天。";
  const TRIAL_NOTE = "试用版只用示例聊天，不要导入真实客户聊天";
  const FILTERS = [
    { id: "all", label: "全部" },
    { id: "waiting", label: "等你回复" },
    { id: "mine", label: "我的客户" },
  ];
  const COUNTRY_CODES = [
    ["+86", "中国"], ["+852", "中国香港"], ["+886", "中国台湾"], ["+1", "美国／加拿大"], ["+44", "英国"], ["+49", "德国"],
    ["+33", "法国"], ["+39", "意大利"], ["+34", "西班牙"], ["+31", "荷兰"], ["+7", "俄罗斯"], ["+91", "印度"],
    ["+81", "日本"], ["+82", "韩国"], ["+61", "澳大利亚"], ["+55", "巴西"], ["+52", "墨西哥"], ["+90", "土耳其"],
    ["+971", "阿联酋"], ["+966", "沙特阿拉伯"], ["+62", "印度尼西亚"], ["+84", "越南"], ["+66", "泰国"], ["+60", "马来西亚"],
    ["+65", "新加坡"], ["+63", "菲律宾"], ["+20", "埃及"], ["+234", "尼日利亚"], ["+27", "南非"], ["+92", "巴基斯坦"],
  ];

  // ---- 小工具 ----
  const pad = (n) => String(n).padStart(2, "0");
  const asDate = (value) => {
    const d = value instanceof Date ? value : new Date(value || "");
    return Number.isFinite(d.getTime()) ? d : null;
  };
  const dayKey = (value) => {
    const d = asDate(value);
    return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
  };
  const clock = (value) => {
    const d = asDate(value);
    return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
  };
  const fullTime = (value) => {
    const d = asDate(value);
    return d ? `${dayKey(d)} ${clock(d)}` : "—";
  };
  const shortTime = (value, today = new Date()) => {
    const d = asDate(value);
    if (!d) return "";
    if (d.toDateString() === today.toDateString()) return clock(d);
    if (d.getFullYear() === today.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return dayKey(d);
  };
  const text = (value) => String(value ?? "");
  const plain = (value) => text(value).trim();
  const lineHtml = (E, value) => E(text(value)).replace(/\r?\n/g, "<br>");
  const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const stateOf = (result) => (result && typeof result === "object" && result.state ? result.state : result);
  const senderName = (item) => (typeof item === "string" ? item : plain(item && (item.name || item.sender || item.from)));
  const senderCount = (item) => (item && typeof item === "object" && Number.isFinite(Number(item.count)) ? Number(item.count) : null);

  // ---- 聊天条目与会话（纯函数） ----
  const isChatEntry = (entry) => !!entry && entry.type === "chat" && (entry.channel === "WhatsApp" || !!entry.chatRef);
  const chatEntries = (profile) => (Array.isArray(profile && profile.history) ? profile.history.filter(isChatEntry) : []);
  // 条目里的消息；旧数据没有 lines 时，用摘要和收发时间拼出一行。
  function entryLines(entry) {
    if (Array.isArray(entry.lines) && entry.lines.length) return entry.lines.filter((line) => line && typeof line === "object");
    const first = text(entry.text).split("\n").filter(Boolean).slice(-1)[0] || "";
    const sentAt = Date.parse(entry.lastSentAt || ""), receivedAt = Date.parse(entry.lastReceivedAt || "");
    const inbound = Number.isFinite(receivedAt) && (!Number.isFinite(sentAt) || receivedAt >= sentAt);
    return [{ at: entry.time, from: entry.contact || "", dir: inbound ? "in" : "out", text: first, key: "" }];
  }
  function allLines(profile) {
    const rows = [];
    for (const entry of chatEntries(profile)) for (const line of entryLines(entry)) rows.push(line);
    return rows.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  }
  function profilePhone(profile) {
    const p = profile && typeof profile === "object" ? profile : {};
    const extras = [];
    for (const item of Array.isArray(p.additionalPhones) ? p.additionalPhones : []) extras.push(typeof item === "string" ? { phone: item } : item);
    for (const item of Array.isArray(p.extraContacts) ? p.extraContacts : []) extras.push(item);
    for (const item of Array.isArray(p.contacts) ? p.contacts : []) extras.push(item);
    const raw = plain(p.phone) || plain((extras.find((item) => item && plain(item.phone)) || {}).phone);
    return { raw, code: plain(p.phoneCountryCode), country: plain(p.country), contact: plain(p.contact) };
  }
  function visibleNames(state, canSee) {
    const all = state && state.customers && typeof state.customers === "object" ? state.customers : {};
    return Object.keys(all)
      .filter((name) => all[name] && typeof all[name] === "object" && all[name].laiBucket !== "trash" && canSee(name, all[name]))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }
  // 左边的会话列表：每位客户一行，最近的在前。
  function conversations(state, { canSee = () => true, me = "", filter = "all", query = "" } = {}) {
    const all = (state && state.customers) || {};
    const needle = plain(query).toLowerCase();
    const rows = [];
    for (const name of visibleNames(state, canSee)) {
      const profile = all[name];
      const entries = chatEntries(profile);
      if (!entries.length) continue;
      const lines = allLines(profile);
      const last = lines[lines.length - 1] || {};
      const lastEntry = entries.slice().sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0))[0];
      const row = {
        name,
        contact: plain(lastEntry.contact) || profilePhone(profile).contact,
        lastText: text(last.text).replace(/\s+/g, " ").trim(),
        lastAt: last.at || lastEntry.time || "",
        waiting: last.dir === "in",
        mine: !!me && plain(profile.owner) === me,
        count: lines.length,
      };
      if (filter === "waiting" && !row.waiting) continue;
      if (filter === "mine" && !row.mine) continue;
      if (needle && ![row.name, row.contact, row.lastText, profile.phone].some((v) => text(v).toLowerCase().includes(needle))) continue;
      rows.push(row);
    }
    return rows.sort((a, b) => (Date.parse(b.lastAt) || 0) - (Date.parse(a.lastAt) || 0));
  }
  // 气泡按天分组（本地日期）。
  function dayGroups(lines) {
    const groups = [];
    for (const line of lines) {
      const day = dayKey(line.at) || "未知日期";
      let group = groups[groups.length - 1];
      if (!group || group.day !== day) groups.push((group = { day, lines: [] }));
      group.lines.push(line);
    }
    return groups;
  }
  function bubblesHtml(E, lines, { days = true } = {}) {
    const bubble = (line) => {
      const out = line.dir === "out";
      const who = out ? "" : plain(line.from);
      return `<div class="wa-bubble ${out ? "out" : "in"}"><p>${lineHtml(E, line.text)}</p><time>${E(who ? `${who} · ` : "")}${E(clock(line.at))}</time></div>`;
    };
    if (!days) return lines.map(bubble).join("");
    return dayGroups(lines)
      .map((group) => `<div class="wa-day"><span>${E(group.day)}</span></div>${group.lines.map(bubble).join("")}`)
      .join("");
  }
  // 客户动态里的一条聊天：折叠的“WhatsApp 聊天 · N 条”，展开是气泡。
  function renderChatEntry(entry, escape) {
    const E = typeof escape === "function" ? escape : (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const lines = entryLines(entry || {});
    const shown = lines.slice(-MAX_SHOWN_LINES);
    const more = lines.length > shown.length ? `<p class="wa-entry-note">只显示最近 ${shown.length} 条</p>` : "";
    const contact = plain(entry && entry.contact);
    return (
      `<details class="wa-entry"><summary><span class="wa-entry-title">WhatsApp 聊天 · ${lines.length} 条</span>` +
      (contact ? `<span class="wa-entry-contact">${E(contact)}</span>` : "") +
      `</summary>${more}<div class="wa-thread-body wa-entry-body">${bubblesHtml(E, shown)}</div></details>`
    );
  }

  // ---- 聊天模板（纯函数，对分组数组操作） ----
  const tplGroups = (value) => {
    const list = Array.isArray(value) ? value : value && Array.isArray(value.groups) ? value.groups : [];
    return list
      .filter((g) => g && typeof g === "object")
      .map((g) => ({ id: text(g.id) || uid("g"), name: text(g.name), items: (Array.isArray(g.items) ? g.items : []).filter((i) => i && typeof i === "object").map((i) => ({ id: text(i.id) || uid("t"), text: text(i.text) })) }));
  };
  const itemTotal = (groups) => groups.reduce((sum, g) => sum + g.items.length, 0);
  const move = (list, index, dir) => {
    const to = index + dir;
    if (index < 0 || to < 0 || to >= list.length) return list;
    const next = list.slice();
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  };
  const tpl = {
    addGroup(groups, name) {
      name = plain(name);
      if (!name) return { error: "请先写分组名称" };
      if (name.length > LIMITS.groupName) return { error: `分组名称最多 ${LIMITS.groupName} 个字` };
      if (groups.length >= LIMITS.groups) return { error: `最多 ${LIMITS.groups} 个分组` };
      return { groups: [...groups, { id: uid("g"), name, items: [] }] };
    },
    renameGroup(groups, id, name) {
      name = plain(name);
      if (!name) return { error: "请先写分组名称" };
      if (name.length > LIMITS.groupName) return { error: `分组名称最多 ${LIMITS.groupName} 个字` };
      return { groups: groups.map((g) => (g.id === id ? { ...g, name } : g)) };
    },
    deleteGroup: (groups, id) => ({ groups: groups.filter((g) => g.id !== id) }),
    moveGroup: (groups, id, dir) => ({ groups: move(groups, groups.findIndex((g) => g.id === id), dir) }),
    addItem(groups, gid, body) {
      body = plain(body);
      if (!body) return { error: "请先写模板内容" };
      if (body.length > LIMITS.chars) return { error: `每条模板最多 ${LIMITS.chars} 个字` };
      if (itemTotal(groups) >= LIMITS.items) return { error: `最多 ${LIMITS.items} 条模板` };
      if (!groups.some((g) => g.id === gid)) return { error: "找不到这个分组" };
      return { groups: groups.map((g) => (g.id === gid ? { ...g, items: [...g.items, { id: uid("t"), text: body }] } : g)) };
    },
    editItem(groups, gid, id, body) {
      body = plain(body);
      if (!body) return { error: "请先写模板内容" };
      if (body.length > LIMITS.chars) return { error: `每条模板最多 ${LIMITS.chars} 个字` };
      return { groups: groups.map((g) => (g.id === gid ? { ...g, items: g.items.map((i) => (i.id === id ? { ...i, text: body } : i)) } : g)) };
    },
    deleteItem: (groups, gid, id) => ({ groups: groups.map((g) => (g.id === gid ? { ...g, items: g.items.filter((i) => i.id !== id) } : g)) }),
    moveItem: (groups, gid, id, dir) => ({ groups: groups.map((g) => (g.id === gid ? { ...g, items: move(g.items, g.items.findIndex((i) => i.id === id), dir) } : g)) }),
  };
  // 取出文字里没替换掉的 {{变量}}。
  const leftovers = (value) => [...new Set((text(value).match(/\{\{[^{}]*\}\}/g) || []))];
  const rangeOf = (range) => {
    if (!range) return [null, null];
    if (Array.isArray(range)) return [range[0], range[1]];
    return [range.from ?? range.start ?? range.first ?? null, range.to ?? range.end ?? range.last ?? null];
  };

  function create(ctx) {
    const E = ctx.escape;
    const ic = (name) => (typeof ctx.icon === "function" ? ctx.icon(name) : "");
    const M = ctx.model;
    const can = (key) => typeof ctx.can !== "function" || ctx.can(key) !== false;
    const deny = (key) => ctx.toast((root.LaiRoleModel && root.LaiRoleModel.denied && root.LaiRoleModel.denied(key)) || "你的角色没有这个权限，请找系统管理员开通");
    const now = () => (typeof ctx.now === "function" ? ctx.now() : new Date());
    const onPage = () => ctx.isActive?.() !== false;
    const me = () => plain(typeof ctx.meName === "function" ? ctx.meName() : "");
    const st = () => ctx.getState() || {};
    const canSee = (name, profile) => (typeof ctx.canSeeCustomer === "function" ? ctx.canSeeCustomer(name, profile) !== false : true);
    const names = () => visibleNames(st(), canSee);
    const profileOf = (name) => ((st().customers || {})[name]) || null;
    const $ = (id) => (typeof document !== "undefined" && document.getElementById ? document.getElementById(id) : null);
    const value = (id) => {
      const node = $(id);
      return node ? text(node.value) : "";
    };
    const showError = (id, message) => {
      const node = $(id);
      if (!node) return;
      node.textContent = message || "";
      node.classList?.toggle("visible", !!message);
    };
    const copy = async (value) => {
      if (typeof ctx.copy === "function") return ctx.copy(value);
      if (typeof navigator !== "undefined" && navigator.clipboard) return navigator.clipboard.writeText(value);
      throw new Error("这里不能复制");
    };
    const guard = (key) => {
      if (can(key)) return true;
      deny(key);
      return false;
    };

    let filter = "all", query = "", selected = "";
    let importState = null, dialogState = null, logState = null;
    let editing = null, armed = "", templateError = "";

    // ---- 聊天记录页 ----
    const empty = (title, note, actions = "") => `<div class="empty wa-empty"><div class="wa-empty-art">${ic("chat")}</div><strong>${E(title)}</strong><span>${E(note)}</span>${actions}</div>`;
    const pagebar = (title, actions = "") => `<div class="pagebar"><div class="page-tabs"><h1>${E(title)}</h1></div><div class="page-actions">${actions}</div></div>`;
    const btn = (action, label, extra = "", cls = "") => `<button type="button"${cls ? ` class="${cls}"` : ""} data-chat-action="${action}"${extra}>${E(label)}</button>`;

    function rowsOf() {
      return conversations(st(), { canSee, me: me(), filter, query });
    }
    function listHtml(rows) {
      if (!rows.length) return `<p class="wa-list-empty">没有符合的聊天</p>`;
      return rows
        .map(
          (row) =>
            `<button type="button" class="wa-row${row.name === selected ? " selected" : ""}" data-chat-action="select" data-name="${E(row.name)}"><span class="wa-row-top"><strong>${E(row.name)}</strong><time>${E(shortTime(row.lastAt, now()))}</time></span>` +
            `<span class="wa-row-sub">${row.contact ? `<em>${E(row.contact)}</em>` : ""}${row.waiting ? `<b class="wa-waiting">等你回复</b>` : ""}</span>` +
            `<span class="wa-row-text">${E(row.lastText || "（没有文字）")}</span></button>`,
        )
        .join("");
    }
    function threadHtml(rows) {
      const row = rows.find((item) => item.name === selected);
      if (!row) return `<div class="wa-thread-empty">${E(rows.length ? "点左边的一位客户，查看聊天" : "没有可看的聊天")}</div>`;
      const lines = allLines(profileOf(row.name));
      const shown = lines.slice(-MAX_SHOWN_LINES);
      return (
        `<header class="wa-thread-head"><div><strong>${E(row.name)}</strong>${row.contact ? `<span>${E(row.contact)}</span>` : ""}<small>共 ${lines.length} 条</small></div>` +
        `<div class="wa-thread-actions">${btn("open-customer", "打开客户", ` data-name="${E(row.name)}"`)}</div></header>` +
        `<div class="wa-thread-body" id="wa-thread">${lines.length > shown.length ? `<p class="wa-entry-note">只显示最近 ${shown.length} 条，更早的在客户动态里</p>` : ""}${bubblesHtml(E, shown)}</div>`
      );
    }
    function importLogHtml() {
      const log = (Array.isArray(st().laiChatImports) ? st().laiChatImports : []).filter((row) => row && canSee(text(row.customer), profileOf(text(row.customer)))).slice(0, 20);
      if (!log.length) return "";
      const rowsHtml = log
        .map((row) => {
          const action = row.undone ? `<span class="wa-log-undone">已撤销</span>` : can("chat.import") ? btn("undo", "撤销", ` data-id="${E(row.id)}"`, "wa-log-undo") : "";
          return `<li class="${row.undone ? "undone" : ""}"><time>${E(fullTime(row.at))}</time><strong>${E(row.customer)}</strong><span>${E(row.file || "")}</span><span>导入 ${Number(row.added) || 0} 条，跳过 ${Number(row.skipped) || 0} 条</span>${action}</li>`;
        })
        .join("");
      return `<section class="wa-imports" aria-label="导入记录"><h2>导入记录</h2><ul>${rowsHtml}</ul></section>`;
    }
    function actionsHtml() {
      return (
        (can("chat.import") ? btn("import", "导入聊天记录", "", "") : "") +
        (can("chat.send") ? btn("log", "记一笔聊天") + btn("whatsapp", "打开 WhatsApp", "", "primary") : "")
      );
    }
    function page() {
      const all = conversations(st(), { canSee, me: me() });
      if (!all.length) {
        return pagebar("聊天记录", actionsHtml()) + `<section class="module-page wa-page">${empty("还没有聊天记录", EMPTY_TEXT, can("chat.import") ? btn("import", "导入聊天记录", "", "primary") : "")}${importLogHtml()}</section>`;
      }
      const rows = rowsOf();
      if (!rows.some((row) => row.name === selected)) selected = rows[0] ? rows[0].name : "";
      return (
        pagebar("聊天记录", actionsHtml()) +
        `<section class="module-page wa-page"><div class="wa-split"><aside class="wa-list-pane"><div class="wa-tools"><input type="search" id="wa-search" value="${E(query)}" placeholder="搜客户、联系人或聊天内容" aria-label="搜索聊天" autocomplete="off">` +
        `<div class="wa-filters" role="tablist" aria-label="筛选">${FILTERS.map((f) => `<button type="button" role="tab" class="wa-filter${f.id === filter ? " active" : ""}" aria-selected="${f.id === filter}" data-chat-action="filter" data-id="${f.id}">${E(f.label)}</button>`).join("")}</div></div>` +
        `<div class="wa-list" id="wa-list">${listHtml(rows)}</div></aside><section class="wa-thread-pane" id="wa-thread-pane">${threadHtml(rows)}</section></div>${importLogHtml()}</section>`
      );
    }
    function render() {
      if (!can("chat.view")) return ctx.mount(pagebar("聊天记录") + `<section class="module-page wa-page">${empty("没有查看权限", "你的角色不能查看聊天记录，请找系统管理员开通")}</section>`);
      ctx.mount(page());
      const search = $("wa-search");
      if (search && search.addEventListener)
        search.addEventListener("input", () => {
          query = plain(search.value);
          const rows = rowsOf();
          const box = $("wa-list");
          if (box) box.innerHTML = listHtml(rows);
        });
      const thread = $("wa-thread");
      if (thread) thread.scrollTop = thread.scrollHeight;
    }

    // ---- 记一笔聊天 ----
    function customerSelect(idName, current) {
      return `<select id="${idName}" aria-label="客户">${current ? "" : `<option value="">选择客户</option>`}${names().map((n) => `<option value="${E(n)}"${n === current ? " selected" : ""}>${E(n)}</option>`).join("")}</select>`;
    }
    function openLog(options = {}) {
      if (!guard("chat.send")) return;
      const customer = options.customer || selected || "";
      const profile = profileOf(customer);
      logState = { customer, text: options.text || "" };
      ctx.dialog(
        "记一笔聊天",
        `<form class="drawer-body wa-log-form" id="wa-log-form" autocomplete="off" novalidate><div class="module-note">把你在 WhatsApp 里发出的话记到客户动态里，会更新最近联系时间。</div>` +
          `<div class="form-grid"><label class="field wide"><span>客户</span>${customerSelect("wa-log-customer", customer)}</label>` +
          `<label class="field wide"><span>联系人</span><input id="wa-log-contact" maxlength="80" value="${E(profile ? profilePhone(profile).contact : "")}" autocomplete="off"></label>` +
          `<label class="field wide"><span>聊天内容</span><textarea id="wa-log-text" rows="5" maxlength="4000" placeholder="例如：已把报价单发给对方">${E(logState.text)}</textarea></label></div>` +
          `<div class="error" id="wa-log-error" role="alert"></div></form>`,
        `${CANCEL}${btn("log-save", "记下来", "", "primary")}`,
        "whatsapp",
      );
      const pick = $("wa-log-customer");
      if (pick && pick.addEventListener)
        pick.addEventListener("change", () => {
          const next = profileOf(pick.value);
          const contact = $("wa-log-contact");
          if (contact && next) contact.value = profilePhone(next).contact;
        });
    }
    async function saveLog() {
      if (!guard("chat.send")) return;
      const customer = value("wa-log-customer") || (logState && logState.customer) || "";
      const body = plain(value("wa-log-text"));
      if (!customer || !profileOf(customer) || !canSee(customer, profileOf(customer))) return showError("wa-log-error", "请先选择客户");
      if (!body) return showError("wa-log-error", "请先写聊天内容");
      const profile = profileOf(customer);
      const phone = profilePhone(profile);
      try {
        const next = stateOf(M.logChat(st(), customer, { text: body, contact: plain(value("wa-log-contact")), peer: M.toE164(phone.raw, { code: phone.code, country: phone.country }) || "", owner: plain(profile.owner) || me(), src: "manual", at: now().toISOString() }));
        await ctx.persist(next);
      } catch (error) {
        return showError("wa-log-error", error.message);
      }
      ctx.closeDialog();
      ctx.toast("已记到客户动态");
      selected = customer;
      if (onPage()) render();
    }

    // ---- 打开 WhatsApp 对话框 ----
    function numberOf(raw, code, country) {
      try {
        return M.toE164(raw, { code: code || "", country: country || "" }) || "";
      } catch (_) {
        return "";
      }
    }
    function templateOptions() {
      const groups = tplGroups(((st().laiSettings || {}).whatsapp || {}).templates);
      return `<option value="">不用模板</option>` + groups.filter((g) => g.items.length).map((g) => `<optgroup label="${E(g.name)}">${g.items.map((i) => `<option value="${E(g.id + "|" + i.id)}">${E(i.text.replace(/\s+/g, " ").slice(0, 40))}</option>`).join("")}</optgroup>`).join("");
    }
    // 号码缺区号时按国家补：线索自己带国家；客户用资料里的国家。
    const countryOfDialog = (d) => plain(d.country) || plain((profileOf(d.customer) || {}).country);
    // 这条消息发出去后能不能记一笔：线索要调用方给 onLog；客户要在客户资料里找得到。
    const NOT_VISIBLE = "你看不到这位客户，不能操作";
    // 记到客户动态：客户要在，而且这个账号看得到（本人账号看不到别人的客户，公海客户要“公海查看”）。
    const canLogDialog = (d) => (d.lead ? !!d.onLog : !!(d.customer && profileOf(d.customer) && canSee(d.customer, profileOf(d.customer))));
    function templateVars(d) {
      const profile = profileOf(d.customer) || {};
      return { 姓名: plain(d.contact) || profilePhone(profile).contact, 公司: d.customer || plain(d.label), 我的名字: me(), 国家: countryOfDialog(d) };
    }
    function dialogBody() {
      const d = dialogState;
      const e164 = numberOf(d.phone, d.code, countryOfDialog(d));
      return (
        `<form class="drawer-body wa-dialog" id="wa-dlg-form" autocomplete="off" novalidate>` +
        (d.fixed ? `<p class="wa-dlg-who">${E(d.customer || d.label)}${d.contact ? ` · ${E(d.contact)}` : ""}</p>` : `<label class="field wide"><span>客户</span>${customerSelect("wa-dlg-customer", d.customer)}</label>`) +
        `<div class="form-grid"><label class="field wide"><span>号码</span><input id="wa-dlg-phone" value="${E(d.phone)}" maxlength="40" placeholder="例如 +44 7700 900123" inputmode="tel"></label>` +
        `<label class="field wide" id="wa-dlg-fix"${e164 ? " hidden" : ""}><span>号码前面缺国家区号，请选一个</span><select id="wa-dlg-code"><option value="">选择国家或区号</option>${COUNTRY_CODES.map(([code, name]) => `<option value="${code}"${code === d.code ? " selected" : ""}>${E(name)} ${code}</option>`).join("")}</select></label>` +
        `<p class="wa-dlg-note wide" id="wa-dlg-note">${E(e164 ? `将打开 ${e164}` : "号码还不能用，请检查或选区号")}</p>` +
        `<label class="field wide"><span>模板</span><select id="wa-dlg-template">${templateOptions()}</select></label>` +
        `<label class="field wide"><span>消息</span><textarea id="wa-dlg-text" rows="6" maxlength="4000" placeholder="想发给对方的话">${E(d.text)}</textarea></label></div>` +
        `<div class="error" id="wa-dlg-error" role="alert"></div></form>`
      );
    }
    // 打开 WhatsApp 对话框（聊天页、客户资料、线索、商机都用这一个）。
    // options：customer（客户名，对象固定）或 lead（{name, country}，线索没有客户资料）；contact、phone、code 是要打的号码；
    // onLog(消息)：发出去以后“记一笔”由调用方决定记到哪里（线索记进线索跟进），可以返回一句提示；
    // 线索没给 onLog 就不问“发出去了吗”；客户不给 onLog 就记进客户动态。
    function openDialog(options = {}) {
      if (!guard("chat.send")) return;
      const lead = options.lead && typeof options.lead === "object" ? options.lead : null;
      const customer = lead ? "" : options.customer || selected || "";
      const profile = profileOf(customer);
      if (profile && !canSee(customer, profile)) return ctx.toast(NOT_VISIBLE);
      const phone = profilePhone(profile);
      const onLog = typeof options.onLog === "function" ? options.onLog : null;
      dialogState = {
        customer,
        lead: !!lead,
        label: lead ? plain(lead.name) : customer,
        fixed: !!(lead || options.customer),
        country: lead ? plain(lead.country) : plain(options.country),
        contact: plain(options.contact) || phone.contact,
        phone: plain(options.phone) || phone.raw,
        code: plain(options.code) || phone.code,
        text: text(options.text),
        onLog,
      };
      ctx.dialog("打开 WhatsApp", dialogBody(), `${CANCEL}${btn("dlg-copy-text", "复制消息")}${btn("dlg-copy-link", "复制链接")}${btn("dlg-open", "打开 WhatsApp", "", "primary")}`, "whatsapp");
      const form = $("wa-dlg-form");
      if (form && form.addEventListener) {
        form.addEventListener("input", refreshNumber);
        form.addEventListener("change", (event) => {
          const target = (event && event.target) || {};
          if (target.id === "wa-dlg-template") return pickTemplate(target.value);
          if (target.id === "wa-dlg-customer") return pickCustomer(target.value);
          refreshNumber();
        });
      }
    }
    function refreshNumber() {
      if (!dialogState) return;
      const e164 = numberOf(value("wa-dlg-phone"), value("wa-dlg-code") || dialogState.code, countryOfDialog(dialogState));
      const note = $("wa-dlg-note");
      if (note) note.textContent = e164 ? `将打开 ${e164}` : "号码还不能用，请检查或选区号";
      const fix = $("wa-dlg-fix");
      if (fix) fix.hidden = !!e164;
    }
    function pickCustomer(name) {
      if (!dialogState) return;
      const profile = profileOf(name) || {};
      const phone = profilePhone(profile);
      dialogState.customer = name;
      dialogState.contact = phone.contact;
      const input = $("wa-dlg-phone");
      if (input) input.value = phone.raw;
      const code = $("wa-dlg-code");
      if (code) code.value = phone.code;
      dialogState.code = phone.code;
      refreshNumber();
    }
    function pickTemplate(id) {
      if (!dialogState || !id) return;
      const [gid, tid] = text(id).split("|");
      const group = tplGroups(((st().laiSettings || {}).whatsapp || {}).templates).find((g) => g.id === gid);
      const item = group && group.items.find((i) => i.id === tid);
      if (!item) return;
      const done = M.renderTemplate(item.text, templateVars(dialogState));
      const area = $("wa-dlg-text");
      if (area) area.value = done && typeof done === "object" ? done.text : text(done);
      if (done && done.missing && done.missing.length) showError("wa-dlg-error", `还有没填的内容：${done.missing.map((v) => `{{${v}}}`).join("、")}。请在客户资料里补上，或直接改消息。`);
      else showError("wa-dlg-error", "");
    }
    // 读对话框：号码不对、消息里还有 {{变量}} 都不能打开。
    function readDialog() {
      const d = dialogState;
      if (!d) return null;
      const body = text(value("wa-dlg-text"));
      const e164 = numberOf(value("wa-dlg-phone"), value("wa-dlg-code") || d.code, countryOfDialog(d));
      if (!e164) {
        showError("wa-dlg-error", "号码不对，请检查，或选一个国家区号");
        return null;
      }
      const left = leftovers(body);
      if (left.length) {
        showError("wa-dlg-error", `消息里还有没填的内容：${left.join("、")}。请改好再打开。`);
        return null;
      }
      showError("wa-dlg-error", "");
      return { e164, body, link: M.waLink(e164, body) };
    }
    function openLink() {
      const read = readDialog();
      if (!read) return;
      ctx.openExternal(read.link);
      dialogState.peer = read.e164;
      dialogState.sent = read.body;
      if (!plain(read.body) || !canLogDialog(dialogState)) return ctx.closeDialog();
      ctx.dialog(
        "发出去了吗？",
        `<div class="drawer-body wa-ask"><p>${dialogState.lead ? "发出去了吗？记到这条线索的跟进里。" : "发出去了吗？记到动态，之后在客户资料里能看到。"}</p><div class="wa-ask-text">${lineHtml(E, read.body)}</div><div class="error" id="wa-ask-error" role="alert"></div></div>`,
        `${btn("dlg-skip", "不用")}${btn("dlg-log", "记一笔", "", "primary")}`,
        "whatsapp",
      );
    }
    async function logLink() {
      const d = dialogState;
      if (!d || !guard("chat.send")) return;
      if (!canLogDialog(d)) return !d.lead && d.customer && profileOf(d.customer) ? showError("wa-ask-error", NOT_VISIBLE) : undefined;
      let note = "已记到客户动态";
      try {
        if (d.onLog) {
          // 调用方自己记（线索：记进线索跟进）。
          const said = await d.onLog(d.sent);
          if (typeof said === "string" && said) note = said;
        } else {
          const profile = profileOf(d.customer);
          if (!profile) return;
          const next = stateOf(M.logChat(st(), d.customer, { text: d.sent, contact: d.contact, peer: d.peer, owner: plain(profile.owner) || me(), src: "link", at: now().toISOString() }));
          await ctx.persist(next);
        }
      } catch (error) {
        return showError("wa-ask-error", error.message);
      }
      ctx.closeDialog();
      ctx.toast(note);
      if (onPage()) render();
    }
    async function copyFrom(kind) {
      const read = kind === "link" ? readDialog() : { body: value("wa-dlg-text") };
      if (!read) return;
      try {
        await copy(kind === "link" ? read.link : read.body);
        ctx.toast(kind === "link" ? "已复制链接" : "已复制消息");
      } catch (error) {
        showError("wa-dlg-error", error.message);
      }
    }

    // ---- 导入聊天记录 ----
    const customerRow = (name) => {
      const profile = profileOf(name) || {};
      return { name, contact: profilePhone(profile).contact, phone: text(profile.phone) };
    };
    function parse() {
      const s = importState;
      s.parsed = M.parseExport(s.text, { dayFirst: s.dayFirst });
      const senders = (s.parsed.senders || []).map(senderName).filter(Boolean);
      const remembered = plain((((st().laiSettings || {}).whatsapp) || {}).me);
      if (!senders.includes(s.me)) s.me = senders.includes(remembered) ? remembered : senders.includes(me()) ? me() : "";
      match();
    }
    // 对方：除“你”以外的发送人。
    const others = () => (importState.parsed.senders || []).map(senderName).filter((n) => n && n !== importState.me);
    function match() {
      const s = importState;
      const peers = [];
      for (const name of others()) {
        const e164 = numberOf(name, "", "");
        if (e164) peers.push(e164);
      }
      let result = { customers: [], leads: [] };
      try {
        result = M.matchCustomers(st(), { peers, names: others() }, names()) || result;
      } catch (_) {}
      s.suggestions = Array.isArray(result.customers) ? result.customers.filter((c) => names().includes(c.name)) : [];
      s.leads = Array.isArray(result.leads) ? result.leads : [];
      if (s.customer && !names().includes(s.customer)) s.customer = "";
      // 从客户资料里点“导入聊天记录”进来时，先选这位客户（还是可以改）。
      if (!s.customer && s.preset && names().includes(s.preset)) pickCustomerImport(s.preset);
      else if (!s.customer && s.suggestions.length) pickCustomerImport(s.suggestions[0].name);
    }
    function pickCustomerImport(name) {
      const s = importState;
      s.customer = name;
      const hit = s.suggestions.find((c) => c.name === name);
      s.peer = (hit && hit.peer) || (others().map((n) => numberOf(n, "", "")).find(Boolean) || "");
      const profile = profileOf(name) || {};
      s.contact = (hit && plain(hit.contact)) || profilePhone(profile).contact;
    }
    function contactChoices() {
      const profile = profileOf(importState.customer) || {};
      const list = [importState.contact, profilePhone(profile).contact];
      for (const item of [...(Array.isArray(profile.extraContacts) ? profile.extraContacts : []), ...(Array.isArray(profile.contacts) ? profile.contacts : [])]) list.push(plain(item && (item.contact || item.name)));
      return [...new Set(list.map(plain).filter(Boolean))];
    }
    function candidates() {
      const s = importState;
      const needle = plain(s.find).toLowerCase();
      const rows = names().map(customerRow).filter((r) => !needle || [r.name, r.contact, r.phone].some((v) => v.toLowerCase().includes(needle)));
      const suggested = s.suggestions.map((c) => c.name);
      const first = needle ? [] : suggested.filter((n) => rows.some((r) => r.name === n));
      const rest = rows.filter((r) => !first.includes(r.name)).slice(0, 8).map((r) => r.name);
      return { first, rest };
    }
    function candidatesHtml() {
      const { first, rest } = candidates();
      const item = (name, tag) => `<button type="button" class="wa-pick${name === importState.customer ? " selected" : ""}" data-chat-action="import-pick" data-name="${E(name)}"><strong>${E(name)}</strong>${tag ? `<em>${tag}</em>` : ""}</button>`;
      const leads = importState.leads.map((lead) => `<p class="wa-lead">这是线索「${E(typeof lead === "string" ? lead : lead.name)}」，先转为客户再导入。</p>`).join("");
      return first.map((n) => item(n, "可能是")).join("") + rest.map((n) => item(n, "")).join("") + (first.length || rest.length ? "" : `<p class="wa-list-empty">没有找到客户</p>`) + leads;
    }
    function previewHtml() {
      const s = importState;
      const p = s.parsed;
      if (!p) return "";
      const senders = (p.senders || []).filter((item) => senderName(item));
      const [from, to] = rangeOf(p.range);
      const count = (p.messages || []).length;
      const unknown = Number(Array.isArray(p.unknownLines) ? p.unknownLines.length : p.unknownLines) || 0;
      return (
        `<div class="wa-preview"><dl class="wa-facts"><div><dt>消息</dt><dd>${count} 条</dd></div><div><dt>时间</dt><dd>${E(dayKey(from) || "—")} 到 ${E(dayKey(to) || "—")}</dd></div>` +
        `<div><dt>发送人</dt><dd>${senders.map((item) => E(senderName(item)) + (senderCount(item) !== null ? `（${senderCount(item)}）` : "")).join("、") || "—"}</dd></div>` +
        `<div><dt>没认出的行</dt><dd>${unknown} 条</dd></div></dl>` +
        (count ? "" : `<p class="wa-warn">里面没有认出聊天消息，请确认是 WhatsApp 导出的聊天文件。</p>`) +
        `<label class="field wide"><span>哪个是你</span><select name="me" id="wa-import-me"><option value="">请选择</option>${senders.map((item) => `<option value="${E(senderName(item))}"${senderName(item) === s.me ? " selected" : ""}>${E(senderName(item))}</option>`).join("")}</select></label>` +
        (p.ambiguousDateOrder ? `<label class="field wide"><span>日期是怎么写的？</span><select name="order" id="wa-import-order"><option value="day"${s.dayFirst ? " selected" : ""}>日／月／年（12/10 是 10 月 12 日）</option><option value="month"${s.dayFirst ? "" : " selected"}>月／日／年（12/10 是 12 月 10 日）</option></select></label>` : "") +
        `<div class="field wide"><span>记到哪位客户</span><input id="wa-import-find" value="${E(s.find)}" placeholder="搜客户名、联系人或电话" autocomplete="off"><div class="wa-picks" id="wa-import-customers">${candidatesHtml()}</div></div>` +
        (s.customer ? `<label class="field wide"><span>联系人</span><select name="contact" id="wa-import-contact"><option value="">不填</option>${contactChoices().map((c) => `<option value="${E(c)}"${c === s.contact ? " selected" : ""}>${E(c)}</option>`).join("")}</select></label>` : "") +
        `<p class="module-note">导入后会更新最近联系时间；重复的消息会自动跳过。</p></div>`
      );
    }
    function paintImport() {
      const box = $("wa-import-preview");
      if (box) box.innerHTML = previewHtml();
      const ok = $("wa-import-confirm");
      if (ok) ok.disabled = !(importState && importState.parsed && (importState.parsed.messages || []).length && importState.me && importState.customer);
      const find = $("wa-import-find");
      if (find && find.addEventListener && !find.__wa)
        (find.__wa = true), find.addEventListener("input", () => {
          importState.find = find.value;
          const list = $("wa-import-customers");
          if (list) list.innerHTML = candidatesHtml();
        });
    }
    function openImport(options = {}) {
      if (!guard("chat.import")) return;
      importState = { text: "", parsed: null, me: "", dayFirst: true, customer: "", contact: "", peer: "", find: "", suggestions: [], leads: [], file: "", preset: plain(options.customer) };
      ctx.dialog(
        "导入聊天记录",
        `<form class="drawer-body wa-import" id="wa-import-form" autocomplete="off" novalidate>` +
          (ctx.isTrial ? `<div class="module-note wa-trial">${E(TRIAL_NOTE)}</div>` : "") +
          `<div class="module-note">在手机的 WhatsApp 里打开一个聊天，选「导出聊天」，不带媒体，把得到的 .txt 或 .zip 文件选到这里。</div>` +
          `<label class="field wide"><span>聊天文件</span><input type="file" id="wa-import-file" accept=".txt,.zip,text/plain,application/zip"></label>` +
          `<div class="error" id="wa-import-error" role="alert"></div><div id="wa-import-preview"></div></form>`,
        `${CANCEL}<button type="button" class="primary" id="wa-import-confirm" data-chat-action="import-confirm" disabled>确认导入</button>`,
        "whatsapp",
      );
      const file = $("wa-import-file");
      if (file && file.addEventListener) file.addEventListener("change", () => loadFile(file.files && file.files[0]));
      const box = $("wa-import-preview");
      if (box && box.addEventListener) {
        box.addEventListener("change", (event) => onImportChange((event && event.target) || {}));
      }
    }
    function onImportChange(target) {
      const s = importState;
      if (!s || !s.parsed) return;
      if (target.name === "me") {
        s.me = text(target.value);
        match();
      } else if (target.name === "order") {
        s.dayFirst = target.value !== "month";
        parse();
      } else if (target.name === "contact") s.contact = text(target.value);
      else return;
      paintImport();
    }
    async function loadFile(file) {
      showError("wa-import-error", "");
      if (!file) return;
      const s = importState;
      const limit = ctx.isTrial ? TRIAL_BYTES : MAX_BYTES;
      if (file.size > limit) return showError("wa-import-error", ctx.isTrial ? "文件太大，试用版一次最多 300 KB" : "文件太大，一次最多 3 MB");
      try {
        const zip = /\.zip$/i.test(file.name || "");
        s.text = zip ? await M.readZip(new Uint8Array(await file.arrayBuffer())) : await file.text();
        s.file = text(file.name);
        parse();
      } catch (error) {
        s.parsed = null;
        paintImport();
        return showError("wa-import-error", `读不了这个文件：${error.message}`);
      }
      paintImport();
    }
    async function confirmImport() {
      const s = importState;
      if (!guard("chat.import") || !s || !s.parsed) return;
      const profile = profileOf(s.customer);
      if (!s.me) return showError("wa-import-error", "请先选哪个是你");
      if (!profile || !canSee(s.customer, profile)) return showError("wa-import-error", "请先选择客户");
      showError("wa-import-error", "");
      const importId = uid("imp-");
      const confirm = $("wa-import-confirm");
      if (confirm) confirm.disabled = true;
      try {
        const subtype = others().length > 1 ? "whatsappgroup" : "whatsapp";
        const entries = M.buildEntries(s.parsed.messages, { me: s.me, peer: s.peer, contact: s.contact, owner: plain(profile.owner) || me(), importId, subtype });
        const result = M.mergeImport(st(), s.customer, entries, { id: importId, at: now().toISOString(), operator: me(), customer: s.customer, file: s.file });
        const base = result.state;
        const wa = { ...(((base.laiSettings || {}).whatsapp) || {}), me: s.me };
        await ctx.persist({ ...base, laiSettings: { ...(base.laiSettings || {}), whatsapp: wa } });
        ctx.closeDialog();
        ctx.toast(`已导入 ${result.added} 条，跳过 ${result.skipped} 条重复`);
        selected = s.customer;
        importState = null;
        if (onPage()) render();
      } catch (error) {
        showError("wa-import-error", error.message);
        if (confirm) confirm.disabled = false;
      }
    }

    // ---- 撤销导入 ----
    const importRow = (id) => (Array.isArray(st().laiChatImports) ? st().laiChatImports : []).find((r) => r && r.id === id);
    // 导入记录属于哪位客户，就要看得到这位客户才能撤销。
    const importSeen = (row) => canSee(text(row.customer), profileOf(text(row.customer)));
    function askUndo(id) {
      if (!guard("chat.import")) return;
      const row = importRow(id);
      if (!row || row.undone) return;
      if (!importSeen(row)) return ctx.toast(NOT_VISIBLE);
      ctx.dialog(
        "撤销这次导入？",
        `<div class="drawer-body"><p>${E(fullTime(row.at))} 导入到「${E(row.customer)}」的 ${Number(row.added) || 0} 条聊天会从客户动态里删掉，别的记录不受影响。</p><div class="error" id="wa-undo-error" role="alert"></div></div>`,
        `${CANCEL}${btn("undo-confirm", "撤销导入", ` data-id="${E(id)}"`, "primary")}`,
        "whatsapp",
      );
    }
    async function undo(id) {
      if (!guard("chat.import")) return;
      const row = importRow(id);
      if (row && !importSeen(row)) return showError("wa-undo-error", NOT_VISIBLE);
      try {
        const next = stateOf(M.undoImport(st(), id));
        const log = (Array.isArray(next.laiChatImports) ? next.laiChatImports : []).map((r) => (r && r.id === id ? { ...r, undone: true } : r));
        await ctx.persist({ ...next, laiChatImports: log });
      } catch (error) {
        return showError("wa-undo-error", error.message);
      }
      ctx.closeDialog();
      ctx.toast("已撤销这次导入");
      if (onPage()) render();
    }

    // ---- 聊天模板页 ----
    const groupsNow = () => tplGroups(((st().laiSettings || {}).whatsapp || {}).templates);
    async function saveGroups(groups) {
      const s = st();
      const wa = (s.laiSettings || {}).whatsapp || {};
      const kept = wa.templates && !Array.isArray(wa.templates) && typeof wa.templates === "object" ? { ...wa.templates, groups } : groups;
      try {
        await ctx.persist({ ...s, laiSettings: { ...(s.laiSettings || {}), whatsapp: { ...wa, templates: kept } } });
        templateError = "";
        return true;
      } catch (error) {
        templateError = error.message;
        return false;
      }
    }
    async function change(result, keep = false) {
      if (result.error) templateError = result.error;
      else if (!(await saveGroups(result.groups))) keep = true;
      if (!result.error && !keep) {
        editing = null;
        armed = "";
      }
      renderTemplates();
    }
    function templatesPage() {
      const groups = groupsNow();
      const total = itemTotal(groups);
      const vars = VARIABLES.map((v) => `<code>{{${v}}}</code>`).join(" ");
      const groupHtml = groups
        .map((g, gi) => {
          const head =
            editing && editing.kind === "group" && editing.id === g.id
              ? `<div class="wa-tpl-edit"><input id="wa-edit-group" value="${E(g.name)}" maxlength="${LIMITS.groupName}" aria-label="分组名称">${btn("group-save", "保存", ` data-gid="${E(g.id)}"`, "primary")}${btn("edit-cancel", "取消")}</div>`
              : `<strong>${E(g.name)}</strong><span class="wa-tpl-count">${g.items.length} 条</span><span class="wa-tpl-tools">${btn("group-edit", "改名", ` data-gid="${E(g.id)}"`, "text-button")}${btn("group-up", "上移", ` data-gid="${E(g.id)}"${gi === 0 ? " disabled" : ""}`, "text-button")}${btn("group-down", "下移", ` data-gid="${E(g.id)}"${gi === groups.length - 1 ? " disabled" : ""}`, "text-button")}${btn("group-del", armed === "g:" + g.id ? "再点一次删除" : "删除", ` data-gid="${E(g.id)}"`, "text-button")}</span>`;
          const items = g.items
            .map((i, ii) =>
              editing && editing.kind === "item" && editing.id === i.id
                ? `<li class="editing"><textarea id="wa-edit-item" rows="3" maxlength="${LIMITS.chars}" aria-label="模板内容">${E(i.text)}</textarea><div class="wa-tpl-edit">${btn("item-save", "保存", ` data-gid="${E(g.id)}" data-id="${E(i.id)}"`, "primary")}${btn("edit-cancel", "取消")}</div></li>`
                : `<li><p>${lineHtml(E, i.text)}</p><span class="wa-tpl-tools">${btn("item-edit", "修改", ` data-gid="${E(g.id)}" data-id="${E(i.id)}"`, "text-button")}${btn("item-up", "上移", ` data-gid="${E(g.id)}" data-id="${E(i.id)}"${ii === 0 ? " disabled" : ""}`, "text-button")}${btn("item-down", "下移", ` data-gid="${E(g.id)}" data-id="${E(i.id)}"${ii === g.items.length - 1 ? " disabled" : ""}`, "text-button")}${btn("item-del", armed === "i:" + i.id ? "再点一次删除" : "删除", ` data-gid="${E(g.id)}" data-id="${E(i.id)}"`, "text-button")}</span></li>`,
            )
            .join("");
          return `<section class="wa-tpl-group"><header>${head}</header><ul>${items || `<li class="wa-tpl-none">这个分组还没有模板</li>`}</ul><div class="wa-tpl-add"><textarea id="wa-new-item-${E(g.id)}" rows="2" maxlength="${LIMITS.chars}" placeholder="新模板，例如：你好 {{姓名}}，上次聊的报价有进展吗？" aria-label="新模板"></textarea>${btn("item-add", "添加模板", ` data-gid="${E(g.id)}"`, "primary")}</div></section>`;
        })
        .join("");
      return (
        pagebar("聊天模板") +
        `<section class="module-page wa-page wa-templates"><div class="module-note">写好常用的话，打开 WhatsApp 时直接选。可用的变量：${vars}，发送时会换成客户的资料。最多 ${LIMITS.groups} 个分组、${LIMITS.items} 条模板，每条最多 ${LIMITS.chars} 个字（现在 ${groups.length} 个分组、${total} 条）。</div>` +
        `<div class="error ${templateError ? "visible" : ""}" id="wa-tpl-error" role="alert">${E(templateError)}</div>` +
        `<div class="wa-tpl-new"><input id="wa-new-group" maxlength="${LIMITS.groupName}" placeholder="新分组名称，例如：报价跟进" aria-label="新分组名称" autocomplete="off">${btn("group-add", "添加分组", "", "primary")}</div>` +
        (groupHtml || `<p class="wa-list-empty">还没有模板。先添加一个分组，再往里写模板。</p>`) +
        `</section>`
      );
    }
    function renderTemplates() {
      if (!can("chat.template")) return ctx.mount(pagebar("聊天模板") + `<section class="module-page wa-page">${empty("没有管理权限", "你的角色不能管理聊天模板，请找系统管理员开通")}</section>`);
      ctx.mount(templatesPage());
      const onEnter = (id, action) => {
        const node = $(id);
        if (node && node.addEventListener) node.addEventListener("keydown", (event) => event.key === "Enter" && !event.isComposing && (event.preventDefault?.(), controller.action(action, false, { dataset: { gid: node.dataset && node.dataset.gid } })));
      };
      onEnter("wa-new-group", "group-add");
    }

    // ---- 按钮 ----
    function action(name, pointer, el) {
      const d = (el && el.dataset) || {};
      const guarded = (key, run) => (can(key) ? run() : deny(key));
      switch (name) {
        case "filter":
          filter = FILTERS.some((f) => f.id === d.id) ? d.id : "all";
          return render();
        case "select":
          selected = d.name || "";
          return render();
        case "open-customer":
          return d.name && ctx.openCustomer(d.name);
        case "import":
          return openImport();
        case "log":
          return openLog();
        case "whatsapp":
          return openDialog();
        case "undo":
          return askUndo(d.id);
        case "undo-confirm":
          return undo(d.id);
        case "import-pick":
          if (!importState || !d.name) return;
          pickCustomerImport(d.name);
          return paintImport();
        case "import-confirm":
          return confirmImport();
        case "log-save":
          return saveLog();
        case "dlg-open":
          return openLink();
        case "dlg-copy-text":
          return copyFrom("text");
        case "dlg-copy-link":
          return copyFrom("link");
        case "dlg-log":
          return logLink();
        case "dlg-skip":
        case "close-dialog":
          return ctx.closeDialog();
        case "edit-cancel":
          editing = null;
          templateError = "";
          return renderTemplates();
      }
      if (!name.startsWith("group-") && !name.startsWith("item-")) return;
      return guarded("chat.template", () => {
        const groups = groupsNow();
        switch (name) {
          case "group-add":
            return change(tpl.addGroup(groups, value("wa-new-group")));
          case "group-edit":
            editing = { kind: "group", id: d.gid };
            return renderTemplates();
          case "group-save":
            return change(tpl.renameGroup(groups, d.gid, value("wa-edit-group")));
          case "group-del":
            if (armed !== "g:" + d.gid) {
              armed = "g:" + d.gid;
              return renderTemplates();
            }
            return change(tpl.deleteGroup(groups, d.gid));
          case "group-up":
            return change(tpl.moveGroup(groups, d.gid, -1));
          case "group-down":
            return change(tpl.moveGroup(groups, d.gid, 1));
          case "item-add":
            return change(tpl.addItem(groups, d.gid, value("wa-new-item-" + d.gid)));
          case "item-edit":
            editing = { kind: "item", id: d.id };
            return renderTemplates();
          case "item-save":
            return change(tpl.editItem(groups, d.gid, d.id, value("wa-edit-item")));
          case "item-del":
            if (armed !== "i:" + d.id) {
              armed = "i:" + d.id;
              return renderTemplates();
            }
            return change(tpl.deleteItem(groups, d.gid, d.id));
          case "item-up":
            return change(tpl.moveItem(groups, d.gid, d.id, -1));
          case "item-down":
            return change(tpl.moveItem(groups, d.gid, d.id, 1));
        }
      });
    }

    const controller = {
      render,
      renderTemplates,
      action,
      openDialog,
      openImport,
      openLog,
      selected: () => selected,
      select(name) {
        selected = name || "";
      },
      renderChatEntry: (entry) => renderChatEntry(entry, E),
    };
    return controller;
  }

  root.LaiWhatsAppUI = { create, renderChatEntry, conversations, dayGroups, bubblesHtml, entryLines, chatEntries, tplGroups, tpl, leftovers, LIMITS, VARIABLES, FILTERS, EMPTY_TEXT, TRIAL_NOTE, COUNTRY_CODES };
  if (typeof module !== "undefined" && module.exports) module.exports = root.LaiWhatsAppUI;
})(typeof window === "undefined" ? globalThis : window);
