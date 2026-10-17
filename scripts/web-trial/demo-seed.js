/* 来财Lai 网页试用版：示例数据。第一次打开试用版（浏览器里还没有任何客户和订单）时，放进一批虚构的示例数据：
   7 家美国、欧洲的大型睫毛公司、订单、商机、跟进记录和本月目标，邮箱与 mail-demo.js 里的示例邮件一一对应，
   让工作台、客户、商机、订单、邮件页一打开就是有内容的样子。公司和人名都是虚构的，邮箱域名都是 .example。
   发布试用版时，本文件作为一个 <script> 放在所有业务模块之后、应用主脚本之前（要用商机和目标模块生成数据，并且必须赶在应用读数据之前）。
   只在「浏览器里没有客户也没有订单，并且从没放过示例数据」时才写入；用户自己的数据不会被动。 */
(function (root) {
  'use strict';
  var KEY = 'lai-web-trial-v1', FLAG = 'lai-web-trial-demo-seeded';
  var OM = root.LaiOpportunityModel, TM = root.LaiTeamModel, B = root.LaiBusinessModel;

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  // 以今天为基准的日期：offset 天（负数是过去）。
  function day(today, offset) { var d = new Date(today.getTime()); d.setDate(d.getDate() + offset); return iso(d); }
  // 本月内的日期：从 1 号起第 k 天，但不晚于今天（让订单落在「本月」里）。
  function inMonth(today, k) { var d = new Date(today.getFullYear(), today.getMonth(), 1 + k); return iso(d > today ? today : d); }
  function stamp(today, offset, hour) { return day(today, offset) + 'T' + pad(hour) + ':00:00.000Z'; }

  var COMPANIES = [
    {name: 'London Lash Pro', country: '英国', city: 'London', contact: 'Charlotte Hughes', title: 'Head of Buying', email: 'charlotte@londonlashpro.example', phone: '+44 20 7946 0101', owner: 'Kris', stars: 5, stage: '成交客户', follow: 0, note: '伦敦连锁睫毛品牌，30 家门店。Q4 PO 5 万美金待出 PI。', record: '电话确认 Q4 PO：USD 50,000，今天发 PI，下周一收定金。', recordDays: -1},
    {name: 'Velvet Lash Co.', country: '美国', city: 'Los Angeles', contact: 'Madison Cole', title: 'Founder', email: 'madison@velvetlashco.example', phone: '+1 310 555 0102', owner: 'Kris', stars: 5, stage: '成交客户', follow: 1, note: '洛杉矶 DTC 品牌，节日礼盒旺季订单翻倍。', record: '第一波 USD 38,600 已投产；对方要求锁定 11 月起的产能。', recordDays: -2},
    {name: 'NordLash Studio GmbH', country: '德国', city: 'Berlin', contact: 'Lena Fischer', title: 'Managing Director', email: 'lena.fischer@nordlash.example', phone: '+49 30 5555 0103', owner: 'Mia', stars: 4, stage: '成交客户', follow: 3, note: '柏林连锁，复购率高；想要 DACH 区域独家。', record: '上批 6 周售罄，复购 USD 27,400；她问 2027 年独家条款。', recordDays: -3},
    {name: 'Maison des Cils', country: '法国', city: 'Paris', contact: 'Camille Laurent', title: 'Directrice des achats', email: 'camille@maisondescils.example', phone: '+33 1 5555 0104', owner: 'Mia', stars: 4, stage: '意向客户', follow: 2, note: '巴黎美睫沙龙集团，样品全部通过，准备试单。', record: '12 款样品全部通过；试单 USD 18,000，等我们报价和交期。', recordDays: -1},
    {name: 'Lash Luxe Distribution', country: '美国', city: 'Miami', contact: 'Daniel Ortiz', title: 'Purchasing Director', email: 'daniel@lashluxe.example', phone: '+1 305 555 0105', owner: 'Kris', stars: 5, stage: '成交客户', follow: 0, note: '迈阿密分销商，黑五前要货；德州新开 3 家门店。', record: '电汇尾款 USD 21,300 已发，等我们放货并给运单号。', recordDays: 0},
    {name: 'Bella Ciglia Srl', country: '意大利', city: 'Milan', contact: 'Giulia Romano', title: 'CEO', email: 'giulia@bellaciglia.example', phone: '+39 02 5555 0106', owner: 'Leo', stars: 5, stage: '意向客户', follow: -2, note: '米兰连锁，明年扩到 14 家店，谈年度供货协议。', record: '要 2027 年度协议，规划 USD 180,000，要求季度分批提货。', recordDays: -3},
    {name: 'Lash Lab Amsterdam BV', country: '荷兰', city: 'Amsterdam', contact: 'Sanne de Vries', title: 'Operations Lead', email: 'sanne@lashlab.example', phone: '+31 20 5555 0107', owner: 'Leo', stars: 4, stage: '成交客户', follow: -1, note: '阿姆斯特丹自有品牌厂商，Q4 预测增长 35%。', record: 'Q4 预测约 USD 30,000，发来新托盘设计稿，让确认印刷规格。', recordDays: -2}
  ];

  // 订单：name → [编号, 金额, 阶段, 已收款, 产品, 下一步, 创建日(本月第几天)]
  var ORDERS = [
    ['London Lash Pro', 'LLP-2509-12', 28400, 'done', 28400, '经典貂毛睫毛', '', 'prev'],
    ['London Lash Pro', 'L-2610-028', 31200, 'shipment', 31200, '嫁接睫毛托盘', '跟踪物流，确认签收', 0],
    ['Velvet Lash Co.', 'L-2610-030', 38600, 'production', 11580, '节日礼盒睫毛', '10 月 20 日验货，付 70% 余款', 1],
    ['NordLash Studio GmbH', 'L-2610-029', 27400, 'balance', 13700, '预制扇形睫毛', '催收尾款后安排发货', 2],
    ['Lash Luxe Distribution', 'L-2610-027', 42600, 'balance', 21300, '多款托盘 + 私标胶水', '确认电汇到账，放货并发运单号', 3],
    ['Maison des Cils', 'L-2610-032', 18000, 'deposit', 5400, '0.05 D 弧度扇形', '等定金到账后排产', 5],
    ['Bella Ciglia Srl', 'L-2610-033', 9800, 'quote', 0, '样品加试单', '周五前回复改价', 6],
    ['Lash Lab Amsterdam BV', 'L-2609-020', 15750, 'done', 15750, '自有品牌托盘', '', 'prev'],
    ['Velvet Lash Co.', 'L-2609-018', 24900, 'done', 24900, '经典貂毛睫毛', '', 'prev']
  ];

  // 商机：[名称, 客户, 金额, 阶段, 结束日偏移]
  var OPPS = [
    ['London Lash Pro Q4 PO', 'London Lash Pro', 50000, 'open', 14],
    ['Velvet 12 月第二波', 'Velvet Lash Co.', 41000, 'open', 30],
    ['Bella Ciglia 2027 年度协议', 'Bella Ciglia Srl', 180000, 'open', 60],
    ['Maison des Cils 试单', 'Maison des Cils', 18000, 'open', 21],
    ['NordLash 复购三款', 'NordLash Studio GmbH', 27400, 'unpaid', 12],
    ['Velvet 节日礼盒第一波', 'Velvet Lash Co.', 38600, 'unpaid', 10],
    ['Lash Luxe LLD-0917', 'Lash Luxe Distribution', 42600, 'balance', 7],
    ['London Lash Pro 10 月订单', 'London Lash Pro', 31200, 'done', -3],
    ['Lash Lab Q3 自有品牌', 'Lash Lab Amsterdam BV', 15750, 'done', -10],
    ['Lash Lab 试用套装', 'Lash Lab Amsterdam BV', 4200, 'lost', -5]
  ];

  // 示例 WhatsApp 聊天（沟通 › 聊天记录）：全是虚构的。[客户, 联系人, 号码, 跟进人, [[几天前, 时, 分, 'out'|'in', 内容], ...]]
  var CHATS = [
    ['London Lash Pro', 'Charlotte Hughes', '+442079460101', 'Kris', [
      [3, 14, 5, 'in', 'Hi Kris, could you send the updated price list for the grafting trays?'],
      [3, 14, 9, 'out', 'Hello Charlotte, sending it now. MOQ is 500 trays per style.'],
      [3, 14, 12, 'in', 'Perfect. We plan a PO of about USD 50,000 for Q4.'],
      [1, 9, 40, 'out', 'The PI is ready, I will email it this afternoon.'],
      [1, 16, 2, 'in', 'Received, thank you. Can you hold the production slot for us?']]],
    ['Velvet Lash Co.', 'Madison Cole', '+13105550102', 'Kris', [
      [6, 11, 30, 'out', 'Hi Madison, the holiday gift boxes passed inspection. Photos attached.'],
      [6, 11, 52, 'in', 'They look great! When can they ship?'],
      [5, 8, 15, 'out', 'We can ship on October 20, after the 70% balance arrives.']]]
  ];
  function chatEntries(today, row) {
    var byDay = {};
    row[4].forEach(function (line, index) {
      var when = new Date(today.getTime()); when.setDate(when.getDate() - line[0]); when.setHours(line[1], line[2], 0, 0);
      var key = iso(when);
      (byDay[key] = byDay[key] || []).push({at: when.toISOString(), from: line[3] === 'out' ? row[3] : row[1], dir: line[3], text: line[4], key: 'demo-' + row[0].replace(/\W/g, '').toLowerCase() + '-' + index});
    });
    return Object.keys(byDay).sort().reverse().map(function (dayKey) {
      var lines = byDay[dayKey], sent = lines.filter(function (l) { return l.dir === 'out'; }), got = lines.filter(function (l) { return l.dir === 'in'; });
      var entry = {type: 'chat', subtype: 'whatsapp', channel: 'WhatsApp', time: lines[lines.length - 1].at, owner: row[3], contact: row[1],
        text: 'WhatsApp 聊天 ' + lines.length + ' 条（发出 ' + sent.length + '，收到 ' + got.length + '）\n' + lines.map(function (l) { return l.text; }).join(' ').slice(0, 140),
        chatRef: {src: 'manual', peer: row[2], day: dayKey}, lines: lines};
      if (sent.length) entry.lastSentAt = sent[sent.length - 1].at;
      if (got.length) entry.lastReceivedAt = got[got.length - 1].at;
      return entry;
    });
  }

  function build(today) {
    var data = {orders: [], trashOrders: [], deletedOrders: [], customers: {}, trackingLookups: []};
    var owners = {};
    COMPANIES.forEach(function (c, index) {
      owners[c.name] = c.owner;
      data.customers[c.name] = {
        client: c.name, country: c.country, owner: c.owner, source: index % 2 ? '展会' : '官网', email: c.email, contact: c.contact, contactTitle: c.title,
        phone: c.phone, address: c.city, customerStage: c.stage, customerStars: c.stars, note: c.note, tags: ['睫毛', c.country === '美国' ? '美国' : '欧洲'],
        nextFollow: day(today, c.follow), createdAt: stamp(today, -40 - index * 9, 2), updated: stamp(today, c.recordDays, 9), lastFollowup: stamp(today, c.recordDays, 9),
        lastWrittenFollowup: stamp(today, c.recordDays, 9),
        history: [{time: stamp(today, c.recordDays, 9), text: c.record, type: 'followup', subtype: 'quick'}]
      };
    });
    CHATS.forEach(function (row) {
      var profile = data.customers[row[0]];
      if (profile) profile.history = chatEntries(today, row).concat(profile.history || []);
    });
    ORDERS.forEach(function (row, index) {
      var prev = row[7] === 'prev', created = prev ? day(today, -45 - index) : inMonth(today, row[7]);
      data.orders.push({id: 'demo-order-' + (index + 1), num: row[1], client: row[0], country: data.customers[row[0]].country, amount: row[2], currency: 'USD', stage: row[3], paidAmount: row[4],
        productType: row[5], next: row[6], owner: owners[row[0]], createdAt: created, orderMonth: created.slice(0, 7), updated: created + 'T08:00:00.000Z'});
    });
    OPPS.forEach(function (row, index) {
      var input = {owner: owners[row[1]], client: row[1], name: row[0], stage: row[3], amount: row[2], currency: 'USD', contact: data.customers[row[1]].contact, startDate: day(today, -20), endDate: day(today, row[4])};
      if (row[3] === 'lost') input.lostReason = '价格原因';
      var next = OM.upsert(data, 'demo-opp-' + (index + 1), input, {today: iso(today)});
      Object.keys(next).forEach(function (key) { data[key] = next[key]; });
    });
    var month = iso(today).slice(0, 7);
    [{metric: 'amount', currency: 'USD', value: 400000}, {metric: 'added', value: 12}, {metric: 'records', value: 30}].forEach(function (target) {
      var next = TM.setTarget(data, Object.assign({period: month, scope: 'company'}, target));
      Object.keys(next).forEach(function (key) { data[key] = next[key]; });
    });
    data.laiSettings = {defaultOwner: 'Kris'};
    return data;
  }

  function run() {
    if (!OM || !TM || !B) return;
    var storage;
    try { storage = root.localStorage; storage.getItem(FLAG); } catch (error) { return; }
    try {
      if (storage.getItem(FLAG)) return;
      var stored = null;
      try { stored = JSON.parse(storage.getItem(KEY) || 'null'); } catch (error) { stored = null; }
      var existing = stored && stored.data;
      if (existing && ((existing.orders || []).length || Object.keys(existing.customers || {}).length)) { storage.setItem(FLAG, '1'); return; }
      var data = build(new Date());
      // 保留用户已经选过的主题等设置。
      if (existing && existing.laiSettings) data.laiSettings = Object.assign({}, data.laiSettings, existing.laiSettings);
      var next = {app: 'trade-order-system', version: 'sqlite-1', exportedAt: new Date().toISOString(), data: data, revision: (stored && Number(stored.revision)) || 1};
      storage.setItem(KEY, JSON.stringify(next));
      storage.setItem(FLAG, '1');
    } catch (error) { /* 存不下就算了：试用版仍然是空的，可以自己加 */ }
  }
  root.LaiWebTrialDemoSeed = {build: build, companies: COMPANIES};
  run();
})(typeof window !== 'undefined' ? window : globalThis);
