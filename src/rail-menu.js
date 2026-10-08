(function(root){
  'use strict';
  // 左侧栏各菜单包含哪些页面入口：只列出应用里已经存在的页面，不新增功能。
  // 这里是「有哪些入口」的唯一来源：悬停浮层、各菜单的二级导航、以及能设为常用的条目清单（nav-favorites.js）都从这里读取。
  // kind: route＝业务页面，screen＝客户页面，mail＝邮件文件夹，feature＝保留入口（点开只提示待后续实现，不能设为常用）；group 用于二级导航分组。
  // 真实入口（route／screen／mail）自带 id＝「kind:target」，例如 screen:active、route:order-list、mail:inbox；id 存进 laiSettings.favoriteNav，保持不变。
  const FAVORITABLE=['screen','route','mail'];
  const menu=(menuLabel,...items)=>items.map(([label,kind,target,group])=>{
    const row={label,kind,target,menu:menuLabel};
    if(group)row.group=group;
    if(FAVORITABLE.includes(kind))row.id=kind+':'+target;
    return Object.freeze(row);
  });
  const fixed={
    '客户':menu('客户',['客户列表','screen','active'],['公海客户','screen','pool'],['客户查重','screen','duplicates'],['客户设置','screen','customer-settings']),
    '商机':menu('商机',['商机看板','route','opportunities'],['商机分析','route','opp-analysis'],['销售流程设置','route','opp-flows']),
    '工作台':menu('工作台',['工作台','route','dashboard']),
    // Leads：入口已保留；菜单里先放一个「设置」，点开提示待后续实现（kind 为 feature，不能设为常用）。
    'Leads':menu('Leads',['设置','feature','Leads 设置']),
    // 邮件文件夹：与 mail-ui.js 的 folders 一一对应（测试里核对）。邮箱没有绑定时六个文件夹都显示「未绑定邮箱」。
    '邮件':menu('邮件',['收件箱','mail','inbox'],['待处理邮件','mail','pending'],['未读邮件','mail','unread'],['草稿箱','mail','drafts'],['发件箱','mail','sent'],['群发箱','mail','bulk']),
    '交易':menu('交易',['全部订单','route','order-list'],['订单回收站','route','order-trash']),
    '团队数据':menu('团队数据',['目标完成情况','route','team-goals','目标数据'],['目标管理','route','team-targets','目标数据'],['团队墙','route','team-wall','目标数据'],
      ['经营统计','route','analysis','统计报表'],['客户资产','route','team-assets','统计报表'],['跟进情况','route','team-followups','统计报表'],['任务完成','route','team-tasks','统计报表'],['订单业绩','route','team-orders','统计报表']),
    '协同':menu('协同',['日历与待办','route','calendar']),
    '企业管理':menu('企业管理',['设置','route','settings'],['设置中心','route','settings-hub'])
  };
  // 返回条目数组；null 表示该菜单目前只是保留入口（沟通、线索；Leads 有一个「设置」保留入口，不是 null）或不是真实菜单（常用有自己的清单，见 nav-favorites.js）。
  function menuFor(label){
    return Object.hasOwn(fixed,label)?fixed[label].map(row=>({...row})):null;
  }
  // 某个业务页面所属的左侧菜单及该菜单自己的全部入口（用于二级导航，各菜单之间互不重复）。
  function sectionFor(route){
    for(const [label,items] of Object.entries(fixed)){
      if(label==='客户')continue;
      if(items.some(item=>item.kind==='route'&&item.target===route))return {label,entries:items.map(item=>({...item}))};
    }
    return null;
  }
  // 所有能设为常用的条目，按菜单顺序排列。在菜单里加一个真实页面，它就自动出现在这里。
  function favoritable(){
    return Object.values(fixed).flat().filter(row=>row.id).map(row=>({...row}));
  }
  // 条目 id 对应的菜单行；没有这个 id 时返回 null。
  function entryById(id){
    return favoritable().find(row=>row.id===id)||null;
  }
  const api={menuFor,sectionFor,favoritable,entryById};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiRailMenu=api;
})(typeof window!=='undefined'?window:globalThis);
