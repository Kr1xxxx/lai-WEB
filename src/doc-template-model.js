(function(root){
  'use strict';
  // 单据模板（报价单、形式发票 PI、销售订单、发货通知）。纯函数：输入 state，返回新的 state，不碰界面，也不自己保存。
  // 设置存在 state.laiSettings.docTemplates：公司信息、收款银行、每种单据的标题／条款／落款／要显示的列。
  const trim=value=>String(value??'').trim();
  const LIMITS=Object.freeze({title:40,line:200,text:2000});
  const TYPES=Object.freeze([
    ['quote','报价单','QUOTATION'],['pi','形式发票','PROFORMA INVOICE'],['order','销售订单','SALES ORDER'],['shipping','发货通知','SHIPPING NOTICE'],
  ].map(item=>Object.freeze(item)));
  const TYPE_IDS=TYPES.map(item=>item[0]);
  // [key, 列名]。产品名称和数量一定显示。
  const COLUMNS=Object.freeze([['code','产品编号'],['name','产品名称'],['model','型号'],['unit','单位'],['qty','数量'],['price','单价'],['amount','金额']].map(item=>Object.freeze(item)));
  const FIXED_COLUMNS=Object.freeze(['name','qty']);
  const COMPANY_FIELDS=Object.freeze([['name','公司名称'],['address','公司地址'],['phone','电话'],['email','邮箱'],['website','网址']]);
  const BANK_FIELDS=Object.freeze([['accountName','户名'],['bank','开户银行'],['account','银行账号'],['swift','SWIFT 代码'],['address','银行地址']]);
  const DEFAULT_TERMS=Object.freeze({
    quote:'报价有效期 30 天。\n价格不含运费和税费，以实际下单为准。',
    pi:'付款方式：T/T，下单前预付 30%，发货前付清余款。\n交货期：收到预付款后 15–20 个工作日。',
    order:'请核对订单信息。如有问题，请在收到后 3 天内告知我们。',
    shipping:'货物已备好，请确认收货地址和联系人。',
  });
  const DEFAULT_FOOTER=Object.freeze({quote:'谢谢您的询价。',pi:'谢谢您的订单。',order:'谢谢您的订单。',shipping:'谢谢您的支持。'});

  const clip=(value,max,label)=>{
    const text=trim(value).replace(/\r\n/g,'\n');
    if(text.length>max)throw new Error(`${label}最长 ${max} 个字`);
    return text;
  };
  const line=(value,label)=>clip(value,LIMITS.line,label).replace(/\s*\n\s*/g,' ');
  function defaultTemplate(type){
    const columns={};
    for(const [key] of COLUMNS)columns[key]=true;
    columns.model=false;
    return {title:(TYPES.find(t=>t[0]===type)||TYPES[0])[1],terms:DEFAULT_TERMS[type]||'',footer:DEFAULT_FOOTER[type]||'',columns,showBank:type==='pi'||type==='quote',showSignature:type!=='shipping'};
  }
  function readTemplate(type,stored){
    const base=defaultTemplate(type),one=stored&&typeof stored==='object'?stored:{};
    const columns={};
    for(const [key] of COLUMNS)columns[key]=FIXED_COLUMNS.includes(key)||(one.columns&&typeof one.columns==='object'&&key in one.columns?one.columns[key]===true:base.columns[key]);
    return {
      title:trim(one.title)||base.title,
      terms:typeof one.terms==='string'?one.terms:base.terms,
      footer:typeof one.footer==='string'?one.footer:base.footer,
      columns,
      showBank:typeof one.showBank==='boolean'?one.showBank:base.showBank,
      showSignature:typeof one.showSignature==='boolean'?one.showSignature:base.showSignature,
    };
  }
  const readGroup=(fields,stored)=>{
    const out={};
    for(const [key] of fields)out[key]=trim(stored&&stored[key]).slice(0,LIMITS.line);
    return out;
  };
  const cache=new WeakMap(),MISSING={};
  function settings(state){
    const stored=state&&state.laiSettings&&state.laiSettings.docTemplates;
    const key=stored&&typeof stored==='object'?stored:MISSING;
    let hit=cache.get(key);
    if(!hit){
      const raw=key===MISSING?{}:key,templates={};
      for(const type of TYPE_IDS)templates[type]=readTemplate(type,raw.templates&&raw.templates[type]);
      hit={company:readGroup(COMPANY_FIELDS,raw.company),bank:readGroup(BANK_FIELDS,raw.bank),templates};
      cache.set(key,hit);
    }
    return hit;
  }
  const put=(state,patch)=>({...state,laiSettings:{...(state.laiSettings||{}),docTemplates:{...settings(state),...patch}}});
  const typeName=type=>(TYPES.find(t=>t[0]===type)||[])[1];
  function assertType(type){
    if(!TYPE_IDS.includes(type))throw new Error('没有这种单据');
  }
  // ---------- 修改 ----------
  function setCompany(state,input){
    const next={};
    for(const [key,label] of COMPANY_FIELDS)next[key]=line(input&&input[key],label);
    return put(state,{company:next});
  }
  function setBank(state,input){
    const next={};
    for(const [key,label] of BANK_FIELDS)next[key]=line(input&&input[key],label);
    return put(state,{bank:next});
  }
  // input：{title, terms, footer, columns:{key:bool}, showBank, showSignature}，没给的保持原样。
  function setTemplate(state,type,input={}){
    assertType(type);
    const old=settings(state).templates[type];
    const title=input.title===undefined?old.title:trim(input.title);
    if(!title)throw new Error('请填写单据标题');
    if(title.length>LIMITS.title)throw new Error(`单据标题最长 ${LIMITS.title} 个字`);
    const columns={...old.columns};
    if(input.columns)for(const [key] of COLUMNS)if(key in input.columns&&!FIXED_COLUMNS.includes(key))columns[key]=!!input.columns[key];
    const next={
      title,
      terms:input.terms===undefined?old.terms:clip(input.terms,LIMITS.text,'条款'),
      footer:input.footer===undefined?old.footer:line(input.footer,'落款'),
      columns,
      showBank:input.showBank===undefined?old.showBank:!!input.showBank,
      showSignature:input.showSignature===undefined?old.showSignature:!!input.showSignature,
    };
    return put(state,{templates:{...settings(state).templates,[type]:next}});
  }
  function resetTemplate(state,type){
    assertType(type);
    return put(state,{templates:{...settings(state).templates,[type]:defaultTemplate(type)}});
  }
  // ---------- 预览 ----------
  const number=value=>{const n=Number(String(value??'').replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:0;};
  const SAMPLE_LINES=Object.freeze([
    {code:'A-001',name:'示例产品 A',model:'M1',unit:'盒',qty:100,price:2.5},
    {code:'B-002',name:'示例产品 B',model:'M2',unit:'件',qty:50,price:6},
  ]);
  // 预览用的明细：有产品时取前 3 个产品（数量 100，单价取离岸价），没有就用示例。
  function sampleLines(state){
    const products=Array.isArray(state&&state.laiProducts)?state.laiProducts:[];
    if(!products.length)return SAMPLE_LINES.map(item=>({...item}));
    return products.slice(0,3).map(p=>({code:trim(p.code),name:trim(p.name),model:trim(p.model),unit:trim(p.unit),qty:100,price:number(p.fob)}));
  }
  const money=value=>(Math.round(value*100)/100).toFixed(2);
  // 返回渲染单据需要的全部内容：标题、公司、列、行、合计、条款、银行、落款。UI 只管把它排成版面。
  function preview(state,type,{lines,currency='USD',client='Sample Customer Co.',number:docNumber='DEMO-0001',date=''}={}){
    assertType(type);
    const s=settings(state),t=s.templates[type];
    const columns=COLUMNS.filter(([key])=>t.columns[key]);
    const rows=(lines||sampleLines(state)).map(item=>({...item,amount:number(item.qty)*number(item.price)}));
    const total=rows.reduce((sum,item)=>sum+item.amount,0);
    const bankLines=BANK_FIELDS.map(([key,label])=>[label,s.bank[key]]).filter(([,value])=>value);
    return {
      type,typeName:typeName(type),title:t.title,subtitle:(TYPES.find(item=>item[0]===type)||[])[2],
      company:s.company,client:trim(client),number:trim(docNumber),date:trim(date),currency,
      columns,rows,total:money(total),terms:t.terms.split('\n').map(trim).filter(Boolean),footer:t.footer,
      bank:t.showBank?bankLines:[],showSignature:t.showSignature,
    };
  }
  const api={LIMITS,TYPES,COLUMNS,FIXED_COLUMNS,COMPANY_FIELDS,BANK_FIELDS,settings,setCompany,setBank,setTemplate,resetTemplate,sampleLines,preview,money};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiDocTemplateModel=api;
})(typeof window!=='undefined'?window:globalThis);
