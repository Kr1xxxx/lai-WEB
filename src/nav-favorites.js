(function(root){
  'use strict';
  // 常用导航：只记录「哪些既有导航条目被收藏、顺序如何」，不涉及任何业务字段或规则。
  const catalog=[
    ['screen:active','客户列表','active'],
    ['screen:pool','公海客户','pool'],
    ['screen:duplicates','客户查重','duplicates']
  ].map(([id,label,screen])=>Object.freeze({id,label,route:'customers',screen}));
  const byId=new Map(catalog.map(entry=>[entry.id,entry]));
  const known=id=>typeof id==='string'&&byId.has(id);
  function requireKnown(id){if(!known(id))throw new Error('该导航条目不能加入常用');}
  // 历史或手工修改的数据可能含未知、重复或非字符串项：读取时一律过滤，不抛错。
  // 从未设置过时默认收藏全部可收藏条目（与原先星标全部点亮一致）；用户设置过（包括清空）后以保存的为准。
  const defaults=catalog.map(entry=>entry.id);
  function list(settings){
    if(!Array.isArray(settings?.favoriteNav))return [...defaults];
    return [...new Set(settings.favoriteNav.filter(known))];
  }
  const isFavorite=(settings,id)=>list(settings).includes(id);
  const withList=(settings,next)=>({...(settings||{}),favoriteNav:next});
  function toggle(settings,id){
    requireKnown(id);
    const current=list(settings);
    return withList(settings,current.includes(id)?current.filter(item=>item!==id):[...current,id]);
  }
  function remove(settings,id){
    requireKnown(id);
    return withList(settings,list(settings).filter(item=>item!==id));
  }
  function move(settings,id,delta){
    requireKnown(id);
    const current=list(settings),index=current.indexOf(id);
    if(index<0)throw new Error('该导航条目尚未加入常用');
    const target=Math.max(0,Math.min(current.length-1,index+(delta<0?-1:1)));
    if(target===index)return withList(settings,current);
    const next=[...current];next.splice(index,1);next.splice(target,0,id);
    return withList(settings,next);
  }
  const entries=settings=>list(settings).map(id=>byId.get(id));
  const api={catalog,known,list,isFavorite,toggle,remove,move,entries};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiNavFavorites=api;
})(typeof window!=='undefined'?window:globalThis);
