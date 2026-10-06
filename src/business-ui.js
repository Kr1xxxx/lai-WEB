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
    // 目标完成情况 / 团队墙：页签、展示方式、列显示与排序只是界面状态，不保存。
    const teamView = { period: "month", tab: "result", mode: "rank", showTarget: true, showRate: true, sort: null, wallSort: null };
    let teamOverview = null;
    const monthInput = () => `<input type="month" id="biz-month" value="${month}" aria-label="统计月份">`;
    // 周期：按月看所选月份，按季度看所选月份所在的自然季度。
    const periodKey = () => (teamView.period === "quarter" ? root.LaiTeamModel.quarterOf(month) : month);
    const periodSwitch = () =>
      `<span class="team-segment team-period" role="group" aria-label="统计周期"><button type="button" data-team-period="month" aria-pressed="${teamView.period !== "quarter"}">按月</button><button type="button" data-team-period="quarter" aria-pressed="${teamView.period === "quarter"}">按季度</button></span>`;
    const targetsButton = () => '<button type="button" data-lai-route="team-targets">目标设置</button>';
    function renderGoals() {
      teamOverview = root.LaiTeamModel.overview(state(), periodKey());
      return (
        header(
          "目标完成情况",
          `${E(teamOverview.periodLabel)} · 按跟进人名称汇总`,
          `${periodSwitch()}${monthInput()}<span class="team-scope">我的企业</span>${targetsButton()}`,
        ) + TU().goalsMarkup(teamOverview, teamView)
      );
    }
    function renderWall() {
      teamOverview = root.LaiTeamModel.overview(state(), periodKey());
      return (
        header(
          "团队墙",
          `${E(teamOverview.periodLabel)} · 按跟进人名称汇总`,
          `${periodSwitch()}${monthInput()}${targetsButton()}<button type="button" data-team-refresh="1">刷新</button>`,
        ) + TU().wallMarkup(teamOverview, teamView, B.localDate())
      );
    }
    const nextSort = (current, id) => ({ id, dir: current?.id === id && current.dir !== "asc" ? "asc" : "desc" });
    function teamViewAction(d) {
      let focus = "";
      if (d.teamPeriod) {
        teamView.period = d.teamPeriod === "quarter" ? "quarter" : "month";
        focus = `[data-team-period="${teamView.period}"]`;
      } else if (d.teamTab) {
        teamView.tab = d.teamTab === "process" ? "process" : "result";
        teamView.sort = null;
        focus = `[data-team-tab="${teamView.tab}"]`;
      } else if (d.teamMode) {
        teamView.mode = d.teamMode === "trend" ? "trend" : "rank";
        focus = `[data-team-mode="${teamView.mode}"]`;
      } else if (d.teamToggle === "target" || d.teamToggle === "rate") {
        const key = d.teamToggle === "target" ? "showTarget" : "showRate";
        teamView[key] = !teamView[key];
        focus = `[data-team-toggle="${d.teamToggle}"]`;
      } else if (d.teamSort && Object.hasOwn(TU().columns, d.teamSort)) {
        teamView.sort = nextSort(teamView.sort || { id: TU().tabs[teamView.tab][0], dir: "desc" }, d.teamSort);
        focus = `[data-team-sort="${d.teamSort}"]`;
      } else if (d.teamWallSort && Object.hasOwn(TU().columns, d.teamWallSort)) {
        teamView.wallSort = nextSort(teamView.wallSort || { id: "added", dir: "desc" }, d.teamWallSort);
        focus = `[data-team-wall-sort="${d.teamWallSort}"]`;
      } else if (d.teamRefresh) {
        focus = "[data-team-refresh]";
        ctx.toast("已按当前数据刷新");
      } else return false;
      render();
      document.querySelector?.(focus)?.focus({ preventScroll: true });
      return true;
    }
    let armedTarget = "";
    function renderTargets() {
      const T = root.LaiTeamModel;
      return (
        header(
          "目标管理",
          "按周期、对象、指标保存的目标值",
          `${monthInput()}<button type="button" class="primary" data-team-target="new">新建目标</button>`,
        ) + TU().targetsMarkup(T.listTargets(state()), T.periodLabel, armedTarget)
      );
    }
    function showTargetForm(metric) {
      const T = root.LaiTeamModel;
      // 每次打开都按当前数据重新计算，成员名单和默认币种不会停留在上一次看页面时的样子。
      const overview = T.overview(state(), periodKey());
      const quarter = T.quarterOf(month);
      // 修改已有的企业目标时带出原来的数值；金额有多个币种时带出第一个。
      const existing = Object.hasOwn(overview.goals, metric) ? overview.goals[metric][0] : null;
      ctx.dialog(
        "设置目标",
        TU().targetFormMarkup(overview, {
          metric,
          period: periodKey(),
          value: existing?.value,
          currency: existing?.currency,
          periods: [
            { key: month, label: T.periodLabel(month) },
            { key: quarter, label: T.periodLabel(quarter) },
          ],
        }),
        '<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="biz-target-form">保存目标</button>',
        "team-target",
      );
    }
    // 删除需要点两次：第一次只把按钮变成「再点一次确认删除」。
    function removeTarget(key) {
      if (armedTarget !== key) {
        armedTarget = key;
        return render();
      }
      armedTarget = "";
      return saveNext(() => root.LaiTeamModel.removeTarget(state(), key), "").then((saved) => {
        if (!saved) render();
        return saved;
      });
    }
    // 把当前看到的成员排行榜导出为 Excel（与导入模板下载用同一种方式）。
    function exportBoard() {
      if (!teamOverview) return;
      if (!root.XLSX) return ctx.toast("Excel 组件未加载，请重新打开来财");
      const workbook = root.XLSX.utils.book_new();
      root.XLSX.utils.book_append_sheet(workbook, root.XLSX.utils.aoa_to_sheet(TU().boardRows(teamOverview, teamView)), teamView.tab === "process" ? "过程目标" : "结果目标");
      const bytes = root.XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `来财-目标完成情况-${teamOverview.period}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      ctx.toast("已导出成员排行榜");
    }
    function showTeamRule(id) {
      if (!teamOverview || !Object.hasOwn(TU().columns, id)) return;
      const column = TU().columns[id];
      ctx.dialog(
        `${E(column.label)} · 统计规则`,
        `<div class="drawer-body"><p>${E(teamOverview.rules[id])}</p></div>`,
        '<button class="primary" data-action="close-modal">知道了</button>',
        "team-rule",
      );
    }
    // ---------- 商机：看板、表单、阶段流转、归档删除、生成订单、分析 ----------
    const OM = () => root.LaiOpportunityModel;
    let oppUI = null;
    const OU = () => oppUI || (oppUI = root.LaiOpportunityUI.create(E, OM()));
    const oppView = { mode: "board", limits: {}, filters: {}, range: "all", analysisCurrency: "" };
    let oppDraft = null,
      oppArmed = "",
      oppDrag = "",
      // 从客户详情页发起的商机操作：记下客户名，保存后回到该客户，而不是画商机页面。
      oppReturn = "";
    const onOppPage = () => route === "opportunities" || route === "opp-analysis" || !!oppReturn;
    const oppDone = () => {
      const back = oppReturn;
      ctx.closeDialog();
      if (back) {
        ctx.refreshCustomer(back);
        return false;
      }
    };
    function renderOpportunities() {
      const today = B.localDate();
      const board = OM().board(state(), oppView.filters, today);
      const context = { owners: OM().ownerNames(state()), today };
      return header("商机", "按销售阶段跟进每一笔机会", OU().headerActions(board, context)) + OU().boardMarkup(board, oppView, context);
    }
    function renderOppAnalysis() {
      const T = root.LaiTeamModel;
      const months = oppView.range === "month" ? [month] : oppView.range === "quarter" ? T.periodMonths(T.quarterOf(month)) : null;
      const report = OM().analysis(state(), { months, currency: oppView.analysisCurrency }, B.localDate());
      const label = months ? T.periodLabel(months.length > 1 ? T.quarterOf(month) : month) : "全部时间";
      const range = (id, text) => `<button type="button" data-opp-range="${id}" aria-pressed="${oppView.range === id}">${text}</button>`;
      return (
        header(
          "商机分析",
          `${E(label)} · 按商机创建时间统计`,
          `<span class="team-segment team-period" role="group" aria-label="统计范围">${range("all", "全部")}${range("month", "按月")}${range("quarter", "按季度")}</span>${months ? monthInput() : ""}`,
        ) + OU().analysisMarkup(report)
      );
    }
    const oppItem = (id) => OM().list(state()).find((item) => item.id === id);
    const oppCard = (id) => OM().cardOf(state(), id, B.localDate());
    function openOppForm(id, client = "") {
      let next;
      if (id === undefined) next = { id: crypto.randomUUID(), isNew: true, values: { ...OM().defaults(state(), B.localDate()), client } };
      else {
        const item = oppItem(id);
        if (!item) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
        next = { id, isNew: false, values: { ...item } };
      }
      const values = next.values;
      try {
        ctx.dialog(
          next.isNew ? "新建商机" : "编辑商机",
          OU().formMarkup(values, {
            customers: OM().customerNames(state()),
            contacts: OM().contactsOf(state(), String(values.client || "").trim()),
            owners: OM().ownerNames(state()),
            isNew: next.isNew,
          }),
          '<button type="button" data-action="close-modal">取 消</button><button class="primary" type="submit" form="opp-form">确 定</button>',
          "business-opportunity",
        );
      } catch (error) {
        // 表单没能打开时不留下「正在编辑」的状态，否则会挡住之后的页面切换。
        return ctx.toast(`无法打开商机表单：${error.message}`);
      }
      // 只有表单真的打开了才算进入编辑；记下原来的客户和联系人，换回原客户时能恢复原联系人。
      oppDraft = { id: next.id, isNew: next.isNew, client: String(values.client || "").trim(), contact: String(values.contact || "") };
    }
    // 客户、阶段、命名方式、币种变化时，只就地更新表单里受影响的那几处，不重画，不打断正在输入的内容。
    function syncOppForm(name) {
      const form = document.getElementById("opp-form");
      if (!form || !oppDraft) return;
      const el = form.elements;
      if (name === "client") {
        const client = String(el.client.value || "").trim();
        const contacts = OM().contactsOf(state(), client);
        el.contact.innerHTML = OU().contactOptions(contacts, client === oppDraft.client ? oppDraft.contact : "", client);
        el.contact.required = contacts.length > 0;
      } else if (name === "stage") {
        const lost = el.stage.value === "lost";
        for (const field of [el.lostReason, el.lostNote]) {
          field.disabled = !lost;
          const label = field.closest("label");
          if (label) label.hidden = !lost;
        }
        el.lostReason.required = lost;
      } else if (name === "nameMode") {
        const custom = el.nameMode.value === "custom";
        el.name.disabled = !custom;
        el.name.hidden = !custom;
        el.name.required = custom;
        const note = document.getElementById("opp-name-note");
        if (note) note.hidden = custom;
      } else if (name === "currency") {
        const rate = el.exchangeRate;
        const usd = String(el.currency.value || "").trim().toUpperCase() === "USD";
        if (usd && !rate.readOnly) {
          rate.dataset.rate = rate.value;
          rate.value = "100";
        } else if (!usd && rate.readOnly) rate.value = rate.dataset.rate || "100";
        rate.readOnly = usd;
      }
    }
    function showOppMenu(id) {
      const card = oppCard(id);
      if (!card) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      ctx.dialog(E(card.name), OU().menuMarkup(card, oppArmed === id), '<button type="button" data-action="close-modal">关闭</button>', "opp-menu");
    }
    function showOppLost(id) {
      const card = oppCard(id);
      if (!card) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      ctx.dialog("移到输单", OU().lostMarkup(card), '<button type="button" data-action="close-modal">取 消</button><button class="primary" type="submit" form="opp-lost-form">确 定</button>', "opp-lost");
    }
    function moveOpp(id, stage, errorId) {
      const item = oppItem(id);
      if (!item) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      if (item.stage === stage) return;
      if (stage === "lost") return showOppLost(id);
      return saveNext(() => OM().moveStage(state(), id, stage), errorId, oppDone);
    }
    const nextOrderNumber = () => {
      const defaults = state().laiSettings || state().orderSettings || {};
      return (defaults.orderPrefix || "L") + B.localDate().replaceAll("-", "") + "-" + String(activeOrders().length + 1).padStart(3, "0");
    };
    // 赢单商机生成订单：打开现有的订单表单并预填，保存订单时同时把订单记到商机上。
    function orderFromOpp(id) {
      const item = oppItem(id);
      if (!item) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      const card = oppCard(id);
      if (!OM().STAGES.some((stage) => stage.id === item.stage && stage.kind === "won")) return ctx.toast("只有赢单阶段的商机可以生成订单");
      if (card.orderId) return ctx.toast("这个商机已经关联了订单");
      const back = oppReturn;
      ctx.closeDialog();
      orderEditor(undefined, { ...OM().orderDraft(item, B.localDate()), num: nextOrderNumber() }, back);
      if (draft) draft.fromOpportunity = id;
    }
    function oppAction(d) {
      const action = d.oppAction;
      if (action !== "delete") oppArmed = "";
      if (action === "new") return openOppForm();
      if (action === "edit") return openOppForm(d.id);
      if (action === "menu") return showOppMenu(d.id);
      if (action === "more") {
        oppView.limits[d.stage] = Math.max(root.LaiOpportunityUI.PAGE, Number(oppView.limits[d.stage]) || 0) + root.LaiOpportunityUI.PAGE;
        return render();
      }
      if (action === "move") return moveOpp(d.id, d.stage, "opp-menu-error");
      if (action === "archive") return saveNext(() => OM().setArchived(state(), d.id, d.archived === "1"), "opp-menu-error", oppDone);
      if (action === "order") return orderFromOpp(d.id);
      if (action === "delete") {
        if (oppArmed !== d.id) {
          oppArmed = d.id;
          return showOppMenu(d.id);
        }
        oppArmed = "";
        return saveNext(() => OM().remove(state(), d.id), "opp-menu-error", oppDone);
      }
    }
    const OPP_FILTERS = { "opp-sort": "sort", "opp-currency": "currency", "opp-date-field": "dateField", "opp-from": "from", "opp-to": "to", "opp-archived": "archived", "opp-owner": "owner", "opp-search": "search" };
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
        "team-goals": renderGoals,
        "team-targets": renderTargets,
        "team-wall": renderWall,
        "team-assets": () => renderTeam("assets"),
        "team-followups": () => renderTeam("followups"),
        "team-tasks": () => renderTeam("tasks"),
        "team-orders": () => renderTeam("orders"),
        opportunities: renderOpportunities,
        "opp-analysis": renderOppAnalysis,
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
          num: nextOrderNumber(),
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
      if (d.oppAction && onOppPage()) return oppAction(d);
      if (d.oppView && route === "opportunities") {
        oppView.mode = d.oppView === "list" ? "list" : "board";
        render();
        return document.querySelector?.(`[data-opp-view="${oppView.mode}"]`)?.focus({ preventScroll: true });
      }
      if (d.oppRange && route === "opp-analysis") {
        oppView.range = ["month", "quarter"].includes(d.oppRange) ? d.oppRange : "all";
        render();
        return document.querySelector?.(`[data-opp-range="${oppView.range}"]`)?.focus({ preventScroll: true });
      }
      if (d.teamDetail && route.startsWith("team-")) return showTeamDetail(d.teamDetail);
      if (d.teamRule) return showTeamRule(d.teamRule);
      if (d.teamExport && route === "team-goals") return exportBoard();
      if (d.teamTarget && ["team-goals", "team-wall", "team-targets"].includes(route)) return showTargetForm(d.teamTarget);
      if (d.teamTargetRemove && route === "team-targets") return removeTarget(d.teamTargetRemove);
      if (d.teamTargetCancel && route === "team-targets") {
        armedTarget = "";
        return render();
      }
      if (["team-goals", "team-wall"].includes(route) && teamViewAction(d)) return;
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
    // 看板拖动：把卡片拖到另一列即调整阶段；拖到输单会先问原因。
    document.addEventListener("dragstart", (e) => {
      const card = route === "opportunities" ? e.target.closest?.("[data-opp-id]") : null;
      oppDrag = card ? card.dataset.oppId : "";
      if (card) e.dataTransfer?.setData("text/plain", oppDrag);
    });
    document.addEventListener("dragover", (e) => {
      if (oppDrag && e.target.closest?.("[data-opp-drop]")) e.preventDefault();
    });
    document.addEventListener("dragend", () => {
      oppDrag = "";
    });
    document.addEventListener("drop", (e) => {
      const column = oppDrag ? e.target.closest?.("[data-opp-drop]") : null;
      if (!column) return;
      e.preventDefault();
      const id = oppDrag;
      oppDrag = "";
      return moveOpp(id, column.dataset.oppDrop, "");
    });
    document.addEventListener("change", (e) => {
      if (onOppPage() && e.target.closest?.("#opp-form") && ["client", "stage", "nameMode", "currency"].includes(e.target.name)) return syncOppForm(e.target.name);
      if (route === "opportunities" && Object.hasOwn(OPP_FILTERS, e.target.id)) {
        oppView.filters = { ...oppView.filters, [OPP_FILTERS[e.target.id]]: e.target.value };
        oppView.limits = {};
        render();
        return document.getElementById(e.target.id)?.focus?.({ preventScroll: true });
      }
      if (route === "opp-analysis" && e.target.id === "opp-analysis-currency") {
        oppView.analysisCurrency = e.target.value;
        return render();
      }
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
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) {
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
        !["biz-order-form", "biz-task-form", "biz-settings-form", "biz-target-form", "opp-form", "opp-lost-form"].includes(
          form.id,
        )
      )
        return;
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (form.id === "opp-form") {
        if (!oppDraft) return;
        return saveNext(
          () => OM().upsert(state(), oppDraft.id, data, { mustExist: !oppDraft.isNew }),
          "opp-error",
          () => {
            oppDraft = null;
            return oppDone();
          },
        );
      }
      if (form.id === "opp-lost-form")
        return saveNext(
          () => OM().moveStage(state(), form.dataset.id, "lost", data),
          "opp-lost-error",
          oppDone,
        );
      if (form.id === "biz-target-form")
        return saveNext(
          () => root.LaiTeamModel.setTarget(state(), data),
          "biz-target-error",
          () => ctx.closeDialog(),
        );
      if (form.id === "biz-order-form") {
        data.isDraft = form.elements.isDraft.checked;
        return saveNext(
          () => {
            const next = B.upsertOrder(state(), draft.id, data);
            // 由商机生成的订单：保存订单的同时把订单记到商机上（商机已不存在时只保存订单）。
            return draft.fromOpportunity && OM().list(next).some((item) => item.id === draft.fromOpportunity)
              ? OM().linkOrder(next, draft.fromOpportunity, draft.id)
              : next;
          },
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
      // 供客户详情页调用：新建商机、打开某个商机的操作菜单、调整阶段、查看该客户的全部商机。
      newOpportunity(client) {
        oppReturn = String(client || "");
        openOppForm(undefined, oppReturn);
      },
      opportunityMenu(id, client) {
        oppReturn = String(client || "");
        oppArmed = "";
        showOppMenu(id);
      },
      moveOpportunity(id, stage, client) {
        oppReturn = String(client || "");
        return moveOpp(id, stage, "");
      },
      showOpportunities(client) {
        oppView.filters = { search: String(client || ""), archived: "all" };
        oppView.limits = {};
        return ctx.navigate("opportunities");
      },
      navigate(next) {
        oppReturn = "";
        armedTarget = "";
        route = next;
        render();
      },
      refresh: render,
      hasDraft: () => !!draft || !!oppDraft || settingsDirty,
      discardDraft() {
        draft = null;
        oppDraft = null;
      },
      route: () => route,
    };
  }
  root.LaiBusinessUI = { create };
})(window);
