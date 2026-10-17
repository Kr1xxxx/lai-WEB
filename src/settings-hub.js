/* 设置中心页面：把来财里分散在各处的设置汇总到一页。
   纯函数：只生成 HTML，不碰 DOM、不发请求，所以能直接用 node 测试。
   每一项都是一个按钮，点了打开原来的那个真实设置（路由、客户页面或弹窗）；这里不重复实现任何设置。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiSettingsHub = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  // open：怎么打开。route＝业务页面（data-lai-route）、screen＝客户页面（data-lai-screen）、action＝应用里已有的 data-action。
  // perm：要有这个权限才显示（见 role-model.js）；写成数组时要全部都有。anyPerm：数组里有任何一项就显示（客户设置里的判重、来源页签有各自的权限）。
  // 没写就谁都能看到。markup 的 info.can(key) 决定当前账号有没有，没传时全部显示。
  const GROUPS = Object.freeze([
    { id: "general", title: "通用", items: [
      { id: "defaults", title: "默认录入", note: "公司资料（名称、地址、电话、银行）、订单编号前缀、默认币种、默认跟进人、订单字段", open: ["route", "settings"], current: "defaults", perm: "settings.general" },
      { id: "theme", title: "界面配色", note: "粉色、橙色、小满、科技蓝，选中后立即生效，配色跟着数据一起保存", open: ["route", "settings"], current: "theme", perm: "settings.general" },
      { id: "favorites", title: "常用导航", note: "管理左侧栏“常用”里的快捷入口：添加、排序、移除", open: ["action", "favorite-nav-manage"] },
      { id: "feature-switch", title: "功能开关", note: "线索、商机、产品、单据、邮件、沟通、团队数据可以关掉不用；数据都保留，重新打开就能用", open: ["route", "feature-switch"], perm: "settings.switch" },
    ] },
    { id: "lead", title: "线索", items: [
      { id: "lead-settings", title: "线索设置", note: "无效原因、线索字段、自定义字段", open: ["route", "lead-settings"], module: "lead", perm: "settings.lead" },
    ] },
    { id: "customer", title: "客户", items: [
      { id: "columns", title: "列表字段", note: "客户列表显示哪些字段、顺序和冻结列", open: ["action", "settings"], perm: "customer.view" },
      { id: "segments", title: "客群管理", note: "新建、编辑、归档客群", open: ["action", "manage-segments"], perm: "customer.view" },
      { id: "customer-settings", title: "客户设置", note: "客户相关设置的入口页", open: ["screen", "customer-settings"], anyPerm: ["settings.customer", "settings.dedupe", "settings.source"] },
    ] },
    { id: "opportunity", title: "商机", items: [
      { id: "flows", title: "商机设置", note: "销售流程、输单原因和商机字段", open: ["route", "opp-flows"], module: "opp", perm: "settings.opportunity" },
    ] },
    { id: "product", title: "产品和单据", items: [
      { id: "product-settings", title: "产品设置", note: "产品分组、产品字段、规格管理、布局", open: ["route", "products"], module: "product", perm: ["product.view", "settings.product"] },
      { id: "doc-templates", title: "单据模板", note: "报价单、形式发票、销售订单、发货通知的样式，并可预览", open: ["route", "doc-templates"], module: "doc", perm: "settings.docTemplate" },
      { id: "rates", title: "汇率设置", note: "每 100 外币折合多少美元，用来把外币订单折成美元", open: ["route", "rates"], perm: "settings.rate" },
    ] },
    { id: "chat", title: "沟通", items: [
      { id: "chat-templates", title: "聊天模板", note: "WhatsApp 常用话术：新建、修改、删除", open: ["route", "chat-templates"], module: "chat", perm: "chat.template" },
    ] },
    { id: "task", title: "协同", items: [
      { id: "task-settings", title: "任务设置", note: "按规则自动建待办：客户没跟进、订单到了某阶段、商机快到期、复购提醒", open: ["route", "task-settings"], perm: "settings.task" },
    ] },
    { id: "team", title: "团队", items: [
      { id: "targets", title: "目标管理", note: "团队和个人的月度和季度目标", open: ["route", "team-targets"], module: "team", perm: "team.targets" },
    ] },
    { id: "mail", title: "邮件", items: [
      { id: "mail-account", title: "邮箱设置", note: "发件人名称、签名、是否自动检查新邮件", open: ["action", "open-mail-settings"], module: "mail", perm: "mail.view" },
    ] },
  ]);
  // 只在网页试用版里出现：试用页自带的数据面板由页面脚本接管，点击 data-action="web-trial-data" 即打开。应用本体没有这一组。
  const TEST_DATA_GROUP = Object.freeze({ id: "test-data", title: "测试数据", items: [
    { id: "test-data", title: "数据管理", note: "载入示例数据、备份与恢复、清空；数据只保存在当前浏览器里", open: ["action", "web-trial-data"] },
  ] });
  const ATTR = { route: "data-lai-route", screen: "data-lai-screen", action: "data-action" };
  const identity = (s) => String(s);
  function current(item, info, E) {
    if (item.current === "defaults") return `${E(info.orderPrefix)} · ${E(info.currency)}`;
    if (item.current === "theme") return E(info.themeName);
    return "";
  }
  // module：这一项属于哪个可以关的模块（功能开关）；模块关了就不显示。info.moduleOn(模块) 没传时当作都开着。
  const allowed = (item, can, moduleOn = () => true) =>
    (!item.module || moduleOn(item.module)) && (!item.perm || [].concat(item.perm).every((key) => can(key))) && (!item.anyPerm || item.anyPerm.some((key) => can(key)));
  function markup(info, escape) {
    const E = escape || identity;
    const data = { orderPrefix: "L", currency: "USD", themeName: "粉色", ...(info || {}) };
    const can = typeof data.can === "function" ? data.can : () => true;
    const moduleOn = typeof data.moduleOn === "function" ? data.moduleOn : () => true;
    const visible = (data.testData ? GROUPS.concat([TEST_DATA_GROUP]) : GROUPS)
      .map((group) => ({ ...group, items: group.items.filter((item) => allowed(item, can, moduleOn)) }))
      .filter((group) => group.items.length);
    const groups = visible.map((group) => `<section class="business-section sh-group" data-sh-group="${group.id}"><div class="section-head"><h3>${E(group.title)}</h3></div><div class="sh-list">${
      group.items.map((item) => {
        const now = current(item, data, E);
        return `<div class="sh-item" data-sh-item="${item.id}"><div class="sh-text"><strong>${E(item.title)}</strong><span>${E(item.note)}</span></div>${now ? `<em class="sh-now">${now}</em>` : ""}<button type="button" ${ATTR[item.open[0]]}="${item.open[1]}" aria-label="打开${E(item.title)}">设置</button></div>`;
      }).join("")
    }</div></section>`).join("");
    return `<div class="pagebar"><div class="business-title"><h1>设置中心</h1><span>常用的设置汇总在这里，点“设置”打开；客户摘要字段、公司显示、表格行高和列宽在各自的页面里设置</span></div><div class="page-actions"></div></div><div class="business-scroll sh-page">${groups}</div>`;
  }
  return { GROUPS, TEST_DATA_GROUP, markup, allowed };
});
