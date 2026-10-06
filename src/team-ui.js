(function(root){
  'use strict';
  // 团队数据页面的纯标记生成：不读写数据，数字上带 data-team-detail，由业务界面决定点击后的明细。
  const DETAIL_LIMIT=200;
  const number=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  function create(E){
    const text=(value,format,currency)=>{
      if(value===null||value===undefined)return '—';
      if(format==='percent')return `${value}%`;
      if(format==='money')return `${number(value)} ${E(currency||'')}`;
      return String(value);
    };
    // 有明细的数字做成按钮，0 或没有明细的只显示文字。
    const figure=(key,cell,format,currency)=>{
      const shown=text(cell.value,format,currency);
      return cell.items?.length?`<button type="button" class="team-number" data-team-detail="${key}" aria-label="查看明细：${shown}">${shown}</button>`:shown;
    };
    const tiles=report=>`<div class="team-tiles">${report.tiles.map(tile=>`<div class="team-tile"><span>${E(tile.label)}</span><strong>${figure('tile:'+tile.id,{value:tile.value,items:tile.items},tile.format,tile.currency)}</strong></div>`).join('')}</div>`;
    function table(report){
      const hasCurrency=report.kind==='orders';
      const head=`<tr><th>跟进人</th>${hasCurrency?'<th>币种</th>':''}${report.columns.map(column=>`<th>${E(column.label)}</th>`).join('')}</tr>`;
      const cells=(row,key,currency)=>report.columns.map(column=>`<td>${figure(`${key}:${column.id}`,row.cells[column.id],column.format,currency||row.currency)}</td>`).join('');
      const body=report.rows.map((row,index)=>`<tr><td>${E(row.label)}</td>${hasCurrency?`<td><span class="currency-badge">${E(row.currency)}</span></td>`:''}${cells(row,'r:'+index)}</tr>`);
      const foot=[];
      if(report.total)foot.push(`<tr class="team-total"><td>合计</td>${cells({cells:report.total},'t')}</tr>`);
      (report.totals||[]).forEach((total,index)=>foot.push(`<tr class="team-total"><td>合计</td><td><span class="currency-badge">${E(total.currency)}</span></td>${cells({cells:total.cells},'ot:'+index,total.currency)}</tr>`));
      const colspan=report.columns.length+1+(hasCurrency?1:0);
      return `<table class="order-table team-table"><thead>${head}</thead><tbody>${body.join('')||`<tr><td colspan="${colspan}">本月暂无数据</td></tr>`}${foot.join('')}</tbody></table>`;
    }
    const extra=report=>(report.extra||[]).map(block=>`<section class="business-section"><div class="section-head"><h3>${E(block.title)}</h3></div><table class="order-table team-table"><thead><tr><th>${E(block.columnLabel)}</th><th>数量</th><th>占比</th></tr></thead><tbody>${block.rows.map((row,index)=>`<tr><td>${E(row.label)}</td><td>${figure('x:'+block.id+':'+index,{value:row.count,items:row.items},'count')}</td><td>${row.percent}%</td></tr>`).join('')||'<tr><td colspan="3">暂无数据</td></tr>'}</tbody></table></section>`).join('');
    function trend(report){
      const {months,series}=report.trend;
      return `<section class="business-section"><div class="section-head"><h3>近 ${months.length} 个月趋势</h3></div>${series.map(item=>{
        const max=Math.max(1,...months.map(entry=>entry.values[item.id]));
        return `<h4 class="team-trend-title">${E(item.label)}</h4><div class="stage-bars">${months.map(entry=>`<div><span>${E(entry.month)}</span><div><i style="width:${Math.round(entry.values[item.id]/max*100)}%"></i></div><b>${text(entry.values[item.id],item.format,item.currency)}</b></div>`).join('')}</div>`;
      }).join('')}</section>`;
    }
    const markup=report=>`<div class="business-scroll team-page">${tiles(report)}<section class="business-section"><div class="section-head"><h3>按跟进人</h3><span class="muted tiny">${E(report.scope)}</span></div>${table(report)}${report.notes.map(note=>`<p class="muted tiny team-note">${E(note)}</p>`).join('')}</section>${extra(report)}${trend(report)}</div>`;

    // key 形如 tile:id / r:行号:列 / t:列 / ot:行号:列 / x:块:行号；解析失败返回 null。
    function itemsFor(report,key){
      const part=String(key).split(':');
      const pick=(cells,id)=>cells&&Object.hasOwn(cells,id)?cells[id]:null;
      let cell=null,label=report.title;
      if(part[0]==='tile'){const tile=report.tiles.find(item=>item.id===part.slice(1).join(':'));cell=tile?{items:tile.items}:null;label=tile?.label||label;}
      else if(part[0]==='r'){const row=report.rows[Number(part[1])];cell=pick(row?.cells,part[2]);label=`${row?.label||''} · ${report.columns.find(c=>c.id===part[2])?.label||''}`;}
      else if(part[0]==='t'){cell=pick(report.total,part[1]);label=`合计 · ${report.columns.find(c=>c.id===part[1])?.label||''}`;}
      else if(part[0]==='ot'){const total=(report.totals||[])[Number(part[1])];cell=pick(total?.cells,part[2]);label=`合计 ${total?.currency||''} · ${report.columns.find(c=>c.id===part[2])?.label||''}`;}
      else if(part[0]==='x'){const row=report.extra?.find(block=>block.id===part[1])?.rows[Number(part[2])];cell=row?{items:row.items}:null;label=row?.label||label;}
      return cell&&Array.isArray(cell.items)?{label,items:cell.items}:null;
    }
    function detailMarkup(items){
      const shown=items.slice(0,DETAIL_LIMIT);
      const link=item=>item.customer?`<button type="button" class="text-button" data-biz-customer="${E(item.customer)}">${item.kind==='customer'?'查看客户':'查看客户 '+E(item.customer)}</button>`:'';
      return `<div class="drawer-body team-detail"><p class="muted tiny">共 ${items.length} 条${items.length>shown.length?`，仅显示前 ${DETAIL_LIMIT} 条`:''}</p><ul class="team-detail-list">${shown.map(item=>`<li><div><strong>${E(item.title)}</strong>${item.meta?` <span class="muted tiny">${E(item.meta)}</span>`:''}</div>${item.text?`<div class="tiny">${E(item.text)}</div>`:''}${link(item)}</li>`).join('')||'<li>没有记录</li>'}</ul></div>`;
    }
    return {markup,itemsFor,detailMarkup};
  }
  const api={create,DETAIL_LIMIT};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiTeamUI=api;
})(typeof window!=='undefined'?window:globalThis);
