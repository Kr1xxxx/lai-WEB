(function (root) {
  "use strict";
  function create(ctx) {
    const B = root.LaiBusinessModel,
      E = ctx.escape;
    // 团队数据模块只在打开对应页面时才取用。
    let teamReport = null,
      teamUI = null;
    const TU = () => teamUI || (teamUI = root.LaiTeamUI.create(E));
    let route = "dashboard",
      search = "",
      stage = "",
      currency = "",
      page = 1,
      month = B.localDate().slice(0, 7),
      selectedDate = "",
      draft = null,
      settingsDirty = false;
    const state = () => ctx.getState();
    const label = (id) =>
      B.stages.find((s) => s.id === id)?.label || id || "未填写";
    const date = (value) => String(value || "").slice(0, 10) || "—";
    const money = (value, code = "USD") =>
      `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${E(code)}`;
    const option = (value, title, current) =>
      `<option value="${E(value)}" ${String(value) === String(current) ? "selected" : ""}>${E(title)}</option>`;
    const button = (action, text, extra = "", primary = false) =>
      `<button type="button" ${primary ? 'class="primary"' : ""} data-biz-action="${action}" ${extra}>${text}</button>`;
    const header = (title, description, actions = "") =>
      `<div class="pagebar"><div class="business-title"><h1>${title}</h1><span>${description}</span></div><div class="page-actions">${actions}</div></div>`;
    const openButton = (o) =>
      `<button class="company-link" data-biz-order="${E(o.id)}">${E(o.num || "未编号")}</button>`;
    const activeOrders = () => state().orders || [];
    const customerButton = (name) =>
      `<button class="company-link" data-biz-customer="${E(name)}">${E(name)}</button>`;
    function filteredOrders() {
      return activeOrders()
        .filter(
          (o) =>
            (!stage || o.stage === stage) &&
            (!currency || (o.currency || "USD") === currency) &&
            (!search ||
              [
                o.num,
                o.client,
                o.country,
                o.trackingNumber,
                o.productType,
              ].some((v) =>
                String(v || "")
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )),
        )
        .slice()
        .sort((a, b) =>
          String(b.createdAt || b.updated || "").localeCompare(
            String(a.createdAt || a.updated || ""),
          ),
        );
    }
    function metricsMarkup(orders) {
      const m = B.orderMetrics(orders);
      return `<div class="money-summary"><div class="section-head"><h3>金额概览</h3><span class="muted tiny">按币种分别统计 · 不含草稿</span></div><table class="order-table"><thead><tr><th>币种</th><th>订单数</th><th>订单金额</th><th>已收款</th><th>待收款</th></tr></thead><tbody>${m.byCurrency.map((c) => `<tr><td><span class="currency-badge">${E(c.currency)}</span></td><td>${c.count}</td><td>${money(c.total, c.currency)}</td><td>${money(c.paid, c.currency)}</td><td>${money(c.due, c.currency)}</td></tr>`).join("") || '<tr><td colspan="5">暂无订单金额</td></tr>'}</tbody></table></div>`;
    }
    function renderDashboard() {
      const orders = activeOrders(),
        m = B.orderMetrics(orders),
        tasks = (state().laiTasks || []).filter((t) => !t.done),
        today = B.localDate(),
        followups = Object.entries(state().customers || {}).filter(
          ([, c]) =>
            root.LaiModules.bucket(c) !== "trash" &&
            c.nextFollow &&
            date(c.nextFollow) <= today,
        );
      return (
        header(
          "工作台",
          "查看客户跟进与订单进度",
          button("new-order", "＋ 新建订单", "", true),
        ) +
        `<div class="business-scroll"><div class="business-kpis">${[
          ["有效订单", m.count],
          ["未完成订单", m.activeCount],
          ["待跟进客户", followups.length],
          ["待办任务", tasks.length],
        ]
          .map(([t, n]) => `<div><span>${t}</span><strong>${n}</strong></div>`)
          .join(
            "",
          )}</div><div class="business-section"><div class="section-head"><h3>订单进度</h3>${button("orders", "查看全部订单")}</div><div class="pipeline">${B.stages
          .map((s) => {
            const list = orders.filter((o) => !o.isDraft && o.stage === s.id);
            return `<section><h4><span>${s.label}</span><b>${list.length}</b></h4><div class="pipeline-cards">${
              list
                .slice(0, 7)
                .map(
                  (o) =>
                    `<button class="pipeline-card" data-biz-order="${E(o.id)}"><strong>${E(o.client)}</strong><span>${E(o.num)}</span><b>${money(o.amount, o.currency || "USD")}</b></button>`,
                )
                .join("") || '<p class="muted tiny">暂无订单</p>'
            }${list.length > 7 ? `<button class="text-button tiny" data-biz-stage="${s.id}">查看全部 ${list.length} 笔</button>` : ""}</div></section>`;
          })
          .join(
            "",
          )}</div></div><div class="business-columns"><section class="business-section"><div class="section-head"><h3>待跟进客户</h3><span class="muted tiny">截至今天</span></div>${
          followups
            .slice(0, 8)
            .map(
              ([name, c]) =>
                `<div class="business-line">${customerButton(name)}<time>${date(c.nextFollow)}</time></div>`,
            )
            .join("") || '<div class="small-empty">暂无到期跟进</div>'
        }</section><section class="business-section"><div class="section-head"><h3>我的待办</h3>${button("new-task", "＋ 添加任务")}</div>${
          tasks
            .slice(0, 8)
            .map((task) => taskMarkup(task))
            .join("") || '<div class="small-empty">暂无待办任务</div>'
        }</section></div>${metricsMarkup(orders)}</div>`
      );
    }
    function taskMarkup(t) {
      return `<div class="business-line task-line"><label><input type="checkbox" data-biz-task="${E(t.id)}" ${t.done ? "checked" : ""}> <span class="${t.done ? "done-text" : ""}">${E(t.title)}</span></label><time>${date(t.date)}</time></div>`;
    }
    function renderOrders() {
      const filtered = filteredOrders(),
        size = 20,
        pages = Math.max(1, Math.ceil(filtered.length / size));
      page = Math.min(page, pages);
      const items = filtered.slice((page - 1) * size, page * size);
      return (
        header(
          "订单管理",
          `${activeOrders().length} 笔订单`,
          button("order-trash", "订单回收站") +
            button("new-order", "＋ 新建订单", "", true),
        ) +
        `<section class="business-section order-workspace"><div class="business-toolbar"><input class="business-search" id="biz-search" aria-label="搜索订单" placeholder="订单号、客户、物流单号…" value="${E(search)}"><select id="biz-stage" aria-label="订单阶段">${option("", "全部阶段", stage)}${B.stages.map((s) => option(s.id, s.label, stage)).join("")}</select><select id="biz-currency" aria-label="订单币种">${option("", "全部币种", currency)}${[...new Set(activeOrders().map((o) => o.currency || "USD"))].map((c) => option(c, c, currency)).join("")}</select>${button("clear-filters", "清除筛选")}</div><div class="business-table-scroll" id="biz-order-scroll"><table class="order-table unified-orders"><thead><tr><th>订单编号</th><th>客户名称</th><th>国家地区</th><th>创建日期</th><th>产品</th><th>订单金额</th><th>已收款</th><th>阶段</th><th>物流单号</th><th>操作</th></tr></thead><tbody>${items.map((o) => `<tr><td>${openButton(o)}${o.isDraft ? '<span class="tag">草稿</span>' : ""}</td><td>${customerButton(o.client)}</td><td>${E(o.country || "—")}</td><td>${date(o.createdAt)}</td><td>${E(o.productType || "—")}</td><td>${money(o.amount, o.currency || "USD")}</td><td>${money(["shipment", "done"].includes(o.stage) ? o.amount : o.paidAmount, o.currency || "USD")}</td><td><span class="tag stage-${E(o.stage)}">${E(label(o.stage))}</span></td><td>${E(o.trackingNumber || "—")}</td><td><button class="text-button" data-biz-order="${E(o.id)}">查看 / 编辑</button></td></tr>`).join("")}</tbody></table>${items.length ? "" : '<div class="empty"><strong>没有符合条件的订单</strong><span>调整筛选条件，或新建一笔订单。</span></div>'}</div><footer class="pagination"><span>共 ${filtered.length} 笔订单</span><div class="pages">${button("prev", "‹", page === 1 ? "disabled" : "")}<span>${page} / ${pages}</span>${button("next", "›", page === pages ? "disabled" : "")}</div></footer></section>`
      );
    }
    function renderOrderTrash() {
      const orders = state().trashOrders || [];
      return (
        header(
          "订单回收站",
          "已归档订单可恢复",
          button("orders", "返回订单列表"),
        ) +
        `<section class="business-section"><div class="module-note">归档只移动订单，保留客户、历史、附件引用和原始字段。</div><table class="order-table"><thead><tr><th>订单编号</th><th>客户</th><th>金额</th><th>归档时间</th><th>操作</th></tr></thead><tbody>${orders.map((o) => `<tr><td>${E(o.num)}</td><td>${E(o.client)}</td><td>${money(o.amount, o.currency || "USD")}</td><td>${date(o.trashedAt)}</td><td>${button("restore-order", "恢复订单", `data-id="${E(o.id)}"`)}</td></tr>`).join("")}</tbody></table>${orders.length ? "" : '<div class="empty"><strong>订单回收站为空</strong></div>'}</section>`
      );
    }
    function renderAnalysis() {
      const analysis = B.monthlyAnalysis(activeOrders(), month),
        orders = analysis.orders;
      return (
        header(
          "经营统计",
          "订单与客户贡献按币种展示",
          `<input type="month" id="biz-month" value="${month}" aria-label="统计月份">`,
        ) +
        `<div class="business-scroll">${metricsMarkup(orders)}<div class="business-columns"><section class="business-section"><div class="section-head"><h3>订单阶段分布</h3></div><div class="stage-bars">${analysis.stages
          .map(
            (s) =>
              `<div><span>${s.label}</span><div><i style="width:${s.percent}%"></i></div><b>${s.count}</b></div>`,
          )
          .join(
            "",
          )}</div></section><section class="business-section"><div class="section-head"><h3>客户贡献</h3><span class="muted tiny">按币种分组，再按金额排序</span></div><table class="order-table"><thead><tr><th>客户</th><th>订单数</th><th>订单金额</th></tr></thead><tbody>${
          analysis.contributions
            .slice(0, 15)
            .map(
              (c) =>
                `<tr><td>${customerButton(c.client)}</td><td>${c.count}</td><td>${money(c.amount, c.currency)}</td></tr>`,
            )
            .join("") || '<tr><td colspan="3">本月暂无订单</td></tr>'
        }</tbody></table></section></div></div>`
      );
    }
    function renderTeam(kind) {
      teamReport = root.LaiTeamModel.report(kind, state(), month);
      return (
        header(
          teamReport.title,
          "按跟进人名称汇总 · 数字可点开看明细",
          `<input type="month" id="biz-month" value="${month}" aria-label="统计月份">`,
        ) + TU().markup(teamReport)
      );
    }
    function showTeamDetail(key) {
      const found = teamReport && TU().itemsFor(teamReport, key);
      if (!found) return;
      ctx.dialog(
        E(found.label),
        TU().detailMarkup(found.items),
        '<button class="primary" data-action="close-modal">关闭</button>',
        "team-detail",
      );
    }
    function renderCalendar() {
      const events = B.calendarEvents(state(), month),
        [year, mo] = month.split("-").map(Number),
        offset = (new Date(year, mo - 1, 1).getDay() + 6) % 7,
        days = new Date(year, mo, 0).getDate();
      const shown = selectedDate
        ? events.filter((e) => e.date === selectedDate)
        : events;
      return (
        header(
          "日历",
          "订单、客户跟进与待办任务",
          button("month-prev", "‹") +
            `<input type="month" id="biz-month" value="${month}" aria-label="日历月份">` +
            button("month-next", "›") +
            button("new-task", "＋ 添加任务", "", true),
        ) +
        `<div class="business-scroll calendar-layout"><section class="business-section"><div class="calendar-week">${["一", "二", "三", "四", "五", "六", "日"].map((d) => `<span>周${d}</span>`).join("")}</div><div class="calendar-grid">${Array.from({ length: offset }, () => '<div class="calendar-blank"></div>').join("")}${Array.from(
          { length: days },
          (_, i) => {
            const day = month + "-" + String(i + 1).padStart(2, "0"),
              list = events.filter((e) => e.date === day);
            return `<button class="calendar-day ${selectedDate === day ? "selected" : ""}" data-biz-day="${day}"><b>${i + 1}</b>${list
              .slice(0, 3)
              .map(
                (e) =>
                  `<span class="calendar-event ${e.kind}">${E(e.title)}</span>`,
              )
              .join(
                "",
              )}${list.length > 3 ? `<small>+ ${list.length - 3} 项</small>` : ""}</button>`;
          },
        ).join(
          "",
        )}</div></section><aside class="business-section calendar-agenda"><div class="section-head"><h3>${selectedDate || month} 日程</h3>${selectedDate ? button("all-days", "全部") : ""}</div>${shown.map((e) => `<button class="agenda-item" ${e.kind === "order" ? `data-biz-order="${E(e.id)}"` : e.kind === "followup" ? `data-biz-customer="${E(e.customer)}"` : `data-biz-edit-task="${E(e.id)}"`}><time>${e.date}</time><strong>${E(e.title)}</strong><span>${{ order: "订单", followup: "客户跟进", task: "待办任务" }[e.kind]}</span></button>`).join("") || '<div class="small-empty">暂无日程</div>'}</aside></div>`
      );
    }
    function renderSettings() {
      const settings = state().laiSettings || {},
        old = state().orderSettings || {};
      return (
        header("设置", "来财的默认录入与本地数据管理") +
        `<div class="business-scroll settings-layout"><form id="biz-settings-form" class="business-section"><div class="section-head"><h3>默认录入</h3></div><div class="form-grid"><label class="field">公司名称<input name="companyName" value="${E(settings.companyName || "来财Lai")}"></label><label class="field">订单编号前缀<input name="orderPrefix" value="${E(settings.orderPrefix || old.orderPrefix || "L")}" required pattern="[A-Za-z0-9-]+" maxlength="12"></label><label class="field">默认币种<select name="defaultCurrency">${["USD", "EUR", "GBP", "CNY", "CAD", "AUD"].map((c) => option(c, c, settings.defaultCurrency || old.defaultCurrency || "USD")).join("")}</select></label><label class="field">默认跟进人<input name="defaultOwner" value="${E(settings.defaultOwner || old.defaultOwner || "")}"></label></div><div class="error" id="biz-settings-error" role="alert"></div><div class="settings-actions">${button("discard-settings", "取消修改")}<button class="primary" type="submit">保存设置</button></div></form><section class="business-section"><div class="section-head"><h3>本地数据</h3><span class="tag green">来财独立存储</span></div><p class="settings-copy">客户、订单、客群和日历任务保存在同一个来财数据库。原 TOS 数据不与来财互相覆盖。</p><div class="settings-actions">${button("backup", "立即备份")}${button("open-folder", "打开数据目录")}</div><div id="biz-backup-status" class="muted tiny" role="status"></div><div class="section-rule"></div><h3>来财Lai</h3><p class="settings-copy">统一客户与经营界面。没有旧页面跳转，不自动连接外部服务。</p></section></div>`
      );
    }
    function render(preserveOrderScroll = false) {
      const previous = preserveOrderScroll && route === "order-list"
        ? document.getElementById("biz-order-scroll") : null;
      const scroll = previous
        ? { top: previous.scrollTop, left: previous.scrollLeft } : null;
      settingsDirty = false;
      const views = {
        dashboard: renderDashboard,
        "order-list": renderOrders,
        "order-trash": renderOrderTrash,
        analysis: renderAnalysis,
        "team-assets": () => renderTeam("assets"),
        "team-followups": () => renderTeam("followups"),
        "team-tasks": () => renderTeam("tasks"),
        "team-orders": () => renderTeam("orders"),
        calendar: renderCalendar,
        settings: renderSettings,
      };
      ctx.mount((views[route] || renderDashboard)());
      if (scroll) {
        const current = document.getElementById("biz-order-scroll");
        if (current) {
          current.scrollTop = scroll.top;
          current.scrollLeft = scroll.left;
        }
      }
    }
    function orderEditor(id, unsaved, returnCustomer = "") {
      const old = activeOrders().find((o) => o.id === id);
      if (id !== undefined && !old) {
        ctx.toast("订单不存在，可能已移入回收站，请刷新列表后重试");
        return;
      }
      const defaults = state().laiSettings || state().orderSettings || {},
        today = B.localDate();
      draft = { id: id || crypto.randomUUID(), isNew: !old, returnCustomer };
      const o = unsaved ||
        old || {
          createdAt: today,
          num:
            (defaults.orderPrefix || "L") +
            today.replaceAll("-", "") +
            "-" +
            String(activeOrders().length + 1).padStart(3, "0"),
          currency: defaults.defaultCurrency || "USD",
          owner: defaults.defaultOwner || "",
          stage: "quote",
          amount: "",
          client: returnCustomer,
          paidAmount: 0,
        };
      const field = (name, title, type = "text", wide = false) =>
        `<label class="field ${wide ? "wide" : ""}">${title}<input name="${name}" type="${type}" value="${E(type === "date" ? String(o[name] || "").slice(0, 10) : (o[name] ?? ""))}" ${["num", "client", "amount", "createdAt"].includes(name) ? "required" : ""} ${["amount", "paidAmount"].includes(name) ? 'min="0" step="0.01"' : ""} ${name === "client" ? 'list="biz-customer-names"' : ""}></label>`;
      ctx.dialog(
        old ? "编辑订单" : "新建订单",
        `<form class="drawer-body" id="biz-order-form"><div class="error" id="biz-order-error" role="alert"></div><div class="form-section">订单信息</div><div class="form-grid">${field("num", "订单编号")}${field("client", "客户名称")}${field("country", "国家地区")}${field("productType", "产品")}${field("amount", "订单金额", "number")}<label class="field">币种<select name="currency">${[...new Set([o.currency || "USD", "USD", "EUR", "GBP", "CNY", "CAD", "AUD"])].map((c) => option(c, c, o.currency || "USD")).join("")}</select></label>${field("paidAmount", "已收款", "number")}<label class="field">订单阶段<select name="stage">${B.stages.map((s) => option(s.id, s.label, o.stage)).join("")}</select></label>${field("createdAt", "创建日期", "date")}${field("owner", "跟进人")}${field("trackingNumber", "物流单号")}${field("carrier", "承运商")}<label class="field wide">订单备注<textarea name="note" rows="3">${E(o.note || "")}</textarea></label>${field("next", "下一步", "text", true)}<label class="business-check"><input type="checkbox" name="isDraft" ${o.isDraft ? "checked" : ""}> 保存为草稿</label></div><datalist id="biz-customer-names">${Object.keys(
          state().customers || {},
        )
          .filter(
            (n) => root.LaiModules.bucket(state().customers[n]) !== "trash",
          )
          .map((n) => `<option value="${E(n)}">`)
          .join(
            "",
          )}</datalist>${old ? `<p class="muted tiny">已有历史与附件资料会保留。已发货 / 已完成按订单全额计已收款。</p>` : ""}</form>`,
        `${old ? button("archive-order", "移入回收站", `data-id="${E(old.id)}"`) : ""}${button("close-editor", "取消")}<button class="primary" type="submit" form="biz-order-form">保存订单</button>`,
        "business-order",
      );
    }
    function taskEditor(id) {
      const old = (state().laiTasks || []).find((t) => t.id === id);
      if (id !== undefined && !old) {
        ctx.toast("待办不存在，请刷新列表后重试");
        return;
      }
      const t = old || {
        title: "",
        date: selectedDate || B.localDate(),
        done: false,
      };
      draft = { id: id || crypto.randomUUID(), task: true };
      ctx.dialog(
        id ? "编辑待办" : "添加待办",
        `<form id="biz-task-form" class="drawer-body"><div class="form-grid"><label class="field wide">任务名称<input name="title" value="${E(t.title)}" required maxlength="200"></label><label class="field">日期<input type="date" name="date" value="${E(t.date)}" required></label><label class="business-check"><input type="checkbox" name="done" ${t.done ? "checked" : ""}> 已完成</label></div><div class="error" id="biz-task-error" role="alert"></div></form>`,
        `${button("close-editor", "取消")}<button class="primary" type="submit" form="biz-task-form">保存任务</button>`,
        "business-task",
      );
    }
    async function saveNext(makeNext, errorId, after) {
      const controls = [
          ...document.querySelectorAll("button,input,select,textarea"),
        ],
        disabled = controls.map((e) => e.disabled);
      controls.forEach((e) => (e.disabled = true));
      try {
        await ctx.save(makeNext());
        if (after?.() !== false) render(true);
        ctx.toast("已保存到来财");
        return true;
      } catch (error) {
        const target = document.getElementById(errorId);
        if (target) {
          target.textContent = error.message;
          target.classList.add("visible");
        } else ctx.toast(error.message);
        return false;
      } finally {
        controls.forEach((e, i) => (e.disabled = disabled[i]));
      }
    }
    function finishEditor() {
      const returnCustomer = draft?.returnCustomer;
      draft = null;
      ctx.closeDialog();
      if (returnCustomer) {
        ctx.refreshCustomer(returnCustomer);
        return false;
      }
    }
    let archiveDraft = null;
    function archiveOrder(id) {
      const form = document.getElementById("biz-order-form");
      archiveDraft = form
        ? {
            ...Object.fromEntries(new FormData(form)),
            isDraft: form.elements.isDraft.checked,
          }
        : null;
      ctx.dialog(
        "移入订单回收站",
        `<div class="drawer-body"><p>归档 ${E(activeOrders().find((o) => o.id === id)?.num || "此订单")}？</p><div class="module-note">订单和客户资料保留，可从订单回收站恢复。</div><div id="biz-order-error" class="error" role="alert"></div></div>`,
        `${button("cancel-archive", "返回编辑", `data-id="${E(id)}"`)}${button("confirm-archive", "确认归档", `data-id="${E(id)}"`, true)}`,
        "business-order",
      );
    }
    async function localAction(name) {
      const target = document.getElementById("biz-backup-status");
      if (target)
        target.textContent = name === "backup" ? "正在备份…" : "正在打开…";
      try {
        const response = await fetch(
            name === "backup" ? "/api/manual-backup" : "/api/open-data-folder",
            { method: "POST" },
          ),
          result = await response.json();
        if (!response.ok || result.ok === false)
          throw Error(result.message || "操作失败");
        if (target)
          target.textContent =
            name === "backup" ? "备份已保存到来财数据目录。" : "已打开数据目录";
        ctx.toast(name === "backup" ? "备份完成" : "已打开数据目录");
      } catch (e) {
        if (target) target.textContent = e.message;
        ctx.toast(e.message);
      }
    }
    document.addEventListener("click", (e) => {
      const el = e.target.closest("button");
      if (!el || el.disabled) return;
      const d = el.dataset;
      if (d.teamDetail) return showTeamDetail(d.teamDetail);
      if (d.bizOrder) return orderEditor(d.bizOrder);
      if (d.bizCustomer) return ctx.openCustomer(d.bizCustomer);
      if (d.bizStage) {
        stage = d.bizStage;
        page = 1;
        return ctx.navigate("order-list");
      }
      if (d.bizDay) {
        selectedDate = d.bizDay;
        return render();
      }
      if (d.bizEditTask) return taskEditor(d.bizEditTask);
      const action = d.bizAction;
      if (!action) return;
      if (action === "new-order") return orderEditor();
      if (action === "orders") return ctx.navigate("order-list");
      if (action === "order-trash") return ctx.navigate("order-trash");
      if (action === "new-task") return taskEditor();
      if (action === "close-editor") return finishEditor();
      if (action === "archive-order") return archiveOrder(d.id);
      if (action === "cancel-archive") return orderEditor(d.id, archiveDraft);
      if (action === "confirm-archive")
        return saveNext(
          () => B.archiveOrder(state(), d.id),
          "biz-order-error",
          finishEditor,
        );
      if (action === "restore-order")
        return saveNext(() => B.restoreOrder(state(), d.id), "", null);
      if (action === "prev" || action === "next") {
        page += action === "prev" ? -1 : 1;
        return render();
      }
      if (action === "clear-filters") {
        search = "";
        stage = "";
        currency = "";
        page = 1;
        return render();
      }
      if (action === "all-days") {
        selectedDate = "";
        return render();
      }
      if (action === "month-prev" || action === "month-next") {
        const [y, m] = month.split("-").map(Number),
          next = new Date(y, m - 1 + (action === "month-next" ? 1 : -1), 1);
        month =
          next.getFullYear() +
          "-" +
          String(next.getMonth() + 1).padStart(2, "0");
        selectedDate = "";
        return render();
      }
      if (action === "discard-settings") {
        settingsDirty = false;
        return render();
      }
      if (action === "backup" || action === "open-folder")
        return localAction(action);
    });
    document.addEventListener("input", (e) => {
      if (e.target.id === "biz-search") {
        search = e.target.value;
        if (e.isComposing) return;
        page = 1;
        const pos = e.target.selectionStart;
        render();
        const input = document.getElementById("biz-search");
        input.focus();
        input.setSelectionRange(pos, pos);
      }
      if (e.target.closest("#biz-settings-form")) settingsDirty = true;
    });
    document.addEventListener("compositionend", (e) => {
      if (e.target.id === "biz-search") {
        search = e.target.value;
        page = 1;
        render();
        document.getElementById("biz-search").focus();
      }
    });
    document.addEventListener("change", (e) => {
      if (e.target.id === "biz-stage") {
        stage = e.target.value;
        page = 1;
        render();
      }
      if (e.target.id === "biz-currency") {
        currency = e.target.value;
        page = 1;
        render();
      }
      if (e.target.id === "biz-month") {
        if (/^\d{4}-\d{2}$/.test(e.target.value)) {
          month = e.target.value;
          selectedDate = "";
          render();
        } else e.target.value = month;
      }
      if (e.target.dataset.bizTask) {
        const checkbox = e.target,
          id = checkbox.dataset.bizTask,
          task = (state().laiTasks || []).find((t) => t.id === id);
        return saveNext(
          () => B.setTask(state(), id, { ...task, done: checkbox.checked }),
          "",
        ).then((saved) => {
          if (!saved) checkbox.checked = task?.done === true;
        });
      }
      if (e.target.closest("#biz-settings-form")) settingsDirty = true;
    });
    document.addEventListener("submit", (e) => {
      const form = e.target;
      if (
        !["biz-order-form", "biz-task-form", "biz-settings-form"].includes(
          form.id,
        )
      )
        return;
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (form.id === "biz-order-form") {
        data.isDraft = form.elements.isDraft.checked;
        return saveNext(
          () => B.upsertOrder(state(), draft.id, data),
          "biz-order-error",
          finishEditor,
        );
      }
      if (form.id === "biz-task-form") {
        data.done = form.elements.done.checked;
        return saveNext(
          () => B.setTask(state(), draft.id, data),
          "biz-task-error",
          finishEditor,
        );
      }
      return saveNext(
        () => ({
          ...state(),
          laiSettings: { ...state().laiSettings, ...data },
        }),
        "biz-settings-error",
        () => (settingsDirty = false),
      );
    });
    return {
      openOrder: orderEditor,
      createOrderForCustomer(name) {
        const current = state();
        const known = Object.hasOwn(current.customers || {}, name) ||
          (current.orders || []).some((order) => order.client === name);
        if (!known || root.LaiModules.bucket(current.customers?.[name]) === "trash") {
          ctx.toast("客户不存在或已移入回收站，请刷新后重试");
          return;
        }
        orderEditor(undefined, undefined, name);
      },
      selectCalendarDate(date) {
        month = date.slice(0, 7);
        selectedDate = date;
        route = "calendar";
        render();
      },
      navigate(next) {
        route = next;
        render();
      },
      refresh: render,
      hasDraft: () => !!draft || settingsDirty,
      discardDraft() {
        draft = null;
      },
      route: () => route,
    };
  }
  root.LaiBusinessUI = { create };
})(window);
