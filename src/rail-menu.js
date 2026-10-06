(function(root){
  'use strict';
  // 左侧栏悬停浮层的内容：只列出应用里已经存在的页面入口，不新增功能。
  const NF=typeof module!=='undefined'&&module.exports?require('./nav-favorites.js'):root.LaiNavFavorites;
  const rows=(...items)=>items.map(([label,kind,target])=>Object.freeze({label,kind,target}));
  const fixed={
    '客户':rows(['客户列表','screen','active'],['公海客户','screen','pool'],['客户查重','screen','duplicates'],['客户设置','screen','customer-settings']),
    '工作台':rows(['工作台','route','dashboard']),
    '交易':rows(['全部订单','route','order-list'],['订单回收站','route','order-trash']),
    '团队数据':rows(['经营统计','route','analysis']),
    '协同':rows(['日历与待办','route','calendar']),
    '企业管理':rows(['设置','route','settings'])
  };
  // 返回条目数组；null 表示该菜单目前只是保留入口（邮件、沟通、线索、商机），没有可列出的页面。
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
