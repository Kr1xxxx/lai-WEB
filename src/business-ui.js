(function (root) {
  "use strict";
  // 页面登记处：后面的模块（导出、汇率、线索设置、任务设置、功能开关……）把自己的页面登记在这里，
  // 不用改这个文件。root.LaiExtraPages[路由] = { title, render(c), afterRender(c), click(c, e), input(c, e), change(c, e), submit(c, e) }。
  // c 是页面用的 ctx：原来的 ctx（getState、save、toast、dialog、escape……）再加 state()、can(key)、need(key)、sees(owner)、
  // scoped()、route()、refresh()。render 返回页面的 HTML（由这里放进主区域）；页面自己已经放好时返回别的值。
  // click / input / change / submit 返回 true 表示已处理。路由对应的权限仍在 role-model.js 的 PAGE_PERMS 里。
  root.LaiExtraPages = root.LaiExtraPages || {};
  function create(ctx) {
    const B = root.LaiBusinessModel,
      E = ctx.escape;
    // 团队数据模块只在打开对应页面时才取用。
    let teamReport = null,
      teamUI = null;
    const TU = () => teamUI || (teamUI = root.LaiTeamUI.create(E, can));
    let route = "dashboard",
      search = "",
      stage = "",
      currency = "",
      period = "",
      page = 1,
      month = B.localDate().slice(0, 7),
      selectedDate = "",
      draft = null,
      settingsDirty = false;
    const state = () => ctx.getState();
    // ---------- 角色权限（本机预览，不是安全措施）----------
    // can(key)：当前账号有没有这个权限；need(key)：没有就提示并返回 false；sees(owner)：看不看得到这位跟进人／负责人的记录。
    // scoped()：角色只看“本人”时，去掉线索、商机、订单、回收站订单里不归自己的，只用来画页面；保存时永远用完整的 state()。
    const RM = () => root.LaiRoleModel;
    const can = (key) => !RM() || RM().can(state(), key);
    const need = (key) => can(key) || (ctx.toast(RM().denied(key)), false);
    const sees = (owner) => !RM() || RM().canSee(state(), owner);
    // 登记的页面：只在当前真的停在业务页面时才算（客户页、邮件页上不转发事件）。
    const extra = (name = route) => {
      const pages = root.LaiExtraPages;
      if (!pages || !Object.hasOwn(pages, name) || Object.hasOwn(builtinViews(), name) || (ctx.isActive && !ctx.isActive())) return null;
      const page = pages[name];
      return page && typeof page === "object" ? page : null;
    };
    const extraCtx = () => ({ ...ctx, state, can, need, sees, scoped, route: () => route, refresh: () => render() });
    const notYours = (item) => !!item && !sees(item.owner) && (ctx.toast("这条记录不归你负责"), true);
    let scopeMemo = null,
      dashMemo = null;
    function scoped() {
      const s = state(),
        R = RM();
      if (!R || R.scopeOf(s) === "all") return s;
      const me = R.meName(s);
      if (scopeMemo && scopeMemo.state === s && scopeMemo.me === me) return scopeMemo.value;
      const mine = (list) => (Array.isArray(list) ? list.filter((item) => item && R.canSee(s, item.owner)) : list);
      const value = { ...s, laiLeads: mine(s.laiLeads), laiOpportunities: mine(s.laiOpportunities), orders: mine(s.orders), trashOrders: mine(s.trashOrders) };
      scopeMemo = { state: s, me, value };
      return value;
    }
    // 工作台还要看客户：同样只留自己做跟进人的。
    function dashState() {
      const s = scoped();
      if (s === state()) return s;
      if (dashMemo && dashMemo.base === s) return dashMemo.value;
      const R = RM(),
        customers = Object.fromEntries(Object.entries(s.customers || {}).filter(([, c]) => c && R.canSee(s, c.owner)));
      // 待办属于负责人（D-022）：只留负责人看得到的；老任务没有负责人时按所关联客户的跟进人（要用完整的客户资料算）。
      dashMemo = { base: s, value: { ...s, customers, laiTasks: B.visibleTasks(s, (owner) => R.canSee(s, owner)) } };
      return dashMemo.value;
    }
    // 下拉名单用的数据：角色只看本人或本部门时，客户只留看得到的，订单、线索、商机也只留自己的；只用来出名单，保存时永远用完整的 state()。
    let pickMemo = null;
    function pickState() {
      const s = scoped();
      if (s === state()) return s;
      if (pickMemo && pickMemo.base === s) return pickMemo.value;
      const R = RM(),
        full = state(),
        customers = Object.fromEntries(Object.entries(full.customers || {}).filter(([, c]) => c && R.canSee(full, c.owner)));
      // 订单上的客户名也会进名单：客户资料有、但不归自己的，就不要带出来。
      const ok = (order) => order && (Object.hasOwn(customers, order.client) || !Object.hasOwn(full.customers || {}, order.client));
      const value = { ...s, customers, orders: (s.orders || []).filter(ok), trashOrders: Array.isArray(s.trashOrders) ? s.trashOrders.filter(ok) : s.trashOrders };
      pickMemo = { base: s, value };
      return value;
    }
    // 这个客户名在客户资料里有、但当前账号看不到（不归自己负责）。全公司范围永远是 false；资料里没有的名字不算。
    function customerHidden(name) {
      const R = RM(),
        full = state(),
        text = String(name || "").trim().toLowerCase();
      if (!R || !text || R.scopeOf(full) === "all") return false;
      const key = Object.keys(full.customers || {}).find((k) => k.trim().toLowerCase() === text);
      return key !== undefined && !R.canSee(full, full.customers[key]?.owner);
    }
    const HIDDEN_CUSTOMER = "这个客户不在你的范围内";
    // 打开了没有权限的页面：不画页面，只说明为什么。
    const routeDenied = (name) => {
      const key = RM() && RM().pagePerm("route", name);
      // 和 app.js 的 blockedPage 一个样子。
      return key && !can(key) ? `<div class="pagebar"><div class="page-tabs"><h1>没有权限</h1></div></div><section class="module-page"><div class="empty role-blocked" role="status"><strong>${E(RM().denied(key))}</strong><span>可以点右上角头像，切换到别的测试账号。</span></div></section>` : "";
    };
    // 完整的时间（带 Z 或时区）按本机日历日显示，不按 UTC 日；只有日期的原样显示。
    const localDay = (value) => {
      const source = String(value || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(source)) return source.slice(0, 10);
      const parsed = new Date(source.replace(" ", "T"));
      return Number.isNaN(parsed.getTime()) ? source.slice(0, 10) : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    };
    const date = (value) => localDay(value) || "—";
    const money = (value, code = "USD") =>
      `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${E(code)}`;
    const option = (value, title, current) =>
      `<option value="${E(value)}" ${String(value) === String(current) ? "selected" : ""}>${E(title)}</option>`;
    // 界面配色清单。哪个是默认由 app.js 的 DEFAULT_THEME 决定（ctx.defaultTheme），这里只给它的名字加「（默认）」。
    const DEFAULT_THEME = ctx.defaultTheme || "pink";
    const THEME_CHOICES = [["pink", "粉色"], ["orange", "橙色"], ["tech", "科技蓝"]].map(([id, name]) => [id, id === DEFAULT_THEME ? `${name}（默认）` : name]);
    // 去掉的配色按哪个显示（D-029，和 app.js 的 RETIRED_THEMES 一致）：存的「xiaoman」（小满）当科技蓝，下次保存设置时写成 tech。
    const RETIRED_THEMES = { xiaoman: "tech" };
    const savedTheme = (settings) => (Object.hasOwn(RETIRED_THEMES, settings?.theme ?? "") ? RETIRED_THEMES[settings.theme] : settings?.theme);
    const button = (action, text, extra = "", primary = false) =>
      `<button type="button" ${primary ? 'class="primary"' : ""} data-biz-action="${action}" ${extra}>${text}</button>`;
    const header = (title, description, actions = "") =>
      `<div class="pagebar"><div class="business-title"><h1>${title}</h1><span>${description}</span></div><div class="page-actions">${actions}</div></div>`;
    // 已经换成组件套件（D-028）的页面用的页头：标题、一句说明、右边的按钮；页签由 app.js 的 placeSectionTabs 放在标题后面。
    const kitHeader = (title, description, actions = "", cls = "") =>
      `<div class="k-pageheader${cls ? " " + cls : ""}"><div class="k-pageheader-text"><h1 class="k-pageheader-title">${title}</h1><span class="k-pageheader-desc">${description}</span></div><div class="k-pageheader-actions">${actions}</div></div>`;
    // 必填标记，和抽屉底栏里保存按钮旁的错误条（表单出错时字写在这里，不会被滚到看不见的地方）。
    const REQ = '<span class="required" aria-hidden="true">*</span>';
    const footError = (id) => `<div class="error form-foot-error" id="${id}" role="alert" data-form-error></div>`;
    // 列表页头的「导出」按钮：只有有对应导出权限的账号才看得到。
    const exportButton = (kind, cls = "") =>
      root.LaiExportUI && can(`${kind}.export`) ? `<button type="button"${cls ? ` class="${cls}"` : ""} data-export-kind="${kind}">导出</button>` : "";
    const allOrders = () => state().orders || [];
    const activeOrders = () => scoped().orders || [];
    const customerButton = (name) =>
      `<button class="company-link" data-biz-customer="${E(name)}" title="${E(name)}">${E(name)}</button>`;
    function filteredOrders() {
      return activeOrders()
        .filter(
          (o) =>
            (!stage || o.stage === stage) &&
            (!currency || (o.currency || "USD") === currency) &&
            (!period || (root.LaiOrdersPage && root.LaiOrdersPage.inPeriod(o.createdAt || o.updated, period, B.localDate()))) &&
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
    // 工作台：所有配色都用 src/workbench.js 的版面（今天先做、钱和目标、订单线、商机、客户来消息）。
    let wbMail = null,
      wbMailAt = 0,
      wbMailError = false;
    // 聊天里的客户：本人／本部门账号只看范围里的；公海客户要有「公海查看」；回收站里的不出现（和聊天页一致）。
    const chatVisible = (name, profile) => {
      const kind = root.LaiModules.bucket(profile);
      if (!profile || kind === "trash") return false;
      return kind === "pool" ? can("pool.view") : can("customer.view");
    };
    function workbenchMarkup() {
      const R = RM(),
        full = state();
      return root.LaiWorkbench.markup(
        {
          state: dashState(),
          can,
          me: R ? R.meName(full) : "",
          showOwner: !!R && R.scopeOf(full) !== "self",
          today: B.localDate(),
          hour: new Date().getHours(),
          B,
          OM: root.LaiOpportunityModel,
          TM: root.LaiTeamModel,
          bucket: (c) => root.LaiModules.bucket(c),
          WA: root.LaiWhatsAppUI,
          canSeeChat: chatVisible,
          mail: wbMail || (wbMailError ? { error: true } : null),
        },
        E,
      );
    }
    // 邮件要向本机邮件服务要；拿到后只换页面上依赖邮件的三处（问候句、今天先做、客户来消息），不重画整页，滚动位置和焦点不会跳。
    function refreshWorkbenchParts() {
      const host = document.querySelector?.(".wb");
      if (!host || !document.createElement) return;
      const holder = document.createElement("div");
      holder.innerHTML = workbenchMarkup();
      for (const part of ["summary", "queue", "messages"]) {
        const fresh = holder.querySelector(`[data-wb="${part}"]`),
          old = host.querySelector(`[data-wb="${part}"]`);
        if (fresh && old) old.replaceWith(fresh);
      }
    }
    async function loadWorkbenchMail() {
      if (!ctx.mailSummary || !can("mail.view") || Date.now() - wbMailAt < 30000) return;
      wbMailAt = Date.now();
      let data = null;
      try {
        data = await ctx.mailSummary();
      } catch {
        data = null;
      }
      if (route !== "dashboard") return;
      if (!data) {
        // 读不到（没绑邮箱、邮件功能关了）：下次进工作台再试；已经提示过就不重画。
        wbMailAt = 0;
        if (wbMailError) return;
        wbMailError = true;
      } else {
        wbMail = data;
        wbMailError = false;
      }
      refreshWorkbenchParts();
    }
    const renderDashboard = () => workbenchMarkup();
    // 负责人名：账号只看自己的待办时不用写；看得到别人的待办时标出是谁的。
    const taskWho = (t) => {
      if (!RM() || RM().scopeOf(state()) === "self") return "";
      return B.taskOwner(state(), t) || "未分配";
    };
    function taskMarkup(t) {
      const who = taskWho(t);
      return `<div class="business-line task-line"><label><input type="checkbox" data-biz-task="${E(t.id)}" ${t.done ? "checked" : ""}> <span class="${t.done ? "done-text" : ""}">${E(t.title)}</span>${who ? ` <small class="muted">${E(who)}</small>` : ""}</label><time>${date(t.date)}</time></div>`;
    }
    // 管理员在日历上看到的提示：有老待办没有负责人。点“去分配”打开第一条，在编辑框里选负责人；点“知道了”这台电脑上不再提示。
    const TASK_HINT_KEY = "lai-task-owner-hint-dismissed";
    function taskHintDismissed() {
      try {
        return localStorage.getItem(TASK_HINT_KEY) === "1";
      } catch {
        return false;
      }
    }
    function taskOwnerHint() {
      if (!RM() || !RM().isAdmin(state()) || taskHintDismissed()) return "";
      const open = B.unassignedTasks(state());
      if (!open.length) return "";
      return `<div class="business-section task-owner-hint" role="status"><span>有 ${open.length} 条待办没有负责人</span> ${button("assign-tasks", "去分配", `data-id="${E(open[0].id)}"`)} ${button("hide-task-hint", "知道了")}</div>`;
    }
    // 全部订单当前这一页要显示什么：筛选后的订单、这一页的订单、页码。
    function orderListView() {
      const filtered = filteredOrders(),
        size = 20,
        pages = Math.max(1, Math.ceil(filtered.length / size));
      page = Math.min(page, pages);
      const items = filtered.slice((page - 1) * size, page * size);
      return {
        items,
        all: activeOrders(),
        total: filtered.length,
        filters: { search, stage, currency, period },
        stages: B.stages,
        currencies: [...new Set(activeOrders().map((o) => o.currency || "USD"))],
        page,
        pages,
        trash: scoped().trashOrders || [],
        can,
        exportable: !!root.LaiExportUI,
      };
    }
    function renderOrders() {
      return root.LaiOrdersPage.markup(orderListView(), E);
    }
    // 订单搜索框打字时：只换表格里的行、合计和翻页，页面、搜索框都不动（焦点、光标留在原处）。
    // 页面不是当前的全部订单页（例如刚换了主题还没重画）时整页重画。
    function refreshOrderRows() {
      const scroller = document.getElementById("biz-order-scroll");
      if (route !== "order-list" || !scroller) return render();
      const view = orderListView();
      const body = scroller.querySelector(":scope > .op-table > tbody");
      const foot = body && scroller.parentElement.querySelector(":scope > .op-foot");
      if (!foot) return render();
      body.innerHTML = root.LaiOrdersPage.rowsMarkup(view, E);
      foot.outerHTML = root.LaiOrdersPage.footMarkup(view);
      scroller.scrollTop = 0;
    }
    function renderOrderTrash() {
      const orders = scoped().trashOrders || [];
      return (
        header(
          "订单回收站",
          "已归档订单可恢复",
          button("orders", "返回订单列表"),
        ) +
        `<section class="business-section"><div class="module-note">归档只移动订单，保留客户、历史、附件引用和原始字段。</div><table class="order-table"><thead><tr><th>订单编号</th><th>客户</th><th>金额</th><th>归档时间</th><th>操作</th></tr></thead><tbody>${orders.map((o) => `<tr><td>${E(o.num)}</td><td>${E(o.client)}</td><td>${money(o.amount, o.currency || "USD")}</td><td>${date(o.trashedAt)}</td><td>${can("order.edit") ? button("restore-order", "恢复订单", `data-id="${E(o.id)}"`) : ""}</td></tr>`).join("")}</tbody></table>${orders.length ? "" : '<div class="empty"><strong>订单回收站为空</strong></div>'}</section>`
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
          )}</div></section><section class="business-section"><div class="section-head"><h3>客户贡献</h3><span class="muted tiny">按币种分组，再按金额排序</span></div><table class="order-table fit-table"><thead><tr><th>客户</th><th>订单数</th><th>订单金额</th></tr></thead><tbody>${
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
    // 团队数据按账号的可见范围算：本人只算自己的，本部门算本部门成员的，全公司不变。看不到的数据连明细里都不会有。
    const teamNote = () => {
      const scope = RM() ? RM().scopeOf(state()) : "all";
      return scope === "all" ? "" : scope === "dept" ? "只显示本部门的数据" : "只显示你自己的数据";
    };
    let teamMemo = null;
    function teamState() {
      const s = state();
      if (!teamNote()) return s;
      const me = RM().meName(s);
      if (teamMemo && teamMemo.state === s && teamMemo.me === me) return teamMemo.value;
      teamMemo = { state: s, me, value: root.LaiTeamModel.scopeState(s, sees) };
      return teamMemo.value;
    }
    function renderTeam(kind) {
      teamReport = root.LaiTeamModel.report(kind, teamState(), month);
      if (teamNote()) teamReport.scopeNote = teamNote();
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
    const targetsButton = () => (can("team.targets") ? '<button type="button" data-lai-route="team-targets">目标设置</button>' : "");
    function renderGoals() {
      teamOverview = { ...root.LaiTeamModel.overview(teamState(), periodKey()), scopeNote: teamNote() };
      return (
        header(
          "目标完成情况",
          `${E(teamOverview.periodLabel)} · 按跟进人名称汇总`,
          `${periodSwitch()}${monthInput()}<span class="team-scope">${teamNote() ? "我的数据" : "我的企业"}</span>${targetsButton()}`,
        ) + TU().goalsMarkup(teamOverview, teamView)
      );
    }
    function renderWall() {
      teamOverview = { ...root.LaiTeamModel.overview(teamState(), periodKey()), scopeNote: teamNote() };
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
        teamView.tab = Object.hasOwn(TU().tabs, d.teamTab) ? d.teamTab : "result";
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
          `${monthInput()}${can("team.targets") ? '<button type="button" class="primary" data-team-target="new">新建目标</button>' : ""}`,
        ) + TU().targetsMarkup(T.listTargets(teamState()), T.periodLabel, armedTarget)
      );
    }
    // 设置目标表单：币种只在金额类指标时出现，成员只在对象选「成员」时出现；收起来的栏位不参与提交。
    function syncTargetForm(form) {
      const fields = form?.elements;
      if (!fields) return;
      const shown = { currency: TU().isMoney(fields.metric?.value), owner: fields.scope?.value === "member" };
      for (const name of Object.keys(shown)) {
        const field = fields[name];
        if (!field) continue;
        field.disabled = !shown[name];
        const label = field.closest?.("label");
        if (label) label.hidden = !shown[name];
      }
    }
    let targetFormKey = "team.targets";
    function showTargetForm(metric) {
      // 目标管理页要“目标管理”，目标完成情况里设置目标值要“编辑目标值”。
      targetFormKey = route === "team-targets" ? "team.targets" : "team.goalEdit";
      if (!need(targetFormKey)) return;
      const T = root.LaiTeamModel;
      // 每次打开都按当前数据重新计算，成员名单和默认币种不会停留在上一次看页面时的样子。
      const overview = { ...T.overview(teamState(), periodKey()), scopeNote: teamNote() };
      const quarter = T.quarterOf(month);
      // 修改已有的企业目标时带出原来的数值；金额有多个币种时带出第一个。
      const existing = Object.hasOwn(overview.goals, metric) ? overview.goals[metric][0] : null;
      ctx.dialog(
        "设置目标",
        TU().targetFormMarkup(overview, {
          metric,
          period: periodKey(),
          value: existing?.value,
          currency: existing?.currency || (metric === "oppWonAmount" ? overview.oppCurrency : "") || undefined,
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
      if (!need("team.targets")) return;
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
      if (!need("team.export") || !teamOverview) return;
      if (!root.XLSX) return ctx.toast("Excel 组件未加载，请重新打开来财");
      const workbook = root.XLSX.utils.book_new();
      root.XLSX.utils.book_append_sheet(workbook, root.XLSX.utils.aoa_to_sheet(TU().boardRows(teamOverview, teamView)), TU().tabLabels[teamView.tab] || "结果目标");
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
    // 字段权限：商机字段当前账号是 edit｜read｜hidden（系统管理员都是 edit）；oppLocked 是改不了的字段名（含 custom.字段ID），oppHidden 是看不到的。
    const oppLevel = (key) => (RM() ? RM().fieldLevel(state(), "opp", key) : "edit");
    const oppLocked = () => (RM() ? RM().lockedFields(state(), "opp") : []);
    const oppHidden = () => oppLocked().filter((key) => oppLevel(key) === "hidden");
    const OU = () => oppUI || (oppUI = root.LaiOpportunityUI.create(E, OM(), can, oppLevel));
    const oppView = { mode: "board", limits: {}, filters: {}, range: "all", analysisCurrency: "", analysisFlow: "" };
    // 商机设置页：当前页签、销售流程页当前看的流程，以及等待再次确认删除的那一项（"flow:ID"、"stage:ID"、"reasons:名称"、"types:名称" 或 "cf:ID"）。
    const flowView = { tab: "flows", flow: "default", armed: "" };
    const cssEscape = (value) => (root.CSS?.escape ? root.CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&"));
    let keepOppFilters = false,
      oppSearchTimer = 0,
      orderSearchTimer = 0;
    // 订单搜索：停下 150 毫秒后再换表格里的行；期间离开了全部订单页就不画。
    function scheduleOrderRows() {
      root.clearTimeout?.(orderSearchTimer);
      orderSearchTimer = root.setTimeout?.(() => {
        if (route === "order-list" && document.getElementById("biz-search")) refreshOrderRows();
      }, 150);
    }
    let oppDraft = null,
      oppArmed = "",
      oppDrag = "",
      oppHover = null,
      oppUndoTimer = 0,
      oppUndoToast = null,
      // 从客户详情页发起的商机操作：记下客户名，保存后回到该客户，而不是画商机页面。
      oppReturn = "";
    // 商机详情、菜单、编辑和输单窗口开着时（例如从「单据记录」的来源点进来），页面不在商机页，窗口里的按钮也要能用。
    const oppDialogOpen = () => !!document.querySelector?.(".opp-detail, .opp-menu, #opp-form, #opp-lost-form");
    const onOppPage = () => route === "opportunities" || route === "opp-analysis" || !!oppReturn || oppDialogOpen();
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
      const board = OM().board(scoped(), { ...oppView.filters, hidden: oppHidden() }, today);
      const context = { owners: OM().ownerNames(scoped()).filter(sees), today };
      return kitHeader("商机", "按销售阶段跟进每一笔机会", exportButton("opp", "k-btn") + OU().headerActions(board, context, oppView), "opp-header") + OU().boardMarkup(board, oppView, context);
    }
    function renderOppAnalysis() {
      const T = root.LaiTeamModel;
      const months = oppView.range === "month" ? [month] : oppView.range === "quarter" ? T.periodMonths(T.quarterOf(month)) : null;
      const report = OM().analysis(scoped(), { months, currency: oppView.analysisCurrency, flow: oppView.analysisFlow }, B.localDate());
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
    function renderOppFlows() {
      const summary = OM().flowSummary(state());
      if (!summary.some((flow) => flow.id === flowView.flow)) flowView.flow = summary[0].id;
      const now = state(), named = (kind, names) => names.map((name) => ({ name, count: OM().choiceUse(now, kind, name) }));
      const data = {
        summary,
        reasons: named("reasons", OM().lostReasons(now)),
        types: named("types", OM().typeChoices(now)),
        fields: OM().fieldRows(now),
        customFields: OM().customFields(now).map((field) => ({ ...field, count: OM().customUse(now, field.id) })),
      };
      return header("商机设置", "销售流程、输单原因和商机字段") + OU().settingsMarkup(data, flowView);
    }
    // 输单原因、商机类型、字段、自定义字段的每个动作各自保存；保存后停在原页面，出错时提示写在页面上方。
    const saveSet = (makeNext, focus) =>
      saveNext(makeNext, "opp-set-error", () => {
        flowView.armed = "";
        render();
        if (focus) document.querySelector?.(focus)?.focus?.({ preventScroll: true });
        return false;
      });
    function setAction(d) {
      if (!need("settings.opportunity")) return;
      const action = d.setAction, key = d.key, kind = d.list;
      const here = `[data-set-action="${action}"][data-key="${cssEscape(key)}"]`;
      if (action === "up" || action === "down") {
        flowView.armed = "";
        return saveSet(() => OM().moveChoice(state(), kind, key, action === "up" ? -1 : 1), here);
      }
      if (action === "cf-up" || action === "cf-down") {
        flowView.armed = "";
        return saveSet(() => OM().moveCustomField(state(), key, action === "cf-up" ? -1 : 1), here);
      }
      if (action === "remove") {
        // 还有商机在用的直接试删，让提示说明原因；没人用的要再点一次确认。
        const armKey = `${kind}:${key}`;
        if (flowView.armed !== armKey && !OM().choiceUse(state(), kind, key)) {
          flowView.armed = armKey;
          render();
          return document.querySelector?.(here)?.focus?.({ preventScroll: true });
        }
        return saveSet(() => OM().removeChoice(state(), kind, key));
      }
      if (action === "cf-remove") {
        const armKey = `cf:${key}`;
        if (flowView.armed !== armKey && OM().customUse(state(), key)) {
          flowView.armed = armKey;
          render();
          return document.querySelector?.(here)?.focus?.({ preventScroll: true });
        }
        return saveSet(() => OM().removeCustomField(state(), key));
      }
    }
    // 设置页里输入框、勾选框、选项框的修改：改完马上保存；没保存成功就把控件恢复成已保存的样子。
    function setChange(input) {
      if (!need("settings.opportunity")) return;
      const d = input.dataset;
      if (d.setRename) {
        const kind = d.setRename, key = d.key;
        return saveSet(() => OM().renameChoice(state(), kind, key, input.value), `[data-set-rename="${kind}"]`).then((ok) => {
          if (!ok) input.value = key;
        });
      }
      if (d.setField) {
        const id = d.setField, prop = d.prop;
        return saveSet(() => OM().setField(state(), id, { [prop]: input.checked }), `[data-set-field="${id}"][data-prop="${prop}"]`).then((ok) => {
          if (!ok) input.checked = !input.checked;
        });
      }
      const field = (id) => OM().customFields(state()).find((item) => item.id === id);
      if (d.cfRename !== undefined) {
        const id = d.cfRename, before = field(id)?.name ?? input.value;
        return saveSet(() => OM().updateCustomField(state(), id, { name: input.value }), `[data-cf-rename="${cssEscape(id)}"]`).then((ok) => {
          if (!ok) input.value = before;
        });
      }
      if (d.cfRequired !== undefined) {
        const id = d.cfRequired;
        return saveSet(() => OM().updateCustomField(state(), id, { required: input.checked }), `[data-cf-required="${cssEscape(id)}"]`).then((ok) => {
          if (!ok) input.checked = !input.checked;
        });
      }
      if (d.cfOptions !== undefined) {
        const id = d.cfOptions, before = (field(id)?.options || []).join("\n");
        return saveSet(() => OM().updateCustomField(state(), id, { options: input.value }), `[data-cf-options="${cssEscape(id)}"]`).then((ok) => {
          if (!ok) input.value = before;
        });
      }
    }
    // 流程设置页的每个动作各自保存；保存后停在原页面，出错时提示写在页面上方。
    const saveFlow = (makeNext, focus) =>
      saveNext(makeNext, "opp-flow-error", () => {
        flowView.armed = "";
        render();
        if (focus) document.querySelector?.(focus)?.focus?.({ preventScroll: true });
        return false;
      });
    function flowAction(d) {
      if (!need("settings.opportunity")) return;
      const action = d.flowAction,
        key = action === "flow-remove" ? "flow:" + d.flow : "stage:" + d.stage;
      if (action === "stage-up" || action === "stage-down") {
        flowView.armed = "";
        return saveFlow(() => OM().moveFlowStage(state(), d.flow, d.stage, action === "stage-up" ? -1 : 1), `[data-flow-action="${action}"][data-stage="${cssEscape(d.stage)}"]`);
      }
      if (action === "stage-remove") {
        const flow = OM().flowSummary(state()).find((item) => item.id === d.flow),
          stage = flow?.stages.find((item) => item.id === d.stage);
        if (!stage) return ctx.toast("阶段不存在，可能已被删除，请刷新后重试");
        // 阶段里还有商机：先问清楚移到哪里。
        if (stage.count) {
          flowView.armed = "";
          return ctx.dialog("删除阶段", OU().stageRemoveMarkup(flow, stage), '<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="opp-stage-remove-form">移动并删除</button>', "opp-stage-remove");
        }
      }
      if (flowView.armed !== key) {
        flowView.armed = key;
        render();
        return document.querySelector?.(`[data-flow-action="${action}"]${action === "flow-remove" ? "" : `[data-stage="${cssEscape(d.stage)}"]`}`)?.focus?.({ preventScroll: true });
      }
      if (action === "flow-remove")
        return saveFlow(() => {
          const next = OM().removeFlow(state(), d.flow);
          flowView.flow = "default";
          return next;
        });
      return saveFlow(() => OM().removeFlowStage(state(), d.flow, d.stage));
    }
    const oppItem = (id) => OM().list(state()).find((item) => item.id === id);
    const oppCard = (id) => OM().cardOf(state(), id, B.localDate());
    // 商机不归当前账号负责（角色只看本人或本部门时）：提示一句，什么也不做。
    const oppBlocked = (id) => notYours(oppItem(id));
    function openOppForm(id, client = "") {
      if (!need(id === undefined ? "opp.create" : "opp.edit") || (id !== undefined && oppBlocked(id))) return;
      let next;
      if (id === undefined) {
        // 新建时默认放进看板当前正在看的那个流程的第一个阶段。
        const flow = OM().flowOf(state(), oppView.filters.flow);
        // 从客户那里新建时，客户的来源在来源名单里就带过来。
        next = { id: crypto.randomUUID(), isNew: true, values: { ...OM().defaults(state(), B.localDate()), client, flow: flow.id, stage: flow.stages[0].id, sources: client ? OM().sourcesFromCustomer(pickState(), client) : [] } };
      }
      else {
        const item = oppItem(id);
        if (!item) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
        next = { id, isNew: false, values: { ...item } };
      }
      // 表单里显示的是商机实际归属的流程（原来的流程读不到时按默认流程）。
      const values = { ...next.values, flow: OM().flowOf(state(), next.values.flow).id };
      // 汇率设置里有这个币种的汇率时，汇率框先填上它（外币正好是 100 当作没填；用户自己存的其他值不动）。
      const prefilled = OM().prefillRate(state(), values.currency, values.exchangeRate);
      if (prefilled !== null) values.exchangeRate = prefilled;
      try {
        ctx.dialog(
          next.isNew ? "新建商机" : "编辑商机",
          OU().formMarkup(values, {
            customers: OM().customerNames(pickState()),
            contacts: OM().contactsOf(pickState(), String(values.client || "").trim()),
            owners: OM().ownerNames(state()),
            flows: OM().flowsOf(state()),
            stages: OM().flowOf(state(), values.flow).stages,
            setup: OM().formSetup(pickState()),
            isNew: next.isNew,
          }),
          `${footError("opp-error")}<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="opp-form">保存商机</button>`,
          "business-opportunity",
        );
      } catch (error) {
        // 表单没能打开时不留下「正在编辑」的状态，否则会挡住之后的页面切换。
        return ctx.toast(`无法打开商机表单：${error.message}`);
      }
      // 只有表单真的打开了才算进入编辑；记下原来的客户和联系人，换回原客户时能恢复原联系人。
      oppDraft = { id: next.id, isNew: next.isNew, client: String(values.client || "").trim(), contact: String(values.contact || ""), flow: OM().flowOf(state(), values.flow).id, stage: String(values.stage || ""), prefilled };
    }
    // 客户、阶段、命名方式、币种变化时，只就地更新表单里受影响的那几处，不重画，不打断正在输入的内容。
    function syncOppForm(name) {
      const form = document.getElementById("opp-form");
      if (!form || !oppDraft) return;
      const el = form.elements;
      if (name === "client") {
        const client = String(el.client.value || "").trim();
        const contacts = OM().contactsOf(pickState(), client);
        // 关联联系人可以在商机设置里隐藏；显示时，客户有联系人且设为必填才算必填。
        if (el.contact) {
          el.contact.innerHTML = OU().contactOptions(contacts, client === oppDraft.client ? oppDraft.contact : "", client);
          const must = contacts.length > 0 && OM().fieldMap(state()).contact.required;
          el.contact.required = must;
          const head = el.contact.closest?.("label")?.querySelector?.(".opp-field-label");
          const star = head?.querySelector?.(".opp-req");
          if (head && must && !star) head.insertAdjacentHTML?.("beforeend", '<i class="opp-req" aria-hidden="true">*</i>');
          else if (star && !must) star.remove?.();
        }
      } else if (name === "flow") {
        // 换流程：阶段选项换成新流程的；换回原流程时恢复原来的阶段，否则落在第一个阶段。
        const flow = OM().flowOf(state(), el.flow.value);
        const keep = flow.id === oppDraft.flow && flow.stages.some((stage) => stage.id === oppDraft.stage) ? oppDraft.stage : flow.stages[0].id;
        el.stage.innerHTML = OU().stageOptions(flow.stages, keep);
        el.stage.value = keep;
        return syncOppForm("stage");
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
        if (!rate) return;
        const usd = String(el.currency.value || "").trim().toUpperCase() === "USD";
        if (usd && !rate.readOnly) {
          rate.dataset.rate = rate.value;
          rate.value = "100";
        } else if (!usd && rate.readOnly) rate.value = rate.dataset.rate || "100";
        // 换币种时，汇率框是 100、空着或还是上次自动填的值，就换成汇率设置里这个币种的汇率；用户自己改过的不动。
        if (!usd) {
          const next = OM().prefillRate(state(), el.currency.value, rate.value, oppDraft.prefilled);
          if (next !== null) {
            rate.value = String(next);
            oppDraft.prefilled = next === 100 ? null : next;
          }
        }
        rate.readOnly = usd;
        const label = rate.closest("label");
        if (label) label.hidden = usd;
      }
    }
    function showOppMenu(id) {
      if (oppBlocked(id)) return;
      const card = oppCard(id);
      if (!card) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      ctx.dialog(E(card.name), OU().menuMarkup(card, oppArmed === id), '<button type="button" data-action="close-modal">关闭</button>', "opp-menu");
      anchorOppMenu(id);
    }
    // 「⋮」菜单是贴着那张卡片的小菜单（找不到卡片时留在右侧，见 skin-glass.css）。
    function anchorOppMenu(id) {
      const doc = root.document;
      const drawerEl = doc && doc.querySelector(".overlay .drawer:has(.opp-menu)");
      const trigger = [...(doc ? doc.querySelectorAll('[data-opp-action="menu"]') : [])].find((el) => el.dataset.id === id);
      if (!drawerEl || !trigger) return;
      const anchor = (trigger.closest(".opp-card, tr") || trigger).getBoundingClientRect();
      const size = drawerEl.getBoundingClientRect();
      const at = OU().menuPosition(anchor, { width: root.innerWidth, height: root.innerHeight }, { width: size.width || 232, height: size.height });
      drawerEl.style.cssText += `;left:${at.left}px;top:${at.top}px;right:auto;max-height:${at.maxHeight}px`;
    }
    function showOppLost(id) {
      if (!need("opp.edit") || oppBlocked(id)) return;
      const card = oppCard(id);
      if (!card) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      ctx.dialog("移到输单", OU().lostMarkup(card, OM().lostReasons(state())), '<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="opp-lost-form">移到输单</button>', "opp-lost");
    }
    // 设置里的值：新设置优先，没有再用旧版的订单设置，一项一项地取。
    const orderDefault = (key) => state().laiSettings?.[key] || state().orderSettings?.[key] || "";
    // 新订单的默认跟进人：只能看本人或本部门的账号是它自己，其他账号用设置里填的（见 role-model.js 的 defaultOwner）。
    const defaultOrderOwner = () => (RM()?.defaultOwner ? RM().defaultOwner(state()) : orderDefault("defaultOwner"));
    const suggestedOrderNumber = () => B.nextOrderNumber(state(), orderDefault("orderPrefix") || "L", B.localDate());
    // 赢单商机生成订单：打开现有的订单表单并预填，保存订单时同时把订单记到商机上。
    function orderFromOpp(id) {
      if (!need("order.create") || oppBlocked(id)) return;
      // 看不到“关联产品”的账号：不把商机里的产品带进订单。
      const found = oppItem(id);
      const item = found && oppHidden().includes("products") ? { ...found, products: [] } : found;
      if (!item) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      const card = oppCard(id);
      if (card.kind !== "won") return ctx.toast("只有赢单阶段的商机可以生成订单");
      if (card.orderId) return ctx.toast("这个商机已经关联了订单");
      const back = oppReturn;
      ctx.closeDialog();
      orderEditor(undefined, { ...OM().orderDraft(item, B.localDate()), num: suggestedOrderNumber() }, back, id);
    }
    // 商机里的电话和 WhatsApp 按钮：账号要能开聊天，客户资料里的「联系电话」没被角色隐藏，而且看得到这位客户
    // （本人账号看不到别人的客户，公海客户要“公海查看”，回收站里的不给），不然既不显示号码也不能打开。
    function customerSeen(name) {
      const profile = state().customers && Object.hasOwn(state().customers, name) ? state().customers[name] : null;
      if (!profile || typeof profile !== "object") return false;
      const bucket = root.LaiModules && root.LaiModules.bucket ? root.LaiModules.bucket(profile) : "";
      if (bucket === "trash") return false;
      return bucket === "pool" ? can("pool.view") : can("customer.view") && sees(profile.owner);
    }
    function oppPhone(client, contact) {
      if (!can("chat.send") || (RM() && !RM().fieldVisible(state(), "customer", "contact.phone")) || !customerSeen(client)) return null;
      return OM().contactPhone(state(), client, contact);
    }
    function oppAction(d) {
      const action = d.oppAction;
      if (action !== "delete") oppArmed = "";
      if (action === "new") return openOppForm();
      if (action === "detail") return showOppDetail(d.id);
      if (action === "edit") return openOppForm(d.id);
      if (action === "wa") {
        const detail = OM().detailOf(state(), d.id, B.localDate()),
          hit = detail && oppPhone(detail.client, detail.contact);
        if (!hit) return ctx.toast("这个联系人没有可用的电话");
        return ctx.openWhatsApp({ customer: detail.client, contact: hit.contact, phone: hit.phone, code: hit.code, country: hit.country });
      }
      if (action === "menu") return showOppMenu(d.id);
      if (action === "more") {
        oppView.limits[d.stage] = Math.max(root.LaiOpportunityUI.PAGE, Number(oppView.limits[d.stage]) || 0) + root.LaiOpportunityUI.PAGE;
        return render();
      }
      if (action === "move") return moveOpp(d.id, d.stage, "opp-menu-error");
      if (action === "archive") {
        if (!need("opp.archive") || oppBlocked(d.id)) return;
        return saveNext(() => OM().setArchived(state(), d.id, d.archived === "1"), "opp-menu-error", oppDone);
      }
      if (action === "order") return orderFromOpp(d.id);
      if (action === "delete") {
        if (!need("opp.delete") || oppBlocked(d.id)) return;
        if (oppArmed !== d.id) {
          oppArmed = d.id;
          return showOppMenu(d.id);
        }
        oppArmed = "";
        // 删除商机时一并删掉它的附件文件（先记下文件地址，保存成功之后再删）。
        const files = OM().filesOf(state(), d.id);
        return saveNext(() => OM().remove(state(), d.id), "opp-menu-error", oppDone).then((saved) => saved && discardFiles(files));
      }
    }
    // ---------- 商机详情与附件 ----------
    const attachView = { id: "", renaming: "", armed: "", preview: "", busy: false };
    let previewUrls = [];
    async function oppCall(path, payload) {
      if (!ctx.request) throw new Error("这里不能使用附件");
      const response = await ctx.request(path, payload);
      let data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok || !data || data.ok === false) throw new Error((data && data.message) || "操作没成功，请再试一次");
      return data;
    }
    const setText = (id, text, error = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.classList?.[error && text ? "add" : "remove"]?.("visible");
    };
    const attachError = (text) => setText("opp-attach-error", text, true);
    function detailBody(id) {
      const detail = OM().detailOf(state(), id, B.localDate());
      if (!detail) return "";
      const documents = DM() ? DM().docsFor(state(), { kind: "opportunity", id }).map((doc) => ({ id: doc.id, number: doc.number, typeName: doc.snapshot?.typeName || "", date: doc.date, voided: doc.status === "已作废" })) : [];
      // 联系人有能打开的号码、账号又能开聊天时，详情里多一个 WhatsApp 按钮。
      const hit = oppPhone(detail.client, detail.contact),
        whatsapp = hit && waE164(hit.phone, hit.code, hit.country) ? { phone: hit.phone, contact: hit.contact } : null;
      return OU().detailMarkup(detail, { today: B.localDate(), multiFlow: OM().flowsOf(state()).length > 1, documents, whatsapp }, attachView);
    }
    function showOppDetail(id) {
      if (oppBlocked(id)) return;
      const detail = OM().detailOf(state(), id, B.localDate());
      if (!detail) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      Object.assign(attachView, { id, renaming: "", armed: "", preview: "", busy: false });
      releasePreviews();
      ctx.dialog(
        E(detail.name),
        detailBody(id),
        `<button type="button" data-action="close-modal">关闭</button><button type="button" data-opp-action="menu" data-id="${E(id)}">更多操作</button>${can("opp.edit") ? `<button class="primary" type="button" data-opp-action="edit" data-id="${E(id)}">编辑商机</button>` : ""}`,
        "opp-detail",
      );
      hydratePreview();
    }
    function releasePreviews() {
      previewUrls.forEach((url) => root.URL?.revokeObjectURL?.(url));
      previewUrls = [];
    }
    // 图片预览：通过本机服务取回文件，转成页面内的临时地址显示。
    async function hydratePreview() {
      const img = document.querySelector?.("img[data-opp-fetch]");
      if (!img) return;
      const wanted = attachView.preview;
      try {
        const response = await ctx.request(`/api/opportunity-file?url=${encodeURIComponent(img.dataset.oppFetch)}`);
        if (!response.ok) throw new Error("没能打开这个文件，请再试一次");
        const url = root.URL.createObjectURL(await response.blob());
        if (attachView.preview !== wanted || !img.isConnected) return root.URL.revokeObjectURL(url);
        previewUrls.push(url);
        img.src = url;
      } catch (error) {
        attachError(`预览失败：${error.message}`);
      }
    }
    function refreshAttach() {
      const box = document.getElementById("opp-attach");
      const detail = OM().detailOf(state(), attachView.id, B.localDate());
      if (!box || !detail) return;
      releasePreviews();
      // 刷新列表不能把刚显示的错误提示冲掉。
      const shown = document.getElementById("opp-attach-error")?.textContent || "";
      box.innerHTML = OU().attachmentsInner(detail.attachments, attachView);
      if (shown) attachError(shown);
      hydratePreview();
    }
    // 文件已经传到本机但没能记进商机时，把这些文件删掉，不留孤儿文件。
    async function discardFiles(urls) {
      const fileUrls = urls.filter(Boolean);
      if (fileUrls.length) try { await oppCall("/api/opportunity-file/delete", { fileUrls }); } catch (_) {}
    }
    async function uploadFiles(fileList) {
      if (!need("opp.edit")) return;
      const id = attachView.id;
      if (!id || attachView.busy) return;
      const files = [...(fileList || [])];
      if (!files.length) return;
      attachError("");
      const item = oppItem(id);
      if (!item) return attachError("商机不存在，可能已被删除");
      if (!ctx.upload) return attachError("这里不能上传附件");
      const limits = OM().ATTACHMENT_LIMITS, notes = [], accepted = [];
      for (const file of files) {
        try { OM().checkFile(file); accepted.push(file); } catch (error) { notes.push(error.message); }
      }
      const room = Math.max(0, limits.maxCount - (Array.isArray(item.attachments) ? item.attachments.length : 0));
      if (accepted.length > room) {
        notes.push(`一个商机最多 ${limits.maxCount} 个附件，还能再添加 ${room} 个，其余 ${accepted.length - room} 个没有上传`);
        accepted.length = room;
      }
      if (!accepted.length) return attachError(notes.join("\n"));
      attachView.busy = true;
      refreshAttach();
      const uploaded = [];
      try {
        for (const [index, file] of accepted.entries()) {
          setText("opp-attach-status", `正在上传 ${index + 1} / ${accepted.length}：${file.name}`);
          try {
            const response = await ctx.upload(`/api/opportunity-file/upload?id=${encodeURIComponent(id)}&name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || "")}`, file);
            const data = await response.json().catch(() => null);
            if (!response.ok || !data || data.ok === false) throw new Error((data && data.message) || "请再试一次");
            uploaded.push(data.file);
          } catch (error) {
            notes.push(error.message.startsWith("「") ? error.message : `「${file.name}」上传失败：${error.message}`);
          }
        }
        if (uploaded.length) {
          setText("opp-attach-status", "正在保存…");
          const saved = await saveNext(() => OM().addAttachments(state(), id, uploaded), "opp-attach-error", () => { attachView.busy = false; refreshAttach(); });
          if (!saved) await discardFiles(uploaded.map((file) => file.fileUrl));
        }
      } finally {
        attachView.busy = false;
        setText("opp-attach-status", "");
        refreshAttach();
      }
      if (notes.length) attachError(notes.join("\n"));
    }
    function attachAction(d, form) {
      const id = attachView.id, action = d.attachAction;
      if ((action === "save" && !need("opp.fileDownload")) || (action === "delete" && !need("opp.fileDelete")) || (action === "rename" && !need("opp.edit"))) return;
      if (action !== "delete") attachView.armed = "";
      const entry = OM().attachmentsOf(oppItem(id)).find((item) => item.id === d.att);
      attachError("");
      if (action === "preview-close") { attachView.preview = ""; return refreshAttach(); }
      if (action === "rename-cancel") { attachView.renaming = ""; return refreshAttach(); }
      if (!entry) { attachError("附件不存在，可能已被删除"); return refreshAttach(); }
      if (action === "preview") { attachView.preview = entry.id; return refreshAttach(); }
      if (action === "rename") { attachView.renaming = entry.id; refreshAttach(); return document.querySelector?.("#opp-attach-rename input")?.select?.(); }
      if (action === "save") {
        return oppCall("/api/opportunity-file/save", { fileUrl: entry.fileUrl, name: entry.name })
          .then((data) => ctx.toast(`已保存到「下载」：${data.filename}`))
          .catch((error) => attachError(error.message));
      }
      if (action === "delete") {
        if (attachView.armed !== entry.id) { attachView.armed = entry.id; return refreshAttach(); }
        attachView.armed = "";
        return saveNext(() => OM().removeAttachment(state(), id, entry.id), "opp-attach-error", () => { if (attachView.preview === entry.id) attachView.preview = ""; refreshAttach(); })
          .then((saved) => saved && discardFiles([entry.fileUrl]));
      }
    }
    // ---------- 拖动、撤销、键盘 ----------
    const stageName = (id) => OM().flowOf(state(), oppView.filters.flow).stages.find((stage) => stage.id === id)?.label || id;
    const manualSort = () => oppView.filters.sort === "manual";
    function clearUndo() {
      oppView.undo = null;
      if (oppUndoTimer) root.clearTimeout?.(oppUndoTimer);
      oppUndoTimer = 0;
      oppUndoToast?.dismiss?.();
      oppUndoToast = null;
    }
    // 「撤销」放在页面唯一的提示条里（ctx.toast 带按钮），和提示条一样留 8 秒。
    function offerUndo(label, before, after) {
      clearUndo();
      oppView.undo = { label, before, after };
      oppUndoTimer = root.setTimeout?.(() => { oppUndoTimer = 0; oppView.undo = null; oppUndoToast = null; }, 8000) || 0;
      oppUndoToast = ctx.toast(label, { action: { label: "撤销", run: () => undoMove() } }) || null;
    }
    // 保存一次移动，成功后提示条换成「已移到…」并带 8 秒的「撤销」。
    function moveWithUndo(label, makeNext, errorId) {
      const before = state();
      let after = null;
      return saveNext(() => (after = makeNext()), errorId, oppDone).then((saved) => {
        if (saved) offerUndo(label, before, after);
        return saved;
      });
    }
    function undoMove() {
      const undo = oppView.undo;
      oppUndoToast = null;
      clearUndo();
      if (!undo) return;
      if (state() !== undo.after) { ctx.toast("数据已有新的修改，不能撤销了"); return render(true); }
      return saveNext(() => undo.before, "", () => {}).then((saved) => { if (saved) ctx.toast("已撤销"); });
    }
    // drop：拖放才有，{before}；没有 drop 参数就是菜单／键盘的普通移动。
    function moveOpp(id, stage, errorId, drop) {
      if (!need("opp.edit")) return;
      const item = oppItem(id);
      if (!item) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      if (notYours(item)) return;
      const current = OM().stageOf(state(), item).id;
      if (drop && current === stage && !manualSort()) return ctx.toast("当前不是「手动排序」，不能调整卡片的先后。想自己排顺序，请先把右上角的排序改成「手动排序」");
      if (current === stage && !drop) return;
      if (stage === "lost" && current !== "lost") return showOppLost(id);
      const label = current === stage ? `已调整「${item.name || "商机"}」的位置` : `已移到「${stageName(stage)}」`;
      if (drop && manualSort()) return moveWithUndo(label, () => OM().reorder(state(), id, { stage, before: drop.before }), errorId);
      return moveWithUndo(label, () => OM().moveStage(state(), id, stage), errorId);
    }
    function dragTarget(e) {
      const column = e.target.closest?.("[data-opp-drop]");
      if (!column) return null;
      let before = "";
      if (manualSort()) {
        const cards = [...(column.querySelectorAll?.(".opp-card") || [])].filter((card) => card.dataset.oppId !== oppDrag);
        before = OU().dropBefore(cards.map((card) => { const box = card.getBoundingClientRect(); return { id: card.dataset.oppId, top: box.top, bottom: box.bottom }; }), e.clientY);
      }
      return { column, stage: column.dataset.oppDrop, before };
    }
    function clearDragMarks() {
      oppHover = null;
      document.querySelectorAll?.(".opp-drop-line").forEach((node) => node.remove());
      document.querySelectorAll?.(".is-drop-target,.is-dragging,.is-dragging-board").forEach((node) => node.classList.remove("is-drop-target", "is-dragging", "is-dragging-board"));
    }
    function markDrop(target) {
      if (oppHover && oppHover.column === target.column && oppHover.before === target.before) return;
      document.querySelectorAll?.(".opp-drop-line").forEach((node) => node.remove());
      document.querySelectorAll?.(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
      oppHover = target;
      target.column.classList?.add("is-drop-target");
      if (!manualSort() || !document.createElement) return;
      const line = document.createElement("div");
      line.className = "opp-drop-line";
      const holder = target.column.querySelector(".opp-cards"), next = target.before && holder?.querySelector(`[data-opp-id="${cssEscape(target.before)}"]`);
      if (next) holder.insertBefore(line, next);
      else holder?.insertBefore(line, holder.querySelector(".opp-more"));
    }
    // 拖到看板左右边缘横向滚动，拖到页面上下边缘纵向滚动。
    function autoScroll(e) {
      const board = e.target.closest?.(".opp-board"), page = e.target.closest?.(".opp-page");
      if (board?.getBoundingClientRect) {
        const box = board.getBoundingClientRect();
        board.scrollLeft += OU().scrollStep(e.clientX, box.left, box.right);
      }
      if (page?.getBoundingClientRect) {
        const box = page.getBoundingClientRect();
        page.scrollTop += OU().scrollStep(e.clientY, box.top, box.bottom);
      }
    }
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    function cardKey(e) {
      if (route !== "opportunities" || oppView.mode === "list" || e.defaultPrevented || e.isComposing || e.repeat) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (e.target.closest?.("input,select,textarea,[contenteditable]")) return;
      const card = e.target.closest?.(".opp-card");
      if (!card) return;
      const id = card.dataset.oppId, vertical = e.key.startsWith("ArrowU") || e.key.startsWith("ArrowD");
      if (vertical !== Boolean(e.altKey)) return;
      e.preventDefault();
      const refocus = () => document.querySelector?.(`[data-opp-id="${cssEscape(id)}"] .opp-card-name`)?.focus?.({ preventScroll: false });
      if (!vertical) {
        const columns = OM().board(state(), oppView.filters, B.localDate()).columns.map((column) => column.id);
        const at = columns.indexOf(OM().stageOf(state(), oppItem(id) || {}).id), to = columns[at + (e.key === "ArrowLeft" ? -1 : 1)];
        if (at < 0 || !to) return;
        return Promise.resolve(moveOpp(id, to, "")).then(refocus);
      }
      if (!manualSort()) return ctx.toast("要用键盘调整先后，请先把排序改成「手动排序」");
      const cards = [...(card.parentElement?.querySelectorAll?.(".opp-card") || [])], at = cards.indexOf(card);
      const stage = card.closest("[data-opp-drop]")?.dataset.oppDrop;
      const before = e.key === "ArrowUp" ? cards[at - 1]?.dataset.oppId : cards[at + 2]?.dataset.oppId || "";
      if (at < 0 || (e.key === "ArrowUp" && at === 0) || (e.key === "ArrowDown" && at === cards.length - 1)) return;
      return Promise.resolve(moveOpp(id, stage, "", { before })).then(refocus);
    }
    const OPP_FILTERS = { "opp-flow": "flow", "opp-sort": "sort", "opp-currency": "currency", "opp-date-field": "dateField", "opp-from": "from", "opp-to": "to", "opp-archived": "archived", "opp-owner": "owner", "opp-search": "search" };
    // ---------- 线索：列表、新建／编辑、写跟进、转为客户、标记无效、回收站 ----------
    const LD = () => root.LaiLeadModel;
    let leadUI = null;
    // 字段权限：线索字段当前账号是 edit｜read｜hidden（系统管理员都是 edit）；leadHidden 是看不到的字段名。
    const leadLevel = (key) => (RM() ? RM().fieldLevel(state(), "lead", key) : "edit");
    const leadHidden = () => (RM() ? RM().lockedFields(state(), "lead").filter((key) => leadLevel(key) === "hidden") : []);
    const LU = () => leadUI || (leadUI = root.LaiLeadUI.create(E, LD(), can, leadLevel));
    const leadView = { filters: {}, limit: 0 };
    // leadDraft：正在新建或编辑的线索；leadArmed：回收站里等待再次确认彻底删除的那一条。
    let leadDraft = null,
      leadArmed = "";
    const onLeadPage = () => route === "leads" || route === "lead-trash";
    function renderLeads() {
      const today = B.localDate();
      const page = LD().page(scoped(), leadView.filters, today, leadHidden());
      return header("线索", "还没成为客户的潜在买家：先跟进，谈成了转为客户", exportButton("lead") + LU().headerActions(page)) + LU().pageMarkup(page, leadView, today);
    }
    function renderLeadTrash() {
      const today = B.localDate();
      return header("线索回收站", "移入回收站的线索可以恢复，也可以彻底删除", '<button type="button" data-lead-action="list-page">返回线索列表</button>') + LU().trashMarkup(LD().trash(scoped(), today), leadArmed, today);
    }
    // 线索不归当前账号负责（角色只看本人或本部门时）：提示一句，什么也不做。
    const leadBlocked = (id) => notYours(LD().list(state()).find((entry) => entry.id === id));
    // 每个线索操作要的权限；写跟进、标记无效、重新跟进、恢复都算“编辑”。
    const LEAD_NEED = { new: "lead.create", edit: "lead.edit", follow: "lead.edit", convert: "lead.convert", invalid: "lead.edit", reopen: "lead.edit", trash: "lead.delete", restore: "lead.edit", delete: "lead.purge", wa: "chat.send" };
    const leadContext = () => ({ owners: LD().ownerNames(state()), sources: LD().sourceNames(state()), customers: LD().customerNames(pickState()), rules: LD().fieldRules(state()), customFields: LD().customFields(state()) });
    function openLeadForm(id) {
      if (!need(id === undefined ? "lead.create" : "lead.edit") || (id !== undefined && leadBlocked(id))) return;
      let next;
      if (id === undefined) next = { id: crypto.randomUUID(), isNew: true, values: LD().defaults(state()) };
      else {
        const item = LD().list(state()).find((entry) => entry.id === id);
        if (!item) return ctx.toast("线索不存在，可能已被删除，请刷新后重试");
        next = { id, isNew: false, values: { ...item } };
      }
      try {
        ctx.dialog(
          next.isNew ? "新建线索" : "编辑线索",
          LU().formMarkup(next.values, leadContext()),
          `${footError("lead-error")}<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="lead-form">保存线索</button>`,
          "business-lead",
        );
      } catch (error) {
        return ctx.toast(`无法打开线索表单：${error.message}`);
      }
      leadDraft = { id: next.id, isNew: next.isNew };
    }
    // 打开线索详情；focusFollow 为真时光标直接落在「写跟进」里。
    function showLead(id, focusFollow = false) {
      if (leadBlocked(id)) return;
      const row = LD().detail(state(), id, B.localDate());
      if (!row) return ctx.toast("线索不存在，可能已被删除，请刷新后重试");
      ctx.dialog(E(row.name), LU().detailMarkup(row, B.localDate()), '<button type="button" data-action="close-modal">关闭</button>', "business-lead-detail");
      if (focusFollow) document.querySelector?.('#lead-follow-form textarea[name="text"]')?.focus?.({ preventScroll: true });
    }
    // ---- WhatsApp（线索、商机详情里的按钮）----
    // 对话框是 whatsapp-ui.js 的那一个（有模板、复制、问一句发出去了吗），这里只告诉它号码和“记一笔”记到哪里：
    // 线索没有客户资料，记进线索自己的跟进；商机记进客户动态（对话框默认就是这样）。
    function waE164(phone, code, country) {
      try {
        return root.LaiWhatsAppModel?.toE164(phone, { code: code || "", country: country || "" }) || "";
      } catch {
        return "";
      }
    }
    // 线索还在跟进中、账号能改线索时才记；已转客户或无效的线索不问“发出去了吗”。
    const leadWaLog = (row) =>
      can("lead.edit") && ["new", "following"].includes(row.status)
        ? async (message) => {
            await ctx.save(LD().addFollowup(state(), row.id, { text: `WhatsApp 聊天：${message}` }));
            render();
            showLead(row.id);
            return "已记到线索跟进";
          }
        : undefined;
    function openLeadConvert(id) {
      if (!need("lead.convert") || leadBlocked(id)) return;
      const row = LD().detail(state(), id, B.localDate());
      if (!row) return ctx.toast("线索不存在，可能已被删除，请刷新后重试");
      let values;
      try {
        values = LD().convertDefaults(state(), id);
      } catch (error) {
        return ctx.toast(error.message);
      }
      ctx.dialog("转为客户", LU().convertMarkup(row, values, leadContext()), '<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="lead-convert-form">转为客户</button>', "business-lead-convert");
    }
    // 转入方式切换：只显示并启用当前方式要填的那几项。
    function syncLeadConvert(form) {
      const existing = form.elements.mode.value === "existing";
      for (const [id, on] of [["lead-convert-new", !existing], ["lead-convert-existing", existing]]) {
        const box = document.getElementById(id);
        if (!box) continue;
        box.hidden = !on;
        box.querySelectorAll("input").forEach((input) => {
          input.disabled = !on;
          input.required = on && input.name !== "owner";
        });
      }
    }
    const leadSaved = (id) => () => {
      ctx.closeDialog();
      render();
      if (id) showLead(id);
      return false;
    };
    function leadAction(d) {
      const action = d.leadAction;
      if (Object.hasOwn(LEAD_NEED, action) && !need(LEAD_NEED[action])) return;
      if (d.id && leadBlocked(d.id)) return;
      if (action !== "delete") leadArmed = "";
      if (action === "new") return openLeadForm();
      if (action === "edit") return openLeadForm(d.id);
      if (action === "open") return showLead(d.id);
      if (action === "follow") return showLead(d.id, true);
      if (action === "convert") return openLeadConvert(d.id);
      if (action === "wa") {
        const row = LD().detail(state(), d.id, B.localDate());
        if (!row) return ctx.toast("线索不存在，可能已被删除，请刷新后重试");
        return ctx.openWhatsApp({ lead: { id: row.id, name: row.name, country: row.country }, contact: row.contact, phone: row.phone, onLog: leadWaLog(row) });
      }
      if (action === "trash-page") return ctx.navigate("lead-trash");
      if (action === "list-page") return ctx.navigate("leads");
      if (action === "more") {
        leadView.limit = Math.max(root.LaiLeadUI.PAGE, Number(leadView.limit) || 0) + root.LaiLeadUI.PAGE;
        return render();
      }
      if (action === "due") {
        leadView.filters = { ...leadView.filters, due: !(leadView.filters.due === true) };
        leadView.limit = 0;
        render();
        return document.querySelector?.('[data-lead-action="due"]')?.focus?.({ preventScroll: true });
      }
      if (action === "invalid") {
        const row = LD().detail(state(), d.id, B.localDate());
        if (!row) return ctx.toast("线索不存在，可能已被删除，请刷新后重试");
        return ctx.dialog("标记无效", LU().invalidMarkup(row), '<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="lead-invalid-form">标记无效</button>', "business-lead-invalid");
      }
      const errorId = route === "lead-trash" ? "lead-trash-error" : "lead-detail-error";
      if (action === "reopen") return saveNext(() => LD().reopen(state(), d.id), errorId, leadSaved(d.id));
      if (action === "trash") return saveNext(() => LD().setTrashed(state(), d.id, true), errorId, leadSaved(""));
      if (action === "restore") return saveNext(() => LD().setTrashed(state(), d.id, false), errorId, leadSaved(""));
      if (action === "delete") {
        if (leadArmed !== d.id) {
          leadArmed = d.id;
          render();
          return document.querySelector?.(`[data-lead-action="delete"][data-id="${cssEscape(d.id)}"]`)?.focus?.({ preventScroll: true });
        }
        leadArmed = "";
        return saveNext(() => LD().remove(state(), d.id), errorId, leadSaved(""));
      }
    }
    // ---------- 产品：列表、分组、同步、字段、规格、布局 ----------
    const PM = () => root.LaiProductModel;
    // 订单里选产品：没有“查看产品”权限的账号不列出产品库；角色看不到的产品字段不带进订单明细。
    const orderProducts = () => (PM() && can("product.view") ? PM().list(state()).map((p) => PM().forRole(state(), p)) : []);
    let productUI = null;
    const PU = () => productUI || (productUI = root.LaiProductUI.create(E, PM(), can));
    const prodView = { tab: "list", search: "", group: "", editing: null, armed: "", layoutEdit: "" };
    let prodDraft = null;
    let syncDraft = null;
    function renderProducts() {
      return header("产品", "你卖的产品：分组、字段、规格都在这里设置", "") + `<div class="business-scroll">${PU().pageMarkup(state(), prodView)}</div>`;
    }
    function prodSave(makeNext, after) {
      const box = document.getElementById("prod-error");
      box?.classList.remove("visible");
      return saveNext(makeNext, "prod-error", () => {
        prodView.editing = null;
        prodView.armed = "";
        return after ? after() : undefined;
      });
    }
    function openProductForm(id) {
      const old = id === undefined ? null : PM().find(state(), id);
      if (id !== undefined && !old) return ctx.toast("产品不存在，可能已被删除，请刷新后重试");
      prodDraft = { id: old ? old.id : undefined };
      ctx.dialog(old ? "编辑产品" : "新建产品", PU().formMarkup(state(), old || PM().emptyValues(state()), !old), `${footError("product-error")}<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="product-form">保存产品</button>`, "business-product");
    }
    function openProductDetail(id) {
      const product = PM().find(state(), id);
      if (!product) return ctx.toast("产品不存在，可能已被删除，请刷新后重试");
      ctx.dialog("产品详情", PU().detailMarkup(state(), product), `<button type="button" data-action="close-modal">关闭</button>${can("product.edit") ? `<button class="primary" type="button" data-prod-action="edit" data-id="${E(product.id)}">编辑</button>` : ""}`, "business-product");
    }
    // ---- 从表格同步：选文件 → 预览 → 确认 → 记一条任务（可撤销）----
    function syncRefresh() {
      const box = document.querySelector("#overlay-root .drawer");
      if (!box || !syncDraft) return;
      box.querySelector(".drawer-body")?.replaceWith(Object.assign(document.createElement("div"), { innerHTML: PU().syncMarkup(state(), syncDraft) }).firstElementChild);
      const foot = box.querySelector(".drawer-footer");
      if (foot) foot.innerHTML = PU().syncFooter(syncDraft);
    }
    function openSyncDialog() {
      syncDraft = { fileName: "", mode: "code", records: null, plan: null, ignored: [], hidden: [], error: "" };
      ctx.dialog("从表格导入产品", PU().syncMarkup(state(), syncDraft), PU().syncFooter(syncDraft), "business-product-sync");
      document.querySelector("#overlay-root .drawer")?.classList.add("prod-sync-dialog");
    }
    async function readSyncFile(file) {
      if (!syncDraft || !need("product.sync")) return;
      const draft = syncDraft;
      try {
        if (!file || !/\.(csv|xls|xlsx)$/i.test(file.name)) throw new Error("请选择 Excel 或 CSV 文件");
        if (file.size > 5 * 1024 * 1024) throw new Error("文件不能超过 5 MB");
        const I = root.LaiCustomerImport;
        let parsed;
        try {
          parsed = /\.csv$/i.test(file.name) ? I.parseCsv(await file.text()) : I.parseExcel(await file.arrayBuffer(), root.XLSX);
        } catch (error) {
          throw new Error(String(error.message).replace(/客户/g, "产品"));
        }
        const table = PM().readTable(state(), parsed.headers, parsed.rows, parsed.lineNumbers);
        if (syncDraft !== draft) return;
        Object.assign(draft, { fileName: file.name, records: table.records, ignored: table.ignored, hidden: table.hidden, error: "" });
        draft.plan = PM().planSync(state(), draft.records, { mode: draft.mode });
      } catch (error) {
        if (syncDraft !== draft) return;
        Object.assign(draft, { fileName: "", records: null, plan: null, ignored: [], hidden: [], error: error.message });
      }
      syncRefresh();
    }
    function syncMode(mode) {
      if (!syncDraft) return;
      syncDraft.mode = mode;
      try {
        if (syncDraft.records) syncDraft.plan = PM().planSync(state(), syncDraft.records, { mode });
      } catch (error) {
        syncDraft.error = error.message;
      }
      syncRefresh();
    }
    function commitSync() {
      const draft = syncDraft;
      if (!draft?.plan) return;
      return saveNext(
        () => PM().syncProducts(state(), draft.records, { mode: draft.mode, fileName: draft.fileName }).state,
        "prod-sync-error",
        () => {
          syncDraft = null;
          prodView.tab = "sync";
          ctx.closeDialog();
        },
      );
    }
    function downloadSyncTemplate() {
      const X = root.XLSX;
      if (!X) return ctx.toast("Excel 模板组件未加载，请重新打开来财");
      const book = X.utils.book_new();
      X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([PM().templateHeaders(state())]), "产品");
      const bytes = X.write(book, { type: "array", bookType: "xlsx" });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "来财产品导入模板.xlsx";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    // ---- 布局 ----
    function layoutClick(d) {
      const kind = d.prodLay, id = d.layout;
      if (kind === "open") {
        prodView.layoutEdit = prodView.layoutEdit === id ? "" : id;
        prodView.editing = null;
        return render();
      }
      if (kind === "copy") {
        const from = PM().layoutById(state(), id);
        const newId = "l" + crypto.randomUUID().slice(0, 8);
        return prodSave(
          () => PM().addLayout(state(), { name: PM().suggestLayoutName(state(), from ? from.name : "布局"), fromId: id, id: newId }),
          () => {
            prodView.layoutEdit = newId;
          },
        );
      }
      if (kind === "delete")
        return prodSave(
          () => PM().deleteLayout(state(), id),
          () => {
            if (prodView.layoutEdit === id) prodView.layoutEdit = "";
          },
        );
      if (kind === "section-move") return prodSave(() => PM().moveSection(state(), id, Number(d.index), Number(d.delta)));
      if (kind === "field-move") return prodSave(() => PM().moveLayoutField(state(), id, d.key, Number(d.delta)));
      if (kind === "field-hide") return prodSave(() => PM().hideLayoutField(state(), id, d.key));
    }
    function layoutSelect(el) {
      if (!need("settings.product")) return render();
      const d = el.dataset;
      if (!el.value) return;
      const value = el.value;
      const done = (ok) => {
        if (!ok) el.value = d.prodSel === "use" ? PM().settings(state()).layoutUse[d.place] : "";
      };
      if (d.prodSel === "use") return prodSave(() => PM().setLayoutUse(state(), d.place, value)).then(done);
      if (d.prodSel === "move") return prodSave(() => PM().moveFieldToSection(state(), d.layout, d.key, Number(value))).then(done);
      if (d.prodSel === "show") return prodSave(() => PM().showLayoutField(state(), d.layout, d.key, Number(value))).then(done);
    }
    // 每个产品操作要的权限；产品的分组、字段、规格、布局是产品设置，要 settings.product（见 productClick）。
    const PROD_NEED = { new: "product.create", edit: "product.edit", delete: "product.delete", "sync-open": "product.sync", "sync-template": "product.sync", "sync-commit": "product.sync", "sync-undo": "product.sync" };
    function productAction(d) {
      const action = d.prodAction;
      if (Object.hasOwn(PROD_NEED, action) && !need(PROD_NEED[action])) return;
      if (action !== "delete" && action !== "sync-undo") prodView.armed = "";
      if (action === "new") return openProductForm();
      if (action === "edit") return openProductForm(d.id);
      if (action === "view") return openProductDetail(d.id);
      if (action === "sync-open") return openSyncDialog();
      if (action === "sync-template") return downloadSyncTemplate();
      if (action === "sync-commit") return commitSync();
      if (action === "sync-undo") {
        if (prodView.armed !== `undo:${d.id}`) {
          prodView.armed = `undo:${d.id}`;
          render();
          return document.querySelector?.(`[data-prod-action="sync-undo"][data-id="${cssEscape(d.id)}"]`)?.focus?.({ preventScroll: true });
        }
        return prodSave(() => PM().undoSync(state(), d.id).state);
      }
      if (action === "delete") {
        if (prodView.armed !== d.id) {
          prodView.armed = d.id;
          render();
          return document.querySelector?.(`[data-prod-action="delete"][data-id="${cssEscape(d.id)}"]`)?.focus?.({ preventScroll: true });
        }
        return prodSave(() => PM().remove(state(), d.id));
      }
    }
    function productClick(d) {
      if (d.prodTab && d.prodTab !== "list" && !need(d.prodTab === "sync" ? "product.sync" : "settings.product")) return;
      if ((d.prodLay || d.prodEdit || d.prodSub || d.prodMove || d.prodDelete || d.prodValueRemove) && !need("settings.product")) return;
      if (d.prodTab) {
        prodView.tab = d.prodTab;
        prodView.editing = null;
        prodView.armed = "";
        return render();
      }
      if (d.prodAction) return productAction(d);
      if (d.prodLay) return layoutClick(d);
      if (d.prodCancel !== undefined) {
        prodView.editing = null;
        return render();
      }
      if (d.prodEdit) {
        prodView.editing = { kind: d.prodEdit, key: d.key };
        render();
        return document.querySelector?.(".cs-inline input")?.focus?.({ preventScroll: true });
      }
      if (d.prodSub) {
        prodView.editing = { kind: "groupsub", key: d.prodSub };
        render();
        return document.querySelector?.('[data-prod-form="group-add"][data-parent] input')?.focus?.({ preventScroll: true });
      }
      if (d.prodMove) return prodSave(() => PM().moveGroup(state(), d.prodMove, Number(d.delta)));
      if (d.prodDelete) return prodSave(() => (d.prodDelete === "spec" ? PM().deleteSpec(state(), d.key) : PM().deleteGroup(state(), d.key)));
      if (d.prodValueRemove) return prodSave(() => PM().removeSpecValue(state(), d.prodValueRemove, d.value));
    }
    function productSubmit(form) {
      if (!need("settings.product")) return;
      const kind = form.dataset.prodForm, data = Object.fromEntries(new FormData(form));
      const text = (key) => String(data[key] || "");
      return prodSave(() => {
        if (kind === "group-add") return PM().addGroup(state(), { name: text("name"), parentId: form.dataset.parent || "" });
        if (kind === "group-rename") return PM().renameGroup(state(), form.dataset.id, text("name"));
        if (kind === "spec-add") return PM().addSpec(state(), text("name"));
        if (kind === "spec-rename") return PM().renameSpec(state(), form.dataset.id, text("name"));
        if (kind === "value-add") return PM().addSpecValue(state(), form.dataset.id, text("value"));
        if (kind === "layout-add") return PM().addLayout(state(), { name: text("name") });
        if (kind === "layout-rename") return PM().renameLayout(state(), form.dataset.id, text("name"));
        if (kind === "section-rename") return PM().renameSection(state(), form.dataset.layout, Number(form.dataset.index), text("name"));
        throw new Error("无法保存");
      });
    }
    function productFormSubmit(form) {
      if (!prodDraft) return;
      const data = Object.fromEntries(new FormData(form));
      const specs = Object.entries(data).filter(([key, value]) => key.startsWith("spec:") && value).map(([key, value]) => ({ type: key.slice(5), value }));
      const { id } = prodDraft;
      if (!need(id === undefined ? "product.create" : "product.edit")) return;
      // 布局里没放进表单的字段，保留原来的内容，不当成清空。
      const previous = id === undefined ? null : PM().find(state(), id);
      const shown = new Set(PM().formSections(state()).flatMap((sec) => sec.fields.map((item) => item[0])));
      const kept = previous ? Object.fromEntries(PM().FIELDS.map((item) => item[0]).filter((key) => !shown.has(key)).map((key) => [key, previous[key] ?? ""])) : {};
      return saveNext(
        () => PM().upsert(state(), id, { ...kept, ...data, specs }),
        "product-error",
        () => {
          prodDraft = null;
          ctx.closeDialog();
        },
      );
    }
    // ---------- 单据模板：报价单、形式发票、销售订单、发货通知 ----------
    const DM = () => root.LaiDocTemplateModel;
    let docUI = null;
    const DU = () => docUI || (docUI = root.LaiDocTemplateUI.create(E, DM(), can));
    const docView = { tab: "quote", armed: "", armedVoid: "", rec: { type: "", query: "" } };
    const docToday = () => (B.localDate ? B.localDate() : "");
    function renderDocTemplates() {
      // 只看本人或本部门的账号：单据记录里只列来源订单／商机归自己的（只用来画页面，编号规则等仍按完整数据）。
      const full = state(),
        shown = RM() && RM().scopeOf(full) !== "all" ? { ...full, laiVisibleDocIds: DM().visibleDocumentIds(full, sees) } : full;
      return header("单据模板", "报价单、形式发票等长什么样，在这里设置并预览", "") + `<div class="business-scroll">${DU().pageMarkup(shown, { ...docView, date: docToday() })}</div>`;
    }
    function docPrint(type) {
      return printDocument(DM().preview(state(), type, { date: B.localDate ? B.localDate() : "" }));
    }
    // 只把单据本身放进一个看不见的框里打印；在打印窗口里可以选“存为 PDF”。
    function printDocument(doc) {
      const html = DU().printHtml(doc);
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      document.body.appendChild(frame);
      frame.srcdoc = html;
      frame.onload = () => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (error) {
          ctx.toast("这里打不开打印，请换个浏览器试试");
        }
        setTimeout(() => frame.remove(), 60000);
      };
    }
    // 保存过的单据：在抽屉里看（用保存时那一份内容，改了模板也不变），可以重新打印。
    let docVoidArmed = "";
    // 单据看不看得到：全公司都看得到；只看本人或本部门的账号，看来源订单／商机的负责人看不看得到。
    const docVisible = (doc) => !RM() || RM().scopeOf(state()) === "all" || sees(DM().ownerOfDocument(state(), doc));
    // 作废按钮：要有“作废单据”权限，已作废的不再显示。
    const docVoidButton = (doc) => (doc.status === "已作废" || !can("doc.void") ? "" : button("docrec-void", "作废", `data-id="${E(doc.id)}"`));
    function viewDoc(id) {
      const doc = DM().getDocument(state(), id);
      if (!doc) return ctx.toast("找不到这张单据");
      if (!docVisible(doc)) return ctx.toast("这条记录不归你负责");
      docVoidArmed = "";
      const voided = doc.status === "已作废";
      ctx.dialog(
        E(`${doc.snapshot.typeName} ${doc.number}`),
        `<div class="drawer-body doc-view">${DU().paperMarkup(doc)}</div>`,
        `<button type="button" data-action="close-modal">关闭</button>${docVoidButton(doc)}${voided ? "" : button("docrec-print", "打印 / 存为 PDF", `data-id="${E(doc.id)}"`, true)}`,
        "doc-view",
      );
    }
    // 在订单／商机里看到的单据也能作废（不用先去单据模板页）：第一次点要再点一次确认。
    function docVoidAction(id) {
      if (!need("doc.void")) return;
      const doc = DM().getDocument(state(), id);
      if (!doc) return ctx.toast("找不到这张单据");
      if (!docVisible(doc)) return ctx.toast("这条记录不归你负责");
      if (docVoidArmed !== id) {
        docVoidArmed = id;
        const btn = document.querySelector?.(`[data-biz-action="docrec-void"][data-id="${id}"]`);
        if (btn) {
          btn.textContent = "确定作废";
          btn.classList?.add("team-danger");
        }
        return;
      }
      docVoidArmed = "";
      const inOrder = !!orderForm() && !!draft?.items;
      return saveNext(
        () => DM().voidDocument(state(), id),
        "doc-void-error",
        () => {
          if (inOrder) {
            showOrderSaved(id);
            const list = document.getElementById("biz-order-saved");
            if (list) list.innerHTML = orderSavedMarkup();
          } else viewDoc(id);
          return false;
        },
      );
    }
    function docRecAction(action, d) {
      if (action === "docrec-void") return docVoidAction(d.id);
      if (action === "docrec-print") {
        const doc = DM().getDocument(state(), d.id);
        if (!doc) return ctx.toast("找不到这张单据");
        if (!docVisible(doc)) return ctx.toast("这条记录不归你负责");
        if (doc.status === "已作废") return ctx.toast("这张单据已作废，不能打印");
        return printDocument(doc.snapshot);
      }
      // 订单表单里直接在下面看，不关掉正在填的表单。
      if (action === "docrec-view") return orderForm() && draft?.items ? showOrderSaved(d.id) : viewDoc(d.id);
    }
    // 编号规则表单：边改边显示“下一张”的编号；填得不对就在那里说明原因。
    function docNumberingExample(form) {
      const data = Object.fromEntries(new FormData(form)), box = form.querySelector("[data-doc-example]");
      if (!box) return;
      try {
        box.innerHTML = DU().exampleMarkup(DM().nextNumber(state(), form.dataset.type, docToday(), { prefix: data.prefix, dateMode: data.dateMode, digits: data.digits, reset: data.reset }).number);
      } catch (error) {
        box.innerHTML = DU().exampleMarkup("", error.message);
      }
    }
    // 返回 true 表示这个输入事件是单据页的，别处不用再处理。
    function docInput(e, kind) {
      if (route !== "doc-templates") return false;
      const name = e.target.dataset?.docFilter;
      if (name && (kind === "change") === (e.target.tagName === "SELECT")) {
        if (e.isComposing) return true;
        docView.rec = { ...docView.rec, [name]: e.target.value };
        docView.armedVoid = "";
        const pos = e.target.selectionStart;
        render();
        const again = document.querySelector?.(`[data-doc-filter="${name}"]`);
        again?.focus?.({ preventScroll: true });
        if (name === "query" && again?.setSelectionRange) again.setSelectionRange(pos, pos);
        return true;
      }
      const form = e.target.closest?.('[data-doc-form="numbering"]');
      if (form) {
        // 换了日期部分：重置方式回到“跟日期部分一致”，免得选出互相矛盾的组合。
        if (kind === "change" && e.target.name === "dateMode" && form.elements.reset) form.elements.reset.value = "";
        docNumberingExample(form);
        return true;
      }
      return false;
    }
    function docClick(d) {
      if ((d.docAction === "reset" && !need("settings.docTemplate")) || (d.docAction === "void" && !need("doc.void"))) return;
      if (d.docAction !== "void") docView.armedVoid = "";
      if (d.docTab) {
        docView.tab = d.docTab;
        docView.armed = "";
        return render();
      }
      if (d.docAction === "void" && !docVisible(DM().getDocument(state(), d.id) || {})) return ctx.toast("这条记录不归你负责");
      if (d.docAction === "view") return viewDoc(d.id);
      if (d.docAction === "source") return d.kind === "opportunity" ? showOppDetail(d.id) : need("order.view") && orderEditor(d.id);
      if (d.docAction === "void") {
        if (docView.armedVoid !== d.id) {
          docView.armedVoid = d.id;
          return render();
        }
        docView.armedVoid = "";
        return saveNext(() => DM().voidDocument(state(), d.id), "doc-error");
      }
      if (d.docAction === "print") return docPrint(d.type);
      if (d.docAction === "reset") {
        if (docView.armed !== "reset") {
          docView.armed = "reset";
          return render();
        }
        docView.armed = "";
        return saveNext(() => DM().resetTemplate(state(), d.type), "doc-error");
      }
    }
    function docSubmit(form) {
      if (!need("settings.docTemplate")) return;
      const data = Object.fromEntries(new FormData(form));
      docView.armed = "";
      // 出错时写在这张表单的保存按钮旁边（页面往下滚了也看得见）。
      const slot = form.querySelector("[data-form-error]") || "doc-error";
      if (form.dataset.docForm === "company") {
        const pick = (kind, fields) => Object.fromEntries(fields.map(([key]) => [key, data[`${kind}:${key}`] || ""]));
        return saveNext(() => DM().setBank(DM().setCompany(state(), pick("company", DM().COMPANY_FIELDS)), pick("bank", DM().BANK_FIELDS)), slot);
      }
      if (form.dataset.docForm === "numbering") return saveNext(() => DM().setNumbering(state(), form.dataset.type, { prefix: data.prefix, dateMode: data.dateMode, digits: data.digits, reset: data.reset }), slot);
      const columns = Object.fromEntries(DM().COLUMNS.map(([key]) => [key, `col:${key}` in data]));
      return saveNext(() => DM().setTemplate(state(), form.dataset.type, { title: data.title, terms: data.terms, footer: data.footer, columns, showBank: "showBank" in data, showSignature: "showSignature" in data }), slot);
    }
    const LEAD_FILTERS = { "lead-search": "search", "lead-owner": "owner", "lead-source": "source", "lead-sort": "sort" };
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
      // 没有「查看订单」权限的账号，日程里不显示订单。
      const events = B.calendarEvents(dashState(), month).filter((e) => e.kind !== "order" || can("order.view")),
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
        `${taskOwnerHint()}<div class="business-scroll calendar-layout"><section class="business-section"><div class="calendar-week">${["一", "二", "三", "四", "五", "六", "日"].map((d) => `<span>周${d}</span>`).join("")}</div><div class="calendar-grid">${Array.from({ length: offset }, () => '<div class="calendar-blank"></div>').join("")}${Array.from(
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
        )}</div></section><aside class="business-section calendar-agenda"><div class="section-head"><h3>${selectedDate || month} 日程</h3>${selectedDate ? button("all-days", "全部") : ""}</div>${shown.map((e) => `<button class="agenda-item" ${e.kind === "order" ? `data-biz-order="${E(e.id)}"` : e.kind === "followup" ? `data-biz-customer="${E(e.customer)}"` : `data-biz-edit-task="${E(e.id)}"`}><time>${e.date}</time><strong>${E(e.title)}</strong><span>${{ order: "订单", followup: "客户跟进", task: "待办任务" }[e.kind]}${e.kind === "task" && taskWho(e) ? ` · ${E(taskWho(e))}` : ""}</span></button>`).join("") || '<div class="small-empty">暂无日程</div>'}</aside></div>`
      );
    }
    function renderSettingsHub() {
      const settings = state().laiSettings || {},
        old = state().orderSettings || {},
        theme = THEME_CHOICES.find(([id]) => id === savedTheme(settings)) || THEME_CHOICES.find(([id]) => id === DEFAULT_THEME);
      return root.LaiSettingsHub.markup(
        { orderPrefix: settings.orderPrefix || old.orderPrefix || "L", currency: settings.defaultCurrency || old.defaultCurrency || "USD", themeName: theme[1], testData: Boolean(root.LaiWebTrial), can },
        E,
      );
    }
    // 默认币种的选项：当前已存的币种一定在里面，保存设置时不会被悄悄换掉。
    const CURRENCIES = ["USD", "EUR", "GBP", "CNY", "CAD", "AUD", "JPY", "HKD", "SGD", "RUB", "AED", "INR", "BRL", "MXN"];
    const currencyChoices = (current) => [...new Set([current, ...CURRENCIES].filter(Boolean))];
    // 公司资料：和“单据模板 → 公司信息”是同一份（docTemplates.company / bank），在哪里改都一样。
    function companySection() {
      if (!DM()) return "";
      const co = DM().settings(state()),
        field = (kind, [key, label], values) => `<label class="field">${E(label)}<input name="${kind}:${key}" value="${E(values[key])}" maxlength="${DM().LIMITS.line}" autocomplete="off"></label>`;
      return `<div class="section-head" data-company-section><h3>公司资料</h3><span class="muted tiny">报价单、形式发票等单据都用这里的资料；在“单据模板 → 公司信息”里看到的是同一份</span></div><div class="form-grid">${DM().COMPANY_FIELDS.map((f) => field("company", f, co.company)).join("")}${DM().BANK_FIELDS.map((f) => field("bank", f, co.bank)).join("")}</div>`;
    }
    // 设置页里的「订单字段」一节：数据规则在 order-fields-model.js，页面在 order-fields-ui.js。
    const orderFieldsSection = () => (root.LaiOrderFieldsUI && root.LaiOrderFields && can("settings.general") ? root.LaiOrderFieldsUI.settingsMarkup(extraCtx()) : "");
    // 设置页是自带的页面，订单字段这一节的点击、输入、提交从这里转过去（只在真的停在设置页时）。
    const settingsExtra = () => (route === "settings" && !(ctx.isActive && !ctx.isActive()) ? root.LaiOrderFieldsUI || null : null);
    function renderSettings() {
      const settings = state().laiSettings || {},
        old = state().orderSettings || {},
        currentTheme = THEME_CHOICES.some(([id]) => id === savedTheme(settings)) ? savedTheme(settings) : DEFAULT_THEME;
      return (
        header("设置", "来财的默认录入与本地数据管理") +
        `<div class="business-scroll settings-layout"><form id="biz-settings-form" class="business-section" novalidate data-form-check><div class="section-head"><h3>默认录入</h3></div><div class="form-grid"><label class="field">订单编号前缀${REQ}<input name="orderPrefix" value="${E(settings.orderPrefix || old.orderPrefix || "L")}" aria-required="true" required pattern="[A-Za-z0-9\\-]+" data-invalid-text="订单前缀只能用字母、数字和-" maxlength="12"></label><label class="field">默认币种<select name="defaultCurrency">${currencyChoices(settings.defaultCurrency || old.defaultCurrency || "USD").map((c) => option(c, c, settings.defaultCurrency || old.defaultCurrency || "USD")).join("")}</select></label><label class="field">默认跟进人<input name="defaultOwner" value="${E(settings.defaultOwner || old.defaultOwner || "")}"><span class="muted tiny" data-settings-hint="defaultOwner">新建客户、线索、商机、订单时默认填这个人。只能看本人或本部门客户的账号，会默认填自己。</span></label></div>${companySection()}<div class="error" id="biz-settings-error" role="alert"></div><div class="settings-actions">${button("discard-settings", "取消修改")}<button class="primary" type="submit">保存设置</button></div></form>${orderFieldsSection()}<section class="business-section theme-section"><div class="section-head"><h3>界面配色</h3><span class="muted tiny">选择后整个来财立即换色，配色跟着数据一起保存；科技蓝是深蓝配钴蓝</span></div><div class="theme-options" role="group" aria-label="界面配色">${THEME_CHOICES.map(([id, name]) => `<button type="button" class="theme-option${currentTheme === id ? " selected" : ""}" data-biz-action="set-theme" data-theme-id="${id}" aria-pressed="${currentTheme === id}"><span class="theme-preview" data-preview="${id}" aria-hidden="true"><i class="pv-nav"></i><span class="pv-body"><i class="pv-bar"></i><span class="pv-cards"><i></i><i class="pv-tint"></i></span></span></span><span class="theme-line"><strong>${name}</strong><span class="theme-state muted tiny">${currentTheme === id ? "使用中" : "点击切换"}</span></span></button>`).join("")}</div><p class="settings-copy">换色只改界面主色、底色和强调色。成功、警告、逾期等状态色保持不变，邮件正文里的颜色也不受影响。</p></section><section class="business-section"><div class="section-head"><h3>本地数据</h3><span class="tag green">来财独立存储</span></div><p class="settings-copy">客户、订单、日程都保存在来财里，可以随时备份。</p><div class="settings-actions">${button("backup", "立即备份")}</div><div id="biz-backup-status" class="muted tiny" role="status"></div></section></div>`
      );
    }
    // ---------- 企业管理：角色权限、成员管理（页面标记在 role-ui.js，数据规则在 role-model.js） ----------
    let roleUI = null;
    // 字段清单来自 LaiRoleFields，产品布局清单来自 LaiProductModel。
    const RU = () => roleUI || (roleUI = root.LaiRoleUI.create(E, RM(), { fields: root.LaiRoleFields, layouts: (s) => root.LaiProductModel?.layoutList?.(s) || [] }));
    // draft：编辑角色时在窗口里选的字段权限和布局，点“保存”才写进角色；取消就丢掉。dept：成员管理左边选中的部门（""＝我的企业）。
    const roleView = { edit: "", armed: "", armedMember: "", armedDept: "", filter: "", nextFilter: "", dept: "", draft: null };
    const cloneJSON = (value) => JSON.parse(JSON.stringify(value || {}));
    function roleDraft(id) {
      if (roleView.draft?.id !== id) {
        const role = RM().settings(state()).roles.find((r) => r.id === id);
        roleView.draft = { id, fields: cloneJSON(role?.fields), layouts: cloneJSON(role?.layouts) };
      }
      return roleView.draft;
    }
    const pickedDept = () => (RM().deptTree(state()).some((d) => d.id === roleView.dept) ? roleView.dept : "");
    const onRolePage = () => route === "roles" || route === "members";
    // 换页面时回到列表；从“角色权限”点“成员”过来时带上要看的角色。
    function roleReset(next) {
      roleView.filter = next === "members" ? roleView.nextFilter : "";
      roleView.nextFilter = "";
      roleView.edit = "";
      roleView.draft = null;
      roleView.armed = "";
      roleView.armedMember = "";
      roleView.armedDept = "";
      roleView.dept = "";
    }
    function renderRoles() {
      const title = roleView.edit ? (RM().settings(state()).roles.find((r) => r.id === roleView.edit)?.locked ? "查看角色" : "编辑角色") : "角色权限";
      const description = roleView.edit ? "勾选这个角色能做的事" : "设置每个角色能看什么、能做什么";
      if (!RM().can(state(), "settings.roles")) return header("角色权限", description) + RU().deniedMarkup();
      if (roleView.edit) return header(title, description) + RU().editMarkup(state(), roleView.edit, roleDraft(roleView.edit));
      return header(title, description, '<button type="button" class="primary" data-role-action="add">新增角色</button>') + RU().rolesMarkup(state(), { armed: roleView.armed });
    }
    function renderMembers() {
      const description = "测试账号：切换后看到的就是这个角色能看的内容";
      if (!RM().can(state(), "settings.roles")) return header("成员管理", description) + RU().deniedMarkup();
      return header("成员管理", description, '<button type="button" class="primary" data-role-action="member-add">添加成员</button>') + RU().membersMarkup(state(), { armed: roleView.armedMember, filter: roleView.filter, dept: roleView.dept, armedDept: roleView.armedDept });
    }
    function roleClick(d) {
      const action = d.roleAction;
      if (action !== "delete") roleView.armed = "";
      if (action !== "member-delete") roleView.armedMember = "";
      if (action !== "dept-delete") roleView.armedDept = "";
      const cancel = '<button type="button" data-action="close-modal">取消</button>';
      if (action === "add") return ctx.dialog("新增角色", RU().addRoleMarkup(state()), cancel + '<button class="primary" type="submit" form="role-add-form">新增</button>', "role-add");
      if (action === "member-add") return ctx.dialog("添加成员", RU().addMemberMarkup(state(), { deptId: pickedDept() }), cancel + '<button class="primary" type="submit" form="member-add-form">添加</button>', "member-add");
      if (action === "rename") {
        const member = RM().settings(state()).members.find((m) => m.id === d.id);
        if (!member) return ctx.toast("没有找到这位成员，请刷新后重试");
        return ctx.dialog("改名", RU().renameMarkup(member), cancel + '<button class="primary" type="submit" form="member-rename-form">保存</button>', "member-rename");
      }
      if (action === "edit") {
        roleView.edit = d.id;
        roleView.draft = null;
        return render();
      }
      if (action === "back") {
        roleView.edit = "";
        roleView.draft = null;
        return render();
      }
      if (action === "fields" || action === "layouts") return roleFieldsDialog(action, d.module, cancel);
      if (action === "fields-all") {
        document.querySelectorAll("#role-fields-form [data-field-row]").forEach((row) => {
          const box = row.querySelector(`input[type="radio"][value="${d.level}"]`);
          if (box) box.checked = true;
        });
        return;
      }
      if (action === "dept-pick") {
        roleView.dept = d.id || "";
        return render();
      }
      if (action === "dept-add") return ctx.dialog("新建部门", RU().deptAddMarkup(state(), pickedDept()), cancel + '<button class="primary" type="submit" form="dept-add-form">新建</button>', "dept-add");
      if (action === "dept-rename") {
        const dept = RM().deptTree(state()).find((x) => x.id === d.id);
        if (!dept) return ctx.toast("没有找到这个部门，请刷新后重试");
        return ctx.dialog("部门改名", RU().deptRenameMarkup(dept), cancel + '<button class="primary" type="submit" form="dept-rename-form">保存</button>', "dept-rename");
      }
      if (action === "dept-delete") {
        if (roleView.armedDept !== d.id) {
          roleView.armedDept = d.id;
          return render();
        }
        roleView.armedDept = "";
        return saveNext(() => RM().deleteDepartment(state(), d.id), "member-list-error", () => {
          roleView.dept = "";
        });
      }
      if (action === "members") {
        roleView.nextFilter = d.id;
        return ctx.navigate("members");
      }
      if (action === "members-all") {
        roleView.filter = "";
        return render();
      }
      if (action === "delete") {
        if (roleView.armed !== d.id) {
          roleView.armed = d.id;
          return render();
        }
        roleView.armed = "";
        return saveNext(() => RM().deleteRole(state(), d.id), "role-list-error", () => undefined);
      }
      if (action === "member-delete") {
        if (roleView.armedMember !== d.id) {
          roleView.armedMember = d.id;
          return render();
        }
        roleView.armedMember = "";
        return saveNext(() => RM().removeMember(state(), d.id), "member-list-error", () => undefined);
      }
      if (action === "switch") {
        // 切换后整个界面按新账号重画（菜单里没权限的入口会收起来）；和头像菜单走同一条路。
        roleView.edit = "";
        if (ctx.switchAccount) return ctx.switchAccount(d.id);
        return saveNext(() => RM().switchTo(state(), d.id), "member-list-error", () => undefined);
      }
    }
    // 设置字段权限／布局权限的窗口：只改编辑页里的草稿，点角色的“保存”才真正存下来。
    function roleFieldsDialog(action, module, cancel) {
      const role = RM().settings(state()).roles.find((r) => r.id === roleView.edit);
      if (!role) return;
      const readOnly = !!role.locked,
        draft = roleDraft(role.id),
        close = '<button type="button" data-action="close-modal">关闭</button>';
      if (action === "layouts") {
        const body = RU().layoutMarkup(state(), draft.layouts.product || {}, { readOnly });
        return ctx.dialog("设置布局权限", body, readOnly ? close : cancel + '<button class="primary" type="submit" form="role-layout-form">确定</button>', "role-layouts");
      }
      const name = (RM().FIELD_MODULES.find(([id]) => id === module) || [])[1] || "";
      const has = (root.LaiRoleFields?.list?.(state(), module) || []).length > 0;
      ctx.dialog(`${name}字段权限`, RU().fieldsMarkup(state(), module, draft.fields[module] || {}, { readOnly }), readOnly || !has ? close : cancel + '<button class="primary" type="submit" form="role-fields-form">确定</button>', "role-fields");
    }
    function showLimitTags() {
      const draft = roleView.draft;
      if (!draft) return;
      document.querySelectorAll("[data-role-limit]").forEach((el) => {
        const count = RU().limitCount(state(), el.dataset.roleLimit, draft.fields);
        el.textContent = RU().limitText(count);
        el.hidden = !count;
      });
      const tag = document.querySelector("[data-role-layout-tag]");
      if (tag) tag.hidden = !RU().layoutSet(draft.layouts);
    }
    function roleSubmit(form) {
      const kind = form.dataset.roleForm;
      const data = Object.fromEntries(new FormData(form));
      if (kind === "add") {
        const before = new Set(RM().settings(state()).roles.map((r) => r.id));
        return saveNext(() => RM().addRole(state(), { name: data.name, copyFrom: data.copyFrom }), "role-add-error", () => {
          ctx.closeDialog();
          // 建好后直接打开新角色的编辑页。
          roleView.edit = RM().settings(state()).roles.find((r) => !before.has(r.id))?.id || "";
          roleView.draft = null;
        });
      }
      if (kind === "edit") {
        const perms = {};
        form.querySelectorAll('input[name="perm"]:checked').forEach((box) => (perms[box.value] = true));
        const draft = roleDraft(form.dataset.id);
        return saveNext(() => RM().updateRole(state(), form.dataset.id, { name: data.name, scope: data.scope, perms, fields: draft.fields, layouts: draft.layouts }), "role-error", () => {
          roleView.edit = "";
          roleView.draft = null;
        });
      }
      if (kind === "fields") {
        const module = form.dataset.module,
          draft = roleDraft(roleView.edit),
          rows = [...form.querySelectorAll("[data-field-row]")];
        if (rows.length) {
          const listed = new Set(rows.map((row) => row.dataset.fieldKey)),
            // 清单里已经没有的字段，原来的限制照样留着。
            rules = Object.fromEntries(Object.entries(draft.fields[module] || {}).filter(([key]) => !listed.has(key)));
          for (const row of rows) {
            const level = row.querySelector('input[type="radio"]:checked')?.value;
            if (level === "read" || level === "hidden") rules[row.dataset.fieldKey] = level;
          }
          if (Object.keys(rules).length) draft.fields[module] = rules;
          else delete draft.fields[module];
        }
        ctx.closeDialog();
        return showLimitTags();
      }
      if (kind === "layouts") {
        const draft = roleDraft(roleView.edit),
          pick = { form: data.form || "", detail: data.detail || "" };
        try {
          const PM = root.LaiProductModel;
          if (PM?.checkRoleLayout) for (const place of ["form", "detail"]) PM.checkRoleLayout(state(), place, pick[place]);
        } catch (error) {
          const box = document.getElementById("role-layout-error");
          if (box) box.textContent = error.message;
          return true;
        }
        draft.layouts = pick.form || pick.detail ? { product: pick } : {};
        ctx.closeDialog();
        return showLimitTags();
      }
      if (kind === "dept-add") return saveNext(() => RM().addDepartment(state(), { name: data.name, parentId: data.parentId }), "dept-add-error", () => ctx.closeDialog());
      if (kind === "dept-rename") return saveNext(() => RM().renameDepartment(state(), form.dataset.id, data.name), "dept-rename-error", () => ctx.closeDialog());
      if (kind === "member-add") return saveNext(() => RM().addMember(state(), { name: data.name, roleId: data.roleId, deptId: data.deptId }), "member-add-error", () => ctx.closeDialog());
      if (kind === "member-rename") return saveNext(() => RM().renameMember(state(), form.dataset.id, data.name), "member-rename-error", () => ctx.closeDialog());
    }
    // 编辑角色里的勾选：“全选”带动整组；整组都勾上时“全选”自己也勾上。成员表里换角色马上保存。
    function roleChange(e) {
      const target = e.target;
      if (target.dataset?.roleAll !== undefined) {
        target.closest("[data-role-group]")?.querySelectorAll("[data-role-perm]").forEach((box) => (box.checked = target.checked));
        return true;
      }
      if (target.dataset?.rolePerm !== undefined) {
        const group = target.closest("[data-role-group]");
        const all = group?.querySelector("[data-role-all]");
        if (all) all.checked = [...group.querySelectorAll("[data-role-perm]")].every((box) => box.checked);
        return true;
      }
      if (target.id === "role-scope") {
        const hint = document.getElementById("role-scope-hint");
        if (hint) hint.textContent = RU().scopeHint(target.value);
        return true;
      }
      if (target.dataset?.roleMemberDept !== undefined) {
        const id = target.dataset.id;
        const previous = RM().settings(state()).members.find((m) => m.id === id)?.deptId || "";
        saveNext(() => RM().setMemberDept(state(), id, target.value), "member-list-error", () => undefined).then((saved) => {
          if (!saved) target.value = previous;
        });
        return true;
      }
      if (target.dataset?.roleMemberRole !== undefined) {
        const id = target.dataset.id;
        const previous = RM().settings(state()).members.find((m) => m.id === id)?.roleId;
        saveNext(() => RM().setMemberRole(state(), id, target.value), "member-list-error", () => undefined).then((saved) => {
          if (!saved && previous) target.value = previous;
        });
        return true;
      }
      return false;
    }
    // 自带的页面。登记处（LaiExtraPages）里的页面不能盖掉它们。
    const builtinViews = () => ({
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
      "opp-flows": renderOppFlows,
      leads: renderLeads,
      "lead-trash": renderLeadTrash,
      products: renderProducts,
      "doc-templates": renderDocTemplates,
      roles: renderRoles,
      members: renderMembers,
      calendar: renderCalendar,
      settings: renderSettings,
      "settings-hub": renderSettingsHub,
    });
    function render(preserveOrderScroll = false) {
      const previous = preserveOrderScroll && route === "order-list"
        ? document.getElementById("biz-order-scroll") : null;
      const scroll = previous
        ? { top: previous.scrollTop, left: previous.scrollLeft } : null;
      // 商机看板：保存／拖动后页面和看板的滚动位置不回到开头。
      const oppScroll = preserveOrderScroll && route === "opportunities"
        ? { page: document.querySelector?.(".opp-page"), board: document.querySelector?.(".opp-board") } : null;
      const oppPosition = oppScroll?.page ? { top: oppScroll.page.scrollTop, left: oppScroll.board?.scrollLeft || 0 } : null;
      settingsDirty = false;
      const views = builtinViews();
      const denied = routeDenied(route);
      const extraPage = !denied && !views[route] ? extra() : null;
      let html = denied;
      if (!html) html = extraPage && typeof extraPage.render === "function" ? extraPage.render(extraCtx()) : (views[route] || renderDashboard)();
      if (typeof html === "string") ctx.mount(html);
      if (extraPage && typeof extraPage.afterRender === "function") extraPage.afterRender(extraCtx());
      if (route === "dashboard") loadWorkbenchMail();
      if (oppPosition) {
        const page = document.querySelector?.(".opp-page"), board = document.querySelector?.(".opp-board");
        if (page) page.scrollTop = oppPosition.top;
        if (board) board.scrollLeft = oppPosition.left;
      }
      if (scroll) {
        const current = document.getElementById("biz-order-scroll");
        if (current) {
          current.scrollTop = scroll.top;
          current.scrollLeft = scroll.left;
        }
      }
    }
    function orderEditor(id, unsaved, returnCustomer = "", fromOpportunity = "") {
      const old = allOrders().find((o) => o.id === id);
      if (id !== undefined && !old) {
        ctx.toast("订单不存在，可能已移入回收站，请刷新列表后重试");
        return;
      }
      // 新建要有“创建”权限；打开别人的订单不行；只能看不能改的，表单只读。
      if (old ? notYours(old) : !need("order.create")) return;
      const locked = !!old && !can("order.edit");
      const today = B.localDate();
      draft = { id: id || crypto.randomUUID(), isNew: !old, returnCustomer, locked };
      if (fromOpportunity) draft.fromOpportunity = fromOpportunity;
      const o = unsaved ||
        old || {
          createdAt: today,
          num: suggestedOrderNumber(),
          currency: orderDefault("defaultCurrency") || "USD",
          owner: defaultOrderOwner(),
          stage: "quote",
          amount: "",
          client: returnCustomer,
          paidAmount: 0,
        };
      draft.items = B.linkItems((Array.isArray(o.items) ? o.items : []).map((item) => ({ ...item })), orderProducts());
      draft.doc = "";
      // 有产品明细时，订单金额和“产品”跟着明细走，不能手填。
      const shown = draft.items.length ? { ...o, amount: B.itemsTotal(draft.items), productType: B.itemsSummary(draft.items) } : o;
      // 自定义字段（设置 → 订单字段）：能改时每种类型一个输入；只能看时只列有值的和必填的。
      const orderCustomMarkup = (order, readOnly, isNew) => {
        const UI = root.LaiOrderFieldsUI, OF = root.LaiOrderFields;
        if (!UI || !OF) return "";
        return readOnly ? UI.detailMarkup(E, OF.customView(state(), order)) : UI.formMarkup(E, { defs: OF.customFields(state()), values: order.custom, isNew });
      };
      const field = (name, title, type = "text", wide = false) =>
        `<label class="field ${wide ? "wide" : ""}">${title}${["num", "client", "amount", "createdAt"].includes(name) ? REQ : ""}<input name="${name}" type="${type}" value="${E(type === "date" ? localDay(shown[name]) : (shown[name] ?? ""))}" ${["num", "client", "amount", "createdAt"].includes(name) ? 'aria-required="true" required' : ""} ${["amount", "paidAmount"].includes(name) ? 'min="0" step="any"' : ""} ${name === "client" ? 'list="biz-customer-names"' : ""}${draft.items.length && ["amount", "productType"].includes(name) ? " readonly" : ""}></label>`;
      ctx.dialog(
        old ? (locked ? "订单详情" : "编辑订单") : "新建订单",
        `<form class="drawer-body" id="biz-order-form" novalidate data-form-check>${draft.fromOpportunity ? OU().sourceBannerMarkup(oppCard(draft.fromOpportunity)) : ""}<div class="form-section">订单信息</div><div class="form-grid">${field("num", "订单编号")}${field("client", "客户名称")}${field("country", "国家地区")}${field("productType", "产品")}${field("amount", "订单金额", "number")}<label class="field">币种<select name="currency">${[...new Set([o.currency || "USD", "USD", "EUR", "GBP", "CNY", "CAD", "AUD"])].map((c) => option(c, c, o.currency || "USD")).join("")}</select></label>${field("paidAmount", "已收款", "number")}<label class="field">订单阶段<select name="stage">${B.stages.map((s) => option(s.id, s.label, o.stage)).join("")}</select></label>${field("createdAt", "创建日期", "date")}${field("owner", "跟进人")}${field("trackingNumber", "物流单号")}${field("carrier", "承运商")}<label class="field wide">订单备注<textarea name="note" rows="3">${E(o.note || "")}</textarea></label>${field("next", "下一步", "text", true)}<label class="business-check"><input type="checkbox" name="isDraft" ${o.isDraft ? "checked" : ""}> 保存为草稿</label></div>${orderCustomMarkup(o, locked, !old)}<div class="form-section">产品明细</div><div id="biz-order-items">${orderItemsMarkup(o.currency || "USD")}</div>${can("doc.create") ? `<div class="order-doc-actions"><span class="muted tiny">生成单据</span>${(DM() ? DM().TYPES : []).map(([type, name]) => button("order-doc", E(name), `data-type="${E(type)}"`)).join("")}</div>` : ""}<div id="biz-order-saved">${orderSavedMarkup()}</div><div id="biz-order-doc"></div><datalist id="biz-customer-names">${Object.keys(
          pickState().customers || {},
        )
          .filter(
            (n) => root.LaiModules.bucket(pickState().customers[n]) !== "trash",
          )
          .map((n) => `<option value="${E(n)}">`)
          .join(
            "",
          )}</datalist>${old ? `<p class="muted tiny">已有历史与附件资料会保留。已发货 / 已完成按订单全额计已收款。</p>` : ""}</form>`,
        `${footError("biz-order-error")}${old && can("order.delete") ? button("archive-order", "移入回收站", `data-id="${E(old.id)}"`) : ""}${button("close-editor", locked ? "关闭" : "取消")}${locked ? "" : '<button class="primary" type="submit" form="biz-order-form">保存订单</button>'}`,
        "business-order",
      );
      if (locked) document.querySelectorAll?.("#biz-order-form input,#biz-order-form select,#biz-order-form textarea").forEach((el) => (el.disabled = true));
    }
    // ---------- 订单产品明细（从产品库选）和由订单生成单据 ----------
    function orderItemsMarkup(currency) {
      const products = orderProducts();
      const items = draft?.items || [];
      if (!products.length && !items.length)
        return !can("product.view") ? "" :  '<p class="muted tiny order-items-empty">还没有产品。先到 交易 → 产品 添加产品，就能在这里选；也可以直接在上面“产品”里写文字。</p>';
      const rows = items
        .map((item, i) => {
          const known = products.some((p) => p.id === item.productId);
          const choices = `<option value="">请选择产品</option>${!known && item.name ? `<option value="__keep" selected>${E(item.name)}</option>` : ""}${products
            .map((p) => `<option value="${E(p.id)}" ${p.id === item.productId ? "selected" : ""}>${E(p.name)}${p.code ? " · " + E(p.code) : ""}</option>`)
            .join("")}`;
          const unit = item.unit ? `（${E(item.unit)}）` : "";
          return `<div class="order-item" data-item-row="${i}"><div class="order-item-top"><select data-item-product="${i}" aria-label="第 ${i + 1} 行产品">${choices}</select>${draft?.locked ? "" : button("order-item-remove", "删除", `data-index="${i}" class="text-button"`)}</div><div class="order-item-nums"><label>数量${unit}<input data-item-field="qty" data-item-index="${i}" type="number" min="0" step="any" value="${E(item.qty ?? "")}"></label><label>单价<input data-item-field="price" data-item-index="${i}" type="number" min="0" step="any" value="${E(item.price ?? "")}"></label><span class="order-item-amount" data-item-amount="${i}">${money(Number(item.qty || 0) * Number(item.price || 0), currency)}</span></div></div>`;
        })
        .join("");
      const table = items.length
        ? `<div class="order-items">${rows}</div><p class="order-items-total">合计 <strong data-items-total>${money(B.itemsTotal(items), currency)}</strong></p>`
        : '<p class="muted tiny">选了产品后，订单金额按明细自动合计。</p>';
      return `${table}${products.length && !draft?.locked ? button("order-item-add", "＋ 添加产品") : ""}`;
    }
    const orderForm = () => document.getElementById("biz-order-form");
    function renderOrderItems() {
      const box = document.getElementById("biz-order-items");
      if (box) box.innerHTML = orderItemsMarkup(orderForm()?.elements.currency?.value || "USD");
      syncOrderAmount();
    }
    // 明细改了：订单金额、“产品”、每行金额、合计跟着变；没有明细时恢复手填。
    function syncOrderAmount() {
      const form = orderForm();
      if (!form || !draft?.items) return;
      const currency = form.elements.currency?.value || "USD",
        has = draft.items.length > 0,
        plain = (value) => money(value, currency).replace(/&amp;/g, "&");
      for (const name of ["amount", "productType"]) form.elements[name].readOnly = has;
      if (has) {
        form.elements.amount.value = B.itemsTotal(draft.items);
        form.elements.productType.value = B.itemsSummary(draft.items);
      }
      draft.items.forEach((item, i) => {
        const cell = form.querySelector(`[data-item-amount="${i}"]`);
        if (cell) cell.textContent = plain(Number(item.qty || 0) * Number(item.price || 0));
      });
      const total = form.querySelector("[data-items-total]");
      if (total) total.textContent = plain(B.itemsTotal(draft.items));
      if (draft.doc) showOrderDoc(draft.doc);
    }
    // 订单表单里现在填的内容，整理成生成单据要用的样子（单据编号要等保存单据时才有，订单号只作参考）。
    function orderDocInput() {
      const form = orderForm();
      const f = form ? Object.fromEntries(new FormData(form)) : {};
      return {
        lines: B.docLines({ items: draft?.items || [], productType: f.productType, amount: f.amount }),
        currency: f.currency || "USD",
        client: f.client || "",
        date: localDay(f.createdAt),
        reference: { label: "订单号", value: f.num || "" },
        source: { kind: "order", id: draft?.id || "", label: f.num || "" },
      };
    }
    function orderDocData(type) {
      return DM().preview(state(), type, { ...orderDocInput(), number: "", numberNote: "保存后生成编号" });
    }
    const orderSavedMarkup = () => (draft?.id && DM() ? DU().savedListMarkup(DM().docsFor(state(), { kind: "order", id: draft.id })) : "");
    function showOrderDoc(type) {
      const box = document.getElementById("biz-order-doc");
      if (!box || !DM()) return;
      draft.doc = type;
      draft.docView = "";
      const doc = orderDocData(type);
      box.innerHTML = `<div class="order-doc-preview" data-order-doc="${E(type)}"><div class="dt-side-head"><strong>${E(doc.typeName)}预览</strong><span class="order-doc-buttons">${button("order-doc-save", "保存单据", `data-type="${E(type)}"`, true)}${button("order-doc-print", "打印 / 存为 PDF", `data-type="${E(type)}"`)}${button("order-doc-close", "收起")}</span></div><div class="error" id="biz-order-doc-error" role="alert"></div><div class="dt-paper">${DU().documentMarkup(doc)}</div><p class="muted tiny">用的是这张表里现在填的内容。订单保存过之后，点“保存单据”才会生成单据编号并记下来；公司信息、银行和条款在 交易 → 单据模板 里改。</p></div>`;
    }
    // 保存过的单据显示在订单表单下面（用保存时的内容，订单后来改了也不变）。
    function showOrderSaved(id) {
      const box = document.getElementById("biz-order-doc"), doc = DM().getDocument(state(), id);
      if (!box || !doc || !draft) return;
      docVoidArmed = "";
      draft.doc = "";
      draft.docView = id;
      box.innerHTML = `<div class="order-doc-preview" data-order-doc-saved="${E(id)}"><div class="dt-side-head"><strong>${E(doc.snapshot.typeName)} ${E(doc.number)}</strong><span class="order-doc-buttons">${docVoidButton(doc)}${doc.status === "已作废" ? "" : button("docrec-print", "打印 / 存为 PDF", `data-id="${E(id)}"`, true)}${button("order-doc-close", "收起")}</span></div>${DU().paperMarkup(doc)}</div>`;
    }
    function saveOrderDoc(type) {
      // 单据的来源是这笔订单：订单还没保存时，来源记不上，所以要先保存订单。
      if (!draft || !allOrders().some((order) => order.id === draft.id)) return ctx.toast("请先保存订单");
      // 先取表单里的内容：保存时整个页面的输入框会暂时停用，那时读不到。
      const input = orderDocInput();
      let saved = null;
      return saveNext(
        () => {
          const result = DM().saveDocument(state(), { ...input, type, today: docToday() });
          saved = result.doc;
          return result.state;
        },
        "biz-order-doc-error",
        () => {
          showOrderSaved(saved.id);
          const list = document.getElementById("biz-order-saved");
          if (list) list.innerHTML = orderSavedMarkup();
          return false;
        },
      );
    }
    // ---------- 由商机生成报价单、形式发票 ----------
    let oppDoc = null;
    function oppDocInput() {
      const detail = OM().detailOf(state(), oppDoc.id, docToday());
      if (!detail) return null;
      return {
        type: oppDoc.type,
        // 看不到“关联产品”的账号：单据里不列商机里的产品，只用商机本身一行。
        lines: DM().linesFromOpportunity(state(), detail, { hideProducts: oppHidden().includes("products") }),
        currency: detail.currency,
        client: detail.client,
        date: docToday(),
        reference: { label: "商机", value: detail.name },
        source: { kind: "opportunity", id: detail.id, label: detail.name },
      };
    }
    const oppDocPreview = (input) => DM().preview(state(), oppDoc.type, { ...input, number: "", numberNote: "保存后生成编号" });
    function oppDocMarkup() {
      const saved = oppDoc.saved && DM().getDocument(state(), oppDoc.saved);
      if (saved) {
        return `<div class="dt-side-head"><strong>${E(saved.snapshot.typeName)} ${E(saved.number)}</strong><span class="order-doc-buttons">${button("oppdoc-print", "打印 / 存为 PDF", "", true)}</span></div>${DU().paperMarkup(saved)}<p class="muted tiny">已保存。以后可以在 交易 → 单据模板 → 单据记录 里找到它，也能在这个商机的详情里看到。</p>`;
      }
      const input = oppDocInput();
      if (!input) return '<p class="muted">商机不存在，可能已被删除。</p>';
      const doc = oppDocPreview(input);
      return `<div class="dt-side-head"><strong>${E(doc.typeName)}预览</strong><span class="order-doc-buttons">${button("oppdoc-save", "保存单据", "", true)}${button("oppdoc-print", "打印 / 存为 PDF")}</span></div><div class="error" id="opp-doc-error" role="alert"></div><div class="dt-paper">${DU().documentMarkup(doc)}</div><p class="muted tiny">用的是这个商机的客户、币种和关联产品（没有关联产品就用商机金额）。点“保存单据”才会生成单据编号并记下来。</p>`;
    }
    function showOppDoc(id, type) {
      if (!need("doc.create") || oppBlocked(id)) return;
      if (!DM() || !DM().TYPES.some(([t]) => t === type)) return;
      oppDoc = { id, type, saved: "" };
      if (!oppDocInput()) return ctx.toast("商机不存在，可能已被删除，请刷新后重试");
      ctx.dialog(E(`生成${DU().typeLabel(type)}`), `<div class="drawer-body opp-doc" id="opp-doc-box">${oppDocMarkup()}</div>`, '<button type="button" data-action="close-modal">关闭</button>', "opp-doc");
    }
    function oppDocAction(action) {
      if (!oppDoc) return;
      if (action === "oppdoc-print") {
        const saved = oppDoc.saved && DM().getDocument(state(), oppDoc.saved);
        const input = saved ? null : oppDocInput();
        if (!saved && !input) return;
        return printDocument(saved ? saved.snapshot : oppDocPreview(input));
      }
      if (action === "oppdoc-save") {
        if (!need("doc.create")) return;
        let result = null;
        return saveNext(
          () => {
            const input = oppDocInput();
            if (!input) throw new Error("商机不存在，可能已被删除");
            result = DM().saveDocument(state(), { ...input, today: docToday() });
            return result.state;
          },
          "opp-doc-error",
          () => {
            oppDoc.saved = result.doc.id;
            const box = document.getElementById("opp-doc-box");
            if (box) box.innerHTML = oppDocMarkup();
            return false;
          },
        );
      }
    }
    function orderItemAction(action, d) {
      if (!draft?.items) return;
      if (draft.locked && action.startsWith("order-item-")) return;
      if ((action === "order-doc" || action === "order-doc-save") && !need("doc.create")) return;
      if (action === "order-item-add") {
        draft.items.push({ productId: "", code: "", name: "", model: "", unit: "", qty: 1, price: 0 });
        renderOrderItems();
        const selects = document.querySelectorAll("#biz-order-items [data-item-product]");
        selects[selects.length - 1]?.focus();
        return;
      }
      if (action === "order-item-remove") {
        draft.items.splice(Number(d.index), 1);
        return renderOrderItems();
      }
      if (action === "order-doc") {
        showOrderDoc(d.type);
        return document.querySelector("#biz-order-doc .order-doc-preview")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      if (action === "order-doc-save") return saveOrderDoc(d.type);
      if (action === "order-doc-close") {
        draft.doc = "";
        draft.docView = "";
        const box = document.getElementById("biz-order-doc");
        if (box) box.innerHTML = "";
        return;
      }
      if (action === "order-doc-print") return printDocument(orderDocData(d.type));
    }
    // 可以指定的负责人：有“重新分配”权限的账号，从自己看得到的成员里选；其他账号只看到自己的名字，不能改。
    const taskCanReassign = () => !RM() || can("customer.reassign");
    function taskMembers() {
      if (!RM()) return [];
      return RM().settings(state()).members.map((m) => m.name).filter((name) => sees(name));
    }
    function taskOwnerField(old) {
      if (!RM()) return "";
      const current = old ? B.taskOwner(state(), old) : RM().meName(state());
      if (!taskCanReassign()) return `<label class="field">负责人<input value="${E(current || "未分配")}" disabled></label>`;
      const names = taskMembers();
      if (current && !names.some((name) => name.toLowerCase() === current.toLowerCase())) names.unshift(current);
      const blank = current ? "" : '<option value="">未分配（按客户负责人）</option>';
      return `<label class="field">负责人<select name="owner">${blank}${names.map((name) => option(name, name, current)).join("")}</select></label>`;
    }
    function taskEditor(id) {
      const old = (state().laiTasks || []).find((t) => t.id === id);
      if (id !== undefined && !old) {
        ctx.toast("待办不存在，请刷新列表后重试");
        return;
      }
      if (old && RM() && !sees(B.taskOwner(state(), old))) {
        ctx.toast("这条待办不归你负责");
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
        `<form id="biz-task-form" class="drawer-body" novalidate data-form-check><div class="form-grid"><label class="field wide">任务名称${REQ}<input name="title" value="${E(t.title)}" aria-required="true" required maxlength="200"></label><label class="field">日期${REQ}<input type="date" name="date" value="${E(t.date)}" aria-required="true" required></label>${taskOwnerField(old)}<label class="business-check"><input type="checkbox" name="done" ${t.done ? "checked" : ""}> 已完成</label></div></form>`,
        `${footError("biz-task-error")}${button("close-editor", "取消")}<button class="primary" type="submit" form="biz-task-form">保存任务</button>`,
        "business-task",
      );
    }
    // errorId：错误框的 id，或错误框本身（单据设置里每张表单各有一个）。
    async function saveNext(makeNext, errorId, after) {
      const controls = [
          ...document.querySelectorAll("button,input,select,textarea"),
        ],
        disabled = controls.map((e) => e.disabled);
      controls.forEach((e) => (e.disabled = true));
      let failed = null, target = null;
      try {
        await ctx.save(makeNext());
        if (after?.() !== false) render(true);
        ctx.toast("已保存到来财");
        return true;
      } catch (error) {
        failed = error;
        target = typeof errorId === "string" ? document.getElementById(errorId) : errorId;
        if (target) {
          target.textContent = error.message;
          target.classList.add("visible");
        } else ctx.toast(error.message);
        return false;
      } finally {
        controls.forEach((e, i) => (e.disabled = disabled[i]));
        if (failed && target) pointAtError(target, failed);
      }
    }
    // 保存失败后：光标落到出错的框（找不到就落在保存按钮上），不留在页面空白处；错误框滚到看得见的地方。
    function pointAtError(target, error) {
      const FC = root.LaiFormCheck;
      const drawer = target.closest?.(".drawer");
      const form = target.closest?.("form") || drawer?.querySelector("form");
      const row = /^items\.(\d+)$/.exec(String(error?.field || ""));
      const field = row ? form?.querySelector(`[data-item-product="${row[1]}"]`) : FC?.fieldFor(form, error);
      if (field && FC?.focusField(field)) return FC.mark(field);
      FC?.reveal(target);
      const submit = (form?.id && document.querySelector(`[type="submit"][form="${form.id}"]`)) || form?.querySelector('[type="submit"]') || drawer?.querySelector(".drawer-footer .primary");
      submit?.focus({ preventScroll: true });
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
            items: draft?.items || [],
          }
        : null;
      ctx.dialog(
        "移入订单回收站",
        `<div class="drawer-body"><p>归档 ${E(allOrders().find((o) => o.id === id)?.num || "此订单")}？</p><div class="module-note">订单和客户资料保留，可从订单回收站恢复。</div><div id="biz-order-error" class="error" role="alert"></div></div>`,
        `${button("cancel-archive", "返回编辑", `data-id="${E(id)}"`)}${button("confirm-archive", "确认归档", `data-id="${E(id)}"`, true)}`,
        "business-order",
      );
    }
    // 立即备份。网页试用版的后端会回 501（浏览器里没有可写的文件夹），这时直接说明试用版不能备份。
    async function localAction() {
      if (!need("settings.general")) return;
      const target = document.getElementById("biz-backup-status");
      if (target) target.textContent = "正在备份…";
      try {
        const response = await fetch("/api/manual-backup", { method: "POST" });
        if (response.status === 501) throw Error("试用版不能备份。想留一份，请到设置中心的“测试数据”里备份。");
        const result = await response.json();
        if (!response.ok || result.ok === false) throw Error(result.message || "");
        if (target) target.textContent = "备份已保存到来财数据目录。";
        ctx.toast("备份完成");
      } catch (e) {
        // 不把原始的英文错误给用户看：中文提示照用，其余换成一句说明。
        const message = /[\u4e00-\u9fff]/.test(String(e?.message || "")) ? e.message : "备份没有成功，数据没有受影响。请稍后再试。";
        if (target) target.textContent = message;
        ctx.toast(message);
      }
    }
    // 导出：行来自页面上已经按账号范围筛好的列表（scoped()）；商机、线索的列走字段权限（自定义字段的权限键是 custom.<id>）。
    function openExport(kind) {
      if (!need(`${kind}.export`)) return;
      const full = scoped(),
        today = B.localDate(),
        byIds = (items, shown) => {
          const ids = new Set(shown.map((row) => row.id));
          return items.filter((item) => ids.has(item.id));
        },
        fieldGate = (module) => ({ columnVisible: (id) => !RM() || RM().fieldVisible(state(), module, String(id).replace(/^custom:/, "custom.")) });
      const setup = { order: () => ({ filtered: filteredOrders(), all: activeOrders() }),
        opp: () => ({
          filtered: byIds(full.laiOpportunities || [], OM().board(full, { ...oppView.filters, hidden: oppHidden() }, today).cards),
          all: full.laiOpportunities || [],
        }),
        lead: () => ({
          filtered: byIds(full.laiLeads || [], LD().page(full, leadView.filters, today, leadHidden()).rows),
          all: (full.laiLeads || []).filter((lead) => lead && !lead.trashed),
        }) }[kind];
      if (!setup) return;
      root.LaiExportUI?.open(kind, { state: full, can, toast: ctx.toast, dialog: ctx.dialog, closeDialog: ctx.closeDialog, denied: RM()?.denied,
        scopes: setup(), gate: fieldGate(kind) });
    }
    document.addEventListener("click", (e) => {
      if (extra()?.click?.(extraCtx(), e) === true) return;
      if (settingsExtra()?.click(extraCtx(), e) === true) return;
      {
        const exportEl = e.target.closest("button[data-export-kind]"),
          exportKind = exportEl?.dataset?.exportKind;
        if (exportKind && exportKind !== "customer" && !exportEl.disabled) return openExport(exportKind);
      }
      // 点卡片的空白处也打开详情（按钮、链接、输入框照常工作）。
      if (route === "opportunities" && !e.target.closest("button,a,input,select,textarea,label")) {
        const cardEl = e.target.closest(".opp-card");
        if (cardEl?.dataset.oppId) return showOppDetail(cardEl.dataset.oppId);
      }
      const el = e.target.closest("button");
      if (!el || el.disabled) return;
      const d = el.dataset;
      if (d.roleAction && onRolePage()) return roleClick(d);
      if (d.attachAction && onOppPage() && attachView.id) return attachAction(d);
      if (d.oppAction && onOppPage()) return oppAction(d);
      if (route === "doc-templates" && (d.docTab || d.docAction)) return docClick(d);
      if (d.oppDoc) return showOppDoc(d.id, d.oppDoc);
      if (route === "products" && (d.prodTab || d.prodAction || d.prodCancel !== undefined || d.prodEdit || d.prodSub || d.prodMove || d.prodDelete || d.prodValueRemove || d.prodLay)) return productClick(d);
      if (d.leadAction && onLeadPage()) return leadAction(d);
      if (d.leadStatus && route === "leads") {
        leadView.filters = { ...leadView.filters, status: d.leadStatus };
        leadView.limit = 0;
        render();
        return document.querySelector?.(`[data-lead-status="${cssEscape(d.leadStatus)}"]`)?.focus?.({ preventScroll: true });
      }
      if (route === "opp-flows" && d.oppSetTab) {
        flowView.tab = d.oppSetTab;
        flowView.armed = "";
        render();
        return document.querySelector?.(`[data-opp-set-tab="${cssEscape(flowView.tab)}"]`)?.focus?.({ preventScroll: true });
      }
      if (route === "opp-flows" && d.setAction) return setAction(d);
      if (route === "opp-flows" && d.flowAction) return flowAction(d);
      if (route === "opp-flows" && d.flowSelect) {
        flowView.flow = d.flowSelect;
        flowView.armed = "";
        render();
        return document.querySelector?.(`[data-flow-select="${cssEscape(flowView.flow)}"]`)?.focus?.({ preventScroll: true });
      }
      if (d.oppView && route === "opportunities") {
        oppView.mode = d.oppView === "list" ? "list" : "board";
        render();
        const sel = `[data-opp-view="${oppView.mode}"]`,
          all = document.querySelectorAll ? [...document.querySelectorAll(sel)] : [];
        // 切换按钮在筛选卡片里，聚焦看得见的那个
        return (all.find((el) => el.offsetParent !== null) || document.querySelector?.(sel))?.focus({ preventScroll: true });
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
      if (d.bizOrder) return need("order.view") && orderEditor(d.bizOrder);
      if (d.bizCustomer) return d.bizFollowup !== undefined && ctx.writeFollowup ? ctx.writeFollowup(d.bizCustomer) : ctx.openCustomer(d.bizCustomer);
      // 工作台「等你回复」的「回复」：打开聊天页，并选中这位客户的对话。
      if (d.bizChat) return ctx.openChat ? ctx.openChat(d.bizChat) : ctx.navigate("chats");
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
      if (d.bizGo) {
        if (d.bizGo === "opp-new") return openOppForm(undefined, "");
        // 「mail:unread」＝去邮件页的某个文件夹
        if (d.bizGo.startsWith("mail:")) return ctx.navigate("mail", "", true, false, d.bizGo.slice(5));
        return ctx.navigate(d.bizGo);
      }
      const action = d.bizAction;
      if (!action) return;
      if (action === "new-order") return orderEditor();
      if (action === "orders") return ctx.navigate("order-list");
      if (action === "order-trash") return ctx.navigate("order-trash");
      if (action === "new-task") return taskEditor();
      if (action === "assign-tasks") return taskEditor(d.id);
      if (action === "hide-task-hint") {
        try {
          localStorage.setItem(TASK_HINT_KEY, "1");
        } catch {
          /* 存不了也没关系，下次还会提示 */
        }
        return render();
      }
      if (action === "close-editor") return finishEditor();
      if (action === "archive-order") {
        if (!need("order.delete") || notYours(allOrders().find((o) => o.id === d.id))) return;
        return archiveOrder(d.id);
      }
      if (action.startsWith("oppdoc-")) return oppDocAction(action);
      if (action.startsWith("docrec-")) return docRecAction(action, d);
      if (action.startsWith("order-item-") || action.startsWith("order-doc")) return orderItemAction(action, d);
      if (action === "cancel-archive") return orderEditor(d.id, archiveDraft);
      if (action === "confirm-archive" && !need("order.delete")) return;
      if (action === "confirm-archive")
        return saveNext(
          () => B.archiveOrder(state(), d.id),
          "biz-order-error",
          finishEditor,
        );
      if (action === "restore-order") {
        if (!need("order.edit") || notYours((state().trashOrders || []).find((o) => o.id === d.id))) return;
        return saveNext(() => B.restoreOrder(state(), d.id), "", null);
      }
      if (action === "prev" || action === "next") {
        page += action === "prev" ? -1 : 1;
        return render();
      }
      if (action === "clear-filters") {
        search = "";
        stage = "";
        currency = "";
        period = "";
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
      if (action === "set-theme") {
        if (!need("settings.general")) return;
        const id = d.themeId;
        if (!THEME_CHOICES.some(([themeId]) => themeId === id)) return;
        // 只存配色，不重画页面，免得丢掉「默认录入」里还没保存的修改；颜色由 persist() 写到 <html data-theme>。
        return saveNext(
          () => ({ ...state(), laiSettings: { ...state().laiSettings, theme: id } }),
          "biz-settings-error",
          () => {
            document.querySelectorAll(".theme-option").forEach((option) => {
              const on = option.dataset.themeId === id;
              option.classList.toggle("selected", on);
              option.setAttribute("aria-pressed", String(on));
              option.querySelector(".theme-state").textContent = on ? "使用中" : "点击切换";
            });
            return false;
          },
        );
      }
      if (action === "discard-settings") {
        settingsDirty = false;
        return render();
      }
      if (action === "backup") return localAction();
    });
    document.addEventListener("input", (e) => {
      if (extra()?.input?.(extraCtx(), e) === true) return;
      if (docInput(e, "input")) return;
      if (e.target.id === "biz-search") {
        search = e.target.value;
        if (e.isComposing) return;
        // 边打字边筛选：停下 150 毫秒后只换表格里的行，搜索框不重画，不丢字、光标不动。
        page = 1;
        scheduleOrderRows();
      }
      if (route === "opportunities" && e.target.id === "opp-search" && !e.isComposing) {
        // 边打字边筛选：停下 150 毫秒后再画一次，光标留在原处。
        const pos = e.target.selectionStart;
        root.clearTimeout?.(oppSearchTimer);
        oppSearchTimer = root.setTimeout?.(() => {
          const input = document.getElementById("opp-search");
          if (route !== "opportunities" || !input) return;
          oppView.filters = { ...oppView.filters, search: input.value };
          oppView.limits = {};
          render();
          const next = document.getElementById("opp-search");
          next?.focus?.({ preventScroll: true });
          next?.setSelectionRange?.(pos, pos);
        }, 150);
      }
      if (e.target.closest("#biz-settings-form")) settingsDirty = true;
      const itemField = e.target.dataset?.itemField;
      if (itemField && draft?.items?.[e.target.dataset.itemIndex]) {
        draft.items[e.target.dataset.itemIndex][itemField] = e.target.value;
        syncOrderAmount();
      }
      else if (draft?.doc && e.target.closest?.("#biz-order-form")) showOrderDoc(draft.doc);
    });
    document.addEventListener("compositionend", (e) => {
      if (e.target.dataset?.docFilter === "query" && route === "doc-templates") return docInput({ target: e.target }, "input");
      if (e.target.id === "biz-search") {
        search = e.target.value;
        page = 1;
        scheduleOrderRows();
      }
    });
    // 看板拖动：拖到另一列调整阶段，「手动排序」下还能在列内调整先后；拖到输单会先问原因。拖进来的文件放进详情里的附件区。
    document.addEventListener("dragstart", (e) => {
      const card = route === "opportunities" ? e.target.closest?.("[data-opp-id]") : null;
      if (card && !can("opp.edit")) return e.preventDefault?.();
      oppDrag = card ? card.dataset.oppId : "";
      if (!card) return;
      e.dataTransfer?.setData("text/plain", oppDrag);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      // 稍后再变淡，否则拖动时跟着鼠标的影像也是淡的。
      root.setTimeout?.(() => { if (oppDrag === card.dataset.oppId) { card.classList.add("is-dragging"); card.closest?.(".opp-board")?.classList.add("is-dragging-board"); } }, 0);
    });
    document.addEventListener("dragover", (e) => {
      if (hasFiles(e) && onOppPage() && document.getElementById("opp-attach")) {
        // 文件只能放在附件区；放在别处什么也不做（也不让浏览器把文件当网页打开）。
        e.preventDefault();
        const zone = e.target.closest?.("[data-opp-dropzone]");
        document.querySelectorAll?.(".opp-dropzone.is-over").forEach((node) => { if (node !== zone) node.classList.remove("is-over"); });
        zone?.classList?.add("is-over");
        if (e.dataTransfer) e.dataTransfer.dropEffect = zone ? "copy" : "none";
        return;
      }
      if (!oppDrag) return;
      const target = dragTarget(e);
      if (!target) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      markDrop(target);
      autoScroll(e);
    });
    document.addEventListener("dragleave", (e) => {
      if (e.target.closest?.("[data-opp-dropzone]") && !e.relatedTarget?.closest?.("[data-opp-dropzone]")) e.target.closest("[data-opp-dropzone]").classList?.remove("is-over");
    });
    document.addEventListener("dragend", () => {
      oppDrag = "";
      clearDragMarks();
    });
    document.addEventListener("drop", (e) => {
      if (hasFiles(e) && onOppPage() && document.getElementById("opp-attach")) {
        e.preventDefault();
        document.querySelectorAll?.(".opp-dropzone.is-over").forEach((node) => node.classList.remove("is-over"));
        if (e.target.closest?.("[data-opp-dropzone]")) uploadFiles(e.dataTransfer.files);
        return;
      }
      const target = oppDrag ? dragTarget(e) : null;
      if (!target) return;
      e.preventDefault();
      const id = oppDrag;
      oppDrag = "";
      clearDragMarks();
      return moveOpp(id, target.stage, "", { before: target.before });
    });
    document.addEventListener("keydown", cardKey);
    document.addEventListener("change", (e) => {
      if (extra()?.change?.(extraCtx(), e) === true) return;
      if (settingsExtra()?.change(extraCtx(), e) === true) return;
      if (onRolePage() && roleChange(e)) return;
      if (docInput(e, "change")) return;
      if (e.target.dataset?.itemProduct !== undefined && draft?.items?.[e.target.dataset.itemProduct]) {
        const i = Number(e.target.dataset.itemProduct), old = draft.items[i], value = e.target.value;
        if (value === "__keep") return;
        const product = value && PM() ? PM().forRole(state(), PM().find(state(), value)) : null;
        if (!product) draft.items[i] = { ...old, productId: "", code: "", name: "", model: "", unit: "" };
        else {
          const next = B.itemFromProduct(product, old.qty || 1);
          draft.items[i] = next.price > 0 ? next : { ...next, price: old.price };
        }
        return renderOrderItems();
      }
      if (e.target.closest?.("#biz-order-form") && e.target.name === "currency") return syncOrderAmount();
      if (e.target.id === "opp-attach-input" && onOppPage()) {
        const files = [...(e.target.files || [])];
        e.target.value = "";
        return uploadFiles(files);
      }
      if (e.target.closest?.("#biz-target-form") && ["metric", "scope"].includes(e.target.name)) return syncTargetForm(e.target.closest("#biz-target-form"));
      if (onOppPage() && e.target.closest?.("#opp-form") && ["client", "flow", "stage", "nameMode", "currency"].includes(e.target.name)) return syncOppForm(e.target.name);
      if (route === "opp-flows" && ["setRename", "setField", "cfRename", "cfRequired", "cfOptions"].some((key) => e.target.dataset?.[key] !== undefined)) return setChange(e.target);
      // 改名没保存成功（空名、重名）时，输入框恢复成已保存的名称，提示留在页面上方。
      if (route === "opp-flows" && e.target.dataset?.flowRename) {
        if (!need("settings.opportunity")) return;
        const input = e.target, id = input.dataset.flowRename;
        return saveFlow(() => OM().renameFlow(state(), id, input.value), "[data-flow-rename]").then((ok) => {
          if (!ok) input.value = OM().flowOf(state(), id).label;
        });
      }
      if (route === "opp-flows" && e.target.dataset?.stageRename) {
        if (!need("settings.opportunity")) return;
        const input = e.target, flowId = input.dataset.flow, id = input.dataset.stageRename;
        return saveFlow(() => OM().renameFlowStage(state(), flowId, id, input.value), `[data-stage-rename="${cssEscape(id)}"]`).then((ok) => {
          if (!ok) input.value = OM().flowOf(state(), flowId).stages.find((stage) => stage.id === id)?.label ?? input.value;
        });
      }
      if (onLeadPage() && e.target.closest?.("#lead-convert-form") && e.target.name === "mode") return syncLeadConvert(e.target.closest("#lead-convert-form"));
      if (route === "products" && (e.target.id === "prod-search" || e.target.id === "prod-group")) {
        prodView[e.target.id === "prod-search" ? "search" : "group"] = e.target.value;
        render();
        return document.getElementById(e.target.id)?.focus?.({ preventScroll: true });
      }
      if (route === "products" && e.target.id === "prod-sync-file") return void readSyncFile(e.target.files?.[0]);
      if (route === "products" && e.target.name === "prod-sync-mode") return syncMode(e.target.value);
      if (route === "products" && e.target.dataset?.prodSel) return layoutSelect(e.target);
      if (route === "products" && e.target.dataset?.prodField) {
        if (!need("settings.product")) return render();
        const input = e.target, key = input.dataset.prodField;
        return saveNext(() => PM().setField(state(), key, { [input.dataset.prop]: input.checked }), "prod-error", () => undefined).then((ok) => {
          if (!ok) render();
        });
      }
      if (route === "leads" && Object.hasOwn(LEAD_FILTERS, e.target.id)) {
        leadView.filters = { ...leadView.filters, [LEAD_FILTERS[e.target.id]]: e.target.value };
        leadView.limit = 0;
        render();
        return document.getElementById(e.target.id)?.focus?.({ preventScroll: true });
      }
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
      if (route === "opp-analysis" && e.target.id === "opp-analysis-flow") {
        oppView.analysisFlow = e.target.value;
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
      if (e.target.id === "biz-period") {
        period = e.target.value;
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
      if (extra()?.submit?.(extraCtx(), e) === true) return;
      if (settingsExtra()?.submit(extraCtx(), e) === true) return;
      if (onRolePage() && form.dataset?.roleForm) {
        e.preventDefault();
        return roleSubmit(form);
      }
      if (route === "doc-templates" && form.dataset?.docForm) {
        e.preventDefault();
        return docSubmit(form);
      }
      if (route === "products" && form.dataset?.prodForm) {
        e.preventDefault();
        return productSubmit(form);
      }
      if (
        !["biz-order-form", "biz-task-form", "biz-settings-form", "biz-target-form", "lead-form", "product-form", "lead-follow-form", "lead-convert-form", "lead-invalid-form", "opp-form", "opp-lost-form", "opp-attach-rename", "opp-flow-add", "opp-stage-add-open", "opp-stage-add-won", "opp-stage-remove-form", "opp-reasons-add", "opp-types-add", "opp-cf-add"].includes(
          form.id,
        )
      )
        return;
      e.preventDefault();
      if (/^opp-(flow-add|stage-add-open|stage-add-won|stage-remove-form|reasons-add|types-add|cf-add)$/.test(form.id) && !need("settings.opportunity")) return;
      const data = Object.fromEntries(new FormData(form));
      if (form.id === "opp-attach-rename" && !need("opp.edit")) return;
      if (form.id === "opp-attach-rename")
        return saveNext(
          () => OM().renameAttachment(state(), attachView.id, form.dataset.att, data.name),
          "opp-attach-error",
          () => { attachView.renaming = ""; refreshAttach(); },
        );
      if (form.id === "opp-reasons-add" || form.id === "opp-types-add") return saveSet(() => OM().addChoice(state(), form.dataset.list, data.text), `#${form.id} input`);
      if (form.id === "opp-cf-add") return saveSet(() => OM().addCustomField(state(), data, { id: "c" + crypto.randomUUID().slice(0, 8) }), "#opp-cf-add input");
      if (form.id === "opp-flow-add") {
        const id = "f" + crypto.randomUUID().slice(0, 8);
        return saveFlow(() => {
          const next = OM().addFlow(state(), data, { id });
          flowView.flow = id;
          return next;
        }, "[data-flow-rename]");
      }
      if (form.id === "opp-stage-add-open" || form.id === "opp-stage-add-won")
        return saveFlow(() => OM().addFlowStage(state(), form.dataset.flow, { label: data.label, kind: form.dataset.kind }), `#${form.id} input`);
      if (form.id === "opp-stage-remove-form")
        return saveNext(
          () => OM().removeFlowStage(state(), form.dataset.flow, form.dataset.stage, { moveTo: data.moveTo }),
          "opp-stage-remove-error",
          () => ctx.closeDialog(),
        );
      if (form.id === "product-form") return productFormSubmit(form);
      if (form.id === "lead-form") {
        if (!leadDraft) return;
        const { id, isNew } = leadDraft;
        if (!need(isNew ? "lead.create" : "lead.edit")) return;
        // 改跟进人要有“重新分配”权限；没有时跟进人必须和原来（新建时是默认跟进人）一样。
        const lowered = (name) => String(name || "").trim().toLowerCase();
        const was = isNew ? LD().defaults(state()).owner : LD().list(state()).find((entry) => entry.id === id)?.owner;
        if (!can("lead.reassign") && lowered(data.owner) !== lowered(was)) return ctx.toast(RM().denied("lead.reassign"));
        // 字段权限：只读和隐藏的字段不能改。编辑时用原来的值，新建时不许填（表单里漏掉的字段也不会被清空）。
        const lead = RM().keepLocked(state(), "lead", isNew ? null : LD().list(state()).find((entry) => entry.id === id), data);
        // 自定义字段：表单里名字是 custom.字段ID（多选有好几个）；这里收成 lead.custom。只收账号能改、表单里确实有的字段，其余原样保留。
        for (const key of Object.keys(lead)) if (key.startsWith("custom.")) delete lead[key];
        const custom = {};
        const sent = new FormData(form);
        for (const def of LD().customFields(state())) {
          const key = `custom.${def.id}`;
          if (RM().fieldLevel(state(), "lead", key) !== "edit" || !form.querySelector(`[data-lead-custom="${cssEscape(def.id)}"]`)) continue;
          custom[def.id] = def.type === "multi" ? sent.getAll(key) : String(sent.get(key) ?? "");
        }
        if (Object.keys(custom).length) lead.custom = custom;
        // 和客户相同但设为「允许保存」：第一次点保存先提醒，内容没变再点一次才保存。
        const warn = LD().saveWarnings(state(), id, lead, { mustExist: !isNew });
        if (warn.message && leadDraft.warned !== warn.message) {
          leadDraft.warned = warn.message;
          const box = document.getElementById("lead-warn");
          if (box) { box.textContent = warn.message; box.hidden = false; }
          const submit = document.querySelector('button[form="lead-form"]');
          if (submit) submit.textContent = "仍然保存";
          return;
        }
        return saveNext(
          () => LD().upsert(state(), id, lead, { mustExist: !isNew }),
          "lead-error",
          () => {
            leadDraft = null;
            // 编辑完回到详情；新建完回到列表。
            return leadSaved(isNew ? "" : id)();
          },
        );
      }
      if (form.id === "lead-follow-form" && !need("lead.edit")) return;
      if (form.id === "lead-convert-form" && !need("lead.convert")) return;
      if (form.id === "lead-invalid-form" && !need("lead.edit")) return;
      if (form.id === "lead-follow-form") return saveNext(() => LD().addFollowup(state(), form.dataset.id, data), "lead-follow-error", leadSaved(form.dataset.id));
      if (form.id === "lead-convert-form")
        return saveNext(
          () => {
            if (customerHidden(data.mode === "existing" ? data.existing : data.name)) throw new Error(HIDDEN_CUSTOMER);
            return LD().convert(state(), form.dataset.id, data);
          },
          "lead-convert-error",
          leadSaved(form.dataset.id),
        );
      if (form.id === "lead-invalid-form") return saveNext(() => LD().markInvalid(state(), form.dataset.id, data), "lead-invalid-error", leadSaved(form.dataset.id));
      if (form.id === "opp-form") {
        if (!oppDraft) return;
        if (!need(oppDraft.isNew ? "opp.create" : "opp.edit")) return;
        // 多选（商机来源、多选的自定义字段）和自定义字段的值：表单里的名字是 custom:字段ID，这里收成 data.custom。
        const custom = { ...(data.custom || {}) };
        for (const key of Object.keys(data)) if (key.startsWith("custom:")) { custom[key.slice(7)] = data[key]; delete data[key]; }
        for (const group of form.querySelectorAll?.("[data-multi]") || []) {
          const picked = [...group.querySelectorAll('input[type="checkbox"]')].filter((box) => box.checked).map((box) => box.value);
          if (group.dataset.multi.startsWith("custom:")) custom[group.dataset.multi.slice(7)] = picked;
          else data[group.dataset.multi] = picked;
        }
        if (Object.keys(custom).length) data.custom = custom;
        // 改负责人要有“转移负责人”权限；没有时负责人必须和原来（新建时是默认负责人）一样。
        const owner = (name) => String(name || "").trim().toLowerCase();
        const was = oppDraft.isNew ? OM().defaults(state(), B.localDate()).owner : oppItem(oppDraft.id)?.owner;
        if (!can("opp.transfer") && owner(data.owner) !== owner(was)) return ctx.toast(RM().denied("opp.transfer"));
        // 字段权限：只读和隐藏的字段不能改。编辑时沿用原来的值，新建时不许填（用默认值），表单里漏掉的字段也不会被清空。
        const locked = oppLocked();
        const input = OM().lockInput(locked, oppDraft.isNew ? null : oppItem(oppDraft.id), data, OM().defaults(state(), B.localDate()));
        // 本人／本部门账号不能给看不到的客户建商机；客户没改的老商机照常保存。
        const wasClient = oppDraft.isNew ? "" : String(oppItem(oppDraft.id)?.client || "").trim();
        return saveNext(
          () => {
            if (String(input.client || "").trim().toLowerCase() !== wasClient.toLowerCase() && customerHidden(input.client)) throw new Error(HIDDEN_CUSTOMER);
            return OM().upsert(state(), oppDraft.id, input, { mustExist: !oppDraft.isNew, locked });
          },
          "opp-error",
          () => {
            oppDraft = null;
            return oppDone();
          },
        );
      }
      if (form.id === "opp-lost-form" && !need("opp.edit")) return;
      if (form.id === "opp-lost-form")
        return saveNext(
          () => OM().moveStage(state(), form.dataset.id, "lost", data),
          "opp-lost-error",
          oppDone,
        );
      if (form.id === "biz-target-form" && !need(targetFormKey)) return;
      if (form.id === "biz-target-form")
        return saveNext(
          () => root.LaiTeamModel.setTarget(state(), data),
          "biz-target-error",
          () => ctx.closeDialog(),
        );
      if (form.id === "biz-order-form") {
        if (!need(draft?.isNew ? "order.create" : "order.edit")) return;
        data.isDraft = form.elements.isDraft.checked;
        data.items = draft.items || [];
        // 自定义字段：表单里名字是 custom.字段ID（多选有好几个）；这里收成 data.custom。只收表单里确实有的字段，其余原样保留。
        for (const key of Object.keys(data)) if (key.startsWith("custom.")) delete data[key];
        if (root.LaiOrderFieldsUI && root.LaiOrderFields) data.custom = root.LaiOrderFieldsUI.collect(form, root.LaiOrderFields.customFields(state()), (id) => !RM() || RM().fieldLevel(state(), "order", `custom.${id}`) === "edit");
        // 本人／本部门账号不能给看不到的客户建订单；客户没改的老订单照常保存。
        const wasClient = String(allOrders().find((order) => order.id === draft.id)?.client || "").trim();
        return saveNext(
          () => {
            if (String(data.client || "").trim().toLowerCase() !== wasClient.toLowerCase() && customerHidden(data.client)) throw new Error(HIDDEN_CUSTOMER);
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
        // 负责人：新待办默认是当前账号；只有能“重新分配”的账号才能指定别人（页面上其他账号看不到这个选项，这里再卡一次）。
        const taskOpts = RM() ? { me: RM().meName(state()), canReassign: taskCanReassign(), members: taskMembers() } : {};
        return saveNext(
          () => B.setTask(state(), draft.id, data, taskOpts),
          "biz-task-error",
          finishEditor,
        );
      }
      if (!need("settings.general")) return;
      // 订单前缀只能是字母、数字和短横线；不合格就不保存，原来的值保留。
      if (Object.hasOwn(data, "orderPrefix")) {
        data.orderPrefix = String(data.orderPrefix || "").trim();
        if (!/^[A-Za-z0-9-]+$/.test(data.orderPrefix)) return setText("biz-settings-error", "订单前缀只能用字母、数字和-", true);
      }
      // 公司资料（company:*、bank:*）写进单据模板那一份，其余才是默认录入。
      const pick = (kind, fields) => Object.fromEntries(fields.map(([key]) => [key, data[`${kind}:${key}`] || ""]));
      const hasCompany = Boolean(DM()) && DM().COMPANY_FIELDS.some(([key]) => `company:${key}` in data);
      const company = hasCompany ? pick("company", DM().COMPANY_FIELDS) : null, bank = hasCompany ? pick("bank", DM().BANK_FIELDS) : null;
      for (const key of Object.keys(data)) if (/^(company|bank):/.test(key) || key === "companyName") delete data[key];
      return saveNext(
        () => {
          const base = { ...state(), laiSettings: { ...state().laiSettings, ...data } };
          // 以前存的小满配色在这次正常保存设置时写成科技蓝（D-029），载入时不写。
          const theme = savedTheme(base.laiSettings);
          if (theme !== base.laiSettings.theme) base.laiSettings.theme = theme;
          return company ? DM().setBank(DM().setCompany(base, company), bank) : base;
        },
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
        // 这个客户的商机可能分在几个销售流程里：先打开商机最多的那个，其余的页面上会提示。
        const flows = OM().board(state(), oppView.filters, B.localDate()).flows;
        oppView.filters.flow = [...flows].sort((a, b) => b.count - a.count)[0]?.id || "default";
        oppView.limits = {};
        // 这次是带着客户名进来的，进页面时不要把筛选清掉。
        keepOppFilters = true;
        return Promise.resolve(ctx.navigate("opportunities")).finally(() => (keepOppFilters = false));
      },
      navigate(next) {
        roleReset(next);
        oppReturn = "";
        armedTarget = "";
        flowView.armed = "";
        leadArmed = "";
        clearUndo();
        // 从左侧导航等地方打开商机：筛选回到默认，不留上次的搜索词或归档范围。
        if (next === "opportunities" && !keepOppFilters) {
          oppView.filters = {};
          oppView.limits = {};
        }
        route = next;
        render();
      },
      refresh: render,
      hasDraft: () => !!draft || !!oppDraft || !!leadDraft || settingsDirty,
      discardDraft() {
        draft = null;
        oppDraft = null;
        leadDraft = null;
      },
      route: () => route,
    };
  }
  root.LaiBusinessUI = { create };
})(window);
