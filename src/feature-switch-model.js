(function (root) {
  'use strict';
  // 功能开关（纯逻辑，没有界面）。存在 state.laiSettings.featureSwitch = {off:['mail', ...]}：
  // 列在 off 里的模块是关的，没写（或没有这一项）就是全开，所以老数据和新账号都不受影响。
  // 关掉只是“不显示、不后台运行”：数据一点不删，重新打开就全回来。关了就是关了，管理员也一样（先看模块开没开，再看角色权限）。
  // 可以关的：线索、商机、产品、单据、邮件、沟通、团队数据。客户、订单、工作台、协同、设置、企业管理关不掉。
  const MODULES = Object.freeze([
    ['lead', '线索', '线索列表、线索回收站、线索设置；客户详情里的关联线索'],
    ['opp', '商机', '商机看板、商机分析、商机设置；客户详情和工作台里的商机；任务设置里“商机快到结束日期”不再自动建待办'],
    ['product', '产品', '产品库和产品设置；订单里的产品改为直接手填'],
    ['doc', '单据', '单据模板；订单和商机里的“生成单据”'],
    ['mail', '邮件', '收发邮件、自动检查新邮件、自动记往来邮件；工作台里的未读邮件'],
    ['chat', '沟通', 'WhatsApp 聊天记录和聊天模板；客户详情里的聊天记录'],
    ['team', '团队数据', '目标、统计报表、团队墙；工作台里的本月目标'],
  ].map(([id, label, note]) => Object.freeze({ id, label, note })));
  const IDS = MODULES.map((m) => m.id);
  const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  // 关着的模块（只留认识的、去重、按固定顺序）。
  function offList(state) {
    const raw = state && state.laiSettings && state.laiSettings.featureSwitch;
    const list = isPlain(raw) && Array.isArray(raw.off) ? raw.off : [];
    return IDS.filter((id) => list.includes(id));
  }
  // 模块开着吗？不在清单里的（客户、订单……）永远是开的。
  function enabled(state, module) {
    if (!IDS.includes(module)) return true;
    const raw = state && state.laiSettings && state.laiSettings.featureSwitch;
    return !(isPlain(raw) && Array.isArray(raw.off) && raw.off.includes(module));
  }
  // 开或关一个模块，返回新的 state；其它设置原样保留。
  function set(state, module, on) {
    if (!IDS.includes(module)) throw new Error('这个功能不能关闭');
    if (typeof on !== 'boolean') throw new Error('开关状态无效');
    const off = offList(state).filter((id) => id !== module);
    if (!on) off.push(module);
    const ordered = IDS.filter((id) => off.includes(id));
    const stored = state && state.laiSettings && state.laiSettings.featureSwitch;
    return { ...state, laiSettings: { ...((state && state.laiSettings) || {}), featureSwitch: { ...(isPlain(stored) ? stored : {}), off: ordered } } };
  }
  const label = (module) => (MODULES.find((m) => m.id === module) || {}).label || '';

  // ---------- 哪个页面、权限、菜单入口属于哪个模块 ----------
  // 对照表在 role-model.js（权限判断 can / canOpen 自己就看功能开关，所以不用在这里再包一层）；这里只是同一份表的出口。
  const RM = () => (typeof module !== 'undefined' && module.exports ? require('./role-model.js') : root.LaiRoleModel);
  const ROUTE_MODULE = RM().ROUTE_MODULE;
  const moduleOfRoute = (route) => RM().moduleOfRoute(route);
  const moduleOfKey = (key) => RM().moduleOfKey(key);
  const moduleOfEntry = (kind, target) => RM().moduleOfEntry(kind, target);
  const routeOn = (state, route) => enabled(state, moduleOfRoute(route));
  const keyOn = (state, key) => enabled(state, moduleOfKey(key));
  const entryOn = (state, kind, target) => enabled(state, moduleOfEntry(kind, target));

  // ---------- 依赖：商机关了，“成交”不能再按商机算 ----------
  // 客户设置里“成交怎么算”选了“按商机”，商机功能又关了：读取时退回按订单算（设置本身不改，商机重新打开就恢复）。
  // 退回的动作在 customer-settings-model.js 的 lastDealDate 里（直接读功能开关）；这里只回答“现在实际按什么算”。
  // 现在成交实际按什么算：'order' 或 'opportunity'。
  function dealBasis(state, CS) {
    const by = CS && typeof CS.get === 'function' ? CS.get(state).dealRule.by : 'order';
    return by === 'opportunity' && enabled(state, 'opp') ? 'opportunity' : 'order';
  }
  // ---------- 依赖：任务规则用到了关着的模块就不跑 ----------
  // 规则 → 它用到的模块（目前只有“商机快到结束日期”用商机）。
  const RULE_MODULE = Object.freeze({ oppClose: 'opp' });
  const ruleBlocked = (state, type) => Object.hasOwn(RULE_MODULE, type) && !enabled(state, RULE_MODULE[type]);
  // 跑任务规则时，把用到关着的模块的规则当成没开；返回的状态里规则开关还是用户原来设的，并记下这条规则今天没跑（taskRules.skipped），
  // 模块当天重新打开时它不看“今天跑过没有”，马上接着跑。
  // 默认只在“今天该跑”时才跑，没有该跑的规则时返回 null（什么也不用保存）；options.force 为真时不看“今天跑过没有”
  // （任务设置里刚打开一条规则，马上建待办）。TR 是 LaiTaskRuleModel。
  function runTaskRules(TR, state, options) {
    const force = !!(options && options.force);
    const cfg = TR.config(state);
    const blocked = cfg.rules.filter((rule) => rule.enabled && ruleBlocked(state, rule.type)).map((rule) => rule.type);
    if (!blocked.length) return force || TR.due(state, options && options.now) ? TR.run(state, options) : null; // run 会把跑过的规则从 skipped 里去掉
    const shadow = blocked.reduce((s, type) => TR.setRule(s, type, { enabled: false }), state);
    if (!force && !TR.due(shadow, options && options.now)) return null;
    const result = TR.run(shadow, options);
    const after = TR.config(result.state);
    const restored = after.rules.map((rule) => (blocked.includes(rule.type) ? { ...rule, enabled: true } : rule));
    const ls = result.state.laiSettings || {};
    return { ...result, state: { ...result.state, laiSettings: { ...ls, taskRules: { ...(ls.taskRules || {}), rules: restored, lastRun: after.lastRun, dismissed: after.dismissed, skipped: [...new Set([...after.skipped, ...blocked])] } } } };
  }

  const api = { MODULES, IDS, ROUTE_MODULE, offList, enabled, set, label, moduleOfRoute, moduleOfKey, moduleOfEntry, routeOn, keyOn, entryOn,
    dealBasis, ruleBlocked, runTaskRules };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LaiFeatureSwitch = api;
})(typeof window !== 'undefined' ? window : globalThis);
