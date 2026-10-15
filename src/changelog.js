(function(root){
  'use strict';
  // 版本更新历史：点顶栏的版本号弹出。每次有用户看得见的改动，就在 RELEASES 最前面那一版里加一条（短句、中文、不写技术词）；
  // 发新版本时在最前面加一整版，并把 current 换过去。旧版本不改。版本号以 package.json 为准（测试里核对）。
  // 1.4.126 之前的更新记录没有保留，所以只从这一版开始写。
  const RELEASES=[
    {version:'1.4.126',date:'2026-10-09',current:true,groups:[
      {title:'外观',items:[
        '换上新的应用图标（美金投币口），顶栏左上角也有了图标。',
        '顶栏去掉“Lai”字样，“来财”字标更圆润。',
        '点顶栏的版本号，可以查看版本更新历史。',
        '界面默认配色改为粉色；设置里每个配色都有预览小图，可选粉色、橙色、小满。',
        '左侧菜单选中后变成玫红色药丸，图标和文字都在里面。',
        '弹窗、悬停、菜单切换的动效统一，按钮按下有轻微缩放，表格里的数字对得更齐。',
        '点弹窗外面会自动关闭；表单、新建客户、导入等正在填写的弹窗不会，避免填到一半丢了。',
        '提示条淡入时带一点模糊和缩放，收起更快；新建客户里的开关拨动时有轻微回弹。'
      ]},
      {title:'速度',items:[
        '客户很多时（上万）打开客户详情、保存跟进快了十倍以上，一次能保存的数据也大了四倍。'
      ]},
      {title:'功能',items:[
        '新增线索：线索列表、跟进、转为客户、线索回收站。',
        '客户设置新增客户分组、客户阶段、客户类型、建档黑名单、客户上限、查重展示。',
        '客户设置新增公海管理、客户跟进规则、客户成交规则、动态设置、写跟进设置。',
        '客户设置新增判重设置和来源设置。',
        '交易里新增“产品”：产品列表，以及产品分组、产品字段、规格管理。',
        '交易里新增“单据模板”：报价单、形式发票、销售订单、发货通知，可以改标题、列、条款、落款，右边实时预览，能打印或存成 PDF；公司和银行信息在“公司信息”里填一次，所有单据共用。',
        '订单可以从产品库选产品，填数量和单价，订单金额自动合计；在订单里点一下就能生成报价单、形式发票、销售订单、发货通知，预览后打印或存成 PDF。',
        '日期和月份选择改成统一的中文日历，每周从周一开始。',
        '商机新增详情抽屉：点商机名称就能看到金额、产品、阶段记录和附件。',
        '商机可以上传、预览、改名、删除附件（单个不超过 20 MB），备份时会一起保存。',
        '商机卡片拖动更顺手：可以手动排序，拖错了能撤销，键盘也能移动。'
      ]}
    ]}
  ];
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // 弹窗内容：每个版本一块，当前版本带“当前版本”标记。
  function render(releases=RELEASES){
    const blocks=releases.map(r=>{
      const groups=r.groups.map(g=>`<h4>${esc(g.title)}</h4><ul>${g.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`).join('');
      return `<section class="changelog-release"><header><h3>v${esc(r.version)}</h3><time datetime="${esc(r.date)}">${esc(r.date)}</time>${r.current?'<span class="changelog-current">当前版本</span>':''}</header>${groups}</section>`;
    }).join('');
    return `<div class="drawer-body changelog">${blocks}<p class="changelog-note muted tiny">更早的版本记录没有保留。</p></div>`;
  }
  const api=Object.freeze({RELEASES,render});
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.LaiChangelog=api;
})(typeof window!=='undefined'?window:globalThis);
