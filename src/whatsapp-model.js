(function(root){
  'use strict';
  // 沟通（WhatsApp）的纯逻辑：电话号码转国际格式、wa.me 链接、聊天模板、解析 WhatsApp「导出聊天」文件、
  // 把聊天记到客户动态（history）里、导入记录与撤销、按电话和名字找客户。没有页面代码，也不依赖别的文件。
  // 动态里的聊天条目：{type:'chat',subtype:'whatsapp'|'whatsappgroup',channel:'WhatsApp',time,owner,contact,text,
  //   chatRef:{src,importId,peer,day},lastSentAt,lastReceivedAt,lines:[{at,from,dir:'in'|'out',text,key}]}
  const node=typeof module!=='undefined'&&module.exports;

  const LIMITS=Object.freeze({
    entryLines:2000,        // 一条动态最多放多少行聊天（超过会拆成几条）
    lineChars:4000,         // 每行聊天最多多少字（超过会截断）
    importLines:20000,      // 一次导入最多多少行
    importChars:3*1024*1024,// 一次导入的文本最多 3 MB
    customerChars:1024*1024,// 一位客户的聊天文本最多 1 MB
    importLog:200,          // 导入记录最多保留多少行
    templateGroups:30,templateItems:100,templateChars:500
  });

  const trim=value=>String(value??'').trim();
  const nameKey=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  const arr=value=>Array.isArray(value)?value:[];
  const isObj=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const pad=number=>String(number).padStart(2,'0');
  // 看不见的方向标记（iOS 导出里很多）和 BOM
  const INVISIBLE=/[‎‏‪-‮⁦-⁩﻿]/g;

  // ---------- 国家区号 ----------
  const DIAL_TEXT=`AD 376,AE 971,AF 93,AG 1,AI 1,AL 355,AM 374,AO 244,AR 54,AS 1,AT 43,AU 61,AW 297,AX 358,AZ 994,BA 387,BB 1,BD 880,BE 32,BF 226,BG 359,BH 973,BI 257,BJ 229,BL 590,BM 1,BN 673,BO 591,BQ 599,BR 55,BS 1,BT 975,BW 267,BY 375,BZ 501,
CA 1,CC 61,CD 243,CF 236,CG 242,CH 41,CI 225,CK 682,CL 56,CM 237,CN 86,CO 57,CR 506,CU 53,CV 238,CW 599,CX 61,CY 357,CZ 420,DE 49,DJ 253,DK 45,DM 1,DO 1,DZ 213,EC 593,EE 372,EG 20,EH 212,ER 291,ES 34,ET 251,FI 358,FJ 679,FK 500,FM 691,FO 298,FR 33,
GA 241,GB 44,GD 1,GE 995,GF 594,GG 44,GH 233,GI 350,GL 299,GM 220,GN 224,GP 590,GQ 240,GR 30,GT 502,GU 1,GW 245,GY 592,HK 852,HN 504,HR 385,HT 509,HU 36,ID 62,IE 353,IL 972,IM 44,IN 91,IO 246,IQ 964,IR 98,IS 354,IT 39,JE 44,JM 1,JO 962,JP 81,
KE 254,KG 996,KH 855,KI 686,KM 269,KN 1,KP 850,KR 82,KW 965,KY 1,KZ 7,LA 856,LB 961,LC 1,LI 423,LK 94,LR 231,LS 266,LT 370,LU 352,LV 371,LY 218,MA 212,MC 377,MD 373,ME 382,MF 590,MG 261,MH 692,MK 389,ML 223,MM 95,MN 976,MO 853,MP 1,MQ 596,MR 222,MS 1,MT 356,MU 230,MV 960,MW 265,MX 52,MY 60,MZ 258,
NA 264,NC 687,NE 227,NF 672,NG 234,NI 505,NL 31,NO 47,NP 977,NR 674,NU 683,NZ 64,OM 968,PA 507,PE 51,PF 689,PG 675,PH 63,PK 92,PL 48,PM 508,PR 1,PS 970,PT 351,PW 680,PY 595,QA 974,RE 262,RO 40,RS 381,RU 7,RW 250,
SA 966,SB 677,SC 248,SD 249,SE 46,SG 65,SH 290,SI 386,SJ 47,SK 421,SL 232,SM 378,SN 221,SO 252,SR 597,SS 211,ST 239,SV 503,SX 1,SY 963,SZ 268,TC 1,TD 235,TG 228,TH 66,TJ 992,TK 690,TL 670,TM 993,TN 216,TO 676,TR 90,TT 1,TV 688,TW 886,TZ 255,
UA 380,UG 256,US 1,UY 598,UZ 998,VA 39,VC 1,VE 58,VG 1,VI 1,VN 84,VU 678,WF 681,WS 685,XK 383,YE 967,YT 262,ZA 27,ZM 260,ZW 263`;
  // ISO 3166 两位代码 → 国际区号（只有数字，不带加号）。北美一带的国家共用 1。
  const DIAL_CODES=Object.freeze(Object.fromEntries(DIAL_TEXT.split(',').map(pair=>pair.trim().split(' '))));

  // 常见的写法别名（中文、英文）。其余的名字用浏览器自带的国家名表（Intl.DisplayNames）补全。
  const COUNTRY_ALIASES={
    usa:'US',america:'US',unitedstatesofamerica:'US',美国:'US',美利坚合众国:'US',uk:'GB',england:'GB',britain:'GB',greatbritain:'GB',unitedkingdom:'GB',英国:'GB',
    uae:'AE',阿联酋:'AE',阿拉伯联合酋长国:'AE',southkorea:'KR',korea:'KR',韩国:'KR',russia:'RU',俄罗斯:'RU',vietnam:'VN',越南:'VN',turkey:'TR',turkiye:'TR',土耳其:'TR',
    中国:'CN',中国大陆:'CN',内地:'CN',china:'CN',中国香港:'HK',香港:'HK',hongkong:'HK',中国澳门:'MO',澳门:'MO',macau:'MO',中国台湾:'TW',台湾:'TW',taiwan:'TW',
    czechrepublic:'CZ',捷克:'CZ',ivorycoast:'CI',holland:'NL',荷兰:'NL',burma:'MM',缅甸:'MM',德国:'DE',法国:'FR',日本:'JP',新加坡:'SG',澳大利亚:'AU',澳洲:'AU',
    加拿大:'CA',印度:'IN',意大利:'IT',西班牙:'ES',波兰:'PL',巴西:'BR',墨西哥:'MX',沙特:'SA',沙特阿拉伯:'SA',泰国:'TH',马来西亚:'MY',印度尼西亚:'ID',印尼:'ID',菲律宾:'PH'
  };
  let countryMap=null;
  const countryKey=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s.\-_'’·()（）]/g,'');
  function buildCountryMap(){
    const map=new Map();
    try{
      const en=new Intl.DisplayNames(['en'],{type:'region'}),zh=new Intl.DisplayNames(['zh-CN'],{type:'region'});
      for(const iso of Object.keys(DIAL_CODES))for(const name of [en.of(iso),zh.of(iso)])if(name&&name!==iso)map.set(countryKey(name),iso);
    }catch{/* 没有国家名表时，只认别名和代码 */}
    for(const [alias,iso] of Object.entries(COUNTRY_ALIASES))map.set(countryKey(alias),iso);
    return map;
  }
  // 国家写法（🇬🇧 英国、英国、United Kingdom、GB、旗帜表情）→ ISO 代码；认不出返回 ''。
  function countryIso(value){
    const text=String(value??'').trim();
    if(!text)return '';
    const flag=text.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0];
    if(flag){
      const iso=[...flag].map(ch=>String.fromCharCode(ch.codePointAt(0)-0x1f1e6+65)).join('');
      if(DIAL_CODES[iso])return iso;
    }
    const clean=text.replace(/[\u{1F1E6}-\u{1F1FF}]/gu,'').trim();
    if(/^[A-Za-z]{2}$/.test(clean)&&DIAL_CODES[clean.toUpperCase()]&&!COUNTRY_ALIASES[countryKey(clean)])return clean.toUpperCase();
    countryMap??=buildCountryMap();
    const direct=countryMap.get(countryKey(clean));
    if(direct)return direct;
    // 「英国(UK)」「United Kingdom（英国）」这类：分别试括号里外
    for(const part of [clean.replace(/[（(].*?[）)]/g,''),...[...clean.matchAll(/[（(]([^）)]+)[）)]/g)].map(m=>m[1]),(clean.match(/[㐀-鿿]+/)||[''])[0]]){
      const hit=part&&countryMap.get(countryKey(part));
      if(hit)return hit;
    }
    return '';
  }
  // 国家 → 区号数字，如「英国」→「44」；认不出返回 ''。
  const dialCodeOf=country=>DIAL_CODES[countryIso(country)]||'';
  // 给下拉框用：[{iso,code:'+44',zh,en,flag}]，按中文名排序。
  function dialOptions(){
    let en=null,zh=null;
    try{en=new Intl.DisplayNames(['en'],{type:'region'});zh=new Intl.DisplayNames(['zh-CN'],{type:'region'});}catch{/* 用代码当名字 */}
    return Object.keys(DIAL_CODES).map(iso=>({iso,code:'+'+DIAL_CODES[iso],zh:zh?.of(iso)||iso,en:en?.of(iso)||iso,
      flag:[...iso].map(ch=>String.fromCodePoint(ch.charCodeAt(0)+127397)).join('')})).sort((a,b)=>a.zh.localeCompare(b.zh,'zh'));
  }

  // ---------- 电话 ----------
  // 任何写法的电话 → '+国家区号号码'（8 到 15 位数字）；认不出返回 null。
  // 顺序：带 + 的直接用；00 开头换成 +；否则用联系人自己的区号 code，再用客户国家 country 的区号。
  // 国内号码前面的一个 0（长途冠码）去掉，意大利除外；俄罗斯、哈萨克斯坦的 8 也去掉。
  function toE164(raw,opts={}){
    let text=String(raw??'').normalize('NFKC').replace(INVISIBLE,'').trim();
    if(!text)return null;
    text=text.replace(/\s*(?:ext\.?|extension|x|转|分机)\s*\d+\s*$/i,'');
    if(/[A-Za-z㐀-鿿]/.test(text))return null;
    let full;
    if(/^[\s(]*\+/.test(text))full=text.replace(/\(\s*0\s*\)/g,'').replace(/\D/g,'');
    else{
      const digits=text.replace(/\D/g,'');
      if(digits.startsWith('00'))full=digits.slice(2);
      else{
        let code=trim(opts?.code).replace(/\D/g,'').replace(/^00/,'');
        if(!/^[1-9]\d{0,3}$/.test(code))code=dialCodeOf(opts?.country);
        if(!code)return null;
        let national=digits;
        if(!national.startsWith('0')&&national.startsWith(code)&&national.length-code.length>=(code==='1'?10:9))full=national;
        else{
          if(national.startsWith('0')&&code!=='39')national=national.slice(1);
          else if(code==='7'&&national.length===11&&national.startsWith('8'))national=national.slice(1);
          full=code+national;
        }
      }
    }
    return /^[1-9]\d{7,14}$/.test(full)?'+'+full:null;
  }
  // 能直接点开的 WhatsApp 链接。号码不对返回 ''。
  function waLink(e164,text){
    const digits=String(e164??'').replace(/\D/g,'');
    if(!/^[1-9]\d{7,14}$/.test(digits))return '';
    const body=String(text??'');
    return `https://wa.me/${digits}`+(body?`?text=${encodeURIComponent(body)}`:'');
  }
  const looksLikePhone=value=>/^\+[\d\s()\-.]{7,}$/.test(String(value??'').replace(INVISIBLE,'').trim());
  // 群聊里没存名字的人，发送者显示成电话号码；转成国际格式。
  const peersFromSenders=senders=>[...new Set(arr(senders).map(item=>trim(typeof item==='string'?item:item?.name)).filter(looksLikePhone).map(item=>toE164(item)).filter(Boolean))];
  // 从导出文件名里取对方名字：「WhatsApp Chat with Maria.txt」「WhatsApp 聊天 - 玛丽亚.zip」「与玛丽亚的 WhatsApp 聊天.zip」
  function chatNameFromFile(fileName){
    const base=String(fileName??'').replace(/^.*[\\/]/,'').replace(/\.(?:txt|zip)$/i,'').replace(/\s*\(\d+\)$/,'').trim();
    for(const pattern of [/^WhatsApp Chat with (.+)$/i,/^WhatsApp Chat\s*[-–—]\s*(.+)$/i,/^WhatsApp\s*聊天\s*[-–—]\s*(.+)$/,/^与\s*(.+?)\s*的\s*WhatsApp\s*聊天$/,/^和\s*(.+?)\s*的\s*WhatsApp\s*聊天$/]){
      const hit=pattern.exec(base);
      if(hit)return hit[1].trim();
    }
    return '';
  }

  // ---------- 模板 ----------
  const TEMPLATE_VARS=Object.freeze(['姓名','公司','我的名字','国家']);
  // 把 {{姓名}} {{公司}} {{我的名字}} {{国家}} 换成真实内容。没有值的变量（以及不认识的变量）原样留着，并列在 missing 里。
  function renderTemplate(text,vars={}){
    const missing=[];
    const out=String(text??'').replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(whole,name)=>{
      const value=TEMPLATE_VARS.includes(name)&&vars&&Object.hasOwn(vars,name)?trim(vars[name]):'';
      if(value)return value;
      if(!missing.includes(name))missing.push(name);
      return whole;
    });
    return {text:out,missing};
  }

  // ---------- 解析导出文件 ----------
  const hash=text=>{ // cyrb53：够短、够稳，只用来认「这一行聊天已经导入过」
    let h1=0xdeadbeef,h2=0x41c6ce57;
    for(let i=0;i<text.length;i++){const ch=text.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}
    h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
    h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
    return (4294967296*(2097151&h2)+(h1>>>0)).toString(36);
  };
  const DAYPART='上午|下午|凌晨|早上|中午|晚上|傍晚';
  const AMPM='[AaPp]\\.?\\s?[Mm]\\.?';
  const DATE_RE='(?:(?<a>\\d{1,4})(?<sep>[/.\\-])(?<b>\\d{1,2})\\k<sep>(?<c>\\d{1,4})|(?<cy>\\d{4})年(?<cm>\\d{1,2})月(?<cd>\\d{1,2})日?)';
  const TIME_RE=`(?<pre>${DAYPART}|${AMPM})?\\s*(?<h>\\d{1,2})[:.：](?<mi>\\d{2})(?:[:.：](?<s>\\d{2}))?\\s*(?<post>${DAYPART}|${AMPM})?`;
  const MARKS='[\\u200E\\u200F\\u202A-\\u202E\\uFEFF]*';
  const HEAD_ANDROID=new RegExp(`^${MARKS}${DATE_RE},?\\s*${TIME_RE}\\s+[-–—](?:\\s+(?<rest>.*))?$`,'su');
  const HEAD_IOS=new RegExp(`^${MARKS}\\[\\s*${DATE_RE},?\\s*${TIME_RE}\\s*\\](?:\\s*(?<rest>.*))?$`,'su');
  // 像是带时间的行，但上面两种都对不上：算「没认出的行」
  const HEAD_LOOSE=new RegExp(`^${MARKS}\\[?\\s*\\d{1,4}[/.\\-年]\\d{1,2}[/.\\-月]\\d{1,4}日?[,\\s]+(?:${DAYPART})?\\s*\\d{1,2}[:.：]\\d{2}`,'u');
  const SYSTEM_RE=/end-to-end encrypted|端到端加密|created (?:this )?group|创建了(?:此)?群|\badded\b|\bremoved\b|\bleft\b|\bjoined\b|changed (?:the |this |their |your )?(?:subject|group|phone|security)|security code|now an admin|管理员|已加入|已离开|已移除|添加了|更改了|删除了此群|disappearing messages|限时消息|pinned a message|invite link/i;

  const ATTACH_RE=/^<(?:attached|附件)|omitted$|已省略$/i;
  function hour24(h,pre,post){
    const part=pre||post||'';
    if(!part)return h;
    if(/^[Pp]|下午|晚上|傍晚/.test(part))return h<12?h+12:h;
    if(/^[Aa]|上午|凌晨|早上/.test(part))return h===12?0:h;
    if(part==='中午')return h<6?h+12:h;
    return h;
  }
  function parseHeader(line){
    const m=HEAD_ANDROID.exec(line)||HEAD_IOS.exec(line);
    if(!m)return null;
    const g=m.groups;
    const hour=Number(g.h),minute=Number(g.mi),second=g.s===undefined?0:Number(g.s);
    if(!Number.isFinite(hour)||hour>23||minute>59||second>59)return null;
    const head={rest:g.rest??'',hour:hour24(hour,g.pre,g.post),minute,second};
    if(g.cy!==undefined)Object.assign(head,{ymd:[Number(g.cy),Number(g.cm),Number(g.cd)]});
    else if(g.a.length>=3||Number(g.a)>31)Object.assign(head,{ymd:[Number(g.a),Number(g.b),Number(g.c)]});
    else{
      const year=Number(g.c);
      Object.assign(head,{a:Number(g.a),b:Number(g.b),year:g.c.length<=2?(year<70?2000+year:1900+year):year});
    }
    return head;
  }
  function makeDate(y,m,d,hour,minute,second){
    const date=new Date(y,m-1,d,hour,minute,second);
    if(date.getFullYear()!==y||date.getMonth()!==m-1||date.getDate()!==d||!Number.isFinite(date.getTime()))return null;
    return {date,local:`${y}-${pad(m)}-${pad(d)}T${pad(hour)}:${pad(minute)}:${pad(second)}`};
  }
  function resolveDate(head,dayFirst){
    const [y,m,d]=head.ymd||(dayFirst?[head.year,head.b,head.a]:[head.year,head.a,head.b]);
    return makeDate(y,m,d,head.hour,head.minute,head.second);
  }
  // 发送者：第一个「: 」之前的部分。发送者里不能有引号（那是系统通知里引用的群名）；太长的也不是名字。
  function splitSender(rest){
    const m=/^([^:：]{1,80}?)(?::\s|：\s?)(.*)$/su.exec(rest);
    if(!m||/[“”«»「」"]/.test(m[1]))return {from:'',text:rest};
    return {from:m[1],text:m[2]};
  }
  function parseExport(input,opts={}){
    const source=String(input??'');
    const maxChars=Number(opts.maxChars)>0?Number(opts.maxChars):LIMITS.importChars;
    if(source.length>maxChars)throw new Error(`聊天文件太大（${(source.length/1048576).toFixed(1)} MB），一次最多导入 ${+(maxChars/1048576).toFixed(1)} MB。可以先在手机上选「不带媒体」导出，或分几次导入。`);
    const tokens=[];
    let unknownLines=0;const unknownSamples=[];
    let seenHeader=false;
    for(const rawLine of source.split(/\r\n|\n|\r/)){
      const line=rawLine.replace(/[   ]/g,' ');
      const head=parseHeader(line);
      if(head){seenHeader=true;tokens.push({head,line});continue;}
      if(!line.replace(INVISIBLE,'').trim()){if(seenHeader)tokens.push({blank:true});continue;}
      if(HEAD_LOOSE.test(line)||!seenHeader){
        unknownLines++;
        if(unknownSamples.length<5)unknownSamples.push(line.replace(INVISIBLE,'').trim().slice(0,80));
        continue;
      }
      tokens.push({cont:line.replace(INVISIBLE,'')});
    }
    // 日期顺序：年份在前的最清楚；其次看有没有大于 12 的数；再看哪种读法让时间不倒退；最后用调用方给的或默认「日/月」。
    const heads=tokens.filter(token=>token.head&&!token.head.ymd).map(token=>token.head);
    const dayEvidence=heads.filter(head=>head.a>12&&head.b<=12).length,monthEvidence=heads.filter(head=>head.b>12&&head.a<=12).length;
    const chosen=typeof opts.dayFirst==='boolean'?opts.dayFirst:null;
    let dayFirst=chosen??true,ambiguousDateOrder=false;
    if(dayEvidence||monthEvidence)dayFirst=dayEvidence>=monthEvidence;
    else if(heads.length){
      const backwards=order=>{let last=-Infinity,count=0;for(const head of heads){const found=resolveDate(head,order);if(!found)return Infinity;const t=found.date.getTime();if(t<last-1000)count++;last=Math.max(last,t);}return count;};
      const dayBack=backwards(true),monthBack=backwards(false);
      if(dayBack!==monthBack)dayFirst=chosen??dayBack<monthBack;
      else ambiguousDateOrder=heads.some(head=>head.a!==head.b);
    }

    const messages=[];
    let current=null;
    const flush=()=>{if(current){current.text=current.text.replace(/\s+$/,'');messages.push(current);current=null;}};
    for(const token of tokens){
      if(token.head){
        const found=resolveDate(token.head,dayFirst);
        if(!found){ // 日期读不通：当成上一条消息的延续
          if(current)current.text+='\n'+token.line.replace(INVISIBLE,'');
          else{unknownLines++;if(unknownSamples.length<5)unknownSamples.push(token.line.replace(INVISIBLE,'').trim().slice(0,80));}
          continue;
        }
        flush();
        const {from,text}=splitSender(token.head.rest);
        const marked=/^[‎‏]/.test(text.trimStart());
        const clean=text.replace(INVISIBLE,'');
        const system=!from||(marked&&!ATTACH_RE.test(clean.trim())&&SYSTEM_RE.test(clean));
        current={at:found.date.toISOString(),local:found.local,from:system?'':from.replace(INVISIBLE,'').trim(),text:system?token.head.rest.replace(INVISIBLE,'').trim():clean};
        if(system)current.system=true;
      }else if(token.cont!==undefined){if(current)current.text+='\n'+token.cont;}
      else if(token.blank&&current)current.text+='\n';
    }
    flush();
    if(messages.length>LIMITS.importLines)throw new Error(`这份聊天有 ${messages.length} 条，一次最多导入 ${LIMITS.importLines} 条。请分几次导入。`);
    const counts=new Map();
    for(const message of messages)if(!message.system&&message.from)counts.set(message.from,(counts.get(message.from)||0)+1);
    const senders=[...counts].map(([name,count])=>({name,count}));
    const real=messages.filter(message=>!message.system),span=real.length?real:messages;
    const range=span.length?{from:span[0].at,to:span[span.length-1].at,fromDay:span[0].local.slice(0,10),toDay:span[span.length-1].local.slice(0,10)}:null;
    return {messages,senders,unknownLines,unknownSamples,ambiguousDateOrder,dayFirst,count:real.length,systemCount:messages.length-real.length,isGroup:senders.length>2,range};
  }

  // ---------- 读 zip ----------
  const u16=(bytes,at)=>bytes[at]|bytes[at+1]<<8;
  const u32=(bytes,at)=>(bytes[at]|bytes[at+1]<<8|bytes[at+2]<<16|bytes[at+3]<<24)>>>0;
  const ZIP_BAD='这个压缩包打不开。请在手机上重新导出，或解压后选择里面的 _chat.txt 文件。';
  async function inflateRaw(data,maxBytes){
    if(typeof DecompressionStream==='undefined')throw new Error('当前浏览器不能打开压缩包，请先解压，再选择里面的 _chat.txt 文件。');
    const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts=[];let size=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.length;
      if(size>maxBytes){await reader.cancel();throw new Error('压缩包里的聊天文件太大，一次最多导入 3 MB。');}
      parts.push(value);
    }
    const out=new Uint8Array(size);let at=0;
    for(const part of parts){out.set(part,at);at+=part.length;}
    return out;
  }
  // 从 WhatsApp 导出的 zip 里取出聊天文本（_chat.txt，或唯一的 .txt）。用中央目录，所以带「数据描述符」的 zip 也能读。
  async function readZip(bytes,opts={}){
    if(!(bytes instanceof Uint8Array))bytes=new Uint8Array(bytes||0);
    const maxBytes=Number(opts.maxBytes)>0?Number(opts.maxBytes):LIMITS.importChars;
    let eocd=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-22-65535);i--)if(u32(bytes,i)===0x06054b50){eocd=i;break;}
    if(eocd<0)throw new Error('这不是有效的压缩包。请选择 WhatsApp 导出的 .zip 或 .txt 文件。');
    const total=u16(bytes,eocd+10);let at=u32(bytes,eocd+16);
    if(total===0xffff||at===0xffffffff)throw new Error('这个压缩包太大或格式特殊，打不开。请解压后选择里面的 _chat.txt 文件。');
    const files=[];
    for(let n=0;n<total;n++){
      if(at+46>bytes.length||u32(bytes,at)!==0x02014b50)throw new Error(ZIP_BAD);
      const flags=u16(bytes,at+8),method=u16(bytes,at+10),packed=u32(bytes,at+20),size=u32(bytes,at+24);
      const nameLength=u16(bytes,at+28),extraLength=u16(bytes,at+30),commentLength=u16(bytes,at+32),local=u32(bytes,at+42);
      const name=new TextDecoder('utf-8').decode(bytes.subarray(at+46,at+46+nameLength));
      files.push({name,flags,method,packed,size,local});
      at+=46+nameLength+extraLength+commentLength;
    }
    const texts=files.filter(file=>/\.txt$/i.test(file.name)&&!/(^|\/)__MACOSX\//.test(file.name)&&!/(^|\/)\._/.test(file.name));
    const baseName=file=>file.name.replace(/^.*\//,'');
    const pick=texts.find(file=>baseName(file).toLowerCase()==='_chat.txt')
      ||(texts.length===1?texts[0]:texts.filter(file=>/whatsapp|聊天|chat/i.test(baseName(file))).length===1?texts.find(file=>/whatsapp|聊天|chat/i.test(baseName(file))):null);
    if(!pick)throw new Error(texts.length?'压缩包里有好几个文本文件，认不出哪个是聊天记录。请解压后选择聊天的 .txt 文件。':'压缩包里没有找到聊天文本（_chat.txt）。请确认是 WhatsApp「导出聊天」的文件。');
    if(pick.flags&1)throw new Error('这个压缩包有密码，打不开。请先解压，再选择里面的 _chat.txt 文件。');
    if(pick.size>maxBytes)throw new Error('压缩包里的聊天文件太大，一次最多导入 3 MB。');
    if(pick.local+30>bytes.length||u32(bytes,pick.local)!==0x04034b50)throw new Error(ZIP_BAD);
    const start=pick.local+30+u16(bytes,pick.local+26)+u16(bytes,pick.local+28);
    if(start+pick.packed>bytes.length)throw new Error(ZIP_BAD);
    const packed=bytes.subarray(start,start+pick.packed);
    let data;
    if(pick.method===0)data=packed;
    else if(pick.method===8){
      try{data=await inflateRaw(packed,maxBytes);}
      catch(error){if(/太大|不能打开/.test(error.message))throw error;throw new Error(ZIP_BAD);}
    }else throw new Error('这个压缩包用了不支持的压缩方式。请解压后选择里面的 _chat.txt 文件。');
    return new TextDecoder('utf-8').decode(data);
  }

  // ---------- 动态条目 ----------
  const chatLines=entry=>entry&&entry.type==='chat'&&Array.isArray(entry.lines)?entry.lines:[];
  const timeOf=value=>{const t=Date.parse(value);return Number.isFinite(t)?t:0;};
  const clip=(text,max)=>{const s=String(text??'');return s.length>max?s.slice(0,max-1)+'…':s;};
  function summary(lines){
    const sent=lines.filter(line=>line.dir==='out').length;
    const snippet=clip(lines.map(line=>line.text).join(' ').replace(/\s+/g,' ').trim(),140);
    return `WhatsApp 聊天 ${lines.length} 条（发出 ${sent}，收到 ${lines.length-sent}）${snippet?'\n'+snippet:''}`;
  }
  // 按这些行重新算条目的时间、摘要、最近发出/收到时间
  function finalize(base,lines){
    const entry={...base,lines};
    delete entry.lastSentAt;delete entry.lastReceivedAt;
    const latest=dir=>lines.filter(line=>line.dir===dir).reduce((best,line)=>!best||timeOf(line.at)>=timeOf(best)?line.at:best,'');
    entry.time=lines.reduce((best,line)=>!best||timeOf(line.at)>=timeOf(best)?line.at:best,'')||base.time;
    entry.text=summary(lines);
    const sent=latest('out'),received=latest('in');
    if(sent)entry.lastSentAt=sent;
    if(received)entry.lastReceivedAt=received;
    return entry;
  }
  const meKeys=me=>new Set((Array.isArray(me)?me:[me]).map(nameKey).filter(Boolean));
  // 把解析出的消息按天拆成动态条目（新的在前）。me 是「你」在聊天里的名字（可以是几个）。系统通知不进条目。
  function buildEntries(messages,opts={}){
    const importId=trim(opts.importId);
    if(!importId)throw new Error('缺少导入编号');
    const mine=meKeys(opts.me);
    const real=arr(messages).filter(message=>message&&!message.system&&Number.isFinite(Date.parse(message.at)));
    if(real.length>LIMITS.importLines)throw new Error(`一次最多导入 ${LIMITS.importLines} 条聊天，请分几次导入。`);
    const seen=new Map();
    const byDay=new Map();
    for(const message of real){
      const local=trim(message.local)||localString(new Date(message.at));
      const minute=local.slice(0,16),text=String(message.text??''),from=trim(message.from);
      const base=`${minute}|${from}|${text}`;
      const nth=(seen.get(base)||0)+1;seen.set(base,nth);
      const line={at:message.at,from,dir:mine.has(nameKey(from))?'out':'in',text:clip(text,LIMITS.lineChars),key:hash(`${base}|#${nth}`)};
      const day=local.slice(0,10);
      if(!byDay.has(day))byDay.set(day,[]);
      byDay.get(day).push(line);
    }
    const others=new Set(real.filter(message=>!mine.has(nameKey(message.from))).map(message=>nameKey(message.from)));
    const subtype=opts.subtype||(others.size>1?'whatsappgroup':'whatsapp');
    const entries=[];
    for(const [day,lines] of [...byDay].sort((a,b)=>a[0]<b[0]?1:-1)){
      const chunks=[];
      for(let i=0;i<lines.length;i+=LIMITS.entryLines)chunks.push(lines.slice(i,i+LIMITS.entryLines));
      for(const chunk of chunks.reverse())entries.push(finalize({type:'chat',subtype,channel:'WhatsApp',time:chunk[chunk.length-1].at,owner:trim(opts.owner),contact:trim(opts.contact),text:'',
        chatRef:{src:opts.src||'export',importId,peer:trim(opts.peer),day}},chunk));
    }
    return entries;
  }
  const localString=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

  const customerKnown=(state,name)=>typeof name==='string'&&!!name&&name!=='__proto__'&&(Object.hasOwn(state?.customers||{},name)||arr(state?.orders).some(order=>order&&order.client===name));
  function requireCustomer(state,name){
    if(!customerKnown(state,name))throw new Error('客户不存在');
    const previous=Object.hasOwn(state?.customers||{},name)?state.customers[name]:{};
    if(previous?.laiBucket==='trash')throw new Error('请先恢复回收站客户');
    return previous||{};
  }
  const laterIso=(old,time)=>Number.isFinite(Date.parse(old))&&Date.parse(old)>Date.parse(time)?old:time;
  const chatChars=history=>arr(history).reduce((sum,entry)=>sum+chatLines(entry).reduce((inner,line)=>inner+String(line?.text??'').length,0),0);
  const chatKeys=history=>new Set(arr(history).flatMap(entry=>chatLines(entry).map(line=>line&&line.key).filter(Boolean)));
  function importLog(state){
    if(state?.laiChatImports!==undefined&&state.laiChatImports!==null&&!Array.isArray(state.laiChatImports))throw new Error('已保存的聊天导入记录格式异常，为避免覆盖，未做任何修改');
    return arr(state?.laiChatImports);
  }
  // 新条目放进动态：按时间插在合适的位置，不动已有条目的顺序。
  function insertNewest(history,entry){
    const next=[...history],at=timeOf(entry.time);
    let index=next.findIndex(item=>item&&typeof item==='object'&&timeOf(item.time)<at);
    if(index<0)index=next.length;
    next.splice(index,0,entry);
    return next;
  }
  // 把一次导入的条目记到客户动态里。已经导入过的行（按 key）跳过。返回 {state,added,skipped}。
  function mergeImport(state,customerName,entries,logRow={}){
    const previous=requireCustomer(state,customerName);
    const list=arr(entries).filter(entry=>chatLines(entry).length);
    if(!list.length)throw new Error('没有可导入的聊天记录');
    const log=importLog(state);
    const importId=trim(logRow.id)||trim(list[0].chatRef?.importId);
    if(!importId)throw new Error('缺少导入编号');
    const incoming=list.reduce((sum,entry)=>sum+entry.lines.length,0);
    if(incoming>LIMITS.importLines)throw new Error(`一次最多导入 ${LIMITS.importLines} 条聊天，请分几次导入。`);
    const history=arr(previous.history),known=chatKeys(history);
    let skipped=0,added=0,history2=history;
    const kept=[];
    for(const entry of list){
      const fresh=entry.lines.filter(line=>!(line.key&&known.has(line.key)));
      skipped+=entry.lines.length-fresh.length;
      if(!fresh.length)continue;
      added+=fresh.length;
      kept.push(fresh.length===entry.lines.length?entry:finalize(entry,fresh));
    }
    if(chatChars(history)+kept.reduce((sum,entry)=>sum+chatChars([entry]),0)>LIMITS.customerChars)
      throw new Error('这位客户的聊天记录已经很多了（超过 1 MB），放不下这次导入。可以先撤销旧的导入，或只导入最近的一段。');
    for(const entry of [...kept].sort((a,b)=>timeOf(a.time)-timeOf(b.time)))history2=insertNewest(history2,entry);
    const at=trim(logRow.at)||new Date().toISOString();
    const row={id:importId,at,operator:trim(logRow.operator),customer:customerName,file:clip(trim(logRow.file),200),added,skipped,undone:false};
    const next={...state,laiChatImports:[row,...log].slice(0,LIMITS.importLog)};
    if(added)next.customers={...(state.customers||{}),[customerName]:{...previous,client:customerName,updated:laterIso(previous.updated,at),history:history2}};
    return {state:next,added,skipped};
  }
  // 这次导入现在在动态里留下了什么（给「撤销」前的提示用）。
  function importFootprint(state,importId){
    const id=trim(importId);
    const customers=[];let entries=0,lines=0;
    for(const [name,profile] of Object.entries(state?.customers||{})){
      const mine=arr(profile?.history).filter(entry=>entry&&entry.type==='chat'&&entry.chatRef?.importId===id);
      if(!mine.length)continue;
      customers.push(name);entries+=mine.length;lines+=mine.reduce((sum,entry)=>sum+chatLines(entry).length,0);
    }
    return {customers,entries,lines};
  }
  // 撤销一次导入：所有客户里带这个导入编号的条目都去掉（客户改过名也找得到）；记录标成已撤销。
  function undoImport(state,importId){
    const id=trim(importId);
    const log=importLog(state);
    const row=log.find(item=>item&&item.id===id);
    if(row&&row.undone)throw new Error('这次导入已经撤销过了');
    const print=importFootprint(state,id);
    if(!row&&!print.entries)throw new Error('找不到这次导入的记录');
    const customers={...(state.customers||{})};
    for(const name of print.customers){
      const profile=customers[name];
      customers[name]={...profile,history:arr(profile.history).filter(entry=>!(entry&&entry.type==='chat'&&entry.chatRef?.importId===id))};
    }
    return {...state,customers,laiChatImports:log.map(item=>item&&item.id===id?{...item,undone:true}:item)};
  }
  // 手动记一笔（或点了 WhatsApp 链接后记一笔）：一行、发出。
  function logChat(state,customerName,input={}){
    const previous=requireCustomer(state,customerName);
    const text=String(input.text??'').trim();
    if(!text)throw new Error('请先写下聊天内容');
    if(text.length>LIMITS.lineChars)throw new Error(`内容太长了，最多 ${LIMITS.lineChars} 个字`);
    const parsed=new Date(input.at||'');
    const when=Number.isFinite(parsed.getTime())?parsed:new Date();
    const at=when.toISOString(),owner=trim(input.owner),from=owner||'我';
    const src=input.src==='link'?'link':'manual';
    const line={at,from,dir:'out',text,key:hash(`${localString(when).slice(0,16)}|${from}|${text}|#1`)};
    if(chatChars(previous.history)+text.length>LIMITS.customerChars)throw new Error('这位客户的聊天记录已经很多了（超过 1 MB），放不下了。');
    const entry=finalize({type:'chat',subtype:'whatsapp',channel:'WhatsApp',time:at,owner,contact:trim(input.contact),text:'',
      chatRef:{src,peer:trim(input.peer),day:localString(when).slice(0,10)}},[line]);
    const now=new Date().toISOString();
    return {...state,customers:{...(state.customers||{}),[customerName]:{...previous,client:customerName,updated:laterIso(previous.updated,now),history:insertNewest(arr(previous.history),entry)}}};
  }
  // 合并两位客户时，两边动态里重复的聊天行（key 相同）只留一份。返回合并后的动态（新的在前）。
  function mergeChatHistory(historyA,historyB){
    const a=arr(historyA),known=chatKeys(a);
    const out=[...a];
    for(const entry of arr(historyB)){
      const lines=chatLines(entry);
      if(!lines.length){out.push(entry);continue;}
      const fresh=lines.filter(line=>!(line&&line.key&&known.has(line.key)));
      if(!fresh.length)continue;
      out.push(fresh.length===lines.length?entry:finalize(entry,fresh));
    }
    return out.map((entry,index)=>({entry,index})).sort((x,y)=>(timeOf(y.entry?.time)-timeOf(x.entry?.time))||(x.index-y.index)).map(item=>item.entry);
  }

  // ---------- 按电话和名字找客户 ----------
  function phoneRecords(profile){
    const out=[],country=profile.country;
    const push=(phone,code,contact)=>{if(trim(phone))out.push({phone:trim(phone),code,contact:trim(contact),country});};
    const saved=arr(profile.phones),extras=arr(profile.extraContacts).filter(isObj),legacy=arr(profile.contacts).filter(isObj);
    const contactAt=index=>index===0?(typeof profile.contacts?.[0]==='string'?profile.contacts[0]:profile.contact):(extras[index-1]?.contact||extras[index-1]?.name||(typeof profile.contacts?.[index]==='string'?profile.contacts[index]:''));
    push(saved[0]??profile.phone,profile.phoneCountryCode,contactAt(0));
    saved.slice(1).forEach((phone,i)=>push(phone,'',contactAt(i+1)));
    for(const item of arr(profile.additionalPhones))push(item?.phone,item?.phoneCountryCode,contactAt(0));
    for(const item of extras){
      const contact=item.contact||item.name;
      push(item.phone,item.phoneCountryCode,contact);
      for(const more of arr(item.additionalPhones))push(more?.phone,more?.phoneCountryCode,contact);
    }
    for(const item of legacy){
      push(item.phone,item.phoneCountryCode,item.contact||item.name);
      for(const more of arr(item.additionalPhones))push(more?.phone,more?.phoneCountryCode,item.contact||item.name);
    }
    return out;
  }
  const nationalTail=raw=>String(raw).replace(/\D/g,'').replace(/^0+/,'');
  const contactNames=profile=>[typeof profile.contacts?.[0]==='string'?profile.contacts[0]:'',profile.contact,...arr(profile.contacts).map(item=>typeof item==='string'?item:item?.contact||item?.name),
    ...arr(profile.extraContacts).map(item=>item?.contact||item?.name)].map(trim).filter(Boolean);
  function nameScore(wanted,customer,aliases,contacts){
    let best=0,why='';
    for(const want of wanted){
      if(contacts.some(item=>nameKey(item)===want)&&best<70){best=70;why='contactName';}
      if([customer,...aliases].some(item=>nameKey(item)===want)&&best<60){best=60;why='name';}
      if(best<25&&want.length>=3&&[customer,...aliases,...contacts].some(item=>{const key=nameKey(item);return key.length>=3&&(key.includes(want)||want.includes(key));})){best=25;why='nameLike';}
    }
    return {score:best,why};
  }
  // 按电话和名字找可能对应的客户（只在 visible(name) 为真的客户里找），也找线索。
  // 返回 {candidates:[{name,score,reasons,contact,phone}],leadMatches:[{id,name,contact,phone,status,score,reasons}]}。
  // 结果只是建议，要由人确认。
  function matchCustomers(state,query={},visible=()=>true){
    const peers=[...new Set(arr(query.peers).map(item=>toE164(item)).filter(Boolean))];
    const wanted=[...new Set(arr(query.names).map(nameKey).filter(Boolean))];
    const canSee=typeof visible==='function'?visible:()=>true;
    const candidates=[];
    for(const [name,profile] of Object.entries(state?.customers||{})){
      if(!isObj(profile)||profile.laiBucket==='trash'||!canSee(name))continue;
      const reasons=[];let score=0,contact='',phone='';
      for(const record of phoneRecords(profile)){
        const e164=toE164(record.phone,{code:record.code,country:record.country});
        let hit=0;
        if(e164&&peers.includes(e164))hit=100;
        else if(!e164){const tail=nationalTail(record.phone);if(tail.length>=7&&peers.some(peer=>peer.replace(/\D/g,'').endsWith(tail)))hit=70;}
        if(hit>score){score=hit;contact=record.contact;phone=record.phone;}
        if(hit&&!reasons.includes('phone'))reasons.push('phone');
      }
      const byName=nameScore(wanted,name,[profile.shortName,profile.client].filter(Boolean),contactNames(profile));
      if(byName.score){score+=byName.score;reasons.push(byName.why);}
      if(!score)continue;
      if(!contact)contact=contactNames(profile)[0]||'';
      candidates.push({name,score,reasons,contact,phone});
    }
    candidates.sort((a,b)=>b.score-a.score||String(a.name).localeCompare(String(b.name),'zh'));
    const leadSee=typeof query.leadVisible==='function'?query.leadVisible:()=>true;
    const leadMatches=[];
    for(const lead of arr(state?.laiLeads)){
      if(!isObj(lead)||!lead.id||lead.trashed||!['new','following'].includes(lead.status||'new')||!leadSee(lead))continue;
      let score=0;const reasons=[];
      const e164=toE164(lead.phone,{country:lead.country});
      if(e164&&peers.includes(e164)){score=100;reasons.push('phone');}
      const byName=nameScore(wanted,trim(lead.name),[],[trim(lead.contact)].filter(Boolean));
      if(byName.score>=60){score+=byName.score;reasons.push(byName.why);}
      if(score)leadMatches.push({id:lead.id,name:trim(lead.name),contact:trim(lead.contact),phone:trim(lead.phone),status:lead.status||'new',score,reasons});
    }
    leadMatches.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'zh'));
    return {candidates:candidates.slice(0,20),leadMatches:leadMatches.slice(0,20)};
  }

  const api={LIMITS,DIAL_CODES,TEMPLATE_VARS,countryIso,dialCodeOf,dialOptions,toE164,waLink,peersFromSenders,chatNameFromFile,renderTemplate,
    parseExport,readZip,buildEntries,mergeImport,importFootprint,undoImport,logChat,mergeChatHistory,matchCustomers};
  if(node)module.exports=api;else root.LaiWhatsAppModel=api;
})(typeof window!=='undefined'?window:globalThis);
