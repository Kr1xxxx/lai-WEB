(function(root){
  'use strict';
  // 角色权限和成员管理页面的标记（企业管理 → 角色权限／成员管理）。只拼 HTML，不改数据；控制在 business-ui.js。
  const api={};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiRoleUI=api;
})(typeof window!=='undefined'?window:globalThis);
