(function(root){
  'use strict';
  // 左侧栏悬停浮层的内容：只列出应用里已经存在的页面入口，不新增功能。
  const NF=typeof module!=='undefined'&&module.exports?require('./nav-favorites.js'):root.LaiNavFavorites;
  // kind: route＝业务页面，screen＝客户页面，mail＝邮件文件夹，feature＝保留入口（点开只提示待后续实现）；group 用于二级导航分组。
  const rows=(...items)=>items.map(([label,kind,target,group])=>Object.freeze(group?{label,kind,target,group}:{label,kind,target}));
  const fixed={
    '客户':rows(['客户列表','screen','active'],['公海客户','screen','pool'],['客户查重','screen','duplicates'],['客户设置','screen','customer-settings']),
    '商机':rows(['商机看板','route','opportunities'],['商机分析','route','opp-analysis']),
    '工作台':rows(['工作台','route','dashboard']),
    // 邮件目前只有界面骨架：六个文件夹都显示「未绑定邮箱」，不连接邮箱。
    '邮件':rows(['收件箱','mail','inbox'],['待处理邮件','mail','pending'],['未读邮件','mail','unread'],['草稿箱','mail','drafts'],['发件箱','mail','sent'],['群发箱','mail','bulk']),
    '交易':rows(['全部订单','route','order-list'],['订单回收站','route','order-trash']),
    '团队数据':rows(['目标完成情况','route','team-goals','目标数据'],['目标管理','route','team-targets','目标数据'],['团队墙','route','team-wall','目标数据'],
      ['经营统计','route','analysis','统计报表'],['客户资产','route','team-assets','统计报表'],['跟进情况','route','team-followups','统计报表'],['任务完成','route','team-tasks','统计报表'],['订单业绩','route','team-orders','统计报表']),
    '协同':rows(['日历与待办','route','calendar']),
    '企业管理':rows(['设置','route','settings'])
  };
  // 返回条目数组；null 表示该菜单目前只是保留入口（沟通、线索、商机），没有可列出的页面。
  function menuFor(label,settings){
    if(label==='常用')return NF.entries(settings).map(entry=>({label:entry.label,kind:'favorite',target:entry.screen}));
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
  const api={menuFor,sectionFor};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiRailMenu=api;
})(typeof window!=='undefined'?window:globalThis);
