(function(root){
  'use strict';
  // 单据模板（报价单、形式发票 PI、销售订单、发货通知）。纯函数：输入 state，返回新的 state，不碰界面，也不自己保存。
  // 设置存在 state.laiSettings.docTemplates：公司信息、收款银行、每种单据的标题／条款／落款／要显示的列、编号规则（numbering）和编号计数（counters）。
  // 已保存的单据在 state.laiDocuments（新的在前，最多 5000 条）；保存时带一份当时排好的内容（snapshot），以后改模板也不影响旧单据。
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

  // ---------- 编号规则 ----------
  // 每种单据一条规则：前缀、日期部分、序号位数、序号几时从 1 重新数。分隔符固定是“-”。
  const PREFIXES=Object.freeze({quote:'QT',pi:'PI',order:'SO',shipping:'DN'});
  const DATE_MODES=Object.freeze([['none','无'],['year','年 YYYY'],['month','年月 YYYYMM'],['day','年月日 YYYYMMDD']].map(item=>Object.freeze(item)));
  const RESETS=Object.freeze([['','跟日期部分一致'],['day','每天'],['month','每月'],['year','每年'],['never','不重置']].map(item=>Object.freeze(item)));
  const DIGITS=Object.freeze({min:3,max:6});
  const LIMIT_DOCS=5000;
  // 数字越大，周期越长。重置周期不能比日期部分短，否则同一个日期里会出现两张一样的编号。
  const SPAN={day:1,month:2,year:3,none:4,never:4};
  const DATE_RESET={none:'never',year:'year',month:'month',day:'day'};
  const defaultRule=type=>({prefix:PREFIXES[type]||'DOC',dateMode:'day',digits:3,reset:''});
  const resetOf=rule=>rule.reset||DATE_RESET[rule.dateMode];
  function checkRule(input,type){
    const base=defaultRule(type),one=input&&typeof input==='object'?input:{};
    const prefix=one.prefix===undefined?base.prefix:trim(one.prefix);
    if(!/^[A-Za-z0-9-]{1,10}$/.test(prefix))throw new Error('前缀要填 1 到 10 个字符，只能用字母、数字和横线');
    const dateMode=one.dateMode===undefined?base.dateMode:trim(one.dateMode);
    if(!DATE_MODES.some(item=>item[0]===dateMode))throw new Error('日期部分请从列表里选');
    const digits=one.digits===undefined?base.digits:Number(one.digits);
    if(!Number.isInteger(digits)||digits<DIGITS.min||digits>DIGITS.max)throw new Error(`序号位数请选 ${DIGITS.min} 到 ${DIGITS.max} 位`);
    const reset=one.reset===undefined?base.reset:trim(one.reset);
    if(!RESETS.some(item=>item[0]===reset))throw new Error('重置方式请从列表里选');
    const rule={prefix,dateMode,digits,reset};
    if(dateMode==='none'&&resetOf(rule)!=='never')throw new Error('没有日期部分时，序号只能选“不重置”');
    if(SPAN[resetOf(rule)]<SPAN[dateMode])throw new Error('重置方式不能比日期部分更细，否则会出现重复的编号');
    return rule;
  }
  function readRule(type,stored){
    try{return checkRule(stored,type);}catch(error){return defaultRule(type);}
  }
  const readCounter=stored=>stored&&typeof stored==='object'&&Number.isInteger(stored.seq)&&stored.seq>=0?{period:trim(stored.period),sig:trim(stored.sig),seq:stored.seq}:null;
  const dateParts=date=>{
    const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(trim(date));
    if(!m)throw new Error('日期格式不对');
    return {y:m[1],m:m[2],d:m[3]};
  };
  const datePart=(rule,date)=>{const {y,m,d}=dateParts(date);return rule.dateMode==='year'?y:rule.dateMode==='month'?y+m:rule.dateMode==='day'?y+m+d:'';};
  const periodKey=(rule,date)=>{const {y,m,d}=dateParts(date),reset=resetOf(rule);return reset==='year'?y:reset==='month'?y+m:reset==='day'?y+m+d:'all';};
  const ruleSig=rule=>`${rule.prefix}|${rule.dateMode}|${rule.digits}`;
  const formatNumber=(rule,date,seq)=>[rule.prefix,datePart(rule,date),String(seq).padStart(rule.digits,'0')].filter(Boolean).join('-');
  const cache=new WeakMap(),MISSING={};
  function settings(state){
    const stored=state&&state.laiSettings&&state.laiSettings.docTemplates;
    const key=stored&&typeof stored==='object'?stored:MISSING;
    let hit=cache.get(key);
    if(!hit){
      const raw=key===MISSING?{}:key,templates={};
      for(const type of TYPE_IDS)templates[type]=readTemplate(type,raw.templates&&raw.templates[type]);
      const numbering={},counters={};
      for(const type of TYPE_IDS){numbering[type]=readRule(type,raw.numbering&&raw.numbering[type]);counters[type]=readCounter(raw.counters&&raw.counters[type]);}
      hit={company:readGroup(COMPANY_FIELDS,raw.company),bank:readGroup(BANK_FIELDS,raw.bank),templates,numbering,counters};
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

  function setNumbering(state,type,input={}){
    assertType(type);
    const rule=checkRule({...settings(state).numbering[type],...input},type);
    return put(state,{numbering:{...settings(state).numbering,[type]:rule}});
  }
  // ---------- 单据记录 ----------
  const documents=state=>{
    const stored=state&&state.laiDocuments;
    if(stored===undefined||stored===null)return [];
    if(!Array.isArray(stored))throw new Error('已保存的单据记录格式异常，为避免覆盖，未做任何修改');
    return stored;
  };
  const docList=state=>{try{return documents(state);}catch(error){return [];}};
  // 下一张单据的编号：同一周期里接着数；规则改了就从 1 重新数；绝不和已有的编号重复（作废的也算）。
  // rule 可以传一份还没保存的规则，用来在改规则时显示示例。
  function nextNumber(state,type,date,rule){
    assertType(type);
    const s=settings(state),use=rule?checkRule(rule,type):s.numbering[type];
    const period=periodKey(use,date),sig=ruleSig(use),docs=docList(state);
    const counter=s.counters[type];
    let seq=counter&&counter.period===period&&counter.sig===sig?counter.seq:0;
    const taken=new Set();
    for(const doc of docs){
      if(!doc||typeof doc!=='object')continue;
      taken.add(doc.number);
      if(doc.type===type&&doc.period===period&&doc.sig===sig&&Number.isInteger(doc.seq))seq=Math.max(seq,doc.seq);
    }
    seq+=1;
    while(taken.has(formatNumber(use,date,seq)))seq+=1;
    return {number:formatNumber(use,date,seq),seq,period,sig,rule:use};
  }
  const cleanLines=lines=>(Array.isArray(lines)?lines:[]).filter(item=>item&&typeof item==='object'&&trim(item.name)).map(item=>({code:trim(item.code),name:trim(item.name),model:trim(item.model),unit:trim(item.unit),qty:number(item.qty),price:number(item.price)}));
  // input：{type, today（决定编号里的日期）, date（单据日期）, client, currency, lines, source:{kind,id,label}, reference:{label,value}}。
  // 返回 {state, doc}：state 里多了这张单据，并记下编号计数。
  function saveDocument(state,input={}){
    const {type}=input;
    assertType(type);
    const docs=documents(state);
    if(docs.length>=LIMIT_DOCS)throw new Error(`单据记录最多 ${LIMIT_DOCS} 条，已经满了`);
    const client=trim(input.client);
    if(!client)throw new Error('请先填写客户名称，再保存单据');
    const lines=cleanLines(input.lines);
    if(!lines.length)throw new Error('请先添加产品，再保存单据');
    const today=trim(input.today)||trim(input.date);
    const next=nextNumber(state,type,today);
    const source=input.source&&typeof input.source==='object'?{kind:input.source.kind==='opportunity'?'opportunity':'order',id:trim(input.source.id),label:trim(input.source.label)}:{kind:'',id:'',label:''};
    const currency=trim(input.currency)||'USD';
    const date=trim(input.date)||today;
    const snapshot=preview(state,type,{lines,currency,client,number:next.number,date,reference:input.reference});
    const doc={
      id:trim(input.id)||globalThis.crypto.randomUUID(),type,number:next.number,seq:next.seq,period:next.period,sig:next.sig,date,client,currency,lines,
      total:number(snapshot.total),source,status:'有效',createdAt:trim(input.now)||new Date().toISOString(),snapshot,
    };
    const counters={...settings(state).counters,[type]:{period:next.period,sig:next.sig,seq:next.seq}};
    const saved=put(state,{counters});
    return {state:{...saved,laiDocuments:[doc,...docs]},doc};
  }
  function voidDocument(state,id,now){
    const docs=documents(state),doc=docs.find(item=>item&&item.id===id);
    if(!doc)throw new Error('找不到这张单据');
    if(doc.status==='已作废')throw new Error('这张单据已经作废了');
    return {...state,laiDocuments:docs.map(item=>item===doc?{...doc,status:'已作废',voidedAt:trim(now)||new Date().toISOString()}:item)};
  }
  const getDocument=(state,id)=>docList(state).find(item=>item&&item.id===id)||null;
  // 某张订单／某个商机已经保存的单据，新的在前。
  const docsFor=(state,source)=>docList(state).filter(item=>item&&item.source&&source&&item.source.kind===source.kind&&item.source.id===source.id&&item.source.id);
  // 单据属于谁：看来源订单／商机的跟进人；来源找不到（已彻底删除等）就看客户资料里的跟进人。
  function ownerOfDocument(state,doc){
    const source=doc&&doc.source&&typeof doc.source==='object'?doc.source:{};
    const find=list=>Array.isArray(list)?list.find(item=>item&&item.id===source.id):null;
    const item=source.id?(source.kind==='opportunity'?find(state&&state.laiOpportunities):(find(state&&state.orders)||find(state&&state.trashOrders))):null;
    if(item)return trim(item.owner);
    const profiles=state&&state.customers&&typeof state.customers==='object'?state.customers:{};
    return doc&&Object.hasOwn(profiles,doc.client)&&profiles[doc.client]?trim(profiles[doc.client].owner):'';
  }
  // 当前账号看得到的单据编号：sees(owner) 由角色范围决定（全公司账号不用调这个）。
  const visibleDocumentIds=(state,sees)=>docList(state).filter(item=>item&&sees(ownerOfDocument(state,item))).map(item=>item.id);
  // 单据记录页的列表：按类型和关键词（编号、客户）筛选。state.laiVisibleDocIds（只用来画页面，不保存）有值时，只列这些单据。
  function listDocuments(state,{type='',query=''}={}){
    const q=trim(query).toLowerCase(),only=Array.isArray(state&&state.laiVisibleDocIds)?new Set(state.laiVisibleDocIds):null;
    return docList(state).filter(item=>item&&(!only||only.has(item.id))&&(!type||item.type===type)&&(!q||[item.number,item.client].some(v=>String(v||'').toLowerCase().includes(q))));
  }
  // 商机生成单据用的明细：关联产品逐行列出（名称在产品库里有同名产品就带上编号、型号、单位）；没有关联产品就用商机本身一行。hideProducts（当前账号看不到“关联产品”）时同样不列产品，只用商机本身一行。
  function linesFromOpportunity(state,opp,{hideProducts=false}={}){
    const library=Array.isArray(state&&state.laiProducts)?state.laiProducts:[];
    const rows=(!hideProducts&&Array.isArray(opp&&opp.products)?opp.products:[]).filter(row=>row&&typeof row==='object'&&trim(row.name));
    if(!rows.length)return [{code:'',name:trim(opp&&opp.name)||'商机',model:'',unit:'',qty:1,price:number(opp&&opp.amount)}];
    return rows.map(row=>{
      const name=trim(row.name),hit=library.find(p=>p&&trim(p.name).toLowerCase()===name.toLowerCase());
      return {code:trim(hit&&hit.code),name,model:trim(hit&&hit.model),unit:trim(hit&&hit.unit),qty:number(row.quantity??1),price:number(row.unitPrice??0)};
    });
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
  function preview(state,type,{lines,currency='USD',client='Sample Customer Co.',number:docNumber='DEMO-0001',date='',numberNote='',reference=null}={}){
    assertType(type);
    const s=settings(state),t=s.templates[type];
    const columns=COLUMNS.filter(([key])=>t.columns[key]);
    const rows=(lines||sampleLines(state)).map(item=>({...item,amount:number(item.qty)*number(item.price)}));
    const total=rows.reduce((sum,item)=>sum+item.amount,0);
    const bankLines=BANK_FIELDS.map(([key,label])=>[label,s.bank[key]]).filter(([,value])=>value);
    return {
      type,typeName:typeName(type),title:t.title,subtitle:(TYPES.find(item=>item[0]===type)||[])[2],
      company:s.company,client:trim(client),number:trim(docNumber),numberNote:trim(numberNote),reference:reference&&trim(reference.value)?{label:trim(reference.label)||'订单号',value:trim(reference.value)}:null,date:trim(date),currency,
      columns,rows,total:money(total),terms:t.terms.split('\n').map(trim).filter(Boolean),footer:t.footer,
      bank:t.showBank?bankLines:[],showSignature:t.showSignature,
    };
  }
  const api={LIMITS,ownerOfDocument,visibleDocumentIds,TYPES,COLUMNS,FIXED_COLUMNS,COMPANY_FIELDS,BANK_FIELDS,DATE_MODES,RESETS,DIGITS,LIMIT_DOCS,settings,setCompany,setBank,setTemplate,resetTemplate,setNumbering,checkRule,formatNumber,nextNumber,saveDocument,voidDocument,getDocument,docsFor,listDocuments,linesFromOpportunity,sampleLines,preview,money};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiDocTemplateModel=api;
})(typeof window!=='undefined'?window:globalThis);
