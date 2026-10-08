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
  const GROUPS = Object.freeze([
    { id: "general", title: "通用", items: [
      { id: "defaults", title: "默认录入", note: "公司名称、订单编号前缀、默认币种、默认跟进人", open: ["route", "settings"], current: "defaults" },
      { id: "theme", title: "界面配色", note: "小满、粉色、橙色，选中后立即生效，只影响这台电脑", open: ["route", "settings"], current: "theme" },
      { id: "favorites", title: "常用导航", note: "管理左侧栏“常用”里的快捷入口：添加、排序、移除", open: ["action", "favorite-nav-manage"] },
    ] },
    { id: "customer", title: "客户", items: [
      { id: "columns", title: "列表字段", note: "客户列表显示哪些字段、顺序和冻结列", open: ["action", "settings"] },
      { id: "segments", title: "客群管理", note: "新建、编辑、删除客群", open: ["action", "manage-segments"] },
      { id: "customer-settings", title: "客户设置", note: "客户相关设置的入口页", open: ["screen", "customer-settings"] },
    ] },
    { id: "opportunity", title: "商机", items: [
      { id: "flows", title: "销售流程设置", note: "商机的销售流程与阶段", open: ["route", "opp-flows"] },
    ] },
    { id: "team", title: "团队", items: [
      { id: "targets", title: "目标管理", note: "团队和个人的月度目标", open: ["route", "team-targets"] },
    ] },
    { id: "mail", title: "邮件", items: [
      { id: "mail-account", title: "邮箱设置", note: "发件人名称、签名、是否自动检查新邮件", open: ["action", "open-mail-settings"] },
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
  function markup(info, escape) {
    const E = escape || identity;
    const data = { orderPrefix: "L", currency: "USD", themeName: "小满", ...(info || {}) };
    const groups = (data.testData ? GROUPS.concat([TEST_DATA_GROUP]) : GROUPS).map((group) => `<section class="business-section sh-group" data-sh-group="${group.id}"><div class="section-head"><h3>${E(group.title)}</h3></div><div class="sh-list">${
      group.items.map((item) => {
        const now = current(item, data, E);
        return `<div class="sh-item" data-sh-item="${item.id}"><div class="sh-text"><strong>${E(item.title)}</strong><span>${E(item.note)}</span></div>${now ? `<em class="sh-now">${now}</em>` : ""}<button type="button" ${ATTR[item.open[0]]}="${item.open[1]}" aria-label="打开${E(item.title)}">设置</button></div>`;
      }).join("")
    }</div></section>`).join("");
    return `<div class="pagebar"><div class="business-title"><h1>设置中心</h1><span>来财里能设置的内容都在这里，点“设置”打开对应的设置</span></div><div class="page-actions"></div></div><div class="business-scroll sh-page">${groups}</div>`;
  }
  return { GROUPS, TEST_DATA_GROUP, markup };
});
