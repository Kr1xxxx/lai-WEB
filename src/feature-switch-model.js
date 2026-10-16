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
  const ROUTE_MODULE = Object.freeze({
    leads: 'lead', 'lead-trash': 'lead', 'lead-settings': 'lead',
    opportunities: 'opp', 'opp-analysis': 'opp', 'opp-flows': 'opp',
    products: 'product',
    'doc-templates': 'doc',
    mail: 'mail',
    chats: 'chat', 'chat-templates': 'chat',
    'team-goals': 'team', 'team-targets': 'team', 'team-wall': 'team', analysis: 'team',
    'team-assets': 'team', 'team-followups': 'team', 'team-tasks': 'team', 'team-orders': 'team',
  });
  const moduleOfRoute = (route) => (Object.hasOwn(ROUTE_MODULE, route) ? ROUTE_MODULE[route] : '');
  // 权限 key → 模块：lead.*、opp.*、product.*、doc.*、mail.*、chat.*、team.* 和对应的设置项。
  const KEY_PREFIX = Object.freeze({ lead: 'lead', opp: 'opp', product: 'product', doc: 'doc', mail: 'mail', chat: 'chat', team: 'team' });
  const SETTINGS_KEY = Object.freeze({ 'settings.lead': 'lead', 'settings.opportunity': 'opp', 'settings.product': 'product', 'settings.docTemplate': 'doc' });
  function moduleOfKey(key) {
    const text = String(key || '');
    if (Object.hasOwn(SETTINGS_KEY, text)) return SETTINGS_KEY[text];
    const head = text.split('.')[0];
    return text.includes('.') && Object.hasOwn(KEY_PREFIX, head) ? KEY_PREFIX[head] : '';
  }
  // 菜单行（rail-menu.js）：邮件文件夹属于邮件，业务页面按路由；客户页面不受影响。
  function moduleOfEntry(kind, target) {
    if (kind === 'mail') return 'mail';
    if (kind === 'route') return moduleOfRoute(target);
    return '';
  }
  const routeOn = (state, route) => enabled(state, moduleOfRoute(route));
  const keyOn = (state, key) => enabled(state, moduleOfKey(key));
  const entryOn = (state, kind, target) => enabled(state, moduleOfEntry(kind, target));

  // ---------- 接进已有的权限判断 ----------
  // 有效权限 = 角色有这项权限 并且 模块开着。把角色模型的 can / canOpen 包一层，页面、业务页、客户详情里原来的
  // can('opp.create') 之类的判断就都自动算上了；角色权限表本身（GROUPS、角色里勾选的项）不变，所以权限表里照样列着这些权限。
  const MARK = '__featureSwitchBase';
  function install(RM) {
    if (!RM || typeof RM.can !== 'function' || RM.can[MARK]) return false;
    const baseCan = RM.can, baseOpen = RM.canOpen;
    const can = (state, key) => baseCan(state, key) && keyOn(state, key);
    can[MARK] = baseCan;
    RM.can = can;
    if (typeof baseOpen === 'function') {
      const canOpen = (state, kind, target) => baseOpen(state, kind, target) && entryOn(state, kind, target);
      canOpen[MARK] = baseOpen;
      RM.canOpen = canOpen;
    }
    return true;
  }
  function uninstall(RM) {
    if (!RM) return;
    if (RM.can && RM.can[MARK]) RM.can = RM.can[MARK];
    if (RM.canOpen && RM.canOpen[MARK]) RM.canOpen = RM.canOpen[MARK];
  }

  // ---------- 依赖：商机关了，“成交”不能再按商机算 ----------
  // 客户设置里“成交怎么算”选了“按商机”，商机功能又关了：读取时退回按订单算（设置本身不改，商机重新打开就恢复）。
  const orderRuleMemo = new WeakMap();
  function dealByOrder(state) {
    if (!state || typeof state !== 'object') return state;
    if (!orderRuleMemo.has(state)) {
      const ls = state.laiSettings || {};
      const stored = isPlain(ls.customerSettings) ? ls.customerSettings : {};
      orderRuleMemo.set(state, { ...state, laiSettings: { ...ls, customerSettings: { ...stored, dealRule: { by: 'order' } } } });
    }
    return orderRuleMemo.get(state);
  }
  // 现在成交实际按什么算：'order' 或 'opportunity'。
  function dealBasis(state, CS) {
    const by = CS && typeof CS.get === 'function' ? CS.get(state).dealRule.by : 'order';
    return by === 'opportunity' && enabled(state, 'opp') ? 'opportunity' : 'order';
  }
  function patchDealDate(CS) {
    if (!CS || typeof CS.lastDealDate !== 'function' || CS.lastDealDate[MARK]) return false;
    const base = CS.lastDealDate;
    const wrapped = (state, name) => (enabled(state, 'opp') ? base(state, name) : base(dealByOrder(state), name));
    wrapped[MARK] = base;
    CS.lastDealDate = wrapped;
    return true;
  }
  function unpatchDealDate(CS) {
    if (CS && CS.lastDealDate && CS.lastDealDate[MARK]) CS.lastDealDate = CS.lastDealDate[MARK];
  }

  // ---------- 依赖：任务规则用到了关着的模块就不跑 ----------
  // 规则 → 它用到的模块（目前只有“商机快到结束日期”用商机）。
  const RULE_MODULE = Object.freeze({ oppClose: 'opp' });
  const ruleBlocked = (state, type) => Object.hasOwn(RULE_MODULE, type) && !enabled(state, RULE_MODULE[type]);
  // 跑任务规则时，把用到关着的模块的规则当成没开；返回的状态里规则开关还是用户原来设的，下次模块打开就继续。
  // 没有任何该跑的规则时返回 null（什么也不用保存）。TR 是 LaiTaskRuleModel。
  function runTaskRules(TR, state, options) {
    const cfg = TR.config(state);
    const blocked = cfg.rules.filter((rule) => rule.enabled && ruleBlocked(state, rule.type)).map((rule) => rule.type);
    if (!blocked.length) return TR.due(state, options && options.now) ? TR.run(state, options) : null;
    const shadow = blocked.reduce((s, type) => TR.setRule(s, type, { enabled: false }), state);
    if (!TR.due(shadow, options && options.now)) return null;
    const result = TR.run(shadow, options);
    const after = TR.config(result.state);
    const restored = after.rules.map((rule) => (blocked.includes(rule.type) ? { ...rule, enabled: true } : rule));
    const ls = result.state.laiSettings || {};
    return { ...result, state: { ...result.state, laiSettings: { ...ls, taskRules: { ...(ls.taskRules || {}), rules: restored, lastRun: after.lastRun, dismissed: after.dismissed } } } };
  }

  const api = { MODULES, IDS, ROUTE_MODULE, offList, enabled, set, label, moduleOfRoute, moduleOfKey, moduleOfEntry, routeOn, keyOn, entryOn,
    install, uninstall, patchDealDate, unpatchDealDate, dealBasis, ruleBlocked, runTaskRules };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.LaiFeatureSwitch = api;
    // 网页里：本文件放在角色模型和客户设置之后，装载时就接好。
    install(root.LaiRoleModel);
    patchDealDate(root.LaiCustomerSettings);
  }
})(typeof window !== 'undefined' ? window : globalThis);
