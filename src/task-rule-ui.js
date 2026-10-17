(function (root) {
  'use strict';
  // 任务设置页面（协同 → 任务设置，路由 task-settings，权限 settings.task）。登记在 business-ui.js 的页面登记处，逻辑在 task-rule-model.js。
  // 四条规则，全部默认关闭。每条有开关、数字、「现在会生成 N 个任务」的预览；下面列出自动生成的待办，可以删除（删了不再重建）。
  const TM = () => root.LaiTaskRuleModel || (typeof module !== 'undefined' && module.exports ? require('./task-rule-model.js') : null);
  const BM = () => root.LaiBusinessModel || (typeof module !== 'undefined' && module.exports ? require('./business-model.js') : null);
  const FSW = () => root.LaiFeatureSwitch || (typeof module !== 'undefined' && module.exports ? require('./feature-switch-model.js') : null);
  const blockedRule = (state, type) => { const F = FSW(); return !!F && F.ruleBlocked(state, type); };
  const PERM = 'settings.task';
  const RULE_NAME = { noFollow: '客户没跟进', orderStage: '订单到了某个阶段', oppClose: '商机快到结束日期', repurchase: '复购提醒' };
  // 页面上的临时状态：哪条自动待办点过一次删除、上一条错误、刚才那次的结果。
  const view = { armed: '', error: '', note: '' };

  function markup(state, c, now = new Date()) {
    const M = TM(), E = c.escape, editable = c.can(PERM);
    const cfg = M.config(state), pv = M.preview(state, now);
    const lock = editable ? '' : ' disabled';
    const lockOf = (type) => (blockedRule(state, type) ? ' disabled' : lock);
    const num = (type, field, value, min, max) =>
      `<input class="tr-num" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${E(value)}" data-tr-field="${field}" data-type="${type}" aria-label="${E(RULE_NAME[type])}的${field === 'days' ? '天数' : '几天后'}"${lockOf(type)}>`;
    const stagePicker = (rule) =>
      `<select class="tr-stage" data-tr-field="stage" data-type="orderStage" aria-label="订单阶段"${lock}>${BM().stages.map((s) => `<option value="${E(s.id)}"${s.id === rule.stage ? ' selected' : ''}>${E(s.label)}</option>`).join('')}</select>`;
    const sentence = {
      noFollow: (rule) => `客户有 ${num('noFollow', 'days', rule.days, 1, 365)} 天没有跟进，就给跟进人建一个待办「跟进 客户名」，今天到期。`,
      orderStage: (rule) => `订单到了 ${stagePicker(rule)} 这一阶段，${num('orderStage', 'dueDays', rule.dueDays, 0, 90)} 天后提醒订单负责人。每个订单每个阶段只提醒一次，打开这条规则以前建的订单不提醒。`,
      oppClose: (rule) => `还没成交的商机，离结束日期只剩 ${num('oppClose', 'days', rule.days, 1, 365)} 天时，提醒商机负责人；待办在结束日期那天到期。`,
      repurchase: () => '客户最后一个订单已经过了客户资料里设置的「复购周期」，就提醒客户的跟进人。没设复购周期的客户不提醒。',
    };
    const cards = cfg.rules.map((rule) => {
      const p = pv.byType[rule.type] || { count: 0, total: 0 };
      const more = p.total > p.count ? `<span class="muted tiny">（一次最多 ${M.CAP} 个，还有 ${p.total - p.count} 个明天接着生成）</span>` : '';
      // 规则用到的功能（商机）在“功能开关”里关了：规则不跑，开关锁住；开关设置本身不改，功能打开后接着用。
      const blocked = blockedRule(state, rule.type);
      const ruleLock = blocked ? ' disabled' : lock;
      const status_ = blocked ? '商机已关闭' : rule.enabled ? '已开启' : '未开启';
      return `<section class="business-section tr-rule${blocked ? ' tr-blocked' : ''}" data-tr-rule="${E(rule.type)}"${blocked ? ' data-tr-blocked="1"' : ''}><div class="tr-head"><div><h3>${E(RULE_NAME[rule.type])}</h3><p class="settings-copy tr-sentence">${sentence[rule.type](rule)}</p></div>`
        + `<label class="tr-switch"><input type="checkbox" data-tr-toggle="${E(rule.type)}"${rule.enabled && !blocked ? ' checked' : ''}${ruleLock}><span>${status_}</span></label></div>`
        + (blocked ? '<p class="tr-preview muted" data-tr-preview-off="1">商机已关闭，这条规则暂时不建待办；重新打开商机后接着用。</p>'
          : `<p class="tr-preview" data-tr-preview="${E(rule.type)}">现在会生成 <strong>${p.count}</strong> 个任务 ${more}</p>`)
        + `</section>`;
    }).join('');
    const tasks = M.autoTasks(state).filter((task) => task.done !== true).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
    const shown = tasks.slice(0, 100);
    const rows = shown.map((task) => {
      const who = BM().taskOwner(state, task) || '未分配';
      const armed = view.armed === task.id;
      return `<tr data-tr-task="${E(task.id)}"><td>${E(task.title)}</td><td>${E(who)}</td><td>${E(task.date)}</td><td>${E(RULE_NAME[task.auto.rule] || '')}</td>`
        + `<td>${editable ? `<button type="button" class="${armed ? 'danger' : ''}" data-tr-action="delete" data-id="${E(task.id)}">${armed ? '确认删除' : '删除'}</button>` : ''}</td></tr>`;
    }).join('');
    const list = `<section class="business-section tr-auto"><div class="section-head"><h3>自动生成的待办</h3><span class="muted tiny">还没做完的 ${tasks.length} 个；删除后，同一件事不会再自动建</span></div>`
      + (rows ? `<table class="order-table tr-table"><thead><tr><th>待办</th><th>负责人</th><th>到期日</th><th>来自</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>${tasks.length > shown.length ? `<p class="muted tiny">只显示前 ${shown.length} 个</p>` : ''}`
        : '<p class="muted tr-empty">还没有自动生成的待办。</p>')
      + '</section>';
    const lastRun = cfg.lastRun ? `上次运行：${E(cfg.lastRun)}` : '还没有运行过';
    return `<div class="pagebar"><div class="business-title"><h1>任务设置</h1><span>按规则自动建待办，让该跟进的事不会漏掉；规则默认都是关的</span></div><div class="page-actions"></div></div>`
      + `<div class="business-scroll tr-page">${cards}${list}`
      + `<div class="error${view.error ? ' visible' : ''}" id="tr-error" role="alert">${E(view.error)}</div>`
      + `<p class="settings-copy tr-note" data-tr-last>${lastRun}。开着的规则每天自动跑一次，打开规则时也会马上跑一次。${view.note ? `<br>${E(view.note)}` : ''}</p></div>`;
  }

  // 保存一次修改。make(state) 返回 {state, count}；count 是同一次保存里新建的待办数。
  async function save(c, make, after) {
    if (!c.need(PERM)) return;
    try {
      const made = make(c.state());
      await c.save(made.state);
      view.error = '';
      view.note = after ? after(made) : '';
      if (made.count) c.toast(`已生成 ${made.count} 个待办`);
    } catch (error) {
      view.error = error.message;
    }
    c.refresh();
  }
  // 改一条规则；改完这条规则如果是开着的，就按规则马上建待办（同一次保存）。
  function change(c, type, patch) {
    const M = TM();
    return save(c, (state) => {
      let next = M.setRule(state, type, patch), count = 0;
      if (M.rules(next).find((rule) => rule.type === type).enabled && !blockedRule(next, type)) {
        // 用到关着的功能的规则不会建待办；其它开着的规则照常跑（FS.runTaskRules 把关着的那条当成没开）。
        const F = FSW();
        const result = F ? F.runTaskRules(M, next, { force: true }) : M.run(next);
        if (result) { next = result.state; count = result.created.length; }
      }
      return { state: next, count };
    }, (made) => (made.count ? `刚刚生成了 ${made.count} 个待办。` : ''));
  }

  const page = {
    title: '任务设置',
    render(c) {
      // 从别的页面进来时，清掉上次的提示。
      if (typeof document !== 'undefined' && document.querySelector && !document.querySelector('.tr-page')) Object.assign(view, { armed: '', error: '', note: '' });
      return markup(c.state(), c);
    },
    click(c, e) {
      const button = e.target?.closest?.('[data-tr-action]');
      if (!button) {
        // 点到别处时，取消「确认删除」。
        if (view.armed && e.target?.closest?.('.tr-page')) { view.armed = ''; c.refresh(); }
        return false;
      }
      if (!c.need(PERM)) return true;
      const id = button.dataset.id || '';
      if (view.armed !== id) { view.armed = id; view.error = ''; c.refresh(); return true; }
      view.armed = '';
      save(c, (state) => ({ state: TM().dismissTask(state, id), count: 0 }), () => '已删除，这件事不会再自动建待办。');
      return true;
    },
    change(c, e) {
      const target = e.target;
      if (!target || !target.dataset) return false;
      if (target.dataset.trToggle) {
        if (!c.need(PERM) || blockedRule(c.state(), target.dataset.trToggle)) { c.refresh(); return true; }
        change(c, target.dataset.trToggle, { enabled: target.checked });
        return true;
      }
      if (target.dataset.trField) {
        if (!c.need(PERM)) { c.refresh(); return true; }
        change(c, target.dataset.type, { [target.dataset.trField]: target.value });
        return true;
      }
      return false;
    },
  };

  root.LaiExtraPages = root.LaiExtraPages || {};
  root.LaiExtraPages['task-settings'] = page;
  const api = { page, markup, view };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LaiTaskRuleUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
