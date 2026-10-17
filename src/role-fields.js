(function(root){
  'use strict';
  // 字段权限能设哪些字段：每个模块自己提供 roleFieldList(state) → [{key,label,group}]，这里只负责找到它。
  // 商机 LaiOpportunityModel、产品 LaiProductModel、客户和公海客户 LaiCustomerFields.roleFieldList(state,module)。
  // 必填、跟进人／负责人这类字段不在清单里：它们总是可编辑（跟进人由“重新分配”等权限管）。
  function list(state,module){
    const pick={
      opp:()=>root.LaiOpportunityModel?.roleFieldList?.(state),
      product:()=>root.LaiProductModel?.roleFieldList?.(state),
      customer:()=>root.LaiCustomerFields?.roleFieldList?.(state,'customer'),
      pool:()=>root.LaiCustomerFields?.roleFieldList?.(state,'pool'),
    }[module];
    const rows=pick?pick():null;
    return Array.isArray(rows)?rows.filter(row=>row&&row.key&&row.label):[];
  }
  const api={list};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiRoleFields=api;
})(typeof window!=='undefined'?window:globalThis);
