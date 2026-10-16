(function (root) {
  'use strict';
  // 任务设置（纯逻辑，没有界面）：按规则自动建待办。全部默认关闭。
  // 存在 state.laiSettings.taskRules = {rules:[{id,type,enabled,days,stage?,dueDays}], lastRun:'YYYY-MM-DD', dismissed:[key]}。
  // 四种规则（type 同时是规则 id）：
  //   noFollow   客户 days 天没跟进 → 「跟进 客户」，今天到期，负责人＝客户跟进人，key noFollow|客户|最近一次跟进的日子
  //   orderStage 订单到了某个阶段 → 「订单 号 到了「阶段」」，dueDays 天后到期，负责人＝订单负责人，key orderStage|订单id|阶段
  //   oppClose   未成交的商机离结束日期还有 days 天（含当天）→ 到结束日期那天到期，负责人＝商机负责人，key oppClose|商机id|结束日期
  //   repurchase 客户最后一单已经超过客户资料里的「复购周期」→ 今天到期，负责人＝客户跟进人，key repurchase|最后一单id
  // 生成的待办带 auto:{rule,key}。key 已经有待办（不管做没做完）或在 dismissed 里就不再建；删掉自动待办会把它的 key 记进 dismissed。
  // 没有负责人的记录跳过。每次每条规则最多建 50 个，最逾期的先建。没有 回款／待收款 规则（D-006）。
  // 不读时钟：所有函数的 now 由调用方传（默认当前时间），测试可以固定。
  const TYPES = ['noFollow', 'orderStage', 'oppClose', 'repurchase'];
  const CAP = 50;
  const DISMISSED_LIMIT = 5000;
  const DEFAULTS = Object.freeze({
    noFollow: Object.freeze({ days: 14, dueDays: 0 }),
    orderStage: Object.freeze({ days: 0, stage: 'shipment', dueDays: 1 }),
    oppClose: Object.freeze({ days: 7, dueDays: 0 }),
    repurchase: Object.freeze({ days: 0, dueDays: 0 }),
  });
  const trim = (value) => String(value ?? '').trim();
  const isPlain = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  const B = () => root.LaiBusinessModel || (typeof module !== 'undefined' && module.exports ? require('./business-model.js') : null);
  const OM = () => {
    if (root.LaiOpportunityModel) return root.LaiOpportunityModel;
    try { return typeof module !== 'undefined' && module.exports ? require('./opportunity-model.js') : null; } catch (_) { return null; }
  };
  const stageList = () => (B() && B().stages) || [];
  const stageLabel = (id) => (stageList().find((stage) => stage.id === id) || {}).label || id;

  // ---------- 日期（都按本地日子，YYYY-MM-DD） ----------
  const pad = (n) => String(n).padStart(2, '0');
  const dayOfDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function dayNum(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
    if (!m) return NaN;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]), d = new Date(t);
    // 2026-02-31 这样的日子 Date 会悄悄挪到下个月，要退回去核对。
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? Math.round(t / 86400000) : NaN;
  }
  function addDays(day, n) {
    const d = new Date((dayNum(day) + n) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  // 各种时间写法（日期、本地时间、带时区的 ISO）→ 本地日子；认不出来返回空。
  function dayOf(value) {
    const s = trim(value);
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isFinite(dayNum(s)) ? s : '';
    const t = Date.parse(s.replace(' ', 'T'));
    if (Number.isFinite(t)) return dayOfDate(new Date(t));
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return m && Number.isFinite(dayNum(m[1])) ? m[1] : '';
  }
  const todayOf = (now) => dayOfDate(now instanceof Date ? now : new Date(now ?? Date.now()));

  // ---------- 设置 ----------
  function cleanInt(value, min, max, label) {
    const text = trim(value);
    if (!/^\d{1,4}$/.test(text) || Number(text) < min || Number(text) > max) throw new Error(`${label}请填 ${min} 到 ${max} 的整数`);
    return Number(text);
  }
  function normalRule(type, stored) {
    const base = DEFAULTS[type], s = isPlain(stored) ? stored : {};
    const int = (value, min, max, fallback) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback);
    const rule = { id: type, type, enabled: s.enabled === true, days: int(s.days, type === 'noFollow' || type === 'oppClose' ? 1 : 0, 365, base.days), dueDays: int(s.dueDays, 0, 90, base.dueDays) };
    if (type === 'orderStage') rule.stage = stageList().some((stage) => stage.id === s.stage) ? s.stage : base.stage;
    return rule;
  }
  function config(state) {
    const stored = state && state.laiSettings && state.laiSettings.taskRules;
    const s = isPlain(stored) ? stored : {};
    const list = Array.isArray(s.rules) ? s.rules : [];
    const dismissed = [...new Set((Array.isArray(s.dismissed) ? s.dismissed : []).filter((key) => typeof key === 'string' && key))];
    return {
      rules: TYPES.map((type) => normalRule(type, list.find((rule) => isPlain(rule) && (rule.type === type || rule.id === type)))),
      lastRun: /^\d{4}-\d{2}-\d{2}$/.test(s.lastRun) ? s.lastRun : '',
      dismissed,
    };
  }
  const rules = (state) => config(state).rules;
  const withConfig = (state, cfg) => ({ ...state, laiSettings: { ...((state && state.laiSettings) || {}), taskRules: { rules: cfg.rules, lastRun: cfg.lastRun, dismissed: cfg.dismissed } } });
  function setRule(state, type, patch = {}) {
    if (!TYPES.includes(type)) throw new Error('找不到这条规则');
    const cfg = config(state), old = cfg.rules.find((rule) => rule.type === type), next = { ...old };
    if (Object.hasOwn(patch, 'enabled')) {
      if (typeof patch.enabled !== 'boolean') throw new Error('开关状态无效');
      next.enabled = patch.enabled;
    }
    if (Object.hasOwn(patch, 'days')) {
      if (type === 'noFollow') next.days = cleanInt(patch.days, 1, 365, '没跟进的天数');
      else if (type === 'oppClose') next.days = cleanInt(patch.days, 1, 365, '提前的天数');
    }
    if (Object.hasOwn(patch, 'dueDays') && type === 'orderStage') next.dueDays = cleanInt(patch.dueDays, 0, 90, '几天后');
    if (Object.hasOwn(patch, 'stage') && type === 'orderStage') {
      if (!stageList().some((stage) => stage.id === patch.stage)) throw new Error('请选择有效的订单阶段');
      next.stage = patch.stage;
    }
    return withConfig(state, { ...cfg, rules: cfg.rules.map((rule) => (rule.type === type ? next : rule)) });
  }

  // ---------- 找出该建的待办 ----------
  const customersOf = (state) => (isPlain(state && state.customers) ? Object.entries(state.customers).filter(([name, profile]) => name !== '__proto__' && isPlain(profile)) : []);
  const activeProfile = (profile) => !['pool', 'trash'].includes(profile.laiBucket) && !profile.trashedAt && !profile.deletedAt && profile.archived !== true;
  const ownerOfCustomer = (state, name) => {
    const profile = isPlain(state && state.customers) && Object.hasOwn(state.customers, name) ? state.customers[name] : null;
    return trim(profile && profile.owner);
  };
  // 客户最近一次跟进（写的跟进、往来邮件、领回公海）的日子；一次都没有就用建档日。
  function lastFollowDay(profile) {
    const stamps = [profile.lastFollowup, profile.lastWrittenFollowup, profile.lastPrivatePoolEntry];
    for (const h of Array.isArray(profile.history) ? profile.history : []) if (h && ['followup', 'mail'].includes(h.type)) stamps.push(h.time);
    const days = stamps.map(dayOf).filter(Boolean).sort();
    if (days.length) return days.at(-1);
    const born = [profile.createdAt, ...(Array.isArray(profile.history) ? profile.history.map((h) => h && h.time) : [])].map(dayOf).filter(Boolean).sort();
    return born[0] || '';
  }
  const known = (state, name) => (name && isPlain(state.customers) && Object.hasOwn(state.customers, name) ? name : '');

  const finders = {
    noFollow(state, rule, today) {
      const out = [];
      for (const [name, profile] of customersOf(state)) {
        if (!activeProfile(profile)) continue;
        const owner = trim(profile.owner), last = lastFollowDay(profile);
        if (!owner || !last) continue;
        const idle = dayNum(today) - dayNum(last);
        if (idle < rule.days) continue;
        out.push({ key: `noFollow|${name}|${last}`, title: `跟进 ${name}`, date: addDays(today, rule.dueDays), owner, customer: name, late: idle - rule.days });
      }
      return out;
    },
    orderStage(state, rule, today) {
      const out = [];
      for (const order of Array.isArray(state.orders) ? state.orders : []) {
        if (!isPlain(order) || order.isDraft === true || !trim(order.id) || order.stage !== rule.stage) continue;
        const owner = trim(order.owner) || ownerOfCustomer(state, trim(order.client));
        if (!owner) continue;
        const age = dayNum(today) - dayNum(dayOf(order.createdAt));
        out.push({ key: `orderStage|${order.id}|${rule.stage}`, title: `订单 ${trim(order.num) || order.id} 到了「${stageLabel(rule.stage)}」`, date: addDays(today, rule.dueDays), owner, customer: known(state, trim(order.client)), late: Number.isFinite(age) ? age : 0 });
      }
      return out;
    },
    oppClose(state, rule, today) {
      const out = [], om = OM();
      for (const item of Array.isArray(state.laiOpportunities) ? state.laiOpportunities : []) {
        if (!isPlain(item) || !trim(item.id) || item.archived === true) continue;
        let open;
        try { open = om ? om.stageOf(state, item).kind === 'open' : !item.closedAt; } catch (_) { open = !item.closedAt; }
        const end = dayOf(item.endDate), owner = trim(item.owner);
        if (!open || !end || !owner) continue;
        const left = dayNum(end) - dayNum(today);
        if (left < 0 || left > rule.days) continue;
        out.push({ key: `oppClose|${item.id}|${end}`, title: `商机「${trim(item.name) || '未命名商机'}」快到结束日期`, date: end, owner, customer: known(state, trim(item.client)), late: rule.days - left });
      }
      return out;
    },
    repurchase(state, rule, today) {
      const out = [], last = new Map();
      for (const order of Array.isArray(state.orders) ? state.orders : []) {
        if (!isPlain(order) || order.isDraft === true || !trim(order.id)) continue;
        const day = dayOf(order.createdAt), client = trim(order.client);
        if (!day || !client) continue;
        const prev = last.get(client);
        if (!prev || day > prev.day || (day === prev.day && String(order.id) > String(prev.id))) last.set(client, { id: order.id, day });
      }
      for (const [name, profile] of customersOf(state)) {
        const cycle = Number(profile.repurchaseCycle);
        const hit = last.get(name);
        if (!activeProfile(profile) || !hit || !Number.isInteger(cycle) || cycle <= 0) continue;
        const owner = trim(profile.owner);
        if (!owner) continue;
        const idle = dayNum(today) - dayNum(hit.day);
        if (idle < cycle) continue;
        out.push({ key: `repurchase|${hit.id}`, title: `复购提醒：${name}`, date: addDays(today, rule.dueDays), owner, customer: name, late: idle - cycle });
      }
      return out;
    },
  };

  // 已经有的 key：所有自动待办（不管做没做完）和「已删除」里的。
  function usedKeys(state) {
    const used = new Set(config(state).dismissed);
    for (const task of Array.isArray(state && state.laiTasks) ? state.laiTasks : []) if (task && task.auto && typeof task.auto.key === 'string') used.add(task.auto.key);
    return used;
  }
  // 一条规则现在该建的待办（最逾期的在前，没有上限；建的时候才截到 50 个）。
  function candidates(state, rule, now = new Date(), used = usedKeys(state)) {
    const today = todayOf(now);
    return finders[rule.type](state || {}, rule, today)
      .filter((item) => !used.has(item.key))
      .sort((a, b) => b.late - a.late || a.key.localeCompare(b.key));
  }
  // 页面上的预览：每条规则「现在会生成」几个（最多 50）和一共有几个。规则开没开都算，可以先看再开。
  function preview(state, now = new Date()) {
    const used = usedKeys(state), byType = {};
    let count = 0;
    for (const rule of rules(state)) {
      const total = candidates(state, rule, now, used).length;
      byType[rule.type] = { count: Math.min(total, CAP), total };
      if (rule.enabled) count += byType[rule.type].count;
    }
    return { byType, count };
  }

  // ---------- 建待办 ----------
  const hash = (text) => {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  function addTask(state, item, rule) {
    const ids = new Set((state.laiTasks || []).map((task) => task && task.id));
    let id = `auto-${hash(item.key)}`;
    while (ids.has(id)) id += 'x';
    let next = B().setTask(state, id, { title: item.title, date: item.date, done: false, owner: item.owner }, { me: item.owner, canReassign: true });
    next = { ...next, laiTasks: next.laiTasks.map((task) => (task.id === id ? { ...task, ...(item.customer ? { customer: item.customer } : {}), auto: { rule: rule.type, key: item.key } } : task)) };
    return next;
  }
  // 今天有没有该跑的：有开着的规则，且今天还没跑过。
  function due(state, now = new Date()) {
    const cfg = config(state);
    return cfg.rules.some((rule) => rule.enabled) && cfg.lastRun !== todayOf(now);
  }
  // 跑一遍所有开着的规则，记下今天已跑；每条规则最多 CAP 个。没有开着的规则时什么也不改。
  // 返回 {state, created:[待办], byType:{type:数量}}。
  function run(state, { now = new Date() } = {}) {
    const cfg = config(state), active = cfg.rules.filter((rule) => rule.enabled);
    if (!active.length) return { state, created: [], byType: {} };
    const used = usedKeys(state), byType = {}, created = [];
    let next = state;
    for (const rule of active) {
      const items = candidates(state, rule, now, used).slice(0, CAP);
      byType[rule.type] = items.length;
      for (const item of items) {
        next = addTask(next, item, rule);
        used.add(item.key);
        created.push(next.laiTasks.find((task) => task.auto && task.auto.key === item.key));
      }
    }
    return { state: withConfig(next, { ...cfg, lastRun: todayOf(now) }), created, byType };
  }

  // ---------- 自动待办的管理 ----------
  const autoTasks = (state) => (Array.isArray(state && state.laiTasks) ? state.laiTasks : []).filter((task) => task && task.auto && typeof task.auto.key === 'string');
  // 删掉一条自动待办，并记住它的 key，以后不再为同一件事重建。
  function dismissTask(state, id) {
    const task = autoTasks(state).find((item) => item.id === id);
    if (!task) throw new Error('找不到这条自动待办');
    const cfg = config(state);
    const dismissed = [...cfg.dismissed.filter((key) => key !== task.auto.key), task.auto.key].slice(-DISMISSED_LIMIT);
    return withConfig({ ...state, laiTasks: state.laiTasks.filter((item) => item.id !== id) }, { ...cfg, dismissed });
  }

  const api = { TYPES, CAP, DEFAULTS, config, rules, setRule, candidates, preview, run, due, autoTasks, dismissTask, usedKeys, dayOf, todayOf, stageLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LaiTaskRuleModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
